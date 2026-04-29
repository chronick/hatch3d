import { describe, it, expect, beforeEach } from "vitest";
import { CompositionRegistry, compositionRegistry } from "../compositions/registry";
import {
  isLayeredComposition,
  is2DComposition,
  type Composition2DDefinition,
  type LayeredCompositionDefinition,
  type LayeredLayer,
} from "../compositions/types";
import { runPipeline } from "../workers/render-pipeline";
import type { RenderRequest } from "../workers/render-worker.types";
import { reorderLayers } from "../components/LayerPanel";

// ── Helpers ──

/**
 * Build a 2D composition that emits a single deterministic polyline.
 * `bounds` controls the polyline's bounding rect so we can test masking.
 */
function makeBox2D(
  id: string,
  bounds: { xMin: number; yMin: number; xMax: number; yMax: number },
): Composition2DDefinition {
  return {
    id,
    name: id,
    type: "2d",
    category: "2d",
    generate: () => [
      [
        { x: bounds.xMin, y: bounds.yMin },
        { x: bounds.xMax, y: bounds.yMin },
        { x: bounds.xMax, y: bounds.yMax },
        { x: bounds.xMin, y: bounds.yMax },
        { x: bounds.xMin, y: bounds.yMin },
      ],
    ],
  };
}

/**
 * Build a 2D composition that emits N parallel horizontal lines spanning the
 * full width — used as a "masked" candidate to verify clipping.
 */
function makeStripes2D(id: string, width: number, lineCount: number): Composition2DDefinition {
  return {
    id,
    name: id,
    type: "2d",
    category: "2d",
    generate: ({ height }) => {
      const lines: { x: number; y: number }[][] = [];
      for (let i = 0; i < lineCount; i++) {
        const y = ((i + 0.5) / lineCount) * height;
        lines.push([
          { x: 0, y },
          { x: width, y },
        ]);
      }
      return lines;
    },
  };
}

function makeRequest(compositionKey: string): RenderRequest {
  return {
    type: "render",
    id: 1,
    compositionKey,
    is2d: false,
    width: 100,
    height: 100,
    resolvedValues: {},
    surfaceKey: "hyperboloid",
    surfaceParams: {},
    hatchParams: { family: "u", count: 10, samples: 10, angle: 0 },
    currentHatchGroups: {},
    camera: {
      theta: 0,
      phi: 0,
      dist: 5,
      ortho: false,
      panX: 0,
      panY: 0,
      width: 100,
      height: 100,
    },
    useOcclusion: false,
    depthRes: 64,
    depthBias: 0.01,
    exportLayout: { contentW: 200, contentH: 200, scale: 1 },
    showMesh: false,
    densityFilterEnabled: false,
    densityMax: 8,
    densityCellSize: 10,
  };
}

describe("LayeredComposition — type + registry", () => {
  it("isLayeredComposition narrows on type discriminant", () => {
    const layered: LayeredCompositionDefinition = {
      id: "demo",
      name: "Demo",
      type: "layered",
      category: "layered",
      layers: [{ composition: "inner" }],
    };
    expect(isLayeredComposition(layered)).toBe(true);
    expect(is2DComposition(layered)).toBe(false);
  });

  it("registers in CompositionRegistry alongside 2D/3D", () => {
    const reg = new CompositionRegistry();
    reg.register(makeBox2D("box", { xMin: 0, yMin: 0, xMax: 50, yMax: 50 }));
    reg.register({
      id: "stack",
      name: "Stack",
      type: "layered",
      category: "layered",
      layers: [{ composition: "box" }],
    });
    expect(reg.size).toBe(2);
    const meta = reg.getAllMetadata();
    const layeredMeta = meta.find((m) => m.id === "stack");
    expect(layeredMeta?.type).toBe("layered");
  });
});

