/**
 * Deterministic SVG measurement for pen-plotter line art.
 *
 * Parses a hatch3d-emitted SVG (see cli/svg-export.ts) into a structured,
 * machine-readable report: path/vertex counts, physical arc length, per-layer
 * breakdown, an ink-density grid, pen-travel estimate, and plottability
 * warnings. All measurements are deterministic — no rendering, no model calls.
 *
 * This is the "measurement half" of the agent loop (see the vault design pod
 * active/plotter-art-workflow). The CLI (cli/stats.ts) is a thin wrapper; the
 * InkSight browser tool consumes the same functions.
 *
 * Scope: targets SVG produced by hatch3d's exporter — polyline paths using
 * only M/L/Z commands, wrapped in a `translate(cx,cy) scale(S)` group, with
 * a mm-unit viewBox and a margin clip rect. Curves (C/Q/A/…) are rejected
 * with a clear error rather than silently mis-measured.
 */

export interface PageDims {
  widthMm: number;
  heightMm: number;
}

export interface DrawableArea {
  xMm: number;
  yMm: number;
  widthMm: number;
  heightMm: number;
  areaMm2: number;
}

export interface BoundingBox {
  xMm: number;
  yMm: number;
  widthMm: number;
  heightMm: number;
}

export interface LayerStats {
  /** Group id from the SVG (`layer-0`, a pen name, or `default` for single-group). */
  id: string;
  /** Stroke color if declared on the group, else null (inherits black). */
  stroke: string | null;
  paths: number;
  vertices: number;
  segments: number;
  arcLengthMm: number;
  /** Coverage proxy: arcLength × penWidth / drawableArea. */
  inkDensity: number;
}

export interface DensityGrid {
  cols: number;
  rows: number;
  /** rows × cols matrix of per-cell coverage (arcLength × penWidth / cellArea). */
  cells: number[][];
  max: number;
  mean: number;
  /** Coefficient of variation of cell coverage — a spatial-balance signal. */
  cv: number;
}

export interface StatsWarnings {
  /** Paths with at least one vertex outside the margin (would be clipped). */
  marginViolationPaths: number;
  /** Grid cells whose coverage ≥ saturationThreshold (effectively solid ink). */
  saturatedCells: number;
  /** Coverage at or above which line spacing is below pen width (solid fill). */
  saturationThreshold: number;
}

export interface StatsReport {
  input: string | null;
  page: PageDims;
  drawable: DrawableArea;
  /** Effective pen width used for density/coverage, and where it came from. */
  penWidthMm: number;
  penWidthSource: "flag" | "svg" | "default";
  /** Path-space → mm scale factor recovered from the group transform. */
  scale: number;
  totals: {
    layers: number;
    paths: number;
    vertices: number;
    segments: number;
    arcLengthMm: number;
    /** Pen-up travel between consecutive paths in file order (no reordering). */
    penUpTravelMm: number;
    boundingBox: BoundingBox;
    /** bbox area / drawable area. */
    bboxCoverageRatio: number;
    /** Global coverage proxy: arcLength × penWidth / drawableArea. */
    inkDensity: number;
  };
  layers: LayerStats[];
  densityGrid: DensityGrid;
  warnings: StatsWarnings;
}

export interface AnalyzeOptions {
  /** Override pen width (mm). If omitted, recovered from the SVG stroke-width. */
  penWidthMm?: number;
  /** Density grid resolution (cols = rows). Default 8. */
  grid?: number;
  /** Coverage at/above which a cell counts as saturated. Default 1.0. */
  saturationThreshold?: number;
  /** Label carried into the report (usually the file path). */
  input?: string | null;
}

const DEFAULT_GRID = 8;
const DEFAULT_SATURATION = 1.0;
const DEFAULT_PEN_WIDTH = 0.5;

interface Pt {
  x: number;
  y: number;
}

/**
 * Parse a polyline path `d` string into points (path-space coordinates).
 * hatch3d emits only `M`/`L` (and never `Z`, but we accept it). Any curve or
 * relative command throws — silently approximating curves would corrupt every
 * downstream measurement.
 */
