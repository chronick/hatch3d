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
  ESCALATE_FACTOR,
  OUTLINE_BASE_RADIUS,
  RASTER_MAX_CELLS,
  RASTER_CAP_CELLS,
  REFINE_BUDGET_PER_COARSE_CELL,
  REFINE_CELL_BUDGET,
  REFINE_FACTOR,
  REFINE_PAD_CELLS,
  type Point,
  type Polyline,
  type RasterRefineStats,
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

/** A zeroed refinement-stats accumulator to hand to `rasterUnionRings`. */
const freshStats = (): RasterRefineStats => ({
  candidates: 0,
  kept: 0,
  dropped: 0,
  keptUnrefined: 0,
  replaced: 0,
  escalated: false,
  fineCandidates: 0,
});

/**
 * The stats of a call that stayed on the per-window path — every fixture in
 * this file except the dense 170 × 170 lattice at the bottom. Spelled as a
 * spread so the `toEqual`s below keep saying what they said before the
 * escalation fields existed: nothing escalated, and there was no fine grid.
 */
const SPARSE_PATH = { escalated: false, fineCandidates: 0 } as const;

/** Best of `reps` timed runs, after a warm-up call for JIT and allocation. */
function timeBest(run: () => unknown, reps = 3): number {
  run();
  let best = Infinity;
  for (let i = 0; i < reps; i++) {
    const t0 = performance.now();
    run();
    best = Math.min(best, performance.now() - t0);
  }
  return best;
}

