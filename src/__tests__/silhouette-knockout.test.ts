import { describe, it, expect } from "vitest";
import {
  pointInSilhouette,
  clipPolylinesToSilhouette,
  knockout,
  ringsFromSVGPath,
  ringsFromThreshold,
  type Polyline,
} from "../operators/silhouette-knockout";

/** Axis-aligned closed ring. */
function square(x0: number, y0: number, x1: number, y1: number): Polyline {
  return [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
    { x: x0, y: y0 },
  ];
}

function totalLength(lines: Polyline[]): number {
  let sum = 0;
  for (const line of lines) {
    for (let i = 0; i < line.length - 1; i++) {
      sum += Math.hypot(line[i + 1].x - line[i].x, line[i + 1].y - line[i].y);
    }
  }
  return sum;
}

describe("pointInSilhouette", () => {
  const outer = square(0, 0, 10, 10);

  it("classifies points against a single square ring", () => {
    expect(pointInSilhouette({ x: 5, y: 5 }, [outer])).toBe(true);
    expect(pointInSilhouette({ x: 0.5, y: 0.5 }, [outer])).toBe(true);
    expect(pointInSilhouette({ x: -1, y: 5 }, [outer])).toBe(false);
    expect(pointInSilhouette({ x: 11, y: 5 }, [outer])).toBe(false);
    expect(pointInSilhouette({ x: 5, y: 20 }, [outer])).toBe(false);
  });

  it("treats a nested ring as a hole (even-odd)", () => {
    const rings = [outer, square(3, 3, 7, 7)];
    expect(pointInSilhouette({ x: 5, y: 5 }, rings)).toBe(false); // in the hole
    expect(pointInSilhouette({ x: 1, y: 5 }, rings)).toBe(true); // in the annulus
    expect(pointInSilhouette({ x: 9, y: 5 }, rings)).toBe(true);
    expect(pointInSilhouette({ x: -1, y: 5 }, rings)).toBe(false);
  });

  it("returns false when there is no usable ring", () => {
    expect(pointInSilhouette({ x: 5, y: 5 }, [])).toBe(false);
    expect(pointInSilhouette({ x: 5, y: 5 }, [[{ x: 0, y: 0 }, { x: 1, y: 1 }]])).toBe(false);
  });
});

describe("clipPolylinesToSilhouette", () => {
  const ring = square(2, 2, 8, 8);
  const line: Polyline = [
    { x: 0, y: 5 },
    { x: 10, y: 5 },
  ];

  it("splits an outside clip into two pieces at the exact crossings", () => {
    const out = clipPolylinesToSilhouette([line], [ring], "outside");
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual([
      { x: 0, y: 5 },
      { x: 2, y: 5 },
    ]);
    expect(out[1]).toEqual([
      { x: 8, y: 5 },
      { x: 10, y: 5 },
    ]);
  });

  it("keeps exactly the interior span for an inside clip", () => {
    const out = clipPolylinesToSilhouette([line], [ring], "inside");
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual([
      { x: 2, y: 5 },
      { x: 8, y: 5 },
    ]);
  });

  it("handles a segment with four crossings (ring plus hole)", () => {
    const rings = [ring, square(4, 4, 6, 6)];
    const inside = clipPolylinesToSilhouette([line], rings, "inside");
    expect(inside).toHaveLength(2);
    expect(inside[0].map((p) => p.x)).toEqual([2, 4]);
    expect(inside[1].map((p) => p.x)).toEqual([6, 8]);

    const outside = clipPolylinesToSilhouette([line], rings, "outside");
    expect(outside).toHaveLength(3);
    expect(outside.map((l) => [l[0].x, l[1].x])).toEqual([
      [0, 2],
      [4, 6],
      [8, 10],
    ]);
  });

  it("inside and outside partition the original length", () => {
    const rings = [ring, square(4, 4, 6, 6)];
    const lines: Polyline[] = [
      line,
      [
        { x: 1, y: 0 },
        { x: 1, y: 10 },
      ],
      [
        { x: 0, y: 0 },
        { x: 10, y: 10 },
      ],
      [
        { x: 3, y: 9 },
        { x: 3, y: 3 },
        { x: 9, y: 3 },
      ],
    ];
    const total = totalLength(lines);
    const inside = totalLength(clipPolylinesToSilhouette(lines, rings, "inside"));
    const outside = totalLength(clipPolylinesToSilhouette(lines, rings, "outside"));
    expect(inside + outside).toBeCloseTo(total, 6);
    expect(inside).toBeGreaterThan(0);
    expect(outside).toBeGreaterThan(0);
  });

  it("splits a multi-vertex polyline and welds contiguous kept spans", () => {
    const poly: Polyline = [
      { x: 0, y: 5 },
      { x: 5, y: 5 },
      { x: 10, y: 5 },
    ];
    const inside = clipPolylinesToSilhouette([poly], [ring], "inside");
    expect(inside).toHaveLength(1);
    // The interior span crosses the vertex at x=5, so it stays one polyline.
    expect(inside[0][0]).toEqual({ x: 2, y: 5 });
    expect(inside[0][inside[0].length - 1]).toEqual({ x: 8, y: 5 });
    expect(inside[0].length).toBe(3);
  });

  it("passes everything through as 'outside' when no ring is supplied", () => {
    expect(clipPolylinesToSilhouette([line], [], "outside")).toEqual([line]);
    expect(clipPolylinesToSilhouette([line], [], "inside")).toEqual([]);
  });
});

