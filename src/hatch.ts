import * as THREE from "three";
import { createNoise2D } from "simplex-noise";
import type { SurfaceFn } from "./surfaces";

/**
 * Stipple (dot-shading) mode parameters.
 *
 * When `HatchParams.stipple` is present, `generateUVHatchLines` abandons
 * line sweeping entirely and emits one tiny polyline per dot. Because a dot
 * is just a 2-point (or 4-point) polyline on the surface, it flows through
 * the existing projection + occlusion pipeline with no changes there.
 */
export interface StippleParams {
  /**
   * Candidate dots per unit of UV length, per axis. The UV domain is
   * divided into a `dotsPerUnit * uSpan` x `dotsPerUnit * vSpan` stratified
   * grid; each cell contributes one jittered candidate.
   */
  dotsPerUnit?: number;
  /**
   * Dot mark size, in world units along the surface tangent (not UV units),
   * so dots stay visually consistent across surfaces with different UV scales.
   */
  dotSize?: number;
  /** "point" = one tiny tangent segment; "cross" = two crossing segments. */
  shape?: "point" | "cross";
  /** Seed for the deterministic PRNG driving jitter + density rejection. */
  seed?: number;
}

export interface HatchParams {
  family?: "u" | "v" | "diagonal" | "rings" | "hex" | "crosshatch" | "spiral" | "wave";
  count?: number;
  samples?: number;
  uRange?: [number, number];
  vRange?: [number, number];
  angle?: number;
  // Wave family parameters
  waveAmplitude?: number;
  waveFrequency?: number;
  // Noise perturbation (post-process, applies to all families)
  noiseAmplitude?: number;
  noiseFrequency?: number;
  // Dashed/broken lines (post-process, applies to all families)
  dashLength?: number;
  gapLength?: number;
  dashRandom?: number;
  // Variable-density hatching: callback returns 0..1 density at a UV point.
  // Lines are oversampled by densityOversample and probabilistically filtered.
  densityFn?: (u: number, v: number) => number;
  densityOversample?: number;
  /**
   * Stipple mode. When set, dots replace line families entirely (see
   * `generateStippleDots`). Leave undefined for the classic sweep behavior.
   */
  stipple?: StippleParams;
}

/** Deterministic 32-bit PRNG (mulberry32). Returns a () => [0,1) generator. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Generate stipple dots across the UV domain as tiny polylines on the surface.
 *
 * Sampling is a stratified jittered grid (more even than pure random, still
 * free of visible grid banding), driven by a seeded PRNG so a given seed
 * always yields the same dot field. Each candidate is kept with probability
 * `densityFn(u, v)` — with no densityFn every candidate is kept.
 *
 * Each kept dot is emitted as a tiny mark oriented along the surface tangents
 * at that point, so it sits on the surface and is occluded like any other
 * polyline.
 */
