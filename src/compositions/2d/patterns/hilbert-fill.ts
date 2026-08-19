import { createNoise2D } from "simplex-noise";
import type { Composition2DDefinition, ImageSource } from "../../types";

// Mulberry32 seeded PRNG — deterministic, fast, good distribution
function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Point = { x: number; y: number };

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * Bilinear sample of an ImageSource's row-major brightness grid at unit
 * coordinates (u, v), both in [0, 1]. Returns brightness in [0, 1].
 */
function sampleBrightness(image: ImageSource, u: number, v: number): number {
  const fx = clamp01(u) * (image.width - 1);
  const fy = clamp01(v) * (image.height - 1);
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

/** Spatial frequency of the noise field, in cycles across the unit square. */
const NOISE_SCALE = 3;

const hilbertFill: Composition2DDefinition = {
  id: "hilbertFill",
  name: "Hilbert Fill",
  description:
    "Hilbert space-filling curve with field-driven local subdivision depth — one continuous path that densifies where a noise or image field says to",
  tags: ["pattern", "hilbert", "space-filling", "fractal", "adaptive", "image"],
  category: "2d",
  type: "2d",

  controls: {
    densitySource: {
      type: "select",
      label: "Density Source",
      default: "uniform",
      options: [
        { label: "Uniform", value: "uniform" },
        { label: "Noise", value: "noise" },
        { label: "Image", value: "image" },
      ],
      group: "Density",
    },
    image: {
      type: "image",
      label: "Density Image",
      sampleSize: 256,
      group: "Density",
    },
    contrast: {
      type: "slider",
      label: "Field Contrast",
      default: 1,
      min: 0.2,
      max: 4,
      step: 0.1,
      group: "Density",
    },
    seed: {
      type: "slider",
      label: "Noise Seed",
      default: 1,
      min: 1,
      max: 999,
      step: 1,
      group: "Density",
    },
    minLevel: {
      type: "slider",
      label: "Min Depth",
      default: 2,
      min: 1,
      max: 8,
      step: 1,
      group: "Curve",
    },
    maxLevel: {
      type: "slider",
      label: "Max Depth",
      default: 5,
      min: 1,
      max: 8,
      step: 1,
      group: "Curve",
    },
    margin: {
      type: "slider",
      label: "Margin",
      default: 40,
      min: 10,
      max: 100,
      step: 5,
      group: "Layout",
    },
    rotation: {
      type: "slider",
      label: "Rotation",
      default: 0,
      min: 0,
      max: 360,
      step: 1,
      group: "Layout",
    },
  },

  generate({ width, height, values }) {
    const source = (values.densitySource as string) ?? "uniform";
    // `level` is the pre-adaptive control name, still used by saved presets
    // (cli/feed-push.ts). When present it wins — the control itself is gone,
    // so the UI only ever supplies `maxLevel`.
    const rawMax = (values.level ?? values.maxLevel ?? 5) as number;
    const maxLevel = Math.max(1, Math.min(8, Math.round(rawMax)));
    const minLevel = Math.max(1, Math.min(maxLevel, Math.round((values.minLevel as number) ?? 1)));
    const contrast = Math.max(0.01, (values.contrast as number) ?? 1);
    const seed = Math.round((values.seed as number) ?? 1);
    const margin = values.margin as number;
    const rotationDeg = values.rotation as number;
    const image = (values.image as ImageSource | null) ?? null;

    // ── Density field: (u, v) in the unit square → [0, 1], 1 = subdivide deepest ──
    let rawField: (u: number, v: number) => number;
    if (source === "noise") {
      const noise2D = createNoise2D(mulberry32(seed));
      rawField = (u, v) => (noise2D(u * NOISE_SCALE, v * NOISE_SCALE) + 1) / 2;
    } else if (source === "image" && image && image.width > 0 && image.height > 0) {
      // Darker pixels → deeper subdivision.
      rawField = (u, v) => 1 - sampleBrightness(image, u, v);
    } else {
      // "uniform", and the graceful fallback for image mode with no image
      // loaded: a flat field pinned at max depth reproduces the classic
      // fixed-level Hilbert curve.
      rawField = () => 1;
    }

    const levelSpan = maxLevel - minLevel;

    /** Depth the field asks for at this point, in [minLevel, maxLevel]. */
    function targetDepth(u: number, v: number): number {
      if (levelSpan === 0) return maxLevel;
      const shaped = Math.pow(clamp01(rawField(u, v)), contrast);
      return minLevel + shaped * levelSpan;
    }

    // ── Adaptive Hilbert traversal ──
    //
    // Standard Hilbert recursion carried in unit space, with the square's
    // orientation tracked as two basis vectors (xi, xj) and (yi, yj) instead
    // of a turtle heading. The four child calls are emitted in Hilbert visit
    // order with the usual first/last child swap-and-flip, so the sequence of
    // emitted points is a valid Hilbert traversal at *any* mix of depths.
    //
    // Adaptivity is a per-node stopping rule, not a change of order: a node
    // stops and emits its own centre once its depth meets what the field asks
    // for there (or the max). Consecutive emitted points are then joined in
    // traversal order, so the result stays one continuous polyline — coarse
    // regions simply contribute one long-ish move where a fully subdivided
    // region would contribute four short ones.
    const points: Point[] = [];

    function hilbert(
      x0: number,
      y0: number,
      xi: number,
      xj: number,
      yi: number,
      yj: number,
      depth: number,
    ): void {
      const cx = x0 + (xi + yi) / 2;
      const cy = y0 + (xj + yj) / 2;

      if (depth >= maxLevel || (depth >= minLevel && depth >= targetDepth(cx, cy))) {
        points.push({ x: cx, y: cy });
        return;
      }

      const hxi = xi / 2;
      const hxj = xj / 2;
      const hyi = yi / 2;
      const hyj = yj / 2;
      const next = depth + 1;

      hilbert(x0, y0, hyi, hyj, hxi, hxj, next);
      hilbert(x0 + hxi, y0 + hxj, hxi, hxj, hyi, hyj, next);
      hilbert(x0 + hxi + hyi, y0 + hxj + hyj, hxi, hxj, hyi, hyj, next);
      hilbert(x0 + hxi + yi, y0 + hxj + yj, -hyi, -hyj, -hxi, -hxj, next);
    }

    hilbert(0, 0, 1, 0, 0, 1, 0);

    if (points.length === 0) return [];

    // ── Map the unit square into the canvas ──
    //
    // Scale off the unit square rather than the emitted points' bounding box,
    // so the curve occupies the same frame regardless of how the field
    // distributed depth (and so left/right of centre means the same thing in
    // image space as in canvas space).
    const drawW = Math.max(1, width - margin * 2);
    const drawH = Math.max(1, height - margin * 2);

    const rotRad = (rotationDeg * Math.PI) / 180;
    const cosR = Math.cos(rotRad);
    const sinR = Math.sin(rotRad);

    // A unit square rotated by θ has an axis-aligned extent of |cosθ| + |sinθ|,
    // so shrink by that to keep every point inside the margins at any rotation.
    const rotInflate = Math.abs(cosR) + Math.abs(sinR);
    const size = Math.min(drawW, drawH) / rotInflate;

    const cx = width / 2;
    const cy = height / 2;

    const scaled = points.map((pt) => {
      const nx = (pt.x - 0.5) * size;
      const ny = (pt.y - 0.5) * size;
      return {
        x: cx + nx * cosR - ny * sinR,
        y: cy + nx * sinR + ny * cosR,
      };
    });

    return [scaled];
  },
};

export default hilbertFill;
