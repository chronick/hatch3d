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
 *
 * One drawing shape buys past it deliberately: when the union's *features* are
 * about a cell across and there are tens of thousands of them, `rasterUnionRings`
 * re-rasters the whole extent {@link ESCALATE_FACTOR}× finer rather than examine
 * each one, so the raster it actually allocates is up to `ESCALATE_FACTOR²`
 * times this — still bounded, by {@link ESCALATE_MAX_CELLS}, and *cheaper* than
 * the per-window refinement it replaces.
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
 * Refined cells a *single* candidate's window may cost.
 *
 * Windows are tiny — the padding alone is (2·PAD·FACTOR)² = 4k cells, and a
 * compact candidate's own span takes it to ≈6.5k — so
 * this is not the interesting bound; it exists because a ring can be sub-cell in
 * *area* and still span many cells (a hairline sliver between two blobs), and
 * such a window would otherwise scale with the drawing rather than with the
 * feature. 64k allows a window 16 coarse cells on a side, which is four times
 * wider than the pad on every side and comfortably wider than any feature a
 * sub-cell ring can be hiding.
 */
export const REFINE_WINDOW_CELLS = 1 << 16;
/**
 * Refined cells one `rasterUnionRings` call may spend on refinement in total —
 * the cost bound, the same role {@link RASTER_CAP_CELLS} plays for the main
 * grid. A compact candidate costs ≈6.5k of it, so this is ~160 of them.
 *
 * **Exhausting it preserves, it does not delete.** Refinement is *evidence*
 * against the raw contour, and a candidate the raster could not afford to look
 * at has produced no evidence either way — so it keeps the ring marching squares
 * actually drew (counted as `keptUnrefined`, never as `dropped`). The earlier
 * reading, "over budget ⇒ not real", failed closed: a drawing whose buffer
 * leaves a dense lattice of genuine sub-cell holes — 3 136 of them in the
 * reviewer's grid fixture — spent the budget on the first ~160 and then had the
 * remaining 2 977 real holes filled in on no evidence at all.
 *
 * The budget is one-shot rather than a per-candidate quota: the first window
 * that will not fit ends refinement for the whole call, so the outcome does not
 * depend on the order rings happen to come off the contouring pass.
 *
 * **Sizing is proportional to the coarse raster, not fixed.** A fixed cap
 * fails functionally on dense hole fields: a kept-but-unrefined coarse ring is
 * positionally untrustworthy (displaced by up to a cell), so on the reviewer's
 * adversarial 3 136-hole lattice a 2^20 cap left 1 715 real holes classifying
 * as ink despite every ring being "preserved". The budget therefore scales as
 * `REFINE_BUDGET_PER_COARSE_CELL x` the coarse grid, with the fixed value as a
 * floor — refinement is a bounded multiple of work already done.
 *
 * **And exhausting it is now a signal, not just an outcome.** Round-6 showed a
 * density where no allowance helps, because the windows overlap and the demand
 * grows ~600× the grid: the budget is therefore consulted *before* any window
 * opens, and a candidate set that would exhaust it escalates to a whole-extent
 * fine raster instead (see {@link ESCALATE_FACTOR}). What remains here is the
 * genuine last resort — a fine pass that still exhausts, which fail-preserves
 * exactly as described above.
 */
export const REFINE_CELL_BUDGET = 1 << 20;
/** Refined-cell allowance per coarse grid cell (see {@link REFINE_CELL_BUDGET}). */
export const REFINE_BUDGET_PER_COARSE_CELL = 128;
/**
 * How much finer the *escalated* whole-extent raster is than the coarse one —
 * the answer to per-window refinement's density ceiling.
 *
 * Per-window refinement is the right tool for a handful of sub-cell features on
 * an otherwise coarse-resolvable drawing. It is the wrong tool at plotter
 * material density, and not by a tunable margin: a window is `(span + 2·PAD)·
 * FACTOR` cells on a side — ~5.6k cells for a compact candidate — so a drawing
 * whose candidates sit one per few coarse cells demands *hundreds* of times the
 * whole grid in refinement. The reviewer's 170×170 pocket lattice (pitch 20,
 * radius 4, 342 strokes over a 3 400px extent) is exactly that: 28 899
 * candidates × ~5.6k = 162M refined cells against a 34.2M allowance, so 22 783
 * genuine pockets were preserved unrefined — and a preserved-unrefined coarse
 * ring is displaced by up to a cell, which on a one-cell pocket is the whole
 * feature. 166 of 256 sampled pocket centres classified as ink.
 *
 * No budget fixes that, because the demand is quadratic in the wrong place: the
 * refinement windows *overlap*, so the same paper is re-rasterised once per
 * neighbour. When that is what the drawing looks like, the cheap thing is to
 * stop asking about candidates one at a time and simply raster the whole extent
 * finer — 16 fine cells per coarse cell, once, covering every candidate at
 * ~1/10 of what refining them individually would have cost.
 *
 * 4 is chosen against what escalation has to achieve: it is triggered by a
 * *dense* field of sub-cell features, and a feature dense enough to trigger it
 * is at most ~1 coarse cell across (a sparse field of hairline slivers stays
 * under the budget and never gets here), so 4× puts ≥4 fine cells across it —
 * comfortably out of sub-cell territory, with the same margin the coarse grid
 * gives an ordinary feature. Anything that *is* still sub-cell at 4× is rare by
 * construction and is handled by the ordinary per-window pass against the fine
 * grid, which is why there is no second escalation.
 */