export function generateStippleDots(
  surfaceFn: SurfaceFn,
  surfaceParams: Record<string, number>,
  stipple: StippleParams,
  uRange: [number, number],
  vRange: [number, number],
  densityFn?: (u: number, v: number) => number,
): THREE.Vector3[][] {
  const {
    dotsPerUnit = 80,
    dotSize = 0.01,
    shape = "point",
    seed = 1,
  } = stipple;

  const uSpan = uRange[1] - uRange[0];
  const vSpan = vRange[1] - vRange[0];
  if (uSpan <= 0 || vSpan <= 0 || dotsPerUnit <= 0) return [];

  const gridU = Math.max(1, Math.round(dotsPerUnit * uSpan));
  const gridV = Math.max(1, Math.round(dotsPerUnit * vSpan));
  const cellU = uSpan / gridU;
  const cellV = vSpan / gridV;

  const rand = mulberry32(seed);
  const half = dotSize / 2;
  // Finite-difference step for tangents, scaled to the cell so it stays
  // meaningful on both tiny and huge UV domains.
  const eps = Math.min(cellU, cellV) * 0.25 || 1e-4;

  const dots: THREE.Vector3[][] = [];

  for (let i = 0; i < gridU; i++) {
    for (let j = 0; j < gridV; j++) {
      // Jittered stratified sample inside cell (i, j)
      const u = uRange[0] + (i + rand()) * cellU;
      const v = vRange[0] + (j + rand()) * cellV;
      // Draw the rejection value unconditionally so the PRNG stream stays
      // aligned regardless of whether densityFn is present.
      const keepRoll = rand();
      if (densityFn) {
        const d = densityFn(u, v);
        const p = d > 1 ? 1 : d < 0 ? 0 : d;
        if (keepRoll >= p) continue;
      }

      const p0 = surfaceFn(u, v, surfaceParams);
      const pu = surfaceFn(Math.min(uRange[1], u + eps), v, surfaceParams);
      const pv = surfaceFn(u, Math.min(vRange[1], v + eps), surfaceParams);

      // Tangent along u (normalized to world units), with a stable fallback
      let tux = pu.x - p0.x, tuy = pu.y - p0.y, tuz = pu.z - p0.z;
      let tLen = Math.sqrt(tux * tux + tuy * tuy + tuz * tuz);
      if (tLen < 1e-9) {
        tux = 1; tuy = 0; tuz = 0;
      } else {
        tux /= tLen; tuy /= tLen; tuz /= tLen;
      }

      dots.push([
        new THREE.Vector3(p0.x - tux * half, p0.y - tuy * half, p0.z - tuz * half),
        new THREE.Vector3(p0.x + tux * half, p0.y + tuy * half, p0.z + tuz * half),
      ]);

      if (shape === "cross") {
        let tvx = pv.x - p0.x, tvy = pv.y - p0.y, tvz = pv.z - p0.z;
        tLen = Math.sqrt(tvx * tvx + tvy * tvy + tvz * tvz);
        if (tLen < 1e-9) {
          tvx = 0; tvy = 1; tvz = 0;
        } else {
          tvx /= tLen; tvy /= tLen; tvz /= tLen;
        }
        dots.push([
          new THREE.Vector3(p0.x - tvx * half, p0.y - tvy * half, p0.z - tvz * half),
          new THREE.Vector3(p0.x + tvx * half, p0.y + tvy * half, p0.z + tvz * half),
        ]);
      }
    }
  }

  return dots;
}

/**
 * Generate a set of diagonal lines at a given angle across the UV domain.
 * Extracted so hex and crosshatch can reuse it.
 */
function generateDiagonalLines(
  surfaceFn: SurfaceFn,
  surfaceParams: Record<string, number>,
  angle: number,
  count: number,
  samples: number,
  uRange: [number, number],
  vRange: [number, number]
): THREE.Vector3[][] {
  const ca = Math.cos(angle);
  const sa = Math.sin(angle);
  const uSpan = uRange[1] - uRange[0];
  const vSpan = vRange[1] - vRange[0];
  const corners = [
    ca * uRange[0] + sa * vRange[0],
    ca * uRange[1] + sa * vRange[0],
    ca * uRange[0] + sa * vRange[1],
    ca * uRange[1] + sa * vRange[1],
  ];
  const isoMin = Math.min(...corners);
  const isoMax = Math.max(...corners);

  const lines: THREE.Vector3[][] = [];
  for (let i = 0; i < count; i++) {
    const isoVal = isoMin + (i / (count - 1)) * (isoMax - isoMin);
    const pts: THREE.Vector3[] = [];
    const maxExtent = Math.max(uSpan, vSpan);
    for (let j = 0; j <= samples; j++) {
      const t = (j / samples) * 2 - 1;
      const u = isoVal * ca - t * sa * maxExtent;
      const v = isoVal * sa + t * ca * maxExtent;
      const uc = uRange[0] + ((u - isoMin) / (isoMax - isoMin)) * uSpan;
      const vc = vRange[0] + ((v - isoMin) / (isoMax - isoMin)) * vSpan;
      if (uc >= uRange[0] && uc <= uRange[1] && vc >= vRange[0] && vc <= vRange[1]) {
        pts.push(surfaceFn(uc, vc, surfaceParams));
      }
    }
    if (pts.length >= 2) lines.push(pts);
  }
  return lines;
}

/**
 * Post-process: apply Perlin noise displacement perpendicular to each line's direction.
 * Adds organic imperfection to otherwise-regular hatch lines.
 */
