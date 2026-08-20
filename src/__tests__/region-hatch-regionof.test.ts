/**
 * op:region-hatch over the full region vocabulary (vault-bysyp).
 *
 * regionHatch used to accept only `from` (a convex hull) or an explicit convex
 * polygon. It now takes the same three region forms clip / emphasis do —
 * `hullOf`, `polygon`, `regionOf { bbox | hull | outline | occupied }` — and
 * fills them with an even-odd scanline over the whole ring set, so a rounded
 * rectangle stays rounded and a hole stays empty.
 *
 * The ground truth for "inside the region" here is `pointInSilhouette`, the
 * same even-odd predicate the clip/emphasis operators use — if the fill and the
 * clip disagreed, hatching a region and clipping to it would differ.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { compositionRegistry } from "../compositions/registry";
import type { Composition2DDefinition } from "../compositions/types";
import { hatchRegion, hatchPolygon, type Pt } from "../patch/region-hatch";
import { evalPatch } from "../patch/graph";
import { parseSceneDoc } from "../scene/schema";
import { sceneToPatch } from "../scene/to-patch";
import { derivedRegionRings } from "../operators/region-shapes";
import { pointInSilhouette } from "../operators/silhouette-knockout";

// ── Fixtures ────────────────────────────────────────────────────────────────

/** A rectangular outline at (60,40)–(360,240) — the bbox region source. */
const RECT: Pt[][] = [[
  { x: 60, y: 40 }, { x: 360, y: 40 }, { x: 360, y: 240 }, { x: 60, y: 240 }, { x: 60, y: 40 },
]];

/** A closed circle polyline — buffered by `occupied`/`outline` it becomes an annulus. */
function circle(cx: number, cy: number, r: number, n = 96): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * Math.PI * 2;
    pts.push({ x: cx + r * Math.cos(t), y: cy + r * Math.sin(t) });
  }
  return pts;
}

function fixed(id: string, lines: Pt[][]): Composition2DDefinition {
  return { id, name: id, type: "2d", category: "2d", generate: () => lines.map((l) => l.map((p) => ({ ...p }))) };
}

beforeEach(() => {
  compositionRegistry.register(fixed("rhRect", RECT));
  compositionRegistry.register(fixed("rhCircle", [circle(300, 300, 200)]));
});

/**
 * Points strictly inside each hatch segment — the endpoints themselves sit *on*
 * the boundary, so they are sampled just inside (0.4%) instead. Those
 * near-endpoint samples are the ones that catch a fill leaking past the region.
 */
function interiorSamples(lines: Pt[][], per = 5): Pt[] {
  const out: Pt[] = [];
  for (const [a, b] of lines) {
    const ts = [0.004, 0.996, ...Array.from({ length: per }, (_, k) => (k + 1) / (per + 1))];
    for (const t of ts) out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  }
  return out;
}

function patchGeometry(nodes: unknown[], out = ["p"]) {
  return evalPatch({ version: 1, id: "t", nodes, out }).layers[0].geometry;
}

// ── 1. Rounded-rect regionOf (bbox + cornerRadius) ──────────────────────────

describe("regionHatch — regionOf bbox with cornerRadius", () => {
  const spec = { of: "g", kind: "bbox" as const, cornerRadius: 50 };

  it("keeps every hatch line strictly inside the rounded boundary", () => {
    const lines = patchGeometry([
      { op: "generator", id: "g", composition: "rhRect" },
      { op: "regionHatch", id: "fill", regionOf: spec, angleDeg: 0, pitch: 7 },
      { op: "pen", id: "p", from: "fill", color: "#111" },
    ]);
    expect(lines.length).toBeGreaterThan(10);

    const rings = derivedRegionRings(RECT, spec);
    expect(rings).toHaveLength(1);
    for (const p of interiorSamples(lines)) {
      expect(pointInSilhouette(p, rings)).toBe(true);
    }
  });

  it("cuts the corners — nothing reaches the square bbox corner", () => {
    const rounded = patchGeometry([
      { op: "generator", id: "g", composition: "rhRect" },
      { op: "regionHatch", id: "fill", regionOf: spec, angleDeg: 0, pitch: 7 },
      { op: "pen", id: "p", from: "fill", color: "#111" },
    ]);
    const square = patchGeometry([
      { op: "generator", id: "g", composition: "rhRect" },
      { op: "regionHatch", id: "fill", regionOf: { of: "g", kind: "bbox" }, angleDeg: 0, pitch: 7 },
      { op: "pen", id: "p", from: "fill", color: "#111" },
    ]);

    // 10px inside the top-left bbox corner is inside the square region but well
    // outside a 50px-radius rounded one.
    const corner = { x: 70, y: 50 };
    const covers = (lines: Pt[][], p: Pt) =>
      lines.some(([a, b]) =>
        Math.abs(a.y - p.y) < 4 && p.x >= Math.min(a.x, b.x) && p.x <= Math.max(a.x, b.x));
    expect(covers(square, corner)).toBe(true);
    expect(covers(rounded, corner)).toBe(false);

    // Same scanline count, shorter total ink.
    const ink = (lines: Pt[][]) => lines.reduce((s, [a, b]) => s + Math.hypot(b.x - a.x, b.y - a.y), 0);
    expect(ink(rounded)).toBeLessThan(ink(square));
  });
});

