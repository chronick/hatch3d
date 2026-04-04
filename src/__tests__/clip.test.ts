import { describe, it, expect } from "vitest";
import {
  clipSegment,
  clipPolylineToRect,
  parseDString,
  pointsToDString,
  clipSVGPath,
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
