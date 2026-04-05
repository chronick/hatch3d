import { createNoise2D } from "simplex-noise";
import type { Composition2DDefinition } from "../../types";

// ── Seeded PRNG ──

function mulberry32(a: number) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── FBM (Fractal Brownian Motion) ──

function fbm(
  noise2D: (x: number, y: number) => number,
  x: number,
  y: number,
  noiseScale: number,
  octaves: number,
  lacunarity: number,
  persistence: number,
): number {
  let value = 0;
  let amp = 1;
  let freq = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    value += amp * noise2D(x * noiseScale * freq, y * noiseScale * freq);
    norm += amp;
    amp *= persistence;
    freq *= lacunarity;
  }
  return value / norm;
}

// ── Marching squares ──

interface Segment {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * Linear interpolation between two grid values to find the threshold crossing.
 * Returns a fraction [0, 1] along the edge from a to b.
 */
function lerp01(a: number, b: number, threshold: number): number {
  const d = b - a;
  if (Math.abs(d) < 1e-10) return 0.5;
  return (threshold - a) / d;
}

/**
 * Extract contour segments for a single threshold level using marching squares.
 * Grid is stored as a flat array with (cols) width and (rows) height.
 */
function marchingSquares(
  field: Float64Array,
  cols: number,
  rows: number,
  cellW: number,
  cellH: number,
  offsetX: number,
  offsetY: number,
  threshold: number,
): Segment[] {
  const segments: Segment[] = [];

  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      // Corner values (top-left, top-right, bottom-right, bottom-left)
      const tl = field[r * cols + c];
      const tr = field[r * cols + c + 1];
      const br = field[(r + 1) * cols + c + 1];
      const bl = field[(r + 1) * cols + c];

      // Classify corners: 1 if above threshold, 0 if below
      const idx =
        (tl >= threshold ? 8 : 0) |
        (tr >= threshold ? 4 : 0) |
        (br >= threshold ? 2 : 0) |
        (bl >= threshold ? 1 : 0);

      if (idx === 0 || idx === 15) continue;

      // Cell corner positions in world space
      const x0 = offsetX + c * cellW;
      const y0 = offsetY + r * cellH;
      const x1 = x0 + cellW;
      const y1 = y0 + cellH;

      // Interpolated edge midpoints
      const top = x0 + lerp01(tl, tr, threshold) * cellW;
      const bottom = x0 + lerp01(bl, br, threshold) * cellW;
      const left = y0 + lerp01(tl, bl, threshold) * cellH;
      const right = y0 + lerp01(tr, br, threshold) * cellH;

      // 16 cases → line segments
      switch (idx) {
        case 1:
          segments.push({ x0: x0, y0: left, x1: bottom, y1: y1 });
          break;
        case 2:
          segments.push({ x0: bottom, y0: y1, x1: x1, y1: right });
          break;
        case 3:
          segments.push({ x0: x0, y0: left, x1: x1, y1: right });
          break;
        case 4:
          segments.push({ x0: top, y0: y0, x1: x1, y1: right });
          break;
        case 5:
          // Saddle: use average to disambiguate
          segments.push({ x0: x0, y0: left, x1: top, y1: y0 });
          segments.push({ x0: bottom, y0: y1, x1: x1, y1: right });
          break;
        case 6:
          segments.push({ x0: top, y0: y0, x1: bottom, y1: y1 });
          break;
        case 7:
          segments.push({ x0: x0, y0: left, x1: top, y1: y0 });
          break;
        case 8:
          segments.push({ x0: top, y0: y0, x1: x0, y1: left });
          break;
        case 9:
          segments.push({ x0: top, y0: y0, x1: bottom, y1: y1 });
          break;
        case 10:
          // Saddle: use average to disambiguate
          segments.push({ x0: top, y0: y0, x1: x1, y1: right });
          segments.push({ x0: x0, y0: left, x1: bottom, y1: y1 });
          break;
        case 11:
          segments.push({ x0: top, y0: y0, x1: x1, y1: right });
          break;
        case 12:
          segments.push({ x0: x0, y0: left, x1: x1, y1: right });
          break;
        case 13:
          segments.push({ x0: bottom, y0: y1, x1: x1, y1: right });
          break;
        case 14:
          segments.push({ x0: x0, y0: left, x1: bottom, y1: y1 });
          break;
      }
    }
  }

  return segments;
}

