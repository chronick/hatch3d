import { describe, it, expect } from "vitest";
import glyphDensityField from "../compositions/2d/generative/glyph-density-field";
import type { ImageSource } from "../compositions/types";

const W = 800;
const H = 800;

function defaults(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, c] of Object.entries(glyphDensityField.controls!)) {
    out[k] = c.type === "image" ? null : c.default;
  }
  return out;
}

function gen(override: Record<string, unknown> = {}) {
  return glyphDensityField.generate({
    width: W,
    height: H,
    values: { ...defaults(), ...override },
  });
}

function makeImage(w: number, h: number, fn: (x: number, y: number) => number): ImageSource {
  const brightness = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) brightness[y * w + x] = fn(x / (w - 1), y / (h - 1));
  }
  return { brightness, width: w, height: h };
}

describe("glyphDensityField metadata", () => {
  it("has valid 2D composition metadata", () => {
    expect(glyphDensityField.id).toBe("glyphDensityField");
    expect(glyphDensityField.name.length).toBeGreaterThan(0);
    expect(glyphDensityField.category).toBe("2d");
    expect(glyphDensityField.type).toBe("2d");
    expect(typeof glyphDensityField.generate).toBe("function");
  });

  it("declares the expected controls", () => {
    const keys = Object.keys(glyphDensityField.controls!).sort();
    expect(keys).toEqual(
      [
        "columns",
        "fieldSource",
        "glyph",
        "image",
        "jitter",
        "margin",
        "maxSize",
        "minSize",
        "noiseScale",
        "seed",
        "threshold",
      ].sort(),
    );
  });

  it("has a noiseAndSquares preset whose keys are all real controls", () => {
    const preset = glyphDensityField.suggestedPresets?.noiseAndSquares;
    expect(preset).toBeDefined();
    expect(preset!.name.length).toBeGreaterThan(0);
    const controls = preset!.values.controls!;
    expect(controls.glyph).toBe("square");
    expect(controls.fieldSource).toBe("noise");
    for (const key of Object.keys(controls)) {
      expect(glyphDensityField.controls![key], `unknown preset control "${key}"`).toBeDefined();
    }
  });

  it("preset sizes make mid-field glyphs overlap their neighbours by 30-60%", () => {
    const c = glyphDensityField.suggestedPresets!.noiseAndSquares.values.controls! as Record<
      string,
      number
    >;
    const pad = c.margin + c.maxSize / 2;
    const cell = (W - pad * 2) / c.columns;
    const midSize = c.minSize + 0.5 * (c.maxSize - c.minSize);
    const overlap = (midSize - cell) / cell;
    expect(overlap).toBeGreaterThan(0.3);
    expect(overlap).toBeLessThan(0.6);
  });
});

describe("glyphDensityField generate", () => {
  it("produces non-empty output with defaults", () => {
    const out = gen();
    expect(out.length).toBeGreaterThan(0);
    for (const line of out) expect(line.length).toBeGreaterThanOrEqual(2);
  });

  it("keeps all points inside the margin box", () => {
    for (const override of [
      {},
      { glyph: "circle" },
      { glyph: "triangle" },
      { fieldSource: "radial", threshold: 0 },
      { jitter: 20, maxSize: 120, columns: 60 },
      { margin: 0 },
    ]) {
      const values = { ...defaults(), ...override };
      const margin = values.margin as number;
      const out = gen(override);
      for (const line of out) {
        for (const p of line) {
          expect(p.x).toBeGreaterThanOrEqual(margin - 1e-9);
          expect(p.x).toBeLessThanOrEqual(W - margin + 1e-9);
          expect(p.y).toBeGreaterThanOrEqual(margin - 1e-9);
          expect(p.y).toBeLessThanOrEqual(H - margin + 1e-9);
        }
      }
    }
  });

  it("is deterministic for identical values", () => {
    expect(gen()).toEqual(gen());
  });

  it("changing the seed changes the output", () => {
    expect(gen({ seed: 1 })).not.toEqual(gen({ seed: 2 }));
  });

  it("raising the threshold yields fewer polylines", () => {
    const low = gen({ threshold: 0.1 });
    const high = gen({ threshold: 0.6 });
    expect(high.length).toBeLessThan(low.length);
  });

  it("more columns yields more polylines", () => {
    expect(gen({ columns: 40, threshold: 0 }).length).toBeGreaterThan(
      gen({ columns: 12, threshold: 0 }).length,
    );
  });

  it("radial field is densest at the center", () => {
    const out = gen({ fieldSource: "radial", threshold: 0, jitter: 0 });
    const span = (line: { x: number; y: number }[]) =>
      Math.max(...line.map((p) => p.x)) - Math.min(...line.map((p) => p.x));
    const dist = (line: { x: number; y: number }[]) => {
      const cx = line.reduce((s, p) => s + p.x, 0) / line.length;
      const cy = line.reduce((s, p) => s + p.y, 0) / line.length;
      return Math.hypot(cx - W / 2, cy - H / 2);
    };
    const sorted = [...out].sort((a, b) => dist(a) - dist(b));
    expect(span(sorted[0])).toBeGreaterThan(span(sorted[sorted.length - 1]));
  });

  it("image field drives glyph size, and falls back to noise when no image is loaded", () => {
    const bright = makeImage(32, 32, () => 1);
    const dark = makeImage(32, 32, () => 0);
    const brightOut = gen({ fieldSource: "image", image: bright, threshold: 0, jitter: 0 });
    const darkOut = gen({ fieldSource: "image", image: dark, threshold: 0, jitter: 0 });
    const width0 = (lines: { x: number; y: number }[][]) =>
      Math.max(...lines[0].map((p) => p.x)) - Math.min(...lines[0].map((p) => p.x));
    expect(width0(brightOut)).toBeGreaterThan(width0(darkOut));

    // No image → noise fallback, identical to fieldSource "noise".
    expect(gen({ fieldSource: "image", image: null })).toEqual(gen({ fieldSource: "noise" }));
  });
});
