/**
 * Fidelity and cost of the buffered union (`outline` / `occupied`).
 *
 * The behavioural contract for these kinds lives in `region-shapes.test.ts`;
 * this file pins the two properties that the rasterised approximation is
 * actually judged on:
 *
 *  1. **Fidelity** — the ring tracks the geometry at the stroke radius. For a
 *     thin open stroke every point of it sits on the union's outer skin, so the
 *     nearest ring point must be at distance ≈ `strokeRadius`. The tolerance is
 *     stated as a fraction of the grid cell (see `TOL_CELLS`), which is what the
 *     approximation is actually bounded by.
 *  2. **Cost** — the adaptive grid resolves *fine* geometry by refining, so the
 *     bound that matters is a wall-clock ceiling on a fine-detail input.
 *
 * Both were regressions before the adaptive/distance-field pass: on the 12-point
 * star below, `outline` was off by 0.99px on a 4px radius (25%), and `occupied`
 * came back as **408 speck rings** instead of two, because a 1px stroke is
 * thinner than the fixed 2.1px cell and rasterised as a dotted line.
 */

import { describe, it, expect } from "vitest";
import {
  derivedRegionRings,
  polygonArea,
  rasterGridSpec,
  rasterUnionRings,
  OUTLINE_BASE_RADIUS,
  RASTER_MAX_CELLS,
  RASTER_CAP_CELLS,
  type Point,
  type Polyline,
} from "../operators/region-shapes";
import { pointInSilhouette } from "../operators/silhouette-knockout";

// ── Fine-detail fixtures ────────────────────────────────────────────────────

/** A closed n-point star polyline — 2n vertices, alternating outer/inner. */
function star(cx: number, cy: number, outer: number, inner: number, points: number): Polyline {
  const ring: Polyline = [];
  for (let i = 0; i < points * 2; i++) {
    const a = (Math.PI * i) / points - Math.PI / 2;
    const r = i % 2 === 0 ? outer : inner;
    ring.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  }
  ring.push({ x: ring[0].x, y: ring[0].y });
  return ring;
}

/**
 * The fidelity fixture: a 12-point star, 400px across, arms 115px long. Its
 * inner vertices sit 90px out and its edges pass 40px from the centre, so up to
 * a ~12px buffer the arms stay separate and the star keeps one clean hole —
 * which is what makes every sampled point lie on the union's skin, and so makes
 * "distance to the ring = the stroke radius" a statement about the raster
 * rather than about the shape.
 */
const STAR: Polyline[] = [star(300, 300, 200, 90, 12)];

/** 24 of those stars, quarter size, over a 1080px canvas — 576 short segments. */
const STAR_FIELD: Polyline[] = Array.from({ length: 24 }, (_, i) =>
  star(150 + (i % 6) * 180, 150 + Math.floor(i / 6) * 180, 80, 34, 12),
);

// ── Distance helpers ────────────────────────────────────────────────────────

function distToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  let t = 0;
  if (l2 > 1e-18) t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Distance from p to the nearest edge of any ring (rings are closed loops). */
function distToRings(p: Point, rings: Polyline[]): number {
  let best = Infinity;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const d = distToSegment(p, ring[j], ring[i]);
      if (d < best) best = d;
    }
  }
  return best;
}

/**
 * Sample step for a fidelity sweep: one point per cell, but never more than
 * `budget` points in total — the check is O(samples × ring edges), and every
 * vertex is sampled regardless of step (each segment contributes its start).
 */
function stepFor(lines: Polyline[], cell: number, budget = 800): number {
  let total = 0;
  for (const line of lines) {
    for (let i = 0; i + 1 < line.length; i++) {
      total += Math.hypot(line[i + 1].x - line[i].x, line[i + 1].y - line[i].y);
    }
  }
  return Math.max(cell, total / budget);
}

