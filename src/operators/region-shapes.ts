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
import {
  pointInSilhouette,
  ringsFromThreshold,
  type Point,
  type Polyline,
} from "./silhouette-knockout.js";

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
 * adaptivity existed. A cap below this floor still wins — see
 * {@link rasterGridSpec}.
 */
export const RASTER_MAX_CELLS = 192;
/**
 * *Default* ceiling on cells along the longest side. This is the cost bound: the
 * grid never exceeds ~(cap + 6)² cells, so a drawing with hair-fine strokes pays
 * a bounded price instead of an unbounded one. A caller may name its own
 * `capCells` — smaller or larger — and that value wins outright; see
 * {@link rasterGridSpec}.
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
 * coarser than before unless a caller asks for a smaller cap) and
 * {@link RASTER_CAP_CELLS} (the cost bound):
 *
 * ```text
 * cells = min(capCells, max(maxCells, maxSpan · CELLS_PER_RADIUS / radius))
 * ```
 *
 * **The two bounds are not symmetric, and the cap is applied last.** `maxCells`
 * is a *floor* (the coarsest the grid may get); `capCells` is a true *ceiling*
 * and always wins, so:
 *
 *  - `capCells = 8` really does give an 8-cell grid — an explicit small cap
 *    beats the 192 floor rather than being swallowed by it. The grid itself is
 *    `cells + 4` cells per side (the border padding marching squares needs),
 *    plus up to 2 more when a sub-cell radius has been widened, so `cap + 6` is
 *    the true physical bound on `gw`/`gh`.
 *  - `capCells = 700` really does allow 700 cells: {@link RASTER_CAP_CELLS} is
 *    the *default* cost bound, not a law, and a caller who names a larger one
 *    has priced it themselves. Only the default is 512.
 *  - `maxCells` above `capCells` does not raise the ceiling — the floor is
 *    clamped down to the cap. Ask for a finer grid by raising the cap
 *    (`rasterGridSpec(lines, r, 700, 700)`), not by raising the floor.
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

  // One cell is the smallest grid that means anything; NaN falls back to the
  // module defaults rather than poisoning every dimension downstream.
  const cellCount = (v: number, fallback: number) =>
    Number.isFinite(v) ? Math.max(1, Math.floor(v)) : fallback;
  const ceilCells = cellCount(capCells, RASTER_CAP_CELLS);
  const floorCells = Math.min(ceilCells, cellCount(maxCells, RASTER_MAX_CELLS));
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
 * Fill `field` with the distance from each cell centre to the nearest stroke,
 * normalised by `radius` — so the buffered union's boundary sits at exactly 1,
 * which is also what `ringsFromThreshold` reads outside the grid, so an
 * edge-touching blob still closes correctly.
 *
 * Shared by the main raster and by the refinement windows below, so both read
 * the *same* field, just at different cell sizes.
 *
 * Two exact short-cuts keep it linear in ink rather than in area:
 *
 *  - Cells farther than `reach = radius + 2 cells` from every stroke keep the
 *    sentinel, which is > 1: distance is 1-Lipschitz, so a cell next to an
 *    inside cell is within `radius + cell < reach` of a stroke and has therefore
 *    been visited and holds its exact distance. No boundary edge can touch a
 *    sentinel cell.
 *  - Symmetrically, a cell already known to be more than a cell's width *inside*
 *    the boundary can never move it, and its neighbours are all inside too, so
 *    no crossing is ever interpolated along an edge touching it. Skipping those
 *    is what keeps a saturated canvas from re-measuring the same deep interior
 *    once per stroke.
 */
function rasterizeDistanceField(
  lines: Polyline[],
  radius: number,
  cell: number,
  gw: number,
  gh: number,
  x0: number,
  y0: number,
): Float32Array {
  const reach = radius + 2 * cell;
  // Held squared until the final pass (see `distPointSegmentSq`).
  const field = new Float32Array(gw * gh).fill((reach + cell) * (reach + cell));
  const skipInside = Math.max(0, radius - 1.001 * cell);
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

  for (let i = 0; i < field.length; i++) field[i] = Math.sqrt(field[i]) / radius;
  return field;
}

/**
 * How much finer the refinement window is sampled than the main grid — and so
 * the raster's actual resolution claim: it can tell an enclosed pocket from a
 * channel down to a sixteenth of a cell, and no finer.
 *
 * It is not a free parameter. The sharpest artefact in the suite is the cusp
 * where two nearly-tangent discs cross (r=10, centres 19.9 apart): the exterior
 * wedge there opens by only 11.5°, so at 4× — a quarter-cell — the wedge is
 * still thinner than one sample near its tip, the flood fill cannot get out of
 * it, and the speck is wrongly confirmed as a real hole. 8× clears that case and
 * 16× leaves a factor of two in hand. The window is a handful of cells across
 * either way, so this is a few thousand distance evaluations, not a rasterise.
 */
