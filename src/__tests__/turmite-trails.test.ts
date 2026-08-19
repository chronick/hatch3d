import { describe, it, expect } from "vitest";
import turmiteTrails from "../compositions/2d/generative/turmite-trails";
import type { Composition2DInput } from "../compositions/types";

const W = 800;
const H = 800;

const defaults = Object.fromEntries(
  Object.entries(turmiteTrails.controls!).map(([k, v]) => [
    k,
    v.type === "image" ? null : v.default,
  ]),
) as Record<string, unknown>;

function gen(override: Record<string, unknown> = {}) {
  const input: Composition2DInput = {
    width: W,
    height: H,
    values: { ...defaults, ...override },
  };
  return turmiteTrails.generate(input);
}

function allPoints(lines: { x: number; y: number }[][]) {
  return lines.flat();
}

describe("turmiteTrails metadata", () => {
  it("has valid 2D composition metadata", () => {
    expect(turmiteTrails.id).toBe("turmiteTrails");
    expect(turmiteTrails.name.length).toBeGreaterThan(0);
    expect(turmiteTrails.type).toBe("2d");
    expect(turmiteTrails.category).toBe("2d");
    expect(typeof turmiteTrails.generate).toBe("function");
    expect(turmiteTrails.description!.length).toBeGreaterThan(0);
    expect(turmiteTrails.tags!.length).toBeGreaterThan(0);
  });

  it("every control has a label, group and default", () => {
    const controls = turmiteTrails.controls!;
    expect(Object.keys(controls).length).toBeGreaterThan(0);
    for (const [key, ctrl] of Object.entries(controls)) {
      expect(ctrl.label.length, `${key} label`).toBeGreaterThan(0);
      expect(ctrl.group.length, `${key} group`).toBeGreaterThan(0);
      expect(ctrl.type, `${key} type`).not.toBe("image");
      if (ctrl.type !== "image") {
        expect(ctrl.default, `${key} default`).toBeDefined();
      }
      if (ctrl.type === "slider") {
        expect(ctrl.min).toBeLessThan(ctrl.max);
        expect(ctrl.default).toBeGreaterThanOrEqual(ctrl.min);
        expect(ctrl.default).toBeLessThanOrEqual(ctrl.max);
      }
      if (ctrl.type === "select") {
        expect(ctrl.options.map((o) => o.value)).toContain(ctrl.default);
      }
    }
  });
});

describe("turmiteTrails generation", () => {
  it("default values produce non-empty polyline output", () => {
    const lines = gen();
    expect(lines.length).toBeGreaterThan(100);
    for (const line of lines) {
      expect(line.length).toBeGreaterThanOrEqual(2);
      for (const p of line) {
        expect(Number.isFinite(p.x)).toBe(true);
        expect(Number.isFinite(p.y)).toBe(true);
      }
    }
  });

  it("keeps all points inside the canvas", () => {
    for (const override of [
      {},
      { renderStyle: "trails" },
      { margin: 10, gridSize: 400, dotSize: 4, agents: 6 },
      { margin: 120, gridSize: 60, ruleset: "langtonHighway" },
      { ruleset: "random", crossMarks: true },
    ]) {
      const pts = allPoints(gen(override));
      expect(pts.length).toBeGreaterThan(0);
      // Aggregate first — a per-point expect() over ~10^5 points is far
      // slower than the generation itself.
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      for (const p of pts) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
      }
      const label = JSON.stringify(override);
      expect(minX, `minX for ${label}`).toBeGreaterThanOrEqual(0);
      expect(maxX, `maxX for ${label}`).toBeLessThanOrEqual(W);
      expect(minY, `minY for ${label}`).toBeGreaterThanOrEqual(0);
      expect(maxY, `maxY for ${label}`).toBeLessThanOrEqual(H);
    }
  });

  it("is deterministic — same values give identical output", () => {
    expect(gen()).toEqual(gen());
    expect(gen({ renderStyle: "trails", seed: 7 })).toEqual(
      gen({ renderStyle: "trails", seed: 7 }),
    );
  });

  it("different seeds produce different output", () => {
    const a = JSON.stringify(gen({ seed: 1 }));
    const b = JSON.stringify(gen({ seed: 2 }));
    expect(a).not.toBe(b);
  });

  it("each named ruleset renders and they differ from one another", () => {
    const ids = ["langtonHighway", "chaoticGrain", "wovenLattice", "symmetricDiamond", "random"];
    const seen = new Set<string>();
    for (const ruleset of ids) {
      const lines = gen({ ruleset });
      expect(lines.length, `${ruleset} emitted nothing`).toBeGreaterThan(50);
      const key = JSON.stringify(lines);
      expect(seen.has(key), `${ruleset} duplicates another ruleset`).toBe(false);
      seen.add(key);
    }
  });

  it("dots and trails modes both render and differ", () => {
    const dots = gen({ renderStyle: "dots" });
    const trails = gen({ renderStyle: "trails" });
    expect(dots.length).toBeGreaterThan(0);
    expect(trails.length).toBeGreaterThan(0);
    expect(JSON.stringify(dots)).not.toBe(JSON.stringify(trails));
    // Dots are 2-point marks; trails are long walked paths.
    const maxDot = Math.max(...dots.map((l) => l.length));
    const maxTrail = Math.max(...trails.map((l) => l.length));
    expect(maxDot).toBe(2);
    expect(maxTrail).toBeGreaterThan(10);
  });

  it("more steps never shrinks the visited-cell count (monotone ruleset)", () => {
    // symmetricDiamond only ever writes cell state 1, so ink is monotonic.
    const base = { ruleset: "symmetricDiamond", agents: 1, gridSize: 300, renderStyle: "dots" };
    const small = gen({ ...base, steps: 20000 }).length;
    const mid = gen({ ...base, steps: 60000 }).length;
    const large = gen({ ...base, steps: 150000 }).length;
    expect(small).toBeGreaterThan(0);
    expect(mid).toBeGreaterThanOrEqual(small);
    expect(large).toBeGreaterThanOrEqual(mid);
    expect(large).toBeGreaterThan(small);
  });

  it("caps emitted geometry at the documented ceilings", () => {
    const dots = gen({ gridSize: 400, agents: 6, steps: 250000, renderStyle: "dots" });
    expect(dots.length).toBeLessThanOrEqual(60_000);
    const trails = gen({
      gridSize: 400,
      agents: 6,
      steps: 250000,
      renderStyle: "trails",
      trailStride: 1,
    });
    const trailPoints = trails.reduce((n, l) => n + l.length, 0);
    // Cap plus one extra seam point per broken (wrapped) polyline.
    expect(trailPoints).toBeLessThanOrEqual(40_000 + trails.length * 2);
  });

  it("shared vs individual rule tables change the output", () => {
    const shared = JSON.stringify(gen({ sharedRules: true, agents: 4 }));
    const individual = JSON.stringify(gen({ sharedRules: false, agents: 4 }));
    expect(shared).not.toBe(individual);
  });
});