export const ESCALATE_FACTOR = 4;
/**
 * Fine cells one escalation may allocate — its memory bound, and the reason
 * escalation cannot be triggered into an out-of-memory by an exotic `capCells`.
 *
 * At the default cap the fine grid is `4 · (512 + 6) = 2 072` cells a side:
 * 4.3M cells of `Float32Array` (17 MB) plus the contouring pass's edge table
 * (~34 MB of `Int32Array`), so ~51 MB transient — measured 2 068² on the
 * reviewer's fixture. A caller who names a much larger `capCells` has priced
 * *its* grid, not sixteen of them, so past this ceiling the call stays on the
 * per-window path and fail-preserves exactly as it does today.
 */
export const ESCALATE_MAX_CELLS = (ESCALATE_FACTOR * (RASTER_CAP_CELLS + 6)) ** 2;
/**
 * Coarse cells of slack when asking whether a refined flood's escape point has
 * reached the *global* exterior (see {@link escapeLeavesTheFeature}).
 *
 * The refined window's border can land inside a coarse cell whose own centre
 * samples as ink even though the exterior is immediately next door — the coarse
 * classification is only accurate to about a cell, which is the whole reason
 * refinement exists. One cell of Chebyshev slack (the 3×3 neighbourhood of the
 * escape cell) absorbs that without letting an escape into a cavity two coarse
 * cells deep count as reaching the outside.
 *
 * It is not decorative: at 0 the near-tangent cusp at d=19.9, 45° stops draining
 * — its wedge is barely a cell wide where the window border cuts it, so the one
 * coarse cell under the escape point reads as ink — and the speck comes back.
 */
export const REFINE_DRAIN_SLACK_CELLS = 1;

/**
 * What `rasterUnionRings` did with the sub-cell rings it found, for tests.
 *
 * `candidates` is always the *coarse* grid's sub-cell count — what the drawing
 * looks like at the resolution {@link rasterGridSpec} picked, observed before
 * the escalation decision is taken. Everything after it describes the pass that
 * actually ran, which is the coarse one unless `escalated`:
 *
 * ```text
 * kept + dropped + keptUnrefined === escalated ? fineCandidates : candidates
 * ```
 *
 * **Every counter is a sum across clusters** (see {@link rasterUnionRings}),
 * and `escalated` is "some cluster escalated" — deliberately a flag rather than
 * a count, because what it is read for is "did this call leave the per-window
 * path", and because the fixtures that pin it are single-cluster drawings where
 * the two readings coincide. The invariant above is therefore exact for a
 * single-cluster call and holds per cluster in general; across a call whose
 * clusters took *different* paths only the weaker
 * `kept + dropped + keptUnrefined <= candidates + fineCandidates` survives,
 * since the aggregate no longer says which candidates belonged to which path.
 */
export interface RasterRefineStats {
  /** Rings enclosing at most one *coarse* cell — the sub-cell features found. */
  candidates: number;
  /** …of those (or of `fineCandidates`), the ones confirmed as real features. */
  kept: number;
  /** …and the ones the refined field showed to be sampling artefacts. */
  dropped: number;
  /**
   * …and the ones kept *without* being looked at, because the refinement budget
   * was spent (see {@link REFINE_CELL_BUDGET}). Absence of evidence preserves
   * the raw contour, so these are keeps, not drops.
   */
  keptUnrefined: number;
  /** …of `kept`, how many had their contour ring replaced by the refined one. */
  replaced: number;
  /**
   * Whether refining the coarse candidates one window at a time would have cost
   * more than the whole call's allowance, so the entire extent was re-rastered
   * at {@link ESCALATE_FACTOR}× instead and the rings come off *that* grid.
   */
  escalated: boolean;
  /**
   * Sub-cell candidates on the escalated fine grid — the residue that is finer
   * than a *fine* cell and so still needs a window. Rare by construction (see
   * {@link ESCALATE_FACTOR}); 0 when nothing escalated.
   */
  fineCandidates: number;
}

/**
 * The grid the rings being refined came off — the coarse raster, or, once the
 * call has escalated, the fine one. Either way it is the refinement pass's one
 * source of truth about the drawing as a whole.
 */
interface ContourGrid {
  /** Normalised distance field: `< 1` is ink. */
  field: Float32Array;
  cell: number;
  gw: number;
  gh: number;
  x0: number;
  y0: number;
  /**
   * Cells of the *global exterior*: outside-class cells 4-connected to the grid
   * border. The grid carries two spare cells of padding beyond the buffer, so
   * every border cell is outside and the flood is seeded from all of them.
   */
  outside: Uint8Array;
}

/**
 * Mark every outside-class cell 4-connected to the grid border — the raster's
 * one global fact about connectivity, computed once per `rasterUnionRings` call
 * in O(grid) and consulted by every refinement window.
 */
function globalOutsideMask(field: Float32Array, gw: number, gh: number): Uint8Array {
  const mask = new Uint8Array(gw * gh);
  const stack: number[] = [];
  const push = (gx: number, gy: number) => {
    const i = gy * gw + gx;
    if (mask[i] || field[i] < 1) return; // already seen, or ink
    mask[i] = 1;
    stack.push(i);
  };
  for (let gx = 0; gx < gw; gx++) {
    push(gx, 0);
    push(gx, gh - 1);
  }
  for (let gy = 0; gy < gh; gy++) {
    push(0, gy);
    push(gw - 1, gy);
  }
  while (stack.length > 0) {
    const i = stack.pop()!;
    const gx = i % gw;
    const gy = (i - gx) / gw;
    if (gx > 0) push(gx - 1, gy);
    if (gx < gw - 1) push(gx + 1, gy);
    if (gy > 0) push(gx, gy - 1);
    if (gy < gh - 1) push(gx, gy + 1);
  }
  return mask;
}

