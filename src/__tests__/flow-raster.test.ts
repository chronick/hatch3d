import { describe, it, expect } from "vitest";
import flowRaster from "../compositions/2d/generative/flow-raster";
import type { ImageSource } from "../compositions/types";

const W = 800;
const H = 800;

type Pt = { x: number; y: number };

function defaults(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, c] of Object.entries(flowRaster.controls!)) {
    out[k] = c.type === "image" ? null : c.default;
  }
  return out;
}

function gen(override: Record<string, unknown> = {}): Pt[][] {
  return flowRaster.generate({
    width: W,
    height: H,
    values: { ...defaults(), ...override },
  });
}

function makeImage(w: number, h: number, fn: (u: number, v: number) => number): ImageSource {
  const brightness = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      brightness[y * w + x] = fn(x / (w - 1), y / (h - 1));
    }
  }
  return { brightness, width: w, height: h };
}

function totalLength(lines: Pt[][]): number {
  let sum = 0;
  for (const l of lines) {
    for (let i = 1; i < l.length; i++) {
      sum += Math.hypot(l[i].x - l[i - 1].x, l[i].y - l[i - 1].y);
    }
  }
  return sum;
}

/** Total polyline length attributed to the top half vs bottom half of the canvas. */
function lengthByHalf(lines: Pt[][]): { top: number; bottom: number } {
  let top = 0;
  let bottom = 0;
  for (const l of lines) {
    for (let i = 1; i < l.length; i++) {
      const seg = Math.hypot(l[i].x - l[i - 1].x, l[i].y - l[i - 1].y);
      const midY = (l[i].y + l[i - 1].y) * 0.5;
      if (midY < H / 2) top += seg;
      else bottom += seg;
    }
  }
  return { top, bottom };
}

function totalPoints(lines: Pt[][]): number {
  return lines.reduce((s, l) => s + l.length, 0);
}

describe("flowRaster metadata", () => {
  it("has valid 2D composition metadata", () => {
    expect(flowRaster.id).toBe("flowRaster");
    expect(flowRaster.name.length).toBeGreaterThan(0);
    expect(flowRaster.description!.length).toBeGreaterThan(0);
    expect(flowRaster.category).toBe("2d");
    expect(flowRaster.type).toBe("2d");
    expect(typeof flowRaster.generate).toBe("function");
  });

  it("declares the expected controls", () => {
    const keys = Object.keys(flowRaster.controls!).sort();
    expect(keys).toEqual(
      [
        "crosshatch",
        "crosshatchAngle",
        "crosshatchThreshold",
        "darknessRange",
        "image",
        "lineSpacing",
        "margin",
        "maxLine",
        "minLine",
        "seed",
        "smoothing",
        "stepSize",
        "tonalCutoff",
      ].sort(),
    );
    expect(flowRaster.controls!.image.type).toBe("image");
    const img = flowRaster.controls!.image as { sampleSize?: number };
    expect(img.sampleSize).toBeGreaterThanOrEqual(192);
    expect(img.sampleSize).toBeLessThanOrEqual(256);
    expect(flowRaster.controls!.crosshatch.type).toBe("toggle");
  });

  it("mentions the noise fallback in its description", () => {
    expect(flowRaster.description!.toLowerCase()).toMatch(/fbm|noise/);
  });
});

describe("flowRaster no-image fallback", () => {
  it("generates non-empty structured output from the fbm field", () => {
    const out = gen();
    expect(out.length).toBeGreaterThan(20);
    for (const line of out) expect(line.length).toBeGreaterThanOrEqual(2);
    expect(totalLength(out)).toBeGreaterThan(1000);
  });

  it("is deterministic for identical values", () => {
    expect(gen()).toEqual(gen());
  });

  it("keeps all points inside the margin box", () => {
    for (const override of [
      {},
      { margin: 0 },
      { margin: 80 },
      { lineSpacing: 3, stepSize: 0.5 },
      { crosshatch: true, crosshatchThreshold: 0.6 },
      { smoothing: 0 },
      { smoothing: 10, darknessRange: 6 },
    ]) {
      const values = { ...defaults(), ...override };
      const margin = values.margin as number;
      const out = gen(override);
      // Aggregate the extremes so this stays one assertion per override
      // rather than one per point (there can be >100k points).
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      let nonFinite = 0;
      for (const line of out) {
        for (const p of line) {
          if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) {
            nonFinite++;
            continue;
          }
          if (p.x < minX) minX = p.x;
          if (p.x > maxX) maxX = p.x;
          if (p.y < minY) minY = p.y;
          if (p.y > maxY) maxY = p.y;
        }
      }
      const label = JSON.stringify(override);
      expect(nonFinite, label).toBe(0);
      expect(out.length, label).toBeGreaterThan(0);
      expect(minX, label).toBeGreaterThanOrEqual(margin - 1e-9);
      expect(maxX, label).toBeLessThanOrEqual(W - margin + 1e-9);
      expect(minY, label).toBeGreaterThanOrEqual(margin - 1e-9);
      expect(maxY, label).toBeLessThanOrEqual(H - margin + 1e-9);
    }
  }, 20000);

  it("caps total emitted points", () => {
    const out = gen({ lineSpacing: 2, stepSize: 0.5, darknessRange: 6 });
    expect(totalPoints(out)).toBeLessThan(200_000);
  });

  it("changing the seed changes the output", () => {
    expect(gen({ seed: 1 })).not.toEqual(gen({ seed: 2 }));
  });
});

