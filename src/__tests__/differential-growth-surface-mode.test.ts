import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createHash } from "node:crypto";
import differentialGrowth from "../compositions/2d/generative/differential-growth";

// Seeded LCG so Math.random is deterministic during these tests.
function seedMathRandom(seed: number) {
  let state = seed >>> 0;
  return vi.spyOn(Math, "random").mockImplementation(() => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  });
}

function hashPolylines(polylines: { x: number; y: number }[][]): string {
  const h = createHash("sha256");
  for (const line of polylines) {
    h.update(`L${line.length}|`);
    for (const p of line) {
      h.update(`${p.x.toFixed(6)},${p.y.toFixed(6)};`);
    }
  }
  return h.digest("hex");
}

const baseValues = {
  surfaceMode: "off",
  rotationX: 0.4,
  rotationY: 0.3,
  viewScale: 120,
  initialNodes: 30,
  iterations: 50,
  repulsionRadius: 15,
  repulsionStrength: 0.8,
  springK: 0.15,
  maxEdgeLength: 10,
  maxNodes: 200,
  boundaryRadius: 300,
};

describe("differentialGrowth surfaceMode toggle", () => {
  let spy: ReturnType<typeof seedMathRandom>;

  beforeEach(() => {
    spy = seedMathRandom(42);
  });

  afterEach(() => {
    spy.mockRestore();
  });

  it("has a surfaceMode select control with 'off' default and the 5 surface options", () => {
    const ctrl = differentialGrowth.controls?.surfaceMode;
    expect(ctrl).toBeDefined();
    expect(ctrl?.type).toBe("select");
    if (ctrl?.type !== "select") throw new Error("surfaceMode is not a select");
    expect(ctrl.default).toBe("off");
    expect(ctrl.group).toBe("Surface");
    const values = ctrl.options.map((o) => o.value).sort();
    expect(values).toEqual(["canopy", "conoid", "hyperboloid", "off", "torus", "twistedRibbon"].sort());
  });

  it("exposes rotationX/rotationY/viewScale controls in group 'Surface'", () => {
    expect(differentialGrowth.controls?.rotationX?.group).toBe("Surface");
    expect(differentialGrowth.controls?.rotationY?.group).toBe("Surface");
    expect(differentialGrowth.controls?.viewScale?.group).toBe("Surface");
  });

  it("preserves the growth macro targeting iterations + maxNodes", () => {
    const macro = differentialGrowth.macros?.growth;
    expect(macro).toBeDefined();
    const targets = (macro?.targets ?? []).map((t) => t.param).sort();
    expect(targets).toEqual(["iterations", "maxNodes"]);
  });

  it("surfaceMode='off' produces deterministic output with a seeded RNG (byte-identical regression guard)", () => {
    // Hash of the planar (off-mode) algorithm with a fixed seed + small params.
    // Captured 2026-04-24 from the pre-merge differentialGrowth code path; any
    // future change to off-mode behavior must update this hash intentionally —
    // that is the point of the guard.
    const result = differentialGrowth.generate({
      width: 800,
      height: 800,
      values: { ...baseValues, surfaceMode: "off" },
    });
    expect(hashPolylines(result)).toBe(
      "b3bdfd85a40f0e04a10cd5f41589872bea5830a990c844491a81e9cbca490716",
    );
  });

  it("surfaceMode='torus' produces output that differs from surfaceMode='off' on the same seed", () => {
    const off = differentialGrowth.generate({
      width: 800,
      height: 800,
      values: { ...baseValues, surfaceMode: "off" },
    });
    spy.mockRestore();
    spy = seedMathRandom(42);
    const torus = differentialGrowth.generate({
      width: 800,
      height: 800,
      values: { ...baseValues, surfaceMode: "torus" },
    });

    expect(off).toHaveLength(1);
    expect(torus).toHaveLength(1);
    const offPts = off[0];
    const torusPts = torus[0];

    // Both must be non-empty closed polylines (last point == first point)
    expect(offPts.length).toBeGreaterThan(2);
    expect(torusPts.length).toBeGreaterThan(2);
    expect(offPts[0]).toEqual(offPts[offPts.length - 1]);
    expect(torusPts[0]).toEqual(torusPts[torusPts.length - 1]);

    // Outputs must be distinct: at least one point coordinate differs.
    // (Length parity isn't guaranteed because subdivision proceeds at
    // different rates in the two modes — distinctness of geometry is.)
    const offFirst = offPts[0];
    const torusFirst = torusPts[0];
    const dx = Math.abs(offFirst.x - torusFirst.x);
    const dy = Math.abs(offFirst.y - torusFirst.y);
    expect(dx + dy).toBeGreaterThan(1);
  });
});