/** Points every `step` px along the geometry — vertices *and* edge interiors. */
function samplesAlong(lines: Polyline[], step: number): Point[] {
  const pts: Point[] = [];
  for (const line of lines) {
    for (let i = 0; i + 1 < line.length; i++) {
      const a = line[i];
      const b = line[i + 1];
      const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / step));
      for (let k = 0; k < n; k++) {
        const t = k / n;
        pts.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      }
    }
  }
  return pts;
}

/**
 * Tolerance, in grid cells.
 *
 * The ring is a marching-squares contour of an *exact* distance field with
 * linearly interpolated crossings, so it is not quantised to the lattice: the
 * error is the field's departure from linear across one cell — curvature
 * (≈ cell²/8r) plus the kink where two strokes' distance fields meet. Measured
 * worst case over the cases below is 0.20 cell (0.05 cell where the radius
 * comfortably exceeds the cell); 0.35 leaves headroom without being vacuous —
 * the pre-adaptive implementation missed by 0.47 cell on the same fixture and
 * would fail this.
 */
const TOL_CELLS = 0.35;

/**
 * Worst |distance-to-ring − radius| over the geometry, in cells. A thin stroke
 * lies entirely on the union's skin, so every sampled point should be exactly
 * one stroke radius from the boundary.
 */
function worstRadialErrorCells(lines: Polyline[], offsetPx: number, baseRadius: number): number {
  const spec = rasterGridSpec(lines, baseRadius + offsetPx)!;
  const rings = derivedRegionRings(lines, { of: "n", kind: "outline", offsetPx });
  expect(rings.length, "outline produced no rings").toBeGreaterThan(0);
  let worst = 0;
  for (const p of samplesAlong(lines, stepFor(lines, spec.cell))) {
    worst = Math.max(worst, Math.abs(distToRings(p, rings) - spec.effectiveRadius) / spec.cell);
  }
  return worst;
}

// ── 1. Fidelity ─────────────────────────────────────────────────────────────

describe("outline fidelity — the ring tracks the geometry at the stroke radius", () => {
  // Radii up to 12: beyond that the star's own arms merge (adjacent inner
  // vertices are 46.6px apart) and its interior points stop lying on the skin,
  // so the two-sided property is no longer a statement about the raster. The
  // one-sided half still holds at any radius — see the last case in this block.
  it.each([0, 4, 8])("holds at +%s px of offset on a 12-point star", (offsetPx) => {
    const err = worstRadialErrorCells(STAR, offsetPx, OUTLINE_BASE_RADIUS);
    expect(err, `worst radial error ${err.toFixed(3)} cells`).toBeLessThan(TOL_CELLS);
  });

  it("holds on a field of 24 small stars (576 segments)", () => {
    const err = worstRadialErrorCells(STAR_FIELD, 0, OUTLINE_BASE_RADIUS);
    expect(err, `worst radial error ${err.toFixed(3)} cells`).toBeLessThan(TOL_CELLS);
  });

  it("holds for `occupied`, whose radius is barely wider than a cell", () => {
    const spec = rasterGridSpec(STAR, 1)!;
    const rings = derivedRegionRings(STAR, { of: "n", kind: "occupied" });
    let worst = 0;
    for (const p of samplesAlong(STAR, stepFor(STAR, spec.cell))) {
      worst = Math.max(worst, Math.abs(distToRings(p, rings) - spec.effectiveRadius) / spec.cell);
    }
    expect(worst, `worst radial error ${worst.toFixed(3)} cells`).toBeLessThan(TOL_CELLS);
  });

  it("never reports a ring *inside* the stroke radius, at any radius", () => {
    // The union contains the disc of `radius` around every geometry point, so a
    // ring closer than that is the approximation eating into the region. Unlike
    // the two-sided bound this holds however fat the buffer gets, so it is the
    // half worth checking at radii where the star's arms have merged.
    for (const offsetPx of [0, 8, 20, 60]) {
      const radius = OUTLINE_BASE_RADIUS + offsetPx;
      const spec = rasterGridSpec(STAR, radius)!;
      const rings = derivedRegionRings(STAR, { of: "n", kind: "outline", offsetPx });
      const floor = spec.effectiveRadius - TOL_CELLS * spec.cell;
      for (const p of samplesAlong(STAR, stepFor(STAR, spec.cell))) {
        expect(distToRings(p, rings), `offset ${offsetPx}`).toBeGreaterThan(floor);
      }
    }
  });
});

