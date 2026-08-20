/**
 * Browser SVG download path (src/App.tsx → buildBrowserExportSVG).
 *
 * Regression guard for vault-3cw4u: the browser export used to build its own
 * inline layered body — nested <g> groups with no inkscape namespace,
 * groupmode, label or data-passes — so vpype's `read_multilayer_svg` collapsed
 * every browser download to a single layer. It now delegates to the shared
 * serializer in src/scene/svg-output.ts, the same one the CLI uses.
 *
 * The browser bakes the page transform into the path data (clipSVGPath) before
 * serializing, so the shared builder is called under an identity layout; these
 * tests pin both the layer convention and that baking.
 */
import { createHash } from "node:crypto";
import { describe, it, expect, vi } from "vitest";

// App.tsx reads persisted state at module load (`const INITIAL = loadState()`),
// and this environment's global `localStorage` is only a partial shim. Install
// a real in-memory one *before* the App import runs (vi.hoisted is hoisted
// above imports).
vi.hoisted(() => {
  const store = new Map<string, string>();
  const shim: Storage = {
    get length() {
      return store.size;
    },
    key: (i: number) => [...store.keys()][i] ?? null,
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  };
  Object.defineProperty(globalThis, "localStorage", {
    value: shim,
    writable: true,
    configurable: true,
  });
});

import { buildBrowserExportSVG } from "../App";
import { buildLayeredSVGContent, INKSCAPE_NS, type ExportLayout } from "../scene/svg-output";
import { clipSVGPath, type Rect } from "../utils/clip";
import type { LayerGroupResult } from "../workers/render-worker.types";

const WIDTH = 800;
const HEIGHT = 800;
const MARGIN = 15;
const STROKE = 0.5;

/** A3 landscape, the app's default export page. */
function layoutFor(margin = MARGIN): ExportLayout {
  const pageW = 420;
  const pageH = 297;
  const contentW = pageW - margin * 2;
  const contentH = pageH - margin * 2;
  const scale = Math.min(contentW / WIDTH, contentH / HEIGHT);
  return {
    pageW,
    pageH,
    contentW,
    contentH,
    scale,
    cx: margin + (contentW - WIDTH * scale) / 2,
    cy: margin + (contentH - HEIGHT * scale) / 2,
  };
}

const LAYOUT = layoutFor();

// Viewport-px paths, comfortably inside the clip rect.
const PATH_A = "M 100 100 L 400 400 L 700 100";
const PATH_B = "M 200 600 L 600 600";
const PATH_C = "M 400 100 L 400 700";

function clipRectFor(layout: ExportLayout, margin: number, clipInset: number): Rect {
  return {
    xMin: margin + clipInset,
    yMin: margin + clipInset,
    xMax: margin + layout.contentW - clipInset,
    yMax: margin + layout.contentH - clipInset,
  };
}

/** Reproduce the browser's page-mm baking, independent of App.tsx internals. */
function bake(
  groups: LayerGroupResult[],
  layout: ExportLayout,
  margin: number,
  clipInset: number,
): LayerGroupResult[] {
  const transform = { cx: layout.cx, cy: layout.cy, scale: layout.scale };
  const rect = clipRectFor(layout, margin, clipInset);
  return groups
    .map((g) => ({
      ...g,
      svgPaths: g.svgPaths.flatMap((d) => clipSVGPath(d, transform, rect)),
      dash: g.dash
        ? ([
            Number((g.dash[0] * layout.scale).toFixed(2)),
            Number((g.dash[1] * layout.scale).toFixed(2)),
          ] as [number, number])
        : undefined,
    }))
    .filter((g) => g.svgPaths.length > 0);
}

/** The identity layout the browser hands the shared serializer post-baking. */
function bakedLayout(layout: ExportLayout, clipInset: number): ExportLayout {
  return {
    ...layout,
    contentW: layout.contentW - clipInset * 2,
    contentH: layout.contentH - clipInset * 2,
    scale: 1,
    cx: 0,
    cy: 0,
  };
}

function exportLayered(
  layerGroups: LayerGroupResult[],
  opts: { margin?: number; clipInset?: number; borderPaths?: string[] } = {},
): string {
  const margin = opts.margin ?? MARGIN;
  return buildBrowserExportSVG({
    svgPaths: [],
    layerGroups,
    layout: layoutFor(margin),
    margin,
    clipInset: opts.clipInset ?? 0,
    strokeWidth: STROKE,
    borderPaths: opts.borderPaths ?? [],
  });
}

