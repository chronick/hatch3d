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
