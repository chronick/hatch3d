/**
 * Patch graph — the JSON wire format (the thing the DSL compiles to) and its
 * evaluator. A patch is a named list of nodes; each produces a signal (Geometry
 * or Field) that later nodes reference by name. This is the L2 static patch:
 * a DAG with field modulation and bounded iteration that still evaluates to a
 * fixed set of polylines, so the result renders reproducibly and `stats`
 * measures it. (Design: vault active/plotter-art-workflow.)
 *
 * `repeat` is the safe form of "time": it unrolls its body a fixed number of
 * times, threading one variable output → input each pass. A `for` loop in the
 * patch, not a wall-clock oscillator — that is what keeps the whole thing
 * deterministic and measurable.
 */

import { z } from "zod";
import type { Geometry, Field, ScalarField, VectorField } from "./signals.js";
import {
  simplexScalar,
  simplexVector,
  densityField,
  gradient,
  geometryBBox,
} from "./signals.js";
import { fieldDistort, fieldCull, fieldThin } from "./operators.js";
import { compositionRegistry } from "../compositions/registry.js";
import { is2DComposition, isLayeredComposition } from "../compositions/types.js";
import { runPipeline } from "../workers/render-pipeline.js";
import type { RenderRequest } from "../workers/render-worker.types.js";
import { parseDString } from "../utils/clip.js";

// ── Node schema (zod — the validated wire format) ──

const NodeBase = { id: z.string().min(1) };

const GeneratorNode = z.object({ op: z.literal("generator"), ...NodeBase, composition: z.string(), params: z.record(z.string(), z.unknown()).optional() }).strict();
const SimplexScalarNode = z.object({ op: z.literal("simplexScalar"), ...NodeBase, scale: z.number(), seed: z.number() }).strict();
const SimplexVectorNode = z.object({ op: z.literal("simplexVector"), ...NodeBase, scale: z.number(), seed: z.number() }).strict();
const DensityNode = z.object({ op: z.literal("density"), ...NodeBase, from: z.string(), cell: z.number().positive() }).strict();
const GradientNode = z.object({ op: z.literal("gradient"), ...NodeBase, from: z.string() }).strict();
const DistortNode = z.object({ op: z.literal("distort"), ...NodeBase, from: z.string(), by: z.string(), amp: z.number() }).strict();
const CullNode = z.object({ op: z.literal("cull"), ...NodeBase, from: z.string(), by: z.string(), min: z.number(), max: z.number() }).strict();
const ThinNode = z.object({ op: z.literal("thin"), ...NodeBase, from: z.string(), by: z.string(), strength: z.number() }).strict();
const PenNode = z.object({ op: z.literal("pen"), ...NodeBase, from: z.string(), color: z.string().optional(), name: z.string().optional() }).strict();

export type PatchNode =
  | z.infer<typeof GeneratorNode>
  | z.infer<typeof SimplexScalarNode>
  | z.infer<typeof SimplexVectorNode>
  | z.infer<typeof DensityNode>
  | z.infer<typeof GradientNode>
  | z.infer<typeof DistortNode>
  | z.infer<typeof CullNode>
  | z.infer<typeof ThinNode>
  | z.infer<typeof PenNode>
  | RepeatNode;

export interface RepeatNode {
  op: "repeat";
  id: string;
  times: number;
  thread: string;
  body: PatchNode[];
}

const RepeatNodeSchema: z.ZodType<RepeatNode> = z.lazy(() =>
  z.object({
    op: z.literal("repeat"),
    id: z.string().min(1),
    times: z.number().int().min(1).max(64),
    thread: z.string(),
    body: z.array(NodeSchema),
  }).strict(),
);

export const NodeSchema: z.ZodType<PatchNode> = z.union([
  GeneratorNode, SimplexScalarNode, SimplexVectorNode, DensityNode, GradientNode,
  DistortNode, CullNode, ThinNode, PenNode, RepeatNodeSchema,
]);

export const PatchDocSchema = z.object({
  version: z.literal(1),
  id: z.string().min(1),
  page: z.object({
    size: z.enum(["a3", "a4", "a5", "letter"]).default("a3"),
    orientation: z.enum(["landscape", "portrait"]).default("landscape"),
    marginMm: z.number().nonnegative().default(15),
    widthPx: z.number().positive().default(800),
    heightPx: z.number().positive().default(800),
    strokeWidthMm: z.number().positive().default(0.5),
  }).prefault({}),
  nodes: z.array(NodeSchema),
  out: z.array(z.string()).min(1),
}).strict();

export type PatchDoc = z.infer<typeof PatchDocSchema>;

export function parsePatchDoc(input: unknown): PatchDoc {
  const r = PatchDocSchema.safeParse(input);
  if (!r.success) {
    const issues = r.error.issues.map((i) => `  • ${i.path.join(".") || "(root)"}: ${i.message}`).join("\n");
    throw new Error(`Invalid patch document:\n${issues}`);
  }
  return r.data;
}

// ── Evaluation ──

type Signal = Geometry | Field;
type Env = Map<string, Signal>;

export interface PatchLayer {
  id: string;
  color?: string;
  name?: string;
  geometry: Geometry;
}

