import { describe, it, expect } from "vitest";
import photoHalftone from "../compositions/2d/generative/photo-halftone";

function defaults(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, c] of Object.entries(photoHalftone.controls!)) {
    out[k] = c.type === "image" ? null : c.default;
  }
  return out;
}

function gen(override: Record<string, unknown>) {
  return photoHalftone.generate!({
    width: 400,
    height: 400,
    values: { ...defaults(), ...override },
  });
}

function makeImage(w: number, h: number, fn: (x: number, y: number) => number) {
  const brightness = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    brightness[y * w + x] = fn(x / (w - 1), y / (h - 1));
  }
  return { brightness, width: w, height: h };
}

describe("photoHalftone image pattern", () => {
  it("flat grey when no image", () => {
    const out = gen({ pattern: "image", image: null });
    expect(out.length).toBeGreaterThan(0);
  });

  it("uniform dark image → larger wave amplitudes than uniform bright image", () => {
    // Amplitude scales with darkness. A uniform dark image should wobble
    // more than a uniform bright image.
    const dark = makeImage(16, 16, () => 0);
    const bright = makeImage(16, 16, () => 1);
    const darkOut = gen({ pattern: "image", image: dark, lineCount: 30, samplesPerLine: 60 });
    const brightOut = gen({ pattern: "image", image: bright, lineCount: 30, samplesPerLine: 60 });
    function totalWobble(lines: Array<Array<{ x: number; y: number }>>): number {
      let s = 0;
      for (const l of lines) {
        const firstY = l[0]?.y ?? 0;
        for (const p of l) s += Math.abs(p.y - firstY);
      }
      return s;
    }
    expect(totalWobble(darkOut)).toBeGreaterThan(totalWobble(brightOut) * 5);
  });

  it("inverting a bright image produces dark-like output", () => {
    const bright = makeImage(16, 16, () => 1);
    const noInvert = gen({ pattern: "image", image: bright, invertImage: false, lineCount: 30 });
    const inverted = gen({ pattern: "image", image: bright, invertImage: true, lineCount: 30 });
    function firstLineSpan(lines: Array<Array<{ x: number; y: number }>>): number {
      const pts = lines[Math.floor(lines.length / 2)] ?? [];
      if (pts.length === 0) return 0;
      const ys = pts.map(p => p.y);
      return Math.max(...ys) - Math.min(...ys);
    }
    // Bright flat → no waves, inverted (= uniform dark) → full waves.
    expect(firstLineSpan(noInvert)).toBeLessThan(firstLineSpan(inverted));
  });
});
