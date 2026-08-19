/**
 * Progressive composition semantics — the three additions from
 * `active/plotter-art-workflow/design/scene-ir.md` § Progressive composition:
 * generalized derived regions (`regionOf`), document-ordered region references,
 * and weighted emphasis masks.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { compositionRegistry } from "../compositions/registry";
import type { Composition2DDefinition } from "../compositions/types";
import { evalPatch, parsePatchDoc } from "../patch/graph";
import { emphasisMask } from "../patch/operators";
import { parseSceneDoc } from "../scene/schema";
import { sceneToPatch } from "../scene/to-patch";
import type { Polyline } from "../operators/region-shapes";

/** 40 horizontal lines spanning x 100..700 at y = 100, 110, … 490. */
function bandField(id: string): Composition2DDefinition {
  return {
    id, name: id, type: "2d", category: "2d",
    generate: () =>
      Array.from({ length: 40 }, (_, i) => [
        { x: 100, y: 100 + i * 10 },
        { x: 700, y: 100 + i * 10 },
      ]),
  };
}

/**
 * A compact 100×110 box in the middle of the page — something to draw around.
 * Its top/bottom edges deliberately sit *between* the band field's rows so no
 * band line is boundary-coincident (where inside/outside is undefined).
 */
function blockShape(id: string): Composition2DDefinition {
  return {
    id, name: id, type: "2d", category: "2d",
    generate: () => [[
      { x: 350, y: 245 },
      { x: 450, y: 245 },
      { x: 450, y: 355 },
      { x: 350, y: 355 },
      { x: 350, y: 245 },
    ]],
  };
}

beforeEach(() => {
  compositionRegistry.register(bandField("bands"));
  compositionRegistry.register(blockShape("block"));
});

function totalLength(geometry: Polyline[]): number {
  let sum = 0;
  for (const line of geometry) {
    for (let i = 0; i + 1 < line.length; i++) {
      sum += Math.hypot(line[i + 1].x - line[i].x, line[i + 1].y - line[i].y);
    }
  }
  return sum;
}

/** Ink length whose midpoint falls inside the x band [lo, hi]. */
function lengthInXBand(geometry: Polyline[], lo: number, hi: number): number {
  let sum = 0;
  for (const line of geometry) {
    for (let i = 0; i + 1 < line.length; i++) {
      const a = line[i];
      const b = line[i + 1];
      const mx = (a.x + b.x) / 2;
      if (mx >= lo && mx <= hi) sum += Math.hypot(b.x - a.x, b.y - a.y);
    }
  }
  return sum;
}

const basePatch = (nodes: unknown[], out: string[]) => ({
  version: 1, id: "t",
  page: { widthPx: 800, heightPx: 800 },
  nodes, out,
});

// ── A. Derived regions through the patch clip node ───────────────────────────

