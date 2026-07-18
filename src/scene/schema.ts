/**
 * Scene IR — declarative, agent-authorable plotter scene documents.
 *
 * A scene document is a strict, diffable JSON tree that an agent authors, the
 * compiler (src/scene/compile.ts) turns into polylines/SVG via the existing
 * hatch3d pipeline, and the stats CLI measures. It is the keystone artifact of
 * the AI-native workflow: named compositions become vocabulary *words*, scene
 * docs are the *sentences* (see the vault design pod active/plotter-art-workflow
 * and hatch3d docs/scene-ir.md).
 *
 * v1 scope: a `group` root containing `layer` nodes, each binding a pen and
 * holding exactly one `generator` leaf (any registered composition by id +
 * param/macro/hatch overrides). This is exactly the surface needed to represent
 * a LayeredComposition, so it compiles down the proven layered pipeline for
 * byte-identical output. Operator nodes (transform, clip, mask, region-hatch,
 * field-distort, image-luminance) lower to the patch engine's operators
 * (src/scene/to-patch.ts), so a scene using them renders exactly like the
 * equivalent hand-authored patch. Stable node ids make mutations legible
 * (design principle #2).
 */

import { z } from "zod";

// ── Leaf: generator ──

export const GeneratorNodeSchema = z
  .object({
    type: z.literal("generator"),
    id: z.string().min(1),
    /** Registered composition id (validated against the registry at compile time). */
    composition: z.string().min(1),
    /** Control overrides for the inner composition. */
    params: z.record(z.string(), z.unknown()).optional(),
    /** Macro slider overrides (raw 0..1 values). */
    macros: z.record(z.string(), z.number()).optional(),
    /** Per-hatch-group config overrides. */
    hatchGroups: z.record(z.string(), z.unknown()).optional(),
    /** RNG seed — threaded into the composition's `seed` param for reproducibility. */
    seed: z.union([z.string(), z.number()]).optional(),
  })
  .strict();

// ── Operator nodes (declared for forward-compat; v1 compiler defers them) ──

const OperatorBase = {
  id: z.string().min(1),
};

export const TransformNodeSchema = z
  .object({
    type: z.literal("op:transform"),
    ...OperatorBase,
    translate: z.tuple([z.number(), z.number()]).optional(),
    rotateDeg: z.number().optional(),
    scale: z.union([z.number(), z.tuple([z.number(), z.number()])]).optional(),
    child: z.lazy((): z.ZodTypeAny => NodeSchema),
  })
  .strict();

export const ClipNodeSchema = z
  .object({
    type: z.literal("op:clip"),
    ...OperatorBase,
    /** Clip region: an explicit polygon or the convex hull of another node's output. */
    region: z.union([
      z.object({ polygon: z.array(z.tuple([z.number(), z.number()])) }).strict(),
      z.object({ hullOf: z.string() }).strict(),
    ]),
    child: z.lazy((): z.ZodTypeAny => NodeSchema),
  })
  .strict();

export const MaskNodeSchema = z
  .object({
    type: z.literal("op:mask"),
    ...OperatorBase,
    /** Node id whose convex hull masks the child (the LayeredComposition "masked" blend). */
    maskBy: z.string().min(1),
    child: z.lazy((): z.ZodTypeAny => NodeSchema),
  })
  .strict();

export const RegionHatchNodeSchema = z
  .object({
    type: z.literal("op:region-hatch"),
    ...OperatorBase,
    region: z.union([
      z.object({ polygon: z.array(z.tuple([z.number(), z.number()])) }).strict(),
      z.object({ hullOf: z.string() }).strict(),
    ]),
    hatch: z.record(z.string(), z.unknown()),
  })
  .strict();

export const FieldDistortNodeSchema = z
  .object({
    type: z.literal("op:field-distort"),
    ...OperatorBase,
    field: z.enum(["simplex", "flow"]),
    scale: z.number(),
    amplitude: z.number(),
    child: z.lazy((): z.ZodTypeAny => NodeSchema),
  })
  .strict();

export const ImageLuminanceNodeSchema = z
  .object({
    type: z.literal("op:image-luminance"),
    ...OperatorBase,
    /** Image whose brightness drives the deflection; resolved by the caller's
     * ImageResolver (the CLI decodes a PNG; the browser passes an uploaded grid). */
    image: z.string().min(1),
    /** Peak displacement in canvas px at full brightness. */
    amplitude: z.number(),
    /** Displacement axis; default [0, 1] pushes scanlines downward. */
    dir: z.tuple([z.number(), z.number()]).optional(),
    /** Subdivide the child to this max step so coarse scanlines can bend
     * (distort only moves vertices). Default 5. */
    resampleStep: z.number().positive().optional(),
    /** Invert brightness (bright pushes less instead of more). */
    invert: z.boolean().optional(),
    /** The geometry to deflect — typically an op:region-hatch scanline fill. */
    child: z.lazy((): z.ZodTypeAny => NodeSchema),
  })
  .strict();

// ── Pen ──

export const PenSchema = z
  .object({
    color: z.string().optional(),
    /** Human-readable name → becomes <g id="..."> in exported SVG. */
    name: z.string().optional(),
    /**
     * Per-pen stroke width in mm. The exporter emits a per-layer
     * `stroke-width` on this pen's <g> via LayerGroupResult.widthScale
     * (= width / page.strokeWidthMm). Absent → the group inherits the global
     * width and the output is byte-identical to a widthless doc.
     */
    width: z.number().positive().optional(),
  })
  .strict();

// ── Layer (binds a pen; v1: holds exactly one generator, optionally masked) ──

