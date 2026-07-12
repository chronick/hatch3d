import * as THREE from "three";
import { createNoise2D } from "simplex-noise";
import { mulberry32, hash01 } from "./utils/prng";
import type { SurfaceFn } from "./surfaces";

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
   * Point-level UV clip: return false to omit the point, splitting the
   * polyline at that boundary. Enables tonal layering — clip each
   * cross-hatch angle set to the surface region dark enough for it
   * (Krbn's tonal model: shading is density, form is direction).
   */
  clipFn?: (u: number, v: number) => boolean;
  /**
   * Seed for all stochastic post-processing (noise displacement, dash
   * randomness, density filtering). Same params + same seed → identical
   * output. Defaults to 0.
   */
  seed?: number;
}

/**
 * Accumulates surface points for one hatch line, splitting the polyline
 * wherever clipFn rejects a point. Out-of-range UV samples are still simply
 * skipped by callers (joining across the gap) to preserve legacy behavior;
 * only clipFn causes a split.
 */
class LineCollector {
  private current: THREE.Vector3[] = [];
  private lines: THREE.Vector3[][] = [];
  private surfaceFn: SurfaceFn;
  private params: Record<string, number>;
  private clipFn?: (u: number, v: number) => boolean;

  constructor(
    surfaceFn: SurfaceFn,
    params: Record<string, number>,
    clipFn?: (u: number, v: number) => boolean,
  ) {
    this.surfaceFn = surfaceFn;
    this.params = params;
    this.clipFn = clipFn;
  }

  add(u: number, v: number): void {
    if (this.clipFn && !this.clipFn(u, v)) {
      this.split();
      return;
    }
    this.current.push(this.surfaceFn(u, v, this.params));
  }

  private split(): void {
    if (this.current.length >= 2) this.lines.push(this.current);
    this.current = [];
  }

  /** Finish the line and return the collected polyline segments (each ≥ 2 points). */
  end(): THREE.Vector3[][] {
    this.split();
    const out = this.lines;
    this.lines = [];
    return out;
  }
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
  vRange: [number, number],
  clipFn?: (u: number, v: number) => boolean
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
    const col = new LineCollector(surfaceFn, surfaceParams, clipFn);
    const maxExtent = Math.max(uSpan, vSpan);
    for (let j = 0; j <= samples; j++) {
      const t = (j / samples) * 2 - 1;
      const u = isoVal * ca - t * sa * maxExtent;
      const v = isoVal * sa + t * ca * maxExtent;
      const uc = uRange[0] + ((u - isoMin) / (isoMax - isoMin)) * uSpan;
      const vc = vRange[0] + ((v - isoMin) / (isoMax - isoMin)) * vSpan;
      if (uc >= uRange[0] && uc <= uRange[1] && vc >= vRange[0] && vc <= vRange[1]) {
        col.add(uc, vc);
      }
    }
    lines.push(...col.end());
  }
  return lines;
}

/**
 * Post-process: apply noise displacement perpendicular to each line's direction.
 * Adds organic imperfection to otherwise-regular hatch lines.
 *
 * The noise field is sampled at each point's object-space position (not by
 * emission order), so lines that share geometry get coherent offsets and the
 * wobble stays anchored to the surface as parameters change — Krbn's
 * anti-"boiling" property. Seeded: same seed → same displacement.
 */
function applyNoiseDisplacement(
  polylines: THREE.Vector3[][],
  amplitude: number,
  frequency: number,
  seed: number,
): void {
  const noise2D = createNoise2D(mulberry32(seed ^ 0x9e3779b9));

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
  rng: () => number,
): THREE.Vector3[][] {
  const result: THREE.Vector3[][] = [];

  for (const pts of polylines) {
    if (pts.length < 2) {
      result.push(pts);
      continue;
    }

    // Walk along the polyline measuring cumulative arc length
    let drawing = true;
    let remaining = randomize(dashLength, dashRandom, rng);
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
            ? randomize(dashLength, dashRandom, rng)
            : randomize(gapLength, dashRandom, rng);
          if (drawing) {
            current = [interp.clone()];
          } else {
            current = [];
          }
        }
      }
    }

    // Flush remaining drawn segment
    if (drawing && current.length >= 2) {
      result.push(current);
    }
  }

  return result;
}