describe("patch clip — regionOf", () => {
  it("clips outside a rounded, offset bbox of an earlier node (the draw-around idiom)", () => {
    const doc = basePatch([
      { op: "generator", id: "shape", composition: "block" },
      { op: "generator", id: "ground", composition: "bands" },
      {
        op: "clip", id: "around", from: "ground", mode: "outside",
        regionOf: { of: "shape", kind: "bbox", offsetPx: 12, cornerRadius: 18 },
      },
      { op: "pen", id: "p", from: "around" },
    ], ["p"]);

    const geom = evalPatch(doc).layers[0].geometry;
    // The knocked-out column is x ∈ [338, 462] over y ∈ [238, 362]; nothing
    // survives strictly inside it.
    for (const line of geom) {
      for (const p of line) {
        const inside = p.x > 340 && p.x < 460 && p.y > 240 && p.y < 360;
        expect(inside, `point ${p.x},${p.y} should have been clipped away`).toBe(false);
      }
    }
    // …and the rest of the page is untouched.
    expect(totalLength(geom)).toBeGreaterThan(0.7 * 40 * 600);
  });

  it("mode `inside` keeps only what the region covers", () => {
    const doc = basePatch([
      { op: "generator", id: "shape", composition: "block" },
      { op: "generator", id: "ground", composition: "bands" },
      { op: "clip", id: "in", from: "ground", mode: "inside", regionOf: { of: "shape", kind: "bbox" } },
      { op: "pen", id: "p", from: "in" },
    ], ["p"]);
    const geom = evalPatch(doc).layers[0].geometry;
    for (const line of geom) {
      for (const p of line) {
        expect(p.x).toBeGreaterThanOrEqual(350 - 1e-6);
        expect(p.x).toBeLessThanOrEqual(450 + 1e-6);
      }
    }
    expect(geom.length).toBeGreaterThan(0);
  });

  it("`hullOf: X` and `regionOf { of: X, kind: hull }` describe the same region", () => {
    const mk = (region: Record<string, unknown>) =>
      evalPatch(basePatch([
        { op: "generator", id: "shape", composition: "block" },
        { op: "generator", id: "ground", composition: "bands" },
        { op: "clip", id: "c", from: "ground", ...region },
        { op: "pen", id: "p", from: "c" },
      ], ["p"])).layers[0].geometry;

    const viaHullOf = mk({ hullOf: "shape" });
    const viaRegionOf = mk({ regionOf: { of: "shape", kind: "hull" } });
    expect(totalLength(viaRegionOf)).toBeCloseTo(totalLength(viaHullOf), 6);
  });

  it("each kind produces a usable region", () => {
    for (const kind of ["bbox", "hull", "outline", "occupied"] as const) {
      const geom = evalPatch(basePatch([
        { op: "generator", id: "shape", composition: "block" },
        { op: "generator", id: "ground", composition: "bands" },
        { op: "clip", id: "c", from: "ground", mode: "outside", regionOf: { of: "shape", kind, offsetPx: 6 } },
        { op: "pen", id: "p", from: "c" },
      ], ["p"])).layers[0].geometry;
      expect(totalLength(geom), kind).toBeGreaterThan(0);
      expect(totalLength(geom), kind).toBeLessThan(40 * 600);
    }
  });

  it("rejects a node carrying more than one region form", () => {
    expect(() => parsePatchDoc(basePatch([
      { op: "generator", id: "g", composition: "bands" },
      { op: "clip", id: "c", from: "g", hullOf: "g", regionOf: { of: "g", kind: "bbox" } },
      { op: "pen", id: "p", from: "c" },
    ], ["p"]))).toThrow(/exactly one of `hullOf`, `polygon` or `regionOf`/);
  });
});

// ── B. Progressive evaluation order ──────────────────────────────────────────

