import { createNoise2D } from "simplex-noise";
import type { Composition2DDefinition } from "../../types";
import { wasmGenerateFlowField } from "../../../wasm-pipeline-2d";
import {
  traceStreamlines,
  fbm,
  curlNoise,
  type VelocityFn,
  type StreamlineParams,
} from "./streamline-tracer";

// ── Field generators ──

type FieldFn = (x: number, y: number) => { vx: number; vy: number };

/**
 * Domain-warped curl noise: warp the input coordinates through a secondary
 * noise field before computing curl. Produces folded, geological, organic
 * patterns impossible with point vortices.
 */
function makeDomainWarpField(
  noise2D: (x: number, y: number) => number,
  noiseScale: number,
  octaves: number,
  warpAmount: number,
): FieldFn {
  // Second noise instance for warp (offset seed coordinates)
  const warpOffsetX = 5.2;
  const warpOffsetY = 1.3;

  return (x: number, y: number) => {
    // Warp coordinates using noise
    const wx = x + fbm(noise2D, x * noiseScale + warpOffsetX, y * noiseScale + warpOffsetY, octaves) * warpAmount;
    const wy = y + fbm(noise2D, x * noiseScale + 9.7, y * noiseScale + 2.8, octaves) * warpAmount;
    return curlNoise(noise2D, wx, wy, noiseScale, octaves);
  };
}

/**
 * Ridged noise field: abs(noise) creates sharp convergence ridges.
 * Lines cluster along ridge edges — engraving-like emphasis lines.
 */
function makeRidgedField(
  noise2D: (x: number, y: number) => number,
  noiseScale: number,
  octaves: number,
): FieldFn {
  function ridgedFbm(x: number, y: number): number {
    let value = 0;
    let amp = 1;
    let freq = 1;
    let norm = 0;
    for (let o = 0; o < octaves; o++) {
      // Ridged: invert abs to create sharp peaks
      const n = 1 - Math.abs(noise2D(x * freq, y * freq));
      value += amp * n * n; // square for sharper ridges
      norm += amp;
      amp *= 0.5;
      freq *= 2;
    }
    return value / norm;
  }

  // Curl of ridged field
  return (x: number, y: number) => {
    const eps = 1;
    const sx = x * noiseScale;
    const sy = y * noiseScale;
    const ens = eps * noiseScale;
    const n = ridgedFbm(sx, sy + ens);
    const s = ridgedFbm(sx, sy - ens);
    const e = ridgedFbm(sx + ens, sy);
    const w = ridgedFbm(sx - ens, sy);
    const inv = 1 / (2 * ens);
    return { vx: (n - s) * inv, vy: -(e - w) * inv };
  };
}

function makeRadialField(cx: number, cy: number, twist: number): FieldFn {
  return (x: number, y: number) => {
    const dx = x - cx;
    const dy = y - cy;
    const r = Math.hypot(dx, dy) + 1e-8;
    const radX = dx / r;
    const radY = dy / r;
    const tanX = -dy / r;
    const tanY = dx / r;
    return {
      vx: radX * (1 - twist) + tanX * twist,
      vy: radY * (1 - twist) + tanY * twist,
    };
  };
}

function makeSpiralField(cx: number, cy: number, tightness: number): FieldFn {
  return (x: number, y: number) => {
    const dx = x - cx;
    const dy = y - cy;
    const r = Math.hypot(dx, dy) + 1e-8;
    const tanX = -dy / r;
    const tanY = dx / r;
    const inX = -dx / r;
    const inY = -dy / r;
    return {
      vx: tanX + inX * tightness,
      vy: tanY + inY * tightness,
    };
  };
}

// ── Composition definition ──

