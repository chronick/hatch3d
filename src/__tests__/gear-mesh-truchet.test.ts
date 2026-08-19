import { describe, it, expect } from "vitest";
import gearMeshTruchet, {
  buildGearMeshLayout,
} from "../compositions/2d/patterns/gear-mesh-truchet";
import type { Composition2DInput } from "../compositions/types";

const W = 800;
const H = 800;

const defaults = Object.fromEntries(
  Object.entries(gearMeshTruchet.controls!).map(([k, v]) => [
    k,
    v.type === "image" ? null : v.default,
  ]),
) as Record<string, unknown>;

function makeInput(override: Record<string, unknown> = {}): Composition2DInput {
  return { width: W, height: H, values: { ...defaults, ...override } };
}

function run(override: Record<string, unknown> = {}) {
  return gearMeshTruchet.generate(makeInput(override));
}

describe("gearMeshTruchet metadata", () => {
  it("has valid composition metadata", () => {
    expect(gearMeshTruchet.id).toBe("gearMeshTruchet");
    expect(gearMeshTruchet.name.length).toBeGreaterThan(0);
    expect(gearMeshTruchet.category).toBe("2d");
    expect(gearMeshTruchet.type).toBe("2d");
    expect(typeof gearMeshTruchet.generate).toBe("function");
    expect(gearMeshTruchet.tags?.length).toBeGreaterThan(0);
  });

  it("declares every control the task asks for", () => {
    const controls = gearMeshTruchet.controls!;
    for (const key of [
      "cols",
      "sizeMix",
      "meshProbability",
      "module",
      "spokes",
      "showGrid",
      "margin",
      "seed",
    ]) {
      expect(controls[key], `missing control "${key}"`).toBeDefined();
      expect(controls[key].group.length).toBeGreaterThan(0);
    }
    expect(controls.showGrid.type).toBe("toggle");
    const spokes = controls.spokes;
    expect(spokes.type).toBe("slider");
    if (spokes.type === "slider") {
      expect(spokes.min).toBe(0);
      expect(spokes.max).toBe(8);
    }
  });
});

describe("gearMeshTruchet output", () => {
  it("generates a non-empty set of polylines with finite points", () => {
    const result = run();
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
    for (const polyline of result) {
      expect(polyline.length).toBeGreaterThanOrEqual(2);
      for (const pt of polyline) {
        expect(Number.isFinite(pt.x)).toBe(true);
        expect(Number.isFinite(pt.y)).toBe(true);
      }
    }
  });

  it("keeps every point inside the canvas across a range of settings", () => {
    const variants = [
      {},
      { cols: 3, sizeMix: 1, module: 0.18, margin: 10 },
      { cols: 24, sizeMix: 0, module: 0.05, margin: 100 },
      { cols: 12, sizeMix: 0.8, module: 0.14, meshProbability: 1, seed: 7 },
      { cols: 7, sizeMix: 0.3, meshProbability: 0, spokes: 0, seed: 314 },
    ];
    for (const v of variants) {
      for (const polyline of run(v)) {
        for (const pt of polyline) {
          expect(pt.x, `x out of bounds for ${JSON.stringify(v)}`).toBeGreaterThanOrEqual(0);
          expect(pt.x, `x out of bounds for ${JSON.stringify(v)}`).toBeLessThanOrEqual(W);
          expect(pt.y, `y out of bounds for ${JSON.stringify(v)}`).toBeGreaterThanOrEqual(0);
          expect(pt.y, `y out of bounds for ${JSON.stringify(v)}`).toBeLessThanOrEqual(H);
        }
      }
    }
  });

  it("is deterministic for a fixed seed", () => {
    expect(JSON.stringify(run({ seed: 123 }))).toBe(JSON.stringify(run({ seed: 123 })));
  });

  it("produces different geometry for different seeds", () => {
    expect(JSON.stringify(run({ seed: 1 }))).not.toBe(JSON.stringify(run({ seed: 2 })));
  });

  it("the grid-outline toggle changes the polyline count", () => {
    const withGrid = run({ showGrid: true });
    const withoutGrid = run({ showGrid: false });
    expect(withGrid.length).toBeGreaterThan(withoutGrid.length);
  });

  it("the spoke control changes the polyline count", () => {
    expect(run({ spokes: 0 }).length).toBeLessThan(run({ spokes: 6 }).length);
  });
});

describe("gearMeshTruchet layout", () => {
  it("packs tiles that exactly cover the grid with 1x1/2x1/1x2/2x2 shapes", () => {
    const layout = buildGearMeshLayout(W, H, { ...defaults, seed: 42 });
    let covered = 0;
    for (const t of layout.tiles) {
      expect([1, 2]).toContain(t.w);
      expect([1, 2]).toContain(t.h);
      expect(t.col + t.w).toBeLessThanOrEqual(layout.cols);
      expect(t.row + t.h).toBeLessThanOrEqual(layout.rows);
      covered += t.w * t.h;
    }
    expect(covered).toBe(layout.cols * layout.rows);
    expect(layout.gears.length).toBe(layout.tiles.length);
  });

  it("the spanning tree reaches every tile", () => {
    const layout = buildGearMeshLayout(W, H, { ...defaults, seed: 42 });
    const treeEdges = layout.contacts.filter((c) => c.tree).length;
    // A spanning tree over a connected graph has exactly n-1 edges.
    expect(treeEdges).toBe(layout.tiles.length - 1);
  });

  it("only spanning-tree contacts are ever meshed", () => {
    const layout = buildGearMeshLayout(W, H, { ...defaults, seed: 42 });
    for (const c of layout.contacts) {
      if (c.mesh) expect(c.tree).toBe(true);
    }
  });

  it("meshing pairs are tangent: centre distance equals the sum of pitch radii", () => {
    const layout = buildGearMeshLayout(W, H, { ...defaults, seed: 42 });
    expect(layout.meshLinks.length).toBeGreaterThan(0);
    for (const li of layout.meshLinks) {
      const c = layout.contacts[li];
      const ga = layout.gears[c.a];
      const gb = layout.gears[c.b];
      const d = Math.hypot(ga.cx - gb.cx, ga.cy - gb.cy);
      // Radii are snapped to integer tooth counts on a shared module, so the
      // tangency is exact to within half a module.
      expect(Math.abs(d - (ga.pitchRadius + gb.pitchRadius))).toBeLessThanOrEqual(
        layout.module * 0.5 + 1e-9,
      );
    }
  });

  it("tooth counts are proportional to pitch radii on the global module", () => {
    const layout = buildGearMeshLayout(W, H, { ...defaults, seed: 5 });
    for (const g of layout.gears) {
      expect(Number.isInteger(g.teeth)).toBe(true);
      expect(g.teeth).toBeGreaterThanOrEqual(3);
      expect(Math.abs(g.pitchRadius - (g.teeth * layout.module) / 2)).toBeLessThan(1e-9);
    }
  });

  it("mesh probability 0 yields no meshing pairs, 1 yields many", () => {
    const none = buildGearMeshLayout(W, H, { ...defaults, seed: 42, meshProbability: 0 });
    const all = buildGearMeshLayout(W, H, { ...defaults, seed: 42, meshProbability: 1 });
    expect(none.meshLinks.length).toBe(0);
    expect(all.meshLinks.length).toBeGreaterThan(none.meshLinks.length);
  });

  it("finds meshing pairs across several seeds", () => {
    for (const seed of [1, 42, 99, 314]) {
      const layout = buildGearMeshLayout(W, H, { ...defaults, seed });
      expect(layout.meshLinks.length, `no mesh for seed ${seed}`).toBeGreaterThan(0);
    }
  });
});
