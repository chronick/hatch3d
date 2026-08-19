import { createNoise2D } from "simplex-noise";
import type { Composition2DDefinition, ImageSource } from "../../types";
import { SpatialHash, fbm } from "./streamline-tracer";

/**
 * Flow Raster — engraving / line-integral-convolution style image rendering.
 *
 * Strokes follow the iso-brightness direction of the source image (the
 * tangent of the smoothed image gradient), so they wrap around features the
 * way a copperplate engraver's burin does. Local darkness modulates the
 * minimum separation between strokes, so shadows fill in with tight bundles
 * and highlights open up or drop out entirely.
 *
 * The direction field comes from the *structure tensor* rather than the raw
 * gradient. Averaging raw gradient vectors cancels out opposing edges (a thin
 * dark line has +g on one side and -g on the other); averaging the tensor
 * outer product does not. The price is that the tensor's minor eigenvector is
 * an unsigned orientation, not a vector — handled during tracing by aligning
 * every sample with the previous step's heading (see `directionAt`).
 */

// ── Seeded PRNG (mulberry32) ──

function mulberry32(a: number) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Grid helpers ──

/** Longest-axis resolution of the internal analysis grid. */
const GRID_MAX = 200;

/** Hard cap on emitted polyline points, keeps default renders well under 3s. */
const MAX_POINTS = 150_000;

/** Below this structure-tensor anisotropy the local orientation is noise. */
const MIN_COHERENCE = 0.02;

type Pt = { x: number; y: number };

/** Separable box blur, two passes (approximates a gaussian). */
function boxBlur(src: Float32Array, w: number, h: number, radius: number): Float32Array {
  const r = Math.max(0, Math.round(radius));
  if (r === 0) return src;

  let cur = src;
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);

  for (let pass = 0; pass < 2; pass++) {
    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let x = 0; x < w; x++) {
        let sum = 0;
        let n = 0;
        const lo = Math.max(0, x - r);
        const hi = Math.min(w - 1, x + r);
        for (let xx = lo; xx <= hi; xx++) {
          sum += cur[row + xx];
          n++;
        }
        tmp[row + x] = sum / n;
      }
    }
    for (let x = 0; x < w; x++) {
      for (let y = 0; y < h; y++) {
        let sum = 0;
        let n = 0;
        const lo = Math.max(0, y - r);
        const hi = Math.min(h - 1, y + r);
        for (let yy = lo; yy <= hi; yy++) {
          sum += tmp[yy * w + x];
          n++;
        }
        out[y * w + x] = sum / n;
      }
    }
    cur = pass === 0 ? Float32Array.from(out) : out;
  }

  return cur;
}

/** Bilinear sample of an image's brightness grid at normalized (u, v). */
function sampleImage(image: ImageSource, u: number, v: number): number {
  const cu = u < 0 ? 0 : u > 1 ? 1 : u;
  const cv = v < 0 ? 0 : v > 1 ? 1 : v;
  const fx = cu * (image.width - 1);
  const fy = cv * (image.height - 1);
  const ix0 = Math.floor(fx);
  const iy0 = Math.floor(fy);
  const ix1 = Math.min(image.width - 1, ix0 + 1);
  const iy1 = Math.min(image.height - 1, iy0 + 1);
  const tx = fx - ix0;
  const ty = fy - iy0;
  const b00 = image.brightness[iy0 * image.width + ix0];
  const b10 = image.brightness[iy0 * image.width + ix1];
  const b01 = image.brightness[iy1 * image.width + ix0];
  const b11 = image.brightness[iy1 * image.width + ix1];
  const top = b00 * (1 - tx) + b10 * tx;
  const bot = b01 * (1 - tx) + b11 * tx;
  return top * (1 - ty) + bot * ty;
}

// ── Composition definition ──

