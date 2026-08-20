import { describe, it, expect } from "vitest";
import noiseGridCircles from "../compositions/2d/generative/noise-grid-circles";

function defaults(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, c] of Object.entries(noiseGridCircles.controls!)) {
    out[k] = c.default;
  }
  return out;
}

function gen(override: Record<string, unknown> = {}) {
  return noiseGridCircles.generate({
    width: 400,
    height: 400,
    values: { ...defaults(), ...override },
  });
}

describe("noiseGridCircles", () => {
  it("emits one closed polyline per grid cell", () => {
    const out = gen({ gridCols: 5, gridRows: 4 });
    expect(out.length).toBe(20);
  });

  it("each polyline is a closed circle with circleSegments + 1 points", () => {
    const out = gen({ gridCols: 3, gridRows: 3, circleSegments: 16 });
    for (const poly of out) {
      expect(poly.length).toBe(17);
      const first = poly[0];
      const last = poly[poly.length - 1];
      expect(last.x).toBeCloseTo(first.x, 5);
      expect(last.y).toBeCloseTo(first.y, 5);
    }
  });

  it("is deterministic for a fixed seed", () => {
    const a = gen({ noiseSeed: 7 });
    const b = gen({ noiseSeed: 7 });
    expect(a).toEqual(b);
  });

  it("different seeds produce different radii", () => {
    const a = gen({ gridCols: 6, gridRows: 6, noiseSeed: 1 });
    const b = gen({ gridCols: 6, gridRows: 6, noiseSeed: 2 });
    expect(a).not.toEqual(b);
  });

  it("radius stays within [rMin, rMax] * cellHalfWidth bounds", () => {
    const gridCols = 8;
    const gridRows = 8;
    const rMin = 0.05;
    const rMax = 0.3;
    const out = gen({ gridCols, gridRows, rMin, rMax, circleSegments: 32 });
    const cellHalfWidth = Math.min(400 / gridCols, 400 / gridRows) * 0.5;
    for (const poly of out) {
      const cx = poly.reduce((s, p) => s + p.x, 0) / poly.length;
      const cy = poly.reduce((s, p) => s + p.y, 0) / poly.length;
      for (const p of poly) {
        const r = Math.hypot(p.x - cx, p.y - cy);
        expect(r).toBeGreaterThanOrEqual(rMin * cellHalfWidth - 1e-6);
        expect(r).toBeLessThanOrEqual(rMax * cellHalfWidth + 1e-6);
      }
    }
  });

  it("has halftone-fine and halftone-coarse suggested presets", () => {
    expect(noiseGridCircles.suggestedPresets?.["halftone-fine"]).toBeDefined();
    expect(noiseGridCircles.suggestedPresets?.["halftone-coarse"]).toBeDefined();
  });
});