// ── Segment chaining ──

/**
 * Chain disconnected line segments into continuous polylines by matching endpoints.
 * Uses spatial hashing for efficient O(n) chaining.
 */
function chainSegments(
  segments: Segment[],
  tolerance: number,
): { x: number; y: number }[][] {
  if (segments.length === 0) return [];

  // Spatial hash for endpoint matching
  const snap = (v: number) => Math.round(v / tolerance);
  const key = (x: number, y: number) => `${snap(x)},${snap(y)}`;

  // Build adjacency: each endpoint maps to segment indices
  const endpointMap = new Map<string, number[]>();

  function addEndpoint(k: string, segIdx: number) {
    const list = endpointMap.get(k);
    if (list) list.push(segIdx);
    else endpointMap.set(k, [segIdx]);
  }

  for (let i = 0; i < segments.length; i++) {
    const s = segments[i];
    addEndpoint(key(s.x0, s.y0), i);
    addEndpoint(key(s.x1, s.y1), i);
  }

  const used = new Uint8Array(segments.length);
  const polylines: { x: number; y: number }[][] = [];

  for (let i = 0; i < segments.length; i++) {
    if (used[i]) continue;
    used[i] = 1;

    const s = segments[i];
    const chain: { x: number; y: number }[] = [
      { x: s.x0, y: s.y0 },
      { x: s.x1, y: s.y1 },
    ];

    // Extend forward from the last point
    let extended = true;
    while (extended) {
      extended = false;
      const tail = chain[chain.length - 1];
      const k = key(tail.x, tail.y);
      const neighbors = endpointMap.get(k);
      if (!neighbors) break;
      for (const ni of neighbors) {
        if (used[ni]) continue;
        used[ni] = 1;
        const ns = segments[ni];
        const k0 = key(ns.x0, ns.y0);
        if (k0 === k) {
          chain.push({ x: ns.x1, y: ns.y1 });
        } else {
          chain.push({ x: ns.x0, y: ns.y0 });
        }
        extended = true;
        break;
      }
    }

    // Extend backward from the first point
    extended = true;
    while (extended) {
      extended = false;
      const head = chain[0];
      const k = key(head.x, head.y);
      const neighbors = endpointMap.get(k);
      if (!neighbors) break;
      for (const ni of neighbors) {
        if (used[ni]) continue;
        used[ni] = 1;
        const ns = segments[ni];
        const k0 = key(ns.x0, ns.y0);
        if (k0 === k) {
          chain.unshift({ x: ns.x1, y: ns.y1 });
        } else {
          chain.unshift({ x: ns.x0, y: ns.y0 });
        }
        extended = true;
        break;
      }
    }

    polylines.push(chain);
  }

  return polylines;
}

// ── Parallel offset for index contours ──

/**
 * Compute a parallel offset of a polyline by a signed distance.
 * Positive = offset to the left of travel direction, negative = right.
 */
function offsetPolyline(
  poly: { x: number; y: number }[],
  distance: number,
): { x: number; y: number }[] {
  if (poly.length < 2) return [];

  const result: { x: number; y: number }[] = [];

  for (let i = 0; i < poly.length; i++) {
    // Compute local tangent direction
    let dx: number, dy: number;
    if (i === 0) {
      dx = poly[1].x - poly[0].x;
      dy = poly[1].y - poly[0].y;
    } else if (i === poly.length - 1) {
      dx = poly[i].x - poly[i - 1].x;
      dy = poly[i].y - poly[i - 1].y;
    } else {
      dx = poly[i + 1].x - poly[i - 1].x;
      dy = poly[i + 1].y - poly[i - 1].y;
    }

    const len = Math.hypot(dx, dy);
    if (len < 1e-10) {
      result.push({ x: poly[i].x, y: poly[i].y });
      continue;
    }

    // Normal is perpendicular to tangent (rotated 90 degrees CCW)
    const nx = -dy / len;
    const ny = dx / len;

    result.push({
      x: poly[i].x + nx * distance,
      y: poly[i].y + ny * distance,
    });
  }

  return result;
}

// ── Composition definition ──

