/**
 * strata-triptych — faceted geological strata inside cropped vertical panels.
 *
 * N tall panels sit side by side with gutters. Inside each panel a 2D
 * "cross-section" is built: a stack of strata bands whose boundaries are
 * piecewise-linear polylines with seeded jitter, sheared vertically at a few
 * seeded fault lines (the classic geology offset). Every band is split into
 * 2..facetSplits facets along slanted internal edges, and each facet is filled
 * with parallel hatching whose angle follows one of its own bounding edges
 * (quantised to 7.5° so the result reads architectural rather than noisy) and
 * whose spacing comes from a per-facet tone value. A seeded fraction of facets
 * gets a dot-grid accent instead, and another fraction is left EMPTY so deep
 * unhatched gaps punch through the stack.
 *
 * Content is generated deliberately oversized and then clipped to the panel
 * rectangle with `clipPolylinesToSilhouette`, so facets run off the edge and
 * get cropped — the cropped-composition feel of the reference.
 *
 * Designed for white / metallic ink on black paper.
 *
 * Deterministic: one mulberry32 stream per panel, derived from `seed`.
 */

import type { Composition2DDefinition } from "../../types";
import {
  clipPolylinesToSilhouette,
  pointInSilhouette,
} from "../../../operators/silhouette-knockout";

export type Pt = { x: number; y: number };

const DEG = Math.PI / 180;
/** Hatch angles snap to this increment — keeps the field architectural. */
const ANGLE_QUANTUM = 7.5 * DEG;
/** Length of the 2-point tick that stands in for one dot-grid dot. */
export const DOT_TICK = 1.2;

// ── Seeded PRNG ─────────────────────────────────────────────────────────────

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Hatching primitives (exported for tests) ────────────────────────────────

/**
 * Parallel hatch lines filling a polygon at `theta` radians, `spacing` apart.
 *
 * Standard rotated-space scanline: rotate the polygon by -theta, walk
 * horizontal scanlines across its bbox starting half a spacing in, take the
 * even-odd crossing intervals on each scanline, rotate the resulting segments
 * back. Works for concave polygons (a scanline may yield several intervals).
 *
 * Line count is exactly `floor((span - spacing/2) / spacing) + 1` for a convex
 * polygon whose rotated bbox height is `span` (0 when the shape is thinner
 * than half a spacing).
 */
export function hatchPolygonLines(poly: Pt[], theta: number, spacing: number): Pt[][] {
  if (poly.length < 3 || !(spacing > 0)) return [];

  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  // Rotate by -theta: hatch lines become horizontal.
  const rot = poly.map((p) => ({ x: p.x * cos + p.y * sin, y: -p.x * sin + p.y * cos }));

  let yMin = Infinity;
  let yMax = -Infinity;
  for (const p of rot) {
    if (p.y < yMin) yMin = p.y;
    if (p.y > yMax) yMax = p.y;
  }
  const span = yMax - yMin;
  if (!(span > 0)) return [];

  const count = Math.floor((span - spacing / 2) / spacing) + 1;
  if (count <= 0) return [];

  const out: Pt[][] = [];
  const n = rot.length;
  const xs: number[] = [];

  for (let k = 0; k < count; k++) {
    const y = yMin + spacing / 2 + k * spacing;
    xs.length = 0;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const a = rot[i];
      const b = rot[j];
      // Half-open rule on y — shared vertices are counted once.
      if ((a.y > y) !== (b.y > y)) {
        const t = (y - a.y) / (b.y - a.y);
        xs.push(a.x + t * (b.x - a.x));
      }
    }
    if (xs.length < 2) continue;
    xs.sort((p, q) => p - q);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const x0 = xs[i];
      const x1 = xs[i + 1];
      if (x1 - x0 < 1e-9) continue;
      out.push([
        { x: x0 * cos - y * sin, y: x0 * sin + y * cos },
        { x: x1 * cos - y * sin, y: x1 * sin + y * cos },
      ]);
    }
  }
  return out;
}

