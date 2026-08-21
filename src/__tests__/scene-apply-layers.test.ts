import { describe, it, expect } from "vitest";
import { parseSceneDoc } from "../scene/schema";
import { applyLayersToScene, sceneToLayers, layeredToScene } from "../scene/convert";
import type { LayeredCompositionDefinition } from "../compositions/types";

/** A doc exercising everything the layer view can't show: pen widths, explicit
 *  blends, camera/seedRefs, nesting, a seeded generator, an operator child. */
const RICH_SCENE = parseSceneDoc({
  version: 1,
  id: "rich",
  page: { size: "a4", orientation: "portrait", marginMm: 12, widthPx: 600, heightPx: 900, strokeWidthMm: 0.3 },
  camera: { theta: 0.4, phi: 0.2, dist: 9, ortho: true },
  seedRefs: ["seed-123"],
  root: {
    type: "group",
    id: "root",
    children: [
      {
        type: "layer",
        id: "ground",
        pen: { color: "#2563eb", name: "ground", width: 0.25 },
        blend: "over",
        visible: true,
        children: [
          {
            type: "generator",
            id: "ground-gen",
            composition: "stripesA",
            seed: 42,
            params: { pitch: 7 },
            macros: { density: 0.5 },
          },
        ],
      },
      {
        type: "group",
        id: "inner",
        children: [
          {
            type: "layer",
            id: "accent",
            pen: { color: "#dc2626", name: "accent" },
            blend: "masked",
            maskBy: "ground",
            children: [
              { type: "generator", id: "accent-gen", composition: "stripesB" },
              {
                type: "op:region-hatch",
                id: "extra-fill",
                region: { polygon: [[0, 0], [10, 0], [10, 10]] },
                hatch: { angle: 0, pitch: 4 },
              },
            ],
          },
        ],
      },
    ],
  },
});

const SIMPLE_SCENE = parseSceneDoc({
  version: 1,
  id: "simple",
  root: {
    type: "group",
    id: "root",
    children: [
      { type: "layer", id: "a", pen: { color: "#111" }, children: [{ type: "generator", id: "ag", composition: "stripesA" }] },
      { type: "layer", id: "b", pen: { color: "#222" }, children: [{ type: "generator", id: "bg", composition: "stripesB" }] },
    ],
  },
});

describe("applyLayersToScene — round trip is a no-op (vault-2p7d)", () => {
  for (const [name, doc] of [["rich", RICH_SCENE], ["simple", SIMPLE_SCENE]] as const) {
    it(`${name}: converting out and straight back leaves the doc untouched`, () => {
      const back = applyLayersToScene(doc, sceneToLayers(doc));
      expect(back).toEqual(doc);
      // Not merely equal — the same object, so nothing downstream sees an edit.
      expect(back).toBe(doc);
    });
  }

  it("survives a doc whose root is a bare layer node", () => {
    const doc = parseSceneDoc({
      version: 1,
      id: "bare",
      root: { type: "layer", id: "only", children: [{ type: "generator", id: "g", composition: "stripesA" }] },
    });
    expect(applyLayersToScene(doc, sceneToLayers(doc))).toBe(doc);
  });

  it("is stable under repeated application", () => {
    const once = applyLayersToScene(RICH_SCENE, sceneToLayers(RICH_SCENE));
    const twice = applyLayersToScene(once, sceneToLayers(once));
    expect(twice).toEqual(RICH_SCENE);
  });

  it("is a no-op for docs layeredToScene produced", () => {
    const layered: LayeredCompositionDefinition = {
      id: "demo",
      name: "demo",
      category: "layered",
      type: "layered",
      layers: [
        { composition: "stripesA", color: "#2563eb", name: "ground", blendMode: "over" },
        { composition: "stripesB", color: "#dc2626", name: "accent", blendMode: "masked", maskBy: 0 },
      ],
    };
    const doc = layeredToScene(layered);
    expect(applyLayersToScene(doc, sceneToLayers(doc))).toBe(doc);
  });
});

describe("applyLayersToScene — edits", () => {
  it("writes a pen colour and name change without disturbing the pen width", () => {
    const layers = sceneToLayers(RICH_SCENE);
    layers[0] = { ...layers[0], color: "#00ff00", name: "renamed" };
    const doc = applyLayersToScene(RICH_SCENE, layers);
    const ground = (doc.root as { children: { pen?: Record<string, unknown> }[] }).children[0];
    expect(ground.pen).toEqual({ color: "#00ff00", name: "renamed", width: 0.25 });
  });

  it("preserves page, camera and seedRefs across an edit", () => {
    const layers = sceneToLayers(RICH_SCENE);
    layers[0] = { ...layers[0], visible: false };
    const doc = applyLayersToScene(RICH_SCENE, layers);
    expect(doc.page).toEqual(RICH_SCENE.page);
    expect(doc.camera).toEqual(RICH_SCENE.camera);
    expect(doc.seedRefs).toEqual(RICH_SCENE.seedRefs);
    expect(doc.id).toBe("rich");
  });

  it("keeps operator children and the generator's seed on an edited layer", () => {
    const layers = sceneToLayers(RICH_SCENE);
    layers[1] = { ...layers[1], color: "#ffffff" };
    layers[0] = { ...layers[0], name: "ground2" };
    const doc = applyLayersToScene(RICH_SCENE, layers);
    const nodes = sceneToLayers(doc);
    expect(nodes[0].paramOverrides).toEqual({ seed: 42, pitch: 7 });
    const accent = (doc.root as { children: { id: string; children?: { id: string }[] }[] }).children[1];
    // The nested group's layer keeps its extra operator child.
    const inner = (accent as unknown as { children: { children: { id: string }[] }[] }).children[0];
    expect(inner.children.map((c) => c.id)).toEqual(["accent-gen", "extra-fill"]);
  });

  it("reorders layer content through the existing slots", () => {
    const layers = sceneToLayers(SIMPLE_SCENE);
    const doc = applyLayersToScene(SIMPLE_SCENE, [layers[1], layers[0]]);
    expect(sceneToLayers(doc).map((l) => l.__id)).toEqual(["b", "a"]);
  });

  it("appends an added layer and drops a removed one", () => {
    const layers = sceneToLayers(SIMPLE_SCENE);
    const added = applyLayersToScene(SIMPLE_SCENE, [
      ...layers,
      { __id: "c", composition: "stripesC", color: "#333", name: "c", blendMode: "over", visible: true },
    ]);
    expect(sceneToLayers(added).map((l) => l.__id)).toEqual(["a", "b", "c"]);

    const removed = applyLayersToScene(SIMPLE_SCENE, [layers[1]]);
    expect(sceneToLayers(removed).map((l) => l.__id)).toEqual(["b"]);
  });

  it("keeps every edited doc valid against the schema", () => {
    const layers = sceneToLayers(RICH_SCENE);
    layers[0] = { ...layers[0], composition: "stripesZ", visible: false, color: "#010203" };
    const doc = applyLayersToScene(RICH_SCENE, layers);
    expect(() => parseSceneDoc(doc)).not.toThrow();
  });
});
