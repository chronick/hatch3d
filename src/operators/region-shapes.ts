/**
 * region-shapes — derived regions: the geometry behind `regionOf`.
 *
 * A *derived region* is a closed area computed from some geometry that already
 * exists in the drawing, so a later layer can seek or avoid it by construction
 * ("progressive composition", design doc `active/plotter-art-workflow/design/
 * scene-ir.md` § Progressive composition semantics). Four kinds:
 *
 *   - `bbox`     — axis-aligned bounds. Exact.
 *   - `hull`     — convex hull. Exact (this is what the legacy `hullOf` means).
 *   - `outline`  — offset silhouette: the union of the geometry's strokes
 *                  buffered by a radius, recovered as rings. Approximate
 *                  (rasterised on a coarse grid, then marching-squares'd).
 *   - `occupied` — the same union at a small fixed radius ≈ one stroke width,
 *                  i.e. "where the ink actually is".
 *
 * `offsetPx` grows (+) or shrinks (−) the region: exact polygon offsetting for
 * bbox/hull, folded into the raster stroke radius for outline/occupied.
 * `cornerRadius` rounds the polygon's corners — with `bbox` that is the
 * rounded-rectangle idiom; outline/occupied are already round-cornered by the
 * buffering itself, so the parameter is ignored there (documented, not silent —
 * see `derivedRegionRings`).
 *
 * Everything here is pure, deterministic and dependency-free, and is shared by
 * the patch engine (`src/patch/graph.ts`) and by compositions that want the
 * same rounded-inset boundary (`cell-flow-gradient`). One implementation, two
 * consumers.
 *
 * Orientation convention: rings come back with a **positive shoelace area**,
 * matching `convexHull` in `src/utils/clip.ts`, so they can be fed straight to
 * `clipPolylineToConvexPolygon` (whose inside test is "left of the directed
 * edge"). In canvas coordinates (y down) that reads clockwise on screen; what
 * matters is that it is the same convention everywhere.
 */

import { convexHull } from "../utils/clip.js";
import { ringsFromThreshold, type Point, type Polyline } from "./silhouette-knockout.js";

export type { Point, Polyline };

// ── Region specification ─────────────────────────────────────────────

export type RegionKind = "bbox" | "hull" | "outline" | "occupied";

export interface RegionOfSpec {
  /** Node id whose geometry the region is derived from. */
  of: string;
  kind: RegionKind;
  /** Grow (+) / shrink (−) the region, in canvas px. Default 0. */
  offsetPx?: number;
  /** Round the region polygon's corners (bbox / hull only). Default 0. */
  cornerRadius?: number;
}

/** Stroke radius `outline` buffers by before `offsetPx` is added (canvas px). */
export const OUTLINE_BASE_RADIUS = 4;
/** Stroke radius `occupied` buffers by — roughly one pen width. */
export const OCCUPIED_BASE_RADIUS = 1;
/** Cells along the longest side of the occupancy raster (outline / occupied). */
export const RASTER_MAX_CELLS = 192;
/** Arc samples emitted per rounded corner. */
export const CORNER_ARC_SAMPLES = 8;

// ── Bounds ───────────────────────────────────────────────────────────

export interface BBox {
  xMin: number;
  yMin: number;
  xMax: number;
  yMax: number;
}

/** Axis-aligned bounds of every point in `lines`, or null when there are none. */
export function geometryBounds(lines: Polyline[]): BBox | null {
  let xMin = Infinity;
  let yMin = Infinity;
  let xMax = -Infinity;
  let yMax = -Infinity;
  for (const line of lines) {
    for (const p of line) {
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
      if (p.x < xMin) xMin = p.x;
      if (p.x > xMax) xMax = p.x;
      if (p.y < yMin) yMin = p.y;
      if (p.y > yMax) yMax = p.y;
    }
  }
  if (!Number.isFinite(xMin) || !Number.isFinite(yMin)) return null;
  return { xMin, yMin, xMax, yMax };
}

/** Grow (+) / shrink (−) a bbox on every side. Null when it collapses. */
export function offsetBBox(b: BBox, d: number): BBox | null {
  const out = { xMin: b.xMin - d, yMin: b.yMin - d, xMax: b.xMax + d, yMax: b.yMax + d };
  if (out.xMax - out.xMin <= 0 || out.yMax - out.yMin <= 0) return null;
  return out;
}

/** The bbox as a closed-by-convention 4-vertex ring (no repeated last point). */
export function bboxRing(b: BBox): Polyline {
  return [
    { x: b.xMin, y: b.yMin },
    { x: b.xMax, y: b.yMin },
    { x: b.xMax, y: b.yMax },
    { x: b.xMin, y: b.yMax },
  ];
}