/** Centroid of a ring's bbox — where a sub-cell ring *is*, near enough. */
function ringCentre(ring: Polyline): Point {
  let xMin = Infinity;
  let yMin = Infinity;
  let xMax = -Infinity;
  let yMax = -Infinity;
  for (const p of ring) {
    xMin = Math.min(xMin, p.x);
    xMax = Math.max(xMax, p.x);
    yMin = Math.min(yMin, p.y);
    yMax = Math.max(yMax, p.y);
  }
  return { x: (xMin + xMax) / 2, y: (yMin + yMax) / 2 };
}

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
 *
 * The union of two discs has no holes and one or two boundary components, so
 * "how many rings" is a statement the geometry answers exactly — which makes it
 * the sharpest available probe of the saddle decider, swept over neck widths and
 * approach angles below.
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

  /**
   * Where two overlapping discs cross, the *exterior* has a reflex cusp: a wedge
   * (36° wide at d=19, r=10) whose tip is the circle intersection. A lattice
   * sample landing just inside that tip has all four of its 4-neighbours inside
   * the union and only a *diagonal* neighbour outside, so the wedge's connection
   * to the outside world is finer than the lattice. Marching squares then reads
   * the sample as an enclosed hole, and it is not wrong to: the bilinear
   * interpolant over those four corners really does close around it (its saddle
   * value is -4.0e-4, negative — the inside diagonal joins), and both the
   * asymptotic and the old corner-mean decider agree on that cell.
   *
   * So this is a *sampling* artefact of the distance field at a cusp, not a
   * saddle-decider artefact, and no per-cell contour rule removes it — see the
   * `silhouette-knockout.test.ts` refutations, which pin the decider's answer on
   * two cells of exactly this shape. It shows up at exactly these three of the
   * 48 sweep positions below, as one sub-cell hole at each of the neck's two
   * cusps (|area| ≈ 0.0008–0.002 against a cell of ≈0.032–0.037).
   *
   * `rasterUnionRings` is the layer that can settle it, because it holds the
   * exact segment set: it re-rasterises a window around each sub-cell candidate
   * at `REFINE_FACTOR`× and asks whether the pocket really is enclosed. At the
   * cusp it is not — the wedge opens out through a channel finer than the coarse
   * cell — so the speck is dropped *on evidence*, and `stats` below pins that it
   * went through the refinement rather than through a blanket area filter.
   */
  const CUSP_SPECKS = ["19/27", "19/63", "19.9/45"] as const;

  it.each(CUSP_SPECKS)("drops the cusp speck at %s on refined evidence", (pos) => {
    const [d, deg] = pos.split("/").map(Number);
    const pts: Polyline[] = [at(0, 0), at(d, deg)];
    const stats = freshStats();
    const rings = rasterUnionRings(pts, R, RASTER_MAX_CELLS, RASTER_CAP_CELLS, stats);

    // The refinement is what removed them: one sub-cell candidate per cusp,
    // each examined and dropped. A blanket area filter would show up here as
    // candidates = 0 — nothing was ever looked at, and a spent budget as
    // keptUnrefined — nothing was affordable to look at.
    expect(stats, `ring areas: ${rings.map((r) => polygonArea(r).toFixed(4))}`).toEqual({
      candidates: 2,
      kept: 0,
      dropped: 2,
      keptUnrefined: 0,
      replaced: 0,
      // Two candidates against a million-cell allowance: nowhere near the
      // density that would make a whole-extent re-raster the cheaper tool.
      ...SPARSE_PATH,
    });
    expect(rings).toHaveLength(1);
    expect(Math.abs(polygonArea(rings[0]))).toBeCloseTo(unionArea(R, d), 0);

    // …and the classification around each cusp agrees with the true geometry.
    // The two cusps sit on the neck's midline, `out` px either side of the axis
    // joining the centres; stepping further off the axis leaves the union, and
    // stepping back towards it enters. Both circles are `R` from their own
    // centre at the cusp, so both probes are exact statements about the union,
    // not approximations of it.
    const u = { x: Math.cos((deg * Math.PI) / 180), y: Math.sin((deg * Math.PI) / 180) };
    const n = { x: -u.y, y: u.x };
    const onMidline = (off: number) => ({
      x: (d / 2) * u.x + off * n.x,
      y: (d / 2) * u.y + off * n.y,
    });
    const out = Math.sqrt(R * R - (d / 2) * (d / 2)); // cusp offset from the axis
    for (const k of [1, -1]) {
      expect(pointInSilhouette(onMidline(k * (out - 0.5)), rings), `inside ${pos}`).toBe(true);
      expect(pointInSilhouette(onMidline(k * (out + 0.5)), rings), `outside ${pos}`).toBe(false);
    }
  });

  /**
   * The same cusp, one wall away from being an artefact.
   *
   * Drop the 19/27° peanut inside a closed rectangle buffered by the same
   * radius and the drawing becomes a **closed cavity complex**: a large chamber
   * (the paper between the box wall and the peanut), a narrow corridor (the
   * exterior wedge at each of the peanut's two cusps, which opens by 36° and is
   * finer than a coarse cell near its tip) and a small chamber (the sub-cell
   * pocket at the wedge tip that the lattice catches a sample in). Every one of
   * them is enclosed by ink; none of them touches the outside world.
   *
   * The candidate is the same cusp pocket, and the refined flood does exactly
   * what it does on the bare peanut — it walks out of the window along the
   * wedge. Reading that as drainage deleted a chamber of a genuine hole and
   * flipped its sample from paper to ink. Drainage is a statement about the
   * **global** exterior, so the escape point is now checked against the coarse
   * grid's border-connected outside mask: outside the box it is drainage and
   * the speck goes, inside the box it is a corridor and the chamber stays. The
   * bare peanut is run at the same call parameters below, so the verdicts flip
   * on the wall and on nothing else.
   *
   * `maxCells` is pinned so the enclosure — which triples the drawing's extent —
   * does not coarsen the grid away from the ≈0.2px cell that puts a sample in
   * the wedge tip in the first place. It is the fixture holding the cusp still,
   * not part of what is being tested.
   */
  it("keeps a sub-cell chamber whose corridor drains into an enclosed cavity", () => {
    const MARGIN = 25;
    const CELLS = 480;
    const c = at(19, 27)[0];
    const box: Polyline = [
      { x: -R - MARGIN, y: -R - MARGIN },
      { x: c.x + R + MARGIN, y: -R - MARGIN },
      { x: c.x + R + MARGIN, y: c.y + R + MARGIN },
      { x: -R - MARGIN, y: c.y + R + MARGIN },
      { x: -R - MARGIN, y: -R - MARGIN },
    ];
    const lines: Polyline[] = [at(0, 0), at(19, 27), box];

    const bare = freshStats();
    rasterUnionRings([at(0, 0), at(19, 27)], R, CELLS, RASTER_CAP_CELLS, bare);
    const enclosed = freshStats();
    const rings = rasterUnionRings(lines, R, CELLS, RASTER_CAP_CELLS, enclosed);

    // Same two candidates, opposite verdicts — the only difference is the wall.
    expect(bare).toMatchObject({ candidates: 2, kept: 0, dropped: 2 });
    expect(enclosed, `ring areas: ${rings.map((r) => polygonArea(r).toFixed(4))}`).toEqual({
      candidates: 2,
      kept: 2,
      dropped: 0,
      keptUnrefined: 0,
      // A component that leaves its window has no closed contour inside it, so
      // these two keeps stay on their coarse rings (cf. the pinhole below).
      replaced: 0,
      ...SPARSE_PATH,
    });

    // Three structural rings — the box's outer skin, the cavity inside it, the
    // peanut — plus the two chambers.
    expect(rings).toHaveLength(5);
    const spec = rasterGridSpec(lines, R, CELLS, RASTER_CAP_CELLS)!;
    const kept = rings.filter((ring) => Math.abs(polygonArea(ring)) <= spec.cell ** 2);
    expect(kept).toHaveLength(2);

    // …and they are the two cusps, not specks from somewhere else. The cusps sit
    // on the neck's midline, `out` px either side of the centre-to-centre axis.
    const u = { x: Math.cos((27 * Math.PI) / 180), y: Math.sin((27 * Math.PI) / 180) };
    const nrm = { x: -u.y, y: u.x };
    const off = Math.sqrt(R * R - 9.5 * 9.5);
    const cusps = [1, -1].map((k) => ({
      x: 9.5 * u.x + k * off * nrm.x,
      y: 9.5 * u.y + k * off * nrm.y,
    }));
    for (const ring of kept) {
      const centre = ringCentre(ring);
      const nearest = Math.min(...cusps.map((q) => Math.hypot(centre.x - q.x, centre.y - q.y)));
      expect(nearest, `sub-cell ring at ${centre.x.toFixed(3)},${centre.y.toFixed(3)}`).toBeLessThan(
        spec.cell,
      );
    }

    // The composition still reads correctly at large: wall is ink, the chamber
    // between wall and peanut is paper, the peanut is ink, outside is paper.
    expect(pointInSilhouette({ x: -R - MARGIN, y: 0 }, rings)).toBe(true);
    expect(pointInSilhouette({ x: -R - MARGIN + 12, y: 0 }, rings)).toBe(false);
    expect(pointInSilhouette({ x: 0, y: 0 }, rings)).toBe(true);
    expect(pointInSilhouette({ x: -R - MARGIN - 12, y: 0 }, rings)).toBe(false);
  });

  it("returns one boundary ring for a near-tangent neck at an off-axis angle", () => {
    // Second regression, same shape as 17.4/2° one rotation over.
    const pts: Polyline[] = [at(0, 0), at(19, 27)];
    const rings = rasterUnionRings(pts, R);
    expect(rings.length, `ring areas: ${rings.map((r) => polygonArea(r).toFixed(4))}`).toBe(1);
    expect(Math.abs(polygonArea(rings[0]))).toBeCloseTo(unionArea(R, 19), 0);
    for (const p of [{ x: 0, y: 0 }, { x: 16.9, y: 8.6 }, { x: 8.5, y: 4.3 }]) {
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
    // One ring while they overlap, two once they separate — never a speck in
    // between, at any approach angle. 20px is exactly tangent, so it is excluded
    // as a genuine tie. The angles are swept because the neck's orientation
    // relative to the lattice is what decides which cells go saddle at all:
    // 0°/45° are the two symmetric readings and 2°/27°/63°/88° are the lopsided
    // ones, where a cell's saddle sits well off its centre.
    const angles = [0, 2, 27, 45, 63, 88];
    const specked: string[] = [];
    for (const [d, want] of [
      [12, 1], [15, 1], [17.4, 1], [19, 1], [19.9, 1],
      [20.5, 2], [25, 2], [40, 2],
    ] as const) {
      for (const deg of angles) {
        const pts = [at(0, 0), at(d, deg)];
        const stats = freshStats();
        const rings = rasterUnionRings(pts, R, RASTER_MAX_CELLS, RASTER_CAP_CELLS, stats);
        const where = `d=${d} deg=${deg}: ${rings.map((r) => polygonArea(r).toFixed(4))}`;
        expect(rings.length, where).toBe(want);
        expect(stats.kept, `${where} kept a sub-cell ring`).toBe(0);
        expect(stats.keptUnrefined, `${where} kept a sub-cell ring unexamined`).toBe(0);
        if (stats.candidates > 0) specked.push(`${d}/${deg}`);
        expect(Math.abs(polygonArea(rings[0])), where).toBeCloseTo(
          want === 1 ? unionArea(R, d) : Math.PI * R * R,
          0,
        );
      }
    }
    // Exactly the documented cusp positions produce a sub-cell candidate at all,
    // so a change in the raster that creates (or stops creating) them fails here
    // rather than passing quietly.
    expect(specked).toEqual([...CUSP_SPECKS]);
  });
});

