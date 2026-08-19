import type { Composition2DDefinition } from "../../types";

type Pt = { x: number; y: number };

const DEG = Math.PI / 180;
const TAU = Math.PI * 2;

/**
 * Angular step between consecutive vertices of a regular {8/2} octagram
 * (22.5 degrees). The star alternates outer "tip" vertices at radius R with
 * inner "notch" vertices at radius r every 22.5 degrees.
 */
const STEP = 22.5 * DEG;

/**
 * Inner/outer radius ratio of a regular {8/2} octagram — the star formed by
 * two overlapping squares. r/R = cos(45) / cos(22.5).
 */
const INNER_RATIO = Math.cos(45 * DEG) / Math.cos(22.5 * DEG); // ≈ 0.765367

/**
 * Lattice spacing (star centre to star centre) that makes the octagrams
 * interlock tip-to-tip: d = 2 * R * cos(22.5). Solved for R below.
 */
const R_PER_TILE = 1 / (2 * Math.cos(22.5 * DEG)); // R = tileSize * this

/**
 * Radius of the star boundary at an arbitrary polar angle.
 *
 * Between two consecutive star vertices (P1 at angle a1, radius R1 and P2 at
 * angle a2, radius R2) the boundary is a straight edge, whose polar equation is
 *   rho(t) = R1*R2*sin(a2-a1) / (R1*sin(t-a1) + R2*sin(a2-t))
 */
function starRadiusAt(theta: number, outer: number, inner: number): number {
  let t = theta % TAU;
  if (t < 0) t += TAU;

  const idx = Math.floor(t / STEP) % 16;
  const a1 = idx * STEP;
  const a2 = a1 + STEP;
  // Even index → segment starts at an inner (notch) vertex at angle 45k.
  const r1 = idx % 2 === 0 ? inner : outer;
  const r2 = idx % 2 === 0 ? outer : inner;

  const denom = r1 * Math.sin(t - a1) + r2 * Math.sin(a2 - t);
  if (Math.abs(denom) < 1e-12) return r1;
  return (r1 * r2 * Math.sin(STEP)) / denom;
}

/** Closed outline of an {8/2} octagram centred at (cx, cy). */
function starOutline(cx: number, cy: number, outer: number, inner: number): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i <= 16; i++) {
    const a = (i % 16) * STEP;
    const rad = i % 2 === 0 ? inner : outer;
    pts.push({ x: cx + Math.cos(a) * rad, y: cy + Math.sin(a) * rad });
  }
  return pts;
}

/** Closed outline of a regular octagon with vertices at multiples of 45 degrees. */
function octagonOutline(cx: number, cy: number, radius: number): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i <= 8; i++) {
    const a = (i % 8) * 2 * STEP;
    pts.push({ x: cx + Math.cos(a) * radius, y: cy + Math.sin(a) * radius });
  }
  return pts;
}

/** Closed outline of a rhombus (diamond) with the given half-diagonals. */
function rhombusOutline(cx: number, cy: number, hx: number, hy: number): Pt[] {
  return [
    { x: cx - hx, y: cy },
    { x: cx, y: cy - hy },
    { x: cx + hx, y: cy },
    { x: cx, y: cy + hy },
    { x: cx - hx, y: cy },
  ];
}

/**
 * Radial ornament for one star.
 *
 * Two effects stack to concentrate ink at the eight points:
 *  1. Rays are distributed non-uniformly inside each 45-degree sector so they
 *     bunch up around the sector's tip direction — the higher the falloff
 *     exponent, the tighter the bunching.
 *  2. A ray's inner endpoint is pushed outward the further it sits from the
 *     tip direction, so few lines cross the middle of the star and many cross
 *     the outer ring. That cancels the natural 1/r thinning of a pure radial
 *     fan (and keeps the pen off a solid ink blob at the centre), leaving line
 *     density rising toward the tips.
 */
function starOrnament(
  cx: number,
  cy: number,
  outer: number,
  inner: number,
  raysPerSector: number,
  falloff: number,
  out: Pt[][],
): void {
  for (let m = 0; m < 8; m++) {
    // Tip directions sit at 22.5 + 45m degrees.
    const tip = STEP + m * 2 * STEP;
    for (let k = 0; k < raysPerSector; k++) {
      const u = -1 + (2 * (k + 0.5)) / raysPerSector; // in (-1, 1)
      const sign = u < 0 ? -1 : 1;
      const warped = sign * Math.pow(Math.abs(u), falloff);
      const theta = tip + warped * STEP;
      const rho = starRadiusAt(theta, outer, inner);
      const start = rho * (0.06 + 0.6 * Math.abs(warped));
      const ct = Math.cos(theta);
      const st = Math.sin(theta);
      out.push([
        { x: cx + ct * start, y: cy + st * start },
        { x: cx + ct * rho, y: cy + st * rho },
      ]);
    }
  }
}

/**
 * Clip a polyline to an axis-aligned rectangle (Liang-Barsky per segment),
 * splitting it into the pieces that survive.
 */