export const REFINE_FACTOR = 16;
/** Cells of margin added around a candidate ring's bbox to make its window. */
export const REFINE_PAD_CELLS = 2;
/**
 * Refined cells one `rasterUnionRings` call may spend on refinement in total —
 * the cost bound, the same role {@link RASTER_CAP_CELLS} plays for the main
 * grid. A compact candidate costs ≈(2·PAD·FACTOR)² ≈ 6.5k of it, so this is
 * ~160 of them; a drawing that somehow sheds more sub-cell rings than that gets
 * the honest resolution statement for the rest (a feature the raster cannot
 * afford to look at is a feature it cannot claim) rather than an unbounded bill.
 */
export const REFINE_CELL_BUDGET = 1 << 20;

/** What `rasterUnionRings` did with the sub-cell rings it found, for tests. */
export interface RasterRefineStats {
  /** Rings enclosing at most one cell — the ones sent for refinement. */
  candidates: number;
  /** …of those, the ones the refined field confirmed as real features. */
  kept: number;
  /** …and the ones it showed to be sampling artefacts. */
  dropped: number;
}

/**
 * Is a sub-cell ring a real enclosed feature, or an artefact of sampling?
 *
 * A ring enclosing less than one cell is below the main grid's sampling scale,
 * and *that grid* has no evidence either way about it — but the raster does. It
 * holds the exact segment set and the exact distance function, so instead of
 * guessing from the ring's area it can go and look: re-rasterise the same field
 * over a small window around the candidate at {@link REFINE_FACTOR}× the
 * resolution and ask the question the ring is claiming an answer to — *is this
 * pocket actually enclosed?*
 *
 * The window is the ring's bbox plus {@link REFINE_PAD_CELLS} coarse cells on
 * every side, which is wider than any feature a sub-cell ring can be hiding, so
 * "the pocket reaches the window border" really does mean "the pocket connects
 * to the outside world".
 *
 * The two cases this separates, both of which really occur:
 *
 *  - **Real.** A closed square outline buffered until its interior nearly closes
 *    leaves a genuine pinhole at the centre — the grid catches a single sample
 *    inside it, and blanket-filtering by area erased a hole that is actually
 *    there, flipping the centre of the shape from outside the silhouette to
 *    inside. Refined, the pocket is still enclosed: kept.
 *  - **Artefact.** Where two buffered discs cross, the exterior has a reflex
 *    cusp whose channel to the outside is finer than a cell, so a sample just
 *    inside the tip reads as an enclosed hole. Refined, the channel opens and
 *    the pocket walks out to the window border: dropped.
 *
 * Islands (a positive sub-cell ring — a speck of ink rather than a pocket of
 * paper) go through exactly the same test with the classes swapped: a speck that
 * turns out to be connected to the main blob through a sub-cell isthmus is the
 * same artefact wearing the other colour.
 *
 * Two decisions worth naming:
 *
 *  - **The coarse ring is kept, not the refined one.** The refined contour would
 *    track the pocket better, but it would be a contour of a *different* grid:
 *    mixed-resolution rings can cross each other, and even-odd fill over
 *    crossing rings is meaningless. Sibling rings all being contours of one
 *    field is what makes the even-odd composition sound, so refinement is used
 *    as evidence only.
 *  - **No seed, no keep.** If the refined window holds no cell of the pocket's
 *    own class inside the candidate ring, the feature did not survive refinement
 *    either and the raster is not entitled to report it.
 *
 * `budget` is the caller's remaining refined-cell allowance; it is debited by
 * the window this call opens, and a window that will not fit in what is left is
 * not opened at all (see {@link REFINE_CELL_BUDGET}).
 */