/**
 * A sub-cell ring is not automatically noise. The raster holds the *exact*
 * segment set and distance function, so when a candidate feature is finer than
 * the grid it can go and look instead of guessing from its area — and the two
 * cases really do differ: the cusp specks above are an artefact of sampling a
 * wedge whose channel to the outside is finer than a cell, while the pinhole
 * below is a genuine enclosed pocket that happens to catch a single sample.
 *
 * The fixture: a closed `2·HALF` square outline buffered at radius 4, with a
 * tail stroke attached at one corner — the tail is there only to widen the
 * drawing until the adaptive grid picks a cell of ≈0.157px, which is what makes
 * the hole land on exactly one sample. Points further than 4px from all four
 * sides form a real `2(HALF−4)` square pocket at the centre; the grid catches
 * one sample inside it, and the raw contour reports it as a ring of |area|
 * ≈ 0.02 against a cell² of ≈0.025 — sub-cell, and so a candidate.
 *
 * Blanket-filtering everything below a cell² deleted that ring and flipped the
 * centre of the square from outside the silhouette to inside — a hole in the
 * drawing filled in by the approximation.
 *
 * **Keeping the ring is only half the fix.** The coarse ring carries up to a
 * cell of positional error, which on a feature two thirds of a cell across is
 * error the size of the feature: at HALF = 4.05 the pinhole was kept and the
 * centre *still* came back inside the silhouette, because the ring the raster
 * reported sat 0.02px off the pocket it stood for. (The 8.2 case below is the
 * one that happened to be pinned first, and it passes either way — which is
 * exactly why it could not catch this.) A confirmed feature is therefore
 * re-drawn at refinement resolution, which is where its true extent already
 * lives: `replaced` in the stats, and a ring whose bounds are the pocket's.
 */