const GROUPS: LayerGroupResult[] = [
  { id: "flowField", name: "ground", color: "#1d4ed8", svgPaths: [PATH_A] },
  { id: "spirograph", name: "overlay", color: "#dc2626", passes: 2, svgPaths: [PATH_B] },
];

describe("browser layered export — Inkscape layer convention", () => {
  it("declares the inkscape namespace on the root svg element", () => {
    const svg = exportLayered(GROUPS);
    expect(svg).toContain(`xmlns:inkscape="${INKSCAPE_NS}"`);
  });

  it("marks every layer group with inkscape:groupmode=\"layer\"", () => {
    expect(exportLayered(GROUPS).match(/inkscape:groupmode="layer"/g)).toHaveLength(2);
  });

  it("emits layer groups as top-level children of <svg> (vpype --multilayer)", () => {
    // vpype's read_multilayer_svg only treats *top-level* groups as layers;
    // the old nested-group body collapsed to one.
    const lines = exportLayered(GROUPS).split("\n");
    const layerLines = lines.filter((l) => l.includes("inkscape:groupmode"));
    expect(layerLines).toHaveLength(2);
    for (const line of layerLines) expect(line.startsWith("  <g ")).toBe(true);
  });

  it("labels layers with sequential 1-based numbers", () => {
    const labels = [...exportLayered(GROUPS).matchAll(/inkscape:label="([^"]*)"/g)].map(
      (m) => m[1],
    );
    expect(labels).toEqual(["1-ground", "2-overlay"]);
  });

  it("numbers labels sequentially over surviving layers when one clips away", () => {
    const offscreen: LayerGroupResult = {
      id: "gone",
      name: "empty",
      // Far outside the page: clips to nothing.
      svgPaths: ["M 100000 100000 L 100100 100100"],
    };
    const labels = [
      ...exportLayered([GROUPS[0], offscreen, GROUPS[1]]).matchAll(
        /inkscape:label="([^"]*)"/g,
      ),
    ].map((m) => m[1]);
    expect(labels).toEqual(["1-ground", "2-overlay"]);
  });

  it("emits data-passes only for layers that set it", () => {
    expect(exportLayered(GROUPS).match(/data-passes="[^"]*"/g)).toEqual(['data-passes="2"']);
    expect(exportLayered([GROUPS[0]])).not.toContain("data-passes");
  });

  it("keeps per-layer stroke colors and layer-name ids", () => {
    const svg = exportLayered(GROUPS);
    expect(svg).toContain('stroke="#1d4ed8"');
    expect(svg).toContain('stroke="#dc2626"');
    expect(svg).toContain('id="ground"');
    expect(svg).toContain('id="overlay"');
  });

  it("does not duplicate paths for multi-pass layers", () => {
    const svg = exportLayered([{ ...GROUPS[1], passes: 3 }]);
    expect(svg.match(/<path /g)).toHaveLength(1);
  });
});

describe("browser layered export — matches the shared serializer", () => {
  const cases: Array<{ name: string; groups: LayerGroupResult[]; clipInset: number }> = [
    { name: "plain two-pen", groups: GROUPS, clipInset: 0 },
    {
      name: "styled layers (width/dash/opacity/passes)",
      groups: [
        { id: "a", name: "ground", color: "#1d4ed8", widthScale: 2, svgPaths: [PATH_A] },
        { id: "b", name: "ghost", dash: [6, 4], opacity: 0.4, svgPaths: [PATH_B, PATH_C] },
        { id: "c", name: 'pen "one" & <two>', passes: 3, svgPaths: [PATH_C] },
      ],
      clipInset: 0,
    },
    { name: "double-border clip inset", groups: GROUPS, clipInset: 2 },
    {
      name: "unnamed layers (color / penN label fallback)",
      groups: [
        { id: "a", color: "#0f766e", svgPaths: [PATH_A] },
        { id: "b", svgPaths: [PATH_B] },
      ],
      clipInset: 0,
    },
  ];

  for (const { name, groups, clipInset } of cases) {
    it(`is byte-identical to buildLayeredSVGContent for ${name}`, () => {
      const direct = buildLayeredSVGContent(
        bake(groups, LAYOUT, MARGIN, clipInset),
        bakedLayout(LAYOUT, clipInset),
        MARGIN + clipInset,
        STROKE,
      );
      expect(exportLayered(groups, { clipInset })).toBe(direct);
    });
  }

  it("produces the same layer attribute set as the CLI for the same layer metadata", () => {
    const openTags = (svg: string) => svg.match(/<g inkscape:groupmode="layer"[^>]*>/g) ?? [];
    const cliSvg = buildLayeredSVGContent(GROUPS, LAYOUT, MARGIN, STROKE);
    expect(openTags(exportLayered(GROUPS))).toEqual(openTags(cliSvg));
  });
});