describe("thin strokes stay whole instead of rasterising into specks", () => {
  it("gives the star one outer ring and one hole, not hundreds of specks", () => {
    // Regression: at the old fixed 192-cell grid this returned 408 rings.
    const rings = derivedRegionRings(STAR, { of: "n", kind: "occupied" });
    expect(rings.length).toBe(2);
    for (const p of STAR[0]) expect(pointInSilhouette(p, rings)).toBe(true);
  });

  it("keeps a hair-thin stroke connected even when the cap forces a coarse grid", () => {
    // 5000px of geometry at radius 0.5 wants a 40 000-cell grid; the cap allows
    // 512, so the radius is widened to one cell rather than allowed to dot.
    const long: Polyline[] = [[{ x: 0, y: 0 }, { x: 5000, y: 3000 }]];
    const spec = rasterGridSpec(long, 0.5)!;
    expect(spec.cells).toBe(RASTER_CAP_CELLS);
    expect(spec.effectiveRadius).toBeGreaterThan(0.5);
    expect(spec.effectiveRadius).toBeCloseTo(spec.cell, 6);

    const rings = rasterUnionRings(long, 0.5);
    expect(rings.length).toBe(1);
    for (const p of samplesAlong(long, 50)) expect(pointInSilhouette(p, rings)).toBe(true);
  });
});

// ── 2. Adaptive resolution ──────────────────────────────────────────────────

describe("rasterGridSpec — adaptive resolution, bounded both ways", () => {
  it("never drops below the legacy resolution and never exceeds the cap", () => {
    for (const lines of [STAR, STAR_FIELD]) {
      for (const radius of [0.25, 1, 4, 12, 40, 200]) {
        const spec = rasterGridSpec(lines, radius)!;
        expect(spec.cells, `radius ${radius}`).toBeGreaterThanOrEqual(RASTER_MAX_CELLS);
        expect(spec.cells, `radius ${radius}`).toBeLessThanOrEqual(RASTER_CAP_CELLS);
        // …and so does the grid itself: `cells` spans the longer side, plus 4
        // cells of border padding and up to 2 more when a sub-cell radius has
        // been widened. That product is the cost bound.
        expect(spec.gw, `radius ${radius}`).toBeLessThanOrEqual(RASTER_CAP_CELLS + 6);
        expect(spec.gh, `radius ${radius}`).toBeLessThanOrEqual(RASTER_CAP_CELLS + 6);
      }
    }
  });

  it("refines as the stroke gets finer — resolution follows the radius, not the extent", () => {
    const cells = [40, 12, 4, 2].map((r) => rasterGridSpec(STAR, r)!.cells);
    for (let i = 1; i < cells.length; i++) {
      expect(cells[i], `step ${i}`).toBeGreaterThanOrEqual(cells[i - 1]);
    }
    // A 4px stroke on this star used to get 2.1px cells; it now gets ~1px.
    expect(rasterGridSpec(STAR, 4)!.cell).toBeLessThan(1.5);
    expect(rasterGridSpec(STAR, 40)!.cells).toBe(RASTER_MAX_CELLS); // coarse is enough
  });

  it("reports the radius unchanged whenever the grid can resolve it", () => {
    for (const radius of [1, 4, 12, 40]) {
      const spec = rasterGridSpec(STAR, radius)!;
      expect(spec.effectiveRadius, `radius ${radius}`).toBeCloseTo(radius, 9);
    }
  });

  it("is null for empty geometry or a non-positive radius", () => {
    expect(rasterGridSpec([], 4)).toBeNull();
    expect(rasterGridSpec(STAR, 0)).toBeNull();
    expect(rasterGridSpec(STAR, -3)).toBeNull();
  });

  it("still honours an explicit finer `maxCells`, as the old signature did", () => {
    // `maxCells` is the *floor*, so it can only ever refine up to the cap —
    // raising it past the cap does not raise the ceiling (see the cap block).
    expect(rasterGridSpec(STAR, 40, 700, 700)!.cells).toBe(700);
    expect(rasterUnionRings(STAR, 40, 8).length).toBeGreaterThan(0);
  });
});

