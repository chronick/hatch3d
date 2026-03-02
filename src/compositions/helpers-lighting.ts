import type { HatchParams } from "../hatch";
import type { LayerConfig } from "./types";
import { SURFACES } from "../surfaces";

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
