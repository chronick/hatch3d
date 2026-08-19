/**
 * glyph-stamp — grid-of-glyphs operator.
 *
 * Stamps one glyph per grid cell, sized by a scalar field sampled at the
 * cell center. Neighbouring glyphs are *expected* to overlap where the
 * field is strong — that overlap is the aesthetic (dense regions fuse into
 * organic blobs, sparse regions decay to dots), so no collision avoidance
 * is performed.
 *
 * Dependency-free and pure: given the same options (and the same rng
 * sequence) the output is identical.
 */

export type Point = { x: number; y: number };
export type Polyline = Point[];

/** Built-in glyph kinds, or a custom builder returning closed outlines. */
export type GlyphKind = "square" | "circle" | "triangle" | ((size: number) => Polyline[]);

export interface StampGlyphsOptions {
  /** Stamp region size in px. Cell centers are laid out across it. */
  width: number;
  height: number;
  /** Grid columns; rows are derived from the region aspect ratio. */
  cols: number;
  /** Glyph shape. Custom fn receives the px size and returns closed outlines centered at origin. */
  glyph: GlyphKind;
  /** Scalar field over normalized region coords [0,1]^2, returning [0,1]. */
  field: (nx: number, ny: number) => number;
  /** Glyph size in px at field value 0 / 1 respectively. */
  minSize: number;
  maxSize: number;
  /** Positional jitter in px (uniform in [-jitter, +jitter] per axis). */
  jitter?: number;
  /** Rotation jitter in radians (uniform in [-r, +r]). */
  rotationJitter?: number;
  /** Required when jitter or rotationJitter is non-zero. */
  rng?: () => number;
  /** Field values strictly below this emit nothing. Default 0. */
  threshold?: number;
}

const CIRCLE_SEGMENTS = 32;

/** Unit-family glyph builder: closed outline(s) centered at the origin. */
function buildGlyph(glyph: GlyphKind, size: number): Polyline[] {
  if (typeof glyph === "function") return glyph(size);

  if (glyph === "circle") {
    const r = size / 2;
    const pts: Polyline = [];
    for (let i = 0; i <= CIRCLE_SEGMENTS; i++) {
      const a = (i / CIRCLE_SEGMENTS) * Math.PI * 2;
      pts.push({ x: Math.cos(a) * r, y: Math.sin(a) * r });
    }
    return [pts];
  }

  if (glyph === "triangle") {
    // Equilateral, circumradius = size/2, apex up (canvas y grows down).
    const r = size / 2;
    const pts: Polyline = [];
    for (let i = 0; i < 3; i++) {
      const a = -Math.PI / 2 + (i * Math.PI * 2) / 3;
      pts.push({ x: Math.cos(a) * r, y: Math.sin(a) * r });
    }
    pts.push({ ...pts[0] });
    return [pts];
  }

  // square (default)
  const h = size / 2;
  return [
    [
      { x: -h, y: -h },
      { x: h, y: -h },
      { x: h, y: h },
      { x: -h, y: h },
      { x: -h, y: -h },
    ],
  ];
}

export function stampGlyphs(opts: StampGlyphsOptions): Polyline[] {
  const {
    width,
    height,
    glyph,
    field,
    minSize,
    maxSize,
    jitter = 0,
    rotationJitter = 0,
    rng,
    threshold = 0,
  } = opts;

  const cols = Math.max(0, Math.floor(opts.cols));
  if (cols <= 0 || width <= 0 || height <= 0) return [];

  if ((jitter > 0 || rotationJitter > 0) && !rng) {
    throw new Error("stampGlyphs: rng is required when jitter or rotationJitter is used");
  }

  const rows = Math.max(1, Math.round((cols * height) / width));
  const cellW = width / cols;
  const cellH = height / rows;

  const out: Polyline[] = [];

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const cx = (col + 0.5) * cellW;
      const cy = (row + 0.5) * cellH;

      const raw = field(cx / width, cy / height);
      const v = Number.isFinite(raw) ? Math.min(1, Math.max(0, raw)) : 0;
      if (v < threshold) continue;

      const size = minSize + v * (maxSize - minSize);
      if (size <= 0) continue;

      const jx = jitter > 0 ? (rng!() * 2 - 1) * jitter : 0;
      const jy = jitter > 0 ? (rng!() * 2 - 1) * jitter : 0;
      const theta = rotationJitter > 0 ? (rng!() * 2 - 1) * rotationJitter : 0;

      const cos = theta !== 0 ? Math.cos(theta) : 1;
      const sin = theta !== 0 ? Math.sin(theta) : 0;

      for (const outline of buildGlyph(glyph, size)) {
        if (outline.length === 0) continue;
        const placed: Polyline = new Array(outline.length);
        for (let i = 0; i < outline.length; i++) {
          const p = outline[i];
          const rx = theta !== 0 ? p.x * cos - p.y * sin : p.x;
          const ry = theta !== 0 ? p.x * sin + p.y * cos : p.y;
          placed[i] = { x: cx + jx + rx, y: cy + jy + ry };
        }
        out.push(placed);
      }
    }
  }

  return out;
}

export default stampGlyphs;