/**
 * The border used to be spliced into the serialized layered SVG as an
 * anonymous top-level <g> just before </svg>. vpype imports every top-level
 * group as a layer, so an N-pen bordered export grew a phantom *unlabelled*
 * layer N+1, and Inkscape didn't see it as a layer at all. It now goes through
 * the shared serializer as a real labelled layer group. These assertions are
 * structural — nothing here may depend on where a substring sits in the string.
 */
describe("browser layered export — preview border is a real layer", () => {
  const BORDER = ["M 15 15 L 405 15", "M 405 15 L 405 282"];

  /** Every top-level (2-space indented) group open tag, in document order. */
  function topLevelGroupTags(svg: string): string[] {
    return svg.split("\n").filter((l) => /^ {2}<g[ >]/.test(l));
  }

  /** The full source block of the top-level group carrying `label`. */
  function groupBlock(svg: string, label: string): string {
    const lines = svg.split("\n");
    const start = lines.findIndex((l) => l.includes(`inkscape:label="${label}"`));
    expect(start).toBeGreaterThanOrEqual(0);
    const end = lines.findIndex((l, i) => i > start && l === "  </g>");
    return lines.slice(start, end + 1).join("\n");
  }

  it("emits no unlabelled top-level groups (no phantom vpype layer)", () => {
    const svg = exportLayered(GROUPS, { borderPaths: BORDER });
    const tags = topLevelGroupTags(svg);
    expect(tags).toHaveLength(3);
    for (const tag of tags) {
      expect(tag).toContain('inkscape:groupmode="layer"');
      expect(tag).toMatch(/inkscape:label="[^"]+"/);
    }
  });

  it("labels the border as the layer after the pens (N+1-border)", () => {
    const labels = [
      ...exportLayered(GROUPS, { borderPaths: BORDER }).matchAll(
        /inkscape:label="([^"]*)"/g,
      ),
    ].map((m) => m[1]);
    expect(labels).toEqual(["1-ground", "2-overlay", "3-border"]);
  });

  it("numbers the border over surviving pen layers when one clips away", () => {
    const offscreen: LayerGroupResult = {
      id: "gone",
      name: "empty",
      svgPaths: ["M 100000 100000 L 100100 100100"],
    };
    const labels = [
      ...exportLayered([GROUPS[0], offscreen], { borderPaths: BORDER }).matchAll(
        /inkscape:label="([^"]*)"/g,
      ),
    ].map((m) => m[1]);
    expect(labels).toEqual(["1-ground", "2-border"]);
  });

  it("gives the border layer group the border attrs and paths, unclipped", () => {
    const block = groupBlock(exportLayered(GROUPS, { borderPaths: BORDER }), "3-border");
    expect(block).toContain('id="border"');
    expect(block).toContain('stroke="black"');
    expect(block).toContain(`stroke-width="${STROKE.toFixed(4)}"`);
    expect(block).not.toContain("data-passes");
    // The border rect sits *on* the margin edge (and ticks/cropmarks reach
    // past it), so it must not inherit the pen layers' margin clip.
    expect(block).not.toContain("clip-path");
    expect(block.match(/<path d="[^"]*"\/>/g)).toEqual(
      BORDER.map((d) => `<path d="${d}"/>`),
    );
  });

  it("is byte-identical to buildLayeredSVGContent with the border as an extra group", () => {
    const direct = buildLayeredSVGContent(
      bake(GROUPS, LAYOUT, MARGIN, 0),
      bakedLayout(LAYOUT, 0),
      MARGIN,
      STROKE,
      [{ id: "border", name: "border", svgPaths: BORDER }],
    );
    expect(exportLayered(GROUPS, { borderPaths: BORDER })).toBe(direct);
  });

  it("leaves the pen layer groups byte-identical to the borderless export", () => {
    const penBlocks = (svg: string) =>
      ["1-ground", "2-overlay"].map((label) => groupBlock(svg, label));
    expect(penBlocks(exportLayered(GROUPS, { borderPaths: BORDER }))).toEqual(
      penBlocks(exportLayered(GROUPS)),
    );
  });

  it("adds nothing at all when the border is off", () => {
    expect(topLevelGroupTags(exportLayered(GROUPS))).toHaveLength(2);
    expect(exportLayered(GROUPS)).not.toContain("border");
  });
});

