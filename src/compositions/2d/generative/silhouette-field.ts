import type { Composition2DDefinition, ImageSource } from "../../types";
import { clipPolylineToRect } from "../../../utils/clip";
import {
  clipPolylinesToSilhouette,
  ringsFromSVGPath,
  ringsFromThreshold,
  type Polyline,
} from "../../../operators/silhouette-knockout";

/**
 * silhouette-field — a page-filling texture with a shape knocked out of it.
 *
 * Reference look: r/PlotterArt "The Toad" — the whole sheet is concentric
 * circles, and the subject exists purely as the hole where the circles stop.
 * The interior can carry a second, much sparser texture so the shape reads
 * as an object rather than a void.
 *
 * The built-in silhouettes below are hand-authored path data in a 100x100
 * box (y down), which the generator scales and offsets onto the canvas.
 * Loading an image switches the silhouette source to a marching-squares
 * contour of its dark regions, which is how arbitrary shapes get in without
 * an SVG-upload control type.
 *
 * Fully deterministic — no randomness anywhere.
 */

/** Hand-authored closed shapes in a 100x100 box, y down. */
export const SILHOUETTE_PATHS: Record<string, string> = {
  // Squat wide frog body with two eye bumps rising off a flat brow line,
  // split by a sharp V-notch at the midline.
  toad:
    "M 4 66 C 4 54 14 45 26 42 C 24 24 30 10 40 10 C 47 12 49 28 50 42 " +
    "C 51 28 53 12 60 10 C 70 10 76 24 74 42 C 86 45 96 54 96 66 " +
    "C 96 82 76 92 50 92 C 24 92 4 82 4 66 Z",

  // Pointed leaf / shield, widest below center.
  leaf:
    "M 50 6 C 74 22 86 44 86 60 C 86 80 70 94 50 94 " +
    "C 30 94 14 80 14 60 C 14 44 26 22 50 6 Z",

  // Blocky open hand: four fingers plus a thumb wedge on the left.
  hand:
    "M 30 94 L 30 78 L 16 72 L 12 62 L 18 56 L 30 62 L 31 52 " +
    "L 31 26 L 39 26 L 39 52 L 41 52 L 41 18 L 49 18 L 49 52 " +
    "L 51 52 L 51 24 L 59 24 L 59 52 L 61 52 L 61 34 L 69 34 L 69 52 " +
    "L 72 56 L 72 94 Z",

  // Crescent moon: outer arc out, inner arc back.
  moon:
    "M 62 8 C 34 12 14 33 14 58 C 14 82 34 94 58 94 " +
    "C 46 84 40 70 40 52 C 40 32 48 16 62 8 Z",
};

const CURVE_SAMPLES = 24;

/** Silhouette rings in canvas pixel space, from either the image or a preset. */
export function buildSilhouetteRings(
  values: Record<string, unknown>,
  width: number,
  height: number,
): Polyline[] {
  const margin = (values.margin as number) ?? 0;
  const scale = (values.silhouetteScale as number) ?? 0.6;
  const offset = (values.offset as [number, number]) ?? [0, 0];
  const image = (values.image as ImageSource | null) ?? null;
  const threshold = (values.threshold as number) ?? 0.5;

  // Both sources produce rings in the same 100x100 authoring box, so the
  // scale/offset transform below is shared.
  const local: Polyline[] = image
    ? ringsFromThreshold(image, threshold, 100, 100)
    : ringsFromSVGPath(
        SILHOUETTE_PATHS[values.silhouette as string] ?? SILHOUETTE_PATHS.toad,
        CURVE_SAMPLES,
      );

  const innerW = Math.max(1, width - margin * 2);
  const innerH = Math.max(1, height - margin * 2);
  const s = (Math.min(innerW, innerH) * scale) / 100;
  const cx = width / 2 + offset[0] * innerW;
  const cy = height / 2 + offset[1] * innerH;

  return local.map((ring) => ring.map((p) => ({ x: cx + (p.x - 50) * s, y: cy + (p.y - 50) * s })));
}

function bbox(rings: Polyline[]) {
  let xMin = Infinity, yMin = Infinity, xMax = -Infinity, yMax = -Infinity;
  for (const ring of rings) {
    for (const p of ring) {
      if (p.x < xMin) xMin = p.x;
      if (p.x > xMax) xMax = p.x;
      if (p.y < yMin) yMin = p.y;
      if (p.y > yMax) yMax = p.y;
    }
  }
  if (!Number.isFinite(xMin)) return null;
  return { xMin, yMin, xMax, yMax };
}

