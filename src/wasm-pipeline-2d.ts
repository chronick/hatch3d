/**
 * WASM pipeline for 2D compositions.
 *
 * Per-composition serialize → call → deserialize helpers.
 * Reuses ensureWasm() / isWasmReady() from the existing wasm-pipeline.ts.
 *
 * ## 2D output protocol:
 * [num_polylines, num_pts_1, x, y, x, y, ..., num_pts_2, x, y, ...]
 */

import { isWasmReady } from "./wasm-pipeline";
import type { Composition2DInput } from "./compositions/types";

// ── WASM module type (extended with 2D entry points) ──

interface WasmModule2D {
  generate_reaction_diffusion: (input: Float64Array) => Float64Array;
  generate_flow_field: (input: Float64Array) => Float64Array;
  generate_ink_vortex: (input: Float64Array) => Float64Array;
  generate_voronoi: (input: Float64Array) => Float64Array;
  generate_grains_glitch_ca: (input: Float64Array) => Float64Array;
}

let wasmMod: WasmModule2D | null = null;

async function getWasmModule(): Promise<WasmModule2D | null> {
  if (wasmMod) return wasmMod;
  if (!isWasmReady()) return null;
  try {
    const mod = await import("./wasm/pkg/hatch3d_wasm.js");
    wasmMod = mod as unknown as WasmModule2D;
    return wasmMod;
  } catch {
    return null;
  }
}

// Eagerly try to cache after main WASM init
setTimeout(() => { getWasmModule(); }, 100);

function getWasmModuleSync(): WasmModule2D | null {
  return wasmMod;
}

// ── Shared 2D output deserializer ──

export function deserialize2DPolylines(
  data: Float64Array,
): { x: number; y: number }[][] {
  if (data.length < 1) return [];

  const numPolylines = data[0];
  const result: { x: number; y: number }[][] = [];
  let pos = 1;

  for (let p = 0; p < numPolylines; p++) {
    const numPoints = data[pos++];
    const line: { x: number; y: number }[] = [];
    for (let i = 0; i < numPoints; i++) {
      line.push({ x: data[pos++], y: data[pos++] });
    }
    result.push(line);
  }

  return result;
}

// ── Seed pattern ID mapping (reaction-diffusion) ──

const SEED_PATTERN_IDS: Record<string, number> = {
  center: 0,
  random: 1,
  ring: 2,
  line: 3,
};

// ── Arrangement ID mapping (ink-vortex) ──

const ARRANGEMENT_IDS: Record<string, number> = {
  random: 0,
  ring: 1,
  dipole: 2,
  karman: 3,
  galaxy: 4,
};

// ── Distribution ID mapping (voronoi) ──

const DISTRIBUTION_IDS: Record<string, number> = {
  random: 0,
  jitter: 1,
  clustered: 2,
};

// ── Per-composition WASM generators ──

export function wasmGenerateReactionDiffusion(
  input: Composition2DInput,
): { x: number; y: number }[][] | null {
  const mod = getWasmModuleSync();
  if (!mod) return null;

  const v = input.values;
  const data = new Float64Array([
    input.width,
    input.height,
    Math.round(v.gridResolution as number),
    Math.round(v.iterations as number),
    v.feedRate as number,
    v.killRate as number,
    v.diffusionA as number,
    v.diffusionB as number,
    v.contourThreshold as number,
    Math.round(v.contourLevels as number),
    SEED_PATTERN_IDS[v.seedPattern as string] ?? 0,
  ]);

  const result = mod.generate_reaction_diffusion(data);
  return deserialize2DPolylines(result);
}

// Morphology string → numeric index for WASM
const MORPHOLOGY_MAP: Record<string, number> = {
  warp: 0,
  ridged: 1,
  curl: 2,
  radial: 3,
  spiral: 4,
  uniform: 5,
};

export function wasmGenerateFlowField(
  input: Composition2DInput,
): { x: number; y: number }[][] | null {
  const mod = getWasmModuleSync();
  if (!mod) return null;

  const v = input.values;
  const data = new Float64Array([
    input.width,
    input.height,
    MORPHOLOGY_MAP[v.morphology as string] ?? 0,
    v.noiseScale as number,
    Math.round(v.noiseOctaves as number),
    v.warpAmount as number,
    v.noiseBlend as number,
    (v.uniformAngle as number) * (Math.PI / 180),
    v.separation as number,
    v.stepLength as number,
    Math.round(v.maxSteps as number),
    Math.round(v.minLength as number),
    v.margin as number,
  ]);

  const result = mod.generate_flow_field(data);
  return deserialize2DPolylines(result);
}

export function wasmGenerateInkVortex(
  input: Composition2DInput,
): { x: number; y: number }[][] | null {
  const mod = getWasmModuleSync();
  if (!mod) return null;

  const v = input.values;
  const data = new Float64Array([
    input.width,
    input.height,
    ARRANGEMENT_IDS[v.arrangement as string] ?? 0,
    Math.round(v.vortexCount as number),
    v.circulationRange as number,
    v.epsilon as number,
    v.separation as number,
    v.stepLength as number,
    Math.round(v.maxSteps as number),
    Math.round(v.minLength as number),
    v.curlNoise as number,
    v.noiseScale as number,
    v.margin as number,
  ]);

  const result = mod.generate_ink_vortex(data);
  return deserialize2DPolylines(result);
}

export function wasmGenerateVoronoi(
  input: Composition2DInput,
): { x: number; y: number }[][] | null {
  const mod = getWasmModuleSync();
  if (!mod) return null;

  const v = input.values;
  const data = new Float64Array([
    input.width,
    input.height,
    Math.round(v.pointCount as number),
    DISTRIBUTION_IDS[v.distribution as string] ?? 0,
    Math.round(v.relaxIterations as number),
    (v.fillCells as boolean) ? 1.0 : 0.0,
    Math.round(v.fillDensity as number),
    (v.variedAngles as boolean) ? 1.0 : 0.0,
    v.margin as number,
    0.0, // seed (reserved)
  ]);

  const result = mod.generate_voronoi(data);
  return deserialize2DPolylines(result);
}

// Neighbourhood mode string → numeric index for the grainsGlitchCA WASM.
const GRAINS_GLITCH_NEIGHBORHOOD_MAP: Record<string, number> = {
  moore1: 0,
  moore2: 1,
  dir16: 2,
  all: 3,
};

export function wasmGenerateGrainsGlitchCA(
  input: Composition2DInput,
): { x: number; y: number }[][] | null {
  const mod = getWasmModuleSync();
  if (!mod) return null;

  const v = input.values;
  const data = new Float64Array([
    input.width,
    input.height,
    Math.round(v.gridCols as number),
    Math.round(v.gridRows as number),
    Math.round(v.numStates as number),
    Math.round(v.caIterations as number),
    GRAINS_GLITCH_NEIGHBORHOOD_MAP[v.neighborhoodMode as string] ?? 3,
    v.ruleBlend as number,
    v.shiftStrength as number,
    v.tileHeight as number,
    v.tileWidth as number,
    v.hatchLineGap as number,
    (v.joinSegments as boolean) ? 1.0 : 0.0,
    v.joinTolerance as number,
    v.seedNoise as number,
    Math.round(v.seed as number),
  ]);

  const result = mod.generate_grains_glitch_ca(data);
  return deserialize2DPolylines(result);
}