export interface EvalResult {
  layers: PatchLayer[];
  page: PatchDoc["page"];
}

function isGeometry(s: Signal): s is Geometry {
  return Array.isArray(s);
}
function asGeometry(s: Signal | undefined, ctx: string): Geometry {
  if (!s || !isGeometry(s)) throw new Error(`patch: ${ctx} expected geometry`);
  return s;
}
function asScalar(s: Signal | undefined, ctx: string): ScalarField {
  if (!s || isGeometry(s) || s.kind !== "scalar") throw new Error(`patch: ${ctx} expected a scalar field`);
  return s;
}
function asVector(s: Signal | undefined, ctx: string): VectorField {
  if (!s || isGeometry(s) || s.kind !== "vector") throw new Error(`patch: ${ctx} expected a vector field`);
  return s;
}

/** Render a composition to canvas-space polylines by reusing the render pipeline. */
function generatorGeometry(compId: string, params: Record<string, unknown> | undefined, page: PatchDoc["page"]): Geometry {
  const comp = compositionRegistry.get(compId);
  if (!comp) throw new Error(`patch: unknown composition "${compId}"`);
  if (isLayeredComposition(comp)) throw new Error(`patch: layered composition "${compId}" not usable as a generator node`);
  const resolved: Record<string, unknown> = {};
  if (comp.controls) for (const [k, c] of Object.entries(comp.controls)) resolved[k] = (c as { default: unknown }).default;
  Object.assign(resolved, params ?? {});
  const req: RenderRequest = {
    type: "render", id: 1, compositionKey: compId, is2d: is2DComposition(comp),
    width: page.widthPx, height: page.heightPx, resolvedValues: resolved,
    surfaceKey: "hyperboloid", surfaceParams: {},
    hatchParams: { family: "u", count: 30, samples: 50, angle: 0.7 },
    currentHatchGroups: {},
    camera: { theta: 0.6, phi: 0.35, dist: 8, ortho: false, panX: 0, panY: 0, width: page.widthPx, height: page.heightPx },
    useOcclusion: false, depthRes: 512, depthBias: 0.01,
    exportLayout: { contentW: 0, contentH: 0, scale: 1 },
    showMesh: false, densityFilterEnabled: false, densityMax: 8, densityCellSize: 10,
  };
  return runPipeline(req).svgPaths.map(parseDString).filter((p) => p.length >= 2);
}

function evalNode(node: PatchNode, env: Env, page: PatchDoc["page"]): void {
  switch (node.op) {
    case "generator":
      env.set(node.id, generatorGeometry(node.composition, node.params, page));
      break;
    case "simplexScalar":
      env.set(node.id, simplexScalar(node.scale, node.seed));
      break;
    case "simplexVector":
      env.set(node.id, simplexVector(node.scale, node.seed));
      break;
    case "density": {
      const g = asGeometry(env.get(node.from), `density(${node.from})`);
      env.set(node.id, densityField(g, geometryBBox(g, { w: page.widthPx, h: page.heightPx }), node.cell));
      break;
    }
    case "gradient":
      env.set(node.id, gradient(asScalar(env.get(node.from), `gradient(${node.from})`)));
      break;
    case "distort":
      env.set(node.id, fieldDistort(asGeometry(env.get(node.from), `distort(${node.from})`), asVector(env.get(node.by), `distort by ${node.by}`), node.amp));
      break;
    case "cull":
      env.set(node.id, fieldCull(asGeometry(env.get(node.from), `cull(${node.from})`), asScalar(env.get(node.by), `cull by ${node.by}`), { min: node.min, max: node.max }));
      break;
    case "thin":
      env.set(node.id, fieldThin(asGeometry(env.get(node.from), `thin(${node.from})`), asScalar(env.get(node.by), `thin by ${node.by}`), node.strength));
      break;
    case "pen":
      env.set(node.id, asGeometry(env.get(node.from), `pen(${node.from})`));
      break;
    case "repeat": {
      if (!env.has(node.thread)) throw new Error(`patch: repeat threads unknown variable "${node.thread}"`);
      for (let i = 0; i < node.times; i++) {
        for (const child of node.body) evalNode(child, env, page);
      }
      break;
    }
  }
}

/** Evaluate a patch document into per-pen geometry layers. */
export function evalPatch(input: unknown): EvalResult {
  const doc = parsePatchDoc(input);
  const env: Env = new Map();
  for (const node of doc.nodes) evalNode(node, env, doc.page);

  const layers: PatchLayer[] = doc.out.map((id) => {
    const node = findPen(doc.nodes, id);
    const geom = asGeometry(env.get(id), `out "${id}"`);
    return { id, color: node?.color, name: node?.name ?? id, geometry: geom };
  });
  return { layers, page: doc.page };
}

function findPen(nodes: PatchNode[], id: string): { color?: string; name?: string } | undefined {
  for (const n of nodes) {
    if (n.op === "pen" && n.id === id) return { color: n.color, name: n.name };
    if (n.op === "repeat") {
      const f = findPen(n.body, id);
      if (f) return f;
    }
  }
  return undefined;
}
