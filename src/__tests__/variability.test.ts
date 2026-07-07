import { describe, it, expect } from "vitest";
import {
  coefficientOfVariation,
  classifyVariability,
  computeVariability,
  VARIABILITY_THRESHOLDS,
} from "../stats/variability.js";

/** Minimal valid SVG with a given set of straight paths. */
function svgWith(paths: string[]): string {
  const body = paths.map((d) => `<path d="${d}"/>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="100mm" viewBox="0 0 100 100">
    <defs><clipPath id="margin-clip"><rect x="0" y="0" width="100" height="100"/></clipPath></defs>
    <g clip-path="url(#margin-clip)">
      <g transform="translate(0,0) scale(1)" stroke-width="0.5">${body}</g>
    </g>
  </svg>`;
}

describe("coefficientOfVariation", () => {
  it("is 0 for identical values", () => {
    expect(coefficientOfVariation([5, 5, 5])).toBe(0);
  });

  it("is 0 when the mean is 0", () => {
    expect(coefficientOfVariation([0, 0])).toBe(0);
  });

  it("matches a hand computation (population variance)", () => {
    // values [10, 20]: mean 15, variance ((25)+(25))/2 = 25, σ = 5, CoV = 5/15.
    expect(coefficientOfVariation([10, 20])).toBeCloseTo(5 / 15, 6);
  });
});

describe("classifyVariability", () => {
  it("low when both CoVs are below the low threshold", () => {
    expect(classifyVariability(0.01, 0.02)).toBe("low");
  });

  it("keys off the larger of the two CoVs", () => {
    expect(classifyVariability(0.01, VARIABILITY_THRESHOLDS.HIGH + 0.01)).toBe("high");
  });

  it("medium sits between the bands", () => {
    expect(classifyVariability(0.1, 0.1)).toBe("medium");
  });
});

describe("computeVariability", () => {
  it("requires at least two variants", () => {
    expect(() => computeVariability([svgWith(["M0,0L10,0"])])).toThrow(/at least 2/);
  });

  it("reports low variability for near-identical variants", () => {
    const a = svgWith(["M0,0L10,0", "M0,10L10,10"]);
    const b = svgWith(["M0,0L10.1,0", "M0,10L10,10"]);
    const r = computeVariability([a, b]);
    expect(r.pathCounts).toEqual([2, 2]);
    expect(r.pathCountCoV).toBe(0);
    expect(r.band).toBe("low");
  });

  it("reports high variability when path counts differ sharply", () => {
    const sparse = svgWith(["M0,0L10,0"]);
    const dense = svgWith(
      Array.from({ length: 20 }, (_, i) => `M0,${i}L10,${i}`),
    );
    const r = computeVariability([sparse, dense]);
    expect(r.pathCounts).toEqual([1, 20]);
    expect(r.pathCountCoV).toBeGreaterThan(VARIABILITY_THRESHOLDS.HIGH);
    expect(r.band).toBe("high");
  });

  it("catches density variation even when path count is constant", () => {
    // Same 1 path each, but one is 10× longer → arc-length CoV fires.
    const short = svgWith(["M0,0L1,0"]);
    const long = svgWith(["M0,0L100,0"]);
    const r = computeVariability([short, long]);
    expect(r.pathCounts).toEqual([1, 1]);
    expect(r.pathCountCoV).toBe(0);
    expect(r.arcLengthCoV).toBeGreaterThan(0);
  });
});
