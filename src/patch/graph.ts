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
  sdfField,
  blendFields,
  luminanceField,
} from "./signals.js";
import { fieldDistort, fieldCull, fieldThin, transformGeometry, clipGeometry } from "./operators.js";
import { hatchPolygon } from "./region-hatch.js";
import { compositionRegistry } from "../compositions/registry.js";
import { is2DComposition, isLayeredComposition } from "../compositions/types.js";
import type { LayeredLayer, HatchGroupConfig } from "../compositions/types.js";
import { resolveLayerInnerValues } from "../compositions/helpers.js";
import { runPipeline } from "../workers/render-pipeline.js";
import type { RenderRequest } from "../workers/render-worker.types.js";
import { parseDString, convexHull } from "../utils/clip.js";

// ── Node schema (zod — the validated wire format) ──

const NodeBase = { id: z.string().min(1) };

const GeneratorNode = z.object({
  op: z.literal("generator"), ...NodeBase, composition: z.string(),
  params: z.record(z.string(), z.unknown()).optional(),
  /** Macro slider overrides (raw 0..1), like a LayeredLayer's macroOverrides. */
  macros: z.record(z.string(), z.number()).optional(),
  /** Per-hatch-group config overrides. */
  hatchGroups: z.record(z.string(), z.unknown()).optional(),
}).strict();
const SimplexScalarNode = z.object({ op: z.literal("simplexScalar"), ...NodeBase, scale: z.number(), seed: z.number() }).strict();
const SimplexVectorNode = z.object({ op: z.literal("simplexVector"), ...NodeBase, scale: z.number(), seed: z.number() }).strict();
const DensityNode = z.object({ op: z.literal("density"), ...NodeBase, from: z.string(), cell: z.number().positive() }).strict();
const GradientNode = z.object({ op: z.literal("gradient"), ...NodeBase, from: z.string() }).strict();
const SdfNode = z.object({ op: z.literal("sdf"), ...NodeBase, from: z.string() }).strict();
const LuminanceNode = z.object({
  op: z.literal("luminance"), ...NodeBase,
  /** Image path resolved by the caller's resolveImage (CLI decodes; browser uploads). */
  image: z.string(),
  invert: z.boolean().default(false),
}).strict();
const BlendNode = z.object({
  op: z.literal("blend"), ...NodeBase, a: z.string(), b: z.string(),
  mode: z.enum(["add", "mul", "max", "min", "mix"]).default("add"),
  mix: z.number().default(0.5),
}).strict();
const DistortNode = z.object({ op: z.literal("distort"), ...NodeBase, from: z.string(), by: z.string(), amp: z.number() }).strict();
const CullNode = z.object({ op: z.literal("cull"), ...NodeBase, from: z.string(), by: z.string(), min: z.number(), max: z.number() }).strict();
const ThinNode = z.object({ op: z.literal("thin"), ...NodeBase, from: z.string(), by: z.string(), strength: z.number() }).strict();
const TransformNode = z.object({
  op: z.literal("transform"), ...NodeBase, from: z.string(),
  translate: z.tuple([z.number(), z.number()]).optional(),
  rotateDeg: z.number().optional(),
  scale: z.union([z.number(), z.tuple([z.number(), z.number()])]).optional(),
}).strict();
const ClipNode = z.object({
  op: z.literal("clip"), ...NodeBase, from: z.string(),
  /** Clip to the hull of another node's geometry... */
  hullOf: z.string().optional(),
  /** ...or to an explicit polygon. Exactly one of hullOf/polygon. */
  polygon: z.array(z.tuple([z.number(), z.number()])).optional(),
}).strict().refine(
  (n) => (n.hullOf == null) !== (n.polygon == null),
  { message: "clip needs exactly one of `hullOf` or `polygon`" },
);
const RegionHatchNode = z.object({
  op: z.literal("regionHatch"), ...NodeBase,
  /** Region = the convex hull of another node's geometry... */
  from: z.string().optional(),
  /** ...or an explicit closed polygon. Exactly one of from/polygon. */
  polygon: z.array(z.tuple([z.number(), z.number()])).optional(),
  angleDeg: z.number(),
  pitch: z.number().positive(),
}).strict().refine(
  (n) => (n.from == null) !== (n.polygon == null),
  { message: "regionHatch needs exactly one of `from` or `polygon`" },
);
const PenNode = z.object({ op: z.literal("pen"), ...NodeBase, from: z.string(), color: z.string().optional(), name: z.string().optional() }).strict();