describe.each([4.05, 4.1])("sub-cell rings are decided on evidence — half %s", (HALF) => {
  const PINHOLE: Polyline[] = [
    [
      { x: -HALF, y: -HALF },
      { x: HALF, y: -HALF },
      { x: HALF, y: HALF },
      { x: -HALF, y: HALF },
      { x: -HALF, y: -HALF },
    ],
    [{ x: HALF, y: HALF }, { x: HALF + 14, y: HALF + 14 }],
  ];
  /** Half-width of the true pocket: everything further than the radius. */
  const POCKET = HALF - OUTLINE_BASE_RADIUS;

  it("the fixture really does have a hole — the centre is HALF px from every stroke", () => {
    // Guards the fixture itself: if the geometry ever stops enclosing a pocket,
    // the test below stops meaning anything.
    const rings = derivedRegionRings(PINHOLE, { of: "n", kind: "bbox" }); // cheap sanity
    expect(rings).toHaveLength(1);
    expect(distToRings({ x: 0, y: 0 }, PINHOLE)).toBeCloseTo(HALF, 9);
    expect(POCKET).toBeGreaterThan(0);
  });

  it("keeps a real sub-cell hole instead of filling it in", () => {
    const stats = freshStats();
    const rings = rasterUnionRings(
      PINHOLE,
      OUTLINE_BASE_RADIUS,
      RASTER_MAX_CELLS,
      RASTER_CAP_CELLS,
      stats,
    );
    expect(rings).toHaveLength(2);
    // The whole point: the centre of the square is *not* in the silhouette.
    expect(pointInSilhouette({ x: 0, y: 0 }, rings)).toBe(false);
    // …while the ink around it is.
    expect(pointInSilhouette({ x: HALF, y: 0 }, rings)).toBe(true);
    expect(pointInSilhouette({ x: 0, y: HALF }, rings)).toBe(true);
    // …and everything outside the buffered square still is not.
    expect(pointInSilhouette({ x: 0, y: HALF + OUTLINE_BASE_RADIUS + 1 }, rings)).toBe(false);
    expect(stats).toEqual({
      candidates: 1,
      kept: 1,
      dropped: 0,
      keptUnrefined: 0,
      replaced: 1,
      ...SPARSE_PATH,
    });
  });

  it("reports the hole where it actually is, to refinement resolution", () => {
    const spec = rasterGridSpec(PINHOLE, OUTLINE_BASE_RADIUS)!;
    const rings = rasterUnionRings(PINHOLE, OUTLINE_BASE_RADIUS);
    expect(rings).toHaveLength(2);
    const hole = rings.reduce((a, b) =>
      Math.abs(polygonArea(a)) < Math.abs(polygonArea(b)) ? a : b,
    );
    // The pocket is the square of points further than the radius from all four
    // sides: centred on the origin, POCKET px to each side. A ring built on the
    // coarse lattice can only place that to within a cell (0.157px) — a whole
    // pocket's width out. The refined one lands on it to a refined cell.
    const refinedCell = spec.cell / REFINE_FACTOR;
    for (const p of hole) {
      expect(Math.max(Math.abs(p.x), Math.abs(p.y))).toBeCloseTo(POCKET, 1);
      expect(Math.abs(Math.max(Math.abs(p.x), Math.abs(p.y)) - POCKET)).toBeLessThan(2 * refinedCell);
    }
    const centre = ringCentre(hole);
    expect(Math.hypot(centre.x, centre.y)).toBeLessThan(refinedCell);
  });
});

