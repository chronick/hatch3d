import { describe, it, expect } from "vitest";
import starTilingOrnament from "../compositions/2d/patterns/star-tiling-ornament";

const W = 800;
const H = 800;

const defs = Object.fromEntries(
  Object.entries(starTilingOrnament.controls!).map(([k, v]) => [k, v.default]),
) as Record<string, unknown>;

function gen(override: Record<string, unknown> = {}) {
  return starTilingOrnament.generate({
    width: W,
    height: H,
    values: { ...defs, ...override },
  });
}

describe("star-tiling-ornament metadata", () => {
  it("exports valid composition metadata", () => {
    expect(starTilingOrnament.id).toBe("starTilingOrnament");
    expect(starTilingOrnament.name.length).toBeGreaterThan(0);
    expect(starTilingOrnament.category).toBe("2d");
    expect(starTilingOrnament.type).toBe("2d");
    expect(typeof starTilingOrnament.generate).toBe("function");
    expect(Array.isArray(starTilingOrnament.tags)).toBe(true);
  });

  it("declares the expected controls", () => {
    const keys = Object.keys(starTilingOrnament.controls!).sort();
    expect(keys).toEqual([
      "margin",
      "ornamentDensity",
      "ornamentFalloff",
      "tileEdges",
      "tileSize",
    ]);
    expect(starTilingOrnament.controls!.tileEdges.type).toBe("toggle");
    for (const key of ["tileSize", "ornamentDensity", "ornamentFalloff", "margin"]) {
      expect(starTilingOrnament.controls![key].type).toBe("slider");
    }
  });
});

describe("star-tiling-ornament generate()", () => {
  it("returns non-empty polylines at default control values", () => {
    const lines = gen();
    expect(Array.isArray(lines)).toBe(true);
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line.length).toBeGreaterThanOrEqual(2);
      for (const pt of line) {
        expect(Number.isFinite(pt.x)).toBe(true);
        expect(Number.isFinite(pt.y)).toBe(true);
      }
    }
  });

  it("keeps every point inside the canvas", () => {
    for (const override of [
      {},
      { margin: 0 },
      { tileSize: 40 },
      { tileSize: 320, margin: 120 },
      { tileEdges: false },
    ]) {
      const lines = gen(override);
      for (const line of lines) {
        for (const pt of line) {
          expect(pt.x).toBeGreaterThanOrEqual(-1e-6);
          expect(pt.x).toBeLessThanOrEqual(W + 1e-6);
          expect(pt.y).toBeGreaterThanOrEqual(-1e-6);
          expect(pt.y).toBeLessThanOrEqual(H + 1e-6);
        }
      }
    }
  });

  it("respects the margin", () => {
    const margin = 60;
    const lines = gen({ margin });
    for (const line of lines) {
      for (const pt of line) {
        expect(pt.x).toBeGreaterThanOrEqual(margin - 1e-6);
        expect(pt.x).toBeLessThanOrEqual(W - margin + 1e-6);
        expect(pt.y).toBeGreaterThanOrEqual(margin - 1e-6);
        expect(pt.y).toBeLessThanOrEqual(H - margin + 1e-6);
      }
    }
  });

  it("is deterministic — identical inputs give identical output", () => {
    expect(gen()).toEqual(gen());
    expect(gen({ tileSize: 90, ornamentFalloff: 3.1 })).toEqual(
      gen({ tileSize: 90, ornamentFalloff: 3.1 }),
    );
  });

  it("increases line count monotonically with ornament density", () => {
    const counts = [2, 6, 14, 30, 60].map((ornamentDensity) => gen({ ornamentDensity }).length);
    for (let i = 1; i < counts.length; i++) {
      expect(counts[i]).toBeGreaterThan(counts[i - 1]);
    }
  });

  it("ornament falloff changes the geometry without changing line count", () => {
    const flat = gen({ ornamentFalloff: 1 });
    const peaked = gen({ ornamentFalloff: 5 });
    expect(peaked.length).toBe(flat.length);
    expect(peaked).not.toEqual(flat);
  });

  it("tile boundaries toggle adds outline polylines", () => {
    expect(gen({ tileEdges: true }).length).toBeGreaterThan(gen({ tileEdges: false }).length);
  });
});