export const LayerNodeSchema = z
  .object({
    type: z.literal("layer"),
    id: z.string().min(1),
    pen: PenSchema.optional(),
    visible: z.boolean().optional(),
    /** Blend against a sibling layer (maps to LayeredComposition blendMode). */
    blend: z.enum(["over", "masked"]).optional(),
    /** Sibling layer id to mask by when blend === "masked". */
    maskBy: z.string().optional(),
    children: z.array(z.lazy((): z.ZodTypeAny => NodeSchema)).min(1),
  })
  .strict();

// ── Group (nesting; transform cascade is v2) ──

export const GroupNodeSchema = z
  .object({
    type: z.literal("group"),
    id: z.string().min(1),
    children: z.array(z.lazy((): z.ZodTypeAny => NodeSchema)).min(1),
  })
  .strict();

// ── Node union ──

export const NodeSchema: z.ZodType = z.discriminatedUnion("type", [
  GroupNodeSchema,
  LayerNodeSchema,
  GeneratorNodeSchema,
  TransformNodeSchema,
  ClipNodeSchema,
  MaskNodeSchema,
  RegionHatchNodeSchema,
  FieldDistortNodeSchema,
  ImageLuminanceNodeSchema,
]);

// ── Page & camera ──

export const PageSchema = z
  .object({
    size: z.enum(["a3", "a4", "a5", "letter"]).default("a3"),
    orientation: z.enum(["landscape", "portrait"]).default("landscape"),
    marginMm: z.number().nonnegative().default(15),
    /** Canvas resolution the generators evaluate in (defaults 800×800). */
    widthPx: z.number().positive().optional(),
    heightPx: z.number().positive().optional(),
    strokeWidthMm: z.number().positive().optional(),
  })
  .strict();

export const CameraSchema = z
  .object({
    theta: z.number().optional(),
    phi: z.number().optional(),
    dist: z.number().optional(),
    ortho: z.boolean().optional(),
  })
  .strict();

// ── Document ──

export const SceneDocSchema = z
  .object({
    version: z.literal(1),
    id: z.string().min(1),
    page: PageSchema.prefault({}),
    /** Camera for 3D generators (ignored by 2D compositions). */
    camera: CameraSchema.optional(),
    /** Provenance: vault seed ids that inspired this doc (feeds preference/corpus). */
    seedRefs: z.array(z.string()).optional(),
    root: NodeSchema,
  })
  .strict();

// ── Explicit TS node types ──
//
// zod's recursive discriminated union erases node types behind `z.ZodType`, so
// we declare the tree explicitly for ergonomic consumption. The zod schema is
// the runtime validator; these interfaces are the compile-time shape. Keep them
// in sync with the schemas above.

export interface Pen {
  color?: string;
  name?: string;
  /** Stroke width in mm (positive). */
  width?: number;
}

export interface GeneratorNode {
  type: "generator";
  id: string;
  composition: string;
  params?: Record<string, unknown>;
  macros?: Record<string, number>;
  hatchGroups?: Record<string, unknown>;
  seed?: string | number;
}

export interface LayerNode {
  type: "layer";
  id: string;
  pen?: Pen;
  visible?: boolean;
  blend?: "over" | "masked";
  maskBy?: string;
  children: SceneNode[];
}

export interface GroupNode {
  type: "group";
  id: string;
  children: SceneNode[];
}

export interface TransformNode {
  type: "op:transform";
  id: string;
  translate?: [number, number];
  rotateDeg?: number;
  scale?: number | [number, number];
  child: SceneNode;
}

export interface ClipNode {
  type: "op:clip";
  id: string;
  region: { polygon: [number, number][] } | { hullOf: string };
  child: SceneNode;
}

export interface MaskNode {
  type: "op:mask";
  id: string;
  maskBy: string;
  child: SceneNode;
}

export interface RegionHatchNode {
  type: "op:region-hatch";
  id: string;
  region: { polygon: [number, number][] } | { hullOf: string };
  hatch: Record<string, unknown>;
}

export interface FieldDistortNode {
  type: "op:field-distort";
  id: string;
  field: "simplex" | "flow";
  scale: number;
  amplitude: number;
  child: SceneNode;
}

export interface ImageLuminanceNode {
  type: "op:image-luminance";
  id: string;
  image: string;
  amplitude: number;
  dir?: [number, number];
  resampleStep?: number;
  invert?: boolean;
  child: SceneNode;
}

export type SceneNode =
  | GroupNode
  | LayerNode
  | GeneratorNode
  | TransformNode
  | ClipNode
  | MaskNode
  | RegionHatchNode
  | FieldDistortNode
  | ImageLuminanceNode;

export interface ResolvedPage {
  size: "a3" | "a4" | "a5" | "letter";
  orientation: "landscape" | "portrait";
  marginMm: number;
  widthPx?: number;
  heightPx?: number;
  strokeWidthMm?: number;
}

export interface SceneDoc {
  version: 1;
  id: string;
  page: ResolvedPage;
  camera?: { theta?: number; phi?: number; dist?: number; ortho?: boolean };
  seedRefs?: string[];
  root: SceneNode;
}

/**
 * Parse and validate an unknown value as a SceneDoc. Throws a readable,
 * path-prefixed error on failure (valid-by-construction: the compiler never
 * sees a malformed doc).
 */
export function parseSceneDoc(input: unknown): SceneDoc {
  const result = SceneDocSchema.safeParse(input);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  • ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid scene document:\n${issues}`);
  }
  return result.data as SceneDoc;
}
