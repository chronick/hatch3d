import { describe, it, expect } from "vitest";
import {
  derivedRegionRings,
  geometryBounds,
  bboxRing,
  offsetConvexPolygon,
  roundPolygonCorners,
  insetAndRoundPolygon,
  polygonArea,
  rasterUnionRings,
  OUTLINE_BASE_RADIUS,
  OCCUPIED_BASE_RADIUS,
  type Polyline,
} from "../operators/region-shapes";
import { pointInSilhouette } from "../operators/silhouette-knockout";

/** A ragged blob: a 100×60 rectangle outline plus a diagonal through it. */
const BLOB: Polyline[] = [
  [
    { x: 100, y: 200 },
    { x: 200, y: 200 },
    { x: 200, y: 260 },
    { x: 100, y: 260 },
    { x: 100, y: 200 },
  ],
  [
    { x: 100, y: 200 },
    { x: 200, y: 260 },
  ],
];

const SQUARE: Polyline = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 100 },
  { x: 0, y: 100 },
];

function area(ring: Polyline): number {
  return Math.abs(polygonArea(ring));
}

/**
 * Net area of an even-odd ring set. Marching squares emits outer contours and
 * hole contours with opposite winding, so the *signed* sum is the real covered
 * area — summing absolute areas would count a hole as extra coverage.
 */
function ringSetArea(rings: Polyline[]): number {
  return Math.abs(rings.reduce((s, r) => s + polygonArea(r), 0));
}

// ── kind: bbox ──────────────────────────────────────────────────────────────

describe("derivedRegionRings — bbox", () => {
  it("returns the exact axis-aligned bounds as a single 4-vertex ring", () => {
    const rings = derivedRegionRings(BLOB, { of: "n", kind: "bbox" });
    expect(rings.length).toBe(1);
    expect(rings[0]).toEqual([
      { x: 100, y: 200 },
      { x: 200, y: 200 },
      { x: 200, y: 260 },
      { x: 100, y: 260 },
    ]);
  });

  it("offsetPx grows and shrinks the box by exactly that much on every side", () => {
    const grown = derivedRegionRings(BLOB, { of: "n", kind: "bbox", offsetPx: 12 })[0];
    expect(grown).toEqual([
      { x: 88, y: 188 },
      { x: 212, y: 188 },
      { x: 212, y: 272 },
      { x: 88, y: 272 },
    ]);
    const shrunk = derivedRegionRings(BLOB, { of: "n", kind: "bbox", offsetPx: -10 })[0];
    expect(shrunk).toEqual([
      { x: 110, y: 210 },
      { x: 190, y: 210 },
      { x: 190, y: 250 },
      { x: 110, y: 250 },
    ]);
  });

  it("collapses to no ring when shrunk past its own size", () => {
    expect(derivedRegionRings(BLOB, { of: "n", kind: "bbox", offsetPx: -40 })).toEqual([]);
  });

  it("area moves monotonically with offsetPx", () => {
    const areas = [-20, -10, 0, 10, 20, 40].map(
      (offsetPx) => area(derivedRegionRings(BLOB, { of: "n", kind: "bbox", offsetPx })[0]),
    );
    for (let i = 1; i < areas.length; i++) {
      expect(areas[i], `offset step ${i}`).toBeGreaterThan(areas[i - 1]);
    }
  });

  it("cornerRadius yields the rounded-rect idiom — more vertices, arcs at the radius", () => {
    const sharp = derivedRegionRings(BLOB, { of: "n", kind: "bbox" })[0];
    const r = 12;
    const round = derivedRegionRings(BLOB, { of: "n", kind: "bbox", cornerRadius: r })[0];
    expect(round.length).toBeGreaterThan(sharp.length);

    const b = geometryBounds(BLOB)!;
    // Every point still sits inside the sharp box…
    for (const p of round) {
      expect(p.x).toBeGreaterThanOrEqual(b.xMin - 1e-9);
      expect(p.x).toBeLessThanOrEqual(b.xMax + 1e-9);
      expect(p.y).toBeGreaterThanOrEqual(b.yMin - 1e-9);
      expect(p.y).toBeLessThanOrEqual(b.yMax + 1e-9);
    }
    // …and every point in a corner quadrant is exactly `r` from that corner's
    // arc centre, which is what makes it a true rounded rectangle.
    const centres = [
      { x: b.xMin + r, y: b.yMin + r },
      { x: b.xMax - r, y: b.yMin + r },
      { x: b.xMax - r, y: b.yMax - r },
      { x: b.xMin + r, y: b.yMax - r },
    ];
    let arcPoints = 0;
    for (const p of round) {
      const inCorner = centres.find(
        (c) =>
          (c.x === b.xMin + r ? p.x < c.x : p.x > c.x) &&
          (c.y === b.yMin + r ? p.y < c.y : p.y > c.y),
      );
      if (!inCorner) continue;
      arcPoints++;
      expect(Math.hypot(p.x - inCorner.x, p.y - inCorner.y)).toBeCloseTo(r, 6);
    }
    expect(arcPoints).toBeGreaterThan(4);
  });

  it("clamps a corner radius larger than the shape instead of self-intersecting", () => {
    const round = derivedRegionRings(BLOB, { of: "n", kind: "bbox", cornerRadius: 500 })[0];
    const b = geometryBounds(BLOB)!;
    for (const p of round) {
      expect(p.x).toBeGreaterThanOrEqual(b.xMin - 1e-9);
      expect(p.x).toBeLessThanOrEqual(b.xMax + 1e-9);
      expect(p.y).toBeGreaterThanOrEqual(b.yMin - 1e-9);
      expect(p.y).toBeLessThanOrEqual(b.yMax + 1e-9);
    }
    expect(area(round)).toBeGreaterThan(0);
  });
});

