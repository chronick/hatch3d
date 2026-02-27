import * as THREE from "three";

export interface ProjectedPoint {
  x: number;
  y: number;
  depth: number;
}

export function projectPolylines(
  polylines3D: THREE.Vector3[][],
  camera: THREE.Camera,
  width: number,
  height: number
): ProjectedPoint[][] {
  return polylines3D.map(pts =>
    pts.map(p => {
      const v = p.clone().project(camera);
      return {
        x: (v.x * 0.5 + 0.5) * width,
        y: (-v.y * 0.5 + 0.5) * height,
        depth: v.z * 0.5 + 0.5,
      };
    })
  );
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
