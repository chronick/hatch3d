/**
 * Presentation model for the InkSight browser report.
 *
 * Pure `StatsReport` → view-model translation: no DOM, no measurement. Every
 * number here comes from src/stats/analyze.ts (the same core `npm run stats`
 * uses); this module only decides how those numbers are labelled, formatted and
 * shaded, so the DOM glue in main.ts stays a dumb renderer and the formatting
 * rules stay unit-testable.
 */

import type { StatsReport } from "../stats/analyze";

/** One-line scope reminder shown whenever the analyzer rejects a file. */
export const SCOPE_NOTE =
  "InkSight v1 measures hatch3d-exporter SVGs: absolute M/L polyline paths in a translate(cx,cy) scale(S) group, with an mm-unit viewBox.";

/**
 * Coefficient-of-variation bands for spatial balance, matching the guidance in
 * cli/README.md ("Reading the numbers"). Below `even` the ink is spread
 * uniformly; above `clumped` it pools in part of the page.
 */
export const BALANCE_THRESHOLDS = { even: 0.5, clumped: 1.5 };

/** Hue/saturation of the heatmap ramp; only lightness varies with coverage. */
const HEAT_HUE = 190;
const HEAT_SAT = 85;
const HEAT_MIN_LIGHT = 8;
const HEAT_MAX_LIGHT = 64;

export interface StatRow {
  label: string;
  value: string;
}

export interface LayerRow {
  id: string;
  /** Declared stroke, or null when the layer inherits the group stroke. */
  stroke: string | null;
  /** Color to paint the swatch with — black when the stroke is inherited. */
  swatch: string;
  paths: string;
  vertices: string;
  arcLength: string;
  inkDensity: string;
}

export interface HeatCell {
  row: number;
  col: number;
  coverage: number;
  /** CSS color for the cell fill. */
  shade: string;
  /** Tooltip text: cell address plus its coverage. */
  title: string;
}

export interface HeatmapModel {
  cols: number;
  rows: number;
  cells: HeatCell[];
  stats: StatRow[];
}

export interface WarningItem {
  level: "ok" | "warn";
  text: string;
}

export interface ReportModel {
  summary: StatRow[];
  totals: StatRow[];
  layers: LayerRow[];
  heatmap: HeatmapModel;
  warnings: WarningItem[];
}

/** Fixed-decimal number with thousands separators, trailing zeros trimmed. */
export function fmtNum(n: number, dp = 2): string {
  if (!Number.isFinite(n)) return "—";
  const fixed = n.toFixed(dp);
  const [whole, frac] = fixed.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  if (!frac) return grouped;
  const trimmed = frac.replace(/0+$/, "");
  return trimmed ? `${grouped}.${trimmed}` : grouped;
}

export function fmtMm(n: number, dp = 1): string {
  return `${fmtNum(n, dp)} mm`;
}

export function fmtPercent(ratio: number, dp = 1): string {
  if (!Number.isFinite(ratio)) return "—";
  return `${fmtNum(ratio * 100, dp)}%`;
}

/**
 * Map a cell's coverage onto the heatmap ramp. Normalized against the grid max
 * rather than the saturation threshold so a sparse plot still shows structure;
 * absolute coverage stays visible in the cell tooltip.
 */
export function heatShade(coverage: number, max: number): string {
  const t = max > 0 ? Math.min(1, Math.max(0, coverage / max)) : 0;
  const light = HEAT_MIN_LIGHT + t * (HEAT_MAX_LIGHT - HEAT_MIN_LIGHT);
  return `hsl(${HEAT_HUE} ${HEAT_SAT}% ${fmtNum(light, 1)}%)`;
}

/** Human phrase for a density-grid coefficient of variation. */
export function balanceLabel(cv: number): string {
  if (cv <= BALANCE_THRESHOLDS.even) return "even";
  if (cv >= BALANCE_THRESHOLDS.clumped) return "clumped";
  return "uneven";
}

function summaryRows(r: StatsReport): StatRow[] {
  return [
    { label: "page", value: `${fmtNum(r.page.widthMm, 1)} × ${fmtMm(r.page.heightMm)}` },
    {
      label: "drawable",
      value: `${fmtNum(r.drawable.widthMm, 1)} × ${fmtMm(r.drawable.heightMm)} at (${fmtNum(
        r.drawable.xMm,
        1,
      )}, ${fmtNum(r.drawable.yMm, 1)})`,
    },
    { label: "pen width", value: `${fmtNum(r.penWidthMm, 3)} mm (${r.penWidthSource})` },
    { label: "scale", value: `${fmtNum(r.scale, 5)} path-space → mm` },
  ];
}