describe("knockout", () => {
  const ring = square(2, 2, 8, 8);

  it("keeps the field outside and the optional texture inside", () => {
    const field: Polyline[] = [
      [
        { x: 0, y: 5 },
        { x: 10, y: 5 },
      ],
    ];
    const insideTexture: Polyline[] = [
      [
        { x: 0, y: 6 },
        { x: 10, y: 6 },
      ],
    ];
    const out = knockout(field, [ring], { insideTexture });
    expect(out).toHaveLength(3);
    // field: two outside pieces at y=5
    expect(out.slice(0, 2).every((l) => l.every((p) => p.y === 5))).toBe(true);
    // texture: one inside piece at y=6
    expect(out[2]).toEqual([
      { x: 2, y: 6 },
      { x: 8, y: 6 },
    ]);
  });

  it("omits the interior entirely when no texture is given", () => {
    const field: Polyline[] = [
      [
        { x: 0, y: 5 },
        { x: 10, y: 5 },
      ],
    ];
    const out = knockout(field, [ring]);
    expect(out).toHaveLength(2);
    // Endpoints sit exactly on the boundary (undefined by the even-odd rule),
    // so probe each piece's midpoint instead.
    for (const l of out) {
      const mid = { x: (l[0].x + l[1].x) / 2, y: (l[0].y + l[1].y) / 2 };
      expect(pointInSilhouette(mid, [ring])).toBe(false);
    }
  });
});

