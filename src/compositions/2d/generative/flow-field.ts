import { createNoise2D } from "simplex-noise";
import type { Composition2DDefinition } from "../../types";

const flowField: Composition2DDefinition = {
  id: "flowField",
  name: "Flow Field",
  description:
    "Noise-driven vector field with particle tracing and path separation enforcement",
  tags: ["generative", "noise", "flow", "field"],
  category: "2d",
  type: "2d",

  macros: {
    density: {
      label: "Density",
      default: 0.5,
      targets: [
        { param: "seedSpacing", fn: "linear", strength: -0.6 },
        { param: "minDistance", fn: "linear", strength: -0.4 },
      ],
    },
  },

  controls: {
    noiseScale: {
      type: "slider",
      label: "Noise Scale",
      default: 0.004,
      min: 0.001,
      max: 0.01,
      step: 0.0005,
      group: "Field",
    },
    noiseOctaves: {
      type: "slider",
      label: "Octaves",
      default: 2,
      min: 1,
      max: 8,
      step: 1,
      group: "Field",
    },
    stepLength: {
      type: "slider",
      label: "Step Length",
      default: 3,
      min: 1,
      max: 10,
      step: 0.5,
      group: "Tracing",
    },
    maxSteps: {
      type: "slider",
      label: "Max Steps",
      default: 200,
      min: 50,
      max: 2000,
      step: 10,
      group: "Tracing",
    },
    seedSpacing: {
      type: "slider",
      label: "Seed Spacing",
      default: 15,
      min: 5,
      max: 80,
      step: 1,
      group: "Density",
    },
    minDistance: {
      type: "slider",
      label: "Min Distance",
      default: 8,
      min: 3,
      max: 50,
      step: 1,
      group: "Density",
    },
  },

  generate({ width, height, values }) {
    const noiseScale = values.noiseScale as number;
    const octaves = Math.round(values.noiseOctaves as number);
    const stepLength = values.stepLength as number;
    const maxSteps = Math.round(values.maxSteps as number);
    const seedSpacing = values.seedSpacing as number;
    const minDistance = values.minDistance as number;

    const noise2D = createNoise2D();

    // Fractal noise helper
    function fbm(x: number, y: number): number {
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

    // Spatial occupancy grid
    const cellSize = minDistance;
    const gridW = Math.ceil(width / cellSize);
    const gridH = Math.ceil(height / cellSize);
    const occupied = new Uint8Array(gridW * gridH);

    function isOccupied(x: number, y: number): boolean {
      const gx = Math.floor(x / cellSize);
      const gy = Math.floor(y / cellSize);
      // Check 3x3 neighborhood
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = gx + dx;
          const ny = gy + dy;
          if (nx >= 0 && nx < gridW && ny >= 0 && ny < gridH) {
            if (occupied[ny * gridW + nx]) return true;
          }
        }
      }
      return false;
    }

    function markOccupied(x: number, y: number) {
      const gx = Math.floor(x / cellSize);
      const gy = Math.floor(y / cellSize);
      if (gx >= 0 && gx < gridW && gy >= 0 && gy < gridH) {
        occupied[gy * gridW + gx] = 1;
      }
    }

    function inBounds(x: number, y: number): boolean {
      return x >= 0 && x < width && y >= 0 && y < height;
    }

    // Trace a single streamline in one direction
    function trace(
      startX: number,
      startY: number,
      direction: 1 | -1,
    ): { x: number; y: number }[] {
      const pts: { x: number; y: number }[] = [];
      let x = startX;
      let y = startY;

      for (let step = 0; step < maxSteps; step++) {
        if (!inBounds(x, y)) break;
        if (step > 2 && isOccupied(x, y)) break;

        pts.push({ x, y });
        markOccupied(x, y);

        const angle =
          fbm(x * noiseScale, y * noiseScale) * Math.PI * 2 * direction;
        x += Math.cos(angle) * stepLength;
        y += Math.sin(angle) * stepLength;
      }

      return pts;
    }

    const polylines: { x: number; y: number }[][] = [];

    // Seed points on regular grid
    const cols = Math.floor(width / seedSpacing);
    const rows = Math.floor(height / seedSpacing);

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const sx = (col + 0.5) * seedSpacing;
        const sy = (row + 0.5) * seedSpacing;

        if (isOccupied(sx, sy)) continue;

        // Trace forward and backward from seed
        const forward = trace(sx, sy, 1);
        const backward = trace(sx, sy, -1);

        // Combine: reverse backward + forward (skip duplicate seed point)
        const combined = [
          ...backward.reverse(),
          ...forward.slice(backward.length > 0 ? 1 : 0),
        ];

        if (combined.length >= 3) {
          polylines.push(combined);
        }
      }
    }

    return polylines;
  },
};

export default flowField;