// ── kind: hull ──────────────────────────────────────────────────────────────

describe("derivedRegionRings — hull", () => {
  const scatter: Polyline[] = [
    [
      { x: 40, y: 40 },
      { x: 180, y: 55 },
      { x: 210, y: 160 },
      { x: 120, y: 200 },
      { x: 30, y: 130 },
      { x: 110, y: 120 }, // interior point — must not become a hull vertex
    ],
  ];

  it("contains every input point", () => {
    const ring = derivedRegionRings(scatter, { of: "n", kind: "hull" })[0];
    expect(ring.length).toBeGreaterThanOrEqual(3);
    for (const p of scatter[0]) {
      // Nudge toward the centroid so boundary vertices test unambiguously.
      const q = { x: p.x * 0.999 + 115 * 0.001, y: p.y * 0.999 + 115 * 0.001 };
      expect(pointInSilhouette(q, [ring]), `point ${p.x},${p.y}`).toBe(true);
    }
  });

  it("is `hullOf` by another name — same polygon as a hull with no offset", () => {
    const ring = derivedRegionRings(scatter, { of: "n", kind: "hull", offsetPx: 0 })[0];
    expect(ring.length).toBe(5); // the interior point is not a vertex
  });

  it("area moves monotonically with offsetPx, and every original point survives growth", () => {
    const areas = [-20, -8, 0, 8, 20].map(
      (offsetPx) => area(derivedRegionRings(scatter, { of: "n", kind: "hull", offsetPx })[0]),
    );
    for (let i = 1; i < areas.length; i++) {
      expect(areas[i], `offset step ${i}`).toBeGreaterThan(areas[i - 1]);
    }
    const grown = derivedRegionRings(scatter, { of: "n", kind: "hull", offsetPx: 20 })[0];
    for (const p of scatter[0]) {
      expect(pointInSilhouette(p, [grown]), `point ${p.x},${p.y}`).toBe(true);
    }
  });

  it("cornerRadius adds vertices without leaving the sharp hull", () => {
    const sharp = derivedRegionRings(scatter, { of: "n", kind: "hull" })[0];
    const round = derivedRegionRings(scatter, { of: "n", kind: "hull", cornerRadius: 15 })[0];
    expect(round.length).toBeGreaterThan(sharp.length);
    expect(area(round)).toBeLessThan(area(sharp));
    for (const p of round) expect(pointInSilhouette(p, [sharp]) || onBoundary(p, sharp)).toBe(true);
  });

  it("returns nothing for degenerate (collinear) geometry", () => {
    const line: Polyline[] = [[{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 20, y: 20 }]];
    expect(derivedRegionRings(line, { of: "n", kind: "hull" })).toEqual([]);
  });
});

/** Within a hair of a polygon's edge — used where "inside" is ambiguous. */
function onBoundary(p: { x: number; y: number }, poly: Polyline, eps = 1e-6): boolean {
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[j];
    const b = poly[i];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < eps) continue;
    const d = Math.abs((b.x - a.x) * (a.y - p.y) - (a.x - p.x) * (b.y - a.y)) / len;
    if (d < eps) return true;
  }
  return false;
}

// ── kinds: outline / occupied ───────────────────────────────────────────────

