import { describe, it, expect } from "vitest";
import silhouetteField, {
  SILHOUETTE_PATHS,
  buildSilhouetteRings,
} from "../compositions/2d/generative/silhouette-field";
import { pointInSilhouette, ringsFromSVGPath } from "../operators/silhouette-knockout";
import type { ImageSource } from "../compositions/types";

const W = 800;
const H = 800;

function defaults(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, c] of Object.entries(silhouetteField.controls!)) {
    out[k] = c.type === "image" ? null : c.default;
  }
  return out;
}

function gen(override: Record<string, unknown> = {}) {
  return silhouetteField.generate({ width: W, height: H, values: { ...defaults(), ...override } });
}

function makeImage(w: number, h: number, fn: (x: number, y: number) => number): ImageSource {
  const brightness = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) brightness[y * w + x] = fn(x, y);
  }
  return { brightness, width: w, height: h };
}

/** Fraction of emitted points that fall inside the silhouette. */
function insideCounts(lines: { x: number; y: number }[][], values: Record<string, unknown>) {
  const rings = buildSilhouetteRings(values, W, H);
  let inside = 0;
  let outside = 0;
  for (const line of lines) {
    for (const p of line) {
      if (pointInSilhouette(p, rings)) inside++;
      else outside++;
    }
  }
  return { inside, outside };
}

describe("silhouetteField metadata", () => {
  it("has valid 2D composition metadata", () => {
    expect(silhouetteField.id).toBe("silhouetteField");
    expect(silhouetteField.name.length).toBeGreaterThan(0);
    expect(silhouetteField.category).toBe("2d");
    expect(silhouetteField.type).toBe("2d");
    expect(typeof silhouetteField.generate).toBe("function");
  });

  it("declares the expected controls", () => {
    expect(Object.keys(silhouetteField.controls!).sort()).toEqual(
      [
        "silhouette",
        "silhouetteScale",
        "offset",
        "invert",
        "image",
        "threshold",
        "fieldPattern",
        "fieldSpacing",
        "interiorTexture",
        "interiorSpacing",
        "margin",
      ].sort(),
    );
  });

  it("offers every built-in silhouette as a select option, and each parses to a closed ring", () => {
    const options = (silhouetteField.controls!.silhouette as { options: { value: string }[] })
      .options;
    expect(options.length).toBeGreaterThanOrEqual(3);
    expect(options.map((o) => o.value).sort()).toEqual(Object.keys(SILHOUETTE_PATHS).sort());

    for (const [name, d] of Object.entries(SILHOUETTE_PATHS)) {
      const rings = ringsFromSVGPath(d, 24);
      expect(rings.length, name).toBeGreaterThanOrEqual(1);
      for (const ring of rings) {
        expect(ring.length, name).toBeGreaterThanOrEqual(4);
        expect(ring[0], name).toEqual(ring[ring.length - 1]);
      }
      // A known interior probe per shape, in the 100x100 authoring box.
      // (The box center is not interior for the hand — it falls between fingers.)
      const probe = { toad: [50, 60], leaf: [50, 60], hand: [50, 75], moon: [25, 55] }[name]!;
      expect(pointInSilhouette({ x: probe[0], y: probe[1] }, rings), name).toBe(true);
      // ...and a corner of the box is outside every shape.
      expect(pointInSilhouette({ x: 1, y: 1 }, rings), name).toBe(false);
    }
  });

  it("has presets whose keys are all real controls", () => {
    for (const [key, preset] of Object.entries(silhouetteField.suggestedPresets ?? {})) {
      expect(preset.name.length, key).toBeGreaterThan(0);
      for (const ctrl of Object.keys(preset.values.controls ?? {})) {
        expect(silhouetteField.controls![ctrl], `unknown preset control "${ctrl}"`).toBeDefined();
      }
    }
  });
});

