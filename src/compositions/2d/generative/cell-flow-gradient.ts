/**
 * cell-flow-gradient — Voronoi cells with rounded inset borders, each packed
 * with wavy near-vertical lines whose per-line phase drift produces horizontal
 * density banding.
 *
 * The r/PlotterArt "1v4l3m5" look (research pod
 * `research/2026-08-18-plotterart-new-ideas/`): a relaxed Voronoi partition
 * splits the page into stone-like cells, each cell is pulled back by a gutter
 * so a clean white channel runs between neighbours, its corners are rounded,
 * the boundary is drawn heavy, and the interior is filled with sinusoidal
 * near-vertical lines. Because each successive line's phase is shifted a
 * little (`phaseVariation`), neighbouring lines converge and diverge across
 * the cell — the light/dark vertical bands that make the fill read as a
 * gradient rather than a texture. Per-cell phase and line density come from
 * the seed, so no two cells look alike.
 *
 * The rounded inset boundary is *not* computed here: it comes from
 * `insetAndRoundPolygon` in `src/operators/region-shapes.ts`, the same helper
 * the patch engine's `regionOf { cornerRadius }` uses. One implementation of
 * rounded-inset regions, two consumers (design principle #6 — compositions
 * decompose into shared components).
 *
 * **Multi-pen**: this emits a single pen for now, but each cell's fill lines
 * are emitted strictly left-to-right and contiguously, so a later pass can map
 * a cell's consecutive line runs onto a colour ramp (the reference piece is a
 * warm gradient) without re-deriving the geometry.
 *
 * Deterministic: one mulberry32 stream for the site layout, one hash-derived
 * value per cell for phase/density. No Math.random anywhere.
 */

import type { Composition2DDefinition } from "../../types";
import { mulberry32, hash01 } from "../../../utils/prng";
import { clipPolylinesToSilhouette } from "../../../operators/silhouette-knockout";
import { insetAndRoundPolygon } from "../../../operators/region-shapes";

export type Pt = { x: number; y: number };

/** Lloyd relaxation passes — enough to even the cells out, cheap at these counts. */
const RELAX_ITERATIONS = 3;
/** Vertical sampling step of a wavy fill line, in px. */
const WAVE_SAMPLE_STEP = 3;
/** Wave frequency is expressed in cycles per this many px of height. */
const WAVE_PERIOD_PX = 100;
/** Per-cell line-spacing jitter: multiplier lands in 1 ± this. */
export const CELL_DENSITY_JITTER = 0.35;
/** Concentric passes drawn for a "heavy" cell outline, and their inset in px. */
const OUTLINE_PASSES = 2;
const OUTLINE_PASS_INSET = 1.6;

// ── Convex polygon helpers (local: half-space clipping for the cells) ────────

/** Clip a convex polygon to the half-space `nx*x + ny*y <= c`. */
function clipHalfSpace(poly: Pt[], nx: number, ny: number, c: number): Pt[] {
  if (poly.length < 3) return [];
  const out: Pt[] = [];
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const cur = poly[i];
    const prev = poly[j];
    const dCur = nx * cur.x + ny * cur.y - c;
    const dPrev = nx * prev.x + ny * prev.y - c;
    if (dCur <= 0) {
      if (dPrev > 0) {
        const t = dPrev / (dPrev - dCur);
        out.push({ x: prev.x + t * (cur.x - prev.x), y: prev.y + t * (cur.y - prev.y) });
      }
      out.push({ x: cur.x, y: cur.y });
    } else if (dPrev <= 0) {
      const t = dPrev / (dPrev - dCur);
      out.push({ x: prev.x + t * (cur.x - prev.x), y: prev.y + t * (cur.y - prev.y) });
    }
  }
  return out.length >= 3 ? out : [];
}

/**
 * The Voronoi cell of `sites[i]` clipped to `bounds`, by intersecting the
 * half-space on this site's side of every perpendicular bisector.
 *
 * O(n²) over the sites, which at the tens-of-cells this composition works in
 * is far cheaper — and far more robust at the boundary — than building a
 * Delaunay triangulation and walking its dual.
 */
