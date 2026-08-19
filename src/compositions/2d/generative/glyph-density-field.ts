import { createNoise2D } from "simplex-noise";
import type { Composition2DDefinition, ImageSource } from "../../types";
import { stampGlyphs, type GlyphKind } from "../../../operators/glyph-stamp";

// ── Seeded PRNG (mulberry32) — file-local copy, see perlin-worms.ts ──

function mulberry32(a: number) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Bilinear brightness sample of an ImageSource at normalized (nx, ny). */
function sampleImage(image: ImageSource, nx: number, ny: number): number {
  const fx = Math.min(1, Math.max(0, nx)) * (image.width - 1);
  const fy = Math.min(1, Math.max(0, ny)) * (image.height - 1);
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = Math.min(image.width - 1, x0 + 1);
  const y1 = Math.min(image.height - 1, y0 + 1);
  const tx = fx - x0;
  const ty = fy - y0;
  const b00 = image.brightness[y0 * image.width + x0];
  const b10 = image.brightness[y0 * image.width + x1];
  const b01 = image.brightness[y1 * image.width + x0];
  const b11 = image.brightness[y1 * image.width + x1];
  const b0 = b00 * (1 - tx) + b10 * tx;
  const b1 = b01 * (1 - tx) + b11 * tx;
  return b0 * (1 - ty) + b1 * ty;
}

const glyphDensityField: Composition2DDefinition = {
  id: "glyphDensityField",
  name: "Glyph Density Field",
  description:
    "Grid of glyph outlines scaled by a smooth scalar field — dense regions overlap into organic blobs, sparse regions decay to dots",
  tags: ["generative", "grid", "noise", "glyph", "density", "image"],
  category: "2d",
  type: "2d",

  suggestedPresets: {
    noiseAndSquares: {
      name: "Noise and Squares",
      description:
        "Square outlines on a smooth noise field, sized so mid-field glyphs overlap their neighbours by ~50%",
      values: {
        controls: {
          glyph: "square",
          columns: 34,
          fieldSource: "noise",
          noiseScale: 2.6,
          minSize: 3,
          maxSize: 52,
          jitter: 1.5,
          threshold: 0.28,
          seed: 7,
          margin: 40,
        },
      },
    },
  },

  controls: {
    glyph: {
      type: "select",
      label: "Glyph",
      default: "square",
      options: [
        { label: "Square", value: "square" },
        { label: "Circle", value: "circle" },
        { label: "Triangle", value: "triangle" },
      ],
      group: "Glyph",
    },
    columns: {
      type: "slider",
      label: "Columns",
      default: 28,
      min: 4,
      max: 120,
      step: 1,
      group: "Grid",
    },
    fieldSource: {
      type: "select",
      label: "Field Source",
      default: "noise",
      options: [
        { label: "Noise", value: "noise" },
        { label: "Radial", value: "radial" },
        { label: "Image", value: "image" },
      ],
      group: "Field",
    },
    image: {
      type: "image",
      label: "Image",
      sampleSize: 256,
      group: "Field",
    },
    noiseScale: {
      type: "slider",
      label: "Noise Scale",
      default: 2.5,
      min: 0.5,
      max: 12,
      step: 0.1,
      group: "Field",
    },
    minSize: {
      type: "slider",
      label: "Min Glyph Size",
      default: 2,
      min: 0,
      max: 40,
      step: 0.5,
      group: "Glyph",
    },
    maxSize: {
      type: "slider",
      label: "Max Glyph Size",
      default: 40,
      min: 2,
      max: 120,
      step: 1,
      group: "Glyph",
    },
    jitter: {
      type: "slider",
      label: "Jitter",
      default: 1,
      min: 0,
      max: 20,
      step: 0.5,
      group: "Glyph",
    },
    threshold: {
      type: "slider",
      label: "Threshold",
      default: 0.2,
      min: 0,
      max: 1,
      step: 0.01,
      group: "Field",
    },
    seed: {
      type: "slider",
      label: "Seed",
      default: 42,
      min: 0,
      max: 999,
      step: 1,
      group: "Structure",
    },
    margin: {
      type: "slider",
      label: "Margin",
      default: 40,
      min: 0,
      max: 120,
      step: 5,
      group: "Layout",
    },
  },

  generate({ width, height, values }) {
    const glyph = (values.glyph as GlyphKind) ?? "square";
    const columns = Math.max(1, Math.round(values.columns as number));
    const fieldSource = values.fieldSource as string;
    const noiseScale = values.noiseScale as number;
    const minSize = values.minSize as number;
    const rawMax = values.maxSize as number;
    const maxSize = Math.max(minSize, rawMax);
    const jitter = values.jitter as number;
    const threshold = values.threshold as number;
    const seed = Math.round(values.seed as number);
    const margin = values.margin as number;
    const image = (values.image as ImageSource | null) ?? null;

    // Two independent streams so field construction never shifts the
    // jitter sequence (deterministic per values either way).
    const fieldRng = mulberry32(seed);
    const jitterRng = mulberry32(seed ^ 0x9e3779b9);
    const noise2D = createNoise2D(() => fieldRng());

    const useImage = fieldSource === "image" && image !== null;

    const field = (nx: number, ny: number): number => {
      if (useImage) return sampleImage(image!, nx, ny);
      if (fieldSource === "radial") {
        const dx = nx - 0.5;
        const dy = ny - 0.5;
        // 1 at the center, 0 at the corners.
        const d = Math.hypot(dx, dy) / Math.SQRT1_2;
        return 1 - Math.min(1, d);
      }
      // "noise" — also the fallback when the image slot is empty.
      return (noise2D(nx * noiseScale, ny * noiseScale) + 1) * 0.5;
    };

    // Inset the stamp region so full-size glyphs sit inside the margin.
    const pad = margin + maxSize / 2;
    const regionW = width - pad * 2;
    const regionH = height - pad * 2;
    if (regionW <= 0 || regionH <= 0) return [];

    const stamped = stampGlyphs({
      width: regionW,
      height: regionH,
      cols: columns,
      glyph,
      field,
      minSize,
      maxSize,
      jitter,
      rng: jitterRng,
      threshold,
    });

    // Translate into canvas space and clamp to the margin box — rotation
    // and jitter can push a corner past the inset, so clip there.
    const xMin = margin;
    const yMin = margin;
    const xMax = Math.max(margin, width - margin);
    const yMax = Math.max(margin, height - margin);

    return stamped.map((line) =>
      line.map((p) => ({
        x: Math.min(xMax, Math.max(xMin, p.x + pad)),
        y: Math.min(yMax, Math.max(yMin, p.y + pad)),
      })),
    );
  },
};

export default glyphDensityField;