function totalsRows(r: StatsReport): StatRow[] {
  const t = r.totals;
  const travelRatio = t.arcLengthMm > 0 ? t.penUpTravelMm / t.arcLengthMm : 0;
  return [
    { label: "layers", value: fmtNum(t.layers, 0) },
    { label: "paths", value: fmtNum(t.paths, 0) },
    { label: "vertices", value: fmtNum(t.vertices, 0) },
    { label: "segments", value: fmtNum(t.segments, 0) },
    { label: "arc length", value: fmtMm(t.arcLengthMm) },
    {
      label: "pen-up travel",
      value: `${fmtMm(t.penUpTravelMm)} (${fmtPercent(travelRatio)} of drawn)`,
    },
    {
      label: "bounding box",
      value: `${fmtNum(t.boundingBox.widthMm, 1)} × ${fmtMm(t.boundingBox.heightMm)}`,
    },
    { label: "bbox coverage", value: fmtPercent(t.bboxCoverageRatio) },
    { label: "ink density", value: fmtPercent(t.inkDensity, 2) },
  ];
}

function layerRows(r: StatsReport): LayerRow[] {
  return r.layers.map((l) => ({
    id: l.id,
    stroke: l.stroke,
    swatch: l.stroke ?? "#000000",
    paths: fmtNum(l.paths, 0),
    vertices: fmtNum(l.vertices, 0),
    arcLength: fmtMm(l.arcLengthMm),
    inkDensity: fmtPercent(l.inkDensity, 2),
  }));
}

function heatmap(r: StatsReport): HeatmapModel {
  const g = r.densityGrid;
  const cells: HeatCell[] = [];
  for (let row = 0; row < g.cells.length; row++) {
    for (let col = 0; col < g.cells[row].length; col++) {
      const coverage = g.cells[row][col];
      cells.push({
        row,
        col,
        coverage,
        shade: heatShade(coverage, g.max),
        title: `r${row}c${col} — coverage ${fmtPercent(coverage, 2)}`,
      });
    }
  }
  return {
    cols: g.cols,
    rows: g.rows,
    cells,
    stats: [
      { label: "max", value: fmtPercent(g.max, 2) },
      { label: "mean", value: fmtPercent(g.mean, 2) },
      { label: "cv", value: `${fmtNum(g.cv, 3)} (${balanceLabel(g.cv)})` },
    ],
  };
}

function warnings(r: StatsReport): WarningItem[] {
  const w = r.warnings;
  const g = r.densityGrid;
  const items: WarningItem[] = [];

  items.push(
    w.marginViolationPaths > 0
      ? {
          level: "warn",
          text: `${fmtNum(w.marginViolationPaths, 0)} path(s) reach outside the drawable rect — the margin clip will cut them off.`,
        }
      : { level: "ok", text: "No geometry crosses the margin clip." },
  );

  items.push(
    w.saturatedCells > 0
      ? {
          level: "warn",
          text: `${fmtNum(w.saturatedCells, 0)} of ${g.rows * g.cols} grid cells are at or above ${fmtPercent(
            w.saturationThreshold,
            0,
          )} coverage — they plot as solid ink at this pen width.`,
        }
      : { level: "ok", text: "No grid cell saturates at this pen width." },
  );

  items.push(
    g.cv >= BALANCE_THRESHOLDS.clumped
      ? {
          level: "warn",
          text: `Density cv ${fmtNum(g.cv, 3)} — ink is clumped rather than spread across the page.`,
        }
      : { level: "ok", text: `Density cv ${fmtNum(g.cv, 3)} — spatial balance reads ${balanceLabel(g.cv)}.` },
  );

  return items;
}

/** Build the full view-model an InkSight page renders. */
export function buildReportModel(r: StatsReport): ReportModel {
  return {
    summary: summaryRows(r),
    totals: totalsRows(r),
    layers: layerRows(r),
    heatmap: heatmap(r),
    warnings: warnings(r),
  };
}
