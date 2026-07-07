import { describe, it, expect, beforeEach } from "vitest";
import { CompositionRegistry, compositionRegistry } from "../compositions/registry";
import type {
  Composition2DDefinition,
  LayeredCompositionDefinition,
} from "../compositions/types";
import { runPipeline } from "../workers/render-pipeline";
import type { RenderRequest } from "../workers/render-worker.types";
import { parseSceneDoc, SceneDocSchema } from "../scene/schema";
import { compileScene } from "../scene/compile";
import { layeredToScene, sceneToLayers } from "../scene/convert";

// ── Fixtures ──

function makeStripes(id: string, y: number): Composition2DDefinition {
  return {
    id,
    name: id,
    type: "2d",
    category: "2d",
    generate: () => [
      [
        { x: 100, y },
        { x: 700, y },
      ],
    ],
  };
}

const VALID_SCENE = {
  version: 1,
  id: "test-scene",
  page: { size: "a3", orientation: "landscape", marginMm: 15 },
  root: {
    type: "group",
    id: "root",
    children: [
      {
        type: "layer",
        id: "ground",
        pen: { color: "#2563eb", name: "ground" },
        blend: "over",
        children: [{ type: "generator", id: "ground-gen", composition: "stripesA" }],
      },
      {
        type: "layer",
        id: "accent",
        pen: { color: "#dc2626", name: "accent" },
        blend: "over",
        children: [{ type: "generator", id: "accent-gen", composition: "stripesB" }],
      },
    ],
  },
};

function baseReq(compositionKey: string): RenderRequest {
  return {
    type: "render",
    id: 1,
    compositionKey,
    is2d: false,
    width: 800,
    height: 800,
    resolvedValues: {},
    surfaceKey: "hyperboloid",
    surfaceParams: {},
    hatchParams: { family: "u", count: 30, samples: 50, angle: 0.7 },
    currentHatchGroups: {},
    camera: {
      theta: 0.6,
      phi: 0.35,
      dist: 8,
      ortho: false,
      panX: 0,
      panY: 0,
      width: 800,
      height: 800,
    },
    useOcclusion: false,
    depthRes: 512,
    depthBias: 0.01,
    exportLayout: { contentW: 0, contentH: 0, scale: 1 },
    showMesh: false,
    densityFilterEnabled: false,
    densityMax: 8,
    densityCellSize: 10,
  };
}

// The scene modules use the shared `compositionRegistry` singleton; register
// deterministic fixtures on it so compile/render can resolve generators.
beforeEach(() => {
  const reg = compositionRegistry as unknown as CompositionRegistry;
  reg.register(makeStripes("stripesA", 200));
  reg.register(makeStripes("stripesB", 600));
});

describe("SceneDoc schema", () => {
  it("parses a valid document", () => {
    const doc = parseSceneDoc(VALID_SCENE);
    expect(doc.version).toBe(1);
    expect(doc.id).toBe("test-scene");
    expect(doc.root.type).toBe("group");
  });

  it("applies page defaults", () => {
    const doc = parseSceneDoc({
      version: 1,
      id: "d",
      root: {
        type: "layer",
        id: "l",
        children: [{ type: "generator", id: "g", composition: "stripesA" }],
      },
    });
    expect(doc.page.size).toBe("a3");
    expect(doc.page.orientation).toBe("landscape");
    expect(doc.page.marginMm).toBe(15);
  });

  it("rejects unknown top-level keys (strict)", () => {
    expect(() => parseSceneDoc({ ...VALID_SCENE, bogus: true })).toThrow(/Invalid scene document/);
  });

  it("rejects a wrong version", () => {
    expect(() => parseSceneDoc({ ...VALID_SCENE, version: 2 })).toThrow(/Invalid scene document/);
  });

  it("rejects a layer with no children", () => {
    const bad = {
      version: 1,
      id: "d",
      root: { type: "layer", id: "l", children: [] },
    };
    expect(() => parseSceneDoc(bad)).toThrow(/Invalid scene document/);
  });

  it("accepts operator nodes at the schema level (deferred at compile)", () => {
    const withOp = {
      version: 1,
      id: "d",
      root: {
        type: "layer",
        id: "l",
        children: [
          {
            type: "op:field-distort",
            id: "fd",
            field: "simplex",
            scale: 0.3,
            amplitude: 4,
            child: { type: "generator", id: "g", composition: "stripesA" },
          },
        ],
      },
    };
    expect(SceneDocSchema.safeParse(withOp).success).toBe(true);
  });
});

