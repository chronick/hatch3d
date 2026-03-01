import type { SurfaceFn } from "../surfaces";

/**
 * Create a density function based on surface normal vs light direction (N·L).
 * Returns high density (1.0) in shadow and low density (near 0) in lit areas.
 */
export function lightDensityFn(
  surfaceFn: SurfaceFn,
  params: Record<string, number>,
  lightDir: [number, number, number],
): (u: number, v: number) => number {
  const lLen = Math.sqrt(lightDir[0] ** 2 + lightDir[1] ** 2 + lightDir[2] ** 2);
  const lx = lightDir[0] / lLen;
  const ly = lightDir[1] / lLen;
  const lz = lightDir[2] / lLen;
  const epsilon = 0.001;

  return (u: number, v: number): number => {
    const p = surfaceFn(u, v, params);
    const pu = surfaceFn(u + epsilon, v, params);
    const pv = surfaceFn(u, v + epsilon, params);

    const dPdu_x = (pu.x - p.x) / epsilon;
    const dPdu_y = (pu.y - p.y) / epsilon;
    const dPdu_z = (pu.z - p.z) / epsilon;
    const dPdv_x = (pv.x - p.x) / epsilon;
    const dPdv_y = (pv.y - p.y) / epsilon;
    const dPdv_z = (pv.z - p.z) / epsilon;

    // Normal = dPdu × dPdv
    const nx = dPdu_y * dPdv_z - dPdu_z * dPdv_y;
    const ny = dPdu_z * dPdv_x - dPdu_x * dPdv_z;
    const nz = dPdu_x * dPdv_y - dPdu_y * dPdv_x;
    const nLen = Math.sqrt(nx * nx + ny * ny + nz * nz);

    if (nLen < 1e-8) return 0.5;

    const dot = (nx / nLen) * lx + (ny / nLen) * ly + (nz / nLen) * lz;
    // brightness 0 (shadow) → density 1, brightness 1 (lit) → density ~0.1
    const brightness = Math.max(0, Math.min(1, (dot + 1) / 2));
    return 0.1 + (1 - brightness) * 0.9;
  };
}

/**
 * Create a density function based on approximate Gaussian curvature.
 * High curvature areas get denser hatching. Uses finite differences.
 */
export function curvatureDensityFn(
  surfaceFn: SurfaceFn,
  params: Record<string, number>,
): (u: number, v: number) => number {
  const h = 0.002;

  return (u: number, v: number): number => {
    // First partial derivatives
    const p = surfaceFn(u, v, params);
    const pu = surfaceFn(u + h, v, params);
    const pv = surfaceFn(u, v + h, params);
    const pmu = surfaceFn(u - h, v, params);
    const pmv = surfaceFn(u, v - h, params);

    // Second partial derivatives via central differences
    const puu_x = (pu.x - 2 * p.x + pmu.x) / (h * h);
    const puu_y = (pu.y - 2 * p.y + pmu.y) / (h * h);
    const puu_z = (pu.z - 2 * p.z + pmu.z) / (h * h);

    const pvv_x = (pv.x - 2 * p.x + pmv.x) / (h * h);
    const pvv_y = (pv.y - 2 * p.y + pmv.y) / (h * h);
    const pvv_z = (pv.z - 2 * p.z + pmv.z) / (h * h);

    // Normal
    const du_x = (pu.x - pmu.x) / (2 * h);
    const du_y = (pu.y - pmu.y) / (2 * h);
    const du_z = (pu.z - pmu.z) / (2 * h);
    const dv_x = (pv.x - pmv.x) / (2 * h);
    const dv_y = (pv.y - pmv.y) / (2 * h);
    const dv_z = (pv.z - pmv.z) / (2 * h);

    const nx = du_y * dv_z - du_z * dv_y;
    const ny = du_z * dv_x - du_x * dv_z;
    const nz = du_x * dv_y - du_y * dv_x;
    const nLen = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (nLen < 1e-8) return 0.5;

    const nnx = nx / nLen, nny = ny / nLen, nnz = nz / nLen;

    // Second fundamental form coefficients
    const L = puu_x * nnx + puu_y * nny + puu_z * nnz;
    const N = pvv_x * nnx + pvv_y * nny + pvv_z * nnz;

    // Approximate Gaussian curvature K ≈ L * N / (E * G) (ignoring cross term)
    const E = du_x * du_x + du_y * du_y + du_z * du_z;
    const G = dv_x * dv_x + dv_y * dv_y + dv_z * dv_z;
    const denom = E * G;
    if (denom < 1e-12) return 0.5;

    const K = Math.abs(L * N / denom);

    // Map curvature to density: low curvature → sparse, high curvature → dense
    // Use sigmoid-like mapping to keep output in [0.1, 1.0]
    return 0.1 + 0.9 * (1 - 1 / (1 + K * 5));
  };
}

/**
 * Create a radial density function centered at (cu, cv) in UV space.
 * Density is highest at center and falls off with distance.
 */
export function radialDensityFn(
  center: [number, number],
  falloff: number,
): (u: number, v: number) => number {
  return (u: number, v: number): number => {
    const du = u - center[0];
    const dv = v - center[1];
    const dist = Math.sqrt(du * du + dv * dv);
    return Math.max(0.05, Math.exp(-dist * dist * falloff));
  };
}
