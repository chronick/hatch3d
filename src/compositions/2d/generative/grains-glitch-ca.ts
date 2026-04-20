import { createNoise2D } from "simplex-noise";
import type { Composition2DDefinition } from "../../types";
import { wasmGenerateGrainsGlitchCA } from "../../../wasm-pipeline-2d";

type Point = { x: number; y: number };

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 16-direction neighborhood at radius 3 — approximates a diagonal spoke
// pattern that catches long-range lateral structure the Moore kernels miss.
const DIR16_OFFSETS: Array<[number, number]> = Array.from({ length: 16 }, (_, k) => {
  const theta = (k / 16) * Math.PI * 2;
  return [Math.round(Math.cos(theta) * 3), Math.round(Math.sin(theta) * 3)] as [number, number];
}).filter(([dx, dy]) => !(dx === 0 && dy === 0));

const grainsGlitchCA: Composition2DDefinition = {
  id: "grainsGlitchCA",
  name: "Grains Glitch CA",
  description:
    "Cellular-automaton state grid mapped to horizontal-hatch tiles — each cell holds one of N luminance states that spreads laterally under mixed Moore / 16-direction rules, producing stretched glitch/compression-artifact bands. Adjacent same-state segments merge into long polylines for fast plotting.",
  tags: ["2d", "generative", "cellular-automaton", "pixel-glitch", "halftone"],
  category: "2d",
  type: "2d",

  macros: {
    density: {
      label: "Density",
      default: 0.5,
      targets: [
        { param: "numStates", fn: "linear", strength: 0.7 },
        { param: "hatchLineGap", fn: "linear", strength: -0.8 },
        { param: "tileHeight", fn: "linear", strength: -0.4 },
      ],
    },
    chaos: {
      label: "Chaos",
      default: 0.3,
      targets: [
        { param: "ruleBlend", fn: "exp", strength: 0.9 },
        { param: "seedNoise", fn: "linear", strength: 0.7 },
        { param: "caIterations", fn: "linear", strength: 0.6 },
      ],
    },
    fracture: {
      label: "Fracture",
      default: 0.35,
      targets: [
        { param: "shiftStrength", fn: "exp", strength: 0.9 },
        { param: "joinTolerance", fn: "linear", strength: -0.6 },
      ],
    },
  },

  controls: {
    gridCols: {
      type: "slider",
      label: "Grid Columns",
      default: 80,
      min: 40,
      max: 300,
      step: 1,
      group: "Grid",
    },
    gridRows: {
      type: "slider",
      label: "Grid Rows",
      default: 100,
      min: 40,
      max: 380,
      step: 1,
      group: "Grid",
    },
    numStates: {
      type: "slider",
      label: "States (palette size)",
      default: 8,
      min: 2,
      max: 16,
      step: 1,
      group: "Grid",
    },
    caIterations: {
      type: "slider",
      label: "CA Evolution Steps",
      default: 6,
      min: 0,
      max: 30,
      step: 1,
      group: "Simulation",
    },
    neighborhoodMode: {
      type: "select",
      label: "Neighborhood Mix",
      default: "all",
      options: [
        { label: "Moore 1-layer", value: "moore1" },
        { label: "Moore 2-layer", value: "moore2" },
        { label: "16-direction spokes", value: "dir16" },
        { label: "All blended", value: "all" },
      ],
      group: "Simulation",
    },
    ruleBlend: {
      type: "slider",
      label: "Rule Blend Chaos",
      default: 0.4,
      min: 0,
      max: 1,
      step: 0.01,
      group: "Simulation",
    },
    shiftStrength: {
      type: "slider",
      label: "Horizontal Shift Amount",
      default: 0.35,
      min: 0,
      max: 1,
      step: 0.01,
      group: "Simulation",
    },
    tileHeight: {
      type: "slider",
      label: "Tile Height (px)",
      default: 5,
      min: 2,
      max: 12,
      step: 1,
      group: "Hatch Tiles",
    },
    tileWidth: {
      type: "slider",
      label: "Tile Width (px)",
      default: 8,
      min: 4,
      max: 32,
      step: 1,
      group: "Hatch Tiles",
    },
    hatchLineGap: {
      type: "slider",
      label: "Line Gap (fraction of height)",
      default: 0.3,
      min: 0.1,
      max: 0.9,
      step: 0.05,
      group: "Hatch Tiles",
    },
    joinSegments: {
      type: "toggle",
      label: "Join Same-State Segments",
      default: true,
      group: "Path Optimization",
    },
    joinTolerance: {
      type: "slider",
      label: "Join Gap Tolerance (px)",
      default: 1.5,
      min: 0.5,
      max: 6,
      step: 0.5,
      group: "Path Optimization",
    },
    seedNoise: {
      type: "slider",
      label: "Initial State Noise",
      default: 0.12,
      min: 0,
      max: 0.5,
      step: 0.01,
      group: "Simulation",
    },
    seed: {
      type: "slider",
      label: "Seed",
      default: 42,
      min: 0,
      max: 999,
      step: 1,
      group: "Grid",
    },
  },

  generate({ width, height, values }) {
    const gridCols = Math.max(4, Math.floor((values.gridCols as number) ?? 80));
    const gridRows = Math.max(4, Math.floor((values.gridRows as number) ?? 100));
    const numStates = Math.max(2, Math.floor((values.numStates as number) ?? 8));
    const caIterations = Math.max(0, Math.floor((values.caIterations as number) ?? 6));
    const neighborhoodMode =
      ((values.neighborhoodMode as string) ?? "all") as
        | "moore1"
        | "moore2"
        | "dir16"
        | "all";
    const ruleBlend = Math.max(0, Math.min(1, (values.ruleBlend as number) ?? 0.4));
    const shiftStrength = Math.max(
      0,
      Math.min(1, (values.shiftStrength as number) ?? 0.35),
    );
    const tileH = Math.max(2, (values.tileHeight as number) ?? 5);
    const tileW = Math.max(4, (values.tileWidth as number) ?? 8);
    const hatchLineGap = Math.max(
      0.1,
      Math.min(0.9, (values.hatchLineGap as number) ?? 0.3),
    );
    const joinSegments = (values.joinSegments as boolean) ?? true;
    const joinTolerance = Math.max(0, (values.joinTolerance as number) ?? 1.5);
    const seedNoise = Math.max(0, Math.min(0.5, (values.seedNoise as number) ?? 0.12));
    const seed = Math.floor((values.seed as number) ?? 42);

    // Fill the canvas: tile aspect ratio is tileW:tileH, actual pixel size
    // follows from gridCols × gridRows dividing into the canvas. The tile
    // sliders let the user bias the aspect (wide glitch bands vs square
    // cells) while the piece always fills the frame.
    const aspect = tileW / tileH;
    const pxPerColFromW = width / gridCols;
    const pxPerRowFromH = height / gridRows;
    let pxPerCol = pxPerColFromW;
    let pxPerRow = pxPerColFromW / aspect;
    if (pxPerRow * gridRows > height) {
      pxPerRow = pxPerRowFromH;
      pxPerCol = pxPerRowFromH * aspect;
    }
    const totalW = pxPerCol * gridCols;
    const totalH = pxPerRow * gridRows;
    const x0 = (width - totalW) / 2;
    const y0 = (height - totalH) / 2;

    const rng = mulberry32(seed);
    const noise = createNoise2D(rng);

    // 1. GRID INIT — seed each cell with a quantized luminance from a
    //    low-frequency noise field, optionally perturbed by seedNoise.
    const grid = new Int32Array(gridCols * gridRows);
    const idx = (i: number, j: number) => j * gridCols + i;
    for (let j = 0; j < gridRows; j++) {
      for (let i = 0; i < gridCols; i++) {
        const base = 0.5 + 0.5 * noise(i * 0.04, j * 0.04);
        const perturbed = base + seedNoise * (rng() * 2 - 1);
        const clamped = Math.max(0, Math.min(0.999, perturbed));
        grid[idx(i, j)] = Math.floor(clamped * numStates);
      }
    }

    // 2. CA EVOLUTION — per-cell majority vote across enabled kernels with
    //    a horizontal row-offset shift to produce the stretched glitch bands.
    const kernelsEnabled = {
      moore1: neighborhoodMode === "moore1" || neighborhoodMode === "all",
      moore2: neighborhoodMode === "moore2" || neighborhoodMode === "all",
      dir16: neighborhoodMode === "dir16" || neighborhoodMode === "all",
    };

    let current = grid;
    let next = new Int32Array(gridCols * gridRows);
    for (let step = 0; step < caIterations; step++) {
      for (let j = 0; j < gridRows; j++) {
        // Row-biased horizontal shift — cells further down get stretched more.
        const rowShift = Math.floor(
          shiftStrength * (j / Math.max(1, gridRows - 1)) * tileW,
        );
        for (let i = 0; i < gridCols; i++) {
          const votes = new Int32Array(numStates);
          let total = 0;
          if (kernelsEnabled.moore1) {
            for (let dj = -1; dj <= 1; dj++) {
              for (let di = -1; di <= 1; di++) {
                if (di === 0 && dj === 0) continue;
                const ni = wrap(i + di + rowShift, gridCols);
                const nj = wrap(j + dj, gridRows);
                votes[current[idx(ni, nj)]]++;
                total++;
              }
            }
          }
          if (kernelsEnabled.moore2) {
            for (let dj = -2; dj <= 2; dj++) {
              for (let di = -2; di <= 2; di++) {
                if (di === 0 && dj === 0) continue;
                const ni = wrap(i + di + rowShift, gridCols);
                const nj = wrap(j + dj, gridRows);
                // Weight outer ring less to avoid washout.
                const w = Math.abs(di) === 2 || Math.abs(dj) === 2 ? 1 : 2;
                votes[current[idx(ni, nj)]] += w;
                total += w;
              }
            }
          }
          if (kernelsEnabled.dir16) {
            for (const [dx, dy] of DIR16_OFFSETS) {
              const ni = wrap(i + dx + rowShift, gridCols);
              const nj = wrap(j + dy, gridRows);
              votes[current[idx(ni, nj)]]++;
              total++;
            }
          }
          if (total === 0) {
            next[idx(i, j)] = current[idx(i, j)];
            continue;
          }
          // Weighted majority with a chaos-proportional random jitter so
          // ties aren't always resolved the same way.
          let bestState = 0;
          let bestScore = -Infinity;
          for (let s = 0; s < numStates; s++) {
            const jitter = ruleBlend * rng() * total * 0.3;
            const score = votes[s] + jitter;
            if (score > bestScore) {
              bestScore = score;
              bestState = s;
            }
          }
          next[idx(i, j)] = bestState;
        }
      }
      const tmp = current;
      current = next;
      next = tmp;
    }

    // 3. TILE MAPPING — each cell's state → count of horizontal hatch lines.
    //    state 0 = blank, state (numStates-1) = densest.
    const maxLines = Math.max(1, Math.floor((1 - hatchLineGap) * pxPerRow));
    const segments: Array<{ y: number; x1: number; x2: number; state: number }> = [];
    for (let j = 0; j < gridRows; j++) {
      const yTop = y0 + j * pxPerRow;
      for (let i = 0; i < gridCols; i++) {
        const state = current[idx(i, j)];
        if (state === 0) continue; // fully blank
        const lineCount = Math.max(
          1,
          Math.round((state / (numStates - 1)) * maxLines),
        );
        const xLeft = x0 + i * pxPerCol;
        const xRight = xLeft + pxPerCol;
        for (let l = 0; l < lineCount; l++) {
          const y = yTop + ((l + 0.5) / lineCount) * pxPerRow;
          segments.push({ y, x1: xLeft, x2: xRight, state });
        }
      }
    }

    // 4. SEGMENT JOIN — sort by (y, x1), merge runs with matching state and
    //    gap < joinTolerance into one polyline. Big path-count reduction.
    const lines: Point[][] = [];
    if (!joinSegments) {
      for (const s of segments) {
        lines.push([
          { x: s.x1, y: s.y },
          { x: s.x2, y: s.y },
        ]);
      }
    } else {
      segments.sort((a, b) => a.y - b.y || a.x1 - b.x1);
      let i = 0;
      while (i < segments.length) {
        const start = segments[i];
        let xEnd = start.x2;
        const y = start.y;
        const state = start.state;
        let k = i + 1;
        while (k < segments.length) {
          const s = segments[k];
          if (
            Math.abs(s.y - y) > 0.01 ||
            s.state !== state ||
            s.x1 > xEnd + joinTolerance
          ) {
            break;
          }
          xEnd = Math.max(xEnd, s.x2);
          k++;
        }
        lines.push([
          { x: start.x1, y },
          { x: xEnd, y },
        ]);
        i = k;
      }
    }

    return lines;
  },

  // Rust/WASM fast path — ~5-10× faster for the inner CA loop so large
  // grid sizes (gridCols ≥ 200) stay interactive. Returns null when the
  // WASM module isn't loaded, and the worker falls back to the TS
  // `generate` above.
  wasmGenerate: wasmGenerateGrainsGlitchCA,
};

function wrap(v: number, n: number): number {
  const r = v % n;
  return r < 0 ? r + n : r;
}

export default grainsGlitchCA;
