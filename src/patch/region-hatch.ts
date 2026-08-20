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
  for (let y = first; y <= maxY; y += pitch) {
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
    for (let i = 0; i + 1 < xs.length; i += 2) {
      // Skip zero-length spans (tangent scanlines / self-intersections) and, in
      // a multi-ring region, the empty stretch between an outer ring and a hole
      // that happen to touch.
      if (xs[i + 1] - xs[i] > 1e-9) {
        lines.push([back(xs[i], y), back(xs[i + 1], y)]);
      }
    }
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
