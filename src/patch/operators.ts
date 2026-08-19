/**
 * Patch operators — Geometry (+ a modulating Field) → Geometry.
 *
 * These are the "modules with a CV input": each takes geometry and a field that
 * modulates how it transforms that geometry. Pure and deterministic, so a patch
 * built from them still compiles reproducibly and stays measurable.
 */

import type { Geometry, ScalarField, VectorField } from "./signals.js";
import { convexHull, clipPolylineToConvexPolygon } from "../utils/clip.js";
import { clipPolylinesToSilhouette, type Polyline } from "../operators/silhouette-knockout.js";

/**
 * Affine transform: scale (around origin) → rotate → translate. The order fixes
 * a predictable composition; a scene op:transform lowers to this.
 */
export function transformGeometry(
  geometry: Geometry,
  opts: { translate?: [number, number]; rotateDeg?: number; scale?: number | [number, number] },
): Geometry {
  const [sx, sy] = typeof opts.scale === "number" ? [opts.scale, opts.scale] : (opts.scale ?? [1, 1]);
  const a = ((opts.rotateDeg ?? 0) * Math.PI) / 180;
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  const [tx, ty] = opts.translate ?? [0, 0];
  return geometry.map((pl) =>
    pl.map((p) => {
      const x = p.x * sx;
      const y = p.y * sy;
      return { x: x * ca - y * sa + tx, y: x * sa + y * ca + ty };
    }),
  );
}

/**
 * Clip geometry to the convex hull of a region (a polygon, or another node's
 * geometry). Fails open (returns input unchanged) when the region is degenerate
 * — matching the layered pipeline's masking behavior. Convex-only for v1.
 */
export function clipGeometry(geometry: Geometry, region: { x: number; y: number }[]): Geometry {
  const hull = convexHull(region);
  if (hull.length < 3) return geometry;
  const out: Geometry = [];
  for (const pl of geometry) out.push(...clipPolylineToConvexPolygon(pl, hull));
  return out;
}

/**
 * Displace every vertex by a vector field, scaled by amplitude. The eurorack
 * move: the field is the CV, `amp` is the modulation depth. The field can be
 * analytic (simplexVector) or derived from another node (gradient of its
 * density) — the latter is the patch cable that makes nodes interact.
 */
export function fieldDistort(
  geometry: Geometry,
  field: VectorField,
  amp: number,
): Geometry {
  return geometry.map((pl) =>
    pl.map((p) => {
      const [dx, dy] = field.sample(p.x, p.y);
      return { x: p.x + dx * amp, y: p.y + dy * amp };
    }),
  );
}

/**
 * Modulate *presence* by a scalar field: keep only vertices where the field is
 * within [min,max], splitting polylines at gaps. Drives where ink appears from a
 * signal — e.g. cull lines out of low-density regions, or punch holes where
 * another node is dense.
 */
export function fieldCull(
  geometry: Geometry,
  field: ScalarField,
  range: { min: number; max: number },
): Geometry {
  const out: Geometry = [];
  for (const pl of geometry) {
    let run: { x: number; y: number }[] = [];
    for (const p of pl) {
      const v = field.sample(p.x, p.y);
      if (v >= range.min && v <= range.max) {
        run.push(p);
      } else {
        if (run.length >= 2) out.push(run);
        run = [];
      }
    }
    if (run.length >= 2) out.push(run);
  }
  return out;
}

/**
 * Scale line *density* by a scalar field: probabilistically drop whole
 * polylines where the field is low (deterministic via index hashing, so a patch
 * stays reproducible). A cheap tonal control — thin the drawing where a
 * modulation signal is weak.
 */
export function fieldThin(
  geometry: Geometry,
  field: ScalarField,
  strength: number,
): Geometry {
  return geometry.filter((pl, i) => {
    if (pl.length === 0) return false;
    const mid = pl[Math.floor(pl.length / 2)];
    const v = field.sample(mid.x, mid.y); // ~[0,1] for density fields
    // Deterministic pseudo-random keep threshold from the line index.
    const keepNoise = ((Math.imul(i + 1, 2654435761) >>> 0) % 1000) / 1000;
    const keepProb = 1 - strength * (1 - Math.max(0, Math.min(1, v)));
    return keepNoise < keepProb;
  });
}

/**
 * Clip geometry to a set of even-odd rings — the non-convex counterpart of
 * `clipGeometry`, and the only clip that can express `mode: "outside"`.
 *
 * A derived region (`regionOf`) may be a rounded rectangle, an offset
 * silhouette, or several disjoint blobs with holes, none of which a convex
 * half-plane clip can represent. Fails open the same way the rest of the
 * masking does: no usable ring means "inside" keeps nothing and "outside"
 * keeps everything (that is `clipPolylinesToSilhouette`'s own contract).
 */
export function clipGeometryToRings(
  geometry: Geometry,
  rings: Polyline[],
  mode: "inside" | "outside",
): Geometry {
  return clipPolylinesToSilhouette(geometry, rings, mode);
}

/**
 * Weighted emphasis: keep only a `weight` fraction of the ink inside the
 * masked zone, leaving everything outside it untouched.
 *
 * Masking as a dial rather than a switch (design doc § "Emphasis is weighted,
 * not boolean"): a focal component can suppress background texture to 0.3 in
 * its halo instead of punching a hard hole. `weight` is the *keep* fraction —
 * 1 is a no-op, 0 is a full clip of the zone, and anything between thins it.
 *
 * Geometry is first split at the region boundary so membership is exact per
 * span (a line crossing the halo is thinned only where it is inside), then the
 * in-zone spans go through `fieldThin` with a constant `weight` membership
 * signal. That reuses the existing thinning machinery — including its
 * deterministic index hash — so the same patch thins identically on every
 * render. No RNG anywhere.
 */
export function emphasisMask(
  geometry: Geometry,
  rings: Polyline[],
  weight: number,
  mode: "inside" | "outside",
): Geometry {
  const w = Math.max(0, Math.min(1, weight));
  if (w >= 1) return geometry;

  const inverse = mode === "inside" ? "outside" : "inside";
  const outZone = clipPolylinesToSilhouette(geometry, rings, inverse);
  if (w <= 0) return outZone;

  const inZone = clipPolylinesToSilhouette(geometry, rings, mode);
  const membership: ScalarField = { kind: "scalar", sample: () => w };
  return [...outZone, ...fieldThin(inZone, membership, 1)];
}

/**
 * Subdivide polylines so every segment is at most `step` long — inserting
 * interior vertices. Needed before distort/directional bends a coarse line
 * (e.g. a 2-point scanline) by a field: without interior points there is
 * nothing to displace mid-line.
 */
export function resampleGeometry(geometry: Geometry, step: number): Geometry {
  if (step <= 0) return geometry;
  return geometry.map((pl) => {
    if (pl.length < 2) return pl;
    const out = [pl[0]];
    for (let i = 1; i < pl.length; i++) {
      const a = pl[i - 1];
      const b = pl[i];
      const n = Math.max(1, Math.floor(Math.hypot(b.x - a.x, b.y - a.y) / step));
      for (let k = 1; k <= n; k++) {
        const t = k / n;
        out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      }
    }
    return out;
  });
}
