/**
 * Thin Web Worker shell for the render pipeline.
 *
 * Imports the pure pipeline function, compositions registry, and WASM init.
 * Handles messages and posts results back to the main thread.
 */

// Side-effect import: triggers composition auto-discovery via import.meta.glob
import "../compositions/index";

import { compositionRegistry } from "../compositions";
import { ensureWasm, isWasmReady } from "../wasm-pipeline";
import { runPipeline } from "./render-pipeline";
import type { RenderRequest, WorkerReady, RenderError } from "./render-worker.types";

console.log("[render-worker] loading...");

async function init() {
  try {
    await ensureWasm();
  } catch (e) {
    console.warn("[render-worker] WASM init failed:", e);
  }
  console.log(
    `[render-worker] ready — ${compositionRegistry.size} compositions, WASM: ${isWasmReady()}`
  );
  const ready: WorkerReady = { type: "ready", wasmAvailable: isWasmReady() };
  self.postMessage(ready);
}

self.onmessage = (e: MessageEvent<RenderRequest>) => {
  if (e.data.type === "render") {
    const req = e.data;
    console.log(
      `[render-worker] render #${req.id}: ${req.compositionKey} (${req.is2d ? "2d" : "3d"})`
    );
    try {
      const result = runPipeline(req);
      console.log(
        `[render-worker] done #${req.id}: ${result.stats.paths} paths in ${result.durationMs.toFixed(0)}ms`
      );
      self.postMessage(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const stack = err instanceof Error ? err.stack : undefined;
      console.error(`[render-worker] error #${req.id}:`, message, stack);
      const error: RenderError = {
        type: "render-error",
        id: req.id,
        error: message,
      };
      self.postMessage(error);
    }
  }
};

init();