/**
 * Dot-grid accent: axis-aligned lattice of points inside the polygon at
 * `spacing`, each emitted as a tiny horizontal 2-point tick (a plotter cannot
 * draw a zero-length path, so a dot is a very short stroke).
 */
export function dotGridLines(poly: Pt[], spacing: number, tick = DOT_TICK): Pt[][] {
  if (poly.length < 3 || !(spacing > 0)) return [];

  let xMin = Infinity;
  let xMax = -Infinity;
  let yMin = Infinity;
  let yMax = -Infinity;
  for (const p of poly) {
    if (p.x < xMin) xMin = p.x;
    if (p.x > xMax) xMax = p.x;
    if (p.y < yMin) yMin = p.y;
    if (p.y > yMax) yMax = p.y;
  }

  const rings = [poly];
  const out: Pt[][] = [];
  const half = tick / 2;
  for (let y = yMin + spacing / 2; y < yMax; y += spacing) {
    for (let x = xMin + spacing / 2; x < xMax; x += spacing) {
      if (!pointInSilhouette({ x, y }, rings)) continue;
      out.push([
        { x: x - half, y },
        { x: x + half, y },
      ]);
    }
  }
  return out;
}

// ── Boundary construction ───────────────────────────────────────────────────

interface Fault {
  x: number;
  /** Vertical displacement applied to every boundary right of `x`. */
  dy: number;
}

function lerpY(a: Pt, b: Pt, x: number): number {
  if (Math.abs(b.x - a.x) < 1e-12) return a.y;
  return a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x);
}

/**
 * One strata boundary across [x0, x1]: piecewise-linear, seeded vertical
 * jitter at `knots` evenly spaced samples, plus a hard vertical step at every
 * fault position (emitted as two coincident-x points so the jump is sharp).
 *
 * Returned points have non-decreasing x, which `subPolyByX` relies on.
 */
function buildBoundary(
  x0: number,
  x1: number,
  baseY: number,
  jitterAmp: number,
  knots: number,
  faults: Fault[],
  rng: () => number,
): Pt[] {
  const n = Math.max(2, knots);
  const step = (x1 - x0) / n;
  const jitter: number[] = [];
  for (let i = 0; i <= n; i++) jitter.push((rng() * 2 - 1) * jitterAmp);

  const jitterAt = (x: number): number => {
    const t = (x - x0) / step;
    const i = Math.max(0, Math.min(n - 1, Math.floor(t)));
    const f = Math.max(0, Math.min(1, t - i));
    return jitter[i] + (jitter[i + 1] - jitter[i]) * f;
  };

  // Cumulative fault offset, evaluated on the requested side of each fault.
  const faultAt = (x: number, side: number): number => {
    let sum = 0;
    for (const f of faults) {
      if (f.x < x || (f.x === x && side > 0)) sum += f.dy;
    }
    return sum;
  };

  type Knot = { x: number; side: number };
  const stops: Knot[] = [];
  for (let i = 0; i <= n; i++) stops.push({ x: x0 + i * step, side: 0 });
  for (const f of faults) {
    stops.push({ x: f.x, side: -1 });
    stops.push({ x: f.x, side: 1 });
  }
  stops.sort((a, b) => a.x - b.x || a.side - b.side);

  return stops.map((s) => ({
    x: s.x,
    y: baseY + jitterAt(s.x) + faultAt(s.x, s.side),
  }));
}

/**
 * Sub-polyline of an x-monotone boundary between x0 and x1, with the end
 * points interpolated onto the boundary. Vertical fault segments inside the
 * range survive intact.
 */