/**
 * Does a refined flood reaching the window border at (px, py) actually prove the
 * feature is not isolated?
 *
 * Reaching the border only proves the flooded class *continues past the window*.
 * Whether that disqualifies the feature depends on where it continues to, and
 * the coarse grid — the one thing here that knows about the drawing as a whole —
 * is what says:
 *
 * ("The coarse grid" below is the grid the candidate's ring came off — the
 * escalated fine one, on a call that escalated. Either way it is the one thing
 * in scope that knows about the drawing as a whole, and it is always coarser
 * than the refinement window being decided.)
 *
 *  - **A pocket of paper** is disqualified only by draining to the **global
 *    exterior**. Paper that is itself enclosed is part of some hole, and a hole
 *    reached through a corridor finer than a cell is still a hole, so an escape
 *    into an enclosed chamber is not drainage. The old test — "touched the
 *    window border" — could not tell the two apart and deleted genuinely
 *    enclosed pockets whose corridor merely left the window.
 *  - **A speck of ink** is disqualified by the coarse grid agreeing there is ink
 *    out there: the blob it is really part of already has its own ring, so the
 *    speck is a duplicate wearing the other colour. There is no ink counterpart
 *    to "the exterior" — the unbounded component is a property of the paper
 *    class alone — so the ink test stops at the coarse grid's own reading, and
 *    the asymmetry is in the geometry, not in the implementation.
 *
 * Escaping the raster grid outright is drainage by construction: the grid is
 * padded well past the buffered union, so there is nothing but exterior there.
 */
function escapeLeavesTheFeature(
  px: number,
  py: number,
  wantInside: boolean,
  g: ContourGrid,
): boolean {
  const cx = Math.floor((px - g.x0) / g.cell);
  const cy = Math.floor((py - g.y0) / g.cell);
  if (cx < 0 || cy < 0 || cx >= g.gw || cy >= g.gh) return true;
  const s = REFINE_DRAIN_SLACK_CELLS;
  for (let dy = -s; dy <= s; dy++) {
    const y = cy + dy;
    if (y < 0 || y >= g.gh) continue;
    for (let dx = -s; dx <= s; dx++) {
      const x = cx + dx;
      if (x < 0 || x >= g.gw) continue;
      const i = y * g.gw + x;
      if (wantInside ? g.field[i] < 1 : g.outside[i] === 1) return true;
    }
  }
  return false;
}

/** What refinement concluded about one sub-cell candidate. */
interface RefineResult {
  /**
   * `drop` — the refined field showed it to be a sampling artefact.
   * `keep` — it is a real feature.
   * `unrefined` — nothing was looked at; the raw contour stands (see
   * {@link REFINE_CELL_BUDGET}).
   */
  outcome: "drop" | "keep" | "unrefined";
  /**
   * The feature's contour at refinement resolution, in world coordinates, when
   * one exists — only for a `keep` whose flood never touched the window border,
   * since a component running out of the window has no closed contour inside it.
   */
  refined: Polyline | null;
}

/** Where and how finely one candidate's refinement window will be sampled. */
interface RefineWindow {
  /** The candidate's own bounds, unpadded — where its seed cells can be. */
  bounds: BBox;
  x0: number;
  y0: number;
  gw: number;
  gh: number;
  /** Refined cell size: the contouring grid's cell over {@link REFINE_FACTOR}. */
  rcell: number;
  /** Refined cells this window costs — exactly what it debits from the allowance. */
  cells: number;
}

/**
 * The window {@link refineSubCellRing} would open for a candidate: its bbox plus
 * {@link REFINE_PAD_CELLS} cells on every side, sampled {@link REFINE_FACTOR}×
 * finer. Null when the ring's bounds are not finite.
 *
 * Split out from the refinement itself because the escalation decision is
 * *"what would refining every candidate one window at a time actually cost?"* —
 * a question with an exact answer that is cheap to total up, and which an
 * estimate ("candidates × a typical window") would turn into a guess right where
 * the budget is about to be either honoured or abandoned.
 */
