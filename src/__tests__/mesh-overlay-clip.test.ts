/**
 * vault-21qrg regression: the `showMesh` debug overlay must be near-plane
 * clipped like the hatch and silhouette passes (vault-1y2l2).
 *
 * Behind the eye plane the perspective divide flips sign, so a triangle edge
 * straddling it projects to a diagonal millions of pixels long. Debug-only
 * surface, but it wrecks the preview whenever the camera sits inside the
 * surface's bounding volume.
 *
 * The fixture reproduces the unclipped blowup in-test (`unclippedMeshPaths` is
 * the pre-fix inline projection, kept verbatim) so the assertions can't quietly
 * pass on geometry that never straddles the plane.
 */
import { describe, it, expect } from "vitest";
import * as THREE from "three";
import "../compositions"; // populate the registry (auto-discovery)
import { SURFACES } from "../surfaces";
import { buildSurfaceMesh } from "../projection";
import { meshOverlayPaths, runPipeline } from "../workers/render-pipeline";
import type { RenderRequest } from "../workers/render-worker.types";
import { parseDString } from "../utils/clip";

const W = 800;
const H = 800;
const DIAGONAL = Math.hypot(W, H);

// A torus small enough that dist 0.35 puts the camera inside its bounding
// volume — roughly a third of the mesh falls behind the eye plane.
const STRADDLE_PARAMS = { majorR: 0.5, minorR: 0.12, ySquish: 0.25 };
const STRADDLE_DIST = 0.35;
// The viewpoint the other pipeline tests use: everything in front of the camera.
const OUTSIDE_DIST = 8;

function req(
  dist: number,
  surfaceParams: Record<string, number>,
  showMesh: boolean,
): RenderRequest {
  return {
    type: "render", id: 1, compositionKey: "single", is2d: false, width: W, height: H,
    resolvedValues: {}, surfaceKey: "torus", surfaceParams,
    hatchParams: { family: "u", count: 40, samples: 60, angle: 0.7 }, currentHatchGroups: {},
    camera: { theta: 0.6, phi: 0.35, dist, ortho: false, panX: 0, panY: 0, width: W, height: H },
    useOcclusion: false, depthRes: 512, depthBias: 0.01,
    exportLayout: { contentW: 0, contentH: 0, scale: 1 },
    showMesh, densityFilterEnabled: false, densityMax: 8, densityCellSize: 10,
  };
}

/** Mirrors buildCamera's spherical→cartesian mapping (perspective branch). */
function camera(dist: number): THREE.PerspectiveCamera {
  const cam = new THREE.PerspectiveCamera(45, W / H, 0.1, 100);
  cam.position.set(
    dist * Math.sin(0.6) * Math.cos(0.35),
    dist * Math.sin(0.35),
    dist * Math.cos(0.6) * Math.cos(0.35),
  );
  cam.lookAt(0, 0, 0);
  cam.updateMatrixWorld();
  cam.updateProjectionMatrix();
  return cam;
}

/** The pre-fix overlay projection: raw `Vector3.project`, no clipping. */
function unclippedMeshPaths(surfaceParams: Record<string, number>, dist: number): string[] {
  const [uSegs, vSegs] = SURFACES.torus.meshSegs ?? [24, 24];
  const geo = buildSurfaceMesh(SURFACES.torus.fn, surfaceParams, uSegs, vSegs);
  const cam = camera(dist);
  const pos = geo.getAttribute("position");
  const idx = geo.getIndex()!;
  const paths: string[] = [];
  for (let i = 0; i < idx.count; i += 3) {
    const tri = [0, 1, 2].map((j) => {
      const vi = idx.getX(i + j);
      const p = new THREE.Vector3(pos.getX(vi), pos.getY(vi), pos.getZ(vi)).project(cam);
      return { x: (p.x * 0.5 + 0.5) * W, y: (-p.y * 0.5 + 0.5) * H };
    });
    paths.push(
      `M${tri[0].x.toFixed(1)},${tri[0].y.toFixed(1)}L${tri[1].x.toFixed(1)},${tri[1].y.toFixed(1)}L${tri[2].x.toFixed(1)},${tri[2].y.toFixed(1)}Z`,
    );
  }
  return paths;
}