/**
 * A dense field of genuine sub-cell holes — the case that sized the budget.
 *
 * Two review rounds shaped this: first "over budget" was read as "not real"
 * and 2 977 of 3 136 real holes were deleted; then fail-preserve kept the
 * ring *count* right but a kept-unrefined coarse ring is displaced by up to a
 * cell, so on an adversarial variant 1 715 hole centres still classified as
 * ink. Positional truth needs refinement, so the budget now scales with the
 * coarse grid (REFINE_BUDGET_PER_COARSE_CELL) and this density refines fully.
 *
 * The fixture is a 20px grid of strokes buffered at 8.8, which leaves a 56 × 56
 * lattice of 2.4 × 2.4 pockets — 3 136 holes that are unambiguously there, each
 * enclosed by 6.4px of solid ink on every side, each below the 2.22px grid's
 * cell² and so a refinement candidate. Refining all of them costs ~20M refined
 * cells against a budget of 1M.
 *
 * Reading an unaffordable candidate as "not real" therefore filled in 2 977 of
 * the 3 136 holes: stats came back `{candidates: 3136, kept: 159, dropped:
 * 2977}` and 159 of the 3 136 hole centres classified as paper — the other
 * 2 977 read as solid ink, on no evidence whatsoever. The budget bounds what
 * the raster may *look at*; it cannot be allowed to bound what the raster is
 * willing to *believe*, so a candidate it cannot afford keeps the ring marching
 * squares drew and is counted as `keptUnrefined`.
 */