const flowRaster: Composition2DDefinition = {
  id: "flowRaster",
  name: "Flow Raster",
  description:
    "Engraving-style image rendering: strokes trace the iso-brightness contours of an uploaded photo (structure-tensor tangent field, line-integral-convolution / copperplate look) with line density driven by local darkness. With no image loaded it falls back to an fbm noise field, so it still renders a structured flow engraving.",
  tags: ["generative", "image", "engraving", "flow", "streamlines", "halftone", "lic"],
  category: "2d",
  type: "2d",
  renderMode: "debounced",

  controls: {
    image: {
      type: "image",
      label: "Image",
      sampleSize: 224,
      group: "Image",
    },
    lineSpacing: {
      type: "slider",
      label: "Line Spacing",
      default: 8,
      min: 2,
      max: 24,
      step: 0.5,
      group: "Density",
    },
    darknessRange: {
      type: "slider",
      label: "Darkness Range",
      default: 2.5,
      min: 0,
      max: 6,
      step: 0.1,
      group: "Density",
    },
    tonalCutoff: {
      type: "slider",
      label: "Tonal Cutoff",
      default: 0.92,
      min: 0,
      max: 1,
      step: 0.01,
      group: "Density",
    },
    smoothing: {
      type: "slider",
      label: "Field Smoothing",
      default: 3,
      min: 0,
      max: 10,
      step: 1,
      group: "Field",
    },
    stepSize: {
      type: "slider",
      label: "Step Size",
      default: 1.5,
      min: 0.5,
      max: 6,
      step: 0.25,
      group: "Field",
    },
    minLine: {
      type: "slider",
      label: "Min Line Length",
      default: 15,
      min: 2,
      max: 200,
      step: 1,
      group: "Strokes",
    },
    maxLine: {
      type: "slider",
      label: "Max Line Length",
      default: 500,
      min: 20,
      max: 2000,
      step: 10,
      group: "Strokes",
    },
    crosshatch: {
      type: "toggle",
      label: "Crosshatch Darks",
      default: false,
      group: "Crosshatch",
    },
    crosshatchThreshold: {
      type: "slider",
      label: "Crosshatch Threshold",
      default: 0.25,
      min: 0,
      max: 1,
      step: 0.01,
      group: "Crosshatch",
    },
    crosshatchAngle: {
      type: "slider",
      label: "Crosshatch Angle",
      default: 60,
      min: 10,
      max: 170,
      step: 5,
      group: "Crosshatch",
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
      default: 20,
      min: 0,
      max: 80,
      step: 5,
      group: "Layout",
    },
  },

  generate({ width, height, values }) {
    const image = (values.image as ImageSource | null) ?? null;
    const lineSpacing = Math.max(0.5, values.lineSpacing as number);
    const darknessRange = Math.max(0, values.darknessRange as number);
    const tonalCutoff = values.tonalCutoff as number;
    const smoothing = Math.round(values.smoothing as number);
    const stepSize = Math.max(0.25, values.stepSize as number);
    const minLine = Math.max(0, values.minLine as number);
    const maxLine = Math.max(stepSize * 2, values.maxLine as number);
    const crosshatch = values.crosshatch as boolean;
    const crosshatchThreshold = values.crosshatchThreshold as number;
    const crosshatchAngle = ((values.crosshatchAngle as number) * Math.PI) / 180;
    const seed = Math.round(values.seed as number);
    const margin = values.margin as number;

    const x0 = margin;
    const y0 = margin;
    const x1 = width - margin;
    const y1 = height - margin;
    const innerW = Math.max(1e-6, x1 - x0);
    const innerH = Math.max(1e-6, y1 - y0);
    if (innerW < 4 || innerH < 4) return [];

    const rng = mulberry32(seed);
    const noise2D = createNoise2D(() => rng());

    // ── 1. Brightness grid ──

    let gw: number;
    let gh: number;
    if (innerW >= innerH) {
      gw = GRID_MAX;
      gh = Math.max(8, Math.round((GRID_MAX * innerH) / innerW));
    } else {
      gh = GRID_MAX;
      gw = Math.max(8, Math.round((GRID_MAX * innerW) / innerH));
    }

    const lum = new Float32Array(gw * gh);
    if (image && image.width > 1 && image.height > 1) {
      for (let j = 0; j < gh; j++) {
        const v = j / (gh - 1);
        for (let i = 0; i < gw; i++) {
          lum[j * gw + i] = sampleImage(image, i / (gw - 1), v);
        }
      }
    } else {
      // No-image fallback: synthetic fbm brightness field, so the composition
      // still renders a structured engraving instead of an empty page.
      for (let j = 0; j < gh; j++) {
        const v = (j / (gh - 1)) * 3.2;
        for (let i = 0; i < gw; i++) {
          const u = (i / (gw - 1)) * 3.2;
          const n = fbm(noise2D, u, v, 5);
          const b = 0.5 + 0.62 * n;
          lum[j * gw + i] = b < 0 ? 0 : b > 1 ? 1 : b;
        }
      }
    }

    // ── 2. Smoothed structure tensor ──

    // Sobel gradients on the brightness grid (grid units; scale is irrelevant
    // because only the tensor's eigen-directions are used).
    const jxx = new Float32Array(gw * gh);
    const jxy = new Float32Array(gw * gh);
    const jyy = new Float32Array(gw * gh);

    const at = (i: number, j: number) =>
      lum[(j < 0 ? 0 : j >= gh ? gh - 1 : j) * gw + (i < 0 ? 0 : i >= gw ? gw - 1 : i)];

    for (let j = 0; j < gh; j++) {
      for (let i = 0; i < gw; i++) {
        const tl = at(i - 1, j - 1);
        const tc = at(i, j - 1);
        const tr = at(i + 1, j - 1);
        const ml = at(i - 1, j);
        const mr = at(i + 1, j);
        const bl = at(i - 1, j + 1);
        const bc = at(i, j + 1);
        const br = at(i + 1, j + 1);
        const gx = tr + 2 * mr + br - (tl + 2 * ml + bl);
        const gy = bl + 2 * bc + br - (tl + 2 * tc + tr);
        const k = j * gw + i;
        jxx[k] = gx * gx;
        jxy[k] = gx * gy;
        jyy[k] = gy * gy;
      }
    }

    const sxx = boxBlur(jxx, gw, gh, smoothing);
    const sxy = boxBlur(jxy, gw, gh, smoothing);
    const syy = boxBlur(jyy, gw, gh, smoothing);

    // ── 3. Field sampling in canvas space ──

    function gridCoords(x: number, y: number): { fu: number; fv: number } {
      let fu = ((x - x0) / innerW) * (gw - 1);
      let fv = ((y - y0) / innerH) * (gh - 1);
      if (fu < 0) fu = 0;
      else if (fu > gw - 1) fu = gw - 1;
      if (fv < 0) fv = 0;
      else if (fv > gh - 1) fv = gh - 1;
      return { fu, fv };
    }

    function bilinear(arr: Float32Array, fu: number, fv: number): number {
      const i0 = Math.floor(fu);
      const j0 = Math.floor(fv);
      const i1 = i0 + 1 < gw ? i0 + 1 : gw - 1;
      const j1 = j0 + 1 < gh ? j0 + 1 : gh - 1;
      const tx = fu - i0;
      const ty = fv - j0;
      const a = arr[j0 * gw + i0];
      const b = arr[j0 * gw + i1];
      const c = arr[j1 * gw + i0];
      const d = arr[j1 * gw + i1];
      return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
    }

    function brightnessAt(x: number, y: number): number {
      const { fu, fv } = gridCoords(x, y);
      return bilinear(lum, fu, fv);
    }

    /** Base separation at (x, y): darker → tighter. */
    function separationAt(x: number, y: number): number {
      const darkness = 1 - brightnessAt(x, y);
      return Math.max(0.5, lineSpacing / (1 + darknessRange * darkness));
    }

    const cosOff = Math.cos(crosshatchAngle);
    const sinOff = Math.sin(crosshatchAngle);

    /**
     * Unsigned tangent orientation at (x, y): the minor eigenvector of the
     * smoothed structure tensor, i.e. the direction of least brightness
     * change — the iso-brightness contour. `rotate` applies the crosshatch
     * angle offset. Returns coherence 0 where the field is isotropic.
     */
    function tangentAt(
      x: number,
      y: number,
      rotate: boolean,
    ): { tx: number; ty: number; coherence: number } {
      const { fu, fv } = gridCoords(x, y);
      const a = bilinear(sxx, fu, fv);
      const b = bilinear(sxy, fu, fv);
      const c = bilinear(syy, fu, fv);

      const half = (a + c) * 0.5;
      const diff = (a - c) * 0.5;
      const disc = Math.sqrt(diff * diff + b * b);
      const lmax = half + disc;
      const lmin = half - disc;
      const coherence = lmax + lmin > 1e-12 ? (lmax - lmin) / (lmax + lmin) : 0;

      let tx: number;
      let ty: number;
      if (coherence < MIN_COHERENCE) {
        // Isotropic / flat region — no meaningful orientation.
        tx = 1;
        ty = 0;
      } else {
        // Eigenvector of lmin: (b, lmin - a) or (lmin - c, b); pick the
        // numerically larger of the two forms.
        const v1x = b;
        const v1y = lmin - a;
        const v2x = lmin - c;
        const v2y = b;
        if (v1x * v1x + v1y * v1y >= v2x * v2x + v2y * v2y) {
          tx = v1x;
          ty = v1y;
        } else {
          tx = v2x;
          ty = v2y;
        }
        const len = Math.hypot(tx, ty);
        if (len < 1e-12) {
          tx = 1;
          ty = 0;
        } else {
          tx /= len;
          ty /= len;
        }
      }

      if (rotate) {
        const rx = tx * cosOff - ty * sinOff;
        const ry = tx * sinOff + ty * cosOff;
        tx = rx;
        ty = ry;
      }

      return { tx, ty, coherence };
    }

    /**
     * Orientation disambiguation. The tensor tangent has no sign, so every
     * sample is flipped to lie in the same half-plane as the incoming heading
     * (`px, py`). In flat regions (coherence below threshold) the heading is
     * simply carried forward, which keeps strokes straight instead of letting
     * them chatter on noise.
     */
    function directionAt(
      x: number,
      y: number,
      px: number,
      py: number,
      rotate: boolean,
    ): { dx: number; dy: number } {
      const t = tangentAt(x, y, rotate);
      if (t.coherence < MIN_COHERENCE) return { dx: px, dy: py };
      const dot = t.tx * px + t.ty * py;
      return dot < 0 ? { dx: -t.tx, dy: -t.ty } : { dx: t.tx, dy: t.ty };
    }

    // ── 4. Tracing ──

    const polylines: Pt[][] = [];
    let pointBudget = MAX_POINTS;

    /**
     * One tracing pass. `cutoff` is the brightness above which no strokes are
     * drawn; `rotate` applies the crosshatch angle offset. Each pass owns its
     * own SpatialHash so the crosshatch layer can overlay the base layer.
     */
    function pass(cutoff: number, rotate: boolean): void {
      const hash = new SpatialHash(lineSpacing);
      const halfSteps = Math.max(2, Math.ceil(maxLine / stepSize / 2));

      function inBounds(x: number, y: number): boolean {
        return x >= x0 && x <= x1 && y >= y0 && y <= y1;
      }

      function traceDirection(sx: number, sy: number, sign: 1 | -1): Pt[] {
        const pts: Pt[] = [];
        let x = sx;
        let y = sy;
        const t0 = tangentAt(x, y, rotate);
        let hx = t0.tx * sign;
        let hy = t0.ty * sign;

        for (let step = 0; step < halfSteps; step++) {
          if (!inBounds(x, y)) break;
          if (brightnessAt(x, y) > cutoff) break;
          // Separation test every other step — the field is smooth enough
          // that a half-step of slack costs nothing visually.
          if (step > 1 && (step & 1) === 0) {
            if (hash.nearestDistance(x, y) < separationAt(x, y) * 0.55) break;
          }

          pts.push({ x, y });

          // RK2 midpoint, each evaluation re-aligned to the running heading.
          const d0 = directionAt(x, y, hx, hy, rotate);
          const mx = x + d0.dx * stepSize * 0.5;
          const my = y + d0.dy * stepSize * 0.5;
          const d1 = directionAt(mx, my, d0.dx, d0.dy, rotate);
          x += d1.dx * stepSize;
          y += d1.dy * stepSize;
          hx = d1.dx;
          hy = d1.dy;
        }

        return pts;
      }

      /** Seed queue: index-pointer FIFO (avoids O(n) Array.shift). */
      const queue: Pt[] = [];

      // Coarse grid of candidate seeds, darkest first so shadow regions claim
      // their tight spacing before highlights spread into them.
      const gridStep = lineSpacing;
      const candidates: { x: number; y: number; d: number }[] = [];
      for (let gy = y0 + gridStep * 0.5; gy <= y1; gy += gridStep) {
        for (let gx = x0 + gridStep * 0.5; gx <= x1; gx += gridStep) {
          const jx = gx + (rng() - 0.5) * gridStep * 0.5;
          const jy = gy + (rng() - 0.5) * gridStep * 0.5;
          if (!inBounds(jx, jy)) continue;
          const b = brightnessAt(jx, jy);
          if (b > cutoff) continue;
          candidates.push({ x: jx, y: jy, d: 1 - b });
        }
      }
      candidates.sort((a, b) => b.d - a.d);
      for (const c of candidates) queue.push({ x: c.x, y: c.y });

      let head = 0;
      const MAX_QUEUE = 400_000;

      while (head < queue.length) {
        if (pointBudget <= 0) break;
        const seed = queue[head++];

        if (!inBounds(seed.x, seed.y)) continue;
        if (brightnessAt(seed.x, seed.y) > cutoff) continue;
        if (hash.nearestDistance(seed.x, seed.y) < separationAt(seed.x, seed.y) * 0.9) continue;

        const forward = traceDirection(seed.x, seed.y, 1);
        const backward = traceDirection(seed.x, seed.y, -1);
        if (forward.length === 0 && backward.length === 0) continue;

        // Both halves start at the seed; drop the duplicate and reverse the
        // backward half so the joined polyline runs in one consistent
        // direction end to end.
        const line: Pt[] =
          backward.length > 1
            ? backward.slice(1).reverse().concat(forward)
            : forward.slice();
        if (line.length < 2) continue;

        let arcLen = 0;
        for (let i = 1; i < line.length; i++) {
          arcLen += Math.hypot(line[i].x - line[i - 1].x, line[i].y - line[i - 1].y);
        }
        if (arcLen < minLine) continue;

        for (const p of line) hash.insert(p.x, p.y);
        polylines.push(line);
        pointBudget -= line.length;

        // Jobard-Lefer perpendicular reseeding, offset by the *local*
        // separation so dark areas repack tighter than light ones.
        if (queue.length < MAX_QUEUE) {
          const interval = Math.max(2, Math.floor(line.length / 24));
          for (let i = 0; i < line.length - 1; i += interval) {
            const p = line[i];
            const q = line[i + 1];
            const dx = q.x - p.x;
            const dy = q.y - p.y;
            const len = Math.hypot(dx, dy);
            if (len < 1e-9) continue;
            const nx = -dy / len;
            const ny = dx / len;
            const sep = separationAt(p.x, p.y);
            const left = { x: p.x + nx * sep, y: p.y + ny * sep };
            const right = { x: p.x - nx * sep, y: p.y - ny * sep };
            if (inBounds(left.x, left.y)) queue.push(left);
            if (inBounds(right.x, right.y)) queue.push(right);
          }
        }
      }
    }

    pass(tonalCutoff, false);
    if (crosshatch) pass(Math.min(tonalCutoff, crosshatchThreshold), true);

    return polylines;
  },
};

export default flowRaster;
