/**
 * Patch operators — Geometry (+ a modulating Field) → Geometry.
 *
 * These are the "modules with a CV input": each takes geometry and a field that
 * modulates how it transforms that geometry. Pure and deterministic, so a patch
 * built from them still compiles reproducibly and stays measurable.
 */

import type { Geometry, ScalarField, VectorField } from "./signals.js";

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
