import { createNoise2D } from "simplex-noise";
import type { Composition2DDefinition } from "../../types";
import { mulberry32 } from "../../../utils/prng";
import { fbm } from "./streamline-tracer";

/**
 * Noise-grid-of-circles halftone (polygonsoup / u-Messipte technique,
 * see research/polygonsoup-noise-grid.md): a regular grid of circles whose
 * radius is driven by a 2D simplex noise field sampled at each cell
 * center, producing a plotter-ready halftone gradient.
 */
const noiseGridCircles: Composition2DDefinition = {
  id: "noiseGridCircles",
  name: "Noise Grid Circles",
  description:
    "Grid of circles with noise-modulated radius, producing a plotter-ready halftone gradient — polygonsoup-style tonal texture.",
  tags: ["generative", "halftone", "noise", "grid", "circles"],
  category: "2d",
  type: "2d",

  macros: {
    density: {
      label: "Density",
      default: 0.5,
      targets: [
        { param: "gridCols", fn: "linear", strength: 0.8 },
        { param: "gridRows", fn: "linear", strength: 0.8 },
      ],
    },
    tonal_spread: {
      label: "Tonal Spread",
      default: 0.5,
      targets: [
        { param: "rMin", fn: "linear", strength: -0.5 },
        { param: "rMax", fn: "linear", strength: 0.5 },
      ],
    },
    texture: {
      label: "Texture",
      default: 0.3,
      targets: [
        { param: "noiseScale", fn: "linear", strength: 0.6 },
        { param: "noiseOctaves", fn: "linear", strength: 0.8 },
      ],
    },
  },

  controls: {
    gridCols: {
      type: "slider",
      label: "Grid Columns",
      default: 40,
      min: 4,
      max: 120,
      step: 1,
      group: "Grid",
    },
    gridRows: {
      type: "slider",
      label: "Grid Rows",
      default: 30,
      min: 4,
      max: 120,
      step: 1,
      group: "Grid",
    },
    noiseScale: {
      type: "slider",
      label: "Noise Scale",
      default: 2.4,
      min: 0.5,
      max: 8,
      step: 0.1,
      group: "Noise",
    },
    noiseOctaves: {
      type: "slider",
      label: "Noise Octaves",
      default: 3,
      min: 1,
      max: 6,
      step: 1,
      group: "Noise",
    },
    noiseSeed: {
      type: "slider",
      label: "Noise Seed",
      default: 42,
      min: 0,
      max: 9999,
      step: 1,
      group: "Noise",
    },
    rMin: {
      type: "slider",
      label: "Min Radius",
      default: 0.04,
      min: 0.01,
      max: 0.3,
      step: 0.01,
      group: "Radius",
    },
    rMax: {
      type: "slider",
      label: "Max Radius",
      default: 0.44,
      min: 0.2,
      max: 0.6,
      step: 0.01,
      group: "Radius",
    },
    circleSegments: {
      type: "slider",
      label: "Circle Segments",
      default: 24,
      min: 8,
      max: 64,
      step: 1,
      group: "Quality",
    },
  },

  suggestedPresets: {
    "halftone-fine": {
      name: "Halftone Fine",
      description: "Dense grid, tight radius range — a fine-grained halftone screen.",
      values: {
        controls: {
          gridCols: 80,
          gridRows: 120,
          noiseScale: 2.4,
          noiseOctaves: 3,
          noiseSeed: 42,
          rMin: 0.04,
          rMax: 0.44,
          circleSegments: 16,
        },
      },
    },
    "halftone-coarse": {
      name: "Halftone Coarse",
      description: "Sparse grid, large radius range — bold blob-like tonal regions.",
      values: {
        controls: {
          gridCols: 20,
          gridRows: 16,
          noiseScale: 1.2,
          noiseOctaves: 2,
          noiseSeed: 7,
          rMin: 0.06,
          rMax: 0.5,
          circleSegments: 32,
        },
      },
    },
  },

  generate({ width, height, values }) {
    const cols = Math.max(1, Math.round(values.gridCols as number));
    const rows = Math.max(1, Math.round(values.gridRows as number));
    const noiseScale = values.noiseScale as number;
    const octaves = Math.max(1, Math.round(values.noiseOctaves as number));
    const seed = Math.round(values.noiseSeed as number);
    const rMin = values.rMin as number;
    const rMax = values.rMax as number;
    const segments = Math.max(3, Math.round(values.circleSegments as number));

    const noise2D = createNoise2D(mulberry32(seed));
    const ns = noiseScale / width;

    const cellW = width / cols;
    const cellH = height / rows;
    const cellHalfWidth = Math.min(cellW, cellH) * 0.5;

    const polylines: { x: number; y: number }[][] = [];

    for (let col = 0; col < cols; col++) {
      for (let row = 0; row < rows; row++) {
        const cx = (col + 0.5) * cellW;
        const cy = (row + 0.5) * cellH;

        const n = fbm(noise2D, cx * ns, cy * ns, octaves); // ~[-1, 1]
        const nn = Math.min(1, Math.max(0, (n + 1) * 0.5)); // normalize to [0, 1]
        const r = (rMin + (rMax - rMin) * nn) * cellHalfWidth;

        const pts: { x: number; y: number }[] = [];
        for (let i = 0; i <= segments; i++) {
          const angle = (i / segments) * Math.PI * 2;
          pts.push({ x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) });
        }
        polylines.push(pts);
      }
    }

    return polylines;
  },
};

export default noiseGridCircles;