function refineWindow(ring: Polyline, cell: number): RefineWindow | null {
  const bounds = ringBounds(ring);
  if (!Number.isFinite(bounds.xMin) || !Number.isFinite(bounds.yMin)) return null;
  const pad = REFINE_PAD_CELLS * cell;
  const rcell = cell / REFINE_FACTOR;
  const gw = Math.max(3, Math.ceil((bounds.xMax - bounds.xMin + 2 * pad) / rcell));
  const gh = Math.max(3, Math.ceil((bounds.yMax - bounds.yMin + 2 * pad) / rcell));
  return { bounds, x0: bounds.xMin - pad, y0: bounds.yMin - pad, gw, gh, rcell, cells: gw * gh };
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
 * Three decisions worth naming:
 *
 *  - **Reaching the window border is not by itself drainage.** It proves the
 *    class continues past the window, not where it continues *to* — see
 *    {@link escapeLeavesTheFeature}, which puts that question to the coarse
 *    grid's global-exterior mask. A pocket whose corridor merely leads to
 *    another enclosed chamber is still enclosed.
 *  - **A confirmed feature is re-drawn at refinement resolution.** The coarse
 *    ring carries up to a cell of positional error, which on a sub-cell feature
 *    is error of the same order as the feature: on the exact 8.1 px closed
 *    square the kept pinhole ring was shifted far enough that the square's
 *    centre — analytically 4.05 px from every stroke, so outside the ink — came
 *    back *inside* the silhouette. Refinement already holds the better contour;
 *    withholding it keeps the bug it was added to fix. The mixed-resolution
 *    worry that motivated keeping the coarse ring is real but local, and is
 *    handled by a proximity guard in `rasterUnionRings` rather than by throwing
 *    the contour away. A component that ran out of the window has no closed
 *    contour inside it, so those keeps stay on the coarse ring.
 *  - **No seed, no keep.** If the refined window holds no cell of the pocket's
 *    own class inside the candidate ring, the feature did not survive refinement
 *    either and the raster is not entitled to report it. Unlike an exhausted
 *    budget this *is* evidence: the window was opened and there was nothing in
 *    it.
 *
 * `budget` is the caller's remaining refined-cell allowance; it is debited by
 * the window this call opens. A window too large to be worth opening, or larger
 * than the allowance that is left, returns `unrefined` — the raw contour stands
 * (see {@link REFINE_CELL_BUDGET}).
 */
function refineSubCellRing(
  lines: Polyline[],
  radius: number,
  ring: Polyline,
  grid: ContourGrid,
  budget: { cells: number },
): RefineResult {
  const nothing: RefineResult = { outcome: "drop", refined: null };
  const area = polygonArea(ring);
  if (area === 0) return nothing; // encloses nothing measurable
  // Rings come off `ringsFromThreshold` oriented with the ink on one side, so
  // the sign says which class the ring encloses: negative is a pocket of
  // paper (a hole), positive a speck of ink (an island).
  const wantInside = area > 0;

  const win = refineWindow(ring, grid.cell);
  if (!win) return nothing;
  const { x0, y0, gw, gh, rcell, cells: windowCells } = win;
  const { xMin, yMin, xMax, yMax } = win.bounds;

  // A ring can be sub-cell in *area* and still span many cells (a hairline
  // sliver between two blobs), so the window is not bounded by the trigger.
  // Too wide to be worth looking at — but a wide window is this candidate's
  // problem, not the call's, so it does not spend anyone else's allowance.
  if (windowCells > REFINE_WINDOW_CELLS) return { outcome: "unrefined", refined: null };
  if (windowCells > budget.cells) {
    budget.cells = 0; // one-shot: order of candidates must not change verdicts
    return { outcome: "unrefined", refined: null };
  }
  budget.cells -= windowCells;

  const field = rasterizeDistanceField(lines, radius, rcell, gw, gh, x0, y0);
  const isWanted = (i: number) => field[i] < 1 === wantInside;
  const centre = (gx: number, gy: number) => ({
    x: x0 + (gx + 0.5) * rcell,
    y: y0 + (gy + 0.5) * rcell,
  });

  // Seed from every refined cell inside the candidate ring that carries the
  // enclosed class; if the feature has vanished at this resolution there are
  // none, and the raster has no evidence to report it with. Only the ring's own
  // bbox can hold such a cell, so the point-in-ring test never runs over the
  // padding.
  const stack: number[] = [];
  const seen = new Uint8Array(windowCells);
  let seed: Point | null = null;
  const lo = (v: number, n: number) => Math.max(0, Math.min(n - 1, Math.floor(v / rcell - 0.5)));
  const hi = (v: number, n: number) => Math.max(0, Math.min(n - 1, Math.ceil(v / rcell)));
  for (let gy = lo(yMin - y0, gh); gy <= hi(yMax - y0, gh); gy++) {
    for (let gx = lo(xMin - x0, gw); gx <= hi(xMax - x0, gw); gx++) {
      const i = gy * gw + gx;
      if (!isWanted(i)) continue;
      const p = centre(gx, gy);
      if (!pointInSilhouette(p, [ring])) continue;
      seen[i] = 1;
      stack.push(i);
      seed ??= p;
    }
  }
  if (seed === null) return nothing;

  // Flood-fill that class. Reaching the window border is where the feature stops
  // being decidable locally: it may be draining to the outside world through a
  // channel finer than a coarse cell, or it may be a chamber of a larger
  // enclosed cavity. The coarse grid's global-exterior mask settles which.
  let escaped = false;
  while (stack.length > 0) {
    const i = stack.pop()!;
    const gx = i % gw;
    const gy = (i - gx) / gw;
    if (gx === 0 || gy === 0 || gx === gw - 1 || gy === gh - 1) {
      escaped = true;
      const p = centre(gx, gy);
      if (escapeLeavesTheFeature(p.x, p.y, wantInside, grid)) return nothing;
      continue; // border cell: nothing beyond it to expand into
    }
    const neighbours = [i - 1, i + 1, i - gw, i + gw];
    for (const n of neighbours) {
      if (seen[n] || !isWanted(n)) continue;
      seen[n] = 1;
      stack.push(n);
    }
  }
  if (escaped) return { outcome: "keep", refined: null };

  // Strictly interior, so the window holds the feature's whole contour: hand it
  // back in world coordinates, oriented like the candidate it replaces.
  const refined = ringsFromThreshold(
    { brightness: field, width: gw, height: gh },
    1,
    gw * rcell,
    gh * rcell,
    { x0, y0, x1: x0 + gw * rcell, y1: y0 + gh * rcell },
  );
  let best: Polyline | null = null;
  let bestArea = Infinity;
  for (const r of refined) {
    const a = polygonArea(r);
    if (a === 0 || a > 0 !== wantInside) continue;
    if (Math.abs(a) >= bestArea) continue;
    if (!pointInSilhouette(seed, [r])) continue;
    best = r;
    bestArea = Math.abs(a);
  }
  return { outcome: "keep", refined: best };
}

/** Axis-aligned bounds of a ring, grown by `pad` on every side. */
function ringBounds(ring: Polyline, pad = 0): BBox {
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
  return { xMin: xMin - pad, yMin: yMin - pad, xMax: xMax + pad, yMax: yMax + pad };
}

function bboxesOverlap(a: BBox, b: BBox): boolean {
  return a.xMin <= b.xMax && b.xMin <= a.xMax && a.yMin <= b.yMax && b.yMin <= a.yMax;
}

/** Does any edge of `ring` (a closed loop) touch the box? Liang–Barsky clip. */
function ringTouchesBox(ring: Polyline, box: BBox): boolean {
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j];
    const b = ring[i];
    if (Math.max(a.x, b.x) < box.xMin || Math.min(a.x, b.x) > box.xMax) continue;
    if (Math.max(a.y, b.y) < box.yMin || Math.min(a.y, b.y) > box.yMax) continue;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    let t0 = 0;
    let t1 = 1;
    let inside = true;
    const clip = (p: number, q: number) => {
      if (p === 0) return q >= 0; // parallel to this slab
      const t = q / p;
      if (p < 0) {
        if (t > t1) return false;
        if (t > t0) t0 = t;
      } else {
        if (t < t0) return false;
        if (t < t1) t1 = t;
      }
      return true;
    };
    inside =
      clip(-dx, a.x - box.xMin) &&
      clip(dx, box.xMax - a.x) &&
      clip(-dy, a.y - box.yMin) &&
      clip(dy, box.yMax - a.y);
    if (inside) return true;
  }
  return false;
}

