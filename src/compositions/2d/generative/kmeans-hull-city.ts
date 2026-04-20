import type { Composition2DDefinition } from "../../types";

// Seeded from: vault/seeds/plotterart/1sjttcr.md — "Lost cities" by u/theo__r
// Circular region subdivided into convex-hull-ish polygonal cells (Voronoi +
// radial density so cells shrink toward the centre), each filled with its own
// hatch texture; an optional Gray-Scott reaction-diffusion border wraps the
// city circle with organic blob contours.

interface Point {
  x: number;
  y: number;
}

interface Triangle {
  a: number;
  b: number;
  c: number;
}

function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TEXTURE_MODES = ["parallel", "crosshatch", "stipple", "diagonal"] as const;
type TextureMode = (typeof TEXTURE_MODES)[number];

const kmeansHullCity: Composition2DDefinition = {
  id: "kmeansHullCity",
  name: "K-Means Hull City",
  description:
    "Circular 'lost city' map: Voronoi cells that shrink toward the centre, each filled with a distinct hatch texture, optionally wrapped by a reaction-diffusion blob border.",
  tags: [
    "generative",
    "voronoi",
    "subdivision",
    "cartographic",
    "recursive",
    "reaction-diffusion",
    "hatching",
  ],
  category: "2d",
  type: "2d",
  renderMode: "debounced",

  macros: {
    density: {
      label: "Density",
      default: 0.5,
      targets: [
        { param: "hatchSpacing", fn: "linear", strength: -0.7 },
        { param: "stippleSpacing", fn: "linear", strength: -0.6 },
        { param: "rdIterations", fn: "linear", strength: 0.5 },
      ],
    },
    fracture: {
      label: "Fracture",
      default: 0.5,
      targets: [
        { param: "cellCount", fn: "linear", strength: 0.8 },
        { param: "centerBias", fn: "linear", strength: 0.6 },
      ],
    },
    chaos: {
      label: "Chaos",
      default: 0.4,
      targets: [
        { param: "pointJitter", fn: "linear", strength: 0.8 },
        { param: "angleJitter", fn: "linear", strength: 0.7 },
      ],
    },
  },

  controls: {
    seed: {
      type: "slider",
      label: "Seed",
      default: 7,
      min: 0,
      max: 999,
      step: 1,
      group: "Structure",
    },
    cellCount: {
      type: "slider",
      label: "Cell Count",
      default: 70,
      min: 15,
      max: 220,
      step: 1,
      group: "Structure",
    },
    centerBias: {
      type: "slider",
      label: "Center Bias",
      default: 1.6,
      min: 0.5,
      max: 3.0,
      step: 0.05,
      group: "Structure",
    },
    relaxIterations: {
      type: "slider",
      label: "Lloyd Relaxation",
      default: 2,
      min: 0,
      max: 8,
      step: 1,
      group: "Structure",
    },
    pointJitter: {
      type: "slider",
      label: "Point Jitter",
      default: 0.35,
      min: 0.0,
      max: 1.0,
      step: 0.01,
      group: "Structure",
    },
    circleRadius: {
      type: "slider",
      label: "City Radius",
      default: 0.38,
      min: 0.2,
      max: 0.46,
      step: 0.005,
      group: "Structure",
    },
    roadGap: {
      type: "slider",
      label: "Road Gap",
      default: 3,
      min: 0,
      max: 12,
      step: 0.5,
      group: "Structure",
    },
    showCircle: {
      type: "toggle",
      label: "Draw City Boundary",
      default: true,
      group: "Structure",
    },
    hatchSpacing: {
      type: "slider",
      label: "Hatch Spacing",
      default: 5.5,
      min: 1.5,
      max: 14,
      step: 0.1,
      group: "Texture",
    },
    stippleSpacing: {
      type: "slider",
      label: "Stipple Spacing",
      default: 9,
      min: 3,
      max: 22,
      step: 0.5,
      group: "Texture",
    },
    angleJitter: {
      type: "slider",
      label: "Angle Jitter",
      default: 0.4,
      min: 0,
      max: 1,
      step: 0.01,
      group: "Texture",
    },
    emptyCellProbability: {
      type: "slider",
      label: "Empty Cells",
      default: 0.35,
      min: 0,
      max: 0.7,
      step: 0.01,
      group: "Texture",
    },
    edgeInset: {
      type: "slider",
      label: "Hatch Edge Inset",
      default: 4,
      min: 0,
      max: 12,
      step: 0.5,
      group: "Texture",
    },
    textureMix: {
      type: "select",
      label: "Texture Mix",
      default: "parallel-stipple",
      options: [
        { label: "Parallel + Stipple (refined)", value: "parallel-stipple" },
        { label: "Parallel only", value: "parallel" },
        { label: "Parallel + Cross", value: "parallel-cross" },
        { label: "All four (busy)", value: "all" },
      ],
      group: "Texture",
    },
    borderMode: {
      type: "select",
      label: "Border",
      default: "reaction-diffusion",
      options: [
        { label: "Reaction-Diffusion", value: "reaction-diffusion" },
        { label: "Radial Dash Field", value: "dash" },
        { label: "None", value: "none" },
      ],
      group: "Border",
    },
    borderWidth: {
      type: "slider",
      label: "Border Width",
      default: 0.12,
      min: 0.0,
      max: 0.3,
      step: 0.005,
      group: "Border",
    },
    rdIterations: {
      type: "slider",
      label: "RD Iterations",
      default: 1800,
      min: 400,
      max: 4000,
      step: 100,
      group: "Border",
    },
    rdGridResolution: {
      type: "slider",
      label: "RD Grid Size",
      default: 120,
      min: 60,
      max: 200,
      step: 10,
      group: "Border",
    },
    rdContourThreshold: {
      type: "slider",
      label: "RD Contour",
      default: 0.28,
      min: 0.1,
      max: 0.45,
      step: 0.01,
      group: "Border",
    },
  },

  generate({ width, height, values }) {
    const seed = Math.round(values.seed as number);
    const cellCount = Math.round(values.cellCount as number);
    const centerBias = values.centerBias as number;
    const relaxIter = Math.round(values.relaxIterations as number);
    const pointJitter = values.pointJitter as number;
    const circleRadiusFrac = values.circleRadius as number;
    const roadGap = values.roadGap as number;
    const showCircle = values.showCircle as boolean;
    const hatchSpacing = values.hatchSpacing as number;
    const stippleSpacing = values.stippleSpacing as number;
    const angleJitter = values.angleJitter as number;
    const emptyCellProbability = values.emptyCellProbability as number;
    const edgeInset = values.edgeInset as number;
    const textureMix = values.textureMix as string;
    const borderMode = values.borderMode as string;
    const borderWidth = values.borderWidth as number;
    const rdIterations = Math.round(values.rdIterations as number);
    const rdGridResolution = Math.round(values.rdGridResolution as number);
    const rdContourThreshold = values.rdContourThreshold as number;

    const rand = mulberry32(seed);
    const polylines: Point[][] = [];

    const cx = width / 2;
    const cy = height / 2;
    const radius = Math.min(width, height) * circleRadiusFrac;

    // ── 1. Seed cell centres inside the circle ──────────────────────────────
    //   centerBias > 1 pulls samples toward the middle (smaller cells there).
    const points: Point[] = [];
    for (let i = 0; i < cellCount; i++) {
      // Sample r with power-law bias so higher centerBias → more centre seeds.
      const r = radius * Math.pow(rand(), centerBias);
      const theta = rand() * Math.PI * 2;
      const jx = (rand() - 0.5) * pointJitter * radius * 0.08;
      const jy = (rand() - 0.5) * pointJitter * radius * 0.08;
      points.push({ x: cx + Math.cos(theta) * r + jx, y: cy + Math.sin(theta) * r + jy });
    }

    // ── 2. Lloyd relaxation via Voronoi centroids ───────────────────────────
    for (let iter = 0; iter < relaxIter; iter++) {
      const cells = voronoiCellsInCircle(points, cx, cy, radius);
      for (let i = 0; i < points.length; i++) {
        const poly = cells[i];
        if (poly.length < 3) continue;
        const centroid = polygonCentroid(poly);
        // Clamp to the circle to avoid drifting past the boundary.
        const dx = centroid.x - cx;
        const dy = centroid.y - cy;
        const d = Math.sqrt(dx * dx + dy * dy);
        const clampR = Math.min(d, radius * 0.98);
        points[i] = {
          x: cx + (d > 1e-8 ? (dx / d) * clampR : 0),
          y: cy + (d > 1e-8 ? (dy / d) * clampR : 0),
        };
      }
    }

    // ── 3. Final cells ──────────────────────────────────────────────────────
    const finalCells = voronoiCellsInCircle(points, cx, cy, radius);

    // ── 4. Road gap inset + cell outlines + texture fills ───────────────────
    //   Restraint: ~emptyCellProbability of cells get NO fill (just outline).
    //   This is the negative-space rhythm the original Lost cities relies on.
    //   Hatching is done on a further-inset polygon (edgeInset) so strokes
    //   don't touch the cell outline — keeps each cell visually crisp.
    const allowedTextures = resolveTextureMix(textureMix);
    for (let i = 0; i < finalCells.length; i++) {
      const cellRaw = finalCells[i];
      if (cellRaw.length < 3) continue;
      const cell = inwardOffset(cellRaw, roadGap / 2);
      if (cell.length < 3) continue;

      // Outline as a closed polyline (every cell, even empty).
      polylines.push([...cell, cell[0]]);

      // Empty cells skip fill — gives the eye places to rest.
      if (hashRand(seed + 7, i) < emptyCellProbability) continue;

      const pickIdx = Math.floor(hashRand(seed, i) * allowedTextures.length);
      const mode = allowedTextures[pickIdx] ?? "parallel";
      const baseAngle =
        hashRand(seed + 101, i) * Math.PI +
        (rand() - 0.5) * angleJitter * Math.PI;

      // Inset the fill region inside the cell outline so strokes don't
      // collide with the cell border.
      const fillPoly = edgeInset > 0 ? inwardOffset(cell, edgeInset) : cell;
      if (fillPoly.length < 3) continue;

      fillCell(fillPoly, mode, baseAngle, hatchSpacing, stippleSpacing, rand, polylines);
    }

    // ── 5. City circle boundary ─────────────────────────────────────────────
    if (showCircle) {
      polylines.push(circlePolyline(cx, cy, radius, 96));
    }

    // ── 6. Border region ────────────────────────────────────────────────────
    if (borderMode === "reaction-diffusion" && borderWidth > 1e-4) {
      const contours = reactionDiffusionBorder({
        width,
        height,
        cx,
        cy,
        innerR: radius,
        outerR: radius + borderWidth * Math.min(width, height),
        N: rdGridResolution,
        iterations: rdIterations,
        threshold: rdContourThreshold,
        seedFn: rand,
      });
      for (const c of contours) polylines.push(c);
    } else if (borderMode === "dash" && borderWidth > 1e-4) {
      const dashes = radialDashBorder({
        cx,
        cy,
        innerR: radius + roadGap,
        outerR: radius + borderWidth * Math.min(width, height),
        count: Math.max(32, Math.round(cellCount * 1.5)),
        seedFn: rand,
      });
      for (const d of dashes) polylines.push(d);
    }

    return polylines;
  },
};

