import { describe, it, expect } from "vitest";
import { stampGlyphs } from "../operators/glyph-stamp";

function mulberry32(a: number) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const base = {
  width: 400,
  height: 400,
  cols: 10,
  glyph: "square" as const,
  minSize: 4,
  maxSize: 20,
};

function bbox(line: { x: number; y: number }[]) {
  const xs = line.map((p) => p.x);
  const ys = line.map((p) => p.y);
  return { w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
}

describe("stampGlyphs", () => {
  it("emits at most cols*rows glyphs (square region → rows === cols)", () => {
    const out = stampGlyphs({ ...base, field: () => 1 });
    expect(out.length).toBe(100);
    expect(out.length).toBeLessThanOrEqual(base.cols * base.cols);
  });

  it("emits nothing for an all-zero field under a positive threshold", () => {
    const out = stampGlyphs({ ...base, field: () => 0, threshold: 0.5 });
    expect(out).toEqual([]);
  });

  it("threshold suppresses low-field cells", () => {
    const gradient = (nx: number) => nx;
    const all = stampGlyphs({ ...base, field: gradient, threshold: 0 });
    const half = stampGlyphs({ ...base, field: gradient, threshold: 0.5 });
    expect(half.length).toBeLessThan(all.length);
    expect(half.length).toBeGreaterThan(0);
  });

  it("size mapping is monotone in field value", () => {
    const sizes = [0.1, 0.4, 0.9].map((v) => {
      const out = stampGlyphs({ ...base, field: () => v });
      return bbox(out[0]).w;
    });
    expect(sizes[0]).toBeLessThan(sizes[1]);
    expect(sizes[1]).toBeLessThan(sizes[2]);
    // minSize + v*(maxSize-minSize)
    expect(sizes[1]).toBeCloseTo(4 + 0.4 * 16, 6);
  });

  it("clamps out-of-range field values into [minSize, maxSize]", () => {
    const low = stampGlyphs({ ...base, field: () => -3 });
    const high = stampGlyphs({ ...base, field: () => 7 });
    expect(bbox(low[0]).w).toBeCloseTo(base.minSize, 6);
    expect(bbox(high[0]).w).toBeCloseTo(base.maxSize, 6);
  });

  it("is deterministic for a fixed rng seed and varies with jitter", () => {
    const opts = { ...base, field: (nx: number, ny: number) => (nx + ny) / 2, jitter: 5 };
    const a = stampGlyphs({ ...opts, rng: mulberry32(1) });
    const b = stampGlyphs({ ...opts, rng: mulberry32(1) });
    const c = stampGlyphs({ ...opts, rng: mulberry32(2) });
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });

  it("throws when jitter is used without an rng", () => {
    expect(() => stampGlyphs({ ...base, field: () => 1, jitter: 2 })).toThrow(/rng/);
    expect(() => stampGlyphs({ ...base, field: () => 1, rotationJitter: 0.2 })).toThrow(/rng/);
  });

  it("rotationJitter rotates glyphs (square bbox grows past its side length)", () => {
    const straight = stampGlyphs({ ...base, field: () => 1 });
    const rotated = stampGlyphs({
      ...base,
      field: () => 1,
      rotationJitter: Math.PI / 4,
      rng: mulberry32(3),
    });
    const straightMax = Math.max(...straight.map((l) => bbox(l).w));
    const rotatedMax = Math.max(...rotated.map((l) => bbox(l).w));
    expect(rotatedMax).toBeGreaterThan(straightMax);
  });

  it("uses a custom glyph function and passes it the mapped size", () => {
    const seen: number[] = [];
    const out = stampGlyphs({
      ...base,
      field: () => 0.5,
      glyph: (size: number) => {
        seen.push(size);
        return [
          [
            { x: -size / 2, y: 0 },
            { x: size / 2, y: 0 },
          ],
        ];
      },
    });
    expect(out.length).toBe(100);
    expect(out.every((l) => l.length === 2)).toBe(true);
    expect(seen.length).toBe(100);
    expect(seen[0]).toBeCloseTo(4 + 0.5 * 16, 6);
    expect(bbox(out[0]).w).toBeCloseTo(12, 6);
  });

  it("built-in glyph kinds produce closed outlines", () => {
    for (const glyph of ["square", "circle", "triangle"] as const) {
      const out = stampGlyphs({ ...base, cols: 2, glyph, field: () => 1 });
      expect(out.length).toBeGreaterThan(0);
      for (const line of out) {
        expect(line.length).toBeGreaterThanOrEqual(4);
        expect(line[0].x).toBeCloseTo(line[line.length - 1].x, 6);
        expect(line[0].y).toBeCloseTo(line[line.length - 1].y, 6);
      }
    }
  });

  it("derives rows from the region aspect ratio", () => {
    const out = stampGlyphs({ ...base, height: 200, cols: 10, field: () => 1 });
    expect(out.length).toBe(50); // 10 cols x 5 rows
  });

  it("returns nothing for degenerate grids", () => {
    expect(stampGlyphs({ ...base, cols: 0, field: () => 1 })).toEqual([]);
    expect(stampGlyphs({ ...base, width: 0, field: () => 1 })).toEqual([]);
  });
});
