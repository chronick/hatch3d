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
  /**
   * Iso-line placement. "uniform" (default) spaces lines at i/(count-1).
   * "dyadic" places lines on a fixed dyadic grid — level 0 = {1/2},
   * level 1 = {1/4, 3/4}, level 2 = {1/8, 3/8, 5/8, 7/8}, … — taking
   * complete levels until the next whole level would exceed `count`.
   * Growing the count adds new lines without moving existing ones, and a
   * line's dyadic fraction is its stable identity for noise/density keying
   * (Krbn: fractional per-line fades read as banding — sparse hatch lines
   * must arrive in complete levels). Applies to the u, v, and diagonal
   * families; hex and crosshatch inherit via generateDiagonalLines.
   * rings/spiral/wave always place uniformly.
   */
  placement?: "uniform" | "dyadic";
}

/**
 * Iso fractions in (0,1) on the dyadic grid, in complete levels
 * (1, 2, 4, … lines per level; cumulative 2^(L+1) − 1), stopping before the
 * level that would push the total past `count`. Sorted ascending so output
 * order is stable by t.
 */
function dyadicFractions(count: number): number[] {
  const fractions: number[] = [];
  let level = 0;
  while (fractions.length + (1 << level) <= count) {
    const denom = 1 << (level + 1);
    for (let num = 1; num < denom; num += 2) {
      fractions.push(num / denom);
    }
    level++;
  }
  fractions.sort((a, b) => a - b);
  return fractions;
}

/**
 * Iso fractions for a line family. Uniform reproduces the legacy
 * i/(count-1) spacing exactly (including NaN for count 1) so the default
 * path is byte-identical.
 */
