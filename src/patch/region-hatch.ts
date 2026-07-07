/**
 * region-hatch — fill an arbitrary closed polygon with parallel hatch lines at
 * a given angle and spacing. The primitive the op-art motif needs (tessellate a
 * plane, hatch each zone at its own angle) and the "draw à la carte" capability
 * for /draw: hatch *this region*, not just invoke a whole composition.
 *
 * Scanline even-odd fill, so it handles concave polygons (zones), not just
 * convex hulls. Pure and deterministic.
 */

export type Pt = { x: number; y: number };

/**
 * Hatch a closed polygon with parallel lines.
 * @param polygon  closed or open ring of points (auto-closed).
 * @param angleDeg hatch line orientation in degrees (0 = horizontal).
 * @param pitch    spacing between lines, in the polygon's coordinate units.
 */
export function hatchPolygon(polygon: Pt[], angleDeg: number, pitch: number): Pt[][] {
  if (polygon.length < 3 || pitch <= 0) return [];

  // Rotate the polygon so hatch lines become horizontal, scan, rotate back.
  const a = (-angleDeg * Math.PI) / 180;
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  const rot = polygon.map((p) => ({ x: p.x * ca - p.y * sa, y: p.x * sa + p.y * ca }));

  // Inverse rotation for mapping scanline endpoints back.
  const ib = (angleDeg * Math.PI) / 180;
  const cb = Math.cos(ib);
  const sb = Math.sin(ib);
  const back = (x: number, y: number): Pt => ({ x: x * cb - y * sb, y: x * sb + y * cb });

  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of rot) {
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }

  const n = rot.length;
  const lines: Pt[][] = [];
  // Start on a pitch-aligned scanline so the pattern is stable under translation.
  const first = Math.ceil(minY / pitch) * pitch;
  for (let y = first; y <= maxY; y += pitch) {
    const xs: number[] = [];
    for (let i = 0; i < n; i++) {
      const p0 = rot[i];
      const p1 = rot[(i + 1) % n];
      // Half-open interval [min,max) so shared vertices aren't double-counted.
      const lo = Math.min(p0.y, p1.y);
      const hi = Math.max(p0.y, p1.y);
      if (y >= lo && y < hi) {
        const t = (y - p0.y) / (p1.y - p0.y);
        xs.push(p0.x + t * (p1.x - p0.x));
      }
    }
    if (xs.length < 2) continue;
    xs.sort((p, q) => p - q);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      lines.push([back(xs[i], y), back(xs[i + 1], y)]);
    }
  }
  return lines;
}