export function parsePolyline(d: string): Pt[] {
  const bad = d.match(/[CcSsQqTtAaHhVvZz]/);
  if (bad) {
    const cmd = bad[0];
    if (cmd === "Z" || cmd === "z") {
      // Closepath is representable, but hatch3d never emits it and handling it
      // would require tracking subpath starts. Reject explicitly for v1.
      throw new Error(
        `Path uses closepath ('${cmd}'); hatch3d stats supports open M/L polylines only.`,
      );
    }
    throw new Error(
      `Path contains non-polyline command '${cmd}' (curves/arcs/relative moves are not supported; hatch3d emits only absolute M/L).`,
    );
  }
  const chunks = d.match(/[ML][^ML]*/g);
  if (!chunks) return [];
  const pts: Pt[] = [];
  for (const chunk of chunks) {
    const rest = chunk.slice(1).trim();
    if (!rest) continue;
    // A command may carry multiple coordinate pairs; split on any run of
    // separators (comma or whitespace) and consume two at a time.
    const nums = rest.split(/[\s,]+/).map(Number);
    for (let i = 0; i + 1 < nums.length; i += 2) {
      const x = nums[i];
      const y = nums[i + 1];
      if (Number.isNaN(x) || Number.isNaN(y)) {
        throw new Error(`Malformed coordinate in path segment: "${chunk}"`);
      }
      pts.push({ x, y });
    }
  }
  return pts;
}

interface ParsedLayer {
  id: string;
  stroke: string | null;
  paths: string[];
}

interface ParsedSvg {
  page: PageDims;
  drawable: DrawableArea;
  scale: number;
  strokeWidthAttr: number | null;
  layers: ParsedLayer[];
}

function attr(tag: string, name: string): string | null {
  // Require a non-name char (or start) before the attribute so `id` doesn't
  // match inside `grid` / `data-id`.
  const m = tag.match(new RegExp(`(?:^|[\\s;])${name}\\s*=\\s*"([^"]*)"`));
  return m ? m[1] : null;
}

/** Extract page dims, drawable rect, transform scale, and grouped paths. */
export function parseSvg(svg: string): ParsedSvg {
  // Page dims from viewBox (mm, since width/height carry the mm unit).
  const vb = svg.match(/viewBox\s*=\s*"([\d.eE+-]+)\s+([\d.eE+-]+)\s+([\d.eE+-]+)\s+([\d.eE+-]+)"/);
  if (!vb) throw new Error("SVG has no viewBox; cannot establish page dimensions.");
  const page: PageDims = { widthMm: Number(vb[3]), heightMm: Number(vb[4]) };

  // Drawable rect from the margin clip. Fall back to full page if absent.
  const clipBlock = svg.match(/<clipPath[^>]*>([\s\S]*?)<\/clipPath>/);
  let drawable: DrawableArea;
  const rectTag = clipBlock?.[1].match(/<rect[^>]*\/?>/)?.[0];
  if (rectTag) {
    const x = Number(attr(rectTag, "x") ?? 0);
    const y = Number(attr(rectTag, "y") ?? 0);
    const w = Number(attr(rectTag, "width") ?? page.widthMm);
    const h = Number(attr(rectTag, "height") ?? page.heightMm);
    drawable = { xMm: x, yMm: y, widthMm: w, heightMm: h, areaMm2: w * h };
  } else {
    drawable = {
      xMm: 0,
      yMm: 0,
      widthMm: page.widthMm,
      heightMm: page.heightMm,
      areaMm2: page.widthMm * page.heightMm,
    };
  }

  // The inner transform group establishes the path-space → mm scale and the
  // fallback stroke width. Match the first group carrying a scale() transform.
  const scaleMatch = svg.match(/transform\s*=\s*"[^"]*scale\(\s*([\d.eE+-]+)\s*\)[^"]*"/);
  const scale = scaleMatch ? Number(scaleMatch[1]) : 1;

  const transformGroupTag = svg.match(/<g[^>]*transform\s*=\s*"[^"]*scale\([^)]*\)[^"]*"[^>]*>/)?.[0];
  const swAttr = transformGroupTag ? attr(transformGroupTag, "stroke-width") : null;
  const strokeWidthAttr = swAttr != null ? Number(swAttr) : null;

  // Collect paths, grouped by nested <g> layer (layered export) or a single
  // implicit layer (single-group export). Assign each path to the most recent
  // layer-group open tag before it — robust for the well-formed exporter output.
  const layerOpens: { id: string; stroke: string | null; index: number }[] = [];
  const groupRe = /<g\b([^>]*)>/g;
  let gm: RegExpExecArray | null;
  while ((gm = groupRe.exec(svg)) !== null) {
    const attrs = gm[1];
    // A "layer" group is one carrying an id (the exporter always sets id on
    // layer groups). The outer transform group has no id.
    const id = attr(`<g ${attrs}>`, "id");
    if (id != null) {
      layerOpens.push({ id, stroke: attr(`<g ${attrs}>`, "stroke"), index: gm.index });
    }
  }

  const pathRe = /<path\b[^>]*\bd\s*=\s*"([^"]*)"[^>]*\/?>/g;
  const paths: { d: string; index: number }[] = [];
  let pm: RegExpExecArray | null;
  while ((pm = pathRe.exec(svg)) !== null) {
    paths.push({ d: pm[1], index: pm.index });
  }

  let layers: ParsedLayer[];
  if (layerOpens.length > 0) {
    layers = layerOpens.map((l) => ({ id: l.id, stroke: l.stroke, paths: [] as string[] }));
    for (const p of paths) {
      // Find the last layer opened before this path.
      let assigned = -1;
      for (let i = 0; i < layerOpens.length; i++) {
        if (layerOpens[i].index < p.index) assigned = i;
        else break;
      }
      if (assigned >= 0) layers[assigned].paths.push(p.d);
    }
    // Drop any layer that ended up empty (defensive).
    layers = layers.filter((l) => l.paths.length > 0);
  } else {
    layers = [{ id: "default", stroke: null, paths: paths.map((p) => p.d) }];
  }

  return { page, drawable, scale, strokeWidthAttr, layers };
}

