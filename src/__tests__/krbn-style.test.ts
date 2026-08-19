/**
 * Tests for the Krbn-inspired styling features:
 *  - seeded determinism of stochastic hatch post-processing
 *  - point-level UV clipping (clipFn) for tonal layering
 *  - visible/hidden splitting for ghosted occluded lines
 *  - depth-emphasis stroke width bands
 */
import { describe, it, expect } from "vitest";
import "../compositions"; // populate the registry (auto-discovery)
import { generateUVHatchLines, type HatchParams } from "../hatch";
import { SURFACES } from "../surfaces";
import { splitPolylineByDepth, clipPolylineByDepth } from "../occlusion";
import { filterByProjectedDensity } from "../density";
import { tonalHatchLayers } from "../compositions/helpers-lighting";
import { runPipeline } from "../workers/render-pipeline";
import type { RenderRequest } from "../workers/render-worker.types";

const torus = SURFACES.torus;

function lines(params: HatchParams) {
  return generateUVHatchLines(torus.fn, torus.defaults, params);
}

function flatten(polys: { x: number; y: number; z: number }[][]): number[] {
  return polys.flatMap((pl) => pl.flatMap((p) => [p.x, p.y, p.z]));
}

describe("seeded determinism", () => {
  it("noise displacement is reproducible for the same seed", () => {
    const params: HatchParams = {
      family: "u", count: 5, samples: 12,
      noiseAmplitude: 0.2, noiseFrequency: 2, seed: 7,
    };
    expect(flatten(lines(params))).toEqual(flatten(lines(params)));
  });

  it("different seeds produce different noise displacement", () => {
    const base: HatchParams = {
      family: "u", count: 5, samples: 12,
      noiseAmplitude: 0.2, noiseFrequency: 2,
    };
    const a = flatten(lines({ ...base, seed: 1 }));
    const b = flatten(lines({ ...base, seed: 2 }));
    expect(a).not.toEqual(b);
  });

  it("randomized dashing is reproducible for the same seed", () => {
    const params: HatchParams = {
      family: "u", count: 4, samples: 20,
      dashLength: 0.4, gapLength: 0.2, dashRandom: 0.8, seed: 11,
    };
    const a = lines(params);
    const b = lines(params);
    expect(a.length).toBe(b.length);
    expect(flatten(a)).toEqual(flatten(b));
  });

  it("density-fn filtering is reproducible for the same seed", () => {
    const params: HatchParams = {
      family: "u", count: 20, samples: 8,
      densityFn: (u) => u, // sparse on one side
      seed: 3,
    };
    expect(lines(params).length).toBe(lines(params).length);
    expect(flatten(lines(params))).toEqual(flatten(lines(params)));
  });

  it("projected density filter is reproducible for the same seed", () => {
    // 60 near-identical horizontal lines through the same cells
    const polys = Array.from({ length: 60 }, (_, i) =>
      Array.from({ length: 10 }, (_, j) => ({ x: j * 10, y: 50 + i * 0.1 })),
    );
    const opts = { maxDensity: 10, cellSize: 40, width: 100, height: 100, seed: 5 };
    const a = filterByProjectedDensity(polys, opts);
    const b = filterByProjectedDensity(polys, opts);
    expect(a.length).toBeLessThan(polys.length);
    expect(a).toEqual(b);
  });
});

describe("clipFn point-level clipping", () => {
  it("splits each line at clip boundaries", () => {
    // Reject a v-band in the middle → each u-line splits into two segments
    const clipped = lines({
      family: "u", count: 3, samples: 20,
      clipFn: (_u, v) => v < 0.4 || v > 0.6,
    });
    expect(clipped.length).toBe(6);
    // No point inside the rejected band should survive: verify each segment
    // is strictly shorter than an unclipped line
    const full = lines({ family: "u", count: 3, samples: 20 });
    expect(Math.max(...clipped.map((l) => l.length))).toBeLessThan(full[0].length);
  });

  it("drops fully clipped lines", () => {
    const clipped = lines({ family: "u", count: 5, samples: 10, clipFn: () => false });
    expect(clipped.length).toBe(0);
  });
});