/**
 * `capCells` is a *cap*. It used to behave as one only when it happened to be
 * larger than the 192-cell floor: `max(floor, cap)` meant a caller asking for a
 * deliberately cheap 8-cell grid silently got a full-resolution one, while
 * `maxCells = 700` sailed past the advertised 512 ceiling. The cap is now
 * applied last and always wins.
 */
describe("rasterGridSpec — `capCells` is a true cap", () => {
  it("honours a cap below the 192-cell floor", () => {
    const spec = rasterGridSpec(STAR, 4, RASTER_MAX_CELLS, 8)!;
    expect(spec.cells).toBe(8);
    // The grid is `cells` across the longer side plus the 4 cells of border
    // padding marching squares needs to close a ring, plus up to 2 more when a
    // sub-cell radius has been widened — so `cap + 6` is the physical floor on
    // how small the grid itself can be made.
    expect(spec.gw).toBeLessThanOrEqual(8 + 6);
    expect(spec.gh).toBeLessThanOrEqual(8 + 6);
    // Coarse, but still a working raster rather than an empty one.
    expect(rasterUnionRings(STAR, 4, RASTER_MAX_CELLS, 8).length).toBeGreaterThan(0);
  });

  it("stays inside the default cap when no cap is passed", () => {
    for (const radius of [0.1, 0.5, 4, 40, 400]) {
      const cells = rasterGridSpec(STAR, radius)!.cells;
      expect(cells, `radius ${radius}`).toBeGreaterThanOrEqual(RASTER_MAX_CELLS);
      expect(cells, `radius ${radius}`).toBeLessThanOrEqual(RASTER_CAP_CELLS);
    }
  });

  it("lets an explicit cap above 512 win — the constant is a default, not a law", () => {
    // Documented choice: a caller who names a larger cap has priced it.
    expect(rasterGridSpec(STAR, 0.5, RASTER_MAX_CELLS, 700)!.cells).toBe(700);
    // …but only when the geometry actually wants that many cells.
    expect(rasterGridSpec(STAR, 40, RASTER_MAX_CELLS, 700)!.cells).toBe(RASTER_MAX_CELLS);
  });

  it("does not let `maxCells` raise the ceiling — a cap is a cap", () => {
    expect(rasterGridSpec(STAR, 40, 700)!.cells).toBe(RASTER_CAP_CELLS);
    expect(rasterGridSpec(STAR, 0.5, 4096, 256)!.cells).toBe(256);
  });
});

/**
 * Marching-squares saddle cases (5 / 10) and the chained-strand bookkeeping
 * around them — the topology half of the raster, as opposed to the fidelity
 * half above. The fixture is the reviewer's: two radius-10 point buffers whose
 * centres are 17.4px apart, so the discs overlap and the union is one peanut.
 */
