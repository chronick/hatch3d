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
import type { Geometry, Field, ScalarField, VectorField, Polyline } from "./signals.js";
import {
  simplexScalar,
  simplexVector,
  densityField,
  gradient,
  geometryBBox,
  sdfField,
  blendFields,
  luminanceField,
  directionalField,
} from "./signals.js";
import { fieldDistort, fieldCull, fieldThin, transformGeometry, clipGeometry, clipGeometryToRings, emphasisMask, resampleGeometry } from "./operators.js";
import {
  RegionRefShape,
  regionFormCount,
  resolveRegionRings,
  hatchRegionFormCount,
  hatchRegionRef,
  type RegionRef,
} from "./regions.js";
import { hatchRegion } from "./region-hatch.js";
import { compositionRegistry } from "../compositions/registry.js";
import { is2DComposition, isLayeredComposition } from "../compositions/types.js";
import type { LayeredLayer, HatchGroupConfig } from "../compositions/types.js";
import { resolveLayerInnerValues } from "../compositions/helpers.js";
import { runPipeline } from "../workers/render-pipeline.js";
import type { RenderRequest, LayerGroupResult } from "../workers/render-worker.types.js";
import { parseDString, convexHull } from "../utils/clip.js";
import { polylinesToSVGPaths } from "../projection.js";

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
const DirectionalNode = z.object({ op: z.literal("directional"), ...NodeBase, from: z.string(), dir: z.tuple([z.number(), z.number()]) }).strict();
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
const ResampleNode = z.object({ op: z.literal("resample"), ...NodeBase, from: z.string(), step: z.number().positive() }).strict();
const TransformNode = z.object({
  op: z.literal("transform"), ...NodeBase, from: z.string(),
  translate: z.tuple([z.number(), z.number()]).optional(),
  rotateDeg: z.number().optional(),
  scale: z.union([z.number(), z.tuple([z.number(), z.number()])]).optional(),
}).strict();
const ClipNode = z.object({
  op: z.literal("clip"), ...NodeBase, from: z.string(),
  /** Clip to a region: another node's hull, an explicit polygon, or a derived region. */
  ...RegionRefShape,
  /** Keep what is inside the region (default) or what is outside it. */
  mode: z.enum(["inside", "outside"]).optional(),
}).strict().refine(
  (n) => regionFormCount(n) === 1,
  { message: "clip needs exactly one of `hullOf`, `polygon` or `regionOf`" },
);
const EmphasisNode = z.object({
  op: z.literal("emphasis"), ...NodeBase, from: z.string(),
  /** The masked zone, in the shared region vocabulary. */
  ...RegionRefShape,
  /** Fraction of ink kept inside the masked zone: 1 = untouched, 0 = clipped away. */
  weight: z.number().min(0).max(1),
  /** Whether the masked zone is the region's inside (default) or its outside. */
  mode: z.enum(["inside", "outside"]).optional(),
}).strict().refine(
  (n) => regionFormCount(n) === 1,
  { message: "emphasis needs exactly one of `hullOf`, `polygon` or `regionOf`" },
);
const RegionHatchNode = z.object({
  op: z.literal("regionHatch"), ...NodeBase,
  /**
   * The original spelling: hatch the convex hull of another node's geometry.
   * Kept as an alias of `hullOf` (same resolution path), so every patch and DSL
   * document written before the region vocabulary keeps rendering identically.
   */
  from: z.string().optional(),
  /** …or any of the shared region forms (hullOf / polygon / regionOf). */
  ...RegionRefShape,
  angleDeg: z.number(),
  pitch: z.number().positive(),
}).strict().refine(
  (n) => hatchRegionFormCount(n) === 1,
  { message: "regionHatch needs exactly one of `from`, `hullOf`, `polygon` or `regionOf`" },
);
const PenNode = z.object({
  op: z.literal("pen"), ...NodeBase, from: z.string(),
  color: z.string().optional(), name: z.string().optional(),
  /** Per-pen stroke width in mm (converts to widthScale = width / page.strokeWidthMm at export). */
  width: z.number().positive().optional(),
}).strict();

