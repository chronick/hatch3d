import type { Composition2DDefinition } from "../../types";
import { wasmGenerateReactionDiffusion } from "../../../wasm-pipeline-2d";

const reactionDiffusion: Composition2DDefinition = {
  id: "reactionDiffusion",
  name: "Reaction-Diffusion",
  description:
    "Gray-Scott reaction-diffusion simulation with marching squares contour extraction for organic, Turing-pattern line art",
  tags: ["generative", "simulation", "reaction-diffusion", "organic"],
  category: "2d",
  manualRefresh: true,
  type: "2d",

  macros: {
    complexity: {
      label: "Complexity",
      default: 0.5,
      targets: [
        { param: "iterations", fn: "linear", strength: 0.8 },
        { param: "gridResolution", fn: "linear", strength: 0.5 },
      ],
    },
  },

  controls: {
    gridResolution: {
      type: "slider",
      label: "Grid Size",
      default: 150,
      min: 80,
      max: 400,
      step: 10,
      group: "Grid",
    },
    iterations: {
      type: "slider",
      label: "Iterations",
      default: 5000,
      min: 1000,
      max: 20000,
      step: 500,
      group: "Simulation",
    },
    feedRate: {
      type: "slider",
      label: "Feed Rate",
      default: 0.037,
      min: 0.01,
      max: 0.08,
      step: 0.001,
      group: "Chemistry",
    },
    killRate: {
      type: "slider",
      label: "Kill Rate",
      default: 0.06,
      min: 0.04,
      max: 0.075,
      step: 0.001,
      group: "Chemistry",
    },
    diffusionA: {
      type: "slider",
      label: "Diffusion A",
      default: 1.0,
      min: 0.2,
      max: 2.0,
      step: 0.05,
      group: "Chemistry",
    },
    diffusionB: {
      type: "slider",
      label: "Diffusion B",
      default: 0.5,
      min: 0.1,
      max: 1.0,
      step: 0.05,
      group: "Chemistry",
    },
    contourThreshold: {
      type: "slider",
      label: "Contour Threshold",
      default: 0.25,
      min: 0.05,
      max: 0.5,
      step: 0.01,
      group: "Output",
    },
    contourLevels: {
      type: "slider",
      label: "Contour Levels",
      default: 1,
      min: 1,
      max: 5,
      step: 1,
      group: "Output",
    },
    seedPattern: {
      type: "select",
      label: "Seed",
      default: "center",
      options: [
        { label: "Center Blob", value: "center" },
        { label: "Random Spots", value: "random" },
        { label: "Ring", value: "ring" },
        { label: "Line", value: "line" },
      ],
      group: "Init",
    },
  },

  wasmGenerate: wasmGenerateReactionDiffusion,

  generate({ width, height, values }) {
    const N = Math.round(values.gridResolution as number);
    const iterations = Math.round(values.iterations as number);
    const f = values.feedRate as number;
    const k = values.killRate as number;
    const dA = values.diffusionA as number;
    const dB = values.diffusionB as number;
    const threshold = values.contourThreshold as number;
    const levels = Math.round(values.contourLevels as number);
    const seedPattern = values.seedPattern as string;

    // Initialize concentration grids
    const size = N * N;
    let u = new Float64Array(size);
    let v = new Float64Array(size);
    const uNext = new Float64Array(size);
    const vNext = new Float64Array(size);

    // Fill with u=1, v=0
    u.fill(1.0);

    // Seed pattern
    const cx = N / 2;
    const cy = N / 2;

    if (seedPattern === "center") {
      const r = N * 0.08;
      for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
          const dx = x - cx;
          const dy = y - cy;
          if (dx * dx + dy * dy < r * r) {
            const idx = y * N + x;
            u[idx] = 0.5;
            v[idx] = 0.25;
          }
        }
      }
    } else if (seedPattern === "random") {
      const spots = Math.max(3, Math.floor(N * 0.05));
      for (let s = 0; s < spots; s++) {
        const sx = Math.floor(N * 0.1 + Math.random() * N * 0.8);
        const sy = Math.floor(N * 0.1 + Math.random() * N * 0.8);
        const r = N * 0.04;
        for (let y = Math.max(0, sy - Math.ceil(r)); y < Math.min(N, sy + Math.ceil(r)); y++) {
          for (let x = Math.max(0, sx - Math.ceil(r)); x < Math.min(N, sx + Math.ceil(r)); x++) {
            if ((x - sx) ** 2 + (y - sy) ** 2 < r * r) {
              const idx = y * N + x;
              u[idx] = 0.5;
              v[idx] = 0.25;
            }
          }
        }
      }
    } else if (seedPattern === "ring") {
      const r1 = N * 0.2;
      const r2 = N * 0.25;
      for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
          const d = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
          if (d > r1 && d < r2) {
            const idx = y * N + x;
            u[idx] = 0.5;
            v[idx] = 0.25;
          }
        }
      }
    } else {
      // Line seed
      const ly = Math.floor(cy);
      for (let x = Math.floor(N * 0.3); x < Math.floor(N * 0.7); x++) {
        for (let dy = -2; dy <= 2; dy++) {
          const y = ly + dy;
          if (y >= 0 && y < N) {
            const idx = y * N + x;
            u[idx] = 0.5;
            v[idx] = 0.25;
          }
        }
      }
    }

    // Gray-Scott simulation
    const dt = 1.0;
    for (let iter = 0; iter < iterations; iter++) {
      for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
          const idx = y * N + x;
          // Laplacian with periodic boundary
          const xm = ((x - 1) + N) % N;
          const xp = (x + 1) % N;
          const ym = ((y - 1) + N) % N;
          const yp = (y + 1) % N;

          const lapU = u[y * N + xm] + u[y * N + xp] +
                       u[ym * N + x] + u[yp * N + x] - 4 * u[idx];
          const lapV = v[y * N + xm] + v[y * N + xp] +
                       v[ym * N + x] + v[yp * N + x] - 4 * v[idx];

          const uVal = u[idx];
          const vVal = v[idx];
          const uvv = uVal * vVal * vVal;

          uNext[idx] = uVal + dt * (dA * lapU - uvv + f * (1 - uVal));
          vNext[idx] = vVal + dt * (dB * lapV + uvv - (f + k) * vVal);

          // Clamp
          if (uNext[idx] < 0) uNext[idx] = 0;
          if (uNext[idx] > 1) uNext[idx] = 1;
          if (vNext[idx] < 0) vNext[idx] = 0;
          if (vNext[idx] > 1) vNext[idx] = 1;
        }
      }
      // Swap buffers
      const tmpU = u;
      const tmpV = v;
      u = uNext;
      v = vNext;
      // Reuse old arrays for next iteration
      tmpU; tmpV; // (they're now pointed to by uNext/vNext references)
    }

    // Marching squares contour extraction on the v field
    const polylines: { x: number; y: number }[][] = [];
    const scaleX = width / N;
    const scaleY = height / N;
    const margin = width * 0.05;

    for (let level = 0; level < levels; level++) {
      const isoValue = threshold + (level / Math.max(1, levels - 1)) * threshold * 0.5;
      const segments: { x1: number; y1: number; x2: number; y2: number }[] = [];

      for (let y = 0; y < N - 1; y++) {
        for (let x = 0; x < N - 1; x++) {
          const v00 = v[y * N + x];
          const v10 = v[y * N + x + 1];
          const v01 = v[(y + 1) * N + x];
          const v11 = v[(y + 1) * N + x + 1];

          // Classify corners
          const config =
            (v00 >= isoValue ? 1 : 0) |
            (v10 >= isoValue ? 2 : 0) |
            (v01 >= isoValue ? 4 : 0) |
            (v11 >= isoValue ? 8 : 0);

          if (config === 0 || config === 15) continue;

          // Interpolation helpers
          const lerp = (a: number, b: number): number => {
            const d = b - a;
            return Math.abs(d) < 1e-12 ? 0.5 : (isoValue - a) / d;
          };

          // Edge midpoints: top(0-1), right(1-3), bottom(2-3), left(0-2)
          // Grid: 0=TL(x,y), 1=TR(x+1,y), 2=BL(x,y+1), 3=BR(x+1,y+1)
          const top = { x: x + lerp(v00, v10), y };
          const right = { x: x + 1, y: y + lerp(v10, v11) };
          const bottom = { x: x + lerp(v01, v11), y: y + 1 };
          const left = { x, y: y + lerp(v00, v01) };

          const edges: [typeof top, typeof top][] = [];

          // Standard marching squares lookup
          switch (config) {
            case 1: edges.push([top, left]); break;
            case 2: edges.push([right, top]); break;
            case 3: edges.push([right, left]); break;
            case 4: edges.push([left, bottom]); break;
            case 5: edges.push([top, bottom]); break;
            case 6: edges.push([right, top], [left, bottom]); break;
            case 7: edges.push([right, bottom]); break;
            case 8: edges.push([bottom, right]); break;
            case 9: edges.push([top, left], [bottom, right]); break;
            case 10: edges.push([bottom, top]); break;
            case 11: edges.push([bottom, left]); break;
            case 12: edges.push([left, right]); break;
            case 13: edges.push([top, right]); break;
            case 14: edges.push([left, top]); break;
          }

          for (const [a, b] of edges) {
            segments.push({
              x1: margin + a.x * scaleX * (1 - margin * 2 / width),
              y1: margin + a.y * scaleY * (1 - margin * 2 / height),
              x2: margin + b.x * scaleX * (1 - margin * 2 / width),
              y2: margin + b.y * scaleY * (1 - margin * 2 / height),
            });
          }
        }
      }

      // Chain segments into polylines
      const used = new Uint8Array(segments.length);
      const eps = scaleX * 0.5;

      for (let i = 0; i < segments.length; i++) {
        if (used[i]) continue;
        used[i] = 1;
        const seg = segments[i];
        const chain: { x: number; y: number }[] = [
          { x: seg.x1, y: seg.y1 },
          { x: seg.x2, y: seg.y2 },
        ];

        // Grow chain forward
        let growing = true;
        while (growing) {
          growing = false;
          const tail = chain[chain.length - 1];
          for (let j = 0; j < segments.length; j++) {
            if (used[j]) continue;
            const s = segments[j];
            if (Math.abs(s.x1 - tail.x) < eps && Math.abs(s.y1 - tail.y) < eps) {
              chain.push({ x: s.x2, y: s.y2 });
              used[j] = 1;
              growing = true;
              break;
            }
            if (Math.abs(s.x2 - tail.x) < eps && Math.abs(s.y2 - tail.y) < eps) {
              chain.push({ x: s.x1, y: s.y1 });
              used[j] = 1;
              growing = true;
              break;
            }
          }
        }

        // Grow chain backward
        growing = true;
        while (growing) {
          growing = false;
          const head = chain[0];
          for (let j = 0; j < segments.length; j++) {
            if (used[j]) continue;
            const s = segments[j];
            if (Math.abs(s.x2 - head.x) < eps && Math.abs(s.y2 - head.y) < eps) {
              chain.unshift({ x: s.x1, y: s.y1 });
              used[j] = 1;
              growing = true;
              break;
            }
            if (Math.abs(s.x1 - head.x) < eps && Math.abs(s.y1 - head.y) < eps) {
              chain.unshift({ x: s.x2, y: s.y2 });
              used[j] = 1;
              growing = true;
              break;
            }
          }
        }

        if (chain.length >= 2) {
          polylines.push(chain);
        }
      }
    }

    return polylines;
  },
};

export default reactionDiffusion;