function longestSegment(paths: string[]): number {
  let max = 0;
  for (const d of paths) {
    const pts = parseDString(d);
    for (let i = 1; i < pts.length; i++) {
      max = Math.max(max, Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
    }
    if (d.endsWith("Z") && pts.length > 2) {
      const a = pts[pts.length - 1];
      max = Math.max(max, Math.hypot(a.x - pts[0].x, a.y - pts[0].y));
    }
  }
  return max;
}

describe("showMesh overlay near-plane clipping (vault-21qrg)", () => {
  it("the fixture straddles the eye plane — unclipped, it blows up", () => {
    expect(longestSegment(unclippedMeshPaths(STRADDLE_PARAMS, STRADDLE_DIST))).toBeGreaterThan(
      10 * DIAGONAL,
    );
  });

  it("emits no segment longer than a sane multiple of the canvas diagonal", () => {
    const paths = runPipeline(req(STRADDLE_DIST, STRADDLE_PARAMS, true)).meshPaths;
    expect(paths.length).toBeGreaterThan(0);
    for (const d of paths) {
      for (const p of parseDString(d)) {
        expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
      }
    }
    expect(longestSegment(paths)).toBeLessThan(10 * DIAGONAL);
  });

  it("keeps the in-front portion of the straddling mesh on the canvas", () => {
    const pts = runPipeline(req(STRADDLE_DIST, STRADDLE_PARAMS, true)).meshPaths.flatMap(
      parseDString,
    );
    expect(pts.length).toBeGreaterThan(0);
    expect(pts.filter((p) => p.x >= 0 && p.x <= W && p.y >= 0 && p.y <= H).length).toBeGreaterThan(
      0,
    );
  });

  it("leaves a mesh entirely in front of the camera byte-identical", () => {
    const params = SURFACES.torus.defaults;
    const paths = runPipeline(req(OUTSIDE_DIST, params, true)).meshPaths;
    expect(paths.length).toBeGreaterThan(0);
    // Same closed one-triangle-per-path output the unclipped code produced.
    expect(paths).toEqual(unclippedMeshPaths(params, OUTSIDE_DIST));
  });

  it("emits nothing when showMesh is off", () => {
    expect(runPipeline(req(OUTSIDE_DIST, SURFACES.torus.defaults, false)).meshPaths).toEqual([]);
  });

  // The one shape a clipped loop shares with an uncut one: first vertex behind
  // the eye yields a single 4-point run (crossing, v1, v2, crossing). Closing
  // it as a triangle would drop the second crossing and draw a wrong chord —
  // whole-vs-clipped must be decided by point identity, not point count.
  it("keeps a first-vertex-behind triangle open, with both crossings", () => {
    const camera = new THREE.PerspectiveCamera(45, W / H, 0.1, 100);
    camera.position.set(0, 0, 10);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    camera.updateProjectionMatrix();

    // v0 sits behind the camera (z=11 > eye z=10); v1, v2 well in front.
    const geo = new THREE.BufferGeometry();
    geo.setAttribute(
      "position",
      new THREE.Float32BufferAttribute([0.3, 0.2, 11, -1, -1, 0, 1, -1, 0], 3),
    );
    geo.setIndex([0, 1, 2]);

    const paths = meshOverlayPaths(geo, camera, W, H);
    expect(paths).toHaveLength(1);
    expect(paths[0]).not.toContain("Z");
    const pts = parseDString(paths[0]);
    expect(pts).toHaveLength(4);
    // Open run: the two near-plane crossings are distinct endpoints.
    const [first, last] = [pts[0], pts[3]];
    expect(Math.hypot(first.x - last.x, first.y - last.y)).toBeGreaterThan(1);
    for (const p of pts) {
      expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
      expect(Math.abs(p.x) + Math.abs(p.y)).toBeLessThan(10 * DIAGONAL);
    }
  });
});