function clipPolylineToRect(
  polyline: Pt[],
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): Pt[][] {
  if (polyline.length < 2) return [];

  const result: Pt[][] = [];
  let current: Pt[] = [];

  function clipSegment(p0: Pt, p1: Pt): [Pt, Pt] | null {
    let t0 = 0;
    let t1 = 1;
    const dx = p1.x - p0.x;
    const dy = p1.y - p0.y;

    function clipEdge(p: number, q: number): boolean {
      if (Math.abs(p) < 1e-12) return q >= 0;
      const t = q / p;
      if (p < 0) {
        if (t > t1) return false;
        if (t > t0) t0 = t;
      } else {
        if (t < t0) return false;
        if (t < t1) t1 = t;
      }
      return true;
    }

    if (
      !clipEdge(-dx, p0.x - x0) ||
      !clipEdge(dx, x1 - p0.x) ||
      !clipEdge(-dy, p0.y - y0) ||
      !clipEdge(dy, y1 - p0.y)
    ) {
      return null;
    }
    if (t0 > t1) return null;

    return [
      { x: p0.x + t0 * dx, y: p0.y + t0 * dy },
      { x: p0.x + t1 * dx, y: p0.y + t1 * dy },
    ];
  }

  for (let i = 0; i < polyline.length - 1; i++) {
    const clipped = clipSegment(polyline[i], polyline[i + 1]);
    if (clipped) {
      const [c0, c1] = clipped;
      if (current.length === 0) {
        current.push(c0);
      } else {
        const last = current[current.length - 1];
        if (Math.abs(last.x - c0.x) + Math.abs(last.y - c0.y) > 1e-4) {
          if (current.length >= 2) result.push(current);
          current = [c0];
        }
      }
      current.push(c1);
    } else {
      if (current.length >= 2) result.push(current);
      current = [];
    }
  }

  if (current.length >= 2) result.push(current);
  return result;
}

const starTilingOrnament: Composition2DDefinition = {
  id: "starTilingOrnament",
  name: "Star Tiling Ornament",
  description:
    "Octagram/octagon/diamond tessellation with radial line-density ornament inside each 8-pointed star",
  tags: ["pattern", "tiling", "star", "octagram", "islamic", "ornament", "geometric"],
  category: "2d",
  type: "2d",
  renderMode: "debounced",

  controls: {
    tileSize: {
      type: "slider",
      label: "Tile Size",
      default: 130,
      min: 40,
      max: 320,
      step: 5,
      group: "Tiling",
    },
    ornamentDensity: {
      type: "slider",
      label: "Ornament Density",
      default: 14,
      min: 2,
      max: 60,
      step: 1,
      group: "Ornament",
    },
    ornamentFalloff: {
      type: "slider",
      label: "Ornament Falloff",
      default: 2.4,
      min: 1,
      max: 5,
      step: 0.1,
      group: "Ornament",
    },
    tileEdges: {
      type: "toggle",
      label: "Tile Boundaries",
      default: true,
      group: "Display",
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
    const tileSize = values.tileSize as number;
    const raysPerSector = Math.max(1, Math.round(values.ornamentDensity as number));
    const falloff = values.ornamentFalloff as number;
    const tileEdges = values.tileEdges as boolean;
    const margin = values.margin as number;

    const x0 = margin;
    const y0 = margin;
    const x1 = width - margin;
    const y1 = height - margin;
    const innerW = x1 - x0;
    const innerH = y1 - y0;
    if (innerW <= 0 || innerH <= 0 || tileSize <= 0) return [];

    // Lattice geometry (see constants above).
    const d = tileSize;
    const outer = d * R_PER_TILE; // star circumradius
    const inner = outer * INNER_RATIO; // star notch radius
    const octRadius = d / Math.SQRT2 - inner; // connector octagon circumradius
    const rhombHx = d / 2 - inner; // rhombus half-diagonal along the lattice axis
    const rhombHy = outer * Math.sin(STEP); // rhombus half-diagonal across it

    const nx = Math.ceil(innerW / d) + 2;
    const ny = Math.ceil(innerH / d) + 2;
    const cx0 = x0 + innerW / 2;
    const cy0 = y0 + innerH / 2;

    const raw: Pt[][] = [];

    for (let j = 0; j < ny; j++) {
      const sy = cy0 + (j - (ny - 1) / 2) * d;
      for (let i = 0; i < nx; i++) {
        const sx = cx0 + (i - (nx - 1) / 2) * d;

        starOrnament(sx, sy, outer, inner, raysPerSector, falloff, raw);

        if (tileEdges) {
          raw.push(starOutline(sx, sy, outer, inner));
          // Connector tiles: one octagon per cell, two rhombi per cell.
          raw.push(octagonOutline(sx + d / 2, sy + d / 2, octRadius));
          raw.push(rhombusOutline(sx + d / 2, sy, rhombHx, rhombHy));
          raw.push(rhombusOutline(sx, sy + d / 2, rhombHy, rhombHx));
        }
      }
    }

    const polylines: Pt[][] = [];
    for (const poly of raw) {
      for (const seg of clipPolylineToRect(poly, x0, y0, x1, y1)) {
        if (seg.length >= 2) polylines.push(seg);
      }
    }

    return polylines;
  },
};

export default starTilingOrnament;
