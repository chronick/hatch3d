/**
 * Patch signals — the "common interface" (the eurorack voltage standard).
 *
 * Three signal types flow on patch cables:
 *   - Geometry     — polylines. The "audio": the actual drawn output.
 *   - ScalarField  — (x,y) → number. The "CV": density maps, luminance, SDFs.
 *   - VectorField  — (x,y) → [dx,dy]. Directional CV: flow, gradients.
 *
 * Field is the universal modulation currency: any geometry can be *lifted* to a
 * field (its density), and any operator parameter can be *modulated* by a field.
 * This is what lets nodes interact laterally (a patch) rather than only nest (a
 * tree). Everything here is a pure, deterministic function of its inputs — no
 * wall-clock time — so a patch still compiles reproducibly to SVG and stays
 * measurable by the stats CLI. (Design: vault active/plotter-art-workflow; the
 * L2 static-patch tier.)
 */

export type Polyline = { x: number; y: number }[];
export type Geometry = Polyline[];

export interface ScalarField {
  kind: "scalar";
  sample(x: number, y: number): number;
}

export interface VectorField {
  kind: "vector";
  sample(x: number, y: number): [number, number];
}

export type Field = ScalarField | VectorField;

/** Deterministic PRNG (mulberry32) — seeds simplex so patches are reproducible. */
import { mulberry32 } from "../utils/prng";
export { mulberry32 };

import { createNoise2D } from "simplex-noise";

/** Analytic scalar noise field in [-1,1], seeded for determinism. */
export function simplexScalar(scale: number, seed: number): ScalarField {
  const noise = createNoise2D(mulberry32(seed));
  return {
    kind: "scalar",
    sample: (x, y) => noise(x * scale, y * scale),
  };
}

/**
 * Analytic vector field from two decorrelated noise channels (angle + speed).
 * A cheap curl-free flow that reads as organic drift when used to distort.
 */
export function simplexVector(scale: number, seed: number): VectorField {
  const nAngle = createNoise2D(mulberry32(seed));
  const nMag = createNoise2D(mulberry32(seed ^ 0x9e3779b9));
  return {
    kind: "vector",
    sample: (x, y) => {
      const angle = nAngle(x * scale, y * scale) * Math.PI; // [-π, π]
      const mag = 0.5 + 0.5 * nMag(x * scale, y * scale); // [0,1]
      return [Math.cos(angle) * mag, Math.sin(angle) * mag];
    },
  };
}

/**
 * Lift geometry to a scalar **density field** — the key patch cable: one node's
 * output geometry becomes a modulation signal for another node. Accumulates
 * segment length into a grid over `bbox`, then bilinearly samples it, normalized
 * so the densest cell reads ~1. Reuses the same coverage idea as the stats grid.
 */
export function densityField(
  geometry: Geometry,
  bbox: { xMin: number; yMin: number; xMax: number; yMax: number },
  cell: number,
): ScalarField {
  const w = Math.max(1e-6, bbox.xMax - bbox.xMin);
  const h = Math.max(1e-6, bbox.yMax - bbox.yMin);
  const cols = Math.max(1, Math.round(w / cell));
  const rows = Math.max(1, Math.round(h / cell));
  const grid = new Float64Array(cols * rows);
  const cw = w / cols;
  const ch = h / rows;

  for (const pl of geometry) {
    for (let i = 1; i < pl.length; i++) {
      const a = pl[i - 1];
      const b = pl[i];
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      const c = Math.floor((mx - bbox.xMin) / cw);
      const r = Math.floor((my - bbox.yMin) / ch);
      if (c >= 0 && c < cols && r >= 0 && r < rows) grid[r * cols + c] += len;
    }
  }
  let max = 0;
  for (const v of grid) if (v > max) max = v;
  const norm = max > 0 ? 1 / max : 0;

  return {
    kind: "scalar",
    sample: (x, y) => {
      // Bilinear over cell centers.
      const gx = (x - bbox.xMin) / cw - 0.5;
      const gy = (y - bbox.yMin) / ch - 0.5;
      const c0 = Math.max(0, Math.min(cols - 1, Math.floor(gx)));
      const r0 = Math.max(0, Math.min(rows - 1, Math.floor(gy)));
      const c1 = Math.min(cols - 1, c0 + 1);
      const r1 = Math.min(rows - 1, r0 + 1);
      const fx = Math.max(0, Math.min(1, gx - c0));
      const fy = Math.max(0, Math.min(1, gy - r0));
      const v00 = grid[r0 * cols + c0];
      const v10 = grid[r0 * cols + c1];
      const v01 = grid[r1 * cols + c0];
      const v11 = grid[r1 * cols + c1];
      const top = v00 * (1 - fx) + v10 * fx;
      const bot = v01 * (1 - fx) + v11 * fx;
      return (top * (1 - fy) + bot * fy) * norm;
    },
  };
}

