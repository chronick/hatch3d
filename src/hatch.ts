import * as THREE from "three";
import type { SurfaceFn } from "./surfaces";

export interface HatchParams {
  family?: "u" | "v" | "diagonal" | "rings" | "hex" | "crosshatch" | "spiral";
  count?: number;
  samples?: number;
  uRange?: [number, number];
  vRange?: [number, number];
  angle?: number;
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
  } = hatchParams;

  const polylines3D: THREE.Vector3[][] = [];

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
  }

  return polylines3D;
}
