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
