import { describe, it, expect } from "vitest";
import cellFlowGradient, { voronoiCell, type Pt } from "../compositions/2d/generative/cell-flow-gradient";
import { pointInSilhouette } from "../operators/silhouette-knockout";

const W = 800;
const H = 1000;

const defs = Object.fromEntries(
  Object.entries(cellFlowGradient.controls!).map(([k, v]) => [k, v.default]),
) as Record<string, unknown>;

function gen(override: Record<string, unknown> = {}): Pt[][] {
  return cellFlowGradient.generate({ width: W, height: H, values: { ...defs, ...override } });
}

function polylineLength(line: Pt[]): number {
  let total = 0;
  for (let i = 0; i + 1 < line.length; i++) {
    total += Math.hypot(line[i + 1].x - line[i].x, line[i + 1].y - line[i].y);
  }
  return total;
}

function totalInk(lines: Pt[][]): number {
  return lines.reduce((s, l) => s + polylineLength(l), 0);
}

// ── Metadata ────────────────────────────────────────────────────────────────

describe("cell-flow-gradient metadata", () => {
  it("exports valid composition metadata", () => {
    expect(cellFlowGradient.id).toBe("cellFlowGradient");
    expect(cellFlowGradient.name.length).toBeGreaterThan(0);
    expect(cellFlowGradient.description!.length).toBeGreaterThan(0);
    expect(cellFlowGradient.category).toBe("2d");
    expect(cellFlowGradient.type).toBe("2d");
    expect(typeof cellFlowGradient.generate).toBe("function");
    expect(Array.isArray(cellFlowGradient.tags)).toBe(true);
  });

  it("declares the expected controls", () => {
    expect(Object.keys(cellFlowGradient.controls!).sort()).toEqual([
      "cells",
      "cornerRadius",
      "gutter",
      "lineSpacing",
      "margin",
      "outline",
      // Multi-pen slicing — no-ops at their defaults, see cell-flow-ramp.test.ts.
      "penCount",
      "penIndex",
      "phaseVariation",
      "seed",
      "waveAmplitude",
      "waveFrequency",
    ]);
    expect(cellFlowGradient.controls!.outline.type).toBe("toggle");
    for (const [key, ctrl] of Object.entries(cellFlowGradient.controls!)) {
      if (ctrl.type !== "slider") continue;
      expect(ctrl.default, `${key} default below min`).toBeGreaterThanOrEqual(ctrl.min);
      expect(ctrl.default, `${key} default above max`).toBeLessThanOrEqual(ctrl.max);
    }
  });

  it("declares macros that only target real controls", () => {
    for (const macro of Object.values(cellFlowGradient.macros!)) {
      for (const target of macro.targets) {
        expect(Object.keys(cellFlowGradient.controls!)).toContain(target.param);
      }
    }
  });
});

// ── generate() ──────────────────────────────────────────────────────────────

describe("cell-flow-gradient generate()", () => {
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
    const cases = [
      {},
      { margin: 0, cells: 8 },
      { margin: 120 },
      { gutter: 0, cornerRadius: 0 },
      { cells: 40, lineSpacing: 10 },
    ];
    for (const override of cases) {
      const margin = (override.margin as number) ?? (defs.margin as number);
      // Scanned in plain JS and asserted once — a per-point expect() over tens
      // of thousands of vertices costs seconds in harness overhead.
      const stray = gen(override)
        .flat()
        .find(
          (p) =>
            p.x < margin - 1e-6 ||
            p.x > W - margin + 1e-6 ||
            p.y < margin - 1e-6 ||
            p.y > H - margin + 1e-6,
        );
      expect(stray, `${JSON.stringify(override)} escaped the margin box`).toBeUndefined();
    }
  });

  it("is deterministic — identical inputs give identical output", () => {
    expect(gen()).toEqual(gen());
    expect(gen({ seed: 123, cells: 9 })).toEqual(gen({ seed: 123, cells: 9 }));
  });

  it("changes output when the seed changes", () => {
    expect(gen({ seed: 42 })).not.toEqual(gen({ seed: 43 }));
  });

  it("returns nothing when the margin swallows the page", () => {
    expect(gen({ margin: 450 })).toEqual([]);
  });

  it("stays well under the debounce-worthy polyline budget at defaults", () => {
    expect(gen().length).toBeLessThan(50_000);
    expect(cellFlowGradient.renderMode ?? "immediate").toBe("immediate");
  });
});

// ── Controls ────────────────────────────────────────────────────────────────

