import { describe, it, expect } from "vitest";
import strataTriptych, {
  hatchPolygonLines,
  dotGridLines,
  DOT_TICK,
  type Pt,
} from "../compositions/2d/generative/strata-triptych";

const W = 800;
const H = 1000;

const defs = Object.fromEntries(
  Object.entries(strataTriptych.controls!).map(([k, v]) => [k, v.default]),
) as Record<string, unknown>;

function gen(override: Record<string, unknown> = {}) {
  return strataTriptych.generate({ width: W, height: H, values: { ...defs, ...override } });
}

function polylineLength(line: Pt[]): number {
  let total = 0;
  for (let i = 0; i + 1 < line.length; i++) {
    total += Math.hypot(line[i + 1].x - line[i].x, line[i + 1].y - line[i].y);
  }
  return total;
}

/** Count polylines short enough to be dot-grid ticks rather than hatch runs. */
function tinyCount(lines: Pt[][]): number {
  return lines.filter((l) => polylineLength(l) <= DOT_TICK * 1.5).length;
}

/**
 * Group every x coordinate into maximal runs separated by gaps wider than
 * `minGap`. With N panels and a real gutter this must return N clusters.
 */
function xClusters(lines: Pt[][], minGap: number): { lo: number; hi: number }[] {
  const xs = lines.flatMap((l) => l.map((p) => p.x)).sort((a, b) => a - b);
  const clusters: { lo: number; hi: number }[] = [];
  for (const x of xs) {
    const last = clusters[clusters.length - 1];
    if (!last || x - last.hi > minGap) clusters.push({ lo: x, hi: x });
    else last.hi = x;
  }
  return clusters;
}

// ── Metadata ────────────────────────────────────────────────────────────────

describe("strata-triptych metadata", () => {
  it("exports valid composition metadata", () => {
    expect(strataTriptych.id).toBe("strataTriptych");
    expect(strataTriptych.name.length).toBeGreaterThan(0);
    expect(strataTriptych.description!.length).toBeGreaterThan(0);
    expect(strataTriptych.category).toBe("2d");
    expect(strataTriptych.type).toBe("2d");
    expect(typeof strataTriptych.generate).toBe("function");
    expect(Array.isArray(strataTriptych.tags)).toBe(true);
  });

  it("declares the expected controls", () => {
    const keys = Object.keys(strataTriptych.controls!).sort();
    expect(keys).toEqual([
      "angleJitter",
      "dotAccentFraction",
      "facetSplits",
      "faultCount",
      "gapFraction",
      "gutter",
      "hatchSpacingMax",
      "hatchSpacingMin",
      "margin",
      "panelOutlines",
      "panels",
      "seed",
      "strataCount",
      "strataEdges",
    ]);
    for (const key of ["panelOutlines", "strataEdges"]) {
      expect(strataTriptych.controls![key].type).toBe("toggle");
    }
    for (const [key, ctrl] of Object.entries(strataTriptych.controls!)) {
      if (ctrl.type !== "slider") continue;
      expect(ctrl.default, `${key} default below min`).toBeGreaterThanOrEqual(ctrl.min);
      expect(ctrl.default, `${key} default above max`).toBeLessThanOrEqual(ctrl.max);
    }
  });
});

// ── generate() ──────────────────────────────────────────────────────────────

describe("strata-triptych generate()", () => {
  it("returns non-empty, finite polylines at default control values", () => {
    const lines = gen();
    expect(lines.length).toBeGreaterThan(200);
    for (const line of lines) {
      expect(line.length).toBeGreaterThanOrEqual(2);
      for (const pt of line) {
        expect(Number.isFinite(pt.x)).toBe(true);
        expect(Number.isFinite(pt.y)).toBe(true);
      }
    }
  });

  it("keeps every point inside the margin box", () => {
    for (const override of [{}, { margin: 0 }, { margin: 100 }, { panels: 5, gutter: 0 }]) {
      const margin = (override.margin as number) ?? (defs.margin as number);
      const lines = gen(override);
      for (const line of lines) {
        for (const pt of line) {
          expect(pt.x).toBeGreaterThanOrEqual(margin - 1e-6);
          expect(pt.x).toBeLessThanOrEqual(W - margin + 1e-6);
          expect(pt.y).toBeGreaterThanOrEqual(margin - 1e-6);
          expect(pt.y).toBeLessThanOrEqual(H - margin + 1e-6);
        }
      }
    }
  });

  it("is deterministic — identical inputs give identical output", () => {
    expect(gen()).toEqual(gen());
    expect(gen({ seed: 123, strataCount: 11 })).toEqual(gen({ seed: 123, strataCount: 11 }));
  });

  it("changes output when the seed changes", () => {
    expect(gen({ seed: 42 })).not.toEqual(gen({ seed: 43 }));
  });

  it("stays well under the debounce-worthy polyline budget at defaults", () => {
    expect(gen().length).toBeLessThan(50_000);
    expect(strataTriptych.renderMode ?? "immediate").toBe("immediate");
  });
});

// ── Panel structure ─────────────────────────────────────────────────────────