export type PatchNode =
  | z.infer<typeof GeneratorNode>
  | z.infer<typeof SimplexScalarNode>
  | z.infer<typeof SimplexVectorNode>
  | z.infer<typeof DensityNode>
  | z.infer<typeof GradientNode>
  | z.infer<typeof SdfNode>
  | z.infer<typeof DirectionalNode>
  | z.infer<typeof LuminanceNode>
  | z.infer<typeof BlendNode>
  | z.infer<typeof DistortNode>
  | z.infer<typeof CullNode>
  | z.infer<typeof ThinNode>
  | z.infer<typeof ResampleNode>
  | z.infer<typeof TransformNode>
  | z.infer<typeof ClipNode>
  | z.infer<typeof EmphasisNode>
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
  SdfNode, DirectionalNode, LuminanceNode, BlendNode,
  DistortNode, CullNode, ThinNode, ResampleNode, TransformNode, ClipNode, EmphasisNode, RegionHatchNode, PenNode, RepeatNodeSchema,
]);

// ── Progressive evaluation order ──
//
// The evaluator is a single in-order fold over `nodes`: each node writes its
// signal into `env` and later nodes read it back by id. Document order is
// therefore already the evaluation order, and a reference can only ever
// resolve backwards — cycles are structurally impossible and a forward
// reference dies at eval time with "unknown node". What was missing is the
// *contract*: the failure surfaced only when the graph ran, buried in whatever
// the evaluator happened to touch first, and it never explained the rule.
//
// So the rule is now checked up front, at parse time, alongside the rest of
// schema validation. That is what makes "layer 2 draws around layer 1"
// well-defined: a region reference names an area that is already settled.

type RefKind = "geometry" | "field" | "region";

interface NodeRef {
  /** Referenced node id. */
  id: string;
  kind: RefKind;
  /** The field carrying the reference, for the error message. */
  label: string;
  /** Path suffix under the node, for the zod issue path. */
  path: (string | number)[];
}

/** Every node id a node reads, in one place — the input to order validation. */
function nodeReferences(node: PatchNode): NodeRef[] {
  const refs: NodeRef[] = [];
  const add = (id: string | undefined, kind: RefKind, label: string, path: (string | number)[]) => {
    if (typeof id === "string" && id.length > 0) refs.push({ id, kind, label, path });
  };
  switch (node.op) {
    case "density": case "gradient": case "sdf": case "directional":
      add(node.from, "geometry", "from", ["from"]);
      break;
    case "blend":
      add(node.a, "field", "a", ["a"]);
      add(node.b, "field", "b", ["b"]);
      break;
    case "distort": case "cull": case "thin":
      add(node.from, "geometry", "from", ["from"]);
      add(node.by, "field", "by", ["by"]);
      break;
    case "resample": case "transform": case "pen":
      add(node.from, "geometry", "from", ["from"]);
      break;
    case "clip": case "emphasis":
      add(node.from, "geometry", "from", ["from"]);
      add(node.hullOf, "region", "hullOf", ["hullOf"]);
      add(node.regionOf?.of, "region", "regionOf.of", ["regionOf", "of"]);
      break;
    case "regionHatch":
      // Every regionHatch input is a region reference — `from` is the legacy
      // spelling of `hullOf`, and the region is what gets filled.
      add(node.from, "region", "from", ["from"]);
      add(node.hullOf, "region", "hullOf", ["hullOf"]);
      add(node.regionOf?.of, "region", "regionOf.of", ["regionOf", "of"]);
      break;
    case "repeat":
      add(node.thread, "geometry", "thread", ["thread"]);
      break;
  }
  return refs;
}

/** All ids a node list declares, including inside repeat bodies. */
function collectIds(nodes: PatchNode[], into: Set<string>): void {
  for (const n of nodes) {
    into.add(n.id);
    if (n.op === "repeat") collectIds(n.body, into);
  }
}

/**
 * Walk nodes in document order, adding a zod issue for every reference that
 * does not resolve to an already-defined node. Both node ids are always named:
 * the referrer and the target.
 */