// ── Cluster decomposition ────────────────────────────────────────────

/**
 * How much more grid, in total, the decomposed call may allocate than the one
 * whole-extent grid it replaces — the cost bound on decomposition.
 *
 * Splitting a drawing into clusters is what stops blank space from coarsening
 * the ink (see {@link strokeClusters}), but it also lets the drawing buy past
 * `capCells` once per cluster: a hundred disjoint 300px blobs each resolved at
 * `radius/4` is ~36× the single grid, which is a real cost, not a rounding
 * error. So decomposition is *budgeted*: past this multiple of the single
 * grid's cells every cluster's cap is scaled down by the same factor until the
 * total fits.
 *
 * The scaling has a floor it may not cross — each cluster is always given at
 * least the resolution the single whole-extent grid would have given *it* (see
 * {@link clusterFloorCells}) — so a budgeted decomposition is still never worse
 * than not decomposing, only less good than an unbudgeted one. 4 is chosen so
 * the ordinary multi-blob drawing (a field of stars, a page of glyphs) is
 * unscaled and only the pathological confetti case is trimmed.
 */
export const CLUSTER_COST_FACTOR = 4;

/** One connected group of strokes, and the bounds of the strokes in it. */
interface StrokeCluster {
  /** The cluster's strokes, in the order they appeared in the input. */
  lines: Polyline[];
  /** Their combined bounds — *not* inflated. */
  bounds: BBox;
}

const unionBBox = (a: BBox, b: BBox): BBox => ({
  xMin: Math.min(a.xMin, b.xMin),
  yMin: Math.min(a.yMin, b.yMin),
  xMax: Math.max(a.xMax, b.xMax),
  yMax: Math.max(a.yMax, b.yMax),
});

/**
 * Partition strokes into groups whose buffered unions are provably disjoint.
 *
 * Two strokes join the same cluster when their bounding boxes, each grown by
 * `inflate`, intersect. **Soundness:** if two clusters' inflated boxes are
 * disjoint then the boxes themselves are more than `2 · inflate` apart, and box
 * distance is a lower bound on point distance, so every point of one cluster's
 * strokes is more than `2 · inflate` from every point of the other's. Buffer
 * each by anything up to `inflate` and the two unions still cannot meet — so
 * their ring sets are disjoint and compose under even-odd by plain
 * concatenation, with no ring of one ever crossing or enclosing a ring of the
 * other.
 *
 * The caller passes the whole drawing's `effectiveRadius` as `inflate`, which is
 * the largest radius any cluster can go on to be rendered at: `effectiveRadius`
 * is `max(radius, cell)` and a cluster's cell is never larger than the whole
 * drawing's (see {@link clusterFloorCells}), so `inflate` really does dominate
 * every per-cluster buffer. Passing more than the buffer only ever *merges*
 * clusters that could have been separated, which costs fidelity, never
 * correctness.
 *
 * The merge is greedy over cluster boxes rather than a union-find over stroke
 * pairs: each stroke is tested against the clusters still open and absorbs all
 * of the ones it touches. A cluster's box is the union of its members' boxes and
 * so is a superset of the cluster, which means the greedy pass can merge two
 * clusters that no *pair* of strokes would have joined — the conservative
 * direction: fewer, larger clusters, never a split that is not provably safe.
 *
 * **What keeps it out of the quadratic is the sweep, not the greed.** Strokes
 * are visited in order along the drawing's longer axis, and a cluster whose box
 * ends before the current stroke begins can never be touched again — every
 * remaining stroke starts at or after this one — so it is retired from the scan
 * as it is passed. A connected drawing therefore costs one test per stroke (the
 * 342-stroke lattice merges into a single cluster on its second stroke and never
 * opens another), and a field of disjoint marks costs one test per stroke per
 * mark still *straddling* the sweep line rather than per mark in the drawing.
 * Measured end to end on a scattered-dot field — every mark its own cluster, so
 * worst case for the scan: 5 000 dots resolve in 38 ms swept against 80 ms
 * unswept, and 20 000 in 116 ms, linear in the marks rather than quadratic.
 * (The residue is 20 000 small rasters, not the scan, and it is what buys those
 * dots a radius-4 buffer instead of the radius-23 one a single 12 000px grid
 * would have widened them to.) The bad case left is a drawing whose clusters all
 * span the sweep axis while being separated along the other one, which is why
 * the axis is the longer of the two — such an arrangement has to be narrow, and
 * a narrow drawing has few clusters to spare.
 *
 * Strokes with no finite bounds (empty polylines, all-NaN ones) join no cluster.
 * They contribute nothing to `geometryBounds` and nothing to the distance field,
 * so dropping them changes no output.
 */
