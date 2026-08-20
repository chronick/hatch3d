import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import cellFlowGradient, {
  penSliceIndex,
  type Pt,
} from "../compositions/2d/generative/cell-flow-gradient";
import cellFlowRamp from "../compositions/layered/demos/cell-flow-ramp";

const W = 800;
const H = 1000;

const defs = Object.fromEntries(
  Object.entries(cellFlowGradient.controls!).map(([k, v]) => [k, v.default]),
) as Record<string, unknown>;

function gen(override: Record<string, unknown> = {}): Pt[][] {
  return cellFlowGradient.generate({ width: W, height: H, values: { ...defs, ...override } });
}

/** Stable digest of a whole generate() result. */
function digest(lines: Pt[][]): string {
  return createHash("sha256").update(JSON.stringify(lines)).digest("hex");
}

/** Identity key for a polyline. First point, as the composition's contract implies. */
function firstPointKey(line: Pt[]): string {
  return `${line[0].x},${line[0].y}`;
}

// ── Byte-compat guard ───────────────────────────────────────────────────────

/**
 * Digests of `cellFlowGradient.generate()` captured from the composition as it
 * stood *before* `penCount`/`penIndex` existed (git 0f40940, via a detached
 * worktree). Adding the slicing controls must not perturb a single coordinate
 * of the single-pen render — these hashes are the mechanical proof, and a
 * failure here means the no-op path stopped being a no-op.
 */
const PRE_SLICING_DIGESTS: { values: Record<string, unknown>; lines: number; sha256: string }[] = [
  {
    values: {},
    lines: 1382,
    sha256: "53abcf4e91a4f54c56ef078e267e86fc95c7b6a791d54ee7e3d19d5ca05fffdf",
  },
  {
    values: { seed: 1234, cells: 11 },
    lines: 1181,
    sha256: "c723f06ea22b28966a44316d7f3ebd62de6a4e18640c24425a077ab72d7511aa",
  },
  {
    values: { seed: 7, cells: 21, lineSpacing: 2.4, waveAmplitude: 14 },
    lines: 2331,
    sha256: "5faa7326ca48c781c24c30abc1608494e9f51cf5b23394641e2e8fffdca05f7c",
  },
  {
    values: { outline: false, seed: 99 },
    lines: 1174,
    sha256: "65ca482ec719a78f8dd81b7f7923e7372b0d7cd9e14b80f87b69b8b2095ba952",
  },
];

describe("cell-flow-gradient pre-slicing byte compatibility", () => {
  it("reproduces the pre-change output exactly at the control defaults", () => {
    for (const fixture of PRE_SLICING_DIGESTS) {
      const lines = gen(fixture.values);
      const label = JSON.stringify(fixture.values);
      expect(lines.length, `${label} line count drifted`).toBe(fixture.lines);
      expect(digest(lines), `${label} geometry drifted`).toBe(fixture.sha256);
    }
  });

  it("reproduces it just the same when penCount/penIndex are absent entirely", () => {
    // Not merely "defaulted to 1" — genuinely missing from the values bag, the
    // shape an older preset or a stored config would have.
    for (const fixture of PRE_SLICING_DIGESTS) {
      const values = { ...defs, ...fixture.values };
      delete values.penCount;
      delete values.penIndex;
      const lines = cellFlowGradient.generate({ width: W, height: H, values });
      expect(digest(lines), `${JSON.stringify(fixture.values)} drifted without pen params`).toBe(
        fixture.sha256,
      );
    }
  });

  it("treats penCount 1 and penCount 0 as the untouched single-pen path", () => {
    const baseline = PRE_SLICING_DIGESTS[0].sha256;
    expect(digest(gen({ penCount: 1, penIndex: 0 }))).toBe(baseline);
    expect(digest(gen({ penCount: 1, penIndex: 3 }))).toBe(baseline);
    expect(digest(gen({ penCount: 0 }))).toBe(baseline);
  });
});

// ── penSliceIndex ───────────────────────────────────────────────────────────

describe("penSliceIndex", () => {
  it("cuts the span into N equal left-to-right bands", () => {
    expect(penSliceIndex(0, 0, 100, 4)).toBe(0);
    expect(penSliceIndex(24.9, 0, 100, 4)).toBe(0);
    expect(penSliceIndex(25, 0, 100, 4)).toBe(1);
    expect(penSliceIndex(50, 0, 100, 4)).toBe(2);
    expect(penSliceIndex(75, 0, 100, 4)).toBe(3);
    expect(penSliceIndex(100, 0, 100, 4)).toBe(3);
  });

  it("clamps the wave overscan either side into the end bands", () => {
    // Runs start `waveAmplitude` left of the span and end that far right of it.
    expect(penSliceIndex(-40, 0, 100, 4)).toBe(0);
    expect(penSliceIndex(140, 0, 100, 4)).toBe(3);
  });

  it("degenerates safely", () => {
    expect(penSliceIndex(50, 0, 100, 1)).toBe(0);
    expect(penSliceIndex(50, 50, 50, 4)).toBe(0); // zero-width span
  });
});

// ── The partition property ──────────────────────────────────────────────────

