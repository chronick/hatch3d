import { describe, it, expect } from "vitest";
import sentinelTerrain3D from "../compositions/3d/architectural/sentinel-terrain";
import type { CompositionInput } from "../compositions/types";

const defs = Object.fromEntries(
  Object.entries(sentinelTerrain3D.controls!).map(([k, v]) => [k, v.default]),
) as Record<string, unknown>;

function makeInput(override: Record<string, unknown> = {}): CompositionInput {
  return {
    surface: "rectFace",
    surfaceParams: {},
    hatchParams: { family: "diagonal", angle: 0, count: 1, samples: 4 },
    values: { ...defs, ...override },
  };
}

function serializeLayers(layers: ReturnType<typeof sentinelTerrain3D.layers>) {
  return JSON.stringify(layers);
}

describe("sentinelTerrain3D spires", () => {
  it("spireCount=0 (default) leaves layer output byte-identical", () => {
    // Regression guard: with the default spireCount=0 the composition must
    // produce exactly the same layer stream it produced before spires existed.
    const baseline = serializeLayers(sentinelTerrain3D.layers(makeInput()));
    const explicitZero = serializeLayers(
      sentinelTerrain3D.layers(makeInput({ spireCount: 0, spireHeight: 4 })),
    );
    const differentSpireHeight = serializeLayers(
      sentinelTerrain3D.layers(makeInput({ spireCount: 0, spireHeight: 8 })),
    );
    expect(explicitZero).toBe(baseline);
    // spireHeight is irrelevant when spireCount=0 — output must not change.
    expect(differentSpireHeight).toBe(baseline);
  });

  it("spireCount=3 adds exactly 12 layers vs spireCount=0", () => {
    const zero = sentinelTerrain3D.layers(makeInput({ spireCount: 0 }));
    const three = sentinelTerrain3D.layers(makeInput({ spireCount: 3 }));
    expect(three.length - zero.length).toBe(12);
  });
});
