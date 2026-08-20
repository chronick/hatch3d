import { describe, it, expect } from "vitest";
import {
  pointInSilhouette,
  clipPolylinesToSilhouette,
  knockout,
  ringsFromSVGPath,
  ringsFromThreshold,
  type Point,
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

  // ── Saddle cases (marching-squares 5 / 10) ──────────────────────────────
  //
  // A cell with two diagonally opposite dark corners has two valid readings.
  // The tracer picks between them with the asymptotic decider — the sign of the
  // bilinear interpolant at its own saddle point, `(a·d - b·c)/(a - b - c + d)`
  // over threshold-shifted corners. These 2×2 images *are* one saddle cell (plus
  // the bright padding ring), so each case is decided in isolation: a dark saddle
  // must join the diagonal into one ring, a bright one must leave two.
  //
  // The first four cases are symmetric, where the saddle sits at the centre and
  // the old corner-mean reading agrees; the two after them are not, and are
  // where the two deciders part company.
  describe("saddle cells are disambiguated by the asymptotic decider", () => {
    /** 2×2 image laid out [TL, TR, BL, BR]. */
    const saddle = (tl: number, tr: number, bl: number, br: number) =>
      image(2, 2, (x, y) => (y === 0 ? (x === 0 ? tl : tr) : x === 0 ? bl : br));

    it("joins the dark diagonal when the saddle is dark (case 10: TL/BR)", () => {
      // Symmetric, so the saddle is the centre: 0.45 < 0.5 → TL and BR are one
      // region. (Formally: num = 0.09, den = -1.8, so f_saddle = -0.05.)
      const rings = ringsFromThreshold(saddle(0, 0.9, 0.9, 0), 0.5, 100, 100);
      expect(rings).toHaveLength(1);
    });

    it("joins the dark diagonal when the saddle is dark (case 5: TR/BL)", () => {
      const rings = ringsFromThreshold(saddle(0.9, 0, 0, 0.9), 0.5, 100, 100);
      expect(rings).toHaveLength(1);
    });

    it("separates the dark diagonal when the saddle is bright (case 10)", () => {
      // Same corner classification, saddle = 0.7 > 0.5 → two disjoint specks.
      const rings = ringsFromThreshold(saddle(0.4, 1, 1, 0.4), 0.5, 100, 100);
      expect(rings).toHaveLength(2);
    });

    it("separates the dark diagonal when the saddle is bright (case 5)", () => {
      const rings = ringsFromThreshold(saddle(1, 0.4, 0.4, 1), 0.5, 100, 100);
      expect(rings).toHaveLength(2);
    });

    // ── Refutations of the corner-mean decider ────────────────────────────
    //
    // The mean of the four corners is the bilinear value at the cell *centre*,
    // which is not where the surface saddles unless the cell is symmetric. On
    // a lopsided cell the saddle point drifts off-centre and the two deciders
    // disagree — both of these were found by the reviewer, and the mean gets
    // both backwards.

    it("separates a lopsided saddle the corner mean wrongly joins", () => {
      // mean = 0.4725 < 0.5, so the mean decider calls the centre dark and
      // joins TL to BR. The saddle value is +0.035/0.91 > 0: bright. Separate.
      const rings = ringsFromThreshold(saddle(0, 0.7, 0.7, 0.49), 0.5, 100, 100);
      expect(rings).toHaveLength(2);
    });

    it("joins a lopsided saddle the corner mean wrongly separates", () => {
      // mean = 0.5025 > 0.5, so the mean decider calls the centre bright and
      // splits TL from BR. The saddle value is 0.0322/-0.81 < 0: dark. Join.
      const rings = ringsFromThreshold(saddle(0.3, 0.89, 0.52, 0.3), 0.5, 100, 100);
      expect(rings).toHaveLength(1);
    });

    it("keeps every ring closed in both readings", () => {
      for (const img of [saddle(0, 0.9, 0.9, 0), saddle(0.4, 1, 1, 0.4)]) {
        for (const ring of ringsFromThreshold(img, 0.5, 100, 100)) {
          expect(ring.length).toBeGreaterThanOrEqual(4);
          expect(ring[0]).toEqual(ring[ring.length - 1]);
        }
      }
    });

    it("traces a diagonal dark band as one connected ring", () => {
      // A 1-px-wide diagonal stripe is nothing but saddle cells: each has one
      // dark corner on the stripe and its diagonal partner on the next row's.
      // Before the decider it came apart into a chain of disjoint diamonds.
      // Threshold 0.6 puts the saddle (-0.1) on the dark side; at exactly 0.5
      // every such cell is a perfect checkerboard, `a·d - b·c` is exactly zero,
      // and the documented tie default separates it — the right reading.
      const img = image(24, 24, (x, y) => (x === y ? 0 : 1));
      expect(ringsFromThreshold(img, 0.6, 100, 100)).toHaveLength(1);
      expect(ringsFromThreshold(img, 0.5, 100, 100).length).toBeGreaterThan(1);
    });
  });

  // ── Threshold-exact samples (the old "multi-strand junction") ─────────────
  //
  // A sample sitting *exactly* on the threshold used to collapse every crossing
  // on its incident edges onto the lattice point itself, so up to four strands
  // met at one point and the tracer had to *guess* which incoming strand paired
  // with which outgoing one. Guess wrong and two lobes weld into a single ring
  // that passes through the junction twice — a figure-eight, not a contour —
  // and even-odd fill, offsetting and pen-path ordering all assume simple rings.
  //
  // No local rule can decide it (see the module comment on `CROSSING_EPS`): the
  // two pinches below are the same configuration locally and want opposite
  // pairings. The tracer therefore refuses to create the junction at all —
  // a crossing never lands on a lattice point — and these fixtures pin that.
  describe("threshold-exact samples never create a junction", () => {
    /** Signed (shoelace) area; sign encodes winding, magnitude the enclosure. */
    const signedArea = (ring: Polyline): number => {
      let s = 0;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        s += ring[j].x * ring[i].y - ring[i].x * ring[j].y;
      }
      return s / 2;
    };

    /**
     * True when the closed ring never touches itself: no point is visited twice
     * except the closing repeat of the first, and consecutive repeats (which are
     * degenerate zero-length steps, not self-touches).
     */
    const isSimpleRing = (ring: Polyline): boolean => {
      const pts = ring.slice();
      const last = pts[pts.length - 1];
      if (pts.length > 1 && last.x === pts[0].x && last.y === pts[0].y) pts.pop();
      const seen = new Set<string>();
      let prev: Point | undefined;
      for (const p of pts) {
        if (prev && prev.x === p.x && prev.y === p.y) continue; // degenerate step
        const k = `${p.x},${p.y}`;
        if (seen.has(k)) return false;
        seen.add(k);
        prev = p;
      }
      return true;
    };

    /** Distinct vertices of a ring, ignoring the closing repeat. */
    const distinctVertices = (ring: Polyline): number => {
      const seen = new Set<string>();
      for (const p of ring) seen.add(`${p.x},${p.y}`);
      return seen.size;
    };

    /**
     * Three fields, each with at least one sample sitting exactly on the
     * threshold, and the total signed area of the walk they contour.
     *
     * Signed area is the invariant worth pinning: splitting a closed walk at a
     * repeated vertex — or welding two walks that share one — conserves it
     * exactly, so however the tracer resolves a pinch the *total* cannot move.
     * That makes it a check on the resolution rather than on the choice.
     *
     *  - **asymmetric pinch** — column 1 is exactly on the threshold, so the
     *    lattice point (1,0) joins a lone dark corner at (0,0) to the L-shaped
     *    dark blob down the right and along the bottom. Two lobes of *dark*
     *    meeting at a point: it wants the walks to hug the dark side.
     *  - **symmetric pinch** — a bright notch cut down from the top, closing to
     *    exactly zero width at (1,0). Locally identical to the case above (dark
     *    left and right, bright above and below) but it wants the opposite
     *    pairing: hugging the dark side here welds the outer boundary to the
     *    pocket around (1,1) into a figure-eight through (1.5,0.5). That pair
     *    is why no local turn rule can be right — hence the structural fix.
     *  - **plus** — four dark arms meeting at a threshold-exact centre: all four
     *    crossings on the incident edges collapse onto it, and every one of the
     *    four cells around it emits a zero-length strand. It used to come back
     *    as a "ring" of five identical points enclosing nothing.
     */
    const FIXTURES = [
      ["asymmetric pinch", [[0, 0.5, 0], [1, 0.5, 0], [0, 0, 0]], 6.25],
      ["symmetric pinch", [[0, 0.5, 0], [0, 1, 0], [0, 0, 0]], 7.25],
      ["plus", [[1, 0, 1], [0, 0.5, 0], [1, 0, 1]], 4.5],
    ] as const;

    const contour = (grid: readonly (readonly number[])[]) =>
      ringsFromThreshold(image(3, 3, (x, y) => grid[y][x]), 0.5, 3, 3);

    it.each(FIXTURES)("%s: every ring is simple", (_name, grid) => {
      for (const ring of contour(grid)) {
        expect(isSimpleRing(ring), `ring: ${ring.map((p) => `${p.x},${p.y}`).join(" ")}`).toBe(true);
      }
    });

    it.each(FIXTURES)("%s: every ring is a real ring, not a degenerate speck", (_name, grid) => {
      for (const ring of contour(grid)) {
        expect(distinctVertices(ring), "distinct vertices").toBeGreaterThanOrEqual(3);
        // Extent rather than area: the ring the *plus* fixture returns for its
        // threshold-exact centre is a real diamond, but one CROSSING_EPS across,
        // so its shoelace area underflows to zero against coordinates of order
        // one. A zero-extent "ring" — five copies of one point, which is what
        // the four collapsed strands used to produce — is the thing to reject.
        const xs = ring.map((p) => p.x);
        const ys = ring.map((p) => p.y);
        const extent = Math.max(...xs) - Math.min(...xs) + (Math.max(...ys) - Math.min(...ys));
        expect(extent, "bounding-box extent").toBeGreaterThan(0);
      }
    });

    it.each(FIXTURES)("%s: conserves the walk's total signed area", (_name, grid, total) => {
      const sum = contour(grid).reduce((s, r) => s + signedArea(r), 0);
      // The nudge that keeps crossings off the lattice moves them by
      // CROSSING_EPS of a cell, so the total shifts in the ninth decimal.
      expect(sum).toBeCloseTo(total, 6);
    });

    it("splits the asymmetric pinch into the speck and the blob", () => {
      const rings = contour(FIXTURES[0][1]);
      expect(rings).toHaveLength(2);
      const areas = rings.map((r) => Math.abs(signedArea(r))).sort((a, b) => a - b);
      expect(areas[0]).toBeCloseTo(0.75, 6); // the diamond around the lone corner
      expect(areas[1]).toBeCloseTo(5.5, 6); // the L-shaped blob
    });

    it("reads the symmetric pinch as one ring around an open notch", () => {
      // The classifier is `dark = brightness < threshold`, so the sample sitting
      // exactly on the threshold is *bright*: the notch stays open (by a hair)
      // and the pocket around (1,1) is reached through it rather than being
      // sealed off. One ring, and the fill is the same either way — see the
      // classification checks below.
      const rings = contour(FIXTURES[1][1]);
      expect(rings).toHaveLength(1);
      expect(Math.abs(signedArea(rings[0]))).toBeCloseTo(7.25, 6);
    });

    it("keeps the same points inside the silhouette", () => {
      // Sample centres map to (x+0.5, y+0.5) in a 3x3 target box. Only samples
      // strictly off the threshold are asserted — a sample sitting exactly on it
      // is a boundary point, where `pointInSilhouette` is documented undefined.
      const cases: [string, readonly (readonly number[])[], [number, number][], [number, number][]][] =
        [
          ["asymmetric pinch", FIXTURES[0][1], [[0, 0], [2, 0], [2, 1], [0, 2], [1, 2], [2, 2]], [[0, 1]]],
          [
            "symmetric pinch",
            FIXTURES[1][1],
            [[0, 0], [2, 0], [0, 1], [2, 1], [0, 2], [1, 2], [2, 2]],
            [[1, 1]],
          ],
          ["plus", FIXTURES[2][1], [[1, 0], [0, 1], [2, 1], [1, 2]], [[0, 0], [2, 0], [0, 2], [2, 2]]],
        ];
      for (const [name, grid, dark, bright] of cases) {
        const rings = contour(grid);
        for (const [x, y] of dark) {
          expect(pointInSilhouette({ x: x + 0.5, y: y + 0.5 }, rings), `${name} dark ${x},${y}`).toBe(
            true,
          );
        }
        for (const [x, y] of bright) {
          expect(
            pointInSilhouette({ x: x + 0.5, y: y + 0.5 }, rings),
            `${name} bright ${x},${y}`,
          ).toBe(false);
        }
      }
    });
  });
});