function randomize(base: number, randomness: number, rng: () => number): number {
  if (randomness <= 0) return base;
  return base * (1 + (rng() * 2 - 1) * randomness);
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
    clipFn,
    seed = 0,
  } = hatchParams;

  // If densityFn is provided, oversample the line count and filter afterward
  const effectiveCount = densityFn ? count * densityOversample : count;

  let polylines3D: THREE.Vector3[][] = [];
  // Track UV midpoints per line for density filtering
  const lineMidUV: { u: number; v: number }[] = [];

  const emit = (col: LineCollector, mid: { u: number; v: number }) => {
    for (const line of col.end()) {
      polylines3D.push(line);
      lineMidUV.push(mid);
    }
  };

  if (family === "u") {
    for (let i = 0; i < effectiveCount; i++) {
      const u = uRange[0] + (i / (effectiveCount - 1)) * (uRange[1] - uRange[0]);
      const vMid = (vRange[0] + vRange[1]) / 2;
      const col = new LineCollector(surfaceFn, surfaceParams, clipFn);
      for (let j = 0; j <= samples; j++) {
        const v = vRange[0] + (j / samples) * (vRange[1] - vRange[0]);
        col.add(u, v);
      }
      emit(col, { u, v: vMid });
    }
  } else if (family === "v") {
    for (let i = 0; i < effectiveCount; i++) {
      const v = vRange[0] + (i / (effectiveCount - 1)) * (vRange[1] - vRange[0]);
      const uMid = (uRange[0] + uRange[1]) / 2;
      const col = new LineCollector(surfaceFn, surfaceParams, clipFn);
      for (let j = 0; j <= samples; j++) {
        const u = uRange[0] + (j / samples) * (uRange[1] - uRange[0]);
        col.add(u, v);
      }
      emit(col, { u: uMid, v });
    }
  } else if (family === "diagonal") {
    const lines = generateDiagonalLines(surfaceFn, surfaceParams, angle, effectiveCount, samples, uRange, vRange, clipFn);
    for (let i = 0; i < lines.length; i++) {
      polylines3D.push(lines[i]);
      const t = lines.length > 1 ? i / (lines.length - 1) : 0.5;
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
      const col = new LineCollector(surfaceFn, surfaceParams, clipFn);
      for (let j = 0; j <= samples; j++) {
        const theta = (j / samples) * Math.PI * 2;
        const u = uMid + r * Math.cos(theta);
        const v = vMid + r * Math.sin(theta);
        if (u >= uRange[0] && u <= uRange[1] && v >= vRange[0] && v <= vRange[1]) {
          col.add(u, v);
        }
      }
      emit(col, { u: uMid + r, v: vMid });
    }
  } else if (family === "hex") {
    const perDir = Math.max(1, Math.floor(effectiveCount / 3));
    const angles = [0, Math.PI / 3, (2 * Math.PI) / 3];
    for (const a of angles) {
      const lines = generateDiagonalLines(surfaceFn, surfaceParams, a, perDir, samples, uRange, vRange, clipFn);
      for (let i = 0; i < lines.length; i++) {
        polylines3D.push(lines[i]);
        const t = lines.length > 1 ? i / (lines.length - 1) : 0.5;
        lineMidUV.push({
          u: (uRange[0] + uRange[1]) / 2,
          v: vRange[0] + t * (vRange[1] - vRange[0]),
        });
      }
    }
  } else if (family === "crosshatch") {
    const perDir = Math.max(1, Math.floor(effectiveCount / 2));
    for (const a of [angle, angle + Math.PI / 2]) {
      const lines = generateDiagonalLines(surfaceFn, surfaceParams, a, perDir, samples, uRange, vRange, clipFn);
      for (let i = 0; i < lines.length; i++) {
        polylines3D.push(lines[i]);
        const t = lines.length > 1 ? i / (lines.length - 1) : 0.5;
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
      const col = new LineCollector(surfaceFn, surfaceParams, clipFn);
      for (let j = 0; j <= samples; j++) {
        const theta = (j / samples) * maxTheta;
        const r = (theta / maxTheta) * maxRadius;
        const u = uMid + r * Math.cos(theta + armOffset);
        const v = vMid + r * Math.sin(theta + armOffset);
        if (u >= uRange[0] && u <= uRange[1] && v >= vRange[0] && v <= vRange[1]) {
          col.add(u, v);
        }
      }
      emit(col, { u: uMid, v: vMid });
    }
  } else if (family === "wave") {
    // Sinusoidal hatch lines — like v-constant lines but with sine modulation
    const vSpan = vRange[1] - vRange[0];
    for (let i = 0; i < effectiveCount; i++) {
      const vBase = vRange[0] + (i / (effectiveCount - 1)) * vSpan;
      const phaseShift = i * 0.3;
      const col = new LineCollector(surfaceFn, surfaceParams, clipFn);
      for (let j = 0; j <= samples; j++) {
        const u = uRange[0] + (j / samples) * (uRange[1] - uRange[0]);
        const v = vBase + waveAmplitude * Math.sin(u * waveFrequency * Math.PI * 2 + phaseShift);
        // Clamp v to range
        const vc = Math.max(vRange[0], Math.min(vRange[1], v));
        col.add(u, vc);
      }
      emit(col, { u: (uRange[0] + uRange[1]) / 2, v: vBase });
    }
  }

  // Post-process: density-based filtering (oversample-and-filter).
  // Keep decisions are hashed per line index (stable identity), not drawn
  // from a sequential RNG — so one line's fate never depends on another's.
  if (densityFn && polylines3D.length > 0) {
    const filtered: THREE.Vector3[][] = [];
    for (let i = 0; i < polylines3D.length; i++) {
      const mid = lineMidUV[i];
      if (!mid) {
        filtered.push(polylines3D[i]);
        continue;
      }
      const density = densityFn(mid.u, mid.v);
      // Deterministic keep: density 1 = always keep, density 0 = always drop
      if (hash01(seed, i) < Math.max(0, Math.min(1, density))) {
        filtered.push(polylines3D[i]);
      }
    }
    polylines3D = filtered;
  }

  // Post-process: noise perturbation
  if (noiseAmplitude && noiseAmplitude > 0 && noiseFrequency && noiseFrequency > 0) {
    applyNoiseDisplacement(polylines3D, noiseAmplitude, noiseFrequency, seed);
  }

  // Post-process: dashed lines
  if (dashLength && dashLength > 0 && gapLength && gapLength > 0) {
    polylines3D = applyDashing(polylines3D, dashLength, gapLength, dashRandom, mulberry32(seed ^ 0x85ebca6b));
  }

  return polylines3D;
}