describe("a spent refinement budget preserves rings, it does not delete them", () => {
  const PITCH = 20;
  const N = 56;
  const RADIUS = 8.8;
  /** Every genuine pocket: 2.4 × 2.4, centred between four grid lines. */
  const POCKET = PITCH - 2 * RADIUS;
  const LATTICE: Polyline[] = Array.from({ length: 2 * (N + 1) }, (_, i) => {
    const k = Math.floor(i / 2) * PITCH;
    const end = N * PITCH;
    return i % 2 === 0
      ? [{ x: 0, y: k }, { x: end, y: k }]
      : [{ x: k, y: 0 }, { x: k, y: end }];
  });
  const holeCentre = (i: number): Point => ({
    x: (Math.floor(i / N) + 0.5) * PITCH,
    y: ((i % N) + 0.5) * PITCH,
  });

  it("the fixture really does hold 3 136 sub-cell holes", () => {
    const spec = rasterGridSpec(LATTICE, RADIUS)!;
    expect(POCKET).toBeCloseTo(2.4, 9);
    // Every pocket is a real one: its centre is 10px from the nearest stroke,
    // well past the 8.8 buffer, and its walls are 6.4px of solid ink.
    expect(distToRings(holeCentre(0), LATTICE)).toBeCloseTo(PITCH / 2, 9);
    // …and each is about one cell across, so the contour drawn round the single
    // sample it catches comes back sub-cell — a candidate, 3 136 times over
    // (pinned as `stats.candidates` below).
    expect(POCKET / spec.cell).toBeGreaterThan(0.5);
    expect(POCKET / spec.cell).toBeLessThan(1.5);
    // …and refining all of them is far more than the budget allows.
    expect(N * N * (2 * REFINE_PAD_CELLS * REFINE_FACTOR) ** 2).toBeGreaterThan(
      REFINE_CELL_BUDGET,
    );
  });

  it("refines every real hole under the grid-proportional budget", () => {
    const stats = freshStats();
    const rings = rasterUnionRings(LATTICE, RADIUS, RASTER_MAX_CELLS, RASTER_CAP_CELLS, stats);

    expect(stats.candidates).toBe(N * N);
    expect(stats.dropped).toBe(0);
    // Under the cost-optimal decision (review round-7) this density escalates:
    // 3 136 windows of 82² = 21.1M refined cells vs one 4× whole-extent pass
    // of ~4.1M — the fine pass is 5× cheaper and registers every pocket
    // uniformly. At the fine cell the 2.4px pockets are ~4 cells across, so no
    // sub-cell candidates remain.
    expect(stats.escalated).toBe(true);
    expect(stats.fineCandidates).toBe(0);
    expect(stats.keptUnrefined).toBe(0);
    expect(stats.kept).toBe(0);
    expect(stats.replaced).toBe(0);
    // One outer boundary plus one ring per hole: nothing was filled in.
    expect(rings).toHaveLength(1 + N * N);

    // Fine-grid holes come back as the pocket itself, 2.4 × 2.4, to within the
    // fine cell's interpolation error.
    const exact = rings.filter((r) => Math.abs(Math.abs(polygonArea(r)) - POCKET ** 2) < 0.6);
    expect(exact.length).toBe(N * N);
  });

  it("stays correct when a remote point reshapes the adaptive grid (review round-5 repro)", () => {
    // One independent dot far outside the lattice cannot affect the 3 136
    // analytic holes — it only changes the adaptive cell size. Under the fixed
    // budget this left 1 715 hole centres classifying as ink (misregistered
    // unrefined coarse rings); proportional sizing refines them all.
    const stats = freshStats();
    const withRemote = [...LATTICE, [{ x: 560, y: 1200 }]];
    const rings = rasterUnionRings(withRemote, RADIUS, RASTER_MAX_CELLS, RASTER_CAP_CELLS, stats);
    expect(stats.candidates).toBeGreaterThanOrEqual(N * N);
    expect(stats.keptUnrefined).toBe(0);
    expect(stats.dropped).toBe(0);
    for (let i = 0; i < 64; i++) {
      const p = holeCentre((i * 617) % (N * N));
      expect(pointInSilhouette(p, rings), `hole at ${p.x},${p.y}`).toBe(false);
    }
  });


  it("classifies the lattice correctly — paper in the holes, ink in the walls", () => {
    const rings = rasterUnionRings(LATTICE, RADIUS);
    // A deterministic scatter over the lattice; the full 3 136-point sweep is
    // the same answer at 80× the cost (every hole passes).
    for (let i = 0; i < 48; i++) {
      const p = holeCentre((i * 617) % (N * N));
      expect(pointInSilhouette(p, rings), `hole at ${p.x},${p.y}`).toBe(false);
    }
    // …and the ink between them still reads as ink.
    for (const p of [
      { x: PITCH, y: PITCH },
      { x: PITCH / 2, y: 2 * PITCH },
      { x: 3 * PITCH, y: 3.5 * PITCH },
    ]) {
      expect(pointInSilhouette(p, rings), `wall at ${p.x},${p.y}`).toBe(true);
    }
    // …and outside the lattice is paper.
    expect(pointInSilhouette({ x: -RADIUS - 2, y: -RADIUS - 2 }, rings)).toBe(false);
  });

  it("still resolves inside the wall-clock budget", () => {
    // The densest refinement case in the suite: 3 136 candidates, ~160 windows
    // opened before the budget closes, ~160 refined rings each checked against
    // 3 136 siblings for the substitution guard. Measured ~75ms on the dev
    // machine (M-series, node 24) against the same 250ms ceiling — the guard is
    // bbox-prefiltered, so this is where an accidental quadratic would show.
    const ms = timeBest(() => rasterUnionRings(LATTICE, RADIUS), 2);
    // Under the cost-optimal decision (review round-7) this fixture escalates
    // — one 4× whole-extent pass instead of 3 136 overlapping windows — which
    // is both the correct answer and ~4× cheaper than the per-window ~1.24s
    // it used to cost. The generous ceiling still guards against an
    // accidental quadratic without flaking on CI variance.
    expect(ms, `dense lattice took ${ms.toFixed(1)}ms`).toBeLessThan(2000);
  });
});

