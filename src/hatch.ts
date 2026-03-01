import * as THREE from "three";
import { createNoise2D } from "simplex-noise";
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
      let segLen = Math.sqrt(dx * dx + dy * dy + dz * dz);
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
  } = hatchParams;

  let polylines3D: THREE.Vector3[][] = [];

  if (family === "u") {
    for (let i = 0; i < count; i++) {
      const u = uRange[0] + (i / (count - 1)) * (uRange[1] - uRange[0]);
      const pts: THREE.Vector3[] = [];
      for (let j = 0; j <= samples; j++) {
        const v = vRange[0] + (j / samples) * (vRange[1] - vRange[0]);
        pts.push(surfaceFn(u, v, surfaceParams));
      }
      polylines3D.push(pts);
    }
  } else if (family === "v") {
    for (let i = 0; i < count; i++) {
      const v = vRange[0] + (i / (count - 1)) * (vRange[1] - vRange[0]);
      const pts: THREE.Vector3[] = [];
      for (let j = 0; j <= samples; j++) {
        const u = uRange[0] + (j / samples) * (uRange[1] - uRange[0]);
        pts.push(surfaceFn(u, v, surfaceParams));
      }
      polylines3D.push(pts);
    }
  } else if (family === "diagonal") {
    polylines3D.push(...generateDiagonalLines(surfaceFn, surfaceParams, angle, count, samples, uRange, vRange));
  } else if (family === "rings") {
    const uMid = (uRange[0] + uRange[1]) / 2;
    const vMid = (vRange[0] + vRange[1]) / 2;
    const uSpan = uRange[1] - uRange[0];
    const vSpan = vRange[1] - vRange[0];
    const maxRadius = Math.min(uSpan, vSpan) / 2;

    for (let i = 0; i < count; i++) {
      const r = ((i + 1) / count) * maxRadius;
      const pts: THREE.Vector3[] = [];
      for (let j = 0; j <= samples; j++) {
        const theta = (j / samples) * Math.PI * 2;
        const u = uMid + r * Math.cos(theta);
        const v = vMid + r * Math.sin(theta);
        if (u >= uRange[0] && u <= uRange[1] && v >= vRange[0] && v <= vRange[1]) {
          pts.push(surfaceFn(u, v, surfaceParams));
        }
      }
      if (pts.length >= 2) polylines3D.push(pts);
    }
  } else if (family === "hex") {
    const perDir = Math.max(1, Math.floor(count / 3));
    const angles = [0, Math.PI / 3, (2 * Math.PI) / 3];
    for (const a of angles) {
      polylines3D.push(...generateDiagonalLines(surfaceFn, surfaceParams, a, perDir, samples, uRange, vRange));
    }
  } else if (family === "crosshatch") {
    const perDir = Math.max(1, Math.floor(count / 2));
    polylines3D.push(...generateDiagonalLines(surfaceFn, surfaceParams, angle, perDir, samples, uRange, vRange));
    polylines3D.push(...generateDiagonalLines(surfaceFn, surfaceParams, angle + Math.PI / 2, perDir, samples, uRange, vRange));
  } else if (family === "spiral") {
    const uMid = (uRange[0] + uRange[1]) / 2;
    const vMid = (vRange[0] + vRange[1]) / 2;
    const uSpan = uRange[1] - uRange[0];
    const vSpan = vRange[1] - vRange[0];
    const maxRadius = Math.min(uSpan, vSpan) / 2;
    const totalTurns = 4;
    const maxTheta = totalTurns * Math.PI * 2;

    for (let i = 0; i < count; i++) {
      const armOffset = (i / count) * Math.PI * 2;
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
      if (pts.length >= 2) polylines3D.push(pts);
    }
  } else if (family === "wave") {
    // Sinusoidal hatch lines — like v-constant lines but with sine modulation
    const vSpan = vRange[1] - vRange[0];
    for (let i = 0; i < count; i++) {
      const vBase = vRange[0] + (i / (count - 1)) * vSpan;
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
    }
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