function subPolyByX(pts: Pt[], x0: number, x1: number): Pt[] {
  const out: Pt[] = [];
  const push = (p: Pt) => {
    const last = out[out.length - 1];
    if (last && Math.abs(last.x - p.x) < 1e-9 && Math.abs(last.y - p.y) < 1e-9) return;
    out.push(p);
  };

  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    if (b.x < x0 || a.x > x1) continue;
    const pa = a.x < x0 ? { x: x0, y: lerpY(a, b, x0) } : { x: a.x, y: a.y };
    const pb = b.x > x1 ? { x: x1, y: lerpY(a, b, x1) } : { x: b.x, y: b.y };
    push(pa);
    push(pb);
  }
  return out;
}

// ── Panel content ───────────────────────────────────────────────────────────

interface PanelOpts {
  strataCount: number;
  faultCount: number;
  facetSplits: number;
  spacingMin: number;
  spacingMax: number;
  angleJitter: number;
  dotAccentFraction: number;
  gapFraction: number;
  strataEdges: boolean;
}

function quantiseAngle(a: number): number {
  return Math.round(a / ANGLE_QUANTUM) * ANGLE_QUANTUM;
}

function buildPanelContent(
  cx0: number,
  cx1: number,
  cy0: number,
  cy1: number,
  o: PanelOpts,
  rng: () => number,
): Pt[][] {
  const W = cx1 - cx0;
  const H = cy1 - cy0;
  const bands = o.strataCount;
  const bandH = H / bands;

  // ── Faults: vertical shear at a few seeded x positions ──
  const faults: Fault[] = [];
  let cum = 0;
  const cumCap = 0.6 * bandH;
  for (let i = 0; i < o.faultCount; i++) {
    // Nudged off the knot lattice so a fault never lands exactly on a sample.
    const fx = cx0 + W * (0.15 + 0.7 * rng()) + 0.137;
    const want = cum + (rng() * 2 - 1) * 0.75 * bandH;
    const clamped = Math.max(-cumCap, Math.min(cumCap, want));
    faults.push({ x: fx, dy: clamped - cum });
    cum = clamped;
  }
  faults.sort((a, b) => a.x - b.x);

  // ── Band boundaries: non-uniform heights ──
  const weights: number[] = [];
  let wSum = 0;
  for (let b = 0; b < bands; b++) {
    const w = 0.55 + rng() * 0.9;
    weights.push(w);
    wSum += w;
  }
  const baseYs: number[] = [cy0];
  let acc = 0;
  for (let b = 0; b < bands; b++) {
    acc += weights[b] / wSum;
    baseYs.push(cy0 + acc * H);
  }

  const knots = Math.max(5, Math.round(W / 55));
  const jitterAmp = bandH * 0.2;
  const boundaries = baseYs.map((y, b) =>
    buildBoundary(cx0, cx1, y, b === 0 || b === bands ? jitterAmp * 0.5 : jitterAmp, knots, faults, rng),
  );

  const lines: Pt[][] = [];

  for (let b = 0; b < bands; b++) {
    const top = boundaries[b];
    const bot = boundaries[b + 1];
    const thisBandH = baseYs[b + 1] - baseYs[b];

    // Whole-band gap — the dramatic deep-black horizontal void.
    const bandEmpty = rng() < o.gapFraction * 0.35;

    // ── Split into facets along slanted internal edges ──
    const k = 2 + Math.floor(rng() * Math.max(1, o.facetSplits - 1));
    const maxSlant = Math.min(0.35 * thisBandH, (0.15 * W) / k);
    const topXs: number[] = [cx0];
    const botXs: number[] = [cx0];
    for (let j = 1; j < k; j++) {
      const frac = j / k + (rng() - 0.5) * (0.6 / k);
      const tx = cx0 + frac * W;
      topXs.push(tx);
      botXs.push(tx + (rng() * 2 - 1) * maxSlant);
    }
    topXs.push(cx1);
    botXs.push(cx1);

    for (let j = 0; j < k; j++) {
      const topSub = subPolyByX(top, topXs[j], topXs[j + 1]);
      const botSub = subPolyByX(bot, botXs[j], botXs[j + 1]);
      if (topSub.length < 2 || botSub.length < 2) continue;
      const poly = [...topSub, ...botSub.slice().reverse()];

      // Drop slivers — a 3px-wide facet reads as a stray line, not a facet.
      let fx0 = Infinity;
      let fx1 = -Infinity;
      let fy0 = Infinity;
      let fy1 = -Infinity;
      for (const p of poly) {
        if (p.x < fx0) fx0 = p.x;
        if (p.x > fx1) fx1 = p.x;
        if (p.y < fy0) fy0 = p.y;
        if (p.y > fy1) fy1 = p.y;
      }
      if (fx1 - fx0 < 8 || fy1 - fy0 < 6) continue;

      const roll = rng();
      const spacingRoll = rng();
      const angleRoll = rng();
      const devRoll = rng();
      if (bandEmpty || roll < o.gapFraction) continue;

      // Tone: seeded, biased so deeper strata read denser (darker).
      const depth = bands > 1 ? b / (bands - 1) : 0;
      const tone = Math.max(0, Math.min(1, 0.72 * spacingRoll + 0.28 * (1 - depth)));
      const spacing = o.spacingMin + tone * (o.spacingMax - o.spacingMin);

      // Dot grid needs room for a real lattice — a one-column grid of dots
      // reads as a dotted line, so narrow facets fall through to hatching.
      const dotSpacing = spacing * 1.6;
      if (
        roll < o.gapFraction + o.dotAccentFraction &&
        fx1 - fx0 > 3 * dotSpacing &&
        fy1 - fy0 > 3 * dotSpacing
      ) {
        for (const l of dotGridLines(poly, dotSpacing)) lines.push(l);
        continue;
      }

      // Angle follows one of the facet's own bounding edges: usually the
      // stratum's own slope, sometimes the near-vertical cut edge.
      const a0 = topSub[0];
      const a1 = topSub[topSub.length - 1];
      const b1 = botSub[botSub.length - 1];
      const base =
        angleRoll < 0.65
          ? Math.atan2(a1.y - a0.y, a1.x - a0.x)
          : Math.atan2(b1.y - a1.y, b1.x - a1.x);
      const theta = quantiseAngle(base + (devRoll * 2 - 1) * o.angleJitter);

      for (const l of hatchPolygonLines(poly, theta, spacing)) lines.push(l);
    }

    if (o.strataEdges && b > 0) lines.push(top.map((p) => ({ x: p.x, y: p.y })));
  }

  return lines;
}

