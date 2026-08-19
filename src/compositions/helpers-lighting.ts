import type { HatchParams } from "../hatch";
import type { LayerConfig } from "./types";
import { SURFACES } from "../surfaces";
import type { SurfaceFn } from "../surfaces";

/**
 * Unit surface normal at (u, v) via finite differencing: dP/du × dP/dv.
 * Returns null where the surface is degenerate (zero-length normal).
 */
export function surfaceNormalUV(
  surfaceFn: SurfaceFn,
  params: Record<string, number>,
  u: number,
  v: number,
  epsilon = 0.001,
): [number, number, number] | null {
  const p = surfaceFn(u, v, params);
  const pu = surfaceFn(u + epsilon, v, params);
  const pv = surfaceFn(u, v + epsilon, params);

  const dux = (pu.x - p.x) / epsilon;
  const duy = (pu.y - p.y) / epsilon;
  const duz = (pu.z - p.z) / epsilon;
  const dvx = (pv.x - p.x) / epsilon;
  const dvy = (pv.y - p.y) / epsilon;
  const dvz = (pv.z - p.z) / epsilon;

  const nx = duy * dvz - duz * dvy;
  const ny = duz * dvx - dux * dvz;
  const nz = dux * dvy - duy * dvx;
  const nLen = Math.sqrt(nx * nx + ny * ny + nz * nz);
  if (nLen < 1e-8) return null;
  return [nx / nLen, ny / nLen, nz / nLen];
}

export interface TonalHatchOptions {
  /** Number of tonal layers = number of hatch angle sets (2–4 sensible). */
  layers?: number;
  /** Base hatch angle in radians; successive layers rotate by π/layers. */
  angle?: number;
  /** UV sample epsilon for normals. */
  epsilon?: number;
}

/**
 * Tonal cross-hatch layering (Krbn's tonal model — "form is direction,
 * shading is density"): each successive angle set is clipped, point by
 * point, to the part of the surface dark enough for it.
 *
 *   layer i of n covers where diffuse < 0.95 * (n - i) / n
 *
 * Layer 0 covers everything but the brightest highlight; each deeper layer
 * only progressively darker regions. A curved surface shades light→dark as
 * overlapping layers accumulate toward the terminator. Brightness is the
 * Lambert term N·L against `lightDir` (direction pointing toward the light).
 */
export function tonalHatchLayers(
  surface: string,
  params: Record<string, number>,
  lightDir: [number, number, number],
  baseHatch: HatchParams,
  opts: TonalHatchOptions = {},
): LayerConfig[] {
  const surfaceFn = SURFACES[surface]?.fn;
  if (!surfaceFn) return [{ surface, params, hatch: baseHatch }];

  const n = Math.max(1, Math.round(opts.layers ?? 3));
  const baseAngle = opts.angle ?? baseHatch.angle ?? 0.7;
  const epsilon = opts.epsilon ?? 0.001;

  const lLen = Math.sqrt(lightDir[0] ** 2 + lightDir[1] ** 2 + lightDir[2] ** 2) || 1;
  const lx = lightDir[0] / lLen;
  const ly = lightDir[1] / lLen;
  const lz = lightDir[2] / lLen;

  const diffuse = (u: number, v: number): number => {
    const nrm = surfaceNormalUV(surfaceFn, params, u, v, epsilon);
    if (!nrm) return 0.5;
    // Double-sided surfaces: |N·L| so the "back" of a sheet shades the same
    // as the front instead of reading as full shadow.
    return Math.abs(nrm[0] * lx + nrm[1] * ly + nrm[2] * lz);
  };

  const layers: LayerConfig[] = [];
  for (let i = 0; i < n; i++) {
    const threshold = 0.95 * ((n - i) / n);
    layers.push({
      surface,
      params,
      hatch: {
        ...baseHatch,
        family: "diagonal",
        angle: baseAngle + (i * Math.PI) / n,
        clipFn: (u, v) => diffuse(u, v) < threshold,
      },
    });
  }
  return layers;
}

/**
 * Generate light-modulated hatch layers by dividing UV space into strips
 * and varying hatch density based on surface normal vs. light direction.
 *
 * Lit areas get fewer lines (sparse), shadowed areas get more (dense).
 */
export function lightModulatedLayers(
  surface: string,
  params: Record<string, number>,
  lightDir: [number, number, number],
  baseHatch: HatchParams,
  segments: number = 8,
): LayerConfig[] {
  const surfaceFn = SURFACES[surface]?.fn;
  if (!surfaceFn) return [{ surface, params, hatch: baseHatch }];

  const {
    uRange = [0, 1],
    vRange = [0, 1],
    count = 30,
  } = baseHatch;

  // Normalize light direction
  const lLen = Math.sqrt(
    lightDir[0] ** 2 + lightDir[1] ** 2 + lightDir[2] ** 2,
  );
  const lx = lightDir[0] / lLen;
  const ly = lightDir[1] / lLen;
  const lz = lightDir[2] / lLen;

  const vSpan = vRange[1] - vRange[0];
  const epsilon = 0.001;

  const layers: LayerConfig[] = [];

  for (let s = 0; s < segments; s++) {
    const vStart = vRange[0] + (s / segments) * vSpan;
    const vEnd = vRange[0] + ((s + 1) / segments) * vSpan;
    const vMid = (vStart + vEnd) / 2;
    const uMid = (uRange[0] + uRange[1]) / 2;

    // Compute surface normal at strip center via finite differencing
    const p = surfaceFn(uMid, vMid, params);
    const pu = surfaceFn(uMid + epsilon, vMid, params);
    const pv = surfaceFn(uMid, vMid + epsilon, params);

    const dPdu = {
      x: (pu.x - p.x) / epsilon,
      y: (pu.y - p.y) / epsilon,
      z: (pu.z - p.z) / epsilon,
    };
    const dPdv = {
      x: (pv.x - p.x) / epsilon,
      y: (pv.y - p.y) / epsilon,
      z: (pv.z - p.z) / epsilon,
    };

    // Cross product: normal = dPdu × dPdv
    const nx = dPdu.y * dPdv.z - dPdu.z * dPdv.y;
    const ny = dPdu.z * dPdv.x - dPdu.x * dPdv.z;
    const nz = dPdu.x * dPdv.y - dPdu.y * dPdv.x;
    const nLen = Math.sqrt(nx * nx + ny * ny + nz * nz);

    // N · L brightness (0 = shadow, 1 = fully lit)
    let brightness = 0.5;
    if (nLen > 1e-8) {
      const dot = (nx / nLen) * lx + (ny / nLen) * ly + (nz / nLen) * lz;
      brightness = Math.max(0, Math.min(1, (dot + 1) / 2));
    }

    // Invert: dense hatching in shadow, sparse in light
    // Scale from 0.3x (bright) to 2.0x (shadow)
    const densityMul = 0.3 + (1 - brightness) * 1.7;
    const stripCount = Math.max(1, Math.round(count * densityMul / segments));

    layers.push({
      surface,
      params,
      hatch: {
        ...baseHatch,
        count: stripCount,
        vRange: [vStart, vEnd],
      },
    });
  }

  return layers;
}