// ── Polygon helpers ──────────────────────────────────────────────────

/** Signed shoelace area — positive for the convention used throughout. */
export function polygonArea(poly: Polyline): number {
  let sum = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    sum += poly[j].x * poly[i].y - poly[i].x * poly[j].y;
  }
  return sum / 2;
}

/** Reorient a ring to positive shoelace area (the module's convention). */
export function ensurePositiveArea(poly: Polyline): Polyline {
  return polygonArea(poly) < 0 ? [...poly].reverse() : poly;
}

/**
 * Clip a convex polygon by the half-plane left of the directed line a→b
 * (Sutherland–Hodgman). Used for exact inward offsetting.
 */
function clipPolygonByHalfPlane(poly: Polyline, a: Point, b: Point): Polyline {
  if (poly.length < 3) return [];
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const side = (p: Point) => dx * (p.y - a.y) - dy * (p.x - a.x);

  const out: Polyline = [];
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const cur = poly[i];
    const prev = poly[j];
    const dCur = side(cur);
    const dPrev = side(prev);
    if (dCur >= 0) {
      if (dPrev < 0) {
        const t = dPrev / (dPrev - dCur);
        out.push({ x: prev.x + t * (cur.x - prev.x), y: prev.y + t * (cur.y - prev.y) });
      }
      out.push({ x: cur.x, y: cur.y });
    } else if (dPrev >= 0) {
      const t = dPrev / (dPrev - dCur);
      out.push({ x: prev.x + t * (cur.x - prev.x), y: prev.y + t * (cur.y - prev.y) });
    }
  }
  return out.length >= 3 ? out : [];
}

/**
 * Offset a convex polygon by `d` px: positive grows, negative shrinks.
 *
 * Outward (d > 0): each edge slides along its outward normal and consecutive
 * offset lines are re-intersected — exact for a convex polygon (miter joins;
 * pass a `cornerRadius` afterwards if the miters at very sharp corners are
 * unwanted). Inward (d < 0): the polygon is clipped by each inward-offset
 * half-plane, which is exact and degrades gracefully to `[]` when the shape is
 * shrunk past collapse.
 */
export function offsetConvexPolygon(poly: Polyline, d: number): Polyline {
  const p = ensurePositiveArea(poly);
  if (p.length < 3) return [];
  if (Math.abs(d) < 1e-12) return p.map((q) => ({ x: q.x, y: q.y }));

  // Outward normal of edge i→i+1 for a positive-area ring is (dy, -dx).
  const n = p.length;
  const lines: { a: Point; b: Point }[] = [];
  for (let i = 0; i < n; i++) {
    const a = p[i];
    const b = p[(i + 1) % n];
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const len = Math.hypot(ex, ey);
    if (len < 1e-12) continue;
    const nx = (ey / len) * d;
    const ny = (-ex / len) * d;
    lines.push({ a: { x: a.x + nx, y: a.y + ny }, b: { x: b.x + nx, y: b.y + ny } });
  }
  if (lines.length < 3) return [];

  if (d < 0) {
    let clipped: Polyline = p.map((q) => ({ x: q.x, y: q.y }));
    for (const l of lines) {
      clipped = clipPolygonByHalfPlane(clipped, l.a, l.b);
      if (clipped.length < 3) return [];
    }
    return clipped;
  }

  const out: Polyline = [];
  for (let i = 0; i < lines.length; i++) {
    const prev = lines[(i - 1 + lines.length) % lines.length];
    const cur = lines[i];
    const hit = intersectLines(prev.a, prev.b, cur.a, cur.b);
    out.push(hit ?? { x: cur.a.x, y: cur.a.y });
  }
  return out.length >= 3 ? out : [];
}

/** Infinite-line intersection; null when (near-)parallel. */
function intersectLines(a1: Point, a2: Point, b1: Point, b2: Point): Point | null {
  const ax = a2.x - a1.x;
  const ay = a2.y - a1.y;
  const bx = b2.x - b1.x;
  const by = b2.y - b1.y;
  const denom = ax * by - ay * bx;
  if (Math.abs(denom) < 1e-12) return null;
  const t = ((b1.x - a1.x) * by - (b1.y - a1.y) * bx) / denom;
  return { x: a1.x + ax * t, y: a1.y + ay * t };
}

