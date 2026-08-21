import * as THREE from "three";

export interface ProjectedPoint {
  x: number;
  y: number;
  depth: number;
}

export interface ClippedProjection {
  polylines: ProjectedPoint[][];
  /** Index of the input polyline each output polyline was clipped out of. */
  sourceIndices: number[];
}

/** Floor for the near plane — the perspective divide must never approach zero. */
const MIN_NEAR = 1e-6;

/**
 * Project world-space polylines to screen space, clipped to the camera's near
 * plane.
 *
 * Behind the eye plane the perspective divide flips sign, so an unclipped
 * segment straddling it projects to a diagonal millions of pixels long. Runs
 * in front of the near plane are kept, segments crossing it are split at the
 * crossing (interpolated in world space, before the divide), runs behind it are
 * dropped — so one input polyline yields 0..N outputs and callers holding
 * per-polyline data must realign through `sourceIndices`.
 *
 * Orthographic cameras have no perspective divide and are passed through
 * unclipped.
 */
export function projectPolylinesClipped(
  polylines3D: THREE.Vector3[][],
  camera: THREE.Camera,
  width: number,
  height: number
): ClippedProjection {
  const project = (p: THREE.Vector3): ProjectedPoint => {
    const v = p.clone().project(camera);
    return {
      x: (v.x * 0.5 + 0.5) * width,
      y: (-v.y * 0.5 + 0.5) * height,
      depth: v.z * 0.5 + 0.5,
    };
  };

  const polylines: ProjectedPoint[][] = [];
  const sourceIndices: number[] = [];
  const perspective = (camera as THREE.PerspectiveCamera).isPerspectiveCamera === true;

  if (!perspective) {
    for (let i = 0; i < polylines3D.length; i++) {
      polylines.push(polylines3D[i].map(project));
      sourceIndices.push(i);
    }
    return { polylines, sourceIndices };
  }

  // View-space depth is negative in front of the camera.
  const near = Math.max((camera as THREE.PerspectiveCamera).near, MIN_NEAR);
  const view = new THREE.Vector3();
  const viewZ = (p: THREE.Vector3) => view.copy(p).applyMatrix4(camera.matrixWorldInverse).z;

  for (let i = 0; i < polylines3D.length; i++) {
    const pts = polylines3D[i];
    const depths = pts.map(viewZ);
    const inside = depths.map(z => z <= -near);

    if (inside.every(Boolean)) {
      // Identical to the unclipped path, empty polylines included.
      polylines.push(pts.map(project));
      sourceIndices.push(i);
      continue;
    }

    let run: THREE.Vector3[] = [];
    const flush = () => {
      if (run.length === 0) return;
      polylines.push(run.map(project));
      sourceIndices.push(i);
      run = [];
    };

    for (let k = 0; k < pts.length; k++) {
      if (k > 0 && inside[k] !== inside[k - 1]) {
        const t = (-near - depths[k - 1]) / (depths[k] - depths[k - 1]);
        run.push(pts[k - 1].clone().lerp(pts[k], t));
        if (inside[k - 1]) flush();
      }
      if (inside[k]) run.push(pts[k]);
    }
    flush();
  }

  return { polylines, sourceIndices };
}

export function projectPolylines(
  polylines3D: THREE.Vector3[][],
  camera: THREE.Camera,
  width: number,
  height: number
): ProjectedPoint[][] {
  return projectPolylinesClipped(polylines3D, camera, width, height).polylines;
}

export function polylinesToSVGPaths(polylines: { x: number; y: number }[][]): string[] {
  return polylines
    .map(pts => {
      if (pts.length < 2) return null;
      return "M" + pts.map(p => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join("L");
    })
    .filter((d): d is string => d !== null);
}

export function buildSurfaceMesh(
  surfaceFn: (u: number, v: number, params: Record<string, number>) => THREE.Vector3,
  surfaceParams: Record<string, number>,
  uSegs: number,
  vSegs: number,
  uRange: [number, number] = [0, 1],
  vRange: [number, number] = [0, 1]
): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  const vertices: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i <= uSegs; i++) {
    const u = uRange[0] + (i / uSegs) * (uRange[1] - uRange[0]);
    for (let j = 0; j <= vSegs; j++) {
      const v = vRange[0] + (j / vSegs) * (vRange[1] - vRange[0]);
      const p = surfaceFn(u, v, surfaceParams);
      vertices.push(p.x, p.y, p.z);
    }
  }

  for (let i = 0; i < uSegs; i++) {
    for (let j = 0; j < vSegs; j++) {
      const a = i * (vSegs + 1) + j;
      const b = a + 1;
      const c = a + vSegs + 1;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}
