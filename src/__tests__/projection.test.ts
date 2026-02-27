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
