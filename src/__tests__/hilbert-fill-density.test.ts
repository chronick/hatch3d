import { describe, it, expect } from "vitest";
import hilbertFill from "../compositions/2d/patterns/hilbert-fill";
import type { ImageSource } from "../compositions/types";

const W = 400;
const H = 400;

function defaults(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, c] of Object.entries(hilbertFill.controls!)) {
    out[k] = c.type === "image" ? null : c.default;
  }
  return out;
}

function gen(override: Record<string, unknown> = {}) {
  return hilbertFill.generate({
    width: W,
    height: H,
    values: { ...defaults(), ...override },
  });
}

/** Synthetic ImageSource from a unit-space brightness function. */
function makeImage(w: number, h: number, fn: (u: number, v: number) => number): ImageSource {
  const brightness = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      brightness[y * w + x] = fn(x / (w - 1), y / (h - 1));
    }
  }
  return { brightness, width: w, height: h };
}

function pointCount(lines: { x: number; y: number }[][]): number {
  return lines.reduce((n, l) => n + l.length, 0);
}

describe("hilbertFill — uniform mode (backward compatible)", () => {
  it("emits a single non-empty polyline", () => {
    const out = gen({ densitySource: "uniform", maxLevel: 4 });
    expect(out.length).toBe(1);
    expect(out[0].length).toBeGreaterThan(0);
  });

  it("emits exactly 4^maxLevel points at fixed depth", () => {
    for (const level of [2, 3, 5]) {
      const out = gen({ densitySource: "uniform", minLevel: 1, maxLevel: level });
      expect(pointCount(out)).toBe(Math.pow(4, level));
    }
  });

  it("ignores contrast in uniform mode (flat field stays pinned at max depth)", () => {
    const low = gen({ densitySource: "uniform", minLevel: 1, maxLevel: 5, contrast: 0.5 });
    const high = gen({ densitySource: "uniform", minLevel: 1, maxLevel: 5, contrast: 4 });
    expect(pointCount(low)).toBe(pointCount(high));
    expect(pointCount(low)).toBe(Math.pow(4, 5));
  });

  it("is deterministic across repeated calls", () => {
    const a = gen({ densitySource: "uniform", maxLevel: 4 });
    const b = gen({ densitySource: "uniform", maxLevel: 4 });
    expect(a).toEqual(b);
  });

  it("still honours the legacy `level` control name used by saved presets", () => {
    const legacy = gen({ densitySource: "uniform", minLevel: 1, level: 6 });
    expect(pointCount(legacy)).toBe(Math.pow(4, 6));
  });

  it("keeps consecutive points adjacent (continuous traversal, no teleporting)", () => {
    const pts = gen({ densitySource: "uniform", minLevel: 1, maxLevel: 4 })[0];
    // At uniform depth n the cell pitch is size/2^n; Hilbert steps are exactly
    // one cell, so no step may exceed that (plus float slack).
    const pitch = Math.min(W, H) - 2 * (defaults().margin as number);
    const maxStep = (pitch / Math.pow(2, 4)) * 1.0001;
    for (let i = 1; i < pts.length; i++) {
      const d = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
      expect(d).toBeLessThanOrEqual(maxStep);
    }
  });
});

describe("hilbertFill — bounds", () => {
  it("keeps all points inside the margins, at any rotation and field", () => {
    const cases: Record<string, unknown>[] = [
      { densitySource: "uniform", maxLevel: 5, rotation: 0 },
      { densitySource: "uniform", maxLevel: 5, rotation: 45 },
      { densitySource: "noise", minLevel: 1, maxLevel: 6, rotation: 137, seed: 7 },
    ];
    for (const c of cases) {
      const margin = defaults().margin as number;
      for (const p of gen(c)[0]) {
        expect(p.x).toBeGreaterThanOrEqual(margin - 1e-6);
        expect(p.x).toBeLessThanOrEqual(W - margin + 1e-6);
        expect(p.y).toBeGreaterThanOrEqual(margin - 1e-6);
        expect(p.y).toBeLessThanOrEqual(H - margin + 1e-6);
      }
    }
  });
});

describe("hilbertFill — noise field", () => {
  const base = { densitySource: "noise", minLevel: 1, maxLevel: 5, seed: 42, contrast: 1 };

  it("produces a single polyline whose point count differs from uniform at the same maxLevel", () => {
    const noise = gen(base);
    const uniform = gen({ ...base, densitySource: "uniform" });
    expect(noise.length).toBe(1);
    expect(noise[0].length).toBeGreaterThan(0);
    expect(pointCount(noise)).not.toBe(pointCount(uniform));
  });

  it("is deterministic for a fixed seed and varies with the seed", () => {
    expect(gen(base)).toEqual(gen(base));
    expect(pointCount(gen({ ...base, seed: 99 }))).not.toBe(pointCount(gen(base)));
  });

  it("higher contrast changes the point count", () => {
    const soft = pointCount(gen({ ...base, contrast: 0.5 }));
    const mid = pointCount(gen({ ...base, contrast: 1 }));
    const hard = pointCount(gen({ ...base, contrast: 4 }));
    expect(hard).not.toBe(mid);
    expect(soft).not.toBe(mid);
    // Raising the exponent pushes a [0,1] field down → shallower subdivision.
    expect(hard).toBeLessThan(mid);
    expect(soft).toBeGreaterThan(mid);
  });

  it("minLevel raises the floor on subdivision depth", () => {
    const shallow = pointCount(gen({ ...base, minLevel: 1 }));
    const floored = pointCount(gen({ ...base, minLevel: 4 }));
    expect(floored).toBeGreaterThan(shallow);
  });
});

describe("hilbertFill — image field", () => {
  const base = { densitySource: "image", minLevel: 1, maxLevel: 6, contrast: 1 };

  it("subdivides more on the dark side than the bright side", () => {
    // Left half black (brightness 0 → deepest), right half white.
    const img = makeImage(32, 32, (u) => (u < 0.5 ? 0 : 1));
    const pts = gen({ ...base, image: img })[0];

    const mid = W / 2;
    const left = pts.filter((p) => p.x < mid).length;
    const right = pts.filter((p) => p.x > mid).length;

    expect(left).toBeGreaterThan(right);
    expect(left).toBeGreaterThan(right * 10);
    expect(right).toBeGreaterThan(0);
  });

  it("inverting the image flips which side is dense", () => {
    const leftDark = makeImage(32, 32, (u) => (u < 0.5 ? 0 : 1));
    const rightDark = makeImage(32, 32, (u) => (u < 0.5 ? 1 : 0));
    const mid = W / 2;
    const leftOf = (image: ImageSource) =>
      gen({ ...base, image })[0].filter((p) => p.x < mid).length;
    expect(leftOf(leftDark)).toBeGreaterThan(leftOf(rightDark));
  });

  it("falls back to uniform when no image is loaded, without throwing", () => {
    expect(() => gen({ ...base, image: null })).not.toThrow();
    const fallback = gen({ ...base, image: null });
    const uniform = gen({ ...base, densitySource: "uniform" });
    expect(fallback).toEqual(uniform);
    expect(pointCount(fallback)).toBe(Math.pow(4, 6));
  });

  it("is deterministic for a fixed image", () => {
    const img = makeImage(16, 16, (u, v) => (u + v) / 2);
    expect(gen({ ...base, image: img })).toEqual(gen({ ...base, image: img }));
  });
});