/**
 * Replace each corner of a polygon with a tangent circular arc of the given
 * radius, sampled into `samplesPerCorner + 1` points.
 *
 * The radius is clamped per corner so the arc's tangent points never run past
 * the midpoint of either adjacent edge — a radius larger than the shape simply
 * saturates instead of self-intersecting. Collinear vertices are passed
 * through untouched. With a bbox this is the rounded-rectangle idiom.
 */
export function roundPolygonCorners(
  poly: Polyline,
  radius: number,
  samplesPerCorner = CORNER_ARC_SAMPLES,
): Polyline {
  if (poly.length < 3 || !(radius > 0)) return poly.map((p) => ({ x: p.x, y: p.y }));
  const samples = Math.max(1, Math.floor(samplesPerCorner));
  const n = poly.length;
  const out: Polyline = [];

  for (let i = 0; i < n; i++) {
    const v = poly[i];
    const prev = poly[(i - 1 + n) % n];
    const next = poly[(i + 1) % n];

    const v1x = prev.x - v.x;
    const v1y = prev.y - v.y;
    const v2x = next.x - v.x;
    const v2y = next.y - v.y;
    const l1 = Math.hypot(v1x, v1y);
    const l2 = Math.hypot(v2x, v2y);
    if (l1 < 1e-9 || l2 < 1e-9) {
      out.push({ x: v.x, y: v.y });
      continue;
    }
    const u1 = { x: v1x / l1, y: v1y / l1 };
    const u2 = { x: v2x / l2, y: v2y / l2 };

    const cosA = Math.max(-1, Math.min(1, u1.x * u2.x + u1.y * u2.y));
    const angle = Math.acos(cosA); // interior angle at v
    if (angle < 1e-6 || Math.PI - angle < 1e-6) {
      out.push({ x: v.x, y: v.y }); // degenerate or collinear — nothing to round
      continue;
    }

    const half = angle / 2;
    let tangent = radius / Math.tan(half);
    tangent = Math.min(tangent, l1 / 2, l2 / 2);
    const rEff = tangent * Math.tan(half);
    if (!(rEff > 1e-9)) {
      out.push({ x: v.x, y: v.y });
      continue;
    }

    const a1 = { x: v.x + u1.x * tangent, y: v.y + u1.y * tangent };
    const a2 = { x: v.x + u2.x * tangent, y: v.y + u2.y * tangent };

    // Corner centre sits along the angle bisector, rEff / sin(half) away.
    let bx = u1.x + u2.x;
    let by = u1.y + u2.y;
    const bl = Math.hypot(bx, by);
    if (bl < 1e-9) {
      out.push({ x: v.x, y: v.y });
      continue;
    }
    bx /= bl;
    by /= bl;
    const centre = { x: v.x + bx * (rEff / Math.sin(half)), y: v.y + by * (rEff / Math.sin(half)) };

    const t1 = Math.atan2(a1.y - centre.y, a1.x - centre.x);
    const t2 = Math.atan2(a2.y - centre.y, a2.x - centre.x);
    let sweep = t2 - t1;
    while (sweep > Math.PI) sweep -= 2 * Math.PI;
    while (sweep < -Math.PI) sweep += 2 * Math.PI;

    for (let s = 0; s <= samples; s++) {
      const t = t1 + (sweep * s) / samples;
      out.push({ x: centre.x + rEff * Math.cos(t), y: centre.y + rEff * Math.sin(t) });
    }
  }

  return out;
}

/**
 * The rounded-inset boundary: shrink a convex polygon by `inset` px and round
 * the result's corners. This is the single implementation behind both the
 * patch `regionOf` rounding and the `cellFlowGradient` composition's cell
 * boundaries — the shared helper the design asked for.
 *
 * Returns `[]` when the inset collapses the polygon.
 */
export function insetAndRoundPolygon(
  poly: Polyline,
  inset: number,
  cornerRadius: number,
  samplesPerCorner = CORNER_ARC_SAMPLES,
): Polyline {
  const shrunk = inset > 0 ? offsetConvexPolygon(poly, -inset) : ensurePositiveArea(poly);
  if (shrunk.length < 3) return [];
  return cornerRadius > 0 ? roundPolygonCorners(shrunk, cornerRadius, samplesPerCorner) : shrunk;
}

// ── Buffered union (outline / occupied) ──────────────────────────────

/**
 * Rasterise the geometry's strokes buffered by `radius` onto a coarse grid and
 * recover the union's boundary as rings (marching squares, via
 * `ringsFromThreshold` — the grid is written "occupied = dark").
 *
 * This is the buffered-union approximation the design doc allows: it is not an
 * exact Minkowski sum, but it is stable, dependency-free, handles holes and
 * disjoint blobs correctly (each comes back as its own ring, which the
 * even-odd `pointInSilhouette` composes for free), and its resolution is
 * bounded by `maxCells` so cost does not blow up on a dense drawing.
 */
