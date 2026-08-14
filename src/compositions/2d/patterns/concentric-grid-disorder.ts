import type { Composition2DDefinition } from "../../types";

// Mulberry32 seeded PRNG — deterministic, fast, good distribution
function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Point = { x: number; y: number };

/** Fraction of the short canvas edge reserved as an outer margin. */
const MARGIN_FRAC = 0.06;
/** Fraction of a cell kept empty as a gutter between neighbouring cells. */
const CELL_GUTTER_FRAC = 0.08;
/** Rotation (degrees) applied at perturbMagnitude = 1. */
const MAX_ROTATION_DEG = 15;
/** Centre offset as a fraction of the cell size at perturbMagnitude = 1. */
const MAX_OFFSET_FRAC = 0.15;
/** Perturbation kind thresholds: rotate < 0.4, offset < 0.8, otherwise drop. */
const KIND_ROTATE = 0.4;
const KIND_OFFSET = 0.8;

/**
 * One closed square outline, centred on (cx, cy), half-edge `half`,
 * rotated by `angle` radians. 5 points (last repeats the first).
 */
function squareRing(
  cx: number,
  cy: number,
  half: number,
  angle: number,
): Point[] {
  const corners: Point[] = [
    { x: -half, y: -half },
    { x: half, y: -half },
    { x: half, y: half },
    { x: -half, y: half },
  ];

  const pts: Point[] = [];
  if (angle === 0) {
    for (const c of corners) pts.push({ x: cx + c.x, y: cy + c.y });
  } else {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    for (const c of corners) {
      pts.push({
        x: cx + c.x * cos - c.y * sin,
        y: cy + c.x * sin + c.y * cos,
      });
    }
  }
  pts.push({ ...pts[0] });
  return pts;
}

const concentricGridDisorder: Composition2DDefinition = {
  id: "concentricGridDisorder",
  name: "Concentric Grid Disorder",
  description:
    "Molnár-style grid of concentric-square cells with dosed per-ring disorder (rotation, offset, dropped rings)",
  tags: ["pattern", "grid", "concentric", "molnar", "geometric", "generative"],
  category: "2d",
  type: "2d",

  controls: {
    gridCount: {
      type: "slider",
      label: "Grid Count",
      default: 12,
      min: 2,
      max: 24,
      step: 1,
      group: "Grid",
    },
    ringsPerCell: {
      type: "slider",
      label: "Rings Per Cell",
      default: 6,
      min: 1,
      max: 12,
      step: 1,
      group: "Grid",
    },
    disorderRate: {
      type: "slider",
      label: "Disorder Rate",
      default: 0.05,
      min: 0,
      max: 1,
      step: 0.01,
      group: "Disorder",
    },
    perturbMagnitude: {
      type: "slider",
      label: "Perturb Magnitude",
      default: 0.3,
      min: 0,
      max: 1,
      step: 0.01,
      group: "Disorder",
    },
    seed: {
      type: "slider",
      label: "Seed",
      default: 42,
      min: 0,
      max: 999,
      step: 1,
      group: "Disorder",
    },
  },

  generate({ width, height, values }) {
    const gridCount = Math.max(1, Math.round(values.gridCount as number));
    const ringsPerCell = Math.max(1, Math.round(values.ringsPerCell as number));
    const disorderRate = values.disorderRate as number;
    const perturbMagnitude = values.perturbMagnitude as number;
    const seed = Math.round(values.seed as number);

    // Centred square field so every cell is square regardless of canvas aspect.
    const short = Math.min(width, height);
    const margin = short * MARGIN_FRAC;
    const side = short - margin * 2;
    if (side <= 0) return [];

    const originX = (width - side) / 2;
    const originY = (height - side) / 2;
    const cellSize = side / gridCount;
    const maxHalf = cellSize / 2 - cellSize * CELL_GUTTER_FRAC;
    if (maxHalf <= 0) return [];

    // disorderRate = 0 is an exact, RNG-free perfect grid: the PRNG is never
    // consulted, so no jitter can leak in through rounding or draw order.
    const disordered = disorderRate > 0;
    const rand = disordered ? mulberry32(seed) : null;

    const maxRotation = (MAX_ROTATION_DEG * Math.PI) / 180 * perturbMagnitude;
    const maxOffset = cellSize * MAX_OFFSET_FRAC * perturbMagnitude;

    const polylines: Point[][] = [];

    for (let row = 0; row < gridCount; row++) {
      for (let col = 0; col < gridCount; col++) {
        const cellCx = originX + (col + 0.5) * cellSize;
        const cellCy = originY + (row + 0.5) * cellSize;

        for (let i = 1; i <= ringsPerCell; i++) {
          const half = (maxHalf * i) / ringsPerCell;

          // Perturbation is decided PER RING, not per cell: in Molnár's
          // "Des Ordres" grammar the rule is the nested square, and the
          // disorder disturbs individual squares inside an otherwise intact
          // cell — that is what keeps the rule legible while the field breathes.
          if (!rand || rand() >= disorderRate) {
            polylines.push(squareRing(cellCx, cellCy, half, 0));
            continue;
          }

          const kind = rand();
          if (kind < KIND_ROTATE) {
            const angle = (rand() * 2 - 1) * maxRotation;
            polylines.push(squareRing(cellCx, cellCy, half, angle));
          } else if (kind < KIND_OFFSET) {
            const dx = (rand() * 2 - 1) * maxOffset;
            const dy = (rand() * 2 - 1) * maxOffset;
            polylines.push(squareRing(cellCx + dx, cellCy + dy, half, 0));
          }
          // else: ring dropped — the third Molnár perturbation.
        }
      }
    }

    return polylines;
  },
};

export default concentricGridDisorder;
