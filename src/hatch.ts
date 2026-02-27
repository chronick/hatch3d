import * as THREE from "three";
import { SurfaceFn } from "./surfaces";

export interface HatchParams {
  family?: "u" | "v" | "diagonal";
  count?: number;
  samples?: number;
  uRange?: [number, number];
  vRange?: [number, number];
  angle?: number;
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
      if (pts.length >= 2) polylines3D.push(pts);
    }
  }

  return polylines3D;
}
