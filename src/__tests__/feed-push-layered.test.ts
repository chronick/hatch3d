/**
 * feed-push layered-composition serialization (vault-3ayle).
 *
 * cli/feed-push.ts used to hand `result.svgPaths` straight to buildSVGContent,
 * so a layered composition (twoPenOffset, phyllotaxisIsoblocks) was pushed to
 * the feed as one flat group and its per-pen `layerGroups` were dropped on the
 * floor. These tests pin the serializer *decision* — layered in, Inkscape
 * layers out; flat in, byte-identical legacy output.
 *
 * Everything here is local: results are constructed by hand or by running the
 * render pipeline in-process. No feed API, no network (the fetch spy below is
 * the standing guard for that).
 */

import { describe, it, expect, beforeAll, vi } from "vitest";
import {
  buildSVGContent,
  buildLayeredSVGContent,
  computeExportLayout,
  INKSCAPE_NS,
} from "../../cli/svg-export";
import { loadCompositions } from "../../cli/load-compositions";
import { compositionRegistry } from "../compositions/registry";
import { is2DComposition } from "../compositions/types";
import { runPipeline } from "../workers/render-pipeline";
import type {
  LayerGroupResult,
  RenderRequest,
  RenderResult,
} from "../workers/render-worker.types";

const LAYOUT = computeExportLayout("a3", "landscape", 15, 800, 800);
const MARGIN = 15;
const STROKE = 0.5;

const PATH_A = "M 10 10 L 20 20 L 30 10";
const PATH_B = "M 40 40 L 50 50";
const PATH_C = "M 60 10 L 60 90";

/**
 * cli/feed-push.ts is a CLI entry point. It is imported dynamically, *after* a
 * fetch spy is installed, so module-load side effects can't reach the feed API
 * and the "no network in tests" rule is enforced rather than assumed.
 */
const fetchSpy = vi.fn(() => {
  throw new Error("network access is forbidden in this test");
});
let serializeRenderResult: typeof import("../../cli/feed-push").serializeRenderResult;

beforeAll(async () => {
  vi.stubGlobal("fetch", fetchSpy);
  ({ serializeRenderResult } = await import("../../cli/feed-push"));
  loadCompositions();
});

/** Count of top-level Inkscape layer groups in an SVG string. */
function layerCount(svg: string): number {
  return (svg.match(/inkscape:groupmode="layer"/g) ?? []).length;
}

/** Run a composition through the real pipeline the way feed-push does. */
function pipelineResult(compositionKey: string): RenderResult {
  const comp = compositionRegistry.get(compositionKey);
  if (!comp) throw new Error(`composition not registered: ${compositionKey}`);

  const resolvedValues: Record<string, unknown> = {};
  if (comp.controls) {
    for (const [key, ctrl] of Object.entries(comp.controls)) {
      resolvedValues[key] = ctrl.default;
    }
  }

  const req: RenderRequest = {
    type: "render",
    id: 1,
    compositionKey,
    is2d: is2DComposition(comp),
    width: 800,
    height: 800,
    resolvedValues,
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
    exportLayout: {
      contentW: LAYOUT.contentW,
      contentH: LAYOUT.contentH,
      scale: LAYOUT.scale,
    },
    showMesh: false,
    densityFilterEnabled: false,
    densityMax: 8,
    densityCellSize: 10,
  };

  return runPipeline(req);
}

describe("serializeRenderResult — layered results", () => {
  const groups: LayerGroupResult[] = [
    { id: "ground", name: "ground", color: "#1d4ed8", svgPaths: [PATH_A, PATH_C] },
    { id: "accent", name: "accent", color: "#dc2626", passes: 2, svgPaths: [PATH_B] },
  ];

  it("emits one Inkscape layer per layerGroup", () => {
    const svg = serializeRenderResult(
      { svgPaths: [PATH_A, PATH_C, PATH_B], layerGroups: groups },
      LAYOUT,
      MARGIN,
      STROKE,
    );
    expect(layerCount(svg)).toBe(groups.length);
    expect(svg).toContain(`xmlns:inkscape="${INKSCAPE_NS}"`);
    expect(svg).toContain('inkscape:label="1-ground"');
    expect(svg).toContain('inkscape:label="2-accent"');
    // Plot-time ink build-up survives the push.
    expect(svg).toContain('data-passes="2"');
  });

  it("matches buildLayeredSVGContent byte for byte", () => {
    const svg = serializeRenderResult(
      { svgPaths: [PATH_A, PATH_C, PATH_B], layerGroups: groups },
      LAYOUT,
      MARGIN,
      STROKE,
    );
    expect(svg).toBe(buildLayeredSVGContent(groups, LAYOUT, MARGIN, STROKE));
  });

  it("scales to any layer count", () => {
    const many: LayerGroupResult[] = Array.from({ length: 5 }, (_, i) => ({
      id: `pen${i}`,
      name: `pen${i}`,
      svgPaths: [PATH_A],
    }));
    const svg = serializeRenderResult({ svgPaths: [PATH_A], layerGroups: many }, LAYOUT, MARGIN, STROKE);
    expect(layerCount(svg)).toBe(5);
  });
});