function subCellRingIsReal(
  lines: Polyline[],
  radius: number,
  ring: Polyline,
  cell: number,
  budget: { cells: number },
): boolean {
  const area = polygonArea(ring);
  if (area === 0) return false; // encloses nothing measurable
  // Rings come off `ringsFromThreshold` oriented with the ink on one side, so
  // the sign says which class the ring encloses: negative is a pocket of
  // paper (a hole), positive a speck of ink (an island).
  const wantInside = area > 0;

  let xMin = Infinity;
  let yMin = Infinity;
  let xMax = -Infinity;
  let yMax = -Infinity;
  for (const p of ring) {
    if (p.x < xMin) xMin = p.x;
    if (p.x > xMax) xMax = p.x;
    if (p.y < yMin) yMin = p.y;
    if (p.y > yMax) yMax = p.y;
  }
  if (!Number.isFinite(xMin) || !Number.isFinite(yMin)) return false;

  const pad = REFINE_PAD_CELLS * cell;
  const rcell = cell / REFINE_FACTOR;
  const x0 = xMin - pad;
  const y0 = yMin - pad;
  const gw = Math.max(3, Math.ceil((xMax - xMin + 2 * pad) / rcell));
  const gh = Math.max(3, Math.ceil((yMax - yMin + 2 * pad) / rcell));
  // A ring can be sub-cell in *area* and still span many cells (a hairline
  // sliver between two blobs), so the window is not bounded by the trigger.
  if (gw * gh > budget.cells) return false;
  budget.cells -= gw * gh;

  const field = rasterizeDistanceField(lines, radius, rcell, gw, gh, x0, y0);
  const isWanted = (i: number) => field[i] < 1 === wantInside;

  // Seed from every refined cell inside the candidate ring that carries the
  // enclosed class; if the feature has vanished at this resolution there are
  // none, and the raster has no evidence to report it with. Only the ring's own
  // bbox can hold such a cell, so the point-in-ring test never runs over the
  // padding.
  const stack: number[] = [];
  const seen = new Uint8Array(gw * gh);
  const lo = (v: number, n: number) => Math.max(0, Math.min(n - 1, Math.floor(v / rcell - 0.5)));
  const hi = (v: number, n: number) => Math.max(0, Math.min(n - 1, Math.ceil(v / rcell)));
  for (let gy = lo(yMin - y0, gh); gy <= hi(yMax - y0, gh); gy++) {
    for (let gx = lo(xMin - x0, gw); gx <= hi(xMax - x0, gw); gx++) {
      const i = gy * gw + gx;
      if (!isWanted(i)) continue;
      const p = { x: x0 + (gx + 0.5) * rcell, y: y0 + (gy + 0.5) * rcell };
      if (!pointInSilhouette(p, [ring])) continue;
      seen[i] = 1;
      stack.push(i);
    }
  }
  if (stack.length === 0) return false;

  // Flood-fill that class. Touching the window border means the pocket is not
  // enclosed at all — it drains out through a channel finer than a coarse cell.
  while (stack.length > 0) {
    const i = stack.pop()!;
    const gx = i % gw;
    const gy = (i - gx) / gw;
    if (gx === 0 || gy === 0 || gx === gw - 1 || gy === gh - 1) return false;
    const neighbours = [i - 1, i + 1, i - gw, i + gw];
    for (const n of neighbours) {
      if (seen[n] || !isWanted(n)) continue;
      seen[n] = 1;
      stack.push(n);
    }
  }
  return true;
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
 *
 * Features finer than one cell are not guessed at from their size but looked at
 * — see {@link subCellRingIsReal}. Pass `stats` to see how many there were and
 * which way each went; it is the only window onto a decision that is otherwise
 * invisible in the output.
 */
export function rasterUnionRings(
  lines: Polyline[],
  radius: number,
  maxCells = RASTER_MAX_CELLS,
  capCells = RASTER_CAP_CELLS,
  stats?: RasterRefineStats,
): Polyline[] {
  const spec = rasterGridSpec(lines, radius, maxCells, capCells);
  if (!spec) return [];
  const { cell, gw, gh, x0, y0, effectiveRadius: r } = spec;
  const box = { x0, y0, x1: x0 + gw * cell, y1: y0 + gh * cell };

  const field = rasterizeDistanceField(lines, r, cell, gw, gh, x0, y0);
  const rings = ringsFromThreshold(
    { brightness: field, width: gw, height: gh },
    1,
    box.x1 - box.x0,
    box.y1 - box.y0,
    box,
  );

  // A ring enclosing at most one grid cell is below *this* grid's sampling
  // scale, but not below the raster's: it still holds the exact segments, so
  // each such ring is decided by re-rasterising a small window around it at a
  // finer resolution rather than by its area (see `subCellRingIsReal`).
  const cellArea = cell * cell;
  const budget = { cells: REFINE_CELL_BUDGET };
  return rings.filter((ring) => {
    if (Math.abs(polygonArea(ring)) > cellArea) return true;
    if (stats) stats.candidates++;
    const real = subCellRingIsReal(lines, r, ring, cell, budget);
    if (stats) {
      if (real) stats.kept++;
      else stats.dropped++;
    }
    return real;
  });
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