// ─────────────────────────────────────────────────────────────────────────────
//   Helpers
// ─────────────────────────────────────────────────────────────────────────────

function hashRand(seed: number, i: number): number {
  // Deterministic per-index scalar in [0, 1) — avoids consuming the main PRNG
  // stream when we need stable mode assignment per cell.
  const x = Math.sin(seed * 127.1 + i * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

function resolveTextureMix(mix: string): TextureMode[] {
  switch (mix) {
    case "parallel":
      return ["parallel"];
    case "parallel-cross":
      return ["parallel", "crosshatch"];
    case "parallel-stipple":
      return ["parallel", "stipple"];
    default:
      return [...TEXTURE_MODES];
  }
}

function circlePolyline(cx: number, cy: number, r: number, segments: number): Point[] {
  const pts: Point[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = (i / segments) * Math.PI * 2;
    pts.push({ x: cx + Math.cos(t) * r, y: cy + Math.sin(t) * r });
  }
  return pts;
}

function polygonCentroid(poly: Point[]): Point {
  let area = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    const cross = p.x * q.y - q.x * p.y;
    area += cross;
    cx += (p.x + q.x) * cross;
    cy += (p.y + q.y) * cross;
  }
  area /= 2;
  if (Math.abs(area) < 1e-8) {
    // Fall back to vertex average.
    let sx = 0;
    let sy = 0;
    for (const p of poly) {
      sx += p.x;
      sy += p.y;
    }
    return { x: sx / poly.length, y: sy / poly.length };
  }
  return { x: cx / (6 * area), y: cy / (6 * area) };
}

// Inset a simple (counter-clockwise-ish) polygon by `offset` along edge
// inward normals. Good enough for Voronoi cells, which are convex.
function inwardOffset(poly: Point[], offset: number): Point[] {
  if (offset <= 0) return poly;
  const n = poly.length;
  if (n < 3) return poly;
  const centroid = polygonCentroid(poly);
  const out: Point[] = [];
  for (let i = 0; i < n; i++) {
    const p = poly[i];
    const dx = centroid.x - p.x;
    const dy = centroid.y - p.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d < 1e-6) {
      out.push(p);
      continue;
    }
    const t = Math.min(offset / d, 0.45);
    out.push({ x: p.x + dx * t, y: p.y + dy * t });
  }
  return out;
}

