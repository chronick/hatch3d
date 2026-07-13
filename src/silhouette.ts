/**
 * Analytic silhouette/contour extraction.
 *
 * A silhouette point is where the view ray grazes the surface:
 *   g(u, v) = N(u, v) · V(u, v) = 0
 * with N the unit surface normal and V the unit direction from the surface
 * point to the camera. We evaluate g on a UV grid and extract its zero-set
 * with marching squares, interpolating the crossing position linearly along
 * cell edges (the Hertzmann–Zorin insight: interpolated crossings move
 * continuously with the camera, whereas per-cell sign tests staircase).
 *
 * Pure function of its inputs — no randomness, no time. Same surface,
 * params, transform, and camera position → identical polylines.
 */

import * as THREE from "three";
import type { SurfaceFn } from "./surfaces";
import { surfaceNormalUV } from "./compositions/helpers-lighting";

export interface SilhouetteOptions {
  /** UV window to scan (defaults [0,1]²; pass the layer's hatch ranges). */
  uRange?: [number, number];
  /** See uRange. */
  vRange?: [number, number];
  /** Cells per axis of the marching-squares grid. */
  gridSize?: number;
}

const DEFAULT_GRID_SIZE = 96;

/** One edge-crossing of the zero-set, identified by a stable key. */
interface Crossing {
  key: string;
  u: number;
  v: number;
}

/**
 * Extract silhouette polylines for one surface layer.
 *
 * Evaluates g = N·V on a (gridSize+1)² grid over the UV window, runs
 * marching squares with linear edge interpolation, chains the per-cell
 * segments into polylines, and maps them back to 3D through `surfaceFn`
 * (plus the layer's transform offset — the same offset must be applied to
 * V, since translation moves the point relative to the camera but leaves
 * the normal unchanged).
 *
 * Degenerate cells (surfaceNormalUV returns null at a corner) are skipped.
 * Closed surfaces (e.g. the torus wraps in both u and v) get no seam-aware
 * wrapping in v1 — a silhouette curve crossing the u=0/u=1 seam simply ends
 * at the grid border instead of chaining through it.
 */