function applyNoiseDisplacement(
  polylines: THREE.Vector3[][],
  amplitude: number,
  frequency: number,
): void {
  const noise2D = createNoise2D();

  for (let lineIdx = 0; lineIdx < polylines.length; lineIdx++) {
    const pts = polylines[lineIdx];
    for (let i = 0; i < pts.length; i++) {
      // Compute perpendicular direction from adjacent points
      let dx: number, dy: number, dz: number;
      if (i === 0 && pts.length > 1) {
        dx = pts[1].x - pts[0].x;
        dy = pts[1].y - pts[0].y;
        dz = pts[1].z - pts[0].z;
      } else if (i === pts.length - 1 && pts.length > 1) {
        dx = pts[i].x - pts[i - 1].x;
        dy = pts[i].y - pts[i - 1].y;
        dz = pts[i].z - pts[i - 1].z;
      } else {
        dx = pts[i + 1].x - pts[i - 1].x;
        dy = pts[i + 1].y - pts[i - 1].y;
        dz = pts[i + 1].z - pts[i - 1].z;
      }

      const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (len < 1e-8) continue;

      // Perpendicular in the XY plane (primary view)
      const perpX = -dy / len;
      const perpY = dx / len;
      const perpZ = 0;

      // Noise offset, seeded by line index for variation between lines
      const n = noise2D(
        pts[i].x * frequency + lineIdx * 0.1,
        pts[i].y * frequency,
      );
      const offset = amplitude * n;

      pts[i] = new THREE.Vector3(
        pts[i].x + perpX * offset,
        pts[i].y + perpY * offset,
        pts[i].z + perpZ * offset,
      );
    }
  }
}

/**
 * Post-process: split polylines into dash segments with optional random variation.
 */
function applyDashing(
  polylines: THREE.Vector3[][],
  dashLength: number,
  gapLength: number,
  dashRandom: number,
): THREE.Vector3[][] {
  const result: THREE.Vector3[][] = [];

  for (const pts of polylines) {
    if (pts.length < 2) {
      result.push(pts);
      continue;
    }

    // Walk along the polyline measuring cumulative arc length
    let drawing = true;
    let remaining = randomize(dashLength, dashRandom);
    let current: THREE.Vector3[] = [pts[0].clone()];

    for (let i = 1; i < pts.length; i++) {
      const dx = pts[i].x - pts[i - 1].x;
      const dy = pts[i].y - pts[i - 1].y;
      const dz = pts[i].z - pts[i - 1].z;
      const segLen = Math.sqrt(dx * dx + dy * dy + dz * dz);
      let consumed = 0;

      while (consumed < segLen) {
        const step = Math.min(remaining, segLen - consumed);
        const t = (consumed + step) / segLen;

        // Interpolated point along this segment
        const interp = new THREE.Vector3(
          pts[i - 1].x + dx * t,
          pts[i - 1].y + dy * t,
          pts[i - 1].z + dz * t,
        );

        if (drawing) {
          current.push(interp);
        }

        consumed += step;
        remaining -= step;

        if (remaining <= 0) {
          if (drawing && current.length >= 2) {
            result.push(current);
          }
          drawing = !drawing;
          remaining = drawing
            ? randomize(dashLength, dashRandom)
            : randomize(gapLength, dashRandom);
          if (drawing) {
            current = [interp.clone()];
          } else {
            current = [];
          }
        }
      }

      // If we're drawing and haven't switched yet, add the endpoint
      if (drawing && consumed >= segLen) {
        // Already added interpolated point at end
      }
    }

    // Flush remaining drawn segment
    if (drawing && current.length >= 2) {
      result.push(current);
    }
  }

  return result;
}

function randomize(base: number, randomness: number): number {
  if (randomness <= 0) return base;
  return base * (1 + (Math.random() * 2 - 1) * randomness);
}

