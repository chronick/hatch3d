export interface CameraParams {
  theta: number;
  phi: number;
  dist: number;
  ortho: boolean;
  panX: number;
  panY: number;
  width: number;
  height: number;
}

export interface RenderRequest {
  type: "render";
  id: number;
  compositionKey: string;
  is2d: boolean;
  width: number;
  height: number;
  resolvedValues: Record<string, unknown>;
  surfaceKey: string;
  surfaceParams: Record<string, number>;
  hatchParams: {
    family: string;
    count: number;
    samples: number;
    angle: number;
  };
  currentHatchGroups: Record<
    string,
    { family: string; count: number; samples: number; angle: number }
  >;
  camera: CameraParams;
  useOcclusion: boolean;
  depthRes: number;
  depthBias: number;
  exportLayout: { contentW: number; contentH: number; scale: number };
  showMesh: boolean;
  densityFilterEnabled: boolean;
  densityMax: number;
  densityCellSize: number;
  /**
   * Global seed for stochastic hatch post-processing (noise displacement,
   * dash randomness, density filtering). Injected into each layer's
   * HatchParams unless the layer sets its own. Same request → same SVG.
   * Default 0.
   */
  seed?: number;
  /**
   * Depth-emphasis stroke widths (3D only): strokes nearer than the camera
   * target render bolder, farther ones finer — Krbn's depthEmphasis cue.
   * Widths are quantized into bands, each emitted as its own layer group
   * (pen layer) with a `widthScale`. Default off.
   */
  depthWidthEnabled?: boolean;
  /**
   * What to do with occluded line runs (3D + occlusion only):
   * "drop" (default) discards them; "ghost" emits them as a separate
   * faint dashed layer group — the draughtsman's x-ray convention.
   */
  hiddenMode?: "drop" | "ghost";
  /**
   * For layered compositions only — replaces the composition's static
   * `layers` array with a user-edited list (visibility/order/colors/etc).
   * Worker structurally clones it like any other request field.
   */
  layeredLayersOverride?: import("../compositions/types").LayeredLayer[];
}

/**
 * One pen-layer's worth of SVG paths from a layered composition.
 * For non-layered compositions this is unused.
 */
export interface LayerGroupResult {
  /** Stable id (composition id) for downstream tooling. */
  id: string;
  /** Human-readable name (becomes the <g id> in exported SVG). */
  name?: string;
  /** Stroke color for this pen layer (CSS color string). */
  color?: string;
  /**
   * Stroke-width multiplier for this group, relative to the global stroke
   * width (depth-emphasis bands, ghosted hidden lines). Absent = 1.
   */
  widthScale?: number;
  /**
   * Dash pattern in screen-space pixels (e.g. [6, 4]). Consumers scale it
   * to their coordinate space alongside stroke width. Absent = solid.
   */
  dash?: [number, number];
  /** Group opacity (ghosted hidden lines). Absent = 1. */
  opacity?: number;
  /** SVG path `d` strings for this layer only. */
  svgPaths: string[];
}

export interface RenderResult {
  type: "render-result";
  id: number;
  svgPaths: string[];
  meshPaths: string[];
  /**
   * Per-layer breakdown for layered compositions.
   * Empty for 2D / 3D compositions; populated for `type: "layered"`.
   * `svgPaths` (above) remains the flattened union for back-compat.
   */
  layerGroups?: LayerGroupResult[];
  stats: { lines: number; verts: number; paths: number };
  durationMs: number;
}

export interface WorkerReady {
  type: "ready";
  wasmAvailable: boolean;
}

export interface RenderError {
  type: "render-error";
  id: number;
  error: string;
}

export type WorkerMessage = RenderResult | WorkerReady | RenderError;