/** Page-filling background texture, centered on the canvas. */
function buildField(
  pattern: string,
  spacing: number,
  width: number,
  height: number,
  margin: number,
): Polyline[] {
  const cx = width / 2;
  const cy = height / 2;
  const step = Math.max(2, spacing);
  const out: Polyline[] = [];

  if (pattern === "horizontal") {
    for (let y = margin; y <= height - margin + 1e-9; y += step) {
      out.push([{ x: margin, y }, { x: width - margin, y }]);
    }
    return out;
  }

  // Radius that reaches every corner of the margin box.
  const maxR = Math.hypot(width - margin * 2, height - margin * 2) / 2 + step;

  if (pattern === "radial") {
    const midR = maxR / 2;
    const rays = Math.max(8, Math.round((2 * Math.PI * midR) / step));
    // Rays converge, so they must stop short of the center or the hub turns
    // into a solid blot the plotter would grind through. innerR is the radius
    // at which neighbouring rays are still ~0.4 * spacing apart.
    const innerR = Math.max(step, midR * 0.4);
    for (let i = 0; i < rays; i++) {
      const a = (i / rays) * Math.PI * 2;
      const cos = Math.cos(a);
      const sin = Math.sin(a);
      out.push([
        { x: cx + cos * innerR, y: cy + sin * innerR },
        { x: cx + cos * maxR, y: cy + sin * maxR },
      ]);
    }
    return out;
  }

  // concentric (default)
  for (let r = step; r <= maxR; r += step) {
    const segments = Math.min(720, Math.max(24, Math.ceil((2 * Math.PI * r) / 3)));
    const ring: Polyline = [];
    for (let i = 0; i <= segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      ring.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
    }
    out.push(ring);
  }
  return out;
}

/** Sparse texture for the knocked-out region, laid over the silhouette bbox. */
function buildInteriorTexture(kind: string, spacing: number, rings: Polyline[]): Polyline[] {
  if (kind === "none") return [];
  const box = bbox(rings);
  if (!box) return [];

  const step = Math.max(2, spacing);
  const out: Polyline[] = [];

  if (kind === "hatch") {
    for (let y = box.yMin; y <= box.yMax + 1e-9; y += step) {
      out.push([{ x: box.xMin - 1, y }, { x: box.xMax + 1, y }]);
    }
    return out;
  }

  // dots: a tiny closed circle per grid node
  const r = Math.max(0.6, Math.min(step * 0.18, 4));
  const segments = 10;
  for (let y = box.yMin; y <= box.yMax + 1e-9; y += step) {
    for (let x = box.xMin; x <= box.xMax + 1e-9; x += step) {
      const dot: Polyline = [];
      for (let i = 0; i <= segments; i++) {
        const a = (i / segments) * Math.PI * 2;
        dot.push({ x: x + Math.cos(a) * r, y: y + Math.sin(a) * r });
      }
      out.push(dot);
    }
  }
  return out;
}