function isoFractions(placement: "uniform" | "dyadic", count: number): number[] {
  if (placement === "dyadic") return dyadicFractions(count);
  const fractions: number[] = [];
  for (let i = 0; i < count; i++) {
    fractions.push(i / (count - 1));
  }
  return fractions;
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
  clipFn?: (u: number, v: number) => boolean,
  placement: "uniform" | "dyadic" = "uniform"
): { points: THREE.Vector3[]; t: number }[] {
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

  const fractions = isoFractions(placement, count);
  const lines: { points: THREE.Vector3[]; t: number }[] = [];
  for (const frac of fractions) {
    const isoVal = isoMin + frac * (isoMax - isoMin);
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
    for (const points of col.end()) {
      lines.push({ points, t: frac });
    }
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
  noiseKeys?: number[],
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

      // Noise offset, keyed per line for variation between lines. Default
      // key is emission index (legacy); dyadic placement passes noiseKeys
      // derived from each line's fraction so wobble is count-independent.
      const key = noiseKeys ? noiseKeys[lineIdx] : lineIdx * 0.1;
      const n = noise2D(
        pts[i].x * frequency + key,
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
    placement = "uniform",
  } = hatchParams;

  // If densityFn is provided, oversample the line count and filter afterward
  const effectiveCount = densityFn ? count * densityOversample : count;

  // Dyadic placement only applies to iso-fraction families (u, v, diagonal —
  // hex/crosshatch inherit). rings/spiral/wave always place uniformly.
  const dyadicActive =
    placement === "dyadic" &&
    (family === "u" || family === "v" || family === "diagonal" ||
      family === "hex" || family === "crosshatch");
  const familyPlacement = dyadicActive ? "dyadic" : "uniform";

  let polylines3D: THREE.Vector3[][] = [];
  // Track UV midpoints per line for density filtering
  const lineMidUV: { u: number; v: number }[] = [];
  // Per-line iso fraction — a line's stable identity under dyadic placement
  let lineKeys: number[] = [];

  const emit = (col: LineCollector, mid: { u: number; v: number }, key = 0) => {
    for (const line of col.end()) {
      polylines3D.push(line);
      lineMidUV.push(mid);
      lineKeys.push(key);
    }
  };

  const pushDiagonal = (lines: { points: THREE.Vector3[]; t: number }[]) => {
    for (let i = 0; i < lines.length; i++) {
      polylines3D.push(lines[i].points);
      // Uniform keeps the legacy emission-index midpoint; dyadic uses the
      // iso fraction so a line's density lookup is count-independent.
      const t = dyadicActive
        ? lines[i].t
        : lines.length > 1 ? i / (lines.length - 1) : 0.5;
      lineMidUV.push({
        u: (uRange[0] + uRange[1]) / 2,
        v: vRange[0] + t * (vRange[1] - vRange[0]),
      });
      lineKeys.push(lines[i].t);
    }
  };

  if (family === "u") {
    const fractions = isoFractions(familyPlacement, effectiveCount);
    for (const frac of fractions) {
      const u = uRange[0] + frac * (uRange[1] - uRange[0]);
      const vMid = (vRange[0] + vRange[1]) / 2;
      const col = new LineCollector(surfaceFn, surfaceParams, clipFn);
      for (let j = 0; j <= samples; j++) {
        const v = vRange[0] + (j / samples) * (vRange[1] - vRange[0]);
        col.add(u, v);
      }
      emit(col, { u, v: vMid }, frac);
    }
  } else if (family === "v") {
    const fractions = isoFractions(familyPlacement, effectiveCount);
    for (const frac of fractions) {
      const v = vRange[0] + frac * (vRange[1] - vRange[0]);
      const uMid = (uRange[0] + uRange[1]) / 2;
      const col = new LineCollector(surfaceFn, surfaceParams, clipFn);
      for (let j = 0; j <= samples; j++) {
        const u = uRange[0] + (j / samples) * (uRange[1] - uRange[0]);
        col.add(u, v);
      }
      emit(col, { u: uMid, v }, frac);
    }
  } else if (family === "diagonal") {
    pushDiagonal(generateDiagonalLines(surfaceFn, surfaceParams, angle, effectiveCount, samples, uRange, vRange, clipFn, familyPlacement));
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
      pushDiagonal(generateDiagonalLines(surfaceFn, surfaceParams, a, perDir, samples, uRange, vRange, clipFn, familyPlacement));
    }
  } else if (family === "crosshatch") {
    const perDir = Math.max(1, Math.floor(effectiveCount / 2));
    for (const a of [angle, angle + Math.PI / 2]) {
      pushDiagonal(generateDiagonalLines(surfaceFn, surfaceParams, a, perDir, samples, uRange, vRange, clipFn, familyPlacement));
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
    const filteredKeys: number[] = [];
    for (let i = 0; i < polylines3D.length; i++) {
      const mid = lineMidUV[i];
      if (!mid) {
        filtered.push(polylines3D[i]);
        filteredKeys.push(lineKeys[i]);
        continue;
      }
      const density = densityFn(mid.u, mid.v);
      // Deterministic keep: density 1 = always keep, density 0 = always drop.
      // Dyadic hashes the iso fraction (a line's identity) instead of the
      // emission index, so a kept line stays kept as count grows.
      const id = dyadicActive ? Math.round(lineKeys[i] * 1e6) : i;
      if (hash01(seed, id) < Math.max(0, Math.min(1, density))) {
        filtered.push(polylines3D[i]);
        filteredKeys.push(lineKeys[i]);
      }
    }
    polylines3D = filtered;
    lineKeys = filteredKeys;
  }

  // Post-process: noise perturbation
  if (noiseAmplitude && noiseAmplitude > 0 && noiseFrequency && noiseFrequency > 0) {
    // Dyadic keys the per-line noise offset on the iso fraction (scaled for
    // spread comparable to the index-keyed default) so an existing line's
    // wobble does not change when count grows.
    const noiseKeys = dyadicActive ? lineKeys.map((t) => t * 10) : undefined;
    applyNoiseDisplacement(polylines3D, noiseAmplitude, noiseFrequency, seed, noiseKeys);
  }

  // Post-process: dashed lines
  if (dashLength && dashLength > 0 && gapLength && gapLength > 0) {
    polylines3D = applyDashing(polylines3D, dashLength, gapLength, dashRandom, mulberry32(seed ^ 0x85ebca6b));
  }

  return polylines3D;
}