describe("flowRaster density follows luminance", () => {
  // Vertical ramp: dark at the top (v=0), bright at the bottom (v=1).
  const ramp = makeImage(128, 128, (_u, v) => v);

  it("the darker half receives measurably more polyline length", () => {
    const out = gen({ image: ramp });
    expect(out.length).toBeGreaterThan(0);
    const { top, bottom } = lengthByHalf(out);
    expect(top).toBeGreaterThan(bottom * 1.3);
  });

  it("a higher darkness range packs more line into the image", () => {
    const flat = gen({ image: ramp, darknessRange: 0 });
    const steep = gen({ image: ramp, darknessRange: 5 });
    expect(totalLength(steep)).toBeGreaterThan(totalLength(flat));
  });

  it("strokes follow iso-brightness contours (horizontal on a vertical ramp)", () => {
    const out = gen({ image: ramp, minLine: 40 });
    expect(out.length).toBeGreaterThan(0);
    let horizontal = 0;
    let vertical = 0;
    for (const l of out) {
      for (let i = 1; i < l.length; i++) {
        horizontal += Math.abs(l[i].x - l[i - 1].x);
        vertical += Math.abs(l[i].y - l[i - 1].y);
      }
    }
    expect(horizontal).toBeGreaterThan(vertical * 5);
  });

  it("tonalCutoff = 0 yields (near-)empty output", () => {
    const out = gen({ image: ramp, tonalCutoff: 0 });
    expect(totalPoints(out)).toBeLessThanOrEqual(2);
  });

  it("tonalCutoff = 0 on the noise fallback yields (near-)empty output", () => {
    const out = gen({ tonalCutoff: 0 });
    expect(totalPoints(out)).toBeLessThanOrEqual(2);
  });

  it("lowering tonalCutoff removes strokes from the light end", () => {
    const wide = gen({ image: ramp, tonalCutoff: 1 });
    const narrow = gen({ image: ramp, tonalCutoff: 0.4 });
    expect(totalLength(narrow)).toBeLessThan(totalLength(wide));
  });
});

describe("flowRaster crosshatch pass", () => {
  const midDark = makeImage(64, 64, () => 0.18);

  it("enabling crosshatch adds polylines in the darkest band", () => {
    const off = gen({ image: midDark, crosshatch: false });
    const on = gen({ image: midDark, crosshatch: true, crosshatchThreshold: 0.25 });
    expect(off.length).toBeGreaterThan(0);
    expect(on.length).toBeGreaterThan(off.length);
    expect(totalLength(on)).toBeGreaterThan(totalLength(off));
  });

  it("crosshatch strokes run at an angle to the base pass", () => {
    const on = gen({ image: midDark, crosshatch: true, crosshatchThreshold: 0.25 });
    // Base strokes on a flat field are horizontal; the crosshatch layer is
    // rotated by crosshatchAngle, so vertical travel must appear.
    let vertical = 0;
    for (const l of on) {
      for (let i = 1; i < l.length; i++) vertical += Math.abs(l[i].y - l[i - 1].y);
    }
    expect(vertical).toBeGreaterThan(100);
  });

  it("crosshatch output stays deterministic", () => {
    const a = gen({ image: midDark, crosshatch: true });
    const b = gen({ image: midDark, crosshatch: true });
    expect(a).toEqual(b);
  });
});

describe("flowRaster performance", () => {
  it("renders defaults in well under 3s", () => {
    const t = Date.now();
    gen();
    expect(Date.now() - t).toBeLessThan(3000);
  });
});