// ── 2. A region with a hole ─────────────────────────────────────────────────

describe("regionHatch — multi-ring regions leave holes empty", () => {
  it("splits every scanline across a square-with-square-hole (unit level)", () => {
    const outer: Pt[] = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];
    // Same winding as the outer ring: even-odd makes it a hole regardless.
    const hole: Pt[] = [{ x: 30, y: 30 }, { x: 70, y: 30 }, { x: 70, y: 70 }, { x: 30, y: 70 }];
    const lines = hatchRegion([outer, hole], 0, 10);

    const rings = [outer, hole];
    for (const p of interiorSamples(lines)) expect(pointInSilhouette(p, rings)).toBe(true);

    // Scanlines crossing the hole (y = 30..60) must come back as two segments.
    const byY = new Map<number, Pt[][]>();
    for (const seg of lines) {
      const y = Math.round(seg[0].y);
      byY.set(y, [...(byY.get(y) ?? []), seg]);
    }
    for (const y of [30, 40, 50, 60]) expect(byY.get(y)).toHaveLength(2);
    for (const y of [0, 10, 20, 70, 80, 90]) expect(byY.get(y)).toHaveLength(1);
    // Nothing at all in the middle of the hole.
    expect(lines.some(([a, b]) => Math.abs(a.y - 50) < 1e-9 && a.x < 50 && b.x > 50)).toBe(false);
  });

  it("leaves the hole of an `occupied` annulus empty (through the patch node)", () => {
    const geom = [circle(300, 300, 200)];
    const spec = { of: "g", kind: "occupied" as const, offsetPx: 6 };
    const rings = derivedRegionRings(geom, spec);
    // A stroked circle buffered by ~one pen width is a ring: outer + inner.
    expect(rings.length).toBeGreaterThanOrEqual(2);

    const lines = patchGeometry([
      { op: "generator", id: "g", composition: "rhCircle" },
      { op: "regionHatch", id: "fill", regionOf: spec, angleDeg: 0, pitch: 6 },
      { op: "pen", id: "p", from: "fill", color: "#111" },
    ]);
    expect(lines.length).toBeGreaterThan(20);

    for (const p of interiorSamples(lines)) expect(pointInSilhouette(p, rings)).toBe(true);
    // The disc interior (well inside the hole) is untouched.
    const spansCentre = lines.some(([a, b]) =>
      Math.abs(a.y - 300) < 20 && Math.min(a.x, b.x) < 260 && Math.max(a.x, b.x) > 340);
    expect(spansCentre).toBe(false);
  });
});

// ── 2b. Tangent scanlines don't split a stroke in two ───────────────────────
//
// A scanline that grazes a vertex rather than crossing it emits *two*
// crossings at that vertex. Paired naively they become abutting spans, and the
// plotter lifts and re-drops the pen mid-stroke — a visible dropout on paper.
// The two crossings are only exactly equal when the arithmetic is lucky; the
// general case is an epsilon apart, because the two edges meeting at the
// vertex round their interpolation differently.

