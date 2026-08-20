import { describe, it, expect } from "vitest";
import { compositionRegistry, is2DComposition, isLayeredComposition } from "../compositions";
import type {
  Composition3DDefinition,
  Composition2DDefinition,
  LayeredCompositionDefinition,
} from "../compositions/types";

describe("Composition registry completeness", () => {
  it("has at least 24 compositions registered", () => {
    expect(compositionRegistry.size).toBeGreaterThanOrEqual(24);
  });

  it("contains all expected composition IDs", () => {
    const expectedIds = [
      "single", "towerAndBase", "doubleRing", "crystalSpire",
      "ribbonCage", "dnaHelix", "totemStack", "starburst",
      "nestedShells", "vortexTunnel",
      "moireCircles", "spirograph",
      "flowField", "strangeAttractor", "truchetMaze",
      "guillocheRosette", "hilbertFill", "differentialGrowth",
      "multiTechnique", "tspArt", "reactionDiffusion",
      "voronoiTexture", "photoHalftone",
    ];
    for (const id of expectedIds) {
      expect(compositionRegistry.has(id)).toBe(true);
    }
  });
});

describe("Composition path map", () => {
  it("every registered composition has a path in the path map", () => {
    const pathMap = compositionRegistry.getPathMap();
    for (const [id] of compositionRegistry.getAll()) {
      expect(pathMap.has(id), `composition "${id}" missing from path map`).toBe(true);
      const dirPath = pathMap.get(id)!;
      expect(dirPath.length).toBeGreaterThan(0);
      // Path should start with 2d, 3d, or layered (top-level category dirs)
      expect(dirPath).toMatch(/^(2d|3d|layered)\//);
    }
  });
});

describe("All compositions have valid metadata", () => {
  for (const [id, comp] of compositionRegistry.getAll()) {
    describe(`${id}`, () => {
      it("has a non-empty id matching its registry key", () => {
        expect(comp.id).toBe(id);
        expect(comp.id.length).toBeGreaterThan(0);
      });

      it("has a non-empty name", () => {
        expect(comp.name.length).toBeGreaterThan(0);
      });

      it("has a category", () => {
        expect(comp.category).toBeDefined();
        expect(comp.category.length).toBeGreaterThan(0);
      });

      it("has valid category matching directory", () => {
        expect(comp.category).toMatch(/^(2d|3d|layered)$/);
      });

      if (isLayeredComposition(comp)) {
        it("layered composition has a non-empty layers array", () => {
          const layers = (comp as LayeredCompositionDefinition).layers;
          expect(Array.isArray(layers)).toBe(true);
          expect(layers.length).toBeGreaterThan(0);
        });

        it("layered composition references registered inner compositions", () => {
          for (const layer of (comp as LayeredCompositionDefinition).layers) {
            expect(typeof layer.composition).toBe("string");
            expect(
              compositionRegistry.has(layer.composition),
              `layer references unknown composition "${layer.composition}"`,
            ).toBe(true);
          }
        });
      } else if (is2DComposition(comp)) {
        it("2D composition has a generate function", () => {
          expect(typeof (comp as Composition2DDefinition).generate).toBe("function");
        });

        it("2D composition generates valid output", () => {
          const result = (comp as Composition2DDefinition).generate({
            width: 800,
            height: 800,
            values: getTestValues(comp),
          });
          expect(Array.isArray(result)).toBe(true);
          // Each entry should be an array of {x, y} points
          for (const polyline of result) {
            expect(Array.isArray(polyline)).toBe(true);
            for (const pt of polyline) {
              expect(typeof pt.x).toBe("number");
              expect(typeof pt.y).toBe("number");
            }
          }
        }, GENERATE_TIMEOUT_MS);
      } else {
        it("3D composition has a layers function", () => {
          expect(typeof (comp as Composition3DDefinition).layers).toBe("function");
        });

        it("3D composition generates valid layers", () => {
          const layers = (comp as Composition3DDefinition).layers({
            surface: "hyperboloid",
            surfaceParams: { radius: 1, height: 3, twist: 0.5, waist: 0.5 },
            hatchParams: { family: "u", count: 10, samples: 20 },
            values: getDefaults(comp),
          });
          expect(Array.isArray(layers)).toBe(true);
          for (const layer of layers) {
            expect(typeof layer.surface).toBe("string");
            expect(layer.hatch).toBeDefined();
          }
        });
      }
    });
  }
});

/** Helper to get default control values for a composition */
function getDefaults(comp: Composition3DDefinition | Composition2DDefinition): Record<string, unknown> {
  if (!comp.controls) return {};
  const result: Record<string, unknown> = {};
  for (const [key, ctrl] of Object.entries(comp.controls)) {
    result[key] = ctrl.type === "image" ? null : ctrl.default;
  }
  return result;
}

/**
 * Compute-scale overrides for compositions whose *default* control values make
 * `generate()` run for seconds — an unavoidable cost of their algorithms, not a
 * bug. This suite only checks output *shape* (an array of {x, y} polylines), so
 * running those at a smaller simulation scale exercises exactly the same code
 * paths (seeding, simulation loop, contour extraction, chaining) in a fraction
 * of the time. Only the size/iteration knobs are overridden; every other default
 * still comes from the composition itself.
 *
 * Without this, reactionDiffusion alone took ~6s at its defaults (150x150 grid x
 * 5000 Gray-Scott iterations = 112M cell updates) and blew vitest's 5s default
 * timeout whenever the machine was loaded by the rest of the parallel suite;
 * kmeansHullCity (~3.1s, its own embedded reaction-diffusion border) was next in
 * line. Values below are the control minimums, and still yield >1000 polylines
 * each.
 */
const HEAVY_COMPOSITION_SCALE: Record<string, Record<string, unknown>> = {
  reactionDiffusion: { gridResolution: 80, iterations: 1000 },
  kmeansHullCity: { rdGridResolution: 60, rdIterations: 400 },
};

/**
 * Generous per-test timeout for the 2D generate check. Scoped to this one case
 * rather than raised globally: even scaled down, these are the only tests in the
 * suite doing real numeric work, and they run alongside every other test file.
 */
const GENERATE_TIMEOUT_MS = 20000;

/** Control values used to smoke-test a 2D composition's generate() */
function getTestValues(comp: Composition2DDefinition): Record<string, unknown> {
  const values = getDefaults(comp);
  const overrides = HEAVY_COMPOSITION_SCALE[comp.id];
  if (!overrides) return values;
  for (const [key, value] of Object.entries(overrides)) {
    // Guard against the map silently rotting if a control is ever renamed.
    expect(
      comp.controls && key in comp.controls,
      `HEAVY_COMPOSITION_SCALE["${comp.id}"] overrides unknown control "${key}"`,
    ).toBe(true);
    values[key] = value;
  }
  return values;
}

describe("sentinelTerrain3D crossHatchShadow", () => {
  const comp = compositionRegistry.get("sentinelTerrain3D") as Composition3DDefinition;

  function polylineCount(values: Record<string, unknown>) {
    const layers = comp.layers({
      surface: "rectFace",
      surfaceParams: {},
      hatchParams: { family: "diagonal", count: 1, samples: 4 },
      values,
    });
    return layers.reduce((sum, l) => sum + (l.hatch.count ?? 0), 0);
  }

  it("crossHatchShadow=true emits more polylines than crossHatchShadow=false on a fixed seed", () => {
    const baseline = { ...getDefaults(comp), terrainSeed: 42, crossHatchShadow: false };
    const withShadow = { ...getDefaults(comp), terrainSeed: 42, crossHatchShadow: true };
    const off = polylineCount(baseline);
    const on = polylineCount(withShadow);
    expect(on).toBeGreaterThan(off);
  });

  it("emits shadow-group layers only when crossHatchShadow=true", () => {
    const baseValues = { ...getDefaults(comp), terrainSeed: 42 };
    const off = comp.layers({
      surface: "rectFace",
      surfaceParams: {},
      hatchParams: { family: "diagonal", count: 1, samples: 4 },
      values: { ...baseValues, crossHatchShadow: false },
    });
    const on = comp.layers({
      surface: "rectFace",
      surfaceParams: {},
      hatchParams: { family: "diagonal", count: 1, samples: 4 },
      values: { ...baseValues, crossHatchShadow: true },
    });
    expect(off.some((l) => l.group === "shadow")).toBe(false);
    expect(on.some((l) => l.group === "shadow")).toBe(true);
  });
});