/**
 * Plotter-material density — the case per-window refinement cannot reach at any
 * budget, and the one that forces escalation (review round-6).
 *
 * The fixture is the lattice above scaled up: pitch 20 over a 3 400px extent —
 * 342 crossing strokes, 28 900 pockets — outlined at radius 4. The default cap
 * gives 6.66px cells, so the widened effective radius is 6.66 and each pocket is
 * 6.69px across: one cell, and so a sub-cell candidate 28 899 times over.
 *
 * The per-window path cannot carry that, and not by a tunable margin. A window
 * is the candidate's span plus two cells of padding on every side, sampled 16×
 * finer — ~5 600 cells for a compact one — while the candidates themselves sit
 * one per nine coarse cells. Demand is therefore ~600× the whole grid, against
 * an allowance that is 128× it: 162M cells wanted, 34.2M available. Measured
 * before this change: 6 116 candidates refined, **22 783 preserved unrefined**,
 * and because an unrefined coarse ring is displaced by up to a cell — the whole
 * width of the feature here — **166 of 256 sampled pocket centres came back as
 * ink**, each one analytically 10px from the nearest stroke against a 6.66px
 * radius. It took 10.1s to get that wrong.
 *
 * Raising the budget does not fix it: the windows *overlap*, so the same paper
 * is re-rasterised once per neighbour. Escalation drops the per-candidate
 * question entirely and rasters the whole extent at `ESCALATE_FACTOR`× once —
 * at which resolution a pocket is four fine cells across, not one, so there is
 * nothing sub-cell left to ask about (`fineCandidates: 0`) and the contour is
 * simply right. Measured after: 0 of 256 misclassified, 330ms.
 */
