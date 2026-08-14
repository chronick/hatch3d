import { describe, it, expect } from "vitest";
import concentricGridDisorder from "../compositions/2d/patterns/concentric-grid-disorder";

function defaults(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, c] of Object.entries(concentricGridDisorder.controls!)) {
    out[k] = c.default;
  }
  return out;
}

function gen(override: Record<string, unknown> = {}) {
  return concentricGridDisorder.generate({
    width: 800,
    height: 800,
    values: { ...defaults(), ...override },
  });
}

describe("concentricGridDisorder", () => {
  it("emits gridCount^2 * ringsPerCell closed rings when disorderRate = 0", () => {
    const out = gen({ gridCount: 5, ringsPerCell: 4, disorderRate: 0 });
    expect(out.length).toBe(5 * 5 * 4);
    for (const poly of out) {
      expect(poly.length).toBe(5);
      expect(poly[4].x).toBeCloseTo(poly[0].x, 10);
      expect(poly[4].y).toBeCloseTo(poly[0].y, 10);
    }
  });

  it("disorderRate = 0 yields a mathematically perfect grid of axis-aligned squares", () => {
    const out = gen({ gridCount: 4, ringsPerCell: 3, disorderRate: 0, seed: 7 });

    const centers = new Set<string>();
    for (const poly of out) {
      const xs = poly.slice(0, 4).map((p) => p.x);
      const ys = poly.slice(0, 4).map((p) => p.y);
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const minY = Math.min(...ys);
      const maxY = Math.max(...ys);

      // Axis-aligned: only two distinct x values and two distinct y values.
      expect(new Set(xs.map((v) => v.toFixed(9))).size).toBe(2);
      expect(new Set(ys.map((v) => v.toFixed(9))).size).toBe(2);
      // Square, not rectangle.
      expect(maxX - minX).toBeCloseTo(maxY - minY, 9);

      centers.add(
        `${((minX + maxX) / 2).toFixed(6)},${((minY + maxY) / 2).toFixed(6)}`,
      );
    }

    // Every ring in a cell shares that cell's centre → exactly gridCount^2 centres.
    expect(centers.size).toBe(16);
  });

  it("disorderRate = 0 ignores seed and perturbMagnitude entirely", () => {
    const a = gen({ disorderRate: 0, seed: 1, perturbMagnitude: 0 });
    const b = gen({ disorderRate: 0, seed: 999, perturbMagnitude: 1 });
    expect(a).toEqual(b);
  });

  it("is deterministic for a fixed seed and varies with the seed", () => {
    const a = gen({ disorderRate: 0.3, seed: 12 });
    const b = gen({ disorderRate: 0.3, seed: 12 });
    const c = gen({ disorderRate: 0.3, seed: 13 });
    expect(a).toEqual(b);
    expect(c).not.toEqual(a);
  });

  it("disorderRate > 0 breaks the perfect grid (rotated/offset/dropped rings)", () => {
    const ordered = gen({ gridCount: 8, ringsPerCell: 5, disorderRate: 0 });
    const molnar = gen({
      gridCount: 8,
      ringsPerCell: 5,
      disorderRate: 0.15,
      seed: 3,
    });

    // Some rings dropped, so never more than the ordered field.
    expect(molnar.length).toBeLessThan(ordered.length);
    // ...but the rule stays legible: the vast majority of rings are untouched.
    expect(molnar.length).toBeGreaterThan(ordered.length * 0.9);

    const perturbed = molnar.filter((poly) => {
      const xs = poly.slice(0, 4).map((p) => p.x.toFixed(9));
      return new Set(xs).size !== 2;
    });
    expect(perturbed.length).toBeGreaterThan(0);
  });

  it("stays inside the canvas bounds at default controls", () => {
    const out = gen();
    expect(out.length).toBeGreaterThan(0);
    for (const poly of out) {
      for (const p of poly) {
        expect(p.x).toBeGreaterThanOrEqual(0);
        expect(p.x).toBeLessThanOrEqual(800);
        expect(p.y).toBeGreaterThanOrEqual(0);
        expect(p.y).toBeLessThanOrEqual(800);
      }
    }
  });
});