describe("strata-triptych panel structure", () => {
  it("splits geometry into exactly `panels` disjoint x bands separated by gutters", () => {
    const margin = defs.margin as number;
    const gutter = defs.gutter as number;

    for (const panels of [2, 3, 4]) {
      const lines = gen({ panels });
      const clusters = xClusters(lines, gutter * 0.5);
      expect(clusters.length, `panels=${panels}`).toBe(panels);

      const innerW = W - 2 * margin;
      const panelW = (innerW - gutter * (panels - 1)) / panels;
      clusters.forEach((c, i) => {
        const x0 = margin + i * (panelW + gutter);
        expect(c.lo).toBeGreaterThanOrEqual(x0 - 1e-6);
        expect(c.hi).toBeLessThanOrEqual(x0 + panelW + 1e-6);
      });

      // Every gutter interval is empty.
      for (let i = 0; i + 1 < panels; i++) {
        const gLo = margin + i * (panelW + gutter) + panelW;
        const gHi = gLo + gutter;
        const inGutter = lines.some((l) =>
          l.some((p) => p.x > gLo + 1e-6 && p.x < gHi - 1e-6),
        );
        expect(inGutter, `panels=${panels} gutter ${i}`).toBe(false);
      }
    }
  });

  it("panel outlines toggle adds one closed rect per panel", () => {
    const on = gen({ panelOutlines: true }).length;
    const off = gen({ panelOutlines: false }).length;
    expect(on - off).toBe(defs.panels as number);
  });
});

// ── Hatch / dot helpers ─────────────────────────────────────────────────────

const SQUARE: Pt[] = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 100 },
  { x: 0, y: 100 },
];

describe("hatchPolygonLines scanline", () => {
  it("fills a 100px square at 0° with the exact expected line count", () => {
    // Rotated bbox span = 100. Scanlines start at spacing/2 and step by
    // spacing: floor((100 - 5) / 10) + 1 = 10.
    const lines = hatchPolygonLines(SQUARE, 0, 10);
    expect(lines.length).toBe(10);
    for (const [a, b] of lines) {
      expect(a.y).toBeCloseTo(b.y, 9);
      expect(Math.min(a.x, b.x)).toBeCloseTo(0, 9);
      expect(Math.max(a.x, b.x)).toBeCloseTo(100, 9);
    }
    // First scanline sits half a spacing in from the edge.
    expect(lines[0][0].y).toBeCloseTo(5, 9);
    expect(lines[9][0].y).toBeCloseTo(95, 9);
  });

  it("fills the same square at 45° with the exact expected line count", () => {
    // Rotated bbox span = 100 * sqrt(2) = 141.4214.
    // floor((141.4214 - 5) / 10) + 1 = 13 + 1 = 14.
    const span = 100 * Math.SQRT2;
    const expected = Math.floor((span - 5) / 10) + 1;
    expect(expected).toBe(14);
    expect(hatchPolygonLines(SQUARE, Math.PI / 4, 10).length).toBe(14);
  });

  it("halving the spacing roughly doubles the line count", () => {
    expect(hatchPolygonLines(SQUARE, 0, 5).length).toBe(20);
    expect(hatchPolygonLines(SQUARE, 0, 2).length).toBe(50);
  });

  it("returns nothing for degenerate input", () => {
    expect(hatchPolygonLines(SQUARE, 0, 0)).toEqual([]);
    expect(hatchPolygonLines([{ x: 0, y: 0 }, { x: 1, y: 1 }], 0, 5)).toEqual([]);
    expect(hatchPolygonLines(SQUARE, 0, 400)).toEqual([]);
  });

  it("splits a concave polygon into several runs on one scanline", () => {
    // Squared-off U opening downward — a horizontal scanline through the
    // notch must produce two separate segments.
    const u: Pt[] = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 70, y: 100 },
      { x: 70, y: 40 },
      { x: 30, y: 40 },
      { x: 30, y: 100 },
      { x: 0, y: 100 },
    ];
    const lines = hatchPolygonLines(u, 0, 10);
    const atY75 = lines.filter((l) => Math.abs(l[0].y - 75) < 1e-6);
    expect(atY75.length).toBe(2);
  });
});

describe("dotGridLines", () => {
  it("emits a lattice of short ticks inside the polygon", () => {
    const dots = dotGridLines(SQUARE, 10);
    expect(dots.length).toBe(100); // 10 x 10 lattice
    for (const d of dots) {
      expect(d.length).toBe(2);
      expect(polylineLength(d)).toBeCloseTo(DOT_TICK, 9);
    }
  });
});

// ── Texture-mix controls ────────────────────────────────────────────────────

describe("strata-triptych texture mix", () => {
  it("dot-accent fraction increases the count of tick-sized polylines", () => {
    const none = tinyCount(gen({ dotAccentFraction: 0 }));
    const many = tinyCount(gen({ dotAccentFraction: 0.4 }));
    expect(many).toBeGreaterThan(none);
  });

  it("gap fraction 0.5 emits fewer polylines and less ink than gap fraction 0", () => {
    // Dot accents off: one dot facet contributes hundreds of ticks, which
    // would swamp the hatch-coverage signal this test is about.
    for (const seed of [0, 7, 42, 301, 999]) {
      const none = gen({ gapFraction: 0, dotAccentFraction: 0, seed });
      const many = gen({ gapFraction: 0.5, dotAccentFraction: 0, seed });
      expect(many.length, `seed ${seed} count`).toBeLessThan(none.length);
      const inkNone = none.reduce((s, l) => s + polylineLength(l), 0);
      const inkMany = many.reduce((s, l) => s + polylineLength(l), 0);
      expect(inkMany, `seed ${seed} ink`).toBeLessThan(inkNone);
    }
  });

  it("stratum edges toggle adds boundary polylines", () => {
    expect(gen({ strataEdges: true }).length).toBeGreaterThan(
      gen({ strataEdges: false }).length,
    );
  });
});