describe("cell-flow-gradient pen slicing partitions the single-pen render", () => {
  const cases: { label: string; N: number; base: Record<string, unknown> }[] = [
    { label: "defaults, N=4", N: 4, base: {} },
    { label: "no outline, N=3", N: 3, base: { outline: false } },
    { label: "dense, N=2", N: 2, base: { seed: 1234, cells: 21, lineSpacing: 2.2 } },
    { label: "N=8", N: 8, base: { seed: 42 } },
  ];

  for (const { label, N, base } of cases) {
    it(`${label}: the N slices cover the whole render, each line exactly once`, () => {
      const full = gen(base);
      const fullKeys = full.map(firstPointKey);
      // Precondition for using first points as identity at all.
      expect(new Set(fullKeys).size, "first points are not unique in this render").toBe(full.length);

      const slices = Array.from({ length: N }, (_, k) => gen({ ...base, penCount: N, penIndex: k }));

      // Counts add up — nothing dropped, nothing doubled.
      const summed = slices.reduce((s, sl) => s + sl.length, 0);
      expect(summed, "slice line counts do not sum to the unsliced count").toBe(full.length);

      // And the identities agree: same set, no key in two slices.
      const owner = new Map<string, number>();
      for (let k = 0; k < N; k++) {
        for (const line of slices[k]) {
          const key = firstPointKey(line);
          expect(owner.has(key), `line ${key} appears in slices ${owner.get(key)} and ${k}`).toBe(
            false,
          );
          owner.set(key, k);
        }
      }
      expect([...owner.keys()].sort()).toEqual([...fullKeys].sort());
    });
  }

  it("gives every pen real work to do", () => {
    const N = 4;
    for (let k = 0; k < N; k++) {
      expect(gen({ penCount: N, penIndex: k }).length, `pen ${k} is empty`).toBeGreaterThan(50);
    }
  });

  it("hands the heavy cell outline to exactly one pen", () => {
    const N = 4;
    const rings = (lines: Pt[][]) =>
      lines.filter((l) => Math.hypot(l[0].x - l[l.length - 1].x, l[0].y - l[l.length - 1].y) < 1e-9)
        .length;
    const perPen = Array.from({ length: N }, (_, k) => rings(gen({ penCount: N, penIndex: k })));
    expect(perPen.filter((n) => n > 0)).toHaveLength(1);
    // …the darkest one, matching the reference's near-black border.
    expect(perPen[N - 1]).toBe(rings(gen()));
  });

  it("keeps each pen's ink to its own band of the page", () => {
    // A left-to-right ramp only reads as a ramp if the bands are ordered.
    const N = 4;
    const meanX = (lines: Pt[][]) => {
      const xs = lines.flat().map((p) => p.x);
      return xs.reduce((s, x) => s + x, 0) / xs.length;
    };
    // Single cell filling the page: the bands are then unambiguous.
    const base = { cells: 3, outline: false, seed: 5 };
    const means = Array.from({ length: N }, (_, k) =>
      meanX(gen({ ...base, penCount: N, penIndex: k })),
    );
    for (let k = 1; k < N; k++) {
      expect(means[k], `pen ${k} is not right of pen ${k - 1}`).toBeGreaterThan(means[k - 1]);
    }
  });

  it("is deterministic per slice", () => {
    expect(gen({ penCount: 4, penIndex: 2 })).toEqual(gen({ penCount: 4, penIndex: 2 }));
  });

  it("repartitions when the seed changes but stays a partition", () => {
    const a = gen({ seed: 3, penCount: 4, penIndex: 1 });
    const b = gen({ seed: 4, penCount: 4, penIndex: 1 });
    expect(a).not.toEqual(b);
  });
});

// ── cellFlowRamp ────────────────────────────────────────────────────────────

describe("cellFlowRamp", () => {
  it("exports valid layered composition metadata", () => {
    expect(cellFlowRamp.id).toBe("cellFlowRamp");
    expect(cellFlowRamp.name.length).toBeGreaterThan(0);
    expect(cellFlowRamp.description!.length).toBeGreaterThan(0);
    expect(cellFlowRamp.type).toBe("layered");
    expect(cellFlowRamp.category).toBe("layered");
    expect(Array.isArray(cellFlowRamp.tags)).toBe(true);
  });

  it("declares N layers of the inner composition on distinct ramp colours", () => {
    const layers = cellFlowRamp.layers!;
    expect(layers.length).toBe(4);
    for (const layer of layers) {
      expect(layer.composition).toBe("cellFlowGradient");
      expect(layer.color).toMatch(/^#[0-9a-f]{6}$/i);
      expect(layer.name!.length).toBeGreaterThan(0);
    }
    expect(new Set(layers.map((l) => l.color)).size).toBe(layers.length);
    expect(new Set(layers.map((l) => l.name)).size).toBe(layers.length);
  });

  it("gives every layer the same seed and its own slice of the same partition", () => {
    const layers = cellFlowRamp.layers!;
    const seeds = new Set(layers.map((l) => l.paramOverrides!.seed));
    expect(seeds.size, "layers disagree on the seed — the partition would drift").toBe(1);
    expect(layers.map((l) => l.paramOverrides!.penIndex)).toEqual([0, 1, 2, 3]);
    for (const layer of layers) {
      expect(layer.paramOverrides!.penCount).toBe(layers.length);
    }
  });

  it("darkens monotonically from the first pen to the last", () => {
    const luma = (hex: string) => {
      const n = parseInt(hex.slice(1), 16);
      return 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255);
    };
    const lumas = cellFlowRamp.layers!.map((l) => luma(l.color!));
    for (let i = 1; i < lumas.length; i++) {
      expect(lumas[i], `layer ${i} is not darker than layer ${i - 1}`).toBeLessThan(lumas[i - 1]);
    }
  });

  it("renders each layer's overrides into a non-empty, partitioning slice", () => {
    const layers = cellFlowRamp.layers!;
    const rendered = layers.map((l) => gen(l.paramOverrides!));
    for (let k = 0; k < layers.length; k++) {
      expect(rendered[k].length, `layer ${k} rendered nothing`).toBeGreaterThan(50);
    }
    const seed = layers[0].paramOverrides!.seed;
    const summed = rendered.reduce((s, r) => s + r.length, 0);
    expect(summed).toBe(gen({ seed }).length);
  });
});