describe("regionHatch — vertex-tangent scanlines", () => {
  const SQUARE: Pt[] = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];

  /** Segments on the scanline at `y`, left to right. */
  function spansAt(lines: Pt[][], y: number): Pt[][] {
    return lines
      .filter(([a]) => Math.abs(a.y - y) < 1e-6)
      .sort((s, t) => s[0].x - t[0].x);
  }

  it("welds the two crossings a diamond hole's apex emits into one span", () => {
    // Apex at y = 30, widest row at y = 50 — both land on a pitch-10 scanline.
    const diamond: Pt[] = [
      { x: 50, y: 30 }, { x: 70, y: 50 }, { x: 50, y: 70 }, { x: 30, y: 50 },
    ];
    const lines = hatchRegion([SQUARE, diamond], 0, 10);

    const apex = spansAt(lines, 30);
    expect(apex).toHaveLength(1);
    expect(apex[0][0].x).toBeCloseTo(0, 9);
    expect(apex[0][1].x).toBeCloseTo(100, 9);

    // The widest row is a genuine hole crossing: two spans, real gap between.
    const widest = spansAt(lines, 50);
    expect(widest).toHaveLength(2);
    expect(widest[0][1].x).toBeCloseTo(30, 9);
    expect(widest[1][0].x).toBeCloseTo(70, 9);
  });

  it("welds an apex whose two crossings are only epsilon apart", () => {
    // Asymmetric diamond: at y = 30 the right edge interpolates to exactly
    // 63.383 (t = 0) while the left edge lands on 63.383000000000007 (t = 1,
    // 9.855 + (63.383 - 9.855) doesn't round back). ~7e-15 of separation —
    // invisible on paper, but enough to split the span without the weld.
    const diamond: Pt[] = [
      { x: 63.383, y: 30 }, { x: 90, y: 50 }, { x: 63.383, y: 70 }, { x: 9.855, y: 50 },
    ];
    expect(9.855 + (63.383 - 9.855)).not.toBe(63.383); // the premise, asserted

    const lines = hatchRegion([SQUARE, diamond], 0, 10);
    const apex = spansAt(lines, 30);
    expect(apex).toHaveLength(1);
    expect(apex[0][0].x).toBeCloseTo(0, 9);
    expect(apex[0][1].x).toBeCloseTo(100, 9);

    expect(spansAt(lines, 50)).toHaveLength(2);
  });

  it("emits no zero-width or abutting spans anywhere in the fill", () => {
    const diamond: Pt[] = [
      { x: 63.383, y: 30 }, { x: 90, y: 50 }, { x: 63.383, y: 70 }, { x: 9.855, y: 50 },
    ];
    for (const pitch of [3, 7, 10]) {
      const lines = hatchRegion([SQUARE, diamond], 0, pitch);
      expect(lines.length).toBeGreaterThan(10);
      for (const [a, b] of lines) expect(b.x - a.x).toBeGreaterThan(1e-9);
      const ys = new Set(lines.map(([a]) => a.y));
      for (const y of ys) {
        const row = spansAt(lines, y);
        for (let i = 1; i < row.length; i++) {
          expect(row[i][0].x - row[i - 1][1].x, `pitch ${pitch} @ y=${y}`).toBeGreaterThanOrEqual(1e-9);
        }
      }
    }
  });
});

// ── 2c. Scanline loop termination far from the origin ───────────────────────

describe("regionHatch — terminates on rings far from the origin", () => {
  it("does not hang when y + pitch rounds back to y", () => {
    // At y ≈ 1e20 with pitch 1, `y += pitch` is a no-op in float64, so the old
    // accumulator loop spun forever. The span is small enough to pass the
    // MAX_SCANLINES guard, so nothing else catches it.
    const big = 1e20;
    expect(big + 1).toBe(big); // the premise, asserted
    const ring: Pt[] = [
      { x: 0, y: big }, { x: 50, y: big }, { x: 50, y: big + 10 }, { x: 0, y: big + 10 },
    ];
    const lines = hatchRegion([ring], 0, 1);
    // Degenerate at this magnitude (every scanline collapses onto one y), but
    // it returns — bounded, finite, and fast.
    expect(Array.isArray(lines)).toBe(true);
    expect(lines.length).toBeLessThanOrEqual(11);
  });

  it("still throws on a genuinely runaway pitch rather than emitting millions", () => {
    const ring: Pt[] = [
      { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 1000 }, { x: 0, y: 1000 },
    ];
    expect(() => hatchRegion([ring], 0, 0.001)).toThrow(/increase pitch/);
  });
});