describe("compileScene", () => {
  it("flattens the tree into a layered composition", () => {
    const compiled = compileScene(VALID_SCENE);
    expect(compiled.composition.type).toBe("layered");
    expect(compiled.composition.layers).toHaveLength(2);
    expect(compiled.composition.layers[0]).toMatchObject({
      composition: "stripesA",
      color: "#2563eb",
      name: "ground",
      blendMode: "over",
    });
  });

  it("is deterministic (same doc → identical composition)", () => {
    const a = compileScene(VALID_SCENE);
    const b = compileScene(VALID_SCENE);
    expect(JSON.stringify(a.composition.layers)).toBe(JSON.stringify(b.composition.layers));
  });

  it("errors clearly on an unknown composition", () => {
    const bad = structuredClone(VALID_SCENE);
    bad.root.children[0].children[0].composition = "doesNotExist";
    expect(() => compileScene(bad)).toThrow(/unknown composition "doesNotExist"/);
  });

  it("defers operator nodes with a pointer to the extraction task", () => {
    const withOp = {
      version: 1,
      id: "d",
      root: {
        type: "layer",
        id: "l",
        children: [
          {
            type: "op:field-distort",
            id: "fd",
            field: "simplex",
            scale: 0.3,
            amplitude: 4,
            child: { type: "generator", id: "g", composition: "stripesA" },
          },
        ],
      },
    };
    expect(() => compileScene(withOp)).toThrow(/not implemented in v1/);
  });
});

describe("round-trip converter", () => {
  it("layered → scene → layers preserves the stack", () => {
    const layered: LayeredCompositionDefinition = {
      id: "demo",
      name: "demo",
      category: "layered",
      type: "layered",
      layers: [
        { composition: "stripesA", color: "#2563eb", name: "ground", blendMode: "over" },
        { composition: "stripesB", color: "#dc2626", name: "accent", blendMode: "over" },
      ],
    };
    const doc = layeredToScene(layered);
    expect(SceneDocSchema.safeParse(doc).success).toBe(true);
    const backLayers = sceneToLayers(doc);
    expect(backLayers).toHaveLength(2);
    expect(backLayers[0]).toMatchObject({ composition: "stripesA", color: "#2563eb", name: "ground" });
    expect(backLayers[1]).toMatchObject({ composition: "stripesB", color: "#dc2626", name: "accent" });
  });
});

describe("scene render equivalence", () => {
  it("compiled scene renders identically to the equivalent layered composition", () => {
    // Direct layered composition.
    const layered: LayeredCompositionDefinition = {
      id: "direct",
      name: "direct",
      category: "layered",
      type: "layered",
      layers: [
        { composition: "stripesA", color: "#2563eb", name: "ground", blendMode: "over" },
        { composition: "stripesB", color: "#dc2626", name: "accent", blendMode: "over" },
      ],
    };
    compositionRegistry.register(layered);
    const directResult = runPipeline(baseReq("direct"));

    // Same stack via a compiled scene.
    const compiled = compileScene(VALID_SCENE);
    compositionRegistry.register(compiled.composition);
    const sceneResult = runPipeline(baseReq(compiled.composition.id));

    expect(sceneResult.svgPaths).toEqual(directResult.svgPaths);
    expect(sceneResult.layerGroups?.map((g) => g.color)).toEqual(
      directResult.layerGroups?.map((g) => g.color),
    );
  });

  it("same scene doc renders deterministically across two compiles", () => {
    const c1 = compileScene(VALID_SCENE);
    compositionRegistry.register({ ...c1.composition, id: "scene:det1" });
    const c2 = compileScene(VALID_SCENE);
    compositionRegistry.register({ ...c2.composition, id: "scene:det2" });
    const r1 = runPipeline(baseReq("scene:det1"));
    const r2 = runPipeline(baseReq("scene:det2"));
    expect(r1.svgPaths).toEqual(r2.svgPaths);
  });
});
