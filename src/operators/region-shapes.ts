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
 *                  (an exact distance field on an adaptive grid, then
 *                  marching-squares'd — see `rasterUnionRings`).
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
/**
 * Floor on cells along the longest side of the occupancy raster: the *coarsest*
 * the adaptive grid ever gets, and the resolution every grid used before
 * adaptivity existed.
 */
export const RASTER_MAX_CELLS = 192;
/**
 * Ceiling on cells along the longest side. This is the cost bound: the grid
 * never exceeds ~(cap + 4)² cells, so a drawing with hair-fine strokes pays a
 * bounded price instead of an unbounded one.
 */
export const RASTER_CAP_CELLS = 512;
/**
 * What the adaptive grid adapts *to*: cells across one stroke radius. The
 * buffered union's boundary is a curve of radius ≈ `radius`, so resolving it
 * needs cells small relative to the radius — not small relative to the drawing.
 */
export const RASTER_CELLS_PER_RADIUS = 4;
/**
 * Thinnest stroke the grid can represent, in cells. A stroke thinner than the
 * lattice's covering radius (cell/√2) samples as a *dotted* line, which
 * marching squares faithfully reports as dozens of specks instead of one band;
 * below this floor the radius is widened to the thinnest representable stroke
 * so the region stays connected and correctly-shaped, just fatter than asked.
 */
export const RASTER_MIN_RADIUS_CELLS = 1;
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

/** The adaptive grid `rasterUnionRings` will use for a given geometry + radius. */
export interface RasterGridSpec {
  /** Cell size in canvas px. */
  cell: number;
  /** Grid dimensions in cells. */
  gw: number;
  gh: number;
  /** World position of the grid origin (cell (0,0)'s centre is at +cell/2). */
  x0: number;
  y0: number;
  /** Cells along the longest side — what the cost bound is stated in. */
  cells: number;
  /**
   * The radius actually rasterised. Equal to `radius` except when the requested
   * stroke is thinner than `RASTER_MIN_RADIUS_CELLS` cells and the cap stops the
   * grid from getting finer; then it is widened to that floor.
   */
  effectiveRadius: number;
}

/**
 * Choose the raster grid for a buffered union — the adaptive-resolution rule.
 *
 * The old rule was "192 cells along the longest side, whatever the geometry",
 * which ties fidelity to the *drawing's extent* rather than to the feature being
 * resolved: a 4px outline around a 1500px drawing got 7.8px cells, and a 1px
 * `occupied` band asked for strokes eight times thinner than a cell — which
 * rasterises as a dotted line and comes back as hundreds of speck rings rather
 * than one band.
 *
 * The rule here scales resolution to the *stroke radius* instead — the thing the
 * ring is actually tracking — and clamps it between the old resolution (never
 * coarser than before) and {@link RASTER_CAP_CELLS} (the cost bound):
 *
 * ```text
 * cells = clamp(maxSpan · CELLS_PER_RADIUS / radius, MAX_CELLS, CAP_CELLS)
 * ```
 *
 * Returns null for empty geometry or a non-positive radius.
 */
export function rasterGridSpec(
  lines: Polyline[],
  radius: number,
  maxCells = RASTER_MAX_CELLS,
  capCells = RASTER_CAP_CELLS,
): RasterGridSpec | null {
  if (!(radius > 0)) return null;
  const b = geometryBounds(lines);
  if (!b) return null;

  const floorCells = Math.max(8, Math.floor(maxCells));
  const ceilCells = Math.max(floorCells, Math.floor(capCells));
  const maxSpan = Math.max(b.xMax - b.xMin + 2 * radius, b.yMax - b.yMin + 2 * radius, 1e-6);

  const wanted = Math.ceil((maxSpan * RASTER_CELLS_PER_RADIUS) / radius);
  const cells = Math.min(ceilCells, Math.max(floorCells, wanted));
  const cell = Math.max(maxSpan / cells, 1e-6);
  // A stroke thinner than the lattice can carry is widened rather than allowed
  // to disintegrate into specks (see RASTER_MIN_RADIUS_CELLS).
  const effectiveRadius = Math.max(radius, RASTER_MIN_RADIUS_CELLS * cell);

  // Two spare cells of padding beyond the buffer so blobs never touch the grid
  // edge (marching squares needs a bright border to close a ring).
  const gw = Math.max(3, Math.ceil((b.xMax - b.xMin + 2 * effectiveRadius) / cell) + 4);
  const gh = Math.max(3, Math.ceil((b.yMax - b.yMin + 2 * effectiveRadius) / cell) + 4);
  const x0 = b.xMin - effectiveRadius - 2 * cell;
  const y0 = b.yMin - effectiveRadius - 2 * cell;

  return { cell, gw, gh, x0, y0, cells, effectiveRadius };
}

/**
 * *Squared* distance from p to the segment a→b (a degenerate segment is a
 * point). Squared: the field accumulates minima, and min commutes with the
 * square root, so the root is taken once per cell at the end instead of once
 * per (cell, segment) pair — the inner loop is the hot path here.
 */
function distPointSegmentSq(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = 0;
  if (l2 > 1e-18) {
    t = ((px - ax) * dx + (py - ay) * dy) / l2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
  }
  const ex = px - (ax + t * dx);
  const ey = py - (ay + t * dy);
  return ex * ex + ey * ey;
}

/**
 * Rasterise the geometry's strokes buffered by `radius` and recover the union's
 * boundary as rings (marching squares, via `ringsFromThreshold`).
 *
 * The grid holds a **distance field** — each cell stores its exact distance to
 * the nearest stroke, normalised by the radius — rather than a 0/1 occupancy
 * mask. That matters twice over:
 *
 *  - `ringsFromThreshold` interpolates its crossings linearly along a cell edge.
 *    On a binary mask every crossing lands dead-centre, so the ring is quantised
 *    to half-cells (~½ cell of error, whatever the cell size). On a distance
 *    field the crossing lands where the distance actually equals the radius —
 *    and distance to a straight stroke *is* linear, so the error collapses to
 *    the field's curvature over one cell (≈ cell²/8r) instead of ½ cell.
 *  - No sampling along the stroke, so no scalloping: the field is computed from
 *    exact point-to-segment distances, evaluated only for cells within
 *    `radius + 2 cells` of a stroke (long segments are chunked so the visited
 *    band stays proportional to length × radius, not to length²).
 *
 * It is still not an exact Minkowski sum — the boundary is a polyline sampled on
 * a grid — but it is stable, dependency-free, handles holes and disjoint blobs
 * correctly (each comes back as its own ring, which the even-odd
 * `pointInSilhouette` composes for free), and its cost is bounded by
 * `capCells` (see {@link rasterGridSpec}).
 */
export function rasterUnionRings(
  lines: Polyline[],
  radius: number,
  maxCells = RASTER_MAX_CELLS,
  capCells = RASTER_CAP_CELLS,
): Polyline[] {
  const spec = rasterGridSpec(lines, radius, maxCells, capCells);
  if (!spec) return [];
  const { cell, gw, gh, x0, y0, effectiveRadius: r } = spec;
  const box = { x0, y0, x1: x0 + gw * cell, y1: y0 + gh * cell };

  // Cells farther than `reach` keep the sentinel: it is > r, so they are never
  // inside, and no boundary edge can touch one — distance is 1-Lipschitz, so a
  // cell next to an inside cell is within r + cell < reach of a stroke and has
  // therefore been visited and holds its exact distance.
  const reach = r + 2 * cell;
  // Held squared until the final pass (see `distPointSegmentSq`).
  const field = new Float32Array(gw * gh).fill((reach + cell) * (reach + cell));

  // Symmetrically: a cell already known to be more than a cell's width *inside*
  // the boundary can never move it. Its own neighbours are then all inside too
  // (1-Lipschitz again), so every grid edge touching it joins two inside
  // corners and no crossing is ever interpolated along it. Skipping those cells
  // is exact — the rings come back bit-identical — and it is what keeps a
  // saturated canvas from re-measuring the same deep interior once per stroke.
  const skipInside = Math.max(0, r - 1.001 * cell);
  const skipBelowSq = skipInside * skipInside;

  /** Fold one segment's exact distances into the field over its reach band. */
  const addSegment = (ax: number, ay: number, bx: number, by: number) => {
    if (!Number.isFinite(ax) || !Number.isFinite(ay)) return;
    if (!Number.isFinite(bx) || !Number.isFinite(by)) return;
    const gx0 = Math.max(0, Math.floor((Math.min(ax, bx) - reach - x0) / cell - 0.5));
    const gx1 = Math.min(gw - 1, Math.ceil((Math.max(ax, bx) + reach - x0) / cell - 0.5));
    const gy0 = Math.max(0, Math.floor((Math.min(ay, by) - reach - y0) / cell - 0.5));
    const gy1 = Math.min(gh - 1, Math.ceil((Math.max(ay, by) + reach - y0) / cell - 0.5));
    for (let gy = gy0; gy <= gy1; gy++) {
      const py = y0 + (gy + 0.5) * cell;
      const row = gy * gw;
      for (let gx = gx0; gx <= gx1; gx++) {
        const cur = field[row + gx];
        if (cur < skipBelowSq) continue;
        const px = x0 + (gx + 0.5) * cell;
        const d2 = distPointSegmentSq(px, py, ax, ay, bx, by);
        if (d2 < cur) field[row + gx] = d2;
      }
    }
  };

  // A segment's axis-aligned reach box is O(len²) for a long diagonal, so walk
  // it in chunks of ~2·reach and keep every box O(reach²).
  const chunkLen = Math.max(2 * reach, cell);
  for (const line of lines) {
    if (line.length === 0) continue;
    if (line.length === 1) {
      addSegment(line[0].x, line[0].y, line[0].x, line[0].y);
      continue;
    }
    for (let i = 0; i + 1 < line.length; i++) {
      const a = line[i];
      const c = line[i + 1];
      const len = Math.hypot(c.x - a.x, c.y - a.y);
      const n = Math.max(1, Math.ceil(len / chunkLen));
      for (let k = 0; k < n; k++) {
        const t0 = k / n;
        const t1 = (k + 1) / n;
        addSegment(
          a.x + (c.x - a.x) * t0,
          a.y + (c.y - a.y) * t0,
          a.x + (c.x - a.x) * t1,
          a.y + (c.y - a.y) * t1,
        );
      }
    }
  }

  // Un-square, and normalise so the boundary sits at 1 — which is also what
  // `ringsFromThreshold` reads outside the image, so an edge-touching blob still
  // closes correctly.
  for (let i = 0; i < field.length; i++) field[i] = Math.sqrt(field[i]) / r;

  return ringsFromThreshold(
    { brightness: field, width: gw, height: gh },
    1,
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