describe("serializeRenderResult — flat results are unchanged", () => {
  const svgPaths = [PATH_A, PATH_B, PATH_C];

  it("is byte-identical to buildSVGContent when layerGroups is absent", () => {
    expect(serializeRenderResult({ svgPaths }, LAYOUT, MARGIN, STROKE)).toBe(
      buildSVGContent(svgPaths, LAYOUT, MARGIN, STROKE),
    );
  });

  it("is byte-identical to buildSVGContent when layerGroups is undefined", () => {
    expect(
      serializeRenderResult({ svgPaths, layerGroups: undefined }, LAYOUT, MARGIN, STROKE),
    ).toBe(buildSVGContent(svgPaths, LAYOUT, MARGIN, STROKE));
  });

  it("treats an empty layerGroups array as flat", () => {
    const svg = serializeRenderResult({ svgPaths, layerGroups: [] }, LAYOUT, MARGIN, STROKE);
    expect(svg).toBe(buildSVGContent(svgPaths, LAYOUT, MARGIN, STROKE));
    expect(svg).not.toContain("inkscape");
  });
});

describe("serializeRenderResult — real pipeline results", () => {
  it.each(["twoPenOffset", "phyllotaxisIsoblocks"])(
    "%s pushes as layers, not one flat group",
    (key) => {
      const result = pipelineResult(key);
      expect(result.layerGroups?.length ?? 0).toBeGreaterThan(0);

      const svg = serializeRenderResult(result, LAYOUT, MARGIN, STROKE);
      expect(layerCount(svg)).toBe(result.layerGroups!.length);
      expect(svg).toBe(buildLayeredSVGContent(result.layerGroups!, LAYOUT, MARGIN, STROKE));
    },
  );

  it("truchetMaze (non-layered) still serializes flat, byte for byte", () => {
    const result = pipelineResult("truchetMaze");
    expect(result.layerGroups?.length ?? 0).toBe(0);

    const svg = serializeRenderResult(result, LAYOUT, MARGIN, STROKE);
    expect(svg).toBe(buildSVGContent(result.svgPaths, LAYOUT, MARGIN, STROKE));
    expect(layerCount(svg)).toBe(0);
  });
});

describe("test hygiene", () => {
  it("never touches the network (AF-06)", () => {
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

/**
 * Importing a CLI must be inert. feed-push.ts used to parse process.argv, load
 * the whole composition registry and `process.exit(0)` on --help at *module
 * scope*, before the import.meta.url entry-point guard ever ran — so importing
 * it from a test could print usage and kill the runner, depending on the argv
 * it happened to see. All of that now lives inside main(); this pins it.
 */
describe("module import purity", () => {
  it("importing the module reads no argv, prints nothing and never exits", async () => {
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation(((code?: number) => {
        throw new Error(`process.exit(${code}) at import time`);
      }) as never);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const realArgv = process.argv;
    // argv that WOULD print usage and exit 0 if module scope still parsed it.
    // argv[1] is deliberately not this module, so the entry-point guard is false.
    process.argv = [realArgv[0], "/not/the/entry/point.ts", "--help", "--list-presets"];

    try {
      vi.resetModules();
      const first = await import("../../cli/feed-push");
      vi.resetModules();
      const second = await import("../../cli/feed-push");

      expect(typeof first.serializeRenderResult).toBe("function");
      expect(typeof second.serializeRenderResult).toBe("function");
      expect(exitSpy).not.toHaveBeenCalled();
      expect(logSpy).not.toHaveBeenCalled();
      expect(errorSpy).not.toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      process.argv = realArgv;
      exitSpy.mockRestore();
      logSpy.mockRestore();
      errorSpy.mockRestore();
      vi.resetModules();
    }
  });
});