describe("silhouetteField generate", () => {
  it("produces non-empty output with defaults", () => {
    const out = gen();
    expect(out.length).toBeGreaterThan(0);
    for (const line of out) expect(line.length).toBeGreaterThanOrEqual(2);
  });

  it("is deterministic for identical values", () => {
    expect(gen()).toEqual(gen());
  });

  it("keeps every point inside the margin box across control combinations", () => {
    const overrides: Record<string, unknown>[] = [
      {},
      { fieldPattern: "horizontal" },
      { fieldPattern: "radial", interiorTexture: "dots" },
      { silhouette: "leaf", silhouetteScale: 1.4, offset: [0.4, -0.4] },
      { silhouette: "hand", interiorTexture: "none" },
      { silhouette: "moon", invert: true },
      { margin: 0, fieldSpacing: 20 },
      { margin: 160, silhouetteScale: 0.1 },
    ];
    for (const override of overrides) {
      const values = { ...defaults(), ...override };
      const margin = values.margin as number;
      const out = silhouetteField.generate({ width: W, height: H, values });
      for (const line of out) {
        for (const p of line) {
          expect(Number.isFinite(p.x) && Number.isFinite(p.y), JSON.stringify(override)).toBe(true);
          expect(p.x).toBeGreaterThanOrEqual(margin - 1e-6);
          expect(p.x).toBeLessThanOrEqual(W - margin + 1e-6);
          expect(p.y).toBeGreaterThanOrEqual(margin - 1e-6);
          expect(p.y).toBeLessThanOrEqual(H - margin + 1e-6);
        }
      }
    }
  });

  it("knocks the silhouette out of the field (nothing inside when interior texture is off)", () => {
    const values = { ...defaults(), interiorTexture: "none" };
    const out = silhouetteField.generate({ width: W, height: H, values });
    const { inside, outside } = insideCounts(out, values);
    expect(outside).toBeGreaterThan(0);
    // Only boundary points land on the silhouette edge; interior stays empty.
    expect(inside / (inside + outside)).toBeLessThan(0.01);
  });

  it("invert flips which region carries the dense field", () => {
    const base = { ...defaults(), interiorTexture: "none" };
    const normal = insideCounts(
      silhouetteField.generate({ width: W, height: H, values: base }),
      base,
    );
    const flipped = { ...base, invert: true };
    const inverted = insideCounts(
      silhouetteField.generate({ width: W, height: H, values: flipped }),
      flipped,
    );

    expect(normal.outside).toBeGreaterThan(normal.inside);
    expect(inverted.inside).toBeGreaterThan(inverted.outside);
    expect(inverted.inside).toBeGreaterThan(normal.inside);
    expect(normal.outside).toBeGreaterThan(inverted.outside);
  });

  it("interior texture adds strokes inside the silhouette", () => {
    const none = { ...defaults(), interiorTexture: "none" };
    const hatch = { ...defaults(), interiorTexture: "hatch" };
    const dots = { ...defaults(), interiorTexture: "dots", interiorSpacing: 30 };
    const inNone = insideCounts(
      silhouetteField.generate({ width: W, height: H, values: none }),
      none,
    );
    const inHatch = insideCounts(
      silhouetteField.generate({ width: W, height: H, values: hatch }),
      hatch,
    );
    const inDots = insideCounts(
      silhouetteField.generate({ width: W, height: H, values: dots }),
      dots,
    );
    expect(inHatch.inside).toBeGreaterThan(inNone.inside);
    expect(inDots.inside).toBeGreaterThan(inNone.inside);
  });

  it("tighter field spacing yields more polylines", () => {
    expect(gen({ fieldSpacing: 6 }).length).toBeGreaterThan(gen({ fieldSpacing: 30 }).length);
  });

  it("derives the silhouette from a loaded image via threshold", () => {
    const disc = makeImage(64, 64, (x, y) => (Math.hypot(x - 32, y - 32) < 20 ? 0 : 1));
    const values = { ...defaults(), image: disc, threshold: 0.5, interiorTexture: "none" };

    const out = silhouetteField.generate({ width: W, height: H, values });
    expect(out.length).toBeGreaterThan(0);

    const rings = buildSilhouetteRings(values, W, H);
    expect(rings.length).toBeGreaterThanOrEqual(1);
    // The image-derived disc is a different mask than the default toad preset.
    expect(out).not.toEqual(gen({ interiorTexture: "none" }));

    const { inside, outside } = insideCounts(out, values);
    expect(outside).toBeGreaterThan(0);
    expect(inside / (inside + outside)).toBeLessThan(0.02);
  });

  it("handles an all-bright image (no rings) without throwing", () => {
    const blank = makeImage(32, 32, () => 1);
    const values = { ...defaults(), image: blank, threshold: 0.5 };
    expect(() => silhouetteField.generate({ width: W, height: H, values })).not.toThrow();
    expect(silhouetteField.generate({ width: W, height: H, values }).length).toBeGreaterThan(0);
  });
});