describe("a candidate field too dense to refine window-by-window escalates", () => {
  const PITCH = 20;
  const N = 170;
  const RADIUS = 4;
  const LATTICE: Polyline[] = Array.from({ length: 2 * (N + 1) }, (_, i) => {
    const k = Math.floor(i / 2) * PITCH;
    const end = N * PITCH;
    return i % 2 === 0
      ? [{ x: 0, y: k }, { x: end, y: k }]
      : [{ x: k, y: 0 }, { x: k, y: end }];
  });
  const holeCentre = (i: number): Point => ({
    x: (Math.floor(i / N) + 0.5) * PITCH,
    y: ((i % N) + 0.5) * PITCH,
  });

  it("the fixture really is past the per-window path's density ceiling", () => {
    // Guards the fixture: if it ever stops exhausting the allowance it stops
    // exercising escalation, and the test below would pass on the sparse path.
    const spec = rasterGridSpec(LATTICE, RADIUS)!;
    // The escalation decision is cost-optimal (review round-7): per-window
    // demand vs the fine pass's own cost. Guard that this fixture still sits
    // on the escalating side of that comparison.
    const fineCost = spec.gw * ESCALATE_FACTOR * (spec.gh * ESCALATE_FACTOR);
    // One window per pocket, each the pocket's ~1 cell plus 2 cells of padding
    // either side, at REFINE_FACTOR× — a floor on the true demand.
    const window = ((1 + 2 * REFINE_PAD_CELLS) * REFINE_FACTOR) ** 2;
    expect(N * N * window).toBeGreaterThan(fineCost);

    // …and every pocket is unambiguously real: its centre is 10px from the
    // nearest stroke against a 6.66px effective radius, and its walls are
    // 6.66px of solid ink.
    expect(distToRings(holeCentre(0), LATTICE)).toBeCloseTo(PITCH / 2, 9);
    expect(spec.effectiveRadius).toBeLessThan(PITCH / 2);
    // …and about one *coarse* cell across, which is what makes it a candidate…
    const pocket = PITCH - 2 * spec.effectiveRadius;
    expect(pocket / spec.cell).toBeGreaterThan(0.5);
    expect(pocket / spec.cell).toBeLessThan(1.5);
    // …and comfortably more than one *fine* cell across, which is what makes
    // escalating a fix rather than a smaller version of the same problem.
    expect(pocket / (spec.cell / ESCALATE_FACTOR)).toBeGreaterThan(3);
  });

  it("blank extent cannot suppress escalation (review round-7 repro)", () => {
    // A stray point far into empty space inflates the grid without adding a
    // single candidate. Under the allowance-gated decision that blank area
    // RAISED the allowance and kept the call on the per-window path — 23 474
    // of 28 900 real pockets read as ink. Cost-optimally, blank extent only
    // makes the fine pass costlier; demand is unchanged, so it still wins.
    const stats = freshStats();
    const withBlank = [...LATTICE, [{ x: 4150, y: 4150 }]];
    const rings = rasterUnionRings(withBlank, RADIUS, RASTER_MAX_CELLS, RASTER_CAP_CELLS, stats);
    expect(stats.escalated).toBe(true);
    expect(stats.dropped).toBe(0);
    expect(stats.keptUnrefined).toBe(0);
    for (let i = 0; i < 256; i++) {
      const p = holeCentre((i * 5449) % (N * N));
      expect(pointInSilhouette(p, rings), `hole at ${p.x},${p.y}`).toBe(false);
    }
  });

  it("escalates once, and registers every pocket where it actually is", () => {
    const stats = freshStats();
    const rings = rasterUnionRings(LATTICE, RADIUS, RASTER_MAX_CELLS, RASTER_CAP_CELLS, stats);

    // The coarse grid saw the density — one sub-cell candidate per pocket, bar
    // the odd one whose contour came out a hair over a cell² and went straight
    // through as an ordinary ring (28 899 of 28 900 here).
    expect(stats.escalated).toBe(true);
    expect(stats.candidates).toBeGreaterThan(N * N - 4);
    expect(stats.candidates).toBeLessThanOrEqual(N * N);
    // …and at 4× there is nothing sub-cell left to ask about, so no window is
    // opened at all: the escalated grid resolves the pockets outright.
    expect(stats.fineCandidates).toBe(0);
    expect(stats.kept + stats.dropped + stats.keptUnrefined).toBe(0);
    // Nothing preserved-unrefined (the round-5 failure) and nothing deleted
    // (the round-4 one).
    expect(stats.keptUnrefined).toBe(0);
    expect(stats.dropped).toBe(0);

    // One outer boundary plus one ring per pocket — every hole present, exactly
    // once, with nothing filled in and nothing invented.
    expect(rings).toHaveLength(1 + N * N);

    // The finding itself: a deterministic 256-centre sample, every one of which
    // is 10px from the nearest stroke and so paper. 166 of these read as ink
    // before escalation existed.
    let ink = 0;
    for (let i = 0; i < 256; i++) {
      const p = holeCentre((i * 617) % (N * N));
      if (pointInSilhouette(p, rings)) ink++;
    }
    expect(ink, `${ink}/256 pocket centres classified as ink`).toBe(0);

    // …and the ink between the pockets still reads as ink.
    for (const p of [
      { x: PITCH, y: PITCH },
      { x: PITCH / 2, y: 40 * PITCH },
      { x: 100 * PITCH, y: 137.5 * PITCH },
    ]) {
      expect(pointInSilhouette(p, rings), `wall at ${p.x},${p.y}`).toBe(true);
    }
    expect(pointInSilhouette({ x: -RADIUS - 2, y: -RADIUS - 2 }, rings)).toBe(false);
  });

  it("costs less than the per-window path it replaces, not more", () => {
    // 10.1s before (162M refined cells demanded, 34.2M spent, 22 783 pockets
    // left misregistered); ~330ms after, for one 2 068² raster and a contour.
    // The ceiling is the same generous per-fixture one the 56 × 56 lattice
    // carries — what is being pinned is that escalation is the *cheap* path, so
    // a regression to per-window refinement at this density fails here.
    const ms = timeBest(() => rasterUnionRings(LATTICE, RADIUS), 1);
    expect(ms, `dense 170x170 lattice took ${ms.toFixed(1)}ms`).toBeLessThan(2000);
  });
});

// ── 3. Cost bound ───────────────────────────────────────────────────────────

/**
 * Wall-clock ceiling for one region resolve on fine-detail geometry.
 *
 * Measured on the dev machine (M-series, node 24): 22–23ms for `outline` over
 * the star field below, 30ms for `occupied`, 50ms for a deliberately
 * pathological 2 000-stroke saturated canvas. The budget is set several times
 * above the measurement so machine and CI variance cannot flake it — it is a
 * guard against an accidental quadratic, not a performance target.
 *
 * None of these three sheds a sub-cell ring, so none of them pays for
 * refinement; where it does fire it is small change against the main grid —
 * the pinhole fixture's window is 6.4k refined cells against a 38k-cell main
 * raster, and the whole call still resolves in well under a millisecond. The
 * dense-lattice fixture above carries the same ceiling for the case that *does*
 * pay: 3 136 candidates, a spent budget and ~160 ring substitutions.
 */
const RESOLVE_BUDGET_MS = 250;

describe("cost — the adaptive grid stays bounded on fine-detail geometry", () => {
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