export function voronoiCell(sites: Pt[], i: number, bounds: Pt[]): Pt[] {
  let poly = bounds.map((p) => ({ x: p.x, y: p.y }));
  const s = sites[i];
  for (let j = 0; j < sites.length && poly.length >= 3; j++) {
    if (j === i) continue;
    const o = sites[j];
    const nx = o.x - s.x;
    const ny = o.y - s.y;
    if (Math.abs(nx) < 1e-12 && Math.abs(ny) < 1e-12) continue;
    const mx = (s.x + o.x) / 2;
    const my = (s.y + o.y) / 2;
    poly = clipHalfSpace(poly, nx, ny, nx * mx + ny * my);
  }
  return poly;
}

function polygonCentroid(poly: Pt[]): Pt | null {
  let a2 = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const cross = poly[j].x * poly[i].y - poly[i].x * poly[j].y;
    a2 += cross;
    cx += (poly[j].x + poly[i].x) * cross;
    cy += (poly[j].y + poly[i].y) * cross;
  }
  if (Math.abs(a2) < 1e-9) return null;
  return { x: cx / (3 * a2), y: cy / (3 * a2) };
}

const cellFlowGradient: Composition2DDefinition = {
  id: "cellFlowGradient",
  name: "Cell Flow Gradient",
  description:
    "Relaxed Voronoi cells with rounded inset borders, each filled with phase-drifting wavy vertical lines that band into a gradient",
  tags: ["generative", "voronoi", "waves", "gradient", "cells"],
  category: "2d",
  type: "2d",

  macros: {
    density: {
      label: "Density",
      default: 0.5,
      targets: [
        { param: "lineSpacing", fn: "linear", strength: -0.7 },
        { param: "cells", fn: "linear", strength: 0.4 },
      ],
    },
    flow: {
      label: "Flow",
      default: 0.5,
      targets: [
        { param: "waveAmplitude", fn: "linear", strength: 0.8 },
        { param: "phaseVariation", fn: "linear", strength: 0.6 },
      ],
    },
  },

  controls: {
    cells: {
      type: "slider", label: "Cells", default: 15, min: 3, max: 80, step: 1, group: "Layout",
    },
    margin: {
      type: "slider", label: "Margin", default: 40, min: 0, max: 150, step: 5, group: "Layout",
    },
    gutter: {
      type: "slider", label: "Gutter", default: 14, min: 0, max: 60, step: 1, group: "Layout",
    },
    cornerRadius: {
      type: "slider", label: "Corner Radius", default: 22, min: 0, max: 80, step: 1, group: "Layout",
    },
    lineSpacing: {
      type: "slider", label: "Line Spacing", default: 3.2, min: 1, max: 20, step: 0.2, group: "Fill",
    },
    waveAmplitude: {
      type: "slider", label: "Wave Amplitude", default: 9, min: 0, max: 40, step: 0.5, group: "Fill",
    },
    waveFrequency: {
      type: "slider", label: "Wave Frequency", default: 1.1, min: 0.1, max: 6, step: 0.05, group: "Fill",
    },
    phaseVariation: {
      type: "slider", label: "Phase Variation", default: 0.12, min: 0, max: 1, step: 0.01, group: "Fill",
    },
    outline: {
      type: "toggle", label: "Cell Outline", default: true, group: "Fill",
    },
    seed: {
      type: "slider", label: "Seed", default: 7, min: 0, max: 9999, step: 1, group: "Layout",
    },
  },

  generate({ width, height, values }) {
    const cellCount = Math.max(3, Math.round(values.cells as number));
    const margin = Math.max(0, values.margin as number);
    const gutter = Math.max(0, values.gutter as number);
    const cornerRadius = Math.max(0, values.cornerRadius as number);
    const lineSpacing = Math.max(0.5, values.lineSpacing as number);
    const waveAmplitude = Math.max(0, values.waveAmplitude as number);
    const waveFrequency = Math.max(0.01, values.waveFrequency as number);
    const phaseVariation = values.phaseVariation as number;
    const outline = values.outline as boolean;
    const seed = Math.round(values.seed as number);

    const x0 = margin;
    const y0 = margin;
    const x1 = width - margin;
    const y1 = height - margin;
    if (x1 - x0 < 4 || y1 - y0 < 4) return [];

    const bounds: Pt[] = [
      { x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 },
    ];

    // ── Sites: jittered grid, then Lloyd-relaxed so cells read even ──
    const rng = mulberry32(seed * 2654435761 + 12345);
    const cols = Math.max(1, Math.round(Math.sqrt((cellCount * (x1 - x0)) / (y1 - y0))));
    const rows = Math.max(1, Math.ceil(cellCount / cols));
    const sites: Pt[] = [];
    for (let r = 0; r < rows && sites.length < cellCount; r++) {
      for (let c = 0; c < cols && sites.length < cellCount; c++) {
        const cw = (x1 - x0) / cols;
        const ch = (y1 - y0) / rows;
        sites.push({
          x: x0 + (c + 0.5) * cw + (rng() - 0.5) * cw * 0.7,
          y: y0 + (r + 0.5) * ch + (rng() - 0.5) * ch * 0.7,
        });
      }
    }

    for (let iter = 0; iter < RELAX_ITERATIONS; iter++) {
      for (let i = 0; i < sites.length; i++) {
        const cell = voronoiCell(sites, i, bounds);
        const centroid = cell.length >= 3 ? polygonCentroid(cell) : null;
        if (centroid) sites[i] = centroid;
      }
    }

    // ── Per cell: rounded inset boundary + phase-drifting wavy fill ──
    const polylines: Pt[][] = [];

    for (let i = 0; i < sites.length; i++) {
      const cell = voronoiCell(sites, i, bounds);
      if (cell.length < 3) continue;

      const ring = insetAndRoundPolygon(cell, gutter / 2, cornerRadius);
      if (ring.length < 3) continue;

      if (outline) {
        for (let pass = 0; pass < OUTLINE_PASSES; pass++) {
          const r = pass === 0 ? ring : insetAndRoundPolygon(cell, gutter / 2 + pass * OUTLINE_PASS_INSET, cornerRadius);
          if (r.length < 3) continue;
          polylines.push([...r.map((p) => ({ x: p.x, y: p.y })), { x: r[0].x, y: r[0].y }]);
        }
      }

      // Cell bounds drive the scan range; the wave can push a line up to
      // `waveAmplitude` sideways, so start that far outside and let the clip
      // decide what survives.
      let cx0 = Infinity, cy0 = Infinity, cx1 = -Infinity, cy1 = -Infinity;
      for (const p of ring) {
        if (p.x < cx0) cx0 = p.x;
        if (p.x > cx1) cx1 = p.x;
        if (p.y < cy0) cy0 = p.y;
        if (p.y > cy1) cy1 = p.y;
      }

      // Seed-derived per-cell character: phase offset and line density.
      const cellPhase = hash01(seed, i * 2 + 1) * Math.PI * 2;
      const spacing = lineSpacing * (1 + (hash01(seed, i * 2 + 2) - 0.5) * 2 * CELL_DENSITY_JITTER);

      const raw: Pt[][] = [];
      let lineIndex = 0;
      // Left-to-right: consecutive lines stay adjacent in the output so a
      // future multi-pen pass can walk them as a colour ramp.
      for (let x = cx0 - waveAmplitude; x <= cx1 + waveAmplitude; x += spacing) {
        const phase = cellPhase + phaseVariation * lineIndex;
        const line: Pt[] = [];
        for (let y = cy0; y <= cy1 + WAVE_SAMPLE_STEP; y += WAVE_SAMPLE_STEP) {
          const yy = Math.min(y, cy1);
          line.push({
            x: x + waveAmplitude * Math.sin((2 * Math.PI * waveFrequency * yy) / WAVE_PERIOD_PX + phase),
            y: yy,
          });
          if (yy >= cy1) break;
        }
        if (line.length >= 2) raw.push(line);
        lineIndex++;
      }

      polylines.push(...clipPolylinesToSilhouette(raw, [ring], "inside"));
    }

    return polylines;
  },
};

export default cellFlowGradient;
