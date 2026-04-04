import { createNoise2D } from "simplex-noise";
import type { Composition2DDefinition } from "../../types";
import { wasmGenerateInkVortex } from "../../../wasm-pipeline-2d";
import { traceStreamlines, curlNoise, type VelocityFn } from "./streamline-tracer";

// ── Vortex generation presets ──

interface Vortex {
  x: number;
  y: number;
  gamma: number; // circulation strength
}

function generateVortices(
  arrangement: string,
  count: number,
  circulationRange: number,
  width: number,
  height: number,
): Vortex[] {
  const cx = width / 2;
  const cy = height / 2;
  const rx = width * 0.4;
  const ry = height * 0.4;

  switch (arrangement) {
    case "ring": {
      return Array.from({ length: count }, (_, i) => {
        const angle = (i / count) * Math.PI * 2;
        const sign = i % 2 === 0 ? 1 : -1;
        return {
          x: cx + Math.cos(angle) * rx,
          y: cy + Math.sin(angle) * ry,
          gamma: sign * circulationRange,
        };
      });
    }

    case "dipole": {
      const gap = rx * 0.4;
      return [
        { x: cx - gap, y: cy, gamma: circulationRange },
        { x: cx + gap, y: cy, gamma: -circulationRange },
      ];
    }

    case "karman": {
      // Von Kármán vortex street: two staggered rows
      const vortices: Vortex[] = [];
      const rowGap = height * 0.3;
      const spacing = width / (Math.ceil(count / 2) + 1);
      for (let i = 0; i < count; i++) {
        const row = i % 2;
        const col = Math.floor(i / 2);
        vortices.push({
          x: spacing * (col + 1) + (row === 1 ? spacing * 0.5 : 0),
          y: cy + (row === 0 ? -rowGap : rowGap),
          gamma: (row === 0 ? 1 : -1) * circulationRange,
        });
      }
      return vortices;
    }

    case "galaxy": {
      // Spiral arm arrangement with decaying circulation
      return Array.from({ length: count }, (_, i) => {
        const t = i / count;
        const angle = t * Math.PI * 4; // two full spiral turns
        const rFrac = 0.1 + t * 0.9;
        return {
          x: cx + Math.cos(angle) * rx * rFrac,
          y: cy + Math.sin(angle) * ry * rFrac,
          gamma: circulationRange * (1 - t * 0.6) * (i % 2 === 0 ? 1 : -0.5),
        };
      });
    }

    default: {
      // "random" — seeded pseudo-random using simple hash
      return Array.from({ length: count }, (_, i) => {
        // Deterministic pseudo-random based on index
        const h1 = Math.sin(i * 127.1 + 311.7) * 43758.5453;
        const h2 = Math.sin(i * 269.5 + 183.3) * 43758.5453;
        const h3 = Math.sin(i * 419.2 + 371.9) * 43758.5453;
        const px = (h1 - Math.floor(h1)) * width * 0.9 + width * 0.05;
        const py = (h2 - Math.floor(h2)) * height * 0.9 + height * 0.05;
        const sign = (h3 - Math.floor(h3)) > 0.5 ? 1 : -1;
        return {
          x: px,
          y: py,
          gamma: sign * circulationRange * (0.5 + (h3 - Math.floor(h3)) * 0.5),
        };
      });
    }
  }
}

// ── Composition definition ──

const inkVortex: Composition2DDefinition = {
  id: "inkVortex",
  name: "Ink Vortex",
  description:
    "Fluid dynamics streamlines via point vortex fields and Jobard-Lefer evenly-spaced seeding. Produces engraving-like flow patterns.",
  tags: ["generative", "fluid", "vortex", "streamlines", "engraving"],
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
      default: 0.0,
      targets: [
        { param: "curlNoise", fn: "linear", strength: 1.0 },
        { param: "noiseScale", fn: "linear", strength: 0.6 },
      ],
    },
  },

  controls: {
    arrangement: {
      type: "select",
      label: "Arrangement",
      default: "random",
      options: [
        { label: "Random", value: "random" },
        { label: "Ring", value: "ring" },
        { label: "Dipole", value: "dipole" },
        { label: "Kármán Street", value: "karman" },
        { label: "Galaxy", value: "galaxy" },
      ],
      group: "Vortices",
    },
    vortexCount: {
      type: "slider",
      label: "Vortex Count",
      default: 6,
      min: 2,
      max: 20,
      step: 1,
      group: "Vortices",
    },
    circulationRange: {
      type: "slider",
      label: "Circulation",
      default: 1.0,
      min: 0.2,
      max: 5.0,
      step: 0.1,
      group: "Vortices",
    },
    epsilon: {
      type: "slider",
      label: "Regularization",
      default: 30,
      min: 5,
      max: 100,
      step: 1,
      group: "Vortices",
    },
    separation: {
      type: "slider",
      label: "Separation",
      default: 8,
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
      default: 300,
      min: 50,
      max: 1000,
      step: 10,
      group: "Streamlines",
    },
    minLength: {
      type: "slider",
      label: "Min Length",
      default: 15,
      min: 5,
      max: 50,
      step: 1,
      group: "Streamlines",
    },
    curlNoise: {
      type: "slider",
      label: "Curl Noise",
      default: 0.0,
      min: 0,
      max: 1,
      step: 0.01,
      group: "Turbulence",
    },
    noiseScale: {
      type: "slider",
      label: "Noise Scale",
      default: 0.005,
      min: 0.001,
      max: 0.02,
      step: 0.001,
      group: "Turbulence",
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

  wasmGenerate: wasmGenerateInkVortex,

  generate({ width, height, values }) {
    const arrangement = values.arrangement as string;
    const vortexCount = Math.round(values.vortexCount as number);
    const circulationRange = values.circulationRange as number;
    const epsilon = values.epsilon as number;
    const curlNoiseAmt = values.curlNoise as number;
    const noiseScale = values.noiseScale as number;

    // Generate vortex configuration
    const vortices = generateVortices(
      arrangement,
      vortexCount,
      circulationRange,
      width,
      height,
    );

    const epsilonSq = epsilon * epsilon;
    const twoPi = Math.PI * 2;

    // Optional curl noise for organic turbulence
    const noise2D = curlNoiseAmt > 0 ? createNoise2D() : null;

    // Biot-Savart velocity from all vortices + optional curl noise
    const velocityAt: VelocityFn = (px, py) => {
      let vx = 0;
      let vy = 0;

      for (const v of vortices) {
        const dx = px - v.x;
        const dy = py - v.y;
        const r2 = dx * dx + dy * dy + epsilonSq;
        const factor = v.gamma / (twoPi * r2);
        vx += -dy * factor;
        vy += dx * factor;
      }

      if (curlNoiseAmt > 0 && noise2D) {
        const cn = curlNoise(noise2D, px, py, noiseScale, 1);
        vx = vx * (1 - curlNoiseAmt) + cn.vx * curlNoiseAmt;
        vy = vy * (1 - curlNoiseAmt) + cn.vy * curlNoiseAmt;
      }

      return { vx, vy };
    };

    return traceStreamlines(velocityAt, {
      width,
      height,
      separation: values.separation as number,
      stepLength: values.stepLength as number,
      maxSteps: Math.round(values.maxSteps as number),
      minLength: Math.round(values.minLength as number),
      margin: values.margin as number,
    });
  },
};

export default inkVortex;