describe("LayeredComposition — pipeline rendering", () => {
  // The pipeline reads from the global registry; isolate via teardown.
  const cleanupIds: string[] = [];

  beforeEach(() => {
    for (const id of cleanupIds) compositionRegistry.getAll().delete(id);
    cleanupIds.length = 0;
  });

  function regWithCleanup(comp: { id: string }) {
    compositionRegistry.register(comp as never);
    cleanupIds.push(comp.id);
  }

  it("preserves layer order in the output", () => {
    regWithCleanup(makeBox2D("layA", { xMin: 0, yMin: 0, xMax: 30, yMax: 30 }));
    regWithCleanup(makeBox2D("layB", { xMin: 10, yMin: 10, xMax: 40, yMax: 40 }));
    regWithCleanup(makeBox2D("layC", { xMin: 50, yMin: 50, xMax: 80, yMax: 80 }));
    regWithCleanup({
      id: "ordered",
      name: "Ordered",
      type: "layered",
      category: "layered",
      layers: [
        { composition: "layA", name: "first", color: "red" },
        { composition: "layB", name: "second", color: "green" },
        { composition: "layC", name: "third", color: "blue" },
      ],
    });

    const result = runPipeline(makeRequest("ordered"));
    expect(result.layerGroups).toBeDefined();
    expect(result.layerGroups).toHaveLength(3);
    expect(result.layerGroups!.map((g) => g.name)).toEqual(["first", "second", "third"]);
    expect(result.layerGroups!.map((g) => g.color)).toEqual(["red", "green", "blue"]);
    // Each group should have at least one path (non-empty inner composition).
    for (const g of result.layerGroups!) {
      expect(g.svgPaths.length).toBeGreaterThan(0);
    }
  });

  it("flat svgPaths is the union of all layer paths in order", () => {
    regWithCleanup(makeBox2D("uA", { xMin: 0, yMin: 0, xMax: 30, yMax: 30 }));
    regWithCleanup(makeBox2D("uB", { xMin: 50, yMin: 50, xMax: 80, yMax: 80 }));
    regWithCleanup({
      id: "union-layered",
      name: "Union",
      type: "layered",
      category: "layered",
      layers: [{ composition: "uA" }, { composition: "uB" }],
    });

    const result = runPipeline(makeRequest("union-layered"));
    const groupedConcat = result.layerGroups!.flatMap((g) => g.svgPaths);
    expect(result.svgPaths).toEqual(groupedConcat);
  });

  it("masked blendMode clips the layer to the convex hull of the mask layer", () => {
    // Mask layer: a small 20x20 box at the top-left.
    regWithCleanup(
      makeBox2D("smallMask", { xMin: 0, yMin: 0, xMax: 20, yMax: 20 }),
    );
    // Stripes spanning the full width — without masking, all 5 lines would appear.
    regWithCleanup(makeStripes2D("stripes", 100, 5));
    regWithCleanup({
      id: "mask-test",
      name: "Mask Test",
      type: "layered",
      category: "layered",
      layers: [
        { composition: "smallMask", name: "mask" },
        { composition: "stripes", name: "stripes", blendMode: "masked", maskBy: 0 },
      ],
    });

    const result = runPipeline(makeRequest("mask-test"));
    const stripesGroup = result.layerGroups![1];
    // Mask covers y=0..20 of a 100-tall canvas; stripes are at y=10,30,50,70,90.
    // Only the first stripe (y=10) intersects the mask region.
    expect(stripesGroup.svgPaths.length).toBe(1);
    // And the surviving stripe should be clipped horizontally to the mask's x range (0..20).
    const m = stripesGroup.svgPaths[0].match(/L([\d.-]+),/);
    expect(m).not.toBeNull();
    const endX = parseFloat(m![1]);
    expect(endX).toBeLessThanOrEqual(20.001);
  });

  it("masked blendMode clips stripes to a triangular mask (not its bbox)", () => {
    // Triangular mask: hull = triangle (0,0)-(40,0)-(0,40). Hypotenuse
    // x+y=40 distinguishes hull-clipping (xMax≈30 at y=10) from bbox
    // clipping (xMax=40 — the bbox).
    regWithCleanup({
      id: "triMask",
      name: "tri",
      type: "2d",
      category: "2d",
      generate: () => [
        [
          { x: 0, y: 0 },
          { x: 40, y: 0 },
          { x: 0, y: 40 },
          { x: 0, y: 0 },
        ],
      ],
    } as Composition2DDefinition);
    regWithCleanup(makeStripes2D("stripesTri", 100, 5));
    regWithCleanup({
      id: "tri-mask-test",
      name: "Tri Mask Test",
      type: "layered",
      category: "layered",
      layers: [
        { composition: "triMask", name: "mask" },
        { composition: "stripesTri", name: "stripes", blendMode: "masked", maskBy: 0 },
      ],
    });

    const result = runPipeline(makeRequest("tri-mask-test"));
    const stripesGroup = result.layerGroups![1];

    // Stripes at y=10 (x∈[0,30]) and y=30 (x∈[0,10]) survive. y=50, 70, 90
    // sit above the triangle's y-extent (max 40) → fully clipped (no paths
    // emitted for those rows, demonstrating the "y=50 yields 0 paths"
    // expectation).
    expect(stripesGroup.svgPaths.length).toBe(2);

    let xMax = -Infinity;
    for (const d of stripesGroup.svgPaths) {
      for (const m of d.matchAll(/[ML]([\d.-]+),/g)) {
        const x = parseFloat(m[1]);
        if (x > xMax) xMax = x;
      }
    }
    expect(xMax).toBeGreaterThan(29);
    expect(xMax).toBeLessThan(31);
  });

  it("masked blendMode fails open (no clip) when mask hull is degenerate", () => {
    // A single horizontal polyline (collinear) has no convex hull → the
    // pipeline must leave the masked layer unmodified.
    regWithCleanup({
      id: "lineMask",
      name: "line",
      type: "2d",
      category: "2d",
      generate: () => [
        [
          { x: 0, y: 50 },
          { x: 100, y: 50 },
        ],
      ],
    } as Composition2DDefinition);
    regWithCleanup(makeStripes2D("stripesDegen", 100, 5));
    regWithCleanup({
      id: "degen-mask-test",
      name: "Degenerate Mask",
      type: "layered",
      category: "layered",
      layers: [
        { composition: "lineMask", name: "mask" },
        { composition: "stripesDegen", name: "stripes", blendMode: "masked", maskBy: 0 },
      ],
    });

    const result = runPipeline(makeRequest("degen-mask-test"));
    expect(result.layerGroups![1].svgPaths.length).toBe(5);
  });

  it("masked layer with no mask data falls back to 'over' (no clip)", () => {
    regWithCleanup(makeStripes2D("stripesA", 100, 3));
    regWithCleanup({
      id: "self-mask-test",
      name: "Self Mask",
      type: "layered",
      category: "layered",
      // maskBy points to itself — no mask layer to clip against, so no-op.
      layers: [{ composition: "stripesA", blendMode: "masked", maskBy: 0 }],
    });
    const result = runPipeline(makeRequest("self-mask-test"));
    expect(result.layerGroups![0].svgPaths.length).toBe(3);
  });

  it("unknown inner composition produces an empty layer group (no throw)", () => {
    regWithCleanup({
      id: "unknown-inner",
      name: "Unknown Inner",
      type: "layered",
      category: "layered",
      layers: [{ composition: "does-not-exist", name: "ghost" }],
    });
    const result = runPipeline(makeRequest("unknown-inner"));
    expect(result.layerGroups).toHaveLength(1);
    expect(result.layerGroups![0].svgPaths).toEqual([]);
  });

  it("reorderLayers reindexes maskBy so it points at the same logical layer", () => {
    const layers: LayeredLayer[] = [
      { __id: "a", composition: "a" },
      { __id: "b", composition: "b" },
      { __id: "c", composition: "c", blendMode: "masked", maskBy: 0 },
    ];
    // Move layer "a" (currently index 0) to position currently held by "b".
    const next = reorderLayers(layers, "a", "b");
    // After reorder, "a" should be at index 1 and "c" should still mask by "a".
    expect(next.map((l) => l.__id)).toEqual(["b", "a", "c"]);
    const c = next.find((l) => l.__id === "c")!;
    expect(c.maskBy).toBe(1);
  });

  it("paramOverrides are passed to the inner composition's resolvedValues", () => {
    let capturedValues: Record<string, unknown> | null = null;
    const probe: Composition2DDefinition = {
      id: "probe",
      name: "Probe",
      type: "2d",
      category: "2d",
      controls: {
        widthFactor: { type: "slider", label: "Width", default: 0.5, min: 0, max: 1, group: "g" },
      },
      generate: ({ values }) => {
        capturedValues = values;
        return [[{ x: 0, y: 0 }, { x: 1, y: 1 }]];
      },
    };
    regWithCleanup(probe);
    regWithCleanup({
      id: "param-pass",
      name: "Param Pass",
      type: "layered",
      category: "layered",
      layers: [{ composition: "probe", paramOverrides: { widthFactor: 0.9 } }],
    });
    runPipeline(makeRequest("param-pass"));
    expect(capturedValues).not.toBeNull();
    expect((capturedValues as { widthFactor?: number }).widthFactor).toBe(0.9);
  });
});