describe("cell-flow-gradient controls", () => {
  it("the outline toggle adds closed boundary rings", () => {
    const on = gen({ outline: true });
    const off = gen({ outline: false });
    expect(on.length).toBeGreaterThan(off.length);
    // Every extra polyline is a closed ring (first point repeated at the end).
    const closed = on.filter((l) => {
      const a = l[0];
      const b = l[l.length - 1];
      return Math.hypot(a.x - b.x, a.y - b.y) < 1e-9;
    });
    expect(closed.length).toBeGreaterThanOrEqual(on.length - off.length);
  });

  it("a wider gutter leaves more empty page between cells", () => {
    expect(totalInk(gen({ gutter: 40 }))).toBeLessThan(totalInk(gen({ gutter: 4 })));
  });

  it("tighter line spacing puts more ink on the page", () => {
    expect(totalInk(gen({ lineSpacing: 2 }))).toBeGreaterThan(totalInk(gen({ lineSpacing: 8 })));
  });

  it("corner rounding removes area from the cells", () => {
    expect(totalInk(gen({ cornerRadius: 60 }))).toBeLessThan(totalInk(gen({ cornerRadius: 0 })));
  });

  it("more cells means more cell boundaries", () => {
    const rings = (n: number) =>
      gen({ cells: n, outline: true }).filter((l) => {
        const a = l[0];
        const b = l[l.length - 1];
        return Math.hypot(a.x - b.x, a.y - b.y) < 1e-9;
      }).length;
    expect(rings(24)).toBeGreaterThan(rings(6));
  });

  it("zero wave amplitude gives straight vertical lines", () => {
    const lines = gen({ waveAmplitude: 0, outline: false });
    expect(lines.length).toBeGreaterThan(50);
    for (const line of lines) {
      const xs = line.map((p) => p.x);
      expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(1e-6);
    }
  });

  it("wave amplitude bends the fill lines off vertical", () => {
    const lines = gen({ waveAmplitude: 15, outline: false });
    const wobbly = lines.filter((l) => {
      const xs = l.map((p) => p.x);
      return Math.max(...xs) - Math.min(...xs) > 5;
    });
    expect(wobbly.length).toBeGreaterThan(lines.length * 0.2);
  });

  it("emits each cell's fill lines left-to-right so a colour ramp can follow them", () => {
    // Within one cell the runs march rightwards; the check is that the fill's
    // per-cell starting x values are non-decreasing over long stretches.
    const lines = gen({ outline: false, cells: 6, waveAmplitude: 0 });
    let ascending = 0;
    for (let i = 1; i < lines.length; i++) {
      if (lines[i][0].x >= lines[i - 1][0].x - 1e-9) ascending++;
    }
    expect(ascending / (lines.length - 1)).toBeGreaterThan(0.8);
  });
});

// ── voronoiCell ─────────────────────────────────────────────────────────────

describe("voronoiCell", () => {
  const bounds: Pt[] = [
    { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 },
  ];
  const sites: Pt[] = [
    { x: 25, y: 25 }, { x: 75, y: 25 }, { x: 25, y: 75 }, { x: 75, y: 75 },
  ];

  it("gives each site its own quadrant of a symmetric 2×2 layout", () => {
    for (let i = 0; i < sites.length; i++) {
      const cell = voronoiCell(sites, i, bounds);
      // 4 corners, occasionally 5 when a bisector passes exactly through one.
      expect(cell.length).toBeGreaterThanOrEqual(4);
      expect(cell.length).toBeLessThanOrEqual(5);
      const xs = cell.map((p) => p.x);
      const ys = cell.map((p) => p.y);
      expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(50, 6);
      expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(50, 6);
      expect(pointInSilhouette(sites[i], [cell])).toBe(true);
    }
  });

  it("a single site owns the whole bounds", () => {
    expect(voronoiCell([{ x: 50, y: 50 }], 0, bounds)).toEqual(bounds);
  });

  it("contains its own site for a scattered layout", () => {
    const scatter: Pt[] = [
      { x: 10, y: 12 }, { x: 88, y: 20 }, { x: 44, y: 61 }, { x: 70, y: 91 }, { x: 20, y: 80 },
    ];
    for (let i = 0; i < scatter.length; i++) {
      const cell = voronoiCell(scatter, i, bounds);
      expect(cell.length).toBeGreaterThanOrEqual(3);
      expect(pointInSilhouette(scatter[i], [cell]), `site ${i}`).toBe(true);
    }
  });
});