export function rasterUnionRings(
  lines: Polyline[],
  radius: number,
  maxCells = RASTER_MAX_CELLS,
): Polyline[] {
  if (!(radius > 0)) return [];
  const b = geometryBounds(lines);
  if (!b) return [];

  const cells = Math.max(8, Math.floor(maxCells));
  // One spare cell of padding beyond the buffer so blobs never touch the grid
  // edge (marching squares needs a bright border to close a ring).
  const spanX = b.xMax - b.xMin + 2 * radius;
  const spanY = b.yMax - b.yMin + 2 * radius;
  const cell = Math.max(Math.max(spanX, spanY) / cells, 1e-6);
  const gw = Math.max(3, Math.ceil(spanX / cell) + 4);
  const gh = Math.max(3, Math.ceil(spanY / cell) + 4);

  const x0 = b.xMin - radius - 2 * cell;
  const y0 = b.yMin - radius - 2 * cell;
  const box = { x0, y0, x1: x0 + gw * cell, y1: y0 + gh * cell };

  const grid = new Float32Array(gw * gh).fill(1); // 1 = empty, 0 = inked
  const rCells = radius / cell;
  const rCeil = Math.ceil(rCells);
  const r2 = rCells * rCells;

  /** Stamp a disc of `rCells` around a world point. */
  const stamp = (px: number, py: number) => {
    const cx = (px - x0) / cell - 0.5;
    const cy = (py - y0) / cell - 0.5;
    const gx0 = Math.max(0, Math.floor(cx - rCeil));
    const gx1 = Math.min(gw - 1, Math.ceil(cx + rCeil));
    const gy0 = Math.max(0, Math.floor(cy - rCeil));
    const gy1 = Math.min(gh - 1, Math.ceil(cy + rCeil));
    for (let gy = gy0; gy <= gy1; gy++) {
      const dy = gy - cy;
      for (let gx = gx0; gx <= gx1; gx++) {
        const dx = gx - cx;
        if (dx * dx + dy * dy <= r2) grid[gy * gw + gx] = 0;
      }
    }
  };

  const step = cell * 0.5;
  for (const line of lines) {
    if (line.length === 0) continue;
    if (line.length === 1) {
      stamp(line[0].x, line[0].y);
      continue;
    }
    for (let i = 0; i + 1 < line.length; i++) {
      const a = line[i];
      const c = line[i + 1];
      const len = Math.hypot(c.x - a.x, c.y - a.y);
      const n = Math.max(1, Math.ceil(len / step));
      for (let k = 0; k <= n; k++) {
        const t = k / n;
        stamp(a.x + (c.x - a.x) * t, a.y + (c.y - a.y) * t);
      }
    }
  }

  return ringsFromThreshold(
    { brightness: grid, width: gw, height: gh },
    0.5,
    box.x1 - box.x0,
    box.y1 - box.y0,
    box,
  );
}

// ── The public entry point ───────────────────────────────────────────

/**
 * Derive a region from geometry as a set of even-odd rings.
 *
 * `bbox` / `hull` always return exactly one ring (or none, for degenerate
 * input); `outline` / `occupied` may return several (one per blob, plus one
 * per hole). `cornerRadius` applies to `bbox` / `hull` only — the buffered
 * union already rounds its own corners by construction, so applying it to
 * `outline` / `occupied` would be a second, cruder approximation and is
 * deliberately a no-op there.
 */
export function derivedRegionRings(lines: Polyline[], spec: RegionOfSpec): Polyline[] {
  const offset = spec.offsetPx ?? 0;
  const corner = spec.cornerRadius ?? 0;

  switch (spec.kind) {
    case "bbox": {
      const b = geometryBounds(lines);
      if (!b) return [];
      const grown = offsetBBox(b, offset);
      if (!grown) return [];
      const ring = bboxRing(grown);
      return [corner > 0 ? roundPolygonCorners(ring, corner) : ring];
    }
    case "hull": {
      const hull = convexHull(lines.flat());
      if (hull.length < 3) return [];
      const grown = offsetConvexPolygon(hull, offset);
      if (grown.length < 3) return [];
      return [corner > 0 ? roundPolygonCorners(grown, corner) : grown];
    }
    case "outline":
      return rasterUnionRings(lines, OUTLINE_BASE_RADIUS + offset);
    case "occupied":
      return rasterUnionRings(lines, OCCUPIED_BASE_RADIUS + offset);
  }
}
