import { describe, it, expect } from "vitest";
import { compositionRegistry, is2DComposition } from "../compositions";
import type { Composition3DDefinition, Composition2DDefinition } from "../compositions/types";

describe("Composition registry completeness", () => {
  it("has at least 26 compositions registered", () => {
    expect(compositionRegistry.size).toBeGreaterThanOrEqual(26);
  });

  it("contains all expected composition IDs", () => {
    const expectedIds = [
      "single", "towerAndBase", "doubleRing", "crystalSpire",
      "ribbonCage", "dnaHelix", "totemStack", "starburst",
      "mushroomColony", "nestedShells", "vortexTunnel",
      "moireCircles", "spirograph", "lissajous",
      "flowField", "strangeAttractor", "truchetMaze",
      "guillocheRosette", "hilbertFill", "differentialGrowth",
      "multiTechnique", "tspArt", "reactionDiffusion",
      "voronoiTexture", "photoHalftone", "growthOnSurface",
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
      // Path should start with 2d or 3d
      expect(dirPath).toMatch(/^(2d|3d)\//);
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
        expect(comp.category).toMatch(/^(2d|3d)$/);
      });

      if (is2DComposition(comp)) {
        it("2D composition has a generate function", () => {
          expect(typeof (comp as Composition2DDefinition).generate).toBe("function");
        });

        it("2D composition generates valid output", () => {
          const result = (comp as Composition2DDefinition).generate({
            width: 800,
            height: 800,
            values: getDefaults(comp),
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
        });
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
    result[key] = ctrl.default;
  }
  return result;
}