const contourMap: Composition2DDefinition = {
  id: "contourMap",
  name: "Contour Map",
  description: "Topographic contour lines from layered noise terrain",
  tags: ["generative", "contour", "topographic", "noise", "terrain"],
  category: "2d",
  type: "2d",

  controls: {
    noiseScale: {
      type: "slider",
      label: "Noise Scale",
      default: 0.003,
      min: 0.001,
      max: 0.015,
      step: 0.0005,
      group: "Terrain",
    },
    octaves: {
      type: "slider",
      label: "Octaves",
      default: 4,
      min: 1,
      max: 8,
      step: 1,
      group: "Terrain",
    },
    lacunarity: {
      type: "slider",
      label: "Lacunarity",
      default: 2,
      min: 1.2,
      max: 4,
      step: 0.1,
      group: "Terrain",
    },
    persistence: {
      type: "slider",
      label: "Persistence",
      default: 0.5,
      min: 0.1,
      max: 0.9,
      step: 0.05,
      group: "Terrain",
    },
    contourLevels: {
      type: "slider",
      label: "Contour Levels",
      default: 20,
      min: 5,
      max: 60,
      step: 1,
      group: "Contours",
    },
    gridResolution: {
      type: "slider",
      label: "Resolution",
      default: 2,
      min: 0.5,
      max: 5,
      step: 0.25,
      group: "Contours",
    },
    indexInterval: {
      type: "slider",
      label: "Index Interval",
      default: 5,
      min: 0,
      max: 10,
      step: 1,
      group: "Contours",
    },
    indexThickness: {
      type: "slider",
      label: "Index Thickness",
      default: 1,
      min: 0.5,
      max: 3,
      step: 0.25,
      group: "Contours",
    },
    seed: {
      type: "slider",
      label: "Seed",
      default: 42,
      min: 0,
      max: 999,
      step: 1,
      group: "Terrain",
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
  },

  generate({ width, height, values }) {
    const noiseScale = values.noiseScale as number;
    const octaves = Math.round(values.octaves as number);
    const lacunarity = values.lacunarity as number;
    const persistence = values.persistence as number;
    const contourLevels = Math.round(values.contourLevels as number);
    const gridRes = values.gridResolution as number;
    const indexInterval = Math.round(values.indexInterval as number);
    const indexThickness = values.indexThickness as number;
    const seed = Math.round(values.seed as number);
    const margin = values.margin as number;

    // Seeded noise
    const rng = mulberry32(seed);
    const noise2D = createNoise2D(() => rng());

    // Working area
    const x0 = margin;
    const y0 = margin;
    const w = width - margin * 2;
    const h = height - margin * 2;

    if (w <= 0 || h <= 0) return [];

    // Build scalar field on grid
    const cols = Math.ceil(w / gridRes) + 1;
    const rows = Math.ceil(h / gridRes) + 1;
    const cellW = w / (cols - 1);
    const cellH = h / (rows - 1);
    const field = new Float64Array(cols * rows);

    let fieldMin = Infinity;
    let fieldMax = -Infinity;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const px = x0 + c * cellW;
        const py = y0 + r * cellH;
        const v = fbm(noise2D, px, py, noiseScale, octaves, lacunarity, persistence);
        field[r * cols + c] = v;
        if (v < fieldMin) fieldMin = v;
        if (v > fieldMax) fieldMax = v;
      }
    }

    // Extract contours at evenly-spaced levels
    const allPolylines: { x: number; y: number }[][] = [];
    const chainTolerance = gridRes * 0.5;

    for (let i = 1; i <= contourLevels; i++) {
      const t = i / (contourLevels + 1);
      const threshold = fieldMin + t * (fieldMax - fieldMin);

      const segments = marchingSquares(
        field, cols, rows, cellW, cellH, x0, y0, threshold,
      );

      const chains = chainSegments(segments, chainTolerance);

      const isIndex = indexInterval > 0 && i % indexInterval === 0;

      for (const chain of chains) {
        if (chain.length < 2) continue;

        allPolylines.push(chain);

        // Add parallel offsets for index contours
        if (isIndex && indexThickness > 0) {
          const offsetPos = offsetPolyline(chain, indexThickness);
          const offsetNeg = offsetPolyline(chain, -indexThickness);
          if (offsetPos.length >= 2) allPolylines.push(offsetPos);
          if (offsetNeg.length >= 2) allPolylines.push(offsetNeg);
        }
      }
    }

    return allPolylines;
  },
};

export default contourMap;