/** Numerical gradient of a scalar field → vector field (finite differences). */
export function gradient(field: ScalarField, eps = 1): VectorField {
  return {
    kind: "vector",
    sample: (x, y) => {
      const dx = (field.sample(x + eps, y) - field.sample(x - eps, y)) / (2 * eps);
      const dy = (field.sample(x, y + eps) - field.sample(x, y - eps)) / (2 * eps);
      return [dx, dy];
    },
  };
}

/** Bounding box of geometry (falls back to the full canvas if empty). */
export function geometryBBox(
  geometry: Geometry,
  fallback: { w: number; h: number },
): { xMin: number; yMin: number; xMax: number; yMax: number } {
  let xMin = Infinity,
    yMin = Infinity,
    xMax = -Infinity,
    yMax = -Infinity;
  for (const pl of geometry)
    for (const p of pl) {
      if (p.x < xMin) xMin = p.x;
      if (p.y < yMin) yMin = p.y;
      if (p.x > xMax) xMax = p.x;
      if (p.y > yMax) yMax = p.y;
    }
  if (!Number.isFinite(xMin)) return { xMin: 0, yMin: 0, xMax: fallback.w, yMax: fallback.h };
  return { xMin, yMin, xMax, yMax };
}

type Pt = { x: number; y: number };

function pointToSegmentDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

function pointInPolygon(px: number, py: number, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * Signed-distance field of a polygon (typically a node's convex hull): the
 * distance to the nearest edge, negative inside and positive outside. A "how
 * far from this shape" CV — modulate hatch pitch by distance from a form, ring
 * a shape, fade an effect with distance. Degenerate polygons give a flat 0.
 */
export function sdfField(polygon: Pt[]): ScalarField {
  if (polygon.length < 3) return { kind: "scalar", sample: () => 0 };
  const n = polygon.length;
  return {
    kind: "scalar",
    sample: (x, y) => {
      let min = Infinity;
      for (let i = 0; i < n; i++) {
        const a = polygon[i];
        const b = polygon[(i + 1) % n];
        const d = pointToSegmentDist(x, y, a.x, a.y, b.x, b.y);
        if (d < min) min = d;
      }
      return pointInPolygon(x, y, polygon) ? -min : min;
    },
  };
}

/** Combine two scalar fields into one — the field-domain mixer. */
export function blendFields(
  a: ScalarField,
  b: ScalarField,
  mode: "add" | "mul" | "max" | "min" | "mix",
  mix = 0.5,
): ScalarField {
  return {
    kind: "scalar",
    sample: (x, y) => {
      const va = a.sample(x, y);
      const vb = b.sample(x, y);
      switch (mode) {
        case "add": return va + vb;
        case "mul": return va * vb;
        case "max": return Math.max(va, vb);
        case "min": return Math.min(va, vb);
        case "mix": return va * (1 - mix) + vb * mix;
      }
    },
  };
}