// ── Composition ─────────────────────────────────────────────────────────────

const strataTriptych: Composition2DDefinition = {
  id: "strataTriptych",
  name: "Strata Triptych",
  description:
    "Tall cropped panels of faceted geological strata — irregular slabs split into polygonal facets, each hatched at its own architectural angle and density, sheared by fault lines, with dot-grid accents and deep unhatched gaps. Built for white or metallic ink on black paper.",
  tags: ["2d", "generative", "geology", "hatching", "panels", "triptych"],
  category: "2d",
  type: "2d",
  renderMode: "immediate",

  controls: {
    panels: {
      type: "slider",
      label: "Panels",
      default: 3,
      min: 2,
      max: 5,
      step: 1,
      group: "Layout",
    },
    gutter: {
      type: "slider",
      label: "Gutter",
      default: 24,
      min: 0,
      max: 80,
      step: 2,
      group: "Layout",
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
    panelOutlines: {
      type: "toggle",
      label: "Panel Outlines",
      default: true,
      group: "Layout",
    },
    strataCount: {
      type: "slider",
      label: "Strata per Panel",
      default: 8,
      min: 3,
      max: 16,
      step: 1,
      group: "Strata",
    },
    faultCount: {
      type: "slider",
      label: "Fault Lines",
      default: 2,
      min: 0,
      max: 4,
      step: 1,
      group: "Strata",
    },
    facetSplits: {
      type: "slider",
      label: "Max Facets per Stratum",
      default: 4,
      min: 2,
      max: 6,
      step: 1,
      group: "Strata",
    },
    strataEdges: {
      type: "toggle",
      label: "Stratum Edges",
      default: true,
      group: "Strata",
    },
    hatchSpacingMin: {
      type: "slider",
      label: "Hatch Spacing — Dense",
      default: 2,
      min: 1,
      max: 8,
      step: 0.25,
      group: "Hatching",
    },
    hatchSpacingMax: {
      type: "slider",
      label: "Hatch Spacing — Sparse",
      default: 8,
      min: 3,
      max: 20,
      step: 0.5,
      group: "Hatching",
    },
    angleJitter: {
      type: "slider",
      label: "Angle Jitter °",
      default: 30,
      min: 0,
      max: 60,
      step: 1,
      group: "Hatching",
    },
    dotAccentFraction: {
      type: "slider",
      label: "Dot-Grid Fraction",
      default: 0.16,
      min: 0,
      max: 0.5,
      step: 0.02,
      group: "Hatching",
    },
    gapFraction: {
      type: "slider",
      label: "Black Gap Fraction",
      default: 0.16,
      min: 0,
      max: 0.5,
      step: 0.02,
      group: "Hatching",
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
  },

  generate({ width, height, values }) {
    const panels = Math.max(2, Math.min(5, Math.round((values.panels as number) ?? 3)));
    const gutter = Math.max(0, (values.gutter as number) ?? 24);
    const margin = Math.max(0, (values.margin as number) ?? 40);
    const panelOutlines = (values.panelOutlines as boolean) ?? true;
    const seed = Math.round((values.seed as number) ?? 42);

    const spacingMin = Math.max(0.5, (values.hatchSpacingMin as number) ?? 2);
    const spacingMax = Math.max(spacingMin + 0.25, (values.hatchSpacingMax as number) ?? 8);

    const opts: PanelOpts = {
      strataCount: Math.max(2, Math.round((values.strataCount as number) ?? 8)),
      faultCount: Math.max(0, Math.round((values.faultCount as number) ?? 2)),
      facetSplits: Math.max(2, Math.round((values.facetSplits as number) ?? 4)),
      spacingMin,
      spacingMax,
      angleJitter: Math.max(0, (values.angleJitter as number) ?? 30) * DEG,
      dotAccentFraction: Math.max(0, Math.min(1, (values.dotAccentFraction as number) ?? 0.16)),
      gapFraction: Math.max(0, Math.min(1, (values.gapFraction as number) ?? 0.16)),
      strataEdges: (values.strataEdges as boolean) ?? true,
    };

    const innerW = width - 2 * margin;
    const innerH = height - 2 * margin;
    const panelW = (innerW - gutter * (panels - 1)) / panels;
    if (panelW < 8 || innerH < 8) return [];

    const out: Pt[][] = [];

    for (let p = 0; p < panels; p++) {
      const px0 = margin + p * (panelW + gutter);
      const px1 = px0 + panelW;
      const py0 = margin;
      const py1 = margin + innerH;

      const ring: Pt[] = [
        { x: px0, y: py0 },
        { x: px1, y: py0 },
        { x: px1, y: py1 },
        { x: px0, y: py1 },
      ];

      // Oversize the content so facets run off-panel and crop cleanly.
      const overX = panelW * 0.14;
      const overY = innerH * 0.1;
      const rng = mulberry32(seed * 9176 + p * 7919 + 17);
      const raw = buildPanelContent(
        px0 - overX,
        px1 + overX,
        py0 - overY,
        py1 + overY,
        opts,
        rng,
      );

      for (const l of clipPolylinesToSilhouette(raw, [ring], "inside")) out.push(l);
      if (panelOutlines) out.push([...ring, { x: px0, y: py0 }]);
    }

    return out;
  },
};

export default strataTriptych;