export type PatchNode =
  | z.infer<typeof GeneratorNode>
  | z.infer<typeof SimplexScalarNode>
  | z.infer<typeof SimplexVectorNode>
  | z.infer<typeof DensityNode>
  | z.infer<typeof GradientNode>
  | z.infer<typeof SdfNode>
  | z.infer<typeof LuminanceNode>
  | z.infer<typeof BlendNode>
  | z.infer<typeof DistortNode>
  | z.infer<typeof CullNode>
  | z.infer<typeof ThinNode>
  | z.infer<typeof TransformNode>
  | z.infer<typeof ClipNode>
  | z.infer<typeof RegionHatchNode>
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
  SdfNode, LuminanceNode, BlendNode,
  DistortNode, CullNode, ThinNode, TransformNode, ClipNode, RegionHatchNode, PenNode, RepeatNodeSchema,
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
  /** Camera for 3D generators (ignored by 2D compositions). */
  camera: z.object({
    theta: z.number().default(0.6),
    phi: z.number().default(0.35),
    dist: z.number().default(8),
    ortho: z.boolean().default(false),
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
/** Look up a referenced node's signal, distinguishing "unknown id" from "wrong type". */
function ref(env: Env, id: string, ctx: string): Signal {
  if (!env.has(id)) {
    throw new Error(`patch: ${ctx} references unknown node "${id}" (declared later or a typo?)`);
  }
  return env.get(id)!;
}
function asGeometry(s: Signal, ctx: string): Geometry {
  if (!isGeometry(s)) throw new Error(`patch: ${ctx} expected geometry, got a field`);
  return s;
}
function asScalar(s: Signal, ctx: string): ScalarField {
  if (isGeometry(s) || s.kind !== "scalar") throw new Error(`patch: ${ctx} expected a scalar field`);
  return s;
}
function asVector(s: Signal, ctx: string): VectorField {
  if (isGeometry(s) || s.kind !== "vector") throw new Error(`patch: ${ctx} expected a vector field`);
  return s;
}

/** Render a composition to canvas-space polylines by reusing the render pipeline. */
/**
 * Render a composition (generator node) to canvas-space polylines.
 *
 * Mirrors runLayeredPipeline's per-layer logic exactly — resolveLayerInnerValues
 * (control defaults + macro fan-out + overrides) + hatchGroup overrides + the
 * doc camera — so a generator node is byte-identical to the equivalent layered
 * layer. This is what lets a Scene IR document lower to a patch and still render
 * the same SVG (the unification's byte-identical guarantee).
 */
function generatorGeometry(
  node: { composition: string; params?: Record<string, unknown>; macros?: Record<string, number>; hatchGroups?: Record<string, unknown> },
  page: PatchDoc["page"],
  camera: PatchDoc["camera"],
): Geometry {
  const comp = compositionRegistry.get(node.composition);
  if (!comp) throw new Error(`patch: unknown composition "${node.composition}"`);
  if (isLayeredComposition(comp)) throw new Error(`patch: layered composition "${node.composition}" not usable as a generator node`);

  const layer: LayeredLayer = {
    composition: node.composition,
    paramOverrides: node.params,
    macroOverrides: node.macros,
    hatchGroupOverrides: node.hatchGroups as Record<string, HatchGroupConfig> | undefined,
  };
  const resolvedValues = resolveLayerInnerValues(comp, layer);

  const req: RenderRequest = {
    type: "render", id: 1, compositionKey: node.composition, is2d: is2DComposition(comp),
    width: page.widthPx, height: page.heightPx, resolvedValues,
    surfaceKey: "hyperboloid", surfaceParams: {},
    hatchParams: { family: "u", count: 30, samples: 50, angle: 0.7 },
    currentHatchGroups: (node.hatchGroups as Record<string, HatchGroupConfig>) ?? {},
    camera: { theta: camera.theta, phi: camera.phi, dist: camera.dist, ortho: camera.ortho, panX: 0, panY: 0, width: page.widthPx, height: page.heightPx },
    useOcclusion: false, depthRes: 512, depthBias: 0.01,
    exportLayout: { contentW: 0, contentH: 0, scale: 1 },
    showMesh: false, densityFilterEnabled: false, densityMax: 8, densityCellSize: 10,
  };
  return runPipeline(req).svgPaths.map(parseDString).filter((p) => p.length >= 2);
}

/** Resolves a `luminance` node's image path to a row-major brightness grid. */
export type ImageResolver = (path: string) => { brightness: ArrayLike<number>; width: number; height: number };

export interface EvalOptions {
  /** Required only if the patch uses `luminance` nodes; the CLI decodes PNGs. */
  resolveImage?: ImageResolver;
}

function evalNode(node: PatchNode, env: Env, page: PatchDoc["page"], camera: PatchDoc["camera"], resolveImage?: ImageResolver): void {
  switch (node.op) {
    case "generator":
      env.set(node.id, generatorGeometry(node, page, camera));
      break;
    case "simplexScalar":
      env.set(node.id, simplexScalar(node.scale, node.seed));
      break;
    case "simplexVector":
      env.set(node.id, simplexVector(node.scale, node.seed));
      break;
    case "density": {
      const g = asGeometry(ref(env, node.from, `density(${node.from})`), `density(${node.from})`);
      env.set(node.id, densityField(g, geometryBBox(g, { w: page.widthPx, h: page.heightPx }), node.cell));
      break;
    }
    case "gradient":
      env.set(node.id, gradient(asScalar(ref(env, node.from, `gradient(${node.from})`), `gradient(${node.from})`)));
      break;
    case "sdf": {
      const g = asGeometry(ref(env, node.from, `sdf(${node.from})`), `sdf(${node.from})`);
      env.set(node.id, sdfField(convexHull(g.flat())));
      break;
    }
    case "luminance": {
      if (!resolveImage) {
        throw new Error(`patch: luminance node "${node.id}" needs an image resolver (run via the CLI, which decodes images).`);
      }
      const img = resolveImage(node.image);
      env.set(node.id, luminanceField(img.brightness, img.width, img.height, page.widthPx, page.heightPx, { invert: node.invert }));
      break;
    }
    case "blend":
      env.set(node.id, blendFields(
        asScalar(ref(env, node.a, `blend a=${node.a}`), `blend a=${node.a}`),
        asScalar(ref(env, node.b, `blend b=${node.b}`), `blend b=${node.b}`),
        node.mode, node.mix,
      ));
      break;
    case "distort":
      env.set(node.id, fieldDistort(asGeometry(ref(env, node.from, `distort(${node.from})`), `distort(${node.from})`), asVector(ref(env, node.by, `distort by ${node.by}`), `distort by ${node.by}`), node.amp));
      break;
    case "cull":
      env.set(node.id, fieldCull(asGeometry(ref(env, node.from, `cull(${node.from})`), `cull(${node.from})`), asScalar(ref(env, node.by, `cull by ${node.by}`), `cull by ${node.by}`), { min: node.min, max: node.max }));
      break;
    case "thin":
      env.set(node.id, fieldThin(asGeometry(ref(env, node.from, `thin(${node.from})`), `thin(${node.from})`), asScalar(ref(env, node.by, `thin by ${node.by}`), `thin by ${node.by}`), node.strength));
      break;
    case "transform":
      env.set(node.id, transformGeometry(asGeometry(ref(env, node.from, `transform(${node.from})`), `transform(${node.from})`), { translate: node.translate, rotateDeg: node.rotateDeg, scale: node.scale }));
      break;
    case "clip": {
      const geom = asGeometry(ref(env, node.from, `clip(${node.from})`), `clip(${node.from})`);
      const region = node.polygon
        ? node.polygon.map(([x, y]) => ({ x, y }))
        : asGeometry(ref(env, node.hullOf!, `clip by ${node.hullOf}`), `clip by ${node.hullOf}`).flat();
      env.set(node.id, clipGeometry(geom, region));
      break;
    }
    case "regionHatch": {
      let polygon: { x: number; y: number }[];
      if (node.polygon) {
        polygon = node.polygon.map(([x, y]) => ({ x, y }));
      } else if (node.from) {
        const g = asGeometry(ref(env, node.from, `regionHatch(${node.from})`), `regionHatch(${node.from})`);
        polygon = convexHull(g.flat());
      } else {
        throw new Error(`patch: regionHatch "${node.id}" needs a "from" node or an explicit polygon.`);
      }
      env.set(node.id, hatchPolygon(polygon, node.angleDeg, node.pitch));
      break;
    }
    case "pen":
      env.set(node.id, asGeometry(ref(env, node.from, `pen(${node.from})`), `pen(${node.from})`));
      break;
    case "repeat": {
      if (!env.has(node.thread)) throw new Error(`patch: repeat threads unknown variable "${node.thread}" (must be defined before the loop)`);
      if (!node.body.some((n) => n.id === node.thread)) {
        throw new Error(`patch: repeat threads "${node.thread}" but its body never reassigns it — the loop would be a no-op.`);
      }
      for (let i = 0; i < node.times; i++) {
        for (const child of node.body) evalNode(child, env, page, camera, resolveImage);
      }
      break;
    }
  }
}

/** Evaluate a patch document into per-pen geometry layers. */
export function evalPatch(input: unknown, opts: EvalOptions = {}): EvalResult {
  const doc = parsePatchDoc(input);
  const env: Env = new Map();
  for (const node of doc.nodes) evalNode(node, env, doc.page, doc.camera, opts.resolveImage);

  const layers: PatchLayer[] = doc.out.map((id) => {
    const node = findPen(doc.nodes, id);
    const geom = asGeometry(ref(env, id, `out "${id}"`), `out "${id}"`);
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