function strokeClusters(lines: Polyline[], inflate: number): StrokeCluster[] {
  // Inflated per-stroke boxes, parallel to `owner` (the stroke each came from).
  const boxes: BBox[] = [];
  const owner: number[] = [];
  const all: BBox = { xMin: Infinity, yMin: Infinity, xMax: -Infinity, yMax: -Infinity };
  for (let i = 0; i < lines.length; i++) {
    const b = geometryBounds([lines[i]]);
    if (!b) continue;
    const box: BBox = {
      xMin: b.xMin - inflate,
      yMin: b.yMin - inflate,
      xMax: b.xMax + inflate,
      yMax: b.yMax + inflate,
    };
    boxes.push(box);
    owner.push(i);
    if (box.xMin < all.xMin) all.xMin = box.xMin;
    if (box.yMin < all.yMin) all.yMin = box.yMin;
    if (box.xMax > all.xMax) all.xMax = box.xMax;
    if (box.yMax > all.yMax) all.yMax = box.yMax;
  }
  if (boxes.length === 0) return [];

  const byX = all.xMax - all.xMin >= all.yMax - all.yMin;
  const front = (b: BBox) => (byX ? b.xMin : b.yMin);
  const back = (b: BBox) => (byX ? b.xMax : b.yMax);
  const order = boxes.map((_, k) => k).sort((a, b) => front(boxes[a]) - front(boxes[b]));

  interface OpenCluster {
    box: BBox;
    members: number[];
  }
  const live: OpenCluster[] = [];
  const closed: OpenCluster[] = [];

  for (const k of order) {
    const box = boxes[k];
    const edge = front(box);
    // Descending, so a chosen `keep` always sits at a higher index than the
    // cluster being examined, which makes both splices easy to account for.
    let keep = -1;
    for (let c = live.length - 1; c >= 0; c--) {
      if (back(live[c].box) < edge) {
        closed.push(live[c]);
        live.splice(c, 1);
        if (keep > c) keep--; // the kept cluster just shifted down one
        continue;
      }
      if (!bboxesOverlap(live[c].box, box)) continue;
      if (keep >= 0) {
        live[c].box = unionBBox(live[c].box, live[keep].box);
        for (const j of live[keep].members) live[c].members.push(j);
        live.splice(keep, 1);
      }
      keep = c;
    }
    if (keep < 0) {
      live.push({ box, members: [owner[k]] });
    } else {
      live[keep].box = unionBBox(live[keep].box, box);
      live[keep].members.push(owner[k]);
    }
  }

  return [...closed, ...live]
    .map(({ box, members }) => {
      members.sort((p, q) => p - q); // strokes keep their input order…
      return {
        lines: members.map((j) => lines[j]),
        bounds: {
          xMin: box.xMin + inflate,
          yMin: box.yMin + inflate,
          xMax: box.xMax - inflate,
          yMax: box.yMax - inflate,
        },
        first: members[0],
      };
    })
    // …and so do the clusters, so ring order follows the input, not the sweep.
    .sort((a, b) => a.first - b.first);
}

/**
 * The `maxCells` floor a cluster is given: the number of cells the *single*
 * whole-extent grid would have spent across this cluster's own span.
 *
 * This is what makes decomposition monotone. A cluster is never rendered
 * coarser than it would have been undecomposed — which keeps `effectiveRadius`
 * from growing (and so keeps {@link strokeClusters}'s separation argument
 * sound) — while a small cluster no longer claims the full
 * {@link RASTER_MAX_CELLS} floor for its own postage stamp, which is what would
 * otherwise turn a thousand specks into a thousand 192-cell grids.
 */