function checkReferenceOrder(
  nodes: PatchNode[],
  defined: Set<string>,
  everything: Set<string>,
  basePath: (string | number)[],
  ctx: z.RefinementCtx,
): void {
  nodes.forEach((node, i) => {
    for (const r of nodeReferences(node)) {
      if (defined.has(r.id)) continue;
      const path = [...basePath, i, ...r.path];
      const what = r.kind === "region" ? "the region of" : "";
      const subject = what ? `${what} "${r.id}"` : `"${r.id}"`;
      if (r.id === node.id) {
        ctx.addIssue({
          code: "custom", path,
          message: `node "${node.id}" references itself (\`${r.label}\` → "${node.id}") — references must be acyclic`,
        });
      } else if (everything.has(r.id)) {
        ctx.addIssue({
          code: "custom", path,
          message:
            `node "${node.id}" references ${subject} via \`${r.label}\`, but "${r.id}" is declared later in the document — ` +
            `document order is evaluation order, so "${node.id}" may only reference nodes defined before it. ` +
            `Move "${r.id}" above "${node.id}".`,
        });
      } else {
        ctx.addIssue({
          code: "custom", path,
          message: `node "${node.id}" references unknown node "${r.id}" via \`${r.label}\` (typo, or never declared?)`,
        });
      }
    }
    defined.add(node.id);
    if (node.op === "repeat") {
      checkReferenceOrder(node.body, defined, everything, [...basePath, i, "body"], ctx);
    }
  });
}

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
}).strict().superRefine((doc, ctx) => {
  const everything = new Set<string>();
  collectIds(doc.nodes, everything);
  checkReferenceOrder(doc.nodes, new Set<string>(), everything, ["nodes"], ctx);
  doc.out.forEach((id, i) => {
    if (!everything.has(id)) {
      ctx.addIssue({ code: "custom", path: ["out", i], message: `out references unknown node "${id}"` });
    }
  });
});

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
  /** Per-pen stroke width in mm (from the pen node). Absent = global width. */
  width?: number;
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

/**
 * Rings for a node's region reference, reading source geometry out of `env`.
 * `hullOf` and `regionOf { kind: "hull" }` resolve through the same code (see
 * `resolveRegionRings`), so the alias cannot drift.
 */
