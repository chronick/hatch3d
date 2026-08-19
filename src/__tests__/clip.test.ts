import { describe, it, expect } from "vitest";
import {
  clipSegment,
  clipPolylineToRect,
  parseDString,
  pointsToDString,
  clipSVGPath,
  convexHull,
  clipPolylineToConvexPolygon,
} from "../utils/clip";

const rect = { xMin: 0, yMin: 0, xMax: 100, yMax: 100 };

describe("clipSegment", () => {
  it("keeps segment fully inside", () => {
    expect(clipSegment(10, 10, 90, 90, rect)).toEqual([10, 10, 90, 90]);
  });

  it("rejects segment fully outside", () => {
    expect(clipSegment(-50, -50, -10, -10, rect)).toBeNull();
  });

  it("clips segment crossing one edge", () => {
    const result = clipSegment(50, 50, 150, 50, rect);
    expect(result).toEqual([50, 50, 100, 50]);
  });

  it("clips segment crossing two edges", () => {
    const result = clipSegment(-50, 50, 150, 50, rect);
    expect(result).toEqual([0, 50, 100, 50]);
  });
});

describe("clipPolylineToRect", () => {
  it("clips a polyline that exits and re-enters", () => {
    const points = [
      { x: 10, y: 50 },
      { x: 50, y: 50 },   // inside
      { x: 150, y: 50 },  // exits right
      { x: 150, y: 80 },  // outside
      { x: 50, y: 80 },   // re-enters
      { x: 10, y: 80 },   // inside
    ];
    const result = clipPolylineToRect(points, rect);
    expect(result.length).toBe(2);
    // First polyline: enters and exits at x=100
    expect(result[0][0]).toEqual({ x: 10, y: 50 });
    expect(result[0][result[0].length - 1].x).toBeCloseTo(100);
    // Second polyline: re-enters at x=100
    expect(result[1][0].x).toBeCloseTo(100);
    expect(result[1][result[1].length - 1]).toEqual({ x: 10, y: 80 });
  });

  it("returns empty for single-point input", () => {
    expect(clipPolylineToRect([{ x: 50, y: 50 }], rect)).toEqual([]);
  });

  it("returns empty for polyline fully outside", () => {
    const points = [
      { x: -50, y: -50 },
      { x: -10, y: -10 },
    ];
    expect(clipPolylineToRect(points, rect)).toEqual([]);
  });
});

describe("parseDString / pointsToDString", () => {
  it("round-trips a d-string", () => {
    const d = "M10.00,20.00L30.00,40.00L50.00,60.00";
    const points = parseDString(d);
    expect(points).toEqual([
      { x: 10, y: 20 },
      { x: 30, y: 40 },
      { x: 50, y: 60 },
    ]);
    expect(pointsToDString(points)).toBe(d);
  });
});

describe("clipSVGPath", () => {
  it("clips and transforms a path", () => {
    // Path in content space: 0,0 to 200,0 (extends beyond)
    // Transform: scale=1, translate cx=10, cy=10
    // Clip rect: 10,10 to 110,110
    const d = "M0.00,0.00L200.00,0.00";
    const result = clipSVGPath(
      d,
      { cx: 10, cy: 10, scale: 1 },
      { xMin: 10, yMin: 10, xMax: 110, yMax: 110 },
    );
    expect(result.length).toBe(1);
    const points = parseDString(result[0]);
    expect(points[0].x).toBeCloseTo(10);
    expect(points[0].y).toBeCloseTo(10);
    expect(points[1].x).toBeCloseTo(110);
    expect(points[1].y).toBeCloseTo(10);
  });

  it("returns empty for path fully outside clip rect", () => {
    const d = "M0.00,0.00L5.00,0.00";
    const result = clipSVGPath(
      d,
      { cx: 0, cy: 0, scale: 1 },
      { xMin: 10, yMin: 10, xMax: 100, yMax: 100 },
    );
    expect(result).toEqual([]);
  });
});