export function extractSilhouettePolylines(
  surfaceFn: SurfaceFn,
  params: Record<string, number>,
  transform: { x?: number; y?: number; z?: number } | undefined,
  camPos: THREE.Vector3,
  opts: SilhouetteOptions = {},
): THREE.Vector3[][] {
  const grid = Math.max(2, Math.round(opts.gridSize ?? DEFAULT_GRID_SIZE));
  const [u0, u1] = opts.uRange ?? [0, 1];
  const [v0, v1] = opts.vRange ?? [0, 1];
  const tx = transform?.x ?? 0;
  const ty = transform?.y ?? 0;
  const tz = transform?.z ?? 0;

  const uAt = (i: number) => u0 + (i / grid) * (u1 - u0);
  const vAt = (j: number) => v0 + (j / grid) * (v1 - v0);

  // ── Grid evaluation: g[i + j*(grid+1)] = N·V, NaN where degenerate ──
  const g = new Float64Array((grid + 1) * (grid + 1));
  for (let j = 0; j <= grid; j++) {
    for (let i = 0; i <= grid; i++) {
      const u = uAt(i);
      const v = vAt(j);
      const nrm = surfaceNormalUV(surfaceFn, params, u, v);
      if (!nrm) {
        g[i + j * (grid + 1)] = NaN;
        continue;
      }
      const p = surfaceFn(u, v, params);
      const vx = camPos.x - (p.x + tx);
      const vy = camPos.y - (p.y + ty);
      const vz = camPos.z - (p.z + tz);
      const vLen = Math.sqrt(vx * vx + vy * vy + vz * vz);
      g[i + j * (grid + 1)] =
        vLen < 1e-12
          ? NaN // camera sits on the surface point — treat as degenerate
          : (nrm[0] * vx + nrm[1] * vy + nrm[2] * vz) / vLen;
    }
  }

  // ── Marching squares with linear edge interpolation ──
  // Crossings on a shared cell edge are computed from the same two grid
  // values in the same order, so both adjacent cells produce the identical
  // fraction — keying on edge index + quantized fraction lets the chaining
  // step match them up exactly.
  const positive = (x: number) => x > 0;
  const frac = (a: number, b: number) =>
    Math.min(1, Math.max(0, a / (a - b)));

  // Horizontal edge (i,j)→(i+1,j); vertical edge (i,j)→(i,j+1).
  const hCrossing = (i: number, j: number): Crossing | null => {
    const a = g[i + j * (grid + 1)];
    const b = g[i + 1 + j * (grid + 1)];
    if (positive(a) === positive(b)) return null;
    const t = frac(a, b);
    return { key: `h,${i},${j},${Math.round(t * 1e9)}`, u: uAt(i + t), v: vAt(j) };
  };
  const vCrossing = (i: number, j: number): Crossing | null => {
    const a = g[i + j * (grid + 1)];
    const b = g[i + (j + 1) * (grid + 1)];
    if (positive(a) === positive(b)) return null;
    const t = frac(a, b);
    return { key: `v,${i},${j},${Math.round(t * 1e9)}`, u: uAt(i), v: vAt(j + t) };
  };

  const segments: [Crossing, Crossing][] = [];
  for (let j = 0; j < grid; j++) {
    for (let i = 0; i < grid; i++) {
      const a = g[i + j * (grid + 1)]; // bottom-left  (i,   j)
      const b = g[i + 1 + j * (grid + 1)]; // bottom-right (i+1, j)
      const c = g[i + 1 + (j + 1) * (grid + 1)]; // top-right    (i+1, j+1)
      const d = g[i + (j + 1) * (grid + 1)]; // top-left     (i,   j+1)
      // Skip cells touching a degenerate normal.
      if (Number.isNaN(a) || Number.isNaN(b) || Number.isNaN(c) || Number.isNaN(d)) continue;

      const bottom = hCrossing(i, j);
      const top = hCrossing(i, j + 1);
      const left = vCrossing(i, j);
      const right = vCrossing(i + 1, j);
      const crossings = [bottom, right, top, left].filter(
        (x): x is Crossing => x !== null,
      );

      if (crossings.length === 2) {
        segments.push([crossings[0], crossings[1]]);
      } else if (crossings.length === 4) {
        // Saddle cell (two diagonal corners positive): the center average
        // disambiguates which pairs of crossings belong to the same curve.
        const center = (a + b + c + d) / 4;
        if (positive(center) === positive(a)) {
          segments.push([bottom!, right!], [top!, left!]);
        } else {
          segments.push([bottom!, left!], [right!, top!]);
        }
      }
      // 0 crossings → no contour; odd counts can't occur with a consistent
      // sign predicate on non-NaN values.
    }
  }

  // ── Chain per-cell segments into polylines via shared crossing keys ──
  const bySegKey = new Map<string, number[]>();
  for (let s = 0; s < segments.length; s++) {
    for (const end of segments[s]) {
      const list = bySegKey.get(end.key);
      if (list) list.push(s);
      else bySegKey.set(end.key, [s]);
    }
  }

  const used = new Array<boolean>(segments.length).fill(false);
  const takeNext = (key: string): number => {
    const list = bySegKey.get(key);
    if (!list) return -1;
    for (const s of list) if (!used[s]) return s;
    return -1;
  };

  const chains: Crossing[][] = [];
  for (let s = 0; s < segments.length; s++) {
    if (used[s]) continue;
    used[s] = true;
    const chain: Crossing[] = [segments[s][0], segments[s][1]];

    // Grow forward from the tail, then backward from the head.
    for (const dir of ["tail", "head"] as const) {
      for (;;) {
        const endKey = dir === "tail" ? chain[chain.length - 1].key : chain[0].key;
        const next = takeNext(endKey);
        if (next < 0) break;
        used[next] = true;
        const [p, q] = segments[next];
        const other = p.key === endKey ? q : p;
        if (dir === "tail") chain.push(other);
        else chain.unshift(other);
      }
    }
    chains.push(chain);
  }

  // ── UV polylines → 3D through the surface fn (+ transform offset) ──
  return chains.map((chain) =>
    chain.map(({ u, v }) => {
      const p = surfaceFn(u, v, params);
      p.x += tx;
      p.y += ty;
      p.z += tz;
      return p;
    }),
  );
}