function regionRings(node: RegionRef, env: Env, ctx: string): Polyline[] {
  return resolveRegionRings(node, (id) =>
    asGeometry(ref(env, id, `${ctx} region source ${id}`), `${ctx} region source ${id}`),
  );
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
    case "directional":
      env.set(node.id, directionalField(asScalar(ref(env, node.from, `directional(${node.from})`), `directional(${node.from})`), node.dir));
      break;
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
    case "resample":
      env.set(node.id, resampleGeometry(asGeometry(ref(env, node.from, `resample(${node.from})`), `resample(${node.from})`), node.step));
      break;
    case "transform":
      env.set(node.id, transformGeometry(asGeometry(ref(env, node.from, `transform(${node.from})`), `transform(${node.from})`), { translate: node.translate, rotateDeg: node.rotateDeg, scale: node.scale }));
      break;
    case "clip": {
      const geom = asGeometry(ref(env, node.from, `clip(${node.from})`), `clip(${node.from})`);
      const mode = node.mode ?? "inside";
      if (node.regionOf || mode === "outside") {
        // Derived regions are not convex in general (rounded rects, offset
        // silhouettes, several blobs with holes), and "outside" has no convex
        // form at all — both go through even-odd ring clipping.
        env.set(node.id, clipGeometryToRings(geom, regionRings(node, env, `clip "${node.id}"`), mode));
      } else {
        // The v1 path, untouched: convex half-plane clipping against the hull.
        const region = node.polygon
          ? node.polygon.map(([x, y]) => ({ x, y }))
          : asGeometry(ref(env, node.hullOf!, `clip by ${node.hullOf}`), `clip by ${node.hullOf}`).flat();
        env.set(node.id, clipGeometry(geom, region));
      }
      break;
    }
    case "emphasis": {
      const geom = asGeometry(ref(env, node.from, `emphasis(${node.from})`), `emphasis(${node.from})`);
      const rings = regionRings(node, env, `emphasis "${node.id}"`);
      env.set(node.id, emphasisMask(geom, rings, node.weight, node.mode ?? "inside"));
      break;
    }
    case "regionHatch": {
      // Same region resolution as clip / emphasis, so a rounded-rect bbox or an
      // offset silhouette hatches exactly the area it would have clipped. The
      // fill is even-odd over the whole ring set, so holes stay empty.
      const rings = regionRings(hatchRegionRef(node), env, `regionHatch "${node.id}"`);
      env.set(node.id, hatchRegion(rings, node.angleDeg, node.pitch));
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
  return evalPatchDoc(parsePatchDoc(input), opts);
}

/** Evaluate an already-parsed, validated document — shared by evalPatch and the
 * iteration sweep so a scrub doesn't re-validate the doc on every frame. */
function evalPatchDoc(doc: PatchDoc, opts: EvalOptions): EvalResult {
  const env: Env = new Map();
  for (const node of doc.nodes) evalNode(node, env, doc.page, doc.camera, opts.resolveImage);

  const layers: PatchLayer[] = doc.out.map((id) => {
    const node = findPen(doc.nodes, id);
    const geom = asGeometry(ref(env, id, `out "${id}"`), `out "${id}"`);
    return { id, color: node?.color, name: node?.name ?? id, width: node?.width, geometry: geom };
  });
  return { layers, page: doc.page };
}

/** One frame of an iteration sweep: the document evaluated with the scrubbed
 * repeat's `times` set to `iter`. */
export interface IterationFrame {
  /** 1-based iteration count this frame corresponds to (repeat.times = iter). */
  iter: number;
  result: EvalResult;
}

export interface IterationSweep {
  /** id of the repeat node that was scrubbed (the first top-level repeat). */
  repeatId: string;
  /** the repeat's declared count — the number of frames in a full (stride 1) sweep. */
  times: number;
  /** ids of any other top-level repeats, held at full count in every frame. */
  otherRepeatIds: string[];
  frames: IterationFrame[];
}

/**
 * Scrub a `repeat`: evaluate the document once per iteration count i = 1..N of
 * its first top-level repeat node, so a caller can render each frame and pick the
 * count where an open-ended generator "looks right" instead of guessing N upfront
 * and re-rendering (the concrete L2 gap flagged by the L3 research, vault-176t).
 *
 * Frame i is the document evaluated with the repeat's `times` set to i — exactly
 * what `repeat i { … }` produces, so it is the ground truth for choosing a count,
 * not an approximation. `times` is schema-capped at 64, so the full sweep is at
 * most 64 evaluations. Nested repeats and any later top-level repeats run at their
 * full declared count in every frame; only the first top-level repeat is swept.
 *
 * `stride` (>=1) samples every k-th frame to trim output; the final frame
 * (i = times) is always included so the full-count result is present.
 */
export function evalPatchIterations(
  input: unknown,
  opts: EvalOptions & { stride?: number } = {},
): IterationSweep {
  const doc = parsePatchDoc(input);
  const repeats = doc.nodes.filter((n): n is RepeatNode => n.op === "repeat");
  if (repeats.length === 0) {
    throw new Error("evalPatchIterations: document has no top-level repeat node to scrub");
  }
  const target = repeats[0];
  const stride = Math.max(1, Math.floor(opts.stride ?? 1));
  const frames: IterationFrame[] = [];
  for (let i = 1; i <= target.times; i++) {
    if (i % stride !== 0 && i !== target.times) continue;
    frames.push({ iter: i, result: evalPatchDoc(withRepeatTimes(doc, target.id, i), opts) });
  }
  return {
    repeatId: target.id,
    times: target.times,
    otherRepeatIds: repeats.slice(1).map((r) => r.id),
    frames,
  };
}

/** Shallow-clone a doc with one top-level repeat's `times` overridden. Nodes are
 * never mutated during evaluation, so a shallow copy of the changed node is safe. */
function withRepeatTimes(doc: PatchDoc, repeatId: string, times: number): PatchDoc {
  return {
    ...doc,
    nodes: doc.nodes.map((n) => (n.op === "repeat" && n.id === repeatId ? { ...n, times } : n)),
  };
}

function findPen(nodes: PatchNode[], id: string): { color?: string; name?: string; width?: number } | undefined {
  for (const n of nodes) {
    if (n.op === "pen" && n.id === id) return { color: n.color, name: n.name, width: n.width };
    if (n.op === "repeat") {
      const f = findPen(n.body, id);
      if (f) return f;
    }
  }
  return undefined;
}

/**
 * Convert evaluated patch layers into the exporter's per-pen group shape
 * (LayerGroupResult). A pen's width (mm) becomes a widthScale relative to the
 * page's global stroke width — buildLayeredSVGContent then emits a per-group
 * `stroke-width`. Layers without a width get no widthScale key, so the
 * emitted SVG stays byte-identical to the pre-width output.
 */
export function patchLayersToGroups(layers: PatchLayer[], page: PatchDoc["page"]): LayerGroupResult[] {
  return layers.map((l) => ({
    id: l.id,
    name: l.name,
    color: l.color,
    ...(l.width !== undefined ? { widthScale: l.width / page.strokeWidthMm } : {}),
    svgPaths: polylinesToSVGPaths(l.geometry),
  }));
}