function clusterFloorCells(bounds: BBox, radius: number, globalCell: number): number {
  const span = Math.max(
    bounds.xMax - bounds.xMin + 2 * radius,
    bounds.yMax - bounds.yMin + 2 * radius,
    1e-6,
  );
  return Math.max(1, Math.ceil(span / globalCell));
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
 * `capCells` (see {@link rasterGridSpec}) — or, on a drawing dense enough to
 * escalate, by {@link ESCALATE_MAX_CELLS}.
 *
 * Features finer than one cell are not guessed at from their size but looked at
 * — see {@link refineSubCellRing} — and a confirmed one is re-drawn at the
 * resolution it was confirmed at. Where the drawing is *made* of such features
 * — a plotter lattice whose every pocket is about a cell across — looking at
 * them one window at a time is the wrong tool, and the call re-rasters the whole
 * extent at {@link ESCALATE_FACTOR}× instead. Pass `stats` to see how many
 * candidates there were, which way each went, and which of the two paths ran;
 * it is the only window onto a decision that is otherwise invisible in the
 * output.
 *
 * **The extent that sets the resolution is the ink's, not the bounding box's.**
 * Every grid above is sized from the geometry's bounds, so a single stray mark
 * out in empty space coarsens the whole drawing: at the default cap a 3 400px
 * lattice of 6.7px pockets resolves fine, and the same lattice plus one dot
 * 1 150px past its corner does not — the cells grow from 6.66px to 8.90px, the
 * widened radius grows with them, and the pockets shrink to 2.20px against an
 * escalated *fine* cell of 2.23px. Measured on that drawing: 28 224 fine
 * candidates, 21 828 of them past the allowance and preserved unrefined, and
 * 120 of 256 pocket centres classifying as ink in 9.0 seconds. So the outermost
 * step is a **cluster decomposition**: the strokes
 * are partitioned into groups whose buffered unions provably cannot meet (see
 * {@link strokeClusters}), and the entire pipeline below — grid spec, contour,
 * refinement, escalation — runs once per cluster, each on a grid sized to its
 * own extent. The stray gets its own tiny grid and its own disc ring; the
 * lattice is resolved as if the stray were not there. Disjoint unions compose
 * under even-odd by concatenation, so the ring sets simply append.
 *
 * Two consequences worth stating plainly:
 *
 *  - **`effectiveRadius` is per cluster, and clusters may differ.** A cluster
 *    small enough to be resolved exactly is buffered at `radius`; one whose own
 *    extent still outruns the cap is buffered at its own widened radius. Each
 *    part of the drawing is rendered at the fidelity its own extent affords,
 *    which is the whole point — but it does mean the returned rings are not all
 *    guaranteed to stand for the same buffer distance. They were not before
 *    either; the difference is that the widening is now driven by the ink near
 *    each ring instead of by the drawing's furthest corner.
 *  - **Decomposition is budgeted.** Per-cluster grids can total more than the
 *    single grid they replace, so past {@link CLUSTER_COST_FACTOR}× that cost
 *    every cluster's cap is scaled down together — never below the resolution
 *    the single grid would have given it, so the budgeted decomposition is
 *    still no worse than none.
 *
 * A single-cluster drawing — which is every fixture in the suite bar the
 * multi-blob ones, and most real geometry — skips all of it and takes exactly
 * the path it took before.
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

  // `effectiveRadius` is the widest any cluster will be buffered by, so it is
  // the separation the decomposition has to prove (see `strokeClusters`).
  const clusters = strokeClusters(lines, spec.effectiveRadius);
  // One cluster is the common case and is handed the original `lines` and the
  // original spec — byte-identical to the pre-decomposition path, not merely
  // equivalent to it.
  if (clusters.length <= 1) return unionRingsOnGrid(lines, spec, stats);

  // Each cluster gets its own grid, floored at the resolution the single grid
  // would have given it and capped at the caller's `capCells` — that second
  // half is the fix: the cap now applies to the cluster's extent, not to the
  // drawing's bounding box.
  const floors = clusters.map((c) => clusterFloorCells(c.bounds, radius, spec.cell));
  // Every cluster holds at least one stroke with finite bounds, and `radius > 0`
  // already produced a spec above, so `rasterGridSpec` cannot be null here.
  const gridFor = (i: number, cap: number) =>
    rasterGridSpec(clusters[i].lines, radius, floors[i], cap)!;
  let specs = clusters.map((_, i) => gridFor(i, capCells));

  let total = 0;
  for (const s of specs) total += s.gw * s.gh;
  const allowance = CLUSTER_COST_FACTOR * spec.gw * spec.gh;
  if (total > allowance) {
    // Cells scale linearly per side, so one factor applied to every cap brings
    // the quadratic total back inside the allowance in a single pass. `floors`
    // is the line it may not cross: a cluster trimmed to its floor is exactly
    // as well resolved as the undecomposed grid would have left it.
    const scale = Math.sqrt(allowance / total);
    const wanted = specs.map((s) => s.cells);
    specs = clusters.map((_, i) =>
      gridFor(i, Math.max(floors[i], Math.floor(wanted[i] * scale))),
    );
  }

  const out: Polyline[] = [];
  for (let i = 0; i < clusters.length; i++) {
    // Not `push(...rings)`: an escalated cluster returns tens of thousands of
    // rings, which is spread-as-arguments territory.
    for (const ring of unionRingsOnGrid(clusters[i].lines, specs[i], stats)) out.push(ring);
  }
  return out;
}

/**
 * The whole pipeline — contour, refine, escalate — on one cluster's grid.
 *
 * The refinement allowance and the escalation decision are both scoped to this
 * grid, which is the point of decomposing: a cluster's candidates are weighed
 * against a budget sized to the cluster, not to the drawing's bounding box.
 * `stats` accumulates across every call, so its counters come back summed.
 */
function unionRingsOnGrid(
  lines: Polyline[],
  spec: RasterGridSpec,
  stats?: RasterRefineStats,
): Polyline[] {
  const { cell, gw, gh, x0, y0, effectiveRadius: r } = spec;

  // The refinement allowance for the *call*, sized against the coarse grid (see
  // REFINE_CELL_BUDGET). Escalating does not raise it and does not spend it:
  // the decision is taken before any window is opened, so the fine pass
  // inherits the whole allowance for whatever residue is still sub-cell there.
  const budget = {
    cells: Math.max(REFINE_CELL_BUDGET, REFINE_BUDGET_PER_COARSE_CELL * gw * gh),
  };

  // Per-window refinement has a *density* ceiling, not just a cost: windows
  // overlap, so a candidate field dense enough re-rasterises the same paper
  // once per neighbour. The decision is therefore COST-OPTIMAL, not
  // allowance-gated: both paths do the full job, so take whichever is cheaper —
  // the exact per-window total, or one whole-extent fine pass (fgw x fgh
  // cells). Comparing against the allowance instead was review-round-7's bug:
  // blank extent (a remote stray point) inflated the grid-proportional
  // allowance and suppressed escalation while the same candidates went
  // unrefined. Blank extent raises the fine pass's cost too, but it can never
  // make per-window look affordable when it is not — demand is unchanged by
  // empty space. Escalation is depth-1 by construction: the fine pass runs the
  // ordinary per-window path, and if *that* exhausts (it should not — see
  // ESCALATE_FACTOR) it fail-preserves exactly as before.
  const fgw = gw * ESCALATE_FACTOR;
  const fgh = gh * ESCALATE_FACTOR;
  // Block-scoped, with the sparse path returning from inside it, so the coarse
  // field and its rings are collectable before the fine grid is allocated: a
  // drawing that escalates has tens of thousands of coarse rings, and none of
  // them survives the decision.
  {
    const coarse = contourGrid(lines, r, cell, gw, gh, x0, y0);
    if (stats) stats.candidates += coarse.candidates;
    if (coarse.demand <= fgw * fgh || fgw * fgh > ESCALATE_MAX_CELLS) {
      return refineCandidates(lines, r, cell, gw, gh, x0, y0, coarse, budget, stats);
    }
  }

  // Only ever set, never cleared, so across clusters this reads "some cluster
  // escalated" — see RasterRefineStats.
  if (stats) stats.escalated = true;
  const fineCell = cell / ESCALATE_FACTOR;
  // Same origin and same physical extent (fgw · cell/F === gw · cell), so the
  // fine grid keeps the coarse one's border padding and its `effectiveRadius`:
  // escalation changes how finely the union is sampled, never which union.
  const fine = contourGrid(lines, r, fineCell, fgw, fgh, x0, y0);
  if (stats) stats.fineCandidates += fine.candidates;
  return refineCandidates(lines, r, fineCell, fgw, fgh, x0, y0, fine, budget, stats);
}