describe("buffered union topology — overlapping blobs come back as one ring", () => {
  const R = 10;
  /** A single-point polyline at polar (d, deg) — i.e. a point buffer. */
  const at = (d: number, deg: number): Polyline => [
    { x: d * Math.cos((deg * Math.PI) / 180), y: d * Math.sin((deg * Math.PI) / 180) },
  ];

  /** Exact area of the union of two radius-r discs whose centres are d apart. */
  const unionArea = (r: number, d: number) => {
    if (d >= 2 * r) return 2 * Math.PI * r * r;
    const lens = 2 * r * r * Math.acos(d / (2 * r)) - (d / 2) * Math.sqrt(4 * r * r - d * d);
    return 2 * Math.PI * r * r - lens;
  };

  it("returns exactly one ring for two overlapping point buffers", () => {
    // Regression: this returned THREE rings — the true boundary plus two
    // specks shed where the near-tangent band along the top of a disc put two
    // crossings on the same lattice point and the chaining pass dead-ended.
    const pts: Polyline[] = [at(0, 0), at(17.4, 2)];
    const rings = rasterUnionRings(pts, R);
    expect(rings.length, `ring areas: ${rings.map((r) => polygonArea(r).toFixed(3))}`).toBe(1);
    // …and it is the *right* ring, not one of the specks.
    expect(Math.abs(polygonArea(rings[0]))).toBeCloseTo(unionArea(R, 17.4), 0);
    for (const p of [{ x: 0, y: 0 }, { x: 17.39, y: 0.6 }, { x: 8.7, y: 0.3 }]) {
      expect(pointInSilhouette(p, rings)).toBe(true);
    }
  });

  it("keeps two rings when the blobs genuinely do not touch", () => {
    for (const d of [21, 60]) {
      const rings = rasterUnionRings([at(0, 0), at(d, 2)], R);
      expect(rings.length, `centres ${d}px apart`).toBe(2);
      for (const ring of rings) {
        expect(Math.abs(polygonArea(ring))).toBeCloseTo(Math.PI * R * R, 0);
      }
    }
  });

  it("is stable as the blobs are swept through the touching point", () => {
    // One ring while they overlap, two once they separate — and never a speck
    // in between. 20px is exactly tangent, so it is excluded as a genuine tie.
    for (const d of [12, 15, 17.4, 19, 19.9]) {
      expect(rasterUnionRings([at(0, 0), at(d, 2)], R).length, `d=${d}`).toBe(1);
    }
    for (const d of [20.5, 25, 40]) {
      expect(rasterUnionRings([at(0, 0), at(d, 2)], R).length, `d=${d}`).toBe(2);
    }
  });
});

// ── 3. Cost bound ───────────────────────────────────────────────────────────

/**
 * Wall-clock ceiling for one region resolve on fine-detail geometry.
 *
 * Measured on the dev machine (M-series, node 24): 18–25ms for the star field
 * below, 34–41ms for a deliberately pathological 2 000-stroke saturated canvas.
 * The budget is set an order of magnitude above the measurement so machine and
 * CI variance cannot flake it — it is a guard against an accidental
 * quadratic, not a performance target.
 */
const RESOLVE_BUDGET_MS = 250;

describe("cost — the adaptive grid stays bounded on fine-detail geometry", () => {
  const timeBest = (run: () => unknown, reps = 3): number => {
    run(); // warm up: first call pays JIT + allocation
    let best = Infinity;
    for (let i = 0; i < reps; i++) {
      const t0 = performance.now();
      run();
      best = Math.min(best, performance.now() - t0);
    }
    return best;
  };

  it.each(["outline", "occupied"] as const)(
    "resolves %s over 24 stars (576 segments) inside the budget",
    (kind) => {
      const ms = timeBest(() => derivedRegionRings(STAR_FIELD, { of: "n", kind }));
      expect(ms, `${kind} took ${ms.toFixed(1)}ms`).toBeLessThan(RESOLVE_BUDGET_MS);
    },
  );

  it("resolves a saturated 2 000-stroke canvas inside the budget", () => {
    // Every stroke spans the canvas, so the buffered bands overlap everywhere —
    // the case that would expose a per-stroke × whole-grid blow-up.
    const hatch: Polyline[] = Array.from({ length: 2000 }, (_, i) => {
      const y = (i / 2000) * 1000;
      return [{ x: 0, y }, { x: 1000, y: y + 3 }];
    });
    const ms = timeBest(() => rasterUnionRings(hatch, OUTLINE_BASE_RADIUS), 2);
    expect(ms, `saturated canvas took ${ms.toFixed(1)}ms`).toBeLessThan(RESOLVE_BUDGET_MS);
  });
});
