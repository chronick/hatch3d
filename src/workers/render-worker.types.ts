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
}

export interface RenderResult {
  type: "render-result";
  id: number;
  svgPaths: string[];
  meshPaths: string[];
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