/** One resolution's worth of contouring, plus what refining it would cost. */
interface ContourPass {
  field: Float32Array;
  rings: Polyline[];
  /** Parallel to `rings`: 1 where the ring encloses at most one cell. */
  subCell: Uint8Array;
  /** How many of those there are. */
  candidates: number;
  /**
   * Refined cells the per-window path would spend on them — the exact total, not
   * an estimate, and the number the escalation decision turns on. Candidates
   * that never debit the allowance (degenerate rings, and windows already too
   * wide to open) are excluded, so this is what would really be charged.
   */
  demand: number;
}

/** Rasterise the buffered union at one resolution and contour it. */
function contourGrid(
  lines: Polyline[],
  radius: number,
  cell: number,
  gw: number,
  gh: number,
  x0: number,
  y0: number,
): ContourPass {
  const box = { x0, y0, x1: x0 + gw * cell, y1: y0 + gh * cell };
  const field = rasterizeDistanceField(lines, radius, cell, gw, gh, x0, y0);
  const rings = ringsFromThreshold(
    { brightness: field, width: gw, height: gh },
    1,
    box.x1 - box.x0,
    box.y1 - box.y0,
    box,
  );

  // A ring enclosing at most one grid cell is below *this* grid's sampling
  // scale, but not below the raster's: it still holds the exact segments, so
  // each such ring can be decided by looking rather than by its area.
  const cellArea = cell * cell;
  const subCell = new Uint8Array(rings.length);
  let candidates = 0;
  let demand = 0;
  for (let i = 0; i < rings.length; i++) {
    const area = polygonArea(rings[i]);
    if (Math.abs(area) > cellArea) continue;
    subCell[i] = 1;
    candidates++;
    if (area === 0) continue; // dropped before a window is ever opened
    const win = refineWindow(rings[i], cell);
    if (!win || win.cells > REFINE_WINDOW_CELLS) continue; // never spends the allowance
    demand += win.cells;
  }
  return { field, rings, subCell, candidates, demand };
}

/**
 * Decide each sub-cell candidate of a contoured grid by re-rasterising a window
 * around it (see {@link refineSubCellRing}), and substitute the refined contour
 * for the drawn one wherever that cannot disturb a sibling.
 */
function refineCandidates(
  lines: Polyline[],
  radius: number,
  cell: number,
  gw: number,
  gh: number,
  x0: number,
  y0: number,
  pass: ContourPass,
  budget: { cells: number },
  stats?: RasterRefineStats,
): Polyline[] {
  const { field, rings, subCell } = pass;
  let grid: ContourGrid | null = null; // built once, and only if anything asks

  const out: Polyline[] = [];
  const swaps: { index: number; refined: Polyline }[] = [];
  for (let i = 0; i < rings.length; i++) {
    const ring = rings[i];
    if (!subCell[i]) {
      out.push(ring);
      continue;
    }
    grid ??= { field, cell, gw, gh, x0, y0, outside: globalOutsideMask(field, gw, gh) };
    const verdict = refineSubCellRing(lines, radius, ring, grid, budget);
    if (verdict.outcome === "drop") {
      if (stats) stats.dropped++;
      continue;
    }
    if (stats) {
      if (verdict.outcome === "unrefined") stats.keptUnrefined++;
      else stats.kept++;
    }
    if (verdict.refined) swaps.push({ index: out.length, refined: verdict.refined });
    out.push(ring);
  }

  // Substitute the refined contour for the drawn one wherever that cannot
  // disturb a sibling.
  //
  // Rings composed by even-odd fill only mean anything while they do not cross,
  // and a refined ring is a contour of a *different* grid than its siblings, so
  // near a shared boundary the two resolutions can in principle disagree by up
  // to a cell and cross. They cannot disagree anywhere else: both are contours
  // of the same exact distance function, and away from a boundary that function
  // is nowhere near the threshold. So the guard is proximity, not containment —
  // a refined ring is used unless some other output ring passes within one cell
  // of its bounds, in which case the drawn ring stands (visible as `kept`
  // without `replaced` in the stats).
  //
  // The guard is written against whichever grid this pass ran on. On the
  // escalated path every *drawn* ring comes off one uniform fine field, so the
  // resolutions the guard exists to keep apart only ever meet at a residual
  // fine-sub-cell substitution — rare by construction (see ESCALATE_FACTOR),
  // which is why it is nearly always vacuous there rather than why it could be
  // dropped: a refined window is 16× finer than *its* grid on either path, so
  // the concern is unchanged in kind.
  if (swaps.length > 0) {
    const bounds = out.map((ring) => ringBounds(ring));
    for (const { index, refined } of swaps) {
      const guard = ringBounds(refined, cell);
      let clear = true;
      for (let i = 0; i < out.length && clear; i++) {
        if (i === index || !bboxesOverlap(bounds[i], guard)) continue;
        clear = !ringTouchesBox(out[i], guard);
      }
      if (!clear) continue;
      out[index] = refined;
      bounds[index] = ringBounds(refined);
      if (stats) stats.replaced++;
    }
  }
  return out;
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
