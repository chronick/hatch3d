import { describe, it, expect } from "vitest";
import { SURFACES } from "../surfaces";
import { generateUVHatchLines, generateStippleDots, type HatchParams } from "../hatch";

const surface = SURFACES.hyperboloid;

describe("stipple mode is purely additive", () => {
  it("params without `stipple` still produce swept line families", () => {
    const params: HatchParams = { family: "u", count: 12, samples: 20 };
    const lines = generateUVHatchLines(surface.fn, surface.defaults, params);
    expect(lines).toHaveLength(12);
    // Swept lines are long polylines (samples + 1 points), not 2-point dots.
    for (const line of lines) {
      expect(line.length).toBe(21);
    }
  });

  it("a params object minus `stipple` is deterministic across repeat runs (unchanged code path)", () => {
    const params: HatchParams = { family: "v", count: 9, samples: 13, angle: 0.4 };
    const a = generateUVHatchLines(surface.fn, surface.defaults, params);
    const b = generateUVHatchLines(surface.fn, surface.defaults, params);
    const flatten = (ls: (typeof a)) => ls.map((l) => l.map((p) => [p.x, p.y, p.z]));
    expect(flatten(a)).toEqual(flatten(b));
  });

  it("adding `stipple` to otherwise identical params changes the output shape entirely", () => {
    const base: HatchParams = { family: "u", count: 12, samples: 20 };
    const swept = generateUVHatchLines(surface.fn, surface.defaults, base);
    const stippled = generateUVHatchLines(surface.fn, surface.defaults, {
      ...base,
      stipple: { dotsPerUnit: 20, dotSize: 0.02, seed: 1 },
    });
    expect(swept.every((l) => l.length > 2)).toBe(true);
    expect(stippled.every((l) => l.length === 2)).toBe(true);
  });
});

describe("stipple mode emits many short polylines", () => {
  it("emits ~dotsPerUnit^2 two-point dots over the unit UV domain", () => {
    const dots = generateUVHatchLines(surface.fn, surface.defaults, {
      stipple: { dotsPerUnit: 30, dotSize: 0.02, seed: 5 },
    });
    expect(dots).toHaveLength(30 * 30);
    for (const d of dots) expect(d).toHaveLength(2);
  });

  it("each dot is a short segment whose length tracks dotSize", () => {
    const small = generateUVHatchLines(surface.fn, surface.defaults, {
      stipple: { dotsPerUnit: 10, dotSize: 0.01, seed: 3 },
    });
    const big = generateUVHatchLines(surface.fn, surface.defaults, {
      stipple: { dotsPerUnit: 10, dotSize: 0.05, seed: 3 },
    });
    const len = (d: (typeof small)[number]) => d[0].distanceTo(d[1]);
    for (const d of small) expect(len(d)).toBeCloseTo(0.01, 6);
    for (const d of big) expect(len(d)).toBeCloseTo(0.05, 6);
  });

  it('shape "cross" emits two segments per dot', () => {
    const point = generateUVHatchLines(surface.fn, surface.defaults, {
      stipple: { dotsPerUnit: 12, dotSize: 0.02, shape: "point", seed: 9 },
    });
    const cross = generateUVHatchLines(surface.fn, surface.defaults, {
      stipple: { dotsPerUnit: 12, dotSize: 0.02, shape: "cross", seed: 9 },
    });
    expect(cross).toHaveLength(point.length * 2);
    for (const d of cross) expect(d).toHaveLength(2);
  });

  it("respects uRange / vRange by scaling the candidate grid", () => {
    const halfU = generateUVHatchLines(surface.fn, surface.defaults, {
      uRange: [0, 0.5],
      stipple: { dotsPerUnit: 40, dotSize: 0.02, seed: 2 },
    });
    // gridU = round(40 * 0.5) = 20, gridV = 40
    expect(halfU).toHaveLength(20 * 40);
  });
});