// ── Texture fills ───────────────────────────────────────────────────────────

function fillCell(
  cell: Point[],
  mode: TextureMode,
  angle: number,
  hatchSpacing: number,
  stippleSpacing: number,
  rand: () => number,
  out: Point[][],
): void {
  switch (mode) {
    case "parallel":
      hatchPolygon(cell, angle, hatchSpacing, out);
      break;
    case "crosshatch":
      // Open weave — wider spacing in the second direction so the cross
      // reads as a grid, not a solid black block.
      hatchPolygon(cell, angle, hatchSpacing * 1.4, out);
      hatchPolygon(cell, angle + Math.PI / 2, hatchSpacing * 1.7, out);
      break;
    case "stipple":
      stipplePolygon(cell, stippleSpacing, rand, out);
      break;
    case "diagonal":
      // Single diagonal stripe — the previous double-cross was redundant
      // with crosshatch and added noise.
      hatchPolygon(cell, angle + Math.PI / 4, hatchSpacing * 1.2, out);
      break;
  }
}

function polygonBounds(poly: Point[]): { minX: number; maxX: number; minY: number; maxY: number } {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of poly) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, maxX, minY, maxY };
}

// Generate parallel hatch lines inside an arbitrary (convex-ish) polygon by
// scan-line intersection. Adapted from voronoi-texture.ts.
function hatchPolygon(
  poly: Point[],
  angleRad: number,
  spacing: number,
  out: Point[][],
): void {
  if (poly.length < 3 || spacing <= 0) return;
  const bb = polygonBounds(poly);
  const cx = (bb.minX + bb.maxX) / 2;
  const cy = (bb.minY + bb.maxY) / 2;
  const extent = Math.sqrt((bb.maxX - bb.minX) ** 2 + (bb.maxY - bb.minY) ** 2);
  const ca = Math.cos(angleRad);
  const sa = Math.sin(angleRad);
  const steps = Math.max(1, Math.floor(extent / spacing));

  for (let li = -steps; li <= steps; li++) {
    const offset = li * spacing;
    // A scan line centred at (cx+perp*offset) along (ca, sa).
    const lx1 = cx + ca * (-extent) - sa * offset;
    const ly1 = cy + sa * (-extent) + ca * offset;
    const lx2 = cx + ca * extent - sa * offset;
    const ly2 = cy + sa * extent + ca * offset;

    const hits: number[] = [];
    for (let j = 0; j < poly.length; j++) {
      const k = (j + 1) % poly.length;
      const x1 = poly[j].x;
      const y1 = poly[j].y;
      const x2 = poly[k].x;
      const y2 = poly[k].y;

      const denom = (lx1 - lx2) * (y1 - y2) - (ly1 - ly2) * (x1 - x2);
      if (Math.abs(denom) < 1e-10) continue;
      const t = ((lx1 - x1) * (y1 - y2) - (ly1 - y1) * (x1 - x2)) / denom;
      const u = -((lx1 - lx2) * (ly1 - y1) - (ly1 - ly2) * (lx1 - x1)) / denom;
      if (u >= 0 && u <= 1 && t >= 0 && t <= 1) hits.push(t);
    }

    hits.sort((a, b) => a - b);
    for (let j = 0; j + 1 < hits.length; j += 2) {
      const t1 = hits[j];
      const t2 = hits[j + 1];
      out.push([
        { x: lx1 + (lx2 - lx1) * t1, y: ly1 + (ly2 - ly1) * t1 },
        { x: lx1 + (lx2 - lx1) * t2, y: ly1 + (ly2 - ly1) * t2 },
      ]);
    }
  }
}