/**
 * Byte-for-byte pins captured *before* the border-layer fix (vault border
 * finding), so that refactor could only ever change the bordered output.
 * A digest change here means borderless layered output or the flat export
 * moved — which the border fix must never do.
 */
describe("browser export — pre-border-fix output digests", () => {
  const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

  it("borderless layered export is unchanged", () => {
    expect(sha(exportLayered(GROUPS))).toBe("4dfbc13674cbdfcb261abeeda634b073e250f3a249d7d9e6dabb6381ef9fccb9");
  });

  it("borderless layered export with clip inset is unchanged", () => {
    expect(sha(exportLayered(GROUPS, { clipInset: 2 }))).toBe("304518c03eb96168d394e7079af3ee0cfedd6db39e418739dff503e4a179f359");
  });

  it("flat (non-layered) export with a border is unchanged", () => {
    const svg = buildBrowserExportSVG({
      svgPaths: [PATH_A, PATH_B, PATH_C],
      layerGroups: undefined,
      layout: LAYOUT,
      margin: MARGIN,
      clipInset: 0,
      strokeWidth: STROKE,
      borderPaths: ["M 15 15 L 405 15", "M 405 15 L 405 282"],
    });
    expect(sha(svg)).toBe("2580fd033c18d89d61e9dd4fad44a12794f88ba1a1b75378760d9e2bc203b66e");
  });
});

describe("browser non-layered export — unchanged", () => {
  function exportFlat(borderPaths: string[] = [], clipInset = 0): string {
    return buildBrowserExportSVG({
      svgPaths: [PATH_A, PATH_B, PATH_C],
      layerGroups: undefined,
      layout: LAYOUT,
      margin: MARGIN,
      clipInset,
      strokeWidth: STROKE,
      borderPaths,
    });
  }

  /** The pre-refactor template, reproduced verbatim. */
  function legacyFlat(borderPaths: string[], clipInset: number): string {
    const { pageW, pageH, cx, cy, scale } = LAYOUT;
    const clipped = [PATH_A, PATH_B, PATH_C].flatMap((d) =>
      clipSVGPath(d, { cx, cy, scale }, clipRectFor(LAYOUT, MARGIN, clipInset)),
    );
    const body = `    ${clipped.map((d) => `<path d="${d}"/>`).join("\n    ")}`;
    const border =
      borderPaths.length > 0
        ? `\n  <g fill="none" stroke="black" stroke-width="${STROKE}" stroke-linecap="round" stroke-linejoin="round">\n    ${borderPaths
            .map((d) => `<path d="${d}"/>`)
            .join("\n    ")}\n  </g>`
        : "";
    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${pageW}mm" height="${pageH}mm" viewBox="0 0 ${pageW} ${pageH}">
  <g fill="none" stroke="black" stroke-width="${STROKE}" stroke-linecap="round" stroke-linejoin="round">
${body}
  </g>${border}
</svg>`;
  }

  it("is byte-identical to the pre-refactor template", () => {
    expect(exportFlat()).toBe(legacyFlat([], 0));
    expect(exportFlat(["M 15 15 L 405 15"])).toBe(legacyFlat(["M 15 15 L 405 15"], 0));
    expect(exportFlat([], 2)).toBe(legacyFlat([], 2));
  });

  it("carries no inkscape layer markup", () => {
    const svg = exportFlat();
    expect(svg).not.toContain("inkscape");
    expect(svg).toContain('<svg xmlns="http://www.w3.org/2000/svg" width="420mm"');
  });

  it("treats an empty layerGroups array as non-layered", () => {
    expect(
      buildBrowserExportSVG({
        svgPaths: [PATH_A, PATH_B, PATH_C],
        layerGroups: [],
        layout: LAYOUT,
        margin: MARGIN,
        clipInset: 0,
        strokeWidth: STROKE,
        borderPaths: [],
      }),
    ).toBe(legacyFlat([], 0));
  });
});
