import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { polylinesToSVGPaths, projectPolylines } from "../projection";

describe("polylinesToSVGPaths", () => {
  it("generates valid SVG path data", () => {
    const lines = [
      [
        { x: 0, y: 0 },
        { x: 100, y: 100 },
        { x: 200, y: 50 },
      ],
    ];
    const paths = polylinesToSVGPaths(lines);
    expect(paths).toHaveLength(1);
    expect(paths[0]).toMatch(/^M.*L.*L/);
  });

  it("skips polylines with fewer than 2 points", () => {
    const lines = [[{ x: 0, y: 0 }]];
    const paths = polylinesToSVGPaths(lines);
    expect(paths).toHaveLength(0);
  });
});

describe("projectPolylines", () => {
  it("projects 3D points to 2D screen space", () => {
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    camera.position.set(0, 0, 10);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    camera.updateProjectionMatrix();

    const polylines = [[new THREE.Vector3(0, 0, 0)]];
    const projected = projectPolylines(polylines, camera, 800, 800);

    expect(projected).toHaveLength(1);
    expect(projected[0]).toHaveLength(1);
    // Center point should project near center of screen
    expect(projected[0][0].x).toBeCloseTo(400, -1);
    expect(projected[0][0].y).toBeCloseTo(400, -1);
  });
});

// ── vault-1y2l2 regression: near-plane clipping ──
//
// Cameras orbit the origin looking at it, so geometry with |P| > dist falls
// behind the eye plane, where the perspective divide flips sign and projects a
// short world-space segment to a multi-million-pixel diagonal.
const W = 800;
const H = 800;
const DIAGONAL = Math.hypot(W, H);

function eyeCamera() {
  const camera = new THREE.PerspectiveCamera(45, W / H, 0.1, 100);
  camera.position.set(0, 0, 10);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  camera.updateProjectionMatrix();
  return camera;
}

function longestSegment(pl: { x: number; y: number }[]): number {
  let max = 0;
  for (let i = 1; i < pl.length; i++) {
    max = Math.max(max, Math.hypot(pl[i].x - pl[i - 1].x, pl[i].y - pl[i - 1].y));
  }
  return max;
}

describe("projectPolylines near-plane clipping (vault-1y2l2)", () => {
  // Camera sits at z=10 looking down -z, so world z=10 is the eye plane. The
  // blowup needs a vertex close to that plane, as a densely sampled hatch line
  // running away from the camera always has.
  const line = (from: number, to: number, step = 0.1) => {
    const pts: THREE.Vector3[] = [];
    for (let z = from; z <= to; z += step) pts.push(new THREE.Vector3(0.5, 0.2, z));
    return pts;
  };
  const straddling = line(0.005, 19.905);
  const behind = line(12.005, 19.905);

  it("emits no segment longer than a sane multiple of the canvas diagonal", () => {
    const projected = projectPolylines([straddling, behind], eyeCamera(), W, H);
    for (const pl of projected) {
      for (const p of pl) {
        expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
      }
      expect(longestSegment(pl)).toBeLessThan(10 * DIAGONAL);
    }
  });

  it("keeps the in-front portion of a straddling polyline", () => {
    const projected = projectPolylines([straddling], eyeCamera(), W, H);
    expect(projected.length).toBeGreaterThan(0);
    const pts = projected.flat();
    expect(pts.length).toBeGreaterThanOrEqual(2);
    // The far end (world z=0) is on-axis-ish and lands near the canvas centre.
    expect(pts.some((p) => Math.hypot(p.x - 400, p.y - 400) < 100)).toBe(true);
  });

  it("drops a polyline entirely behind the eye plane", () => {
    const projected = projectPolylines([behind], eyeCamera(), W, H);
    expect(projected).toHaveLength(0);
  });

  it("leaves geometry entirely in front of the camera untouched", () => {
    const camera = eyeCamera();
    const inFront = [
      [new THREE.Vector3(0, 0, 0), new THREE.Vector3(1, 1, 1)],
      [new THREE.Vector3(-1, 0.5, -2), new THREE.Vector3(2, -1, 0)],
    ];
    const projected = projectPolylines(inFront, camera, W, H);
    expect(projected).toHaveLength(2);
    expect(projected.map((pl) => pl.length)).toEqual([2, 2]);
    for (let i = 0; i < inFront.length; i++) {
      for (let j = 0; j < inFront[i].length; j++) {
        const v = inFront[i][j].clone().project(camera);
        expect(projected[i][j].x).toBeCloseTo((v.x * 0.5 + 0.5) * W, 10);
        expect(projected[i][j].y).toBeCloseTo((-v.y * 0.5 + 0.5) * H, 10);
        expect(projected[i][j].depth).toBeCloseTo(v.z * 0.5 + 0.5, 10);
      }
    }
  });
});
