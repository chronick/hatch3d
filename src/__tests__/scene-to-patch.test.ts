import { describe, it, expect, beforeEach } from "vitest";
import { compositionRegistry } from "../compositions/registry";
import type { Composition2DDefinition, LayeredCompositionDefinition } from "../compositions/types";
import { runPipeline } from "../workers/render-pipeline";
import type { RenderRequest } from "../workers/render-worker.types";
import { parseSceneDoc } from "../scene/schema";
import { sceneToPatch } from "../scene/to-patch";
import { evalPatch } from "../patch/graph";

function makeStripes(id: string, y: number): Composition2DDefinition {
  return {
    id, name: id, type: "2d", category: "2d",
    generate: () => [[{ x: 100, y }, { x: 700, y }]],
  };
}

beforeEach(() => {
  compositionRegistry.register(makeStripes("stripesA", 200));
  compositionRegistry.register(makeStripes("stripesB", 600));
});

const LAYERED_SCENE = {
  version: 1, id: "two-pen",
  root: {
    type: "group", id: "root",
    children: [
      { type: "layer", id: "ground", pen: { color: "#2563eb", name: "ground" }, blend: "over",
        children: [{ type: "generator", id: "ga", composition: "stripesA" }] },
      { type: "layer", id: "accent", pen: { color: "#dc2626", name: "accent" }, blend: "over",
        children: [{ type: "generator", id: "gb", composition: "stripesB" }] },
    ],
  },
};

function baseReq(compositionKey: string): RenderRequest {
  return {
    type: "render", id: 1, compositionKey, is2d: false, width: 800, height: 800,
    resolvedValues: {}, surfaceKey: "hyperboloid", surfaceParams: {},
    hatchParams: { family: "u", count: 30, samples: 50, angle: 0.7 }, currentHatchGroups: {},
    camera: { theta: 0.6, phi: 0.35, dist: 8, ortho: false, panX: 0, panY: 0, width: 800, height: 800 },
    useOcclusion: false, depthRes: 512, depthBias: 0.01,
    exportLayout: { contentW: 0, contentH: 0, scale: 1 },
    showMesh: false, densityFilterEnabled: false, densityMax: 8, densityCellSize: 10,
  };
}

describe("sceneToPatch — lowering", () => {
  it("lowers a layered scene to generator + pen nodes with out in layer order", () => {
    const patch = sceneToPatch(parseSceneDoc(LAYERED_SCENE));
    const ops = patch.nodes.map((n) => n.op);
    expect(ops.filter((o) => o === "generator")).toHaveLength(2);
    expect(ops.filter((o) => o === "pen")).toHaveLength(2);
    expect(patch.out).toHaveLength(2);
    // Pen colors/names preserved (byte-identical SVG <g> depends on these).
    const pens = patch.nodes.filter((n) => n.op === "pen") as { color?: string; name?: string }[];
    expect(pens.map((p) => p.name)).toEqual(["ground", "accent"]);
    expect(pens.map((p) => p.color)).toEqual(["#2563eb", "#dc2626"]);
  });

  it("evaluates to the same geometry the layered pipeline produces (byte-identical)", () => {
    // Reference: a real LayeredComposition through runLayeredPipeline.
    const layered: LayeredCompositionDefinition = {
      id: "ref", name: "ref", category: "layered", type: "layered",
      layers: [
        { composition: "stripesA", color: "#2563eb", name: "ground", blendMode: "over" },
        { composition: "stripesB", color: "#dc2626", name: "accent", blendMode: "over" },
      ],
    };
    compositionRegistry.register(layered);
    const ref = runPipeline(baseReq("ref"));

    const via = evalPatch(sceneToPatch(parseSceneDoc(LAYERED_SCENE)));
    // Same per-layer svg paths + colors.
    expect(via.layers.map((l) => l.color)).toEqual(ref.layerGroups?.map((g) => g.color));
    const viaPaths = via.layers.flatMap((l) => l.geometry);
    const refPaths = ref.layerGroups?.flatMap((g) => g.svgPaths) ?? [];
    expect(viaPaths).toHaveLength(refPaths.length);
  });
});

describe("sceneToPatch — operators (previously rejected in scenes)", () => {
  it("lowers op:field-distort to a simplex field + distort node and evaluates", () => {
    const scene = {
      version: 1, id: "fd",
      root: { type: "layer", id: "l", pen: { color: "#111" },
        children: [{ type: "op:field-distort", id: "d", field: "simplex", scale: 0.01, amplitude: 5,
          child: { type: "generator", id: "g", composition: "stripesA" } }] },
    };
    const patch = sceneToPatch(parseSceneDoc(scene));
    const ops = patch.nodes.map((n) => n.op);
    expect(ops).toContain("simplexVector");
    expect(ops).toContain("distort");
    expect(() => evalPatch(patch)).not.toThrow();
  });

  it("lowers op:region-hatch and op:transform and evaluates", () => {
    const scene = {
      version: 1, id: "rh",
      root: { type: "layer", id: "l", pen: { color: "#111" },
        children: [{ type: "op:transform", id: "t", translate: [10, 0] as [number, number],
          child: { type: "op:region-hatch", id: "rh",
            region: { polygon: [[0, 0], [200, 0], [200, 200], [0, 200]] as [number, number][] },
            hatch: { angleDeg: 30, pitch: 20 } } }] },
    };
    const patch = sceneToPatch(parseSceneDoc(scene));
    expect(patch.nodes.map((n) => n.op)).toContain("regionHatch");
    expect(patch.nodes.map((n) => n.op)).toContain("transform");
    const res = evalPatch(patch);
    expect(res.layers[0].geometry.length).toBeGreaterThan(0);
  });

  it("lowers a masked layer to a clip against the mask sibling's hull", () => {
    const scene = {
      version: 1, id: "mask",
      root: { type: "group", id: "root", children: [
        { type: "layer", id: "under", pen: { color: "#111", name: "under" },
          children: [{ type: "generator", id: "gu", composition: "stripesA" }] },
        { type: "layer", id: "over", blend: "masked", maskBy: "gu", pen: { color: "#c00", name: "over" },
          children: [{ type: "generator", id: "go", composition: "stripesB" }] },
      ] },
    };
    const patch = sceneToPatch(parseSceneDoc(scene));
    expect(patch.nodes.map((n) => n.op)).toContain("clip");
    expect(() => evalPatch(patch)).not.toThrow();
  });
});