// ── 3. Convex equivalence with the pre-widening code path ───────────────────

/**
 * The single-ring scanline fill exactly as it stood before this change
 * (src/patch/region-hatch.ts @ adc609a). The widened fill must reproduce it
 * bit-for-bit for every single-ring input, which is what makes existing
 * polygon / hullOf documents render identically rather than merely similarly.
 */
function hatchPolygonV1(polygon: Pt[], angleDeg: number, pitch: number): Pt[][] {
  if (polygon.length < 3 || pitch <= 0) return [];
  const a = (-angleDeg * Math.PI) / 180;
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  const rot = polygon.map((p) => ({ x: p.x * ca - p.y * sa, y: p.x * sa + p.y * ca }));
  const ib = (angleDeg * Math.PI) / 180;
  const cb = Math.cos(ib);
  const sb = Math.sin(ib);
  const back = (x: number, y: number): Pt => ({ x: x * cb - y * sb, y: x * sb + y * cb });
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of rot) {
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const n = rot.length;
  const lines: Pt[][] = [];
  const first = Math.ceil(minY / pitch) * pitch;
  for (let y = first; y <= maxY; y += pitch) {
    const xs: number[] = [];
    for (let i = 0; i < n; i++) {
      const p0 = rot[i];
      const p1 = rot[(i + 1) % n];
      const lo = Math.min(p0.y, p1.y);
      const hi = Math.max(p0.y, p1.y);
      if (y >= lo && y < hi) {
        const t = (y - p0.y) / (p1.y - p0.y);
        xs.push(p0.x + t * (p1.x - p0.x));
      }
    }
    if (xs.length < 2) continue;
    xs.sort((p, q) => p - q);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      if (xs[i + 1] - xs[i] > 1e-9) lines.push([back(xs[i], y), back(xs[i + 1], y)]);
    }
  }
  return lines;
}

describe("regionHatch — backward compatibility", () => {
  const fixtures: [string, Pt[]][] = [
    ["axis-aligned square", [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 200 }, { x: 0, y: 200 }]],
    ["triangle", [{ x: 13.5, y: -20 }, { x: 190.25, y: 7 }, { x: 44, y: 173.75 }]],
    ["rounded hull", derivedRegionRings(RECT, { of: "g", kind: "hull", cornerRadius: 30 })[0]],
    ["concave notch", [
      { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 60, y: 100 },
      { x: 60, y: 40 }, { x: 40, y: 40 }, { x: 40, y: 100 }, { x: 0, y: 100 },
    ]],
  ];

  for (const [name, poly] of fixtures) {
    for (const angle of [0, 30, -45, 90]) {
      it(`is byte-identical to the pre-widening fill: ${name} @ ${angle}°`, () => {
        const now = hatchPolygon(poly, angle, 7);
        const before = hatchPolygonV1(poly, angle, 7);
        expect(now.length).toBeGreaterThan(0);
        expect(JSON.stringify(now)).toBe(JSON.stringify(before));
      });
    }
  }

  it("still fills an explicit polygon and still rejects two region forms", () => {
    const poly = [[0, 0], [200, 0], [200, 200], [0, 200]] as [number, number][];
    expect(patchGeometry([
      { op: "regionHatch", id: "fill", polygon: poly, angleDeg: 0, pitch: 20 },
      { op: "pen", id: "p", from: "fill", color: "#111" },
    ]).length).toBeGreaterThan(5);

    expect(() => patchGeometry([
      { op: "generator", id: "g", composition: "rhRect" },
      { op: "regionHatch", id: "fill", from: "g", regionOf: { of: "g", kind: "bbox" }, angleDeg: 0, pitch: 20 },
      { op: "pen", id: "p", from: "fill", color: "#111" },
    ])).toThrow(/exactly one of/);
  });

  it("`from: X` and `hullOf: X` are the same node (the alias never drifts)", () => {
    const viaFrom = patchGeometry([
      { op: "generator", id: "g", composition: "rhCircle" },
      { op: "regionHatch", id: "fill", from: "g", angleDeg: 22, pitch: 11 },
      { op: "pen", id: "p", from: "fill", color: "#111" },
    ]);
    const viaHullOf = patchGeometry([
      { op: "generator", id: "g", composition: "rhCircle" },
      { op: "regionHatch", id: "fill", hullOf: "g", angleDeg: 22, pitch: 11 },
      { op: "pen", id: "p", from: "fill", color: "#111" },
    ]);
    const viaRegionOf = patchGeometry([
      { op: "generator", id: "g", composition: "rhCircle" },
      { op: "regionHatch", id: "fill", regionOf: { of: "g", kind: "hull" }, angleDeg: 22, pitch: 11 },
      { op: "pen", id: "p", from: "fill", color: "#111" },
    ]);
    expect(viaFrom.length).toBeGreaterThan(0);
    expect(JSON.stringify(viaHullOf)).toBe(JSON.stringify(viaFrom));
    expect(JSON.stringify(viaRegionOf)).toBe(JSON.stringify(viaFrom));
  });

  it("rejects a forward region reference like clip/emphasis do", () => {
    expect(() => patchGeometry([
      { op: "regionHatch", id: "fill", regionOf: { of: "g", kind: "bbox" }, angleDeg: 0, pitch: 10 },
      { op: "generator", id: "g", composition: "rhRect" },
      { op: "pen", id: "p", from: "fill", color: "#111" },
    ])).toThrow(/declared later|references the region/);
  });
});

