/**
 * Tests for the analytic silhouette/contour extraction pass:
 *  - default-off: no silhouette group, flat svgPaths unchanged
 *  - marching-squares extraction yields chained polylines, not segment soup
 *  - determinism: same inputs → deep-equal output
 *  - pipeline wiring: silhouette layer group ordered last, widthScale > 1
 */
import { describe, it, expect } from "vitest";
import * as THREE from "three";
import "../compositions"; // populate the registry (auto-discovery)
import { SURFACES } from "../surfaces";
import { extractSilhouettePolylines } from "../silhouette";
import { runPipeline } from "../workers/render-pipeline";
import type { RenderRequest } from "../workers/render-worker.types";

// Same viewpoint as the pipeline tests (theta 0.6, phi 0.35, dist 8),
// mirroring buildCamera's spherical→cartesian mapping.
const CAM_POS = new THREE.Vector3(
  8 * Math.sin(0.6) * Math.cos(0.35),
  8 * Math.sin(0.35),
  8 * Math.cos(0.6) * Math.cos(0.35)
);

function baseReq(): RenderRequest {
  return {
    type: "render", id: 1, compositionKey: "single", is2d: false, width: 800, height: 800,
    resolvedValues: {}, surfaceKey: "torus", surfaceParams: SURFACES.torus.defaults,
    hatchParams: { family: "u", count: 40, samples: 60, angle: 0.7 }, currentHatchGroups: {},
    camera: { theta: 0.6, phi: 0.35, dist: 8, ortho: false, panX: 0, panY: 0, width: 800, height: 800 },
    useOcclusion: false, depthRes: 512, depthBias: 0.01,
    exportLayout: { contentW: 0, contentH: 0, scale: 1 },
    showMesh: false, densityFilterEnabled: false, densityMax: 8, densityCellSize: 10,
  };
}

describe("extractSilhouettePolylines", () => {
  it("torus (defaults, camera outside) yields chained polylines, not 2-point soup", () => {
    const polys = extractSilhouettePolylines(
      SURFACES.torus.fn, SURFACES.torus.defaults, undefined, CAM_POS
    );
    expect(polys.length).toBeGreaterThan(0);
    const totalPts = polys.reduce((s, p) => s + p.length, 0);
    expect(totalPts / polys.length).toBeGreaterThan(4);
  });

  it("hyperboloid also yields a non-empty silhouette from the default camera", () => {
    const polys = extractSilhouettePolylines(
      SURFACES.hyperboloid.fn, SURFACES.hyperboloid.defaults, undefined, CAM_POS
    );
    expect(polys.length).toBeGreaterThan(0);
    expect(polys.some((p) => p.length >= 2)).toBe(true);
  });

  it("is deterministic — identical calls produce deep-equal polylines", () => {
    const run = () =>
      extractSilhouettePolylines(
        SURFACES.torus.fn, SURFACES.torus.defaults, undefined, CAM_POS
      ).map((pl) => pl.map((p) => [p.x, p.y, p.z]));
    expect(run()).toEqual(run());
  });

  it("applies the layer transform offset to points and view direction", () => {
    const plain = extractSilhouettePolylines(
      SURFACES.torus.fn, SURFACES.torus.defaults, undefined, CAM_POS
    );
    const shifted = extractSilhouettePolylines(
      SURFACES.torus.fn, SURFACES.torus.defaults, { y: 2 }, CAM_POS
    );
    expect(shifted.length).toBeGreaterThan(0);
    // Output points carry the offset...
    const maxY = (polys: THREE.Vector3[][]) =>
      Math.max(...polys.flatMap((pl) => pl.map((p) => p.y)));
    expect(maxY(shifted)).toBeGreaterThan(maxY(plain) + 1.5);
    // ...and the zero-set itself moves (V changes with the offset), so the
    // shifted curves are not just translated copies of the plain ones.
    const flat = (polys: THREE.Vector3[][]) =>
      polys.flatMap((pl) => pl.flatMap((p) => [p.x, p.y - 2, p.z]));
    expect(flat(shifted)).not.toEqual(
      plain.flatMap((pl) => pl.flatMap((p) => [p.x, p.y, p.z]))
    );
  });
});

describe("silhouette pass (runPipeline)", () => {
  it("off (or absent) — no silhouette group, svgPaths identical to a run without the flag", () => {
    const absent = runPipeline(baseReq());
    const off = runPipeline({ ...baseReq(), silhouetteEnabled: false });
    expect(absent.layerGroups).toBeUndefined();
    expect(off.layerGroups).toBeUndefined();
    expect(off.svgPaths).toEqual(absent.svgPaths);
  });

  it("enabled — emits a silhouette group last with widthScale > 1; flat paths unchanged", () => {
    const plain = runPipeline(baseReq());
    const res = runPipeline({ ...baseReq(), silhouetteEnabled: true });
    expect(res.layerGroups).toBeDefined();
    const groups = res.layerGroups!;
    const sil = groups.find((g) => g.id === "silhouette");
    expect(sil).toBeDefined();
    expect(sil!.widthScale).toBeGreaterThan(1);
    expect(sil!.svgPaths.length).toBeGreaterThan(0);
    // Ordered last — the heavy outline pen goes on top.
    expect(groups[groups.length - 1].id).toBe("silhouette");
    // The non-silhouette paths still equal the flat svgPaths.
    const nonSil = groups.filter((g) => g.id !== "silhouette").flatMap((g) => g.svgPaths);
    expect(nonSil).toEqual(res.svgPaths);
    // Flat output is unaffected by the silhouette pass.
    expect(res.svgPaths).toEqual(plain.svgPaths);
  });

  it("enabled — two identical runs produce deep-equal results", () => {
    const a = runPipeline({ ...baseReq(), silhouetteEnabled: true });
    const b = runPipeline({ ...baseReq(), silhouetteEnabled: true });
    expect(a.svgPaths).toEqual(b.svgPaths);
    expect(a.layerGroups).toEqual(b.layerGroups);
  });

  it("composes with depth width bands — bands plus silhouette, silhouette still last", () => {
    const res = runPipeline({ ...baseReq(), silhouetteEnabled: true, depthWidthEnabled: true });
    const groups = res.layerGroups!;
    expect(groups.some((g) => g.id.startsWith("width-"))).toBe(true);
    expect(groups[groups.length - 1].id).toBe("silhouette");
    const nonSil = groups.filter((g) => g.id !== "silhouette").flatMap((g) => g.svgPaths);
    expect(nonSil.length).toBe(res.svgPaths.length);
  });
});
