import { createNoise2D } from "simplex-noise";
import type { Composition2DDefinition } from "../../types";

// ── Seeded PRNG (Mulberry32) ──

function mulberry32(a: number) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── FBM noise helper ──

function fbm(
  noise2D: (x: number, y: number) => number,
  x: number,
  y: number,
  octaves: number,
): number {
  let value = 0;
  let amp = 1;
  let freq = 1;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    value += amp * noise2D(x * freq, y * freq);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return value / norm;
}

// ── Composition definition ──

const weightedStippling: Composition2DDefinition = {
  id: "weightedStippling",
  name: "Weighted Stippling",
  description:
    "Voronoi-based stippling for tonal dot rendering from noise density field",
  tags: ["generative", "stippling", "voronoi", "tone", "dots"],
  category: "2d",
  type: "2d",

  controls: {
    dotCount: {
      type: "slider",
      label: "Dot Count",
      default: 2000,
      min: 100,
      max: 10000,
      step: 50,
      group: "Stippling",
    },
    relaxIterations: {
      type: "slider",
      label: "Relax Iterations",
      default: 5,
      min: 0,
      max: 20,
      step: 1,
      group: "Stippling",
    },
    dotRadius: {
      type: "slider",
      label: "Dot Radius",
      default: 1.5,
      min: 0.3,
      max: 5,
      step: 0.1,
      group: "Style",
    },
    varySize: {
      type: "toggle",
      label: "Vary Dot Size",
      default: true,
      group: "Style",
    },
    sizeRange: {
      type: "slider",
      label: "Size Variation",
      default: 2,
      min: 1,
      max: 5,
      step: 0.25,
      group: "Style",
    },
    noiseScale: {
      type: "slider",
      label: "Noise Scale",
      default: 0.004,
      min: 0.001,
      max: 0.02,
      step: 0.001,
      group: "Density",
    },
    contrast: {
      type: "slider",
      label: "Contrast",
      default: 1.5,
      min: 0.5,
      max: 4,
      step: 0.1,
      group: "Density",
    },
    invert: {
      type: "toggle",
      label: "Invert",
      default: false,
      group: "Density",
    },
    seed: {
      type: "slider",
      label: "Seed",
      default: 42,
      min: 0,
      max: 999,
      step: 1,
      group: "Structure",
    },
    margin: {
      type: "slider",
      label: "Margin",
      default: 20,
      min: 0,
      max: 80,
      step: 5,
      group: "Layout",
    },
    dotSegments: {
      type: "slider",
      label: "Dot Smoothness",
      default: 8,
      min: 4,
      max: 24,
      step: 1,
      group: "Style",
    },
  },

  generate({ width, height, values }) {
    const dotCount = Math.round(values.dotCount as number);
    const relaxIterations = Math.round(values.relaxIterations as number);
    const dotRadius = values.dotRadius as number;
    const varySize = values.varySize as boolean;
    const sizeRange = values.sizeRange as number;
    const noiseScale = values.noiseScale as number;
    const contrast = values.contrast as number;
    const invert = values.invert as boolean;
    const seed = Math.round(values.seed as number);
    const margin = values.margin as number;
    const dotSegments = Math.round(values.dotSegments as number);

    const rng = mulberry32(seed);
    const noise2D = createNoise2D(rng);

    const xMin = margin;
    const xMax = width - margin;
    const yMin = margin;
    const yMax = height - margin;
    const fieldW = xMax - xMin;
    const fieldH = yMax - yMin;

    // ── Density field ──

    function density(x: number, y: number): number {
      const raw = 0.5 + 0.5 * fbm(noise2D, x * noiseScale, y * noiseScale, 4);
      const clamped = Math.max(0, Math.min(1, raw));
      const shaped = Math.pow(clamped, contrast);
      return invert ? 1 - shaped : shaped;
    }

    // ── Rejection sampling for initial placement ──

    const points: { x: number; y: number }[] = [];
    let attempts = 0;
    const maxAttempts = dotCount * 50; // safety limit

    while (points.length < dotCount && attempts < maxAttempts) {
      const x = rng() * fieldW + xMin;
      const y = rng() * fieldH + yMin;
      if (rng() < density(x, y)) {
        points.push({ x, y });
      }
      attempts++;
    }

    // ── Lloyd relaxation (simplified grid-based) ──

    const cellSize = 20;
    const gridCols = Math.ceil(fieldW / cellSize);
    const gridRows = Math.ceil(fieldH / cellSize);

    for (let iter = 0; iter < relaxIterations; iter++) {
      // Build spatial grid
      const grid: number[][] = new Array(gridCols * gridRows);
      for (let i = 0; i < grid.length; i++) grid[i] = [];

      for (let i = 0; i < points.length; i++) {
        const col = Math.floor((points[i].x - xMin) / cellSize);
        const row = Math.floor((points[i].y - yMin) / cellSize);
        const clamped =
          Math.max(0, Math.min(gridCols - 1, col)) +
          Math.max(0, Math.min(gridRows - 1, row)) * gridCols;
        grid[clamped].push(i);
      }

      // For each point, sample local neighborhood and compute density-weighted centroid
      const samplesPerPoint = 12;
      const searchRadius = cellSize * 1.5;
      const relaxFactor = 0.4;

      for (let i = 0; i < points.length; i++) {
        const px = points[i].x;
        const py = points[i].y;

        let weightedX = 0;
        let weightedY = 0;
        let totalWeight = 0;

        for (let s = 0; s < samplesPerPoint; s++) {
          // Random offset within search radius
          const angle = rng() * Math.PI * 2;
          const dist = rng() * searchRadius;
          const sx = px + Math.cos(angle) * dist;
          const sy = py + Math.sin(angle) * dist;

          // Clamp to bounds
          if (sx < xMin || sx > xMax || sy < yMin || sy > yMax) continue;

          // Check if this sample is closer to current point than any neighbor
          const sCol = Math.floor((sx - xMin) / cellSize);
          const sRow = Math.floor((sy - yMin) / cellSize);
          const closestDist = (sx - px) ** 2 + (sy - py) ** 2;
          let isClosest = true;

          // Check neighboring grid cells
          for (
            let dc = Math.max(0, sCol - 1);
            dc <= Math.min(gridCols - 1, sCol + 1) && isClosest;
            dc++
          ) {
            for (
              let dr = Math.max(0, sRow - 1);
              dr <= Math.min(gridRows - 1, sRow + 1) && isClosest;
              dr++
            ) {
              const cell = grid[dc + dr * gridCols];
              for (const j of cell) {
                if (j === i) continue;
                const d2 =
                  (sx - points[j].x) ** 2 + (sy - points[j].y) ** 2;
                if (d2 < closestDist) {
                  isClosest = false;
                  break;
                }
              }
            }
          }

          if (isClosest) {
            const d = density(sx, sy);
            weightedX += sx * d;
            weightedY += sy * d;
            totalWeight += d;
          }
        }

        if (totalWeight > 0) {
          const cx = weightedX / totalWeight;
          const cy = weightedY / totalWeight;
          points[i] = {
            x: Math.max(xMin, Math.min(xMax, px + (cx - px) * relaxFactor)),
            y: Math.max(yMin, Math.min(yMax, py + (cy - py) * relaxFactor)),
          };
        }
      }
    }

    // ── Generate dot polylines (small circles) ──

    const polylines: { x: number; y: number }[][] = [];

    for (let i = 0; i < points.length; i++) {
      const cx = points[i].x;
      const cy = points[i].y;

      // Compute radius
      let r = dotRadius;
      if (varySize) {
        const d = density(cx, cy);
        r = dotRadius * (1 + (d - 0.5) * sizeRange / dotRadius);
        r = Math.max(0.1, r); // minimum visible radius
      }

      // Build closed circle polyline
      const circle: { x: number; y: number }[] = [];
      for (let j = 0; j <= dotSegments; j++) {
        const angle = (j / dotSegments) * Math.PI * 2;
        circle.push({
          x: cx + r * Math.cos(angle),
          y: cy + r * Math.sin(angle),
        });
      }
      polylines.push(circle);
    }

    return polylines;
  },
};

export default weightedStippling;