export function generateUVHatchLines(
  surfaceFn: SurfaceFn,
  surfaceParams: Record<string, number>,
  hatchParams: HatchParams
): THREE.Vector3[][] {
  const {
    family = "u",
    count = 30,
    samples = 60,
    uRange = [0, 1],
    vRange = [0, 1],
    angle = 0,
    waveAmplitude = 0.05,
    waveFrequency = 6,
    noiseAmplitude,
    noiseFrequency,
    dashLength,
    gapLength,
    dashRandom = 0,
    densityFn,
    densityOversample = 3,
    stipple,
  } = hatchParams;

  // Stipple mode: dots instead of swept line families. Purely additive —
  // when `stipple` is undefined this branch is skipped and every code path
  // below is untouched.
  if (stipple) {
    return generateStippleDots(surfaceFn, surfaceParams, stipple, uRange, vRange, densityFn);
  }

  // If densityFn is provided, oversample the line count and filter afterward
  const effectiveCount = densityFn ? count * densityOversample : count;

  let polylines3D: THREE.Vector3[][] = [];
  // Track UV midpoints per line for density filtering
  const lineMidUV: { u: number; v: number }[] = [];

  if (family === "u") {
    for (let i = 0; i < effectiveCount; i++) {
      const u = uRange[0] + (i / (effectiveCount - 1)) * (uRange[1] - uRange[0]);
      const vMid = (vRange[0] + vRange[1]) / 2;
      const pts: THREE.Vector3[] = [];
      for (let j = 0; j <= samples; j++) {
        const v = vRange[0] + (j / samples) * (vRange[1] - vRange[0]);
        pts.push(surfaceFn(u, v, surfaceParams));
      }
      polylines3D.push(pts);
      lineMidUV.push({ u, v: vMid });
    }
  } else if (family === "v") {
    for (let i = 0; i < effectiveCount; i++) {
      const v = vRange[0] + (i / (effectiveCount - 1)) * (vRange[1] - vRange[0]);
      const uMid = (uRange[0] + uRange[1]) / 2;
      const pts: THREE.Vector3[] = [];
      for (let j = 0; j <= samples; j++) {
        const u = uRange[0] + (j / samples) * (uRange[1] - uRange[0]);
        pts.push(surfaceFn(u, v, surfaceParams));
      }
      polylines3D.push(pts);
      lineMidUV.push({ u: uMid, v });
    }
  } else if (family === "diagonal") {
    const lines = generateDiagonalLines(surfaceFn, surfaceParams, angle, effectiveCount, samples, uRange, vRange);
    for (let i = 0; i < lines.length; i++) {
      polylines3D.push(lines[i]);
      const t = effectiveCount > 1 ? i / (effectiveCount - 1) : 0.5;
      lineMidUV.push({
        u: (uRange[0] + uRange[1]) / 2,
        v: vRange[0] + t * (vRange[1] - vRange[0]),
      });
    }
  } else if (family === "rings") {
    const uMid = (uRange[0] + uRange[1]) / 2;
    const vMid = (vRange[0] + vRange[1]) / 2;
    const uSpan = uRange[1] - uRange[0];
    const vSpan = vRange[1] - vRange[0];
    const maxRadius = Math.min(uSpan, vSpan) / 2;

    for (let i = 0; i < effectiveCount; i++) {
      const r = ((i + 1) / effectiveCount) * maxRadius;
      const pts: THREE.Vector3[] = [];
      for (let j = 0; j <= samples; j++) {
        const theta = (j / samples) * Math.PI * 2;
        const u = uMid + r * Math.cos(theta);
        const v = vMid + r * Math.sin(theta);
        if (u >= uRange[0] && u <= uRange[1] && v >= vRange[0] && v <= vRange[1]) {
          pts.push(surfaceFn(u, v, surfaceParams));
        }
      }
      if (pts.length >= 2) {
        polylines3D.push(pts);
        lineMidUV.push({ u: uMid + r, v: vMid });
      }
    }
  } else if (family === "hex") {
    const perDir = Math.max(1, Math.floor(effectiveCount / 3));
    const angles = [0, Math.PI / 3, (2 * Math.PI) / 3];
    for (const a of angles) {
      const lines = generateDiagonalLines(surfaceFn, surfaceParams, a, perDir, samples, uRange, vRange);
      for (let i = 0; i < lines.length; i++) {
        polylines3D.push(lines[i]);
        const t = perDir > 1 ? i / (perDir - 1) : 0.5;
        lineMidUV.push({
          u: (uRange[0] + uRange[1]) / 2,
          v: vRange[0] + t * (vRange[1] - vRange[0]),
        });
      }
    }
  } else if (family === "crosshatch") {
    const perDir = Math.max(1, Math.floor(effectiveCount / 2));
    for (const a of [angle, angle + Math.PI / 2]) {
      const lines = generateDiagonalLines(surfaceFn, surfaceParams, a, perDir, samples, uRange, vRange);
      for (let i = 0; i < lines.length; i++) {
        polylines3D.push(lines[i]);
        const t = perDir > 1 ? i / (perDir - 1) : 0.5;
        lineMidUV.push({
          u: (uRange[0] + uRange[1]) / 2,
          v: vRange[0] + t * (vRange[1] - vRange[0]),
        });
      }
    }
  } else if (family === "spiral") {
    const uMid = (uRange[0] + uRange[1]) / 2;
    const vMid = (vRange[0] + vRange[1]) / 2;
    const uSpan = uRange[1] - uRange[0];
    const vSpan = vRange[1] - vRange[0];
    const maxRadius = Math.min(uSpan, vSpan) / 2;
    const totalTurns = 4;
    const maxTheta = totalTurns * Math.PI * 2;

    for (let i = 0; i < effectiveCount; i++) {
      const armOffset = (i / effectiveCount) * Math.PI * 2;
      const pts: THREE.Vector3[] = [];
      for (let j = 0; j <= samples; j++) {
        const theta = (j / samples) * maxTheta;
        const r = (theta / maxTheta) * maxRadius;
        const u = uMid + r * Math.cos(theta + armOffset);
        const v = vMid + r * Math.sin(theta + armOffset);
        if (u >= uRange[0] && u <= uRange[1] && v >= vRange[0] && v <= vRange[1]) {
          pts.push(surfaceFn(u, v, surfaceParams));
        }
      }
      if (pts.length >= 2) {
        polylines3D.push(pts);
        lineMidUV.push({ u: uMid, v: vMid });
      }
    }
  } else if (family === "wave") {
    // Sinusoidal hatch lines — like v-constant lines but with sine modulation
    const vSpan = vRange[1] - vRange[0];
    for (let i = 0; i < effectiveCount; i++) {
      const vBase = vRange[0] + (i / (effectiveCount - 1)) * vSpan;
      const phaseShift = i * 0.3;
      const pts: THREE.Vector3[] = [];
      for (let j = 0; j <= samples; j++) {
        const u = uRange[0] + (j / samples) * (uRange[1] - uRange[0]);
        const v = vBase + waveAmplitude * Math.sin(u * waveFrequency * Math.PI * 2 + phaseShift);
        // Clamp v to range
        const vc = Math.max(vRange[0], Math.min(vRange[1], v));
        pts.push(surfaceFn(u, vc, surfaceParams));
      }
      polylines3D.push(pts);
      lineMidUV.push({ u: (uRange[0] + uRange[1]) / 2, v: vBase });
    }
  }

  // Post-process: density-based filtering (oversample-and-filter)
  if (densityFn && polylines3D.length > 0) {
    const filtered: THREE.Vector3[][] = [];
    for (let i = 0; i < polylines3D.length; i++) {
      const mid = lineMidUV[i];
      if (!mid) {
        filtered.push(polylines3D[i]);
        continue;
      }
      const density = densityFn(mid.u, mid.v);
      // Probabilistic keep: density 1 = always keep, density 0 = always drop
      if (Math.random() < Math.max(0, Math.min(1, density))) {
        filtered.push(polylines3D[i]);
      }
    }
    polylines3D = filtered;
  }

  // Post-process: noise perturbation
  if (noiseAmplitude && noiseAmplitude > 0 && noiseFrequency && noiseFrequency > 0) {
    applyNoiseDisplacement(polylines3D, noiseAmplitude, noiseFrequency);
  }

  // Post-process: dashed lines
  if (dashLength && dashLength > 0 && gapLength && gapLength > 0) {
    polylines3D = applyDashing(polylines3D, dashLength, gapLength, dashRandom);
  }

  return polylines3D;
}
