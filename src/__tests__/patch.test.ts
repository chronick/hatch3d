import { describe, it, expect, beforeEach } from "vitest";
import { compositionRegistry } from "../compositions/registry";
import type { Composition2DDefinition } from "../compositions/types";
import { simplexScalar, simplexVector, densityField, gradient, mulberry32 } from "../patch/signals";
import { fieldDistort, fieldCull } from "../patch/operators";
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