const flowField: Composition2DDefinition = {
  id: "flowField",
  name: "Flow Field",
  description:
    "Noise-driven vector field with domain warping, ridged noise, and variable density. Produces organic landscapes, geological folds, and tonal gradients.",
  tags: ["generative", "noise", "flow", "field", "streamlines", "landscape"],
  category: "2d",
  type: "2d",

  macros: {
    density: {
      label: "Density",
      default: 0.5,
      targets: [
        { param: "separation", fn: "linear", strength: -0.7 },
        { param: "maxSteps", fn: "linear", strength: 0.5 },
      ],
    },
    turbulence: {
      label: "Turbulence",
      default: 0.3,
      targets: [
        { param: "noiseScale", fn: "linear", strength: 0.6 },
        { param: "noiseOctaves", fn: "linear", strength: 0.8 },
      ],
    },
  },

  controls: {
    morphology: {
      type: "select",
      label: "Morphology",
      default: "warp",
      options: [
        { label: "Domain Warp", value: "warp" },
        { label: "Ridged", value: "ridged" },
        { label: "Curl Noise", value: "curl" },
        { label: "Radial", value: "radial" },
        { label: "Spiral", value: "spiral" },
        { label: "Uniform + Noise", value: "uniform" },
      ],
      group: "Field",
    },
    noiseScale: {
      type: "slider",
      label: "Noise Scale",
      default: 0.003,
      min: 0.0005,
      max: 0.015,
      step: 0.0005,
      group: "Field",
    },
    noiseOctaves: {
      type: "slider",
      label: "Octaves",
      default: 3,
      min: 1,
      max: 8,
      step: 1,
      group: "Field",
    },
    warpAmount: {
      type: "slider",
      label: "Warp Amount",
      default: 200,
      min: 0,
      max: 800,
      step: 10,
      group: "Field",
    },
    noiseBlend: {
      type: "slider",
      label: "Noise Blend",
      default: 0.5,
      min: 0,
      max: 1,
      step: 0.01,
      group: "Field",
    },
    uniformAngle: {
      type: "slider",
      label: "Flow Angle",
      default: 0,
      min: 0,
      max: 360,
      step: 1,
      group: "Field",
    },
    separation: {
      type: "slider",
      label: "Separation",
      default: 7,
      min: 3,
      max: 30,
      step: 1,
      group: "Streamlines",
    },
    stepLength: {
      type: "slider",
      label: "Step Length",
      default: 3,
      min: 1,
      max: 10,
      step: 0.5,
      group: "Streamlines",
    },
    maxSteps: {
      type: "slider",
      label: "Max Steps",
      default: 400,
      min: 50,
      max: 2000,
      step: 10,
      group: "Streamlines",
    },
    minLength: {
      type: "slider",
      label: "Min Length",
      default: 15,
      min: 3,
      max: 50,
      step: 1,
      group: "Streamlines",
    },
    margin: {
      type: "slider",
      label: "Margin",
      default: 20,
      min: 0,
      max: 80,
      step: 1,
      group: "Layout",
    },
  },

  wasmGenerate: wasmGenerateFlowField,

  generate({ width, height, values }) {
    const morphology = values.morphology as string;
    const noiseScale = values.noiseScale as number;
    const octaves = Math.round(values.noiseOctaves as number);
    const warpAmount = values.warpAmount as number;
    const noiseBlend = values.noiseBlend as number;
    const uniformAngle = (values.uniformAngle as number) * (Math.PI / 180);

    const cx = width / 2;
    const cy = height / 2;

    const noise2D = createNoise2D();

    // Build primary field based on morphology
    let primaryField: FieldFn;
    switch (morphology) {
      case "warp":
        primaryField = makeDomainWarpField(noise2D, noiseScale, octaves, warpAmount);
        break;
      case "ridged":
        primaryField = makeRidgedField(noise2D, noiseScale, octaves);
        break;
      case "radial":
        primaryField = makeRadialField(cx, cy, 0.6);
        break;
      case "spiral":
        primaryField = makeSpiralField(cx, cy, 0.3);
        break;
      case "uniform": {
        const ux = Math.cos(uniformAngle);
        const uy = Math.sin(uniformAngle);
        primaryField = () => ({ vx: ux, vy: uy });
        break;
      }
      default:
        // "curl" — pure curl noise
        primaryField = (px, py) => curlNoise(noise2D, px, py, noiseScale, octaves);
        break;
    }

    // For structured morphologies (radial/spiral/uniform), blend with noise
    const velocityAt: VelocityFn = (morphology === "warp" || morphology === "ridged" || morphology === "curl")
      ? primaryField
      : (px, py) => {
          const base = primaryField(px, py);
          const noise = curlNoise(noise2D, px, py, noiseScale, octaves);
          return {
            vx: base.vx * (1 - noiseBlend) + noise.vx * noiseBlend,
            vy: base.vy * (1 - noiseBlend) + noise.vy * noiseBlend,
          };
        };

    const params: StreamlineParams = {
      width,
      height,
      separation: values.separation as number,
      stepLength: values.stepLength as number,
      maxSteps: Math.round(values.maxSteps as number),
      minLength: Math.round(values.minLength as number),
      margin: values.margin as number,
    };

    return traceStreamlines(velocityAt, params);
  },
};

export default flowField;
