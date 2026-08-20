/**
 * region-hatch — fill an arbitrary closed region with parallel hatch lines at a
 * given angle and spacing. The primitive the op-art motif needs (tessellate a
 * plane, hatch each zone at its own angle) and the "draw à la carte" capability
 * for /draw: hatch *this region*, not just invoke a whole composition.
 *
 * Scanline even-odd fill over a *set* of rings, so it handles concave zones,
 * disjoint blobs and holes — the shapes `regionOf` produces (a rounded-rect
 * bbox, an offset silhouette, "where the ink is") — not just convex hulls.
 * Pure and deterministic.
 */

export type Pt = { x: number; y: number };

/** Guard against a runaway from a too-small pitch (e.g. a typo, 0.06 → 0.006). */
const MAX_SCANLINES = 100_000;

/**
 * Coordinate slop below which two x's on a scanline are "the same place".
 * Spans narrower than this are dropped, and gaps narrower than this are welded
 * shut — both are tangency artefacts rather than real ink or real whitespace.
 */
const EPS = 1e-9;

/**
 * Hatch a set of even-odd rings with parallel lines.
 *
 * The rings are the same representation `resolveRegionRings` (src/patch/
 * regions.ts) and `pointInSilhouette` (src/operators/silhouette-knockout.ts)
 * use: a point is inside when it is enclosed by an odd number of rings, so a
 * ring nested inside another is a hole regardless of either one's winding.
 *
 * Per scanline: intersect with *every* edge of *every* ring, sort the crossing
 * x's, and fill alternate intervals. With a single convex ring that is exactly
 * the classic convex fill (identical crossings, identical order), which is why
 * `hatchPolygon` below can just delegate.
 *
 * @param rings    closed-by-convention rings (no repeated last point needed).
 * @param angleDeg hatch line orientation in degrees (0 = horizontal).
 * @param pitch    spacing between lines, in the rings' coordinate units.
 */
export function hatchRegion(rings: Pt[][], angleDeg: number, pitch: number): Pt[][] {
  if (pitch <= 0) return [];

  // Rotate the rings so hatch lines become horizontal, scan, rotate back.
  const a = (-angleDeg * Math.PI) / 180;
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  const rot: Pt[][] = [];
  for (const ring of rings) {
    if (ring.length < 3) continue; // degenerate — contributes no area
    rot.push(ring.map((p) => ({ x: p.x * ca - p.y * sa, y: p.x * sa + p.y * ca })));
  }
  if (rot.length === 0) return [];

  // Inverse rotation for mapping scanline endpoints back.
  const ib = (angleDeg * Math.PI) / 180;
  const cb = Math.cos(ib);
  const sb = Math.sin(ib);
  const back = (x: number, y: number): Pt => ({ x: x * cb - y * sb, y: x * sb + y * cb });

  let minY = Infinity;
  let maxY = -Infinity;
  for (const ring of rot) {
    for (const p of ring) {
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
  }

  // A too-small pitch would emit millions of segments and hang the
  // render/browser. Fail loudly instead.
  if ((maxY - minY) / pitch > MAX_SCANLINES) {
    throw new Error(
      `hatchPolygon: pitch ${pitch} over a ${(maxY - minY).toFixed(1)}-unit span would emit ` +
        `>${MAX_SCANLINES} scanlines — increase pitch.`,
    );
  }

  const lines: Pt[][] = [];
  // Start on a pitch-aligned scanline so the pattern is stable under translation.
  const first = Math.ceil(minY / pitch) * pitch;

  // Iterate by *index*, not by accumulating `y += pitch`. Far from the origin
  // the accumulator stops advancing — at y ≈ 1e20 with pitch 1, `y + pitch`
  // rounds back to `y` and `y <= maxY` never turns false, hanging the render.
  // `first + i * pitch` is the same sequence for sane inputs (each term is one
  // rounding of an exact product, exactly as before) but always terminates.
  const span = maxY - first;
  const scanCount =
    span >= 0 && Number.isFinite(span)
      ? // One more line than gaps: a span of exactly k pitches carries k+1 lines,
        // hence the MAX_SCANLINES + 1 ceiling matching the guard above.
        Math.min(Math.floor(span / pitch) + 1, MAX_SCANLINES + 1)
      : 0;

  for (let i = 0; i < scanCount; i++) {
    const y = first + i * pitch;
    if (y > maxY) break; // rounding may push the final term just past the end
    const xs: number[] = [];
    for (const ring of rot) {
      const n = ring.length;
      for (let i = 0; i < n; i++) {
        const p0 = ring[i];
        const p1 = ring[(i + 1) % n];
        // Half-open interval [min,max) so shared vertices aren't double-counted.
        const lo = Math.min(p0.y, p1.y);
        const hi = Math.max(p0.y, p1.y);
        if (y >= lo && y < hi) {
          const t = (y - p0.y) / (p1.y - p0.y);
          xs.push(p0.x + t * (p1.x - p0.x));
        }
      }
    }
    if (xs.length < 2) continue;
    xs.sort((p, q) => p - q);

    // Pair the sorted crossings into filled spans, welding any two that only a
    // tangency separates. A scanline grazing a vertex — a diamond hole's apex,
    // two rings meeting at a point — emits two crossings at that vertex, equal
    // or an epsilon apart once the two edge interpolations round differently.
    // Paired naively those become abutting spans, and the plotter lifts and
    // re-drops the pen mid-stroke for no visible reason.
    let lo = xs[0];
    let hi = xs[1];
    for (let k = 2; k + 1 < xs.length; k += 2) {
      if (xs[k] - hi < EPS) {
        hi = Math.max(hi, xs[k + 1]); // same stroke: the gap isn't real whitespace
        continue;
      }
      // Skip zero-length spans (tangent scanlines / self-intersections) and, in
      // a multi-ring region, the empty stretch between an outer ring and a hole
      // that happen to touch.
      if (hi - lo > EPS) lines.push([back(lo, y), back(hi, y)]);
      lo = xs[k];
      hi = xs[k + 1];
    }
    if (hi - lo > EPS) lines.push([back(lo, y), back(hi, y)]);
  }
  return lines;
}

/**
 * Hatch a single closed polygon — the one-ring case of {@link hatchRegion}.
 * @param polygon  closed or open ring of points (auto-closed).
 * @param angleDeg hatch line orientation in degrees (0 = horizontal).
 * @param pitch    spacing between lines, in the polygon's coordinate units.
 */
export function hatchPolygon(polygon: Pt[], angleDeg: number, pitch: number): Pt[][] {
  return hatchRegion([polygon], angleDeg, pitch);
}
