/**
 * WASM pipeline wrapper for hatch3d.
 *
 * Serializes LayerConfig[] into a flat Float64Array, calls the Rust WASM
 * generate_all_layers, and deserializes the output into THREE.Vector3[][].
 */

import * as THREE from "three";
import type { LayerConfig } from "./compositions/types";

// ── Surface key → numeric ID mapping (must match surfaces.rs) ──

const SURFACE_IDS: Record<string, number> = {
  twistedRibbon: 0,
  hyperboloid: 1,
  canopy: 2,
  torus: 3,
  conoid: 4,
};

// ── Hatch family → numeric ID mapping (must match hatch.rs) ──

const FAMILY_IDS: Record<string, number> = {
  u: 0,
  v: 1,
  diagonal: 2,
  rings: 3,
  hex: 4,
  crosshatch: 5,
  spiral: 6,
  wave: 7,
};

// ── WASM module types ──

interface WasmModule {
  default: (input?: unknown) => Promise<void>;
  generate_all_layers: (input: Float64Array) => Float64Array;
}

let wasmModule: WasmModule | null = null;
let wasmInitPromise: Promise<void> | null = null;
let wasmFailed = false;

/**
 * Async init — call once at startup. Safe to call multiple times.
 */
export async function ensureWasm(): Promise<void> {
  if (wasmModule) return;
  if (wasmFailed) return;
  if (wasmInitPromise) return wasmInitPromise;

  wasmInitPromise = (async () => {
    try {
      const t0 = performance.now();
      const mod = await import("./wasm/pkg/hatch3d_wasm.js") as unknown as WasmModule;
      await mod.default();
      wasmModule = mod;
      console.log(`[WASM] initialized in ${(performance.now() - t0).toFixed(1)}ms`);
    } catch (e) {
      console.warn("[WASM] init failed, falling back to JS pipeline:", e);
      wasmFailed = true;
    }
  })();

  return wasmInitPromise;
}

/**
 * Sync check — true if WASM is initialized and ready.
 */
export function isWasmReady(): boolean {
  return wasmModule !== null;
}

// ── Fields per layer in the serialization protocol ──

const FIELDS_PER_LAYER = 23;

/**
 * Check if a layer can be handled by WASM (supported surface, no densityFn).
 */
export function isLayerWasmCompatible(layer: LayerConfig): boolean {
  if (!(layer.surface in SURFACE_IDS)) return false;
  if (layer.hatch.densityFn) return false;
  return true;
}

/**
 * Serialize LayerConfig[] into a flat Float64Array for WASM.
 *
 * `fallbackParams` is used when a layer doesn't specify its own params.
 * The params are mapped to a 4-element array based on the surface's
 * default param order.
 */
export function serializeLayers(
  layers: LayerConfig[],
  fallbackParams: Record<string, number>,
  surfaceDefaults: Record<string, Record<string, number>>,
): Float64Array {
  const data = new Float64Array(1 + layers.length * FIELDS_PER_LAYER);
  data[0] = layers.length;

  for (let i = 0; i < layers.length; i++) {
    const layer = layers[i];
    const offset = 1 + i * FIELDS_PER_LAYER;
    const surfaceId = SURFACE_IDS[layer.surface] ?? 0;
    const params = layer.params || fallbackParams;
    const defaults = surfaceDefaults[layer.surface] || {};
    const hatch = layer.hatch;

    // Map named params to positional array [param0..param3]
    const paramKeys = Object.keys(defaults);
    const p0 = params[paramKeys[0]] ?? defaults[paramKeys[0]] ?? 0;
    const p1 = params[paramKeys[1]] ?? defaults[paramKeys[1]] ?? 0;
    const p2 = params[paramKeys[2]] ?? defaults[paramKeys[2]] ?? 0;
    const p3 = params[paramKeys[3]] ?? defaults[paramKeys[3]] ?? 0;

    data[offset + 0] = surfaceId;
    data[offset + 1] = p0;
    data[offset + 2] = p1;
    data[offset + 3] = p2;
    data[offset + 4] = p3;
    data[offset + 5] = FAMILY_IDS[hatch.family || "u"] ?? 0;
    data[offset + 6] = hatch.count ?? 30;
    data[offset + 7] = hatch.samples ?? 60;
    data[offset + 8] = hatch.uRange?.[0] ?? 0;
    data[offset + 9] = hatch.uRange?.[1] ?? 1;
    data[offset + 10] = hatch.vRange?.[0] ?? 0;
    data[offset + 11] = hatch.vRange?.[1] ?? 1;
    data[offset + 12] = hatch.angle ?? 0;
    data[offset + 13] = hatch.waveAmplitude ?? 0.05;
    data[offset + 14] = hatch.waveFrequency ?? 6;
    data[offset + 15] = hatch.noiseAmplitude ?? 0;
    data[offset + 16] = hatch.noiseFrequency ?? 0;
    data[offset + 17] = hatch.dashLength ?? 0;
    data[offset + 18] = hatch.gapLength ?? 0;
    data[offset + 19] = hatch.dashRandom ?? 0;
    data[offset + 20] = layer.transform?.x ?? 0;
    data[offset + 21] = layer.transform?.y ?? 0;
    data[offset + 22] = layer.transform?.z ?? 0;
  }

  return data;
}

/**
 * Deserialize WASM output into per-layer arrays of THREE.Vector3[][].
 *
 * Returns one array per layer, where each element is the polylines for that layer.
 */
export function deserializePolylines(data: Float64Array): THREE.Vector3[][][] {
  if (data.length < 1) return [];

  const numLayers = data[0];
  const result: THREE.Vector3[][][] = [];
  let pos = 1;

  for (let l = 0; l < numLayers; l++) {
    const numPolylines = data[pos++];
    const layerPolylines: THREE.Vector3[][] = [];

    for (let p = 0; p < numPolylines; p++) {
      const numPoints = data[pos++];
      const line: THREE.Vector3[] = [];
      for (let i = 0; i < numPoints; i++) {
        const x = data[pos++];
        const y = data[pos++];
        const z = data[pos++];
        line.push(new THREE.Vector3(x, y, z));
      }
      layerPolylines.push(line);
    }

    result.push(layerPolylines);
  }

  return result;
}

/**
 * Generate all layers via WASM in a single call.
 *
 * Returns per-layer THREE.Vector3[][] arrays, or null if WASM is unavailable
 * or any layer is incompatible.
 */
export function generateLayersWasm(
  layers: LayerConfig[],
  fallbackParams: Record<string, number>,
  surfaceDefaults: Record<string, Record<string, number>>,
): THREE.Vector3[][][] | null {
  if (!wasmModule) return null;
  if (layers.length === 0) return [];

  // Check all layers are compatible
  for (const layer of layers) {
    if (!isLayerWasmCompatible(layer)) {
      console.log(`[WASM] fallback to JS — incompatible layer (surface: ${layer.surface})`);
      return null;
    }
  }

  const input = serializeLayers(layers, fallbackParams, surfaceDefaults);
  const output = wasmModule.generate_all_layers(input);
  return deserializePolylines(output);
}