// ── 4. Scene lowering ───────────────────────────────────────────────────────

describe("op:region-hatch — scene lowering with regionOf", () => {
  const scene = (region: unknown) => ({
    version: 1, id: "rh-region",
    page: { size: "a4", orientation: "portrait", widthPx: 600, heightPx: 600 },
    root: { type: "group", id: "root", children: [
      { type: "layer", id: "base", pen: { color: "#111", name: "base" },
        children: [{ type: "generator", id: "g", composition: "rhRect" }] },
      { type: "layer", id: "fillLayer", pen: { color: "#c00", name: "fill" },
        children: [{ type: "op:region-hatch", id: "fill", region, hatch: { angle: 15, pitch: 9 } }] },
    ] },
  });

  it("compiles and renders a regionOf rounded-rect fill", () => {
    const doc = parseSceneDoc(scene({ regionOf: { of: "g", kind: "bbox", offsetPx: 10, cornerRadius: 40 } }));
    const patch = sceneToPatch(doc);
    const hatchNode = patch.nodes.find((n) => n.op === "regionHatch") as { regionOf?: { of: string; kind: string } };
    expect(hatchNode.regionOf).toEqual({ of: "g", kind: "bbox", offsetPx: 10, cornerRadius: 40 });

    const res = evalPatch(patch);
    const lines = res.layers[1].geometry;
    expect(lines.length).toBeGreaterThan(5);
    const rings = derivedRegionRings(RECT, { of: "g", kind: "bbox", offsetPx: 10, cornerRadius: 40 });
    for (const p of interiorSamples(lines)) expect(pointInSilhouette(p, rings)).toBe(true);
  });

  it("still lowers the hullOf and polygon forms", () => {
    expect(() => evalPatch(sceneToPatch(parseSceneDoc(scene({ hullOf: "g" }))))).not.toThrow();
    const poly = sceneToPatch(parseSceneDoc(scene({ polygon: [[0, 0], [300, 0], [300, 300], [0, 300]] })));
    const node = poly.nodes.find((n) => n.op === "regionHatch") as { polygon?: number[][] };
    expect(node.polygon).toHaveLength(4);
    expect(evalPatch(poly).layers[1].geometry.length).toBeGreaterThan(5);
  });

  it("rejects a region referencing a node that appears later", () => {
    const bad = {
      version: 1, id: "bad",
      root: { type: "group", id: "root", children: [
        { type: "layer", id: "fillLayer", pen: { color: "#c00" },
          children: [{ type: "op:region-hatch", id: "fill",
            region: { regionOf: { of: "g", kind: "bbox" } }, hatch: { angle: 0, pitch: 9 } }] },
        { type: "layer", id: "base", pen: { color: "#111" },
          children: [{ type: "generator", id: "g", composition: "rhRect" }] },
      ] },
    };
    expect(() => sceneToPatch(parseSceneDoc(bad))).toThrow(/appears later in the document/);
  });
});
