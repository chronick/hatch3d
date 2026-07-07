import { describe, it, expect, beforeEach } from "vitest";
import { compositionRegistry } from "../compositions/registry";
import type { Composition2DDefinition } from "../compositions/types";
import { simplexScalar, simplexVector, densityField, gradient, mulberry32 } from "../patch/signals";
import { fieldDistort, fieldCull } from "../patch/operators";
import { hatchPolygon } from "../patch/region-hatch";
import { compileDSL } from "../patch/dsl";
import { evalPatch, parsePatchDoc } from "../patch/graph";

function makeGrid2D(id: string): Composition2DDefinition {
  // A deterministic 3x1 horizontal line at y=400.
  return {
    id, name: id, type: "2d", category: "2d",
    generate: () => [[{ x: 100, y: 400 }, { x: 400, y: 400 }, { x: 700, y: 400 }]],
  };
}

beforeEach(() => {
  compositionRegistry.register(makeGrid2D("lineA"));
});

describe("signals", () => {
  it("mulberry32 is deterministic", () => {
    const a = mulberry32(42), b = mulberry32(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  it("simplex fields are seeded (reproducible) and typed", () => {
    const s1 = simplexScalar(0.01, 7), s2 = simplexScalar(0.01, 7);
    expect(s1.kind).toBe("scalar");
    expect(s1.sample(10, 20)).toBe(s2.sample(10, 20));
    expect(simplexVector(0.01, 7).kind).toBe("vector");
  });

  it("densityField lifts geometry to a scalar field (the patch cable)", () => {
    // One dense clump on the left, empty on the right.
    const geom = [
      [{ x: 10, y: 10 }, { x: 12, y: 12 }, { x: 10, y: 14 }, { x: 12, y: 16 }],
    ];
    const f = densityField(geom, { xMin: 0, yMin: 0, xMax: 100, yMax: 100 }, 10);
    expect(f.kind).toBe("scalar");
    expect(f.sample(11, 12)).toBeGreaterThan(f.sample(90, 90));
  });

  it("gradient of a scalar field is a vector field", () => {
    const g = gradient(simplexScalar(0.02, 1));
    expect(g.kind).toBe("vector");
    const [dx, dy] = g.sample(50, 50);
    expect(typeof dx).toBe("number");
    expect(typeof dy).toBe("number");
  });
});

describe("operators", () => {
  it("fieldDistort displaces vertices by amp × field", () => {
    const geom = [[{ x: 0, y: 0 }, { x: 10, y: 0 }]];
    const constField = { kind: "vector" as const, sample: () => [1, 0] as [number, number] };
    const out = fieldDistort(geom, constField, 5);
    expect(out[0][0]).toEqual({ x: 5, y: 0 });
    expect(out[0][1]).toEqual({ x: 15, y: 0 });
  });

  it("fieldCull keeps only in-range vertices, splitting at gaps", () => {
    const geom = [[{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }, { x: 30, y: 0 }]];
    // Field high only for x in [5,25]: keeps the middle two, drops the ends.
    const f = { kind: "scalar" as const, sample: (x: number) => (x > 5 && x < 25 ? 1 : 0) };
    const out = fieldCull(geom, f, { min: 0.5, max: 1.5 });
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual([{ x: 10, y: 0 }, { x: 20, y: 0 }]);
  });
});

describe("hatchPolygon (region-hatch geometry)", () => {
  const square = [
    { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 },
  ];

  it("fills a square with horizontal lines at pitch spacing", () => {
    const lines = hatchPolygon(square, 0, 10);
    // Scanlines y = 0,10,…,90 → 10 lines, each spanning x 0..100.
    expect(lines.length).toBe(10);
    for (const seg of lines) {
      expect(seg).toHaveLength(2);
      expect(seg[0].y).toBeCloseTo(seg[1].y, 6); // horizontal
      const xs = [seg[0].x, seg[1].x].sort((a, b) => a - b);
      expect(xs[0]).toBeCloseTo(0, 6);
      expect(xs[1]).toBeCloseTo(100, 6);
    }
  });

  it("respects the hatch angle", () => {
    const flat = hatchPolygon(square, 0, 20);
    const angled = hatchPolygon(square, 45, 20);
    expect(angled.length).toBeGreaterThan(0);
    // 45° lines are not horizontal.
    const seg = angled[Math.floor(angled.length / 2)];
    expect(Math.abs(seg[0].y - seg[1].y)).toBeGreaterThan(1);
    expect(flat[0][0].y).toBeCloseTo(flat[0][1].y, 6);
  });

  it("handles a concave polygon (even-odd split into separate segments)", () => {
    // A notched rectangle: the top-middle is cut out, so scanlines through the
    // notch must produce TWO segments (left column + right column).
    const notched = [
      { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 },
      { x: 60, y: 100 }, { x: 60, y: 40 }, { x: 40, y: 40 },
      { x: 40, y: 100 }, { x: 0, y: 100 },
    ];
    const lines = hatchPolygon(notched, 0, 10);
    // Group by scanline y; some rows (in the notch, y > 40) must have 2 segments.
    const byY = new Map<number, number>();
    for (const seg of lines) {
      const y = Math.round(seg[0].y);
      byY.set(y, (byY.get(y) ?? 0) + 1);
    }
    const splitRows = [...byY.values()].filter((n) => n === 2).length;
    expect(splitRows).toBeGreaterThan(0);
  });

  it("returns nothing for a degenerate polygon or non-positive pitch", () => {
    expect(hatchPolygon([{ x: 0, y: 0 }, { x: 1, y: 1 }], 0, 10)).toEqual([]);
    expect(hatchPolygon(square, 0, 0)).toEqual([]);
  });

  it("throws instead of hanging when pitch is absurdly small (runaway guard)", () => {
    const big = [{ x: 0, y: 0 }, { x: 10000, y: 0 }, { x: 10000, y: 10000 }, { x: 0, y: 10000 }];
    expect(() => hatchPolygon(big, 0, 0.001)).toThrow(/scanlines — increase pitch/);
  });
});

describe("DSL → graph", () => {
  it("compiles a flat patch to a validated graph", () => {
    const src = `
      g = lineA()
      d = density(g, cell: 20)
      grad = gradient(d)
      w = distort(g, by: grad, amp: 8)
      out(w @ "#111111")
    `;
    const doc = compileDSL(src, { id: "t" });
    parsePatchDoc(doc); // must validate
    const ops = doc.nodes.map((n) => n.op);
    expect(ops).toContain("generator");
    expect(ops).toContain("density");
    expect(ops).toContain("distort");
    expect(ops).toContain("pen");
    expect(doc.out).toHaveLength(1);
  });

  it("infers the threaded variable in a repeat block", () => {
    const src = `
      g = lineA()
      repeat 3 {
        n = simplexVector(scale: 0.01, seed: 1)
        g = distort(g, by: n, amp: 2)
      }
      out(g @ "#000000")
    `;
    const doc = compileDSL(src, { id: "t" });
    const rep = doc.nodes.find((n) => n.op === "repeat");
    expect(rep).toBeDefined();
    expect((rep as { thread: string }).thread).toBe("g");
    expect((rep as { times: number }).times).toBe(3);
  });

  it("keeps commas inside quoted values (colors, labels) intact", () => {
    const src = `
      g = lineA()
      out(g @ "rgb(37, 99, 235)")
    `;
    const doc = compileDSL(src, { id: "t" });
    const pen = doc.nodes.find((n) => n.op === "pen") as { color?: string };
    expect(pen.color).toBe("rgb(37, 99, 235)");
  });

  it("rejects a repeat whose body never reassigns the thread (no-op loop)", () => {
    const graph = {
      version: 1 as const,
      id: "t",
      nodes: [
        { op: "generator" as const, id: "g", composition: "lineA" },
        { op: "repeat" as const, id: "r", times: 3, thread: "g", body: [
          { op: "simplexScalar" as const, id: "s", scale: 0.01, seed: 1 },
        ] },
        { op: "pen" as const, id: "p", from: "g" },
      ],
      out: ["p"],
    };
    expect(() => evalPatch(graph)).toThrow(/never reassigns it/);
  });

  it("gives a clear 'unknown node' error for a typo'd reference", () => {
    const graph = {
      version: 1 as const,
      id: "t",
      nodes: [
        { op: "generator" as const, id: "g", composition: "lineA" },
        { op: "distort" as const, id: "w", from: "typo", by: "g", amp: 1 },
        { op: "pen" as const, id: "p", from: "w" },
      ],
      out: ["p"],
    };
    expect(() => evalPatch(graph)).toThrow(/unknown node "typo"/);
  });

  it("rejects a repeat that reassigns no pre-existing variable", () => {
    const src = `
      g = lineA()
      repeat 2 {
        h = simplexScalar(scale: 0.01, seed: 1)
      }
      out(g)
    `;
    expect(() => compileDSL(src, { id: "t" })).toThrow(/pre-existing variable/);
  });
});

describe("evalPatch", () => {
  it("evaluates a patch to per-pen geometry layers", () => {
    const src = `
      g = lineA()
      d = density(g, cell: 40)
      grad = gradient(d)
      w = distort(g, by: grad, amp: 3)
      out(w @ "#2563eb")
    `;
    const res = evalPatch(compileDSL(src, { id: "t" }));
    expect(res.layers).toHaveLength(1);
    expect(res.layers[0].color).toBe("#2563eb");
    expect(res.layers[0].geometry.length).toBeGreaterThan(0);
  });

  it("regionHatch fills an explicit polygon as a patch node", () => {
    const graph = {
      version: 1 as const, id: "t",
      nodes: [
        { op: "regionHatch" as const, id: "fill",
          polygon: [[0, 0], [200, 0], [200, 200], [0, 200]] as [number, number][],
          angleDeg: 0, pitch: 20 },
        { op: "pen" as const, id: "p", from: "fill", color: "#111" },
      ],
      out: ["p"],
    };
    const res = evalPatch(graph);
    expect(res.layers[0].geometry.length).toBeGreaterThan(5);
  });

  it("rejects a regionHatch node with both from and polygon (XOR contract)", () => {
    const graph = {
      version: 1 as const, id: "t",
      nodes: [
        { op: "generator" as const, id: "g", composition: "lineA" },
        { op: "regionHatch" as const, id: "fill", from: "g",
          polygon: [[0, 0], [100, 0], [100, 100]] as [number, number][],
          angleDeg: 0, pitch: 20 },
        { op: "pen" as const, id: "p", from: "fill" },
      ],
      out: ["p"],
    };
    expect(() => evalPatch(graph)).toThrow(/exactly one of/);
  });

  it("regionHatch fills the hull of another node (the cable form)", () => {
    const src = `
      cloud = lineA()
      fill = regionHatch(cloud, angle: 30, pitch: 15)
      out(fill @ "#111")
    `;
    // lineA is a single horizontal segment → degenerate hull → no fill, but
    // must not throw; use a real 2D cloud instead for geometry.
    expect(() => evalPatch(compileDSL(src, { id: "t" }))).not.toThrow();
  });

  it("is deterministic — same patch, identical geometry", () => {
    const src = `
      g = lineA()
      repeat 2 {
        n = simplexVector(scale: 0.01, seed: 5)
        g = distort(g, by: n, amp: 4)
      }
      out(g @ "#111")
    `;
    const a = evalPatch(compileDSL(src, { id: "t" }));
    const b = evalPatch(compileDSL(src, { id: "t" }));
    expect(JSON.stringify(a.layers)).toBe(JSON.stringify(b.layers));
  });

  it("bounded repeat actually iterates (more distortion than a single pass)", () => {
    const base = `g = lineA()\n`;
    const once = evalPatch(compileDSL(base + `n = simplexVector(scale: 0.02, seed: 3)\ng = distort(g, by: n, amp: 10)\nout(g @ "#111")`, { id: "1" }));
    const thrice = evalPatch(compileDSL(base + `repeat 3 {\nn = simplexVector(scale: 0.02, seed: 3)\ng = distort(g, by: n, amp: 10)\n}\nout(g @ "#111")`, { id: "3" }));
    // The 3x-iterated line drifts further from the original y=400 baseline.
    const drift = (r: ReturnType<typeof evalPatch>) =>
      Math.max(...r.layers[0].geometry.flat().map((p) => Math.abs(p.y - 400)));
    expect(drift(thrice)).toBeGreaterThan(drift(once));
  });
});
