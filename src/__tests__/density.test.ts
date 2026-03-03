import { describe, it, expect } from "vitest";
import { filterByProjectedDensity } from "../density";

describe("filterByProjectedDensity", () => {
  const baseOpts = { maxDensity: 2, cellSize: 50, width: 200, height: 200 };

  it("passes through sparse polylines untouched", () => {
    const polylines = [
      [{ x: 10, y: 10 }, { x: 40, y: 40 }],
      [{ x: 110, y: 110 }, { x: 140, y: 140 }],
    ];
    const result = filterByProjectedDensity(polylines, baseOpts);
    expect(result).toHaveLength(2);
  });

  it("thins dense polylines that all pass through the same cell", () => {
    // 10 polylines all passing through cell (0,0)
    const polylines = Array.from({ length: 10 }, (_, i) => [
      { x: 5, y: i * 4 },
      { x: 45, y: i * 4 },
    ]);
    const result = filterByProjectedDensity(polylines, baseOpts);
    // With maxDensity=2 and 10 lines in one cell, keepProb = 2/10 = 0.2
    // Statistically should keep ~2, but allow variance
    expect(result.length).toBeLessThan(polylines.length);
  });

  it("returns empty array for empty input", () => {
    const result = filterByProjectedDensity([], baseOpts);
    expect(result).toHaveLength(0);
  });

  it("keeps polylines outside the viewport (no cells visited)", () => {
    const polylines = [
      [{ x: -100, y: -100 }, { x: -50, y: -50 }],
    ];
    const result = filterByProjectedDensity(polylines, baseOpts);
    expect(result).toHaveLength(1);
  });

  it("handles maxDensity=0 by returning empty", () => {
    const polylines = [
      [{ x: 10, y: 10 }, { x: 40, y: 40 }],
    ];
    const result = filterByProjectedDensity(polylines, { ...baseOpts, maxDensity: 0 });
    expect(result).toHaveLength(0);
  });
});