describe("splitPolylineByDepth", () => {
  // Synthetic 4x4 depth buffer: left half far (no mesh → visible),
  // right half depth 0 (occludes everything behind it).
  const w = 4, h = 4;
  const depthData = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      if (x < 2) {
        depthData[idx + 3] = 0; // alpha<128 → far plane → visible
      } else {
        depthData[idx] = 0; // depth 0 → everything occluded
        depthData[idx + 1] = 0;
        depthData[idx + 3] = 255;
      }
    }
  }
  const buffer = { depthData, width: w, height: h };
  const polyline = [0, 1, 2, 3].map((x) => ({ x, y: 1, depth: 0.5 }));

  it("partitions a polyline into visible and hidden runs", () => {
    const { visible, hidden } = splitPolylineByDepth(polyline, buffer, 0.005);
    expect(visible).toHaveLength(1);
    expect(hidden).toHaveLength(1);
    expect(visible[0].map((p) => p.x)).toEqual([0, 1]);
    expect(hidden[0].map((p) => p.x)).toEqual([2, 3]);
  });

  it("clipPolylineByDepth returns only the visible runs (back-compat)", () => {
    const segs = clipPolylineByDepth(polyline, buffer, 0.005);
    expect(segs).toHaveLength(1);
    expect(segs[0].map((p) => p.x)).toEqual([0, 1]);
  });
});

describe("tonalHatchLayers", () => {
  it("emits one clipped diagonal layer per tone level with rotated angles", () => {
    const layers = tonalHatchLayers(
      "hyperboloid", SURFACES.hyperboloid.defaults,
      [1, 1, 0.5],
      { count: 20, samples: 30 },
      { layers: 3, angle: 0.5 },
    );
    expect(layers).toHaveLength(3);
    for (const l of layers) {
      expect(l.hatch.family).toBe("diagonal");
      expect(typeof l.hatch.clipFn).toBe("function");
    }
    const angles = layers.map((l) => l.hatch.angle);
    expect(new Set(angles).size).toBe(3);
  });

  it("darker layers cover less of the surface than lighter ones", () => {
    const layers = tonalHatchLayers(
      "hyperboloid", SURFACES.hyperboloid.defaults,
      [1, 1, 0.5],
      { count: 30, samples: 40 },
      { layers: 3 },
    );
    const points = (i: number) =>
      generateUVHatchLines(SURFACES.hyperboloid.fn, SURFACES.hyperboloid.defaults, layers[i].hatch)
        .reduce((s, l) => s + l.length, 0);
    // Layer 0 (threshold 0.95) covers nearly everything; layer 2 (~0.32)
    // only the darkest regions.
    expect(points(0)).toBeGreaterThan(points(2));
    expect(points(2)).toBeGreaterThan(0);
  });
});

describe("depth-emphasis width bands (runPipeline)", () => {
  function baseReq(): RenderRequest {
    return {
      type: "render", id: 1, compositionKey: "single", is2d: false, width: 800, height: 800,
      resolvedValues: {}, surfaceKey: "torus", surfaceParams: SURFACES.torus.defaults,
      // u-constant lines: each line sits at one spot around the torus's
      // major circle, so lines span distinct camera distances (bands).
      hatchParams: { family: "u", count: 40, samples: 60, angle: 0.7 }, currentHatchGroups: {},
      camera: { theta: 0.6, phi: 0.35, dist: 8, ortho: false, panX: 0, panY: 0, width: 800, height: 800 },
      useOcclusion: false, depthRes: 512, depthBias: 0.01,
      exportLayout: { contentW: 0, contentH: 0, scale: 1 },
      showMesh: false, densityFilterEnabled: false, densityMax: 8, densityCellSize: 10,
    };
  }

  it("is off by default — flat svgPaths, no layer groups", () => {
    const res = runPipeline(baseReq());
    expect(res.layerGroups).toBeUndefined();
    expect(res.svgPaths.length).toBeGreaterThan(0);
  });

  it("emits width-band layer groups covering all visible paths", () => {
    const res = runPipeline({ ...baseReq(), depthWidthEnabled: true });
    expect(res.layerGroups).toBeDefined();
    const groups = res.layerGroups!;
    // A torus seen at dist 8 spans enough depth for at least 2 bands
    expect(groups.length).toBeGreaterThanOrEqual(2);
    for (const g of groups) {
      expect(g.widthScale).toBeGreaterThan(0);
      expect(g.id).toMatch(/^width-/);
    }
    const groupedPaths = groups.reduce((s, g) => s + g.svgPaths.length, 0);
    expect(groupedPaths).toBe(res.svgPaths.length);
    // Nearer bands are wider
    const byId = Object.fromEntries(groups.map((g) => [g.id, g.widthScale!]));
    if (byId["width-near"] && byId["width-far"]) {
      expect(byId["width-near"]).toBeGreaterThan(byId["width-far"]);
    }
  });

  it("same request renders identically twice (pipeline determinism)", () => {
    const a = runPipeline({ ...baseReq(), densityFilterEnabled: true, seed: 42 });
    const b = runPipeline({ ...baseReq(), densityFilterEnabled: true, seed: 42 });
    expect(a.svgPaths).toEqual(b.svgPaths);
  });
});