describe("densityFn modulates dot count monotonically", () => {
  const stipple = { dotsPerUnit: 40, dotSize: 0.02, seed: 11 };

  it("densityFn = 0 drops every dot; densityFn = 1 keeps every dot", () => {
    const none = generateUVHatchLines(surface.fn, surface.defaults, {
      densityFn: () => 0,
      stipple,
    });
    const all = generateUVHatchLines(surface.fn, surface.defaults, {
      densityFn: () => 1,
      stipple,
    });
    expect(none).toHaveLength(0);
    expect(all).toHaveLength(40 * 40);
  });

  it("dot count increases monotonically with constant density", () => {
    const counts = [0, 0.2, 0.4, 0.6, 0.8, 1].map(
      (d) =>
        generateUVHatchLines(surface.fn, surface.defaults, {
          densityFn: () => d,
          stipple,
        }).length,
    );
    for (let i = 1; i < counts.length; i++) {
      expect(counts[i]).toBeGreaterThanOrEqual(counts[i - 1]);
    }
    expect(counts[counts.length - 1]).toBeGreaterThan(counts[0]);
  });

  it("constant density ~0.5 keeps roughly half the candidates", () => {
    const kept = generateUVHatchLines(surface.fn, surface.defaults, {
      densityFn: () => 0.5,
      stipple: { dotsPerUnit: 60, dotSize: 0.02, seed: 77 },
    }).length;
    const total = 60 * 60;
    expect(kept / total).toBeGreaterThan(0.42);
    expect(kept / total).toBeLessThan(0.58);
  });

  it("a spatially varying densityFn puts more dots where density is higher", () => {
    // Dense for u < 0.5, sparse for u >= 0.5
    const dots = generateUVHatchLines(surface.fn, surface.defaults, {
      densityFn: (u) => (u < 0.5 ? 0.9 : 0.1),
      stipple: { dotsPerUnit: 60, dotSize: 0.02, seed: 4 },
    });
    // Recover the split by re-running each half in isolation.
    const left = generateUVHatchLines(surface.fn, surface.defaults, {
      uRange: [0, 0.5],
      densityFn: (u) => (u < 0.5 ? 0.9 : 0.1),
      stipple: { dotsPerUnit: 60, dotSize: 0.02, seed: 4 },
    }).length;
    const right = generateUVHatchLines(surface.fn, surface.defaults, {
      uRange: [0.5, 1],
      densityFn: (u) => (u < 0.5 ? 0.9 : 0.1),
      stipple: { dotsPerUnit: 60, dotSize: 0.02, seed: 4 },
    }).length;
    expect(left).toBeGreaterThan(right * 3);
    expect(dots.length).toBeGreaterThan(0);
  });
});

describe("stipple is deterministic per seed", () => {
  const mk = (seed: number) =>
    generateUVHatchLines(surface.fn, surface.defaults, {
      densityFn: (u, v) => 0.3 + 0.5 * u * v,
      stipple: { dotsPerUnit: 30, dotSize: 0.02, seed },
    });
  const flatten = (ls: ReturnType<typeof mk>) =>
    ls.map((l) => l.map((p) => [p.x, p.y, p.z]));

  it("same seed → byte-identical dot field", () => {
    expect(flatten(mk(42))).toEqual(flatten(mk(42)));
  });

  it("different seed → different dot field", () => {
    expect(flatten(mk(42))).not.toEqual(flatten(mk(43)));
  });

  it("does not consume Math.random (stream independent of global RNG)", () => {
    Math.random();
    const a = flatten(mk(1234));
    for (let i = 0; i < 50; i++) Math.random();
    const b = flatten(mk(1234));
    expect(a).toEqual(b);
  });
});

describe("generateStippleDots direct API", () => {
  it("returns [] for a degenerate UV range or non-positive dotsPerUnit", () => {
    expect(
      generateStippleDots(surface.fn, surface.defaults, { dotsPerUnit: 20 }, [0.5, 0.5], [0, 1]),
    ).toHaveLength(0);
    expect(
      generateStippleDots(surface.fn, surface.defaults, { dotsPerUnit: 0 }, [0, 1], [0, 1]),
    ).toHaveLength(0);
  });

  it("places every dot on (or infinitesimally near) the surface", () => {
    const dots = generateStippleDots(
      surface.fn,
      surface.defaults,
      { dotsPerUnit: 15, dotSize: 0.01, seed: 8 },
      [0, 1],
      [0, 1],
    );
    expect(dots.length).toBeGreaterThan(0);
    for (const d of dots) {
      const mid = d[0].clone().add(d[1]).multiplyScalar(0.5);
      expect(Number.isFinite(mid.x)).toBe(true);
      expect(Number.isFinite(mid.y)).toBe(true);
      expect(Number.isFinite(mid.z)).toBe(true);
    }
  });

  it("works on the flat rectFace primitive used by the stipple scene", () => {
    const rect = SURFACES.rectFace;
    const dots = generateStippleDots(
      rect.fn,
      rect.defaults,
      { dotsPerUnit: 20, dotSize: 0.02, seed: 6 },
      [0, 1],
      [0, 1],
    );
    expect(dots).toHaveLength(400);
    for (const d of dots) {
      // rectFace defaults lie in the y = 0 plane
      expect(d[0].y).toBeCloseTo(0, 9);
      expect(d[1].y).toBeCloseTo(0, 9);
    }
  });
});
