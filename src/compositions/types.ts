import type * as THREE from "three";
import type { HatchParams } from "../hatch";

// ── Control type system ──

export type MacroFn = "linear" | "log" | "exp" | "sqrt";

export interface MacroTarget {
  param: string;
  fn: MacroFn;
  strength: number;
}

export interface MacroDef {
  label: string;
  default: number;
  targets: MacroTarget[];
}

export interface SliderControl {
  type: "slider";
  label: string;
  default: number;
  min: number;
  max: number;
  step?: number;
  group: string;
}

export interface ToggleControl {
  type: "toggle";
  label: string;
  default: boolean;
  group: string;
}

export interface SelectControl {
  type: "select";
  label: string;
  default: string;
  options: { label: string; value: string }[];
  group: string;
}

export interface XYControl {
  type: "xy";
  label: string;
  default: [number, number];
  min: number;
  max: number;
  group: string;
}

export interface ImageSource {
  /** Row-major brightness grid, values in [0,1]. */
  brightness: Float32Array;
  width: number;
  height: number;
  /** Optional original filename for display. */
  name?: string;
}

export interface ImageControl {
  type: "image";
  label: string;
  /** Target grid width in samples (height derived from aspect ratio). */
  sampleSize?: number;
  group: string;
}

export type ControlDef = SliderControl | ToggleControl | SelectControl | XYControl | ImageControl;

// ── Layer / Composition types ──

export interface LayerConfig {
  surface: string;
  params?: Record<string, number>;
  hatch: HatchParams;
  transform?: { x?: number; y?: number; z?: number };
  group?: string;
}

export interface CompositionInput {
  surface: string;
  surfaceParams: Record<string, number>;
  hatchParams: HatchParams;
  values: Record<string, unknown>;
}

// ── 2D Composition types ──

export interface Composition2DInput {
  width: number;
  height: number;
  values: Record<string, unknown>;
}

// ── Metadata & Preset types ──

export interface CompositionPreset {
  name: string;
  description?: string;
  values: {
    controls?: Record<string, unknown>;
    macros?: Record<string, number>;
    hatchGroups?: Record<string, unknown>;
    /** Layer stack payload — only populated for layered compositions. */
    layers?: LayeredLayer[];
  };
}

export interface CompositionMetadata {
  id: string;
  name: string;
  description?: string;
  tags?: string[];
  category: "2d" | "3d" | "layered";
  author?: string;
  thumbnail?: string;
  suggestedPresets?: Record<string, CompositionPreset>;
  /** Optional macro defs (only relevant for 2D/3D — declared at base for ergonomic union access). */
  macros?: Record<string, MacroDef>;
  /** Optional control defs (only relevant for 2D/3D — declared at base for ergonomic union access). */
  controls?: Record<string, ControlDef>;
  /**
   * Controls how aggressively the composition re-renders on parameter changes.
   * - "immediate": render on every change, no debounce (default — fast compositions)
   * - "debounced": 300ms debounce before rendering
   * - "manual": render only on explicit user click (expensive simulations)
   */
  renderMode?: "immediate" | "debounced" | "manual";
}

// ── Enhanced composition definitions with metadata ──

export interface Composition3DDefinition extends CompositionMetadata {
  type?: "3d";
  hatchGroups?: string[];
  layers: (input: CompositionInput) => LayerConfig[];
  /**
   * Optional unified-mesh override for the HLR depth buffer.
   *
   * By default the render pipeline accumulates one BufferGeometry per
   * layer (via buildSurfaceMesh) and feeds the concatenated list to
   * renderDepthBuffer. For compositions that emit many small layers
   * meeting at shared edges (heightfield terrains, voxel structures),
   * the independent per-face meshes leave 1-2 pixel cracks at those
   * edges in the rasterized depth buffer — back-face hatches leak
   * through the cracks.
   *
   * When this callback is present, the pipeline uses its single
   * returned BufferGeometry for the depth buffer instead of combining
   * per-layer meshes. Per-layer meshes still get built for mesh-
   * overlay display; hatching still runs per-layer through the UV
   * path. Return null to fall back to the default per-layer accumulation.
   */
  buildDepthMesh?: (input: CompositionInput) => THREE.BufferGeometry | null;
}

export interface Composition2DDefinition extends CompositionMetadata {
  type: "2d";
  generate: (input: Composition2DInput) => { x: number; y: number }[][];
  /** Optional WASM-accelerated generator. Returns null if WASM unavailable. */
  wasmGenerate?: (input: Composition2DInput) => { x: number; y: number }[][] | null;
}

// ── Layered composition (multi-composition umbrella) ──

export type LayerBlendMode = "over" | "masked";

export interface LayeredLayer {
  /**
   * Stable per-instance id, assigned on add or on first read of legacy
   * data; survives reorder + serialization.
   */
  __id?: string;
  /** id of an inner composition to render. Resolved at render time via the registry. */
  composition: string;
  /** Override values for the inner composition's controls/macros. */
  paramOverrides?: Record<string, unknown>;
  /**
   * 'over' = additive stacking (default).
   * 'masked' = clip this layer to the bounding box of `maskBy` layer.
   * v1 supports simple bbox masking only — no cross-layer occlusion.
   */
  blendMode?: LayerBlendMode;
  /** Index of layer in the stack to clip by (only used when blendMode === 'masked'). */
  maskBy?: number;
  /** SVG stroke color for this layer's <g> group. Maps to a pen layer on the plotter. */
  color?: string;
  /** Optional human-readable name → becomes <g id="..."> in exported SVG. */
  name?: string;
  /** UI-controlled visibility flag — when false, layer is skipped. Default true. */
  visible?: boolean;
}

export interface LayeredCompositionDefinition extends CompositionMetadata {
  type: "layered";
  layers: LayeredLayer[];
}

export type CompositionDefinition =
  | Composition3DDefinition
  | Composition2DDefinition
  | LayeredCompositionDefinition;

// ── Legacy compat aliases ──

export type Composition = Composition3DDefinition;
export type Composition2D = Composition2DDefinition;
export type AnyComposition = CompositionDefinition;

export function is2DComposition(comp: CompositionDefinition): comp is Composition2DDefinition {
  return (comp as Composition2DDefinition).type === "2d";
}

export function isLayeredComposition(
  comp: CompositionDefinition,
): comp is LayeredCompositionDefinition {
  return (comp as LayeredCompositionDefinition).type === "layered";
}

// ── WASM adapter interface (future use) ──

/** Adapter for WASM-backed compositions (future use) */
export interface CompositionWasmAdapter {
  computeLayers(inputBuffer: Float64Array): Float64Array;
  inputLayout: { name: string; offset: number; type: "f64" | "i32" }[];
  outputLayout: { name: string; offset: number; type: "f64" | "i32" }[];
}