describe("patch reference validation — progressive evaluation order", () => {
  it("rejects a forward region reference, naming both nodes", () => {
    const doc = basePatch([
      { op: "generator", id: "ground", composition: "bands" },
      { op: "clip", id: "around", from: "ground", mode: "outside", regionOf: { of: "shape", kind: "bbox" } },
      { op: "generator", id: "shape", composition: "block" },
      { op: "pen", id: "p", from: "around" },
    ], ["p"]);
    let message = "";
    try {
      parsePatchDoc(doc);
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toMatch(/Invalid patch document/);
    expect(message).toContain('"around"');
    expect(message).toContain('"shape"');
    expect(message).toMatch(/declared later/);
  });

  it("rejects a forward geometry reference, naming both nodes", () => {
    let message = "";
    try {
      parsePatchDoc(basePatch([
        { op: "transform", id: "t", from: "g", translate: [1, 1] },
        { op: "generator", id: "g", composition: "bands" },
        { op: "pen", id: "p", from: "t" },
      ], ["p"]));
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain('"t"');
    expect(message).toContain('"g"');
    expect(message).toMatch(/declared later/);
  });

  it("rejects a self-reference as a cycle, naming the node", () => {
    let message = "";
    try {
      parsePatchDoc(basePatch([
        { op: "generator", id: "g", composition: "bands" },
        { op: "clip", id: "c", from: "c", hullOf: "g" },
        { op: "pen", id: "p", from: "c" },
      ], ["p"]));
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain('"c"');
    expect(message).toMatch(/references itself/);
    expect(message).toMatch(/acyclic/);
  });

  it("still reports a genuinely unknown id as unknown, not as forward", () => {
    let message = "";
    try {
      parsePatchDoc(basePatch([
        { op: "generator", id: "g", composition: "bands" },
        { op: "clip", id: "c", from: "g", hullOf: "nope" },
        { op: "pen", id: "p", from: "c" },
      ], ["p"]));
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toMatch(/unknown node "nope"/);
    expect(message).toContain('"c"');
  });

  it("path-prefixes the issue like the rest of schema validation", () => {
    let message = "";
    try {
      parsePatchDoc(basePatch([
        { op: "generator", id: "ground", composition: "bands" },
        { op: "clip", id: "around", from: "ground", regionOf: { of: "shape", kind: "bbox" } },
        { op: "generator", id: "shape", composition: "block" },
        { op: "pen", id: "p", from: "around" },
      ], ["p"]));
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain("nodes.1.regionOf.of");
  });

  it("rejects an `out` naming a node that does not exist", () => {
    expect(() => parsePatchDoc(basePatch([
      { op: "generator", id: "g", composition: "bands" },
    ], ["nope"]))).toThrow(/out references unknown node "nope"/);
  });

  it("accepts backward references (the whole point)", () => {
    expect(() => parsePatchDoc(basePatch([
      { op: "generator", id: "shape", composition: "block" },
      { op: "generator", id: "ground", composition: "bands" },
      { op: "clip", id: "around", from: "ground", mode: "outside", regionOf: { of: "shape", kind: "bbox" } },
      { op: "pen", id: "p", from: "around" },
    ], ["p"]))).not.toThrow();
  });
});

describe("scene reference validation — document order is render order", () => {
  const scene = (clipRegionTarget: string, layersReversed: boolean) => {
    const focus = {
      type: "layer", id: "focus-layer", pen: { color: "#111" },
      children: [{ type: "generator", id: "shape", composition: "block" }],
    };
    const ground = {
      type: "layer", id: "ground-layer", pen: { color: "#00f" },
      children: [{
        type: "op:clip", id: "around", mode: "outside",
        region: { regionOf: { of: clipRegionTarget, kind: "bbox", offsetPx: 12, cornerRadius: 18 } },
        child: { type: "generator", id: "ground", composition: "bands" },
      }],
    };
    return {
      version: 1, id: "s",
      page: { widthPx: 800, heightPx: 800 },
      root: { type: "group", id: "root", children: layersReversed ? [ground, focus] : [focus, ground] },
    };
  };

  it("lowers a backward region reference and renders it", () => {
    const patch = sceneToPatch(parseSceneDoc(scene("shape", false)));
    const res = evalPatch(patch);
    expect(res.layers.length).toBe(2);
    expect(res.layers[1].geometry.length).toBeGreaterThan(0);
  });

  it("rejects a forward region reference, naming both nodes", () => {
    expect(() => sceneToPatch(parseSceneDoc(scene("shape", true))))
      .toThrow(/"around".*"shape".*later in the document/s);
  });

  it("rejects a region reference to a node that does not exist", () => {
    expect(() => sceneToPatch(parseSceneDoc(scene("ghost", false))))
      .toThrow(/"around" references unknown node id "ghost"/);
  });
});

// ── C. Weighted emphasis ─────────────────────────────────────────────────────

describe("emphasisMask", () => {
  // 200 horizontal lines across x 0..400; the zone is the middle half.
  const lines: Polyline[] = Array.from({ length: 200 }, (_, i) => [
    { x: 0, y: i * 2 },
    { x: 400, y: i * 2 },
  ]);
  const zone: Polyline[] = [[
    { x: 100, y: -10 },
    { x: 300, y: -10 },
    { x: 300, y: 410 },
    { x: 100, y: 410 },
  ]];
  const inZoneLength = (g: Polyline[]) => lengthInXBand(g, 100, 300);
  const outZoneLength = (g: Polyline[]) => totalLength(g) - inZoneLength(g);
  // Each of the 200 lines spans x 0..400, so exactly half its 400px sits in
  // the zone. Measured analytically: `lengthInXBand` classifies by segment
  // midpoint, which only becomes meaningful once the clip has split the lines.
  const baselineIn = 200 * 200;
  const baselineOut = 200 * 200;

  it("weight 1 leaves the geometry untouched", () => {
    expect(emphasisMask(lines, zone, 1, "inside")).toEqual(lines);
  });

  it("weight 0 clips the zone away entirely and keeps everything outside it", () => {
    const out = emphasisMask(lines, zone, 0, "inside");
    expect(inZoneLength(out)).toBeCloseTo(0, 6);
    expect(outZoneLength(out)).toBeCloseTo(baselineOut, 6);
  });

  it("weight 0.5 keeps roughly half the ink in the zone and all of it outside", () => {
    const out = emphasisMask(lines, zone, 0.5, "inside");
    const ratio = inZoneLength(out) / baselineIn;
    expect(ratio).toBeGreaterThan(0.35);
    expect(ratio).toBeLessThan(0.65);
    expect(outZoneLength(out)).toBeCloseTo(baselineOut, 6);
  });

  it("thins monotonically as the weight drops", () => {
    const ratios = [0.9, 0.7, 0.5, 0.3, 0.1].map(
      (w) => inZoneLength(emphasisMask(lines, zone, w, "inside")) / baselineIn,
    );
    for (let i = 1; i < ratios.length; i++) {
      expect(ratios[i], `weight step ${i}`).toBeLessThanOrEqual(ratios[i - 1]);
    }
  });

  it("mode `outside` thins everything except the region", () => {
    const out = emphasisMask(lines, zone, 0.5, "outside");
    expect(inZoneLength(out)).toBeCloseTo(baselineIn, 6);
    expect(outZoneLength(out) / baselineOut).toBeLessThan(0.65);
  });

  it("is deterministic across runs — no RNG", () => {
    expect(emphasisMask(lines, zone, 0.5, "inside")).toEqual(emphasisMask(lines, zone, 0.5, "inside"));
    expect(emphasisMask(lines, zone, 0.37, "inside")).toEqual(emphasisMask(lines, zone, 0.37, "inside"));
  });

  it("fails open on a degenerate region", () => {
    expect(emphasisMask(lines, [], 0.2, "inside")).toEqual(lines);
  });
});

describe("patch emphasis node", () => {
  const mk = (weight: number, extra: Record<string, unknown> = {}) =>
    evalPatch(basePatch([
      { op: "generator", id: "shape", composition: "block" },
      { op: "generator", id: "ground", composition: "bands" },
      { op: "emphasis", id: "halo", from: "ground", regionOf: { of: "shape", kind: "hull", offsetPx: 80 }, weight, ...extra },
      { op: "pen", id: "p", from: "halo" },
    ], ["p"])).layers[0].geometry;

  it("weight 1 is a no-op, weight 0 punches the halo out, 0.3 sits between", () => {
    const full = totalLength(mk(1));
    const none = totalLength(mk(0));
    const soft = totalLength(mk(0.3));
    expect(none).toBeLessThan(full);
    expect(soft).toBeGreaterThan(none);
    expect(soft).toBeLessThan(full);
  });

  it("is deterministic", () => {
    expect(mk(0.3)).toEqual(mk(0.3));
  });

  it("rejects a weight outside 0..1", () => {
    expect(() => parsePatchDoc(basePatch([
      { op: "generator", id: "g", composition: "bands" },
      { op: "emphasis", id: "e", from: "g", hullOf: "g", weight: 1.5 },
      { op: "pen", id: "p", from: "e" },
    ], ["p"]))).toThrow(/Invalid patch document/);
  });
});

describe("scene op:emphasis", () => {
  const scene = (weight: number) => ({
    version: 1, id: "halo",
    page: { widthPx: 800, heightPx: 800 },
    root: {
      type: "group", id: "root",
      children: [
        {
          type: "layer", id: "focus-layer", pen: { color: "#111" },
          children: [{ type: "generator", id: "shape", composition: "block" }],
        },
        {
          type: "layer", id: "ground-layer", pen: { color: "#00f" },
          children: [{
            type: "op:emphasis", id: "halo", weight, mode: "inside",
            region: { regionOf: { of: "shape", kind: "hull", offsetPx: 80 } },
            child: { type: "generator", id: "ground", composition: "bands" },
          }],
        },
      ],
    },
  });

  it("lowers to an emphasis patch node and de-emphasises the halo", () => {
    const patch = sceneToPatch(parseSceneDoc(scene(0.3)));
    expect(patch.nodes.map((n) => n.op)).toContain("emphasis");
    const thinned = totalLength(evalPatch(patch).layers[1].geometry);
    const untouched = totalLength(evalPatch(sceneToPatch(parseSceneDoc(scene(1)))).layers[1].geometry);
    expect(thinned).toBeLessThan(untouched);
  });

  it("rejects an out-of-range weight at parse time", () => {
    expect(() => parseSceneDoc(scene(2))).toThrow(/Invalid scene document/);
  });
});