function stipplePolygon(
  poly: Point[],
  spacing: number,
  rand: () => number,
  out: Point[][],
): void {
  if (poly.length < 3 || spacing <= 0) return;
  const bb = polygonBounds(poly);
  const cols = Math.max(1, Math.floor((bb.maxX - bb.minX) / spacing));
  const rows = Math.max(1, Math.floor((bb.maxY - bb.minY) / spacing));
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const jx = (rand() - 0.5) * spacing * 0.5;
      const jy = (rand() - 0.5) * spacing * 0.5;
      const px = bb.minX + (i + 0.5) * spacing + jx;
      const py = bb.minY + (j + 0.5) * spacing + jy;
      if (!pointInPolygon({ x: px, y: py }, poly)) continue;
      const r = spacing * 0.12;
      out.push(tinyDotPolyline(px, py, r));
    }
  }
}

function tinyDotPolyline(px: number, py: number, r: number): Point[] {
  const pts: Point[] = [];
  const segs = 6;
  for (let i = 0; i <= segs; i++) {
    const t = (i / segs) * Math.PI * 2;
    pts.push({ x: px + Math.cos(t) * r, y: py + Math.sin(t) * r });
  }
  return pts;
}

function pointInPolygon(p: Point, poly: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x;
    const yi = poly[i].y;
    const xj = poly[j].x;
    const yj = poly[j].y;
    const intersect =
      yi > p.y !== yj > p.y &&
      p.x < ((xj - xi) * (p.y - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

// ── Voronoi via Bowyer-Watson, with circle clipping ─────────────────────────

function voronoiCellsInCircle(
  sitesIn: Point[],
  cx: number,
  cy: number,
  radius: number,
): Point[][] {
  // Add a ring of ghost points just outside the circle so cells close up.
  const siteCount = sitesIn.length;
  const ghostCount = Math.max(24, Math.round(siteCount * 0.4));
  const allSites: Point[] = sitesIn.slice();
  for (let i = 0; i < ghostCount; i++) {
    const t = (i / ghostCount) * Math.PI * 2;
    allSites.push({ x: cx + Math.cos(t) * radius * 1.6, y: cy + Math.sin(t) * radius * 1.6 });
  }

  const tris = triangulate(allSites, cx, cy, radius * 4);

  // Map each site to the list of triangle circumcentres it participates in.
  const cellVertLists: Point[][] = Array.from({ length: siteCount }, () => []);
  for (const t of tris) {
    const cc = circumcentre(allSites[t.a], allSites[t.b], allSites[t.c]);
    if (!cc) continue;
    if (t.a < siteCount) cellVertLists[t.a].push(cc);
    if (t.b < siteCount) cellVertLists[t.b].push(cc);
    if (t.c < siteCount) cellVertLists[t.c].push(cc);
  }

  const cells: Point[][] = [];
  for (let i = 0; i < siteCount; i++) {
    const site = sitesIn[i];
    const verts = cellVertLists[i];
    if (verts.length < 3) {
      cells.push([]);
      continue;
    }
    verts.sort(
      (a, b) =>
        Math.atan2(a.y - site.y, a.x - site.x) -
        Math.atan2(b.y - site.y, b.x - site.x),
    );
    const clipped = clipToCircle(verts, cx, cy, radius);
    cells.push(clipped);
  }
  return cells;
}

function triangulate(sites: Point[], cx: number, cy: number, bigR: number): Triangle[] {
  const pts = sites.slice();
  const superA = pts.length;
  const superB = pts.length + 1;
  const superC = pts.length + 2;
  pts.push(
    { x: cx - bigR, y: cy - bigR },
    { x: cx + bigR * 3, y: cy - bigR },
    { x: cx, y: cy + bigR * 3 },
  );

  let triangles: Triangle[] = [{ a: superA, b: superB, c: superC }];

  for (let i = 0; i < sites.length; i++) {
    const p = pts[i];
    const bad: Triangle[] = [];
    const good: Triangle[] = [];
    for (const tri of triangles) {
      if (circumcircleContains(pts[tri.a], pts[tri.b], pts[tri.c], p)) bad.push(tri);
      else good.push(tri);
    }
    const edges: [number, number][] = [];
    for (const tri of bad) {
      const triEdges: [number, number][] = [
        [tri.a, tri.b],
        [tri.b, tri.c],
        [tri.c, tri.a],
      ];
      for (const [ea, eb] of triEdges) {
        let shared = false;
        for (const other of bad) {
          if (other === tri) continue;
          const oe: [number, number][] = [
            [other.a, other.b],
            [other.b, other.c],
            [other.c, other.a],
          ];
          for (const [oa, ob] of oe) {
            if ((ea === oa && eb === ob) || (ea === ob && eb === oa)) {
              shared = true;
              break;
            }
          }
          if (shared) break;
        }
        if (!shared) edges.push([ea, eb]);
      }
    }
    triangles = good;
    for (const [ea, eb] of edges) triangles.push({ a: i, b: ea, c: eb });
  }
  return triangles.filter((t) => t.a < superA && t.b < superA && t.c < superA);
}

function circumcircleContains(a: Point, b: Point, c: Point, p: Point): boolean {
  const cc = circumcentre(a, b, c);
  if (!cc) return false;
  const r2 = (a.x - cc.x) ** 2 + (a.y - cc.y) ** 2;
  return (p.x - cc.x) ** 2 + (p.y - cc.y) ** 2 < r2;
}

function circumcentre(a: Point, b: Point, c: Point): Point | null {
  const D = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  if (Math.abs(D) < 1e-10) return null;
  const ux =
    ((a.x * a.x + a.y * a.y) * (b.y - c.y) +
      (b.x * b.x + b.y * b.y) * (c.y - a.y) +
      (c.x * c.x + c.y * c.y) * (a.y - b.y)) /
    D;
  const uy =
    ((a.x * a.x + a.y * a.y) * (c.x - b.x) +
      (b.x * b.x + b.y * b.y) * (a.x - c.x) +
      (c.x * c.x + c.y * c.y) * (b.x - a.x)) /
    D;
  return { x: ux, y: uy };
}

// Sutherland-Hodgman against a circle: we approximate the circle as an
// N-gon clip polygon. Cheaper than true arc intersection and fine at ≥48 sides.
function clipToCircle(poly: Point[], cx: number, cy: number, radius: number): Point[] {
  const segments = 64;
  const clip: Point[] = [];
  for (let i = 0; i < segments; i++) {
    const t = (i / segments) * Math.PI * 2;
    clip.push({ x: cx + Math.cos(t) * radius, y: cy + Math.sin(t) * radius });
  }
  return sutherlandHodgman(poly, clip);
}

function sutherlandHodgman(subject: Point[], clip: Point[]): Point[] {
  let output = subject.slice();
  for (let i = 0; i < clip.length; i++) {
    const a = clip[i];
    const b = clip[(i + 1) % clip.length];
    if (output.length === 0) break;
    const input = output;
    output = [];
    for (let j = 0; j < input.length; j++) {
      const p = input[j];
      const q = input[(j + 1) % input.length];
      const pIn = isLeftOfLine(p, a, b);
      const qIn = isLeftOfLine(q, a, b);
      if (pIn) {
        if (qIn) {
          output.push(q);
        } else {
          const x = lineIntersect(p, q, a, b);
          if (x) output.push(x);
        }
      } else if (qIn) {
        const x = lineIntersect(p, q, a, b);
        if (x) output.push(x);
        output.push(q);
      }
    }
  }
  return output;
}

function isLeftOfLine(p: Point, a: Point, b: Point): boolean {
  // Cross product of (b-a) and (p-a). Positive = p is to the left of a→b.
  // Our circle clip polygon is wound CCW (cos/sin around centre), so "inside"
  // means left of every edge, i.e. cross >= 0.
  return (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x) >= 0;
}

function lineIntersect(p: Point, q: Point, a: Point, b: Point): Point | null {
  const r1x = q.x - p.x;
  const r1y = q.y - p.y;
  const r2x = b.x - a.x;
  const r2y = b.y - a.y;
  const denom = r1x * r2y - r1y * r2x;
  if (Math.abs(denom) < 1e-10) return null;
  const t = ((a.x - p.x) * r2y - (a.y - p.y) * r2x) / denom;
  return { x: p.x + t * r1x, y: p.y + t * r1y };
}

// ── Reaction-diffusion border ───────────────────────────────────────────────

function reactionDiffusionBorder(opts: {
  width: number;
  height: number;
  cx: number;
  cy: number;
  innerR: number;
  outerR: number;
  N: number;
  iterations: number;
  threshold: number;
  seedFn: () => number;
}): Point[][] {
  const { width, height, cx, cy, innerR, outerR, N, iterations, threshold, seedFn } = opts;
  const size = N * N;
  let u = new Float64Array(size);
  let v = new Float64Array(size);
  let uNext = new Float64Array(size);
  let vNext = new Float64Array(size);
  u.fill(1.0);

  // Sprinkle seed spots concentrated in the border annulus.
  const centreX = N / 2;
  const centreY = N / 2;
  const innerGrid = (innerR / Math.min(width, height)) * N;
  const outerGrid = (outerR / Math.min(width, height)) * N;
  const spots = Math.max(6, Math.round(outerGrid - innerGrid));
  for (let s = 0; s < spots; s++) {
    const t = seedFn() * Math.PI * 2;
    const rg = innerGrid + seedFn() * (outerGrid - innerGrid);
    const sx = Math.round(centreX + Math.cos(t) * rg);
    const sy = Math.round(centreY + Math.sin(t) * rg);
    const rr = Math.max(2, Math.round(N * 0.015));
    for (let yy = Math.max(0, sy - rr); yy <= Math.min(N - 1, sy + rr); yy++) {
      for (let xx = Math.max(0, sx - rr); xx <= Math.min(N - 1, sx + rr); xx++) {
        if ((xx - sx) ** 2 + (yy - sy) ** 2 < rr * rr) {
          const idx = yy * N + xx;
          u[idx] = 0.5;
          v[idx] = 0.25;
        }
      }
    }
  }

  const f = 0.055;
  const k = 0.062;
  const dA = 1.0;
  const dB = 0.5;
  const dt = 1.0;

  for (let iter = 0; iter < iterations; iter++) {
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const idx = y * N + x;
        const xm = (x - 1 + N) % N;
        const xp = (x + 1) % N;
        const ym = (y - 1 + N) % N;
        const yp = (y + 1) % N;
        const lapU =
          u[y * N + xm] + u[y * N + xp] + u[ym * N + x] + u[yp * N + x] - 4 * u[idx];
        const lapV =
          v[y * N + xm] + v[y * N + xp] + v[ym * N + x] + v[yp * N + x] - 4 * v[idx];
        const uVal = u[idx];
        const vVal = v[idx];
        const uvv = uVal * vVal * vVal;
        let un = uVal + dt * (dA * lapU - uvv + f * (1 - uVal));
        let vn = vVal + dt * (dB * lapV + uvv - (f + k) * vVal);
        if (un < 0) un = 0;
        if (un > 1) un = 1;
        if (vn < 0) vn = 0;
        if (vn > 1) vn = 1;
        uNext[idx] = un;
        vNext[idx] = vn;
      }
    }
    [u, uNext] = [uNext, u];
    [v, vNext] = [vNext, v];
  }

  // March squares across the whole grid (no annulus mask here — masking
  // mid-march fragments contours into open zigzags). We chain segments into
  // complete polylines first, then keep whole polylines whose centroid sits
  // in the annulus. This trades a bit of work for clean, closed contour bands.
  const scaleX = width / N;
  const scaleY = height / N;
  const segs: { x1: number; y1: number; x2: number; y2: number }[] = [];
  for (let y = 0; y < N - 1; y++) {
    for (let x = 0; x < N - 1; x++) {
      const v00 = v[y * N + x];
      const v10 = v[y * N + x + 1];
      const v01 = v[(y + 1) * N + x];
      const v11 = v[(y + 1) * N + x + 1];
      const cfg =
        (v00 >= threshold ? 1 : 0) |
        (v10 >= threshold ? 2 : 0) |
        (v01 >= threshold ? 4 : 0) |
        (v11 >= threshold ? 8 : 0);
      if (cfg === 0 || cfg === 15) continue;

      const lerp = (a: number, b: number): number => {
        const d = b - a;
        return Math.abs(d) < 1e-12 ? 0.5 : (threshold - a) / d;
      };
      const top = { x: x + lerp(v00, v10), y };
      const right = { x: x + 1, y: y + lerp(v10, v11) };
      const bottom = { x: x + lerp(v01, v11), y: y + 1 };
      const left = { x, y: y + lerp(v00, v01) };
      const edges: [{ x: number; y: number }, { x: number; y: number }][] = [];
      switch (cfg) {
        case 1: edges.push([top, left]); break;
        case 2: edges.push([right, top]); break;
        case 3: edges.push([right, left]); break;
        case 4: edges.push([left, bottom]); break;
        case 5: edges.push([top, bottom]); break;
        case 6: edges.push([right, top], [left, bottom]); break;
        case 7: edges.push([right, bottom]); break;
        case 8: edges.push([bottom, right]); break;
        case 9: edges.push([top, left], [bottom, right]); break;
        case 10: edges.push([bottom, top]); break;
        case 11: edges.push([bottom, left]); break;
        case 12: edges.push([left, right]); break;
        case 13: edges.push([top, right]); break;
        case 14: edges.push([left, top]); break;
      }
      for (const [a, b] of edges) {
        segs.push({
          x1: a.x * scaleX,
          y1: a.y * scaleY,
          x2: b.x * scaleX,
          y2: b.y * scaleY,
        });
      }
    }
  }

  // Chain segments into polylines (same logic as reaction-diffusion.ts).
  const used = new Uint8Array(segs.length);
  // Marching-squares shared vertices are produced from the same lerp() call
  // on the same input values, so exact float equality is OK. Use a tiny eps
  // to guard against drift; a generous eps causes cross-blob chaining and
  // produces sprawling wrong contours.
  const eps = Math.min(scaleX, scaleY) * 0.05;
  const polys: Point[][] = [];
  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue;
    used[i] = 1;
    const chain: Point[] = [
      { x: segs[i].x1, y: segs[i].y1 },
      { x: segs[i].x2, y: segs[i].y2 },
    ];
    let grew = true;
    while (grew) {
      grew = false;
      const tail = chain[chain.length - 1];
      for (let j = 0; j < segs.length; j++) {
        if (used[j]) continue;
        const s = segs[j];
        if (Math.abs(s.x1 - tail.x) < eps && Math.abs(s.y1 - tail.y) < eps) {
          chain.push({ x: s.x2, y: s.y2 });
          used[j] = 1;
          grew = true;
          break;
        }
        if (Math.abs(s.x2 - tail.x) < eps && Math.abs(s.y2 - tail.y) < eps) {
          chain.push({ x: s.x1, y: s.y1 });
          used[j] = 1;
          grew = true;
          break;
        }
      }
    }
    grew = true;
    while (grew) {
      grew = false;
      const head = chain[0];
      for (let j = 0; j < segs.length; j++) {
        if (used[j]) continue;
        const s = segs[j];
        if (Math.abs(s.x2 - head.x) < eps && Math.abs(s.y2 - head.y) < eps) {
          chain.unshift({ x: s.x1, y: s.y1 });
          used[j] = 1;
          grew = true;
          break;
        }
        if (Math.abs(s.x1 - head.x) < eps && Math.abs(s.y1 - head.y) < eps) {
          chain.unshift({ x: s.x2, y: s.y2 });
          used[j] = 1;
          grew = true;
          break;
        }
      }
    }
    if (chain.length >= 2) polys.push(chain);
  }

  // Annulus filter — keep contour polylines that sit fully (or near-fully)
  // in the border ring. We test every Nth point and require ≥80% inside the
  // annulus *and* the polyline's bounding box must fit within the outer
  // radius. Sprawling whole-grid contours fail both checks and get dropped.
  const inner2 = innerR * innerR;
  const outer2 = outerR * outerR;
  const outerSlack = outerR * 1.05;
  const kept: Point[][] = [];
  for (const poly of polys) {
    if (poly.length < 3) continue;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    let inAnnulus = 0;
    let total = 0;
    const stride = Math.max(1, Math.floor(poly.length / 10));
    for (let i = 0; i < poly.length; i += stride) {
      const p = poly[i];
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
      const dx = p.x - cx;
      const dy = p.y - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 >= inner2 && d2 <= outer2) inAnnulus++;
      total++;
    }
    if (total === 0 || inAnnulus / total < 0.8) continue;
    if (
      minX < cx - outerSlack ||
      maxX > cx + outerSlack ||
      minY < cy - outerSlack ||
      maxY > cy + outerSlack
    )
      continue;
    kept.push(poly);
  }
  return kept;
}

// ── Radial dash fallback border ─────────────────────────────────────────────

function radialDashBorder(opts: {
  cx: number;
  cy: number;
  innerR: number;
  outerR: number;
  count: number;
  seedFn: () => number;
}): Point[][] {
  const { cx, cy, innerR, outerR, count, seedFn } = opts;
  const polys: Point[][] = [];
  for (let i = 0; i < count; i++) {
    const t = (i / count) * Math.PI * 2 + seedFn() * 0.02;
    const r1 = innerR + seedFn() * (outerR - innerR) * 0.3;
    const r2 = r1 + (outerR - innerR) * (0.3 + seedFn() * 0.5);
    const ca = Math.cos(t);
    const sa = Math.sin(t);
    polys.push([
      { x: cx + ca * r1, y: cy + sa * r1 },
      { x: cx + ca * r2, y: cy + sa * r2 },
    ]);
  }
  return polys;
}

export default kmeansHullCity;