const silhouetteField: Composition2DDefinition = {
  id: "silhouetteField",
  name: "Silhouette Field",
  description:
    "A page-filling texture (concentric circles, lines or rays) with a silhouette knocked out of it; the interior optionally carries a sparser hatch or dot texture. Load an image to derive the silhouette from its dark regions.",
  tags: ["generative", "silhouette", "mask", "knockout", "negative-space", "image"],
  category: "2d",
  type: "2d",

  controls: {
    silhouette: {
      type: "select",
      label: "Silhouette",
      default: "toad",
      options: [
        { label: "Toad", value: "toad" },
        { label: "Leaf", value: "leaf" },
        { label: "Hand", value: "hand" },
        { label: "Moon", value: "moon" },
      ],
      group: "Silhouette",
    },
    silhouetteScale: {
      type: "slider",
      label: "Silhouette Scale",
      default: 0.7,
      min: 0.1,
      max: 1.4,
      step: 0.01,
      group: "Silhouette",
    },
    offset: {
      type: "xy",
      label: "Offset",
      default: [0, 0],
      min: -0.5,
      max: 0.5,
      group: "Silhouette",
    },
    invert: {
      type: "toggle",
      label: "Invert (field inside)",
      default: false,
      group: "Silhouette",
    },
    image: {
      type: "image",
      label: "Image Silhouette",
      sampleSize: 192,
      group: "Silhouette",
    },
    threshold: {
      type: "slider",
      label: "Image Threshold",
      default: 0.5,
      min: 0.05,
      max: 0.95,
      step: 0.01,
      group: "Silhouette",
    },
    fieldPattern: {
      type: "select",
      label: "Field Pattern",
      default: "concentric",
      options: [
        { label: "Concentric Circles", value: "concentric" },
        { label: "Horizontal Lines", value: "horizontal" },
        { label: "Radial Rays", value: "radial" },
      ],
      group: "Field",
    },
    fieldSpacing: {
      type: "slider",
      label: "Field Spacing",
      default: 9,
      min: 3,
      max: 40,
      step: 0.5,
      group: "Field",
    },
    interiorTexture: {
      type: "select",
      label: "Interior Texture",
      default: "hatch",
      options: [
        { label: "None", value: "none" },
        { label: "Horizontal Hatch", value: "hatch" },
        { label: "Dots", value: "dots" },
      ],
      group: "Interior",
    },
    interiorSpacing: {
      type: "slider",
      label: "Interior Spacing",
      default: 26,
      min: 6,
      max: 80,
      step: 1,
      group: "Interior",
    },
    margin: {
      type: "slider",
      label: "Margin",
      default: 40,
      min: 0,
      max: 160,
      step: 1,
      group: "Layout",
    },
  },

  suggestedPresets: {
    theToad: {
      name: "The Toad",
      description: "Dense concentric circles, big toad knocked out, sparse interior hatch",
      values: {
        controls: {
          silhouette: "toad",
          fieldPattern: "concentric",
          fieldSpacing: 7,
          interiorTexture: "hatch",
          interiorSpacing: 30,
          silhouetteScale: 0.85,
          invert: false,
          margin: 40,
        },
      },
    },
    moonRays: {
      name: "Moon Rays",
      description: "Radial rays broken by a crescent that carries dots",
      values: {
        controls: {
          silhouette: "moon",
          fieldPattern: "radial",
          fieldSpacing: 12,
          interiorTexture: "dots",
          interiorSpacing: 18,
          silhouetteScale: 0.9,
          invert: false,
          margin: 40,
        },
      },
    },
  },

  generate({ width, height, values }) {
    const margin = values.margin as number;
    const invert = (values.invert as boolean) ?? false;
    const pattern = (values.fieldPattern as string) ?? "concentric";
    const fieldSpacing = values.fieldSpacing as number;
    const interiorKind = (values.interiorTexture as string) ?? "none";
    const interiorSpacing = values.interiorSpacing as number;

    const rings = buildSilhouetteRings(values, width, height);
    const field = buildField(pattern, fieldSpacing, width, height, margin);
    const texture = buildInteriorTexture(interiorKind, interiorSpacing, rings);

    // Normal: dense field outside, sparse texture inside.
    // Inverted: the field fills the shape and the sparse texture takes the page.
    const fieldMode = invert ? "inside" : "outside";
    const textureMode = invert ? "outside" : "inside";

    const masked: Polyline[] = [
      ...clipPolylinesToSilhouette(field, rings, fieldMode),
      ...clipPolylinesToSilhouette(texture, rings, textureMode),
    ];

    const rect = {
      xMin: margin,
      yMin: margin,
      xMax: width - margin,
      yMax: height - margin,
    };

    // Narrow concavities (the toad's brow notch) squeeze the field into
    // sub-pixel slivers. Those are pen-down blips on a plotter, not marks.
    const MIN_LENGTH = 0.75;

    const out: Polyline[] = [];
    for (const line of masked) {
      for (const piece of clipPolylineToRect(line, rect)) {
        if (piece.length < 2) continue;
        let len = 0;
        for (let i = 0; i < piece.length - 1; i++) {
          len += Math.hypot(piece[i + 1].x - piece[i].x, piece[i + 1].y - piece[i].y);
          if (len >= MIN_LENGTH) break;
        }
        if (len >= MIN_LENGTH) out.push(piece);
      }
    }
    return out;
  },
};

export default silhouetteField;