describe("ringsFromSVGPath", () => {
  it("parses an absolute square path into one closed ring", () => {
    const rings = ringsFromSVGPath("M 0 0 L 10 0 L 10 10 L 0 10 Z");
    expect(rings).toHaveLength(1);
    expect(rings[0]).toHaveLength(5);
    expect(rings[0][0]).toEqual({ x: 0, y: 0 });
    expect(rings[0][4]).toEqual({ x: 0, y: 0 });
    expect(pointInSilhouette({ x: 5, y: 5 }, rings)).toBe(true);
    expect(pointInSilhouette({ x: 15, y: 5 }, rings)).toBe(false);
  });

  it("parses relative commands and H/V shorthands to the same square", () => {
    const abs = ringsFromSVGPath("M 0 0 L 10 0 L 10 10 L 0 10 Z");
    const rel = ringsFromSVGPath("m 0 0 l 10 0 l 0 10 l -10 0 z");
    const hv = ringsFromSVGPath("M 0 0 H 10 V 10 H 0 Z");
    expect(rel).toEqual(abs);
    expect(hv).toEqual(abs);
  });

  it("samples curves into many more points than a polygon", () => {
    const poly = ringsFromSVGPath("M 0 0 L 10 0 L 10 10 L 0 10 Z");
    const curved = ringsFromSVGPath("M 0 0 C 20 0 20 10 0 10 Z", 16);
    expect(curved).toHaveLength(1);
    expect(curved[0].length).toBeGreaterThan(poly[0].length);
    expect(curved[0].length).toBeGreaterThan(16);
    // Curve bulges to the right of the chord.
    expect(Math.max(...curved[0].map((p) => p.x))).toBeGreaterThan(10);

    const denser = ringsFromSVGPath("M 0 0 C 20 0 20 10 0 10 Z", 40);
    expect(denser[0].length).toBeGreaterThan(curved[0].length);
  });

  it("parses quadratics and emits multiple subpaths as separate rings", () => {
    const rings = ringsFromSVGPath(
      "M 0 0 Q 10 0 10 10 Q 10 20 0 20 Z M 30 0 L 40 0 L 40 10 Z",
      8,
    );
    expect(rings).toHaveLength(2);
    expect(rings[0].length).toBeGreaterThan(4);
    expect(rings[1]).toHaveLength(4);
  });

  it("closes an unterminated subpath", () => {
    const rings = ringsFromSVGPath("M 0 0 L 10 0 L 10 10");
    expect(rings).toHaveLength(1);
    expect(rings[0][0]).toEqual(rings[0][rings[0].length - 1]);
  });
});

describe("ringsFromThreshold", () => {
  function image(w: number, h: number, fn: (x: number, y: number) => number) {
    const brightness = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) brightness[y * w + x] = fn(x, y);
    }
    return { brightness, width: w, height: h };
  }

  it("contours the dark half of a split image", () => {
    const img = image(32, 32, (x) => (x < 16 ? 0 : 1));
    const rings = ringsFromThreshold(img, 0.5, 100, 100);
    expect(rings.length).toBeGreaterThanOrEqual(1);
    for (const ring of rings) {
      expect(ring.length).toBeGreaterThanOrEqual(4);
      expect(ring[0]).toEqual(ring[ring.length - 1]);
    }
    // Dark side is inside, bright side is not.
    expect(pointInSilhouette({ x: 25, y: 50 }, rings)).toBe(true);
    expect(pointInSilhouette({ x: 75, y: 50 }, rings)).toBe(false);
    // All points land in the target box.
    for (const ring of rings) {
      for (const p of ring) {
        expect(p.x).toBeGreaterThanOrEqual(0);
        expect(p.x).toBeLessThanOrEqual(100);
        expect(p.y).toBeGreaterThanOrEqual(0);
        expect(p.y).toBeLessThanOrEqual(100);
      }
    }
  });

  it("contours a dark disc away from the image border", () => {
    const img = image(48, 48, (x, y) => (Math.hypot(x - 24, y - 24) < 12 ? 0 : 1));
    const rings = ringsFromThreshold(img, 0.5, 100, 100);
    expect(rings.length).toBe(1);
    expect(pointInSilhouette({ x: 50, y: 50 }, rings)).toBe(true);
    expect(pointInSilhouette({ x: 5, y: 5 }, rings)).toBe(false);
  });

  it("returns nothing when the image has no dark pixels", () => {
    const img = image(16, 16, () => 1);
    expect(ringsFromThreshold(img, 0.5, 100, 100)).toEqual([]);
  });

  it("threshold selects how much of a gradient counts as dark", () => {
    const img = image(64, 8, (x) => x / 63);
    const low = ringsFromThreshold(img, 0.25, 100, 100);
    const high = ringsFromThreshold(img, 0.75, 100, 100);
    const rightEdge = (rings: Polyline[]) => Math.max(...rings.flat().map((p) => p.x));
    expect(rightEdge(high)).toBeGreaterThan(rightEdge(low));
  });
});
