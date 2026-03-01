import { describe, it, expect } from "vitest";
import { SURFACES } from "../surfaces";
import { generateUVHatchLines } from "../hatch";

describe("generateUVHatchLines", () => {
  const surface = SURFACES.hyperboloid;

  it("generates u-family hatch lines", () => {
    const lines = generateUVHatchLines(surface.fn, surface.defaults, {
      family: "u",
      count: 10,
      samples: 20,
    });
    expect(lines).toHaveLength(10);
    expect(lines[0]).toHaveLength(21); // samples + 1
  });

  it("generates v-family hatch lines", () => {
    const lines = generateUVHatchLines(surface.fn, surface.defaults, {
      family: "v",
      count: 5,
      samples: 10,
    });
    expect(lines).toHaveLength(5);
    expect(lines[0]).toHaveLength(11);
  });

  it("generates diagonal hatch lines", () => {
    const lines = generateUVHatchLines(surface.fn, surface.defaults, {
      family: "diagonal",
      count: 8,
      samples: 15,
      angle: 0.7,
    });
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.length).toBeLessThanOrEqual(8);
  });
});

describe("densityFn filtering", () => {
  const surface = SURFACES.hyperboloid;

  it("without densityFn, returns the expected count", () => {
    const lines = generateUVHatchLines(surface.fn, surface.defaults, {
      family: "u",
      count: 10,
      samples: 10,
    });
    expect(lines).toHaveLength(10);
  });

  it("with densityFn returning 0, filters out all lines", () => {
    const lines = generateUVHatchLines(surface.fn, surface.defaults, {
      family: "u",
      count: 10,
      samples: 10,
      densityFn: () => 0,
      densityOversample: 2,
    });
    expect(lines).toHaveLength(0);
  });

  it("with densityFn returning 1, keeps all oversampled lines", () => {
    const lines = generateUVHatchLines(surface.fn, surface.defaults, {
      family: "u",
      count: 10,
      samples: 10,
      densityFn: () => 1,
      densityOversample: 2,
    });
    // With oversample=2, generates 20 lines, density=1 keeps all
    expect(lines).toHaveLength(20);
  });

  it("with densityFn returning 0.5, keeps roughly half the lines", () => {
    // Run multiple trials to reduce statistical noise
    let totalKept = 0;
    const trials = 20;
    for (let t = 0; t < trials; t++) {
      const lines = generateUVHatchLines(surface.fn, surface.defaults, {
        family: "v",
        count: 50,
        samples: 5,
        densityFn: () => 0.5,
        densityOversample: 2,
      });
      totalKept += lines.length;
    }
    const avgKept = totalKept / trials;
    // 100 oversampled lines * 0.5 density = ~50 expected
    expect(avgKept).toBeGreaterThan(30);
    expect(avgKept).toBeLessThan(70);
  });

  it("works with all hatch families", () => {
    const families = ["u", "v", "diagonal", "rings", "hex", "crosshatch", "spiral", "wave"] as const;
    for (const family of families) {
      const lines = generateUVHatchLines(surface.fn, surface.defaults, {
        family,
        count: 10,
        samples: 10,
        densityFn: () => 1,
        densityOversample: 1,
      });
      expect(lines.length).toBeGreaterThan(0);
    }
  });
});
