import { describe, it, expect } from "vitest";
import isoWoodBlocks from "../compositions/2d/generative/iso-wood-blocks";

function hashLines(lines: Array<Array<{ x: number; y: number }>>) {
  let h = 0;
  for (const l of lines) for (const p of l) {
    h = (h * 31 + Math.round(p.x * 100)) | 0;
    h = (h * 31 + Math.round(p.y * 100)) | 0;
  }
  return h;
}

const defs = Object.fromEntries(
  Object.entries(isoWoodBlocks.controls!).map(([k, v]) => [k, v.default])
) as Record<string, unknown>;

function gen(override: Record<string, unknown>) {
  return isoWoodBlocks.generate!({ width: 800, height: 800, values: { ...defs, ...override } });
}

describe("iso-wood-blocks slider sanity", () => {
  it("grainContourSpacing visibly changes output", () => {
    expect(hashLines(gen({ grainContourSpacing: 0.02 }))).not.toBe(hashLines(gen({ grainContourSpacing: 0.18 })));
  });
  it("grainWaviness visibly changes output", () => {
    expect(hashLines(gen({ grainWaviness: 0 }))).not.toBe(hashLines(gen({ grainWaviness: 1 })));
  });
  it("shadingContrast visibly changes output", () => {
    expect(hashLines(gen({ shadingContrast: 0 }))).not.toBe(hashLines(gen({ shadingContrast: 1 })));
  });
});