/** Analyze a hatch3d SVG string into a structured report. */
export function analyzeSvg(svg: string, opts: AnalyzeOptions = {}): StatsReport {
  const parsed = parseSvg(svg);
  const grid = Math.max(1, Math.floor(opts.grid ?? DEFAULT_GRID));
  const saturationThreshold = opts.saturationThreshold ?? DEFAULT_SATURATION;
  const { scale, drawable, page } = parsed;

  // Resolve pen width: explicit flag > recovered from SVG > default.
  let penWidthMm: number;
  let penWidthSource: StatsReport["penWidthSource"];
  if (opts.penWidthMm != null) {
    penWidthMm = opts.penWidthMm;
    penWidthSource = "flag";
  } else if (parsed.strokeWidthAttr != null) {
    // stroke-width attr is in path-space (strokeWidthMm / scale); recover mm.
    penWidthMm = parsed.strokeWidthAttr * scale;
    penWidthSource = "svg";
  } else {
    penWidthMm = DEFAULT_PEN_WIDTH;
    penWidthSource = "default";
  }

  // Transform path-space → mm. Only scale affects lengths; translate affects
  // absolute position (needed for grid/bbox/margin). Recover translate too.
  const translateMatch = svg.match(/translate\(\s*([\d.eE+-]+)\s*,\s*([\d.eE+-]+)\s*\)/);
  const cx = translateMatch ? Number(translateMatch[1]) : 0;
  const cy = translateMatch ? Number(translateMatch[2]) : 0;

  const cellW = drawable.widthMm / grid;
  const cellH = drawable.heightMm / grid;
  const cellArea = cellW * cellH;
  const cellArc: number[][] = Array.from({ length: grid }, () => new Array(grid).fill(0));

  let totalArc = 0;
  let totalVerts = 0;
  let totalSegs = 0;
  let totalPaths = 0;
  let penUp = 0;
  let marginViolations = 0;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let prevEnd: Pt | null = null;

  const layerStats: LayerStats[] = [];

  const eps = 1e-6;
  const inDrawable = (mx: number, my: number) =>
    mx >= drawable.xMm - eps &&
    mx <= drawable.xMm + drawable.widthMm + eps &&
    my >= drawable.yMm - eps &&
    my <= drawable.yMm + drawable.heightMm + eps;

  for (const layer of parsed.layers) {
    let layerArc = 0;
    let layerVerts = 0;
    let layerSegs = 0;

    for (const d of layer.paths) {
      const pts = parsePolyline(d);
      if (pts.length === 0) continue;
      totalPaths++;
      layerVerts += pts.length;

      // Map to mm once.
      const mm = pts.map((p) => ({ x: cx + p.x * scale, y: cy + p.y * scale }));

      let pathHasViolation = false;
      for (let i = 0; i < mm.length; i++) {
        const m = mm[i];
        if (m.x < minX) minX = m.x;
        if (m.y < minY) minY = m.y;
        if (m.x > maxX) maxX = m.x;
        if (m.y > maxY) maxY = m.y;
        if (!inDrawable(m.x, m.y)) pathHasViolation = true;
      }
      if (pathHasViolation) marginViolations++;

      for (let i = 1; i < mm.length; i++) {
        const a = mm[i - 1];
        const b = mm[i];
        const segLen = Math.hypot(b.x - a.x, b.y - a.y);
        layerArc += segLen;
        layerSegs++;

        // Accumulate into the density cell containing the segment midpoint.
        const midX = (a.x + b.x) / 2;
        const midY = (a.y + b.y) / 2;
        const col = Math.floor((midX - drawable.xMm) / cellW);
        const row = Math.floor((midY - drawable.yMm) / cellH);
        if (col >= 0 && col < grid && row >= 0 && row < grid) {
          cellArc[row][col] += segLen;
        }
      }

      // Pen-up travel: gap from previous path's end to this path's start.
      const start = mm[0];
      const end = mm[mm.length - 1];
      if (prevEnd) penUp += Math.hypot(start.x - prevEnd.x, start.y - prevEnd.y);
      prevEnd = end;
    }

    layerArc = round(layerArc);
    layerStats.push({
      id: layer.id,
      stroke: layer.stroke,
      paths: layer.paths.length,
      vertices: layerVerts,
      segments: layerSegs,
      arcLengthMm: layerArc,
      inkDensity: round((layerArc * penWidthMm) / drawable.areaMm2, 4),
    });

    totalArc += layerArc;
    totalVerts += layerVerts;
    totalSegs += layerSegs;
  }

  // Density grid coverage per cell.
  const cells: number[][] = cellArc.map((r) => r.map((arc) => round((arc * penWidthMm) / cellArea, 4)));
  const flat = cells.flat();
  const gmax = flat.length ? Math.max(...flat) : 0;
  const gmean = flat.length ? flat.reduce((s, v) => s + v, 0) / flat.length : 0;
  const gvar = flat.length ? flat.reduce((s, v) => s + (v - gmean) ** 2, 0) / flat.length : 0;
  const gcv = gmean > 0 ? Math.sqrt(gvar) / gmean : 0;
  const saturatedCells = flat.filter((v) => v >= saturationThreshold).length;

  const hasGeom = Number.isFinite(minX);
  const bbox: BoundingBox = hasGeom
    ? { xMm: round(minX), yMm: round(minY), widthMm: round(maxX - minX), heightMm: round(maxY - minY) }
    : { xMm: 0, yMm: 0, widthMm: 0, heightMm: 0 };
  const bboxArea = bbox.widthMm * bbox.heightMm;

  return {
    input: opts.input ?? null,
    page,
    drawable: roundDrawable(drawable),
    penWidthMm: round(penWidthMm, 4),
    penWidthSource,
    scale: round(scale, 6),
    totals: {
      layers: layerStats.length,
      paths: totalPaths,
      vertices: totalVerts,
      segments: totalSegs,
      arcLengthMm: round(totalArc),
      penUpTravelMm: round(penUp),
      boundingBox: bbox,
      bboxCoverageRatio: round(bboxArea / drawable.areaMm2, 4),
      inkDensity: round((totalArc * penWidthMm) / drawable.areaMm2, 4),
    },
    layers: layerStats,
    densityGrid: {
      cols: grid,
      rows: grid,
      cells,
      max: round(gmax, 4),
      mean: round(gmean, 4),
      cv: round(gcv, 4),
    },
    warnings: {
      marginViolationPaths: marginViolations,
      saturatedCells,
      saturationThreshold,
    },
  };
}

function round(n: number, dp = 2): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

function roundDrawable(d: DrawableArea): DrawableArea {
  return {
    xMm: round(d.xMm),
    yMm: round(d.yMm),
    widthMm: round(d.widthMm),
    heightMm: round(d.heightMm),
    areaMm2: round(d.areaMm2),
  };
}
