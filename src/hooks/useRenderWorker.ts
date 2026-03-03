import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import type {
  RenderRequest,
  WorkerMessage,
  CameraParams,
} from "../workers/render-worker.types";

export interface UseRenderWorkerInput {
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
  /** If true, only render when triggerRender() is called. */
  manualRefresh: boolean;
}

export interface UseRenderWorkerOutput {
  svgPaths: string[];
  meshPaths: string[];
  stats: { lines: number; verts: number; paths: number };
  isRendering: boolean;
  isStale: boolean;
  renderTimeMs: number;
  triggerRender: () => void;
}

const DEBOUNCE_MS = 300;

export function useRenderWorker(
  input: UseRenderWorkerInput
): UseRenderWorkerOutput {
  // Version counter: increments every time input changes
  const versionRef = useRef(0);
  // Version that produced the current displayed result
  const [resultVersion, setResultVersion] = useState(0);

  const [result, setResult] = useState<{
    svgPaths: string[];
    meshPaths: string[];
    stats: { lines: number; verts: number; paths: number };
    renderTimeMs: number;
  }>({
    svgPaths: [],
    meshPaths: [],
    stats: { lines: 0, verts: 0, paths: 0 },
    renderTimeMs: 0,
  });

  const [pendingCount, setPendingCount] = useState(0);

  const workerRef = useRef<Worker | null>(null);
  const pendingIdRef = useRef(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const workerReadyRef = useRef(false);
  const queuedRequestRef = useRef<RenderRequest | null>(null);

  // Increment version on every input change
  const inputVersion = useMemo(() => {
    return ++versionRef.current;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    input.compositionKey,
    input.is2d,
    input.width,
    input.height,
    input.resolvedValues,
    input.surfaceKey,
    input.surfaceParams,
    input.hatchParams,
    input.currentHatchGroups,
    input.camera,
    input.useOcclusion,
    input.depthRes,
    input.depthBias,
    input.exportLayout,
    input.showMesh,
    input.densityFilterEnabled,
    input.densityMax,
    input.densityCellSize,
    input.manualRefresh,
  ]);

  // Derive staleness: input has changed since last completed render
  const isStale = inputVersion !== resultVersion;
  const isRendering = pendingCount > 0;

  // Create worker on mount, terminate on unmount
  useEffect(() => {
    const worker = new Worker(
      new URL("../workers/render-worker.ts", import.meta.url),
      { type: "module" }
    );

    worker.onmessage = (e: MessageEvent<WorkerMessage>) => {
      const msg = e.data;
      if (msg.type === "ready") {
        console.log("[useRenderWorker] worker ready, WASM:", msg.wasmAvailable);
        workerReadyRef.current = true;
        if (queuedRequestRef.current) {
          console.log("[useRenderWorker] sending queued request");
          worker.postMessage(queuedRequestRef.current);
          queuedRequestRef.current = null;
        }
        return;
      }

      if (msg.type === "render-error") {
        console.error("[useRenderWorker] render error:", msg.error);
        setPendingCount(0);
        return;
      }

      if (msg.type === "render-result") {
        // Discard stale results
        if (msg.id < pendingIdRef.current) return;

        setResult({
          svgPaths: msg.svgPaths,
          meshPaths: msg.meshPaths,
          stats: msg.stats,
          renderTimeMs: msg.durationMs,
        });
        setResultVersion(msg.id);
        setPendingCount(0);
      }
    };

    worker.onerror = (e) => {
      console.error("[useRenderWorker] worker error:", e.message, e);
      setPendingCount(0);
    };

    workerRef.current = worker;
    return () => {
      worker.terminate();
      workerRef.current = null;
      workerReadyRef.current = false;
    };
  }, []);

  // Keep a ref to latest input for dispatch
  const inputRef = useRef(input);
  useEffect(() => {
    inputRef.current = input;
  });

  const dispatchRender = useCallback((version: number) => {
    const worker = workerRef.current;
    if (!worker) return;

    const currentInput = inputRef.current;
    pendingIdRef.current = version;
    setPendingCount((c) => c + 1);

    const request: RenderRequest = {
      type: "render",
      id: version,
      compositionKey: currentInput.compositionKey,
      is2d: currentInput.is2d,
      width: currentInput.width,
      height: currentInput.height,
      resolvedValues: currentInput.resolvedValues,
      surfaceKey: currentInput.surfaceKey,
      surfaceParams: currentInput.surfaceParams,
      hatchParams: currentInput.hatchParams,
      currentHatchGroups: currentInput.currentHatchGroups,
      camera: currentInput.camera,
      useOcclusion: currentInput.useOcclusion,
      depthRes: currentInput.depthRes,
      depthBias: currentInput.depthBias,
      exportLayout: currentInput.exportLayout,
      showMesh: currentInput.showMesh,
      densityFilterEnabled: currentInput.densityFilterEnabled,
      densityMax: currentInput.densityMax,
      densityCellSize: currentInput.densityCellSize,
    };

    if (!workerReadyRef.current) {
      queuedRequestRef.current = request;
      return;
    }

    worker.postMessage(request);
  }, []);

  // Auto-refresh: debounced dispatch on input change (skip if manualRefresh)
  useEffect(() => {
    if (input.manualRefresh) return;

    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      dispatchRender(versionRef.current);
    }, DEBOUNCE_MS);

    return () => clearTimeout(debounceRef.current);
  }, [inputVersion, input.manualRefresh, dispatchRender]);

  // Fire an initial render on mount
  const initialRef = useRef(true);
  useEffect(() => {
    if (initialRef.current) {
      initialRef.current = false;
      dispatchRender(versionRef.current);
    }
  }, [dispatchRender]);

  // Manual trigger — callable by the "Render" button
  const triggerRender = useCallback(() => {
    clearTimeout(debounceRef.current);
    dispatchRender(versionRef.current);
  }, [dispatchRender]);

  return {
    svgPaths: result.svgPaths,
    meshPaths: result.meshPaths,
    stats: result.stats,
    isRendering,
    isStale,
    renderTimeMs: result.renderTimeMs,
    triggerRender,
  };
}
