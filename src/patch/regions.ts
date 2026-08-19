/**
 * Region references — the schema and resolution for "the area another node
 * occupies".
 *
 * `hullOf` was the v1 form; it is now one point in a small space of *derived
 * regions* (design doc `active/plotter-art-workflow/design/scene-ir.md`
 * § Progressive composition semantics):
 *
 * ```jsonc
 * { "polygon": [[x, y], …] }                                  // explicit
 * { "hullOf": "n1" }                                          // ≡ regionOf hull
 * { "regionOf": { "of": "n1", "kind": "bbox",
 *                 "offsetPx": 12, "cornerRadius": 18 } }       // derived
 * ```
 *
 * The geometry of the four `kind`s lives in `src/operators/region-shapes.ts`
 * (shared with compositions); this module is only the patch-side wiring —
 * schema, normalisation, and turning a reference into even-odd rings.
 */

import { z } from "zod";
import type { Geometry } from "./signals.js";
import {
  derivedRegionRings,
  type Polyline,
  type RegionOfSpec,
} from "../operators/region-shapes.js";
import { convexHull } from "../utils/clip.js";

export const RegionOfSchema = z
  .object({
    /** Node id whose geometry the region is derived from. */
    of: z.string().min(1),
    kind: z.enum(["bbox", "hull", "outline", "occupied"]),
    /** Grow (+) / shrink (−) the region, in canvas px. */
    offsetPx: z.number().optional(),
    /** Round the region polygon's corners (bbox / hull; ignored elsewhere). */
    cornerRadius: z.number().nonnegative().optional(),
  })
  .strict();

/** The three mutually exclusive region forms a clip / emphasis node accepts. */
export interface RegionRef {
  hullOf?: string;
  polygon?: [number, number][];
  regionOf?: RegionOfSpec;
}

/** How many of the three region forms a node carries (must be exactly one). */
export function regionFormCount(n: RegionRef): number {
  return (n.hullOf != null ? 1 : 0) + (n.polygon != null ? 1 : 0) + (n.regionOf != null ? 1 : 0);
}

/** The node id a region reference reads geometry from, if any. */
export function regionSourceId(n: RegionRef): string | undefined {
  return n.regionOf?.of ?? n.hullOf;
}

/**
 * Resolve a region reference to even-odd rings.
 *
 * `hullOf: X` is exactly `regionOf: { of: X, kind: "hull" }` — the alias is
 * normalised here rather than duplicated, so there is one derivation path.
 * `lookup` returns the referenced node's geometry (the evaluator's env).
 */
export function resolveRegionRings(n: RegionRef, lookup: (id: string) => Geometry): Polyline[] {
  if (n.polygon) return [n.polygon.map(([x, y]) => ({ x, y }))];
  if (n.hullOf != null) {
    const hull = convexHull(lookup(n.hullOf).flat());
    return hull.length >= 3 ? [hull] : [];
  }
  if (n.regionOf) return derivedRegionRings(lookup(n.regionOf.of), n.regionOf);
  return [];
}