describe("derivedRegionRings — outline / occupied", () => {
  it("outline rings enclose every point of the geometry", () => {
    const rings = derivedRegionRings(BLOB, { of: "n", kind: "outline" });
    expect(rings.length).toBeGreaterThanOrEqual(1);
    for (const line of BLOB) {
      for (const p of line) {
        expect(pointInSilhouette(p, rings), `point ${p.x},${p.y}`).toBe(true);
      }
    }
  });

  it("occupied hugs the ink more tightly than outline", () => {
    const outline = derivedRegionRings(BLOB, { of: "n", kind: "outline" });
    const occupied = derivedRegionRings(BLOB, { of: "n", kind: "occupied" });
    expect(occupied.length).toBeGreaterThanOrEqual(1);
    expect(ringSetArea(occupied)).toBeLessThan(ringSetArea(outline));
    // Both still cover the geometry itself.
    for (const p of BLOB[0]) expect(pointInSilhouette(p, occupied)).toBe(true);
  });

  it("outline grows monotonically with offsetPx", () => {
    const totalArea = (offsetPx: number) =>
      ringSetArea(derivedRegionRings(BLOB, { of: "n", kind: "outline", offsetPx }));
    const areas = [-2, 0, 6, 16, 30].map(totalArea);
    for (let i = 1; i < areas.length; i++) {
      expect(areas[i], `offset step ${i}`).toBeGreaterThan(areas[i - 1]);
    }
  });

  it("empties out when the offset cancels the stroke radius", () => {
    expect(derivedRegionRings(BLOB, { of: "n", kind: "outline", offsetPx: -OUTLINE_BASE_RADIUS })).toEqual([]);
    expect(derivedRegionRings(BLOB, { of: "n", kind: "occupied", offsetPx: -OCCUPIED_BASE_RADIUS })).toEqual([]);
  });

  it("separates disjoint blobs into their own rings", () => {
    const two: Polyline[] = [
      [{ x: 0, y: 0 }, { x: 40, y: 0 }],
      [{ x: 300, y: 300 }, { x: 340, y: 300 }],
    ];
    const rings = rasterUnionRings(two, 5);
    expect(rings.length).toBe(2);
  });

  it("is deterministic", () => {
    const a = derivedRegionRings(BLOB, { of: "n", kind: "outline", offsetPx: 5 });
    const b = derivedRegionRings(BLOB, { of: "n", kind: "outline", offsetPx: 5 });
    expect(a).toEqual(b);
  });

  it("returns nothing for empty geometry", () => {
    for (const kind of ["bbox", "hull", "outline", "occupied"] as const) {
      expect(derivedRegionRings([], { of: "n", kind })).toEqual([]);
    }
  });
});

// ── Polygon primitives ──────────────────────────────────────────────────────

describe("offsetConvexPolygon", () => {
  it("grows a square by exactly d on each side", () => {
    const grown = offsetConvexPolygon(SQUARE, 10);
    expect(area(grown)).toBeCloseTo(120 * 120, 6);
  });

  it("shrinks a square by exactly d on each side", () => {
    const shrunk = offsetConvexPolygon(SQUARE, -10);
    expect(area(shrunk)).toBeCloseTo(80 * 80, 6);
  });

  it("collapses to nothing when over-shrunk", () => {
    expect(offsetConvexPolygon(SQUARE, -60)).toEqual([]);
  });
});

describe("roundPolygonCorners", () => {
  it("leaves the polygon alone for a zero radius", () => {
    expect(roundPolygonCorners(SQUARE, 0)).toEqual(SQUARE);
  });

  it("adds vertices and removes exactly the four corner squares' worth of area", () => {
    const r = 20;
    const round = roundPolygonCorners(SQUARE, r);
    expect(round.length).toBeGreaterThan(SQUARE.length);
    // A rounded rectangle loses (4 - π) r² relative to the sharp one. The arcs
    // are polygonal (8 chords per corner), so allow a 0.5% inscribed-chord gap.
    const exact = 100 * 100 - (4 - Math.PI) * r * r;
    expect(area(round)).toBeLessThanOrEqual(exact);
    expect(area(round) / exact).toBeGreaterThan(0.995);
  });
});

describe("insetAndRoundPolygon — the shared rounded-inset helper", () => {
  it("insets then rounds, and is the same code the bbox/hull rounding uses", () => {
    const ring = insetAndRoundPolygon(SQUARE, 10, 15);
    const b = geometryBounds([ring])!;
    expect(b.xMin).toBeCloseTo(10, 6);
    expect(b.xMax).toBeCloseTo(90, 6);
    expect(b.yMin).toBeCloseTo(10, 6);
    expect(b.yMax).toBeCloseTo(90, 6);
    const exact = 80 * 80 - (4 - Math.PI) * 15 * 15;
    expect(area(ring)).toBeLessThanOrEqual(exact);
    expect(area(ring) / exact).toBeGreaterThan(0.995);
  });

  it("returns nothing when the inset collapses the polygon", () => {
    expect(insetAndRoundPolygon(SQUARE, 60, 5)).toEqual([]);
  });
});

describe("bboxRing", () => {
  it("orders vertices with a positive shoelace area (the module convention)", () => {
    expect(polygonArea(bboxRing({ xMin: 0, yMin: 0, xMax: 10, yMax: 20 }))).toBeGreaterThan(0);
  });
});