describe("convexHull", () => {
  it("returns triangle vertices in CCW order", () => {
    const hull = convexHull([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 5, y: 10 },
    ]);
    expect(hull).toHaveLength(3);
    // CCW signed area > 0
    const area =
      (hull[1].x - hull[0].x) * (hull[2].y - hull[0].y) -
      (hull[1].y - hull[0].y) * (hull[2].x - hull[0].x);
    expect(area).toBeGreaterThan(0);
  });

  it("ignores interior points and returns the four square corners", () => {
    const hull = convexHull([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
      { x: 5, y: 5 }, // interior
    ]);
    expect(hull).toHaveLength(4);
    const xs = hull.map((p) => p.x).sort((a, b) => a - b);
    const ys = hull.map((p) => p.y).sort((a, b) => a - b);
    expect(xs).toEqual([0, 0, 10, 10]);
    expect(ys).toEqual([0, 0, 10, 10]);
  });

  it("returns [] for 5 collinear points", () => {
    expect(
      convexHull([
        { x: 0, y: 0 },
        { x: 1, y: 1 },
        { x: 2, y: 2 },
        { x: 3, y: 3 },
        { x: 4, y: 4 },
      ]),
    ).toEqual([]);
  });

  it("returns [] for a single point", () => {
    expect(convexHull([{ x: 5, y: 5 }])).toEqual([]);
  });

  it("returns [] for two points", () => {
    expect(
      convexHull([
        { x: 0, y: 0 },
        { x: 5, y: 5 },
      ]),
    ).toEqual([]);
  });
});

describe("clipPolylineToConvexPolygon", () => {
  // Triangle with vertices (0,0), (40,0), (0,40) in CCW order.
  // Interior: x >= 0, y >= 0, x + y <= 40.
  const triangle = [
    { x: 0, y: 0 },
    { x: 40, y: 0 },
    { x: 0, y: 40 },
  ];

  it("returns the input unchanged when entirely inside", () => {
    const points = [
      { x: 5, y: 5 },
      { x: 10, y: 5 },
      { x: 10, y: 20 },
    ];
    const result = clipPolylineToConvexPolygon(points, triangle);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(points);
  });

  it("returns [] when entirely outside", () => {
    const points = [
      { x: 100, y: 100 },
      { x: 200, y: 100 },
    ];
    expect(clipPolylineToConvexPolygon(points, triangle)).toEqual([]);
  });

  it("returns one truncated polyline when crossing a single edge", () => {
    // Horizontal stripe at y=10 entering from x=-10 to x=50 in the triangle.
    // Triangle hypotenuse x+y=40 crosses y=10 at x=30.
    const points = [
      { x: -10, y: 10 },
      { x: 50, y: 10 },
    ];
    const result = clipPolylineToConvexPolygon(points, triangle);
    expect(result).toHaveLength(1);
    expect(result[0][0].x).toBeCloseTo(0);
    expect(result[0][0].y).toBeCloseTo(10);
    expect(result[0][result[0].length - 1].x).toBeCloseTo(30);
    expect(result[0][result[0].length - 1].y).toBeCloseTo(10);
  });

  it("returns two polylines when the input exits and re-enters", () => {
    // U-shape that dips out of the triangle through x+y>40 between two
    // inside endpoints.
    const points = [
      { x: 5, y: 5 }, // inside
      { x: 5, y: 50 }, // outside (x+y=55)
      { x: 10, y: 50 }, // outside
      { x: 10, y: 10 }, // inside (x+y=20)
    ];
    const result = clipPolylineToConvexPolygon(points, triangle);
    expect(result).toHaveLength(2);
    // First polyline: (5,5) → exit at (5,35) on x+y=40
    expect(result[0][0]).toEqual({ x: 5, y: 5 });
    const last0 = result[0][result[0].length - 1];
    expect(last0.x).toBeCloseTo(5);
    expect(last0.y).toBeCloseTo(35);
    // Second polyline: enter at (10,30) → (10,10)
    expect(result[1][0].x).toBeCloseTo(10);
    expect(result[1][0].y).toBeCloseTo(30);
    expect(result[1][result[1].length - 1]).toEqual({ x: 10, y: 10 });
  });

  it("returns [] when polygon has fewer than 3 vertices", () => {
    expect(
      clipPolylineToConvexPolygon(
        [
          { x: 0, y: 0 },
          { x: 1, y: 1 },
        ],
        [
          { x: 0, y: 0 },
          { x: 1, y: 1 },
        ],
      ),
    ).toEqual([]);
  });

  it("returns [] when input has fewer than 2 points", () => {
    expect(clipPolylineToConvexPolygon([{ x: 5, y: 5 }], triangle)).toEqual([]);
  });
});
