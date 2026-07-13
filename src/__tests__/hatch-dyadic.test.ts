import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { SURFACES } from "../surfaces";
import { generateUVHatchLines, type HatchParams } from "../hatch";
import { isLayerWasmCompatible } from "../wasm-pipeline";

const surface = SURFACES.hyperboloid;

function lineKey(line: THREE.Vector3[]): string {
  return line.map((p) => `${p.x},${p.y},${p.z}`).join(";");
}

function lineSet(lines: THREE.Vector3[][]): Set<string> {
  return new Set(lines.map(lineKey));
}

function generate(overrides: Partial<HatchParams>): THREE.Vector3[][] {
  return generateUVHatchLines(surface.fn, surface.defaults, {
    family: "u",
    count: 10,
    samples: 12,
    ...overrides,
  });
}

describe("uniform placement (default path)", () => {
  it("absent placement spaces first points at i/(count-1)", () => {
    const count = 10;
    const lines = generate({ count });
    expect(lines).toHaveLength(count);
    for (let i = 0; i < count; i++) {
      const u = i / (count - 1);
      const expected = surface.fn(u, 0, surface.defaults);
      expect(lines[i][0].x).toBe(expected.x);
      expect(lines[i][0].y).toBe(expected.y);
      expect(lines[i][0].z).toBe(expected.z);
    }
  });

  it('explicit "uniform" is identical to absent placement', () => {
    const params: Partial<HatchParams> = {
      family: "diagonal",
      count: 9,
      angle: 0.7,
      noiseAmplitude: 0.05,
      noiseFrequency: 3,
      seed: 42,
    };
    const absent = generate(params);
    const explicit = generate({ ...params, placement: "uniform" });
    expect(explicit.map(lineKey)).toEqual(absent.map(lineKey));
  });
});

describe("dyadic placement", () => {
  it("takes complete levels: counts within a level yield the same lines", () => {
    // Levels total 1, 3, 7, 15, … lines; count 5 fits only levels 0-1 (3 lines)
    expect(generate({ placement: "dyadic", count: 5 })).toHaveLength(3);
    expect(generate({ placement: "dyadic", count: 7 })).toHaveLength(7);
    expect(generate({ placement: "dyadic", count: 14 })).toHaveLength(7);
  });

  const subsetFamilies: HatchParams["family"][] = ["u", "v", "diagonal"];
  for (const family of subsetFamilies) {
    it(`${family}: line set at count N is a subset of count M > N`, () => {
      const small = generate({ family, placement: "dyadic", count: 7, angle: 0.7 });
      const large = generate({ family, placement: "dyadic", count: 31, angle: 0.7 });
      expect(small.length).toBeGreaterThan(0);
      expect(large.length).toBeGreaterThan(small.length);
      const largeSet = lineSet(large);
      for (const line of small) {
        expect(largeSet.has(lineKey(line))).toBe(true);
      }
    });
  }

  it("uniform placement does NOT have the subset property (sanity)", () => {
    // denominators 6 and 31 are coprime, so only the endpoints coincide
    const small = generate({ count: 7 });
    const large = generate({ count: 32 });
    const largeSet = lineSet(large);
    const shared = small.filter((line) => largeSet.has(lineKey(line)));
    expect(shared.length).toBeLessThan(small.length);
  });

  it("noise wobble is identity-keyed: shared lines keep identical geometry", () => {
    const params: Partial<HatchParams> = {
      placement: "dyadic",
      noiseAmplitude: 0.08,
      noiseFrequency: 4,
      seed: 7,
    };
    const small = generate({ ...params, count: 7 });
    const large = generate({ ...params, count: 31 });
    const largeSet = lineSet(large);
    for (const line of small) {
      expect(largeSet.has(lineKey(line))).toBe(true);
    }
  });

  it("density keep decisions are identity-keyed: kept lines stay kept", () => {
    const params: Partial<HatchParams> = {
      placement: "dyadic",
      densityFn: () => 0.5,
      densityOversample: 2,
      seed: 11,
    };
    const small = generate({ ...params, count: 15 });
    const large = generate({ ...params, count: 63 });
    expect(small.length).toBeGreaterThan(0);
    const largeSet = lineSet(large);
    for (const line of small) {
      expect(largeSet.has(lineKey(line))).toBe(true);
    }
  });
});

describe("isLayerWasmCompatible", () => {
  it("rejects layers with dyadic placement", () => {
    expect(
      isLayerWasmCompatible({
        surface: "hyperboloid",
        hatch: { family: "u", count: 10, placement: "dyadic" },
      }),
    ).toBe(false);
    expect(
      isLayerWasmCompatible({
        surface: "hyperboloid",
        hatch: { family: "u", count: 10, placement: "uniform" },
      }),
    ).toBe(true);
  });
});
