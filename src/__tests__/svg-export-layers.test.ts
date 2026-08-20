import { describe, it, expect } from "vitest";
import {
  buildLayeredSVGContent,
  buildSVGContent,
  computeExportLayout,
  INKSCAPE_NS,
} from "../../cli/svg-export";
import type { LayerGroupResult } from "../workers/render-worker.types";
import twoPenOffset from "../compositions/layered/demos/two-pen-offset";

const LAYOUT = computeExportLayout("a3", "landscape", 15, 800, 800);
const MARGIN = 15;
const STROKE = 0.5;

const PATH_A = "M 10 10 L 20 20 L 30 10";
const PATH_B = "M 40 40 L 50 50";
const PATH_C = "M 60 10 L 60 90";

function build(groups: LayerGroupResult[]): string {
  return buildLayeredSVGContent(groups, LAYOUT, MARGIN, STROKE);
}

/** Every `<path d="..."/>` element in document order, trimmed of indentation. */
function pathElements(svg: string): string[] {
  return svg.match(/<path d="[^"]*"\/>/g) ?? [];
}

describe("buildLayeredSVGContent — Inkscape layer convention", () => {
  const groups: LayerGroupResult[] = [
    { id: "flowField", name: "ground", color: "#1d4ed8", svgPaths: [PATH_A] },
    { id: "spirograph", name: "overlay", color: "#dc2626", passes: 2, svgPaths: [PATH_B] },
  ];

  it("declares the inkscape namespace on the root svg element", () => {
    const svg = build(groups);
    expect(svg).toContain(`xmlns:inkscape="${INKSCAPE_NS}"`);
    expect(INKSCAPE_NS).toBe("http://www.inkscape.org/namespaces/inkscape");
  });

  it("marks every layer group with inkscape:groupmode=\"layer\"", () => {
    const svg = build(groups);
    expect(svg.match(/inkscape:groupmode="layer"/g)).toHaveLength(2);
  });

  it("labels layers with sequential 1-based numbers", () => {
    const svg = build(groups);
    const labels = [...svg.matchAll(/inkscape:label="([^"]*)"/g)].map((m) => m[1]);
    expect(labels).toEqual(["1-ground", "2-overlay"]);
  });

  it("emits layer groups as top-level children of <svg> (vpype --multilayer)", () => {
    const svg = build(groups);
    // vpype's read_multilayer_svg treats each *top-level* group as a layer.
    for (const line of svg.split("\n")) {
      if (line.includes("inkscape:groupmode")) {
        expect(line.startsWith("  <g ")).toBe(true);
      }
    }
  });

  it("keeps per-layer stroke colors", () => {
    const svg = build(groups);
    expect(svg).toContain('stroke="#1d4ed8"');
    expect(svg).toContain('stroke="#dc2626"');
  });

  it("keeps the layer name as the group id", () => {
    const svg = build(groups);
    expect(svg).toContain('id="ground"');
    expect(svg).toContain('id="overlay"');
  });

  it("emits data-passes only for layers that set passes", () => {
    const svg = build(groups);
    expect(svg.match(/data-passes="[^"]*"/g)).toEqual(['data-passes="2"']);
  });

  it("omits data-passes entirely when no layer sets it", () => {
    const svg = build([
      { id: "flowField", name: "ground", color: "#1d4ed8", svgPaths: [PATH_A] },
    ]);
    expect(svg).not.toContain("data-passes");
  });

  it("does not duplicate paths for multi-pass layers", () => {
    const svg = build([
      { id: "spirograph", name: "overlay", color: "#dc2626", passes: 3, svgPaths: [PATH_B] },
    ]);
    expect(pathElements(svg)).toEqual([`<path d="${PATH_B}"/>`]);
  });

  it("falls back to color then penN for the label body", () => {
    const svg = build([
      { id: "a", color: "#0f766e", svgPaths: [PATH_A] },
      { id: "b", svgPaths: [PATH_B] },
    ]);
    const labels = [...svg.matchAll(/inkscape:label="([^"]*)"/g)].map((m) => m[1]);
    expect(labels).toEqual(["1-#0f766e", "2-pen2"]);
    // Unnamed layers keep the legacy positional id.
    expect(svg).toContain('id="layer-1"');
  });

  it("escapes names and colors used in attributes", () => {
    const svg = build([{ id: "a", name: 'pen "one" & <two>', svgPaths: [PATH_A] }]);
    expect(svg).toContain('inkscape:label="1-pen &quot;one&quot; &amp; &lt;two>"');
    expect(svg).not.toContain('label="1-pen "one"');
  });
});

describe("buildLayeredSVGContent — path payload is unchanged", () => {
  it("emits path elements byte-identical to the input d strings", () => {
    const groups: LayerGroupResult[] = [
      { id: "a", name: "one", color: "#1d4ed8", svgPaths: [PATH_A, PATH_B] },
      { id: "b", name: "two", color: "#dc2626", passes: 2, svgPaths: [PATH_C] },
    ];
    expect(pathElements(build(groups))).toEqual([
      `<path d="${PATH_A}"/>`,
      `<path d="${PATH_B}"/>`,
      `<path d="${PATH_C}"/>`,
    ]);
  });

  it("a single metadata-free layer emits the same paths as the single-layer exporter", () => {
    const paths = [PATH_A, PATH_B, PATH_C];
    const single = buildSVGContent(paths, LAYOUT, MARGIN, STROKE);
    const layered = build([{ id: "a", svgPaths: paths }]);
    expect(pathElements(layered)).toEqual(pathElements(single));
    // Same page setup, clip and transform group as the single-layer path.
    expect(layered).toContain(`viewBox="0 0 ${LAYOUT.pageW} ${LAYOUT.pageH}"`);
    expect(layered).toContain('clip-path="url(#margin-clip)"');
    expect(layered).toContain(
      `transform="translate(${LAYOUT.cx},${LAYOUT.cy}) scale(${LAYOUT.scale})"`,
    );
    // Colorless layers keep the previous black default.
    expect(layered).toContain('stroke="black"');
  });
});

describe("buildLayeredSVGContent — extraGroups (unclipped trailing layers)", () => {
  const groups: LayerGroupResult[] = [
    { id: "flowField", name: "ground", color: "#1d4ed8", svgPaths: [PATH_A] },
    { id: "spirograph", name: "overlay", color: "#dc2626", svgPaths: [PATH_B] },
  ];
  const extra: LayerGroupResult[] = [{ id: "border", name: "border", svgPaths: [PATH_C] }];

  /** The full source block of the top-level group carrying `label`. */
  function groupBlock(svg: string, label: string): string {
    const lines = svg.split("\n");
    const start = lines.findIndex((l) => l.includes(`inkscape:label="${label}"`));
    expect(start).toBeGreaterThanOrEqual(0);
    const end = lines.findIndex((l, i) => i > start && l === "  </g>");
    return lines.slice(start, end + 1).join("\n");
  }

  it("is optional — the CLI's 4-arg call is unchanged", () => {
    // The CLI never passes extraGroups; the default must be a no-op.
    expect(buildLayeredSVGContent(groups, LAYOUT, MARGIN, STROKE)).toBe(
      buildLayeredSVGContent(groups, LAYOUT, MARGIN, STROKE, []),
    );
  });

  it("numbers extra groups continuing the pen-layer sequence", () => {
    const svg = buildLayeredSVGContent(groups, LAYOUT, MARGIN, STROKE, extra);
    const labels = [...svg.matchAll(/inkscape:label="([^"]*)"/g)].map((m) => m[1]);
    expect(labels).toEqual(["1-ground", "2-overlay", "3-border"]);
  });

  it("emits them as labelled top-level layer groups, never anonymous", () => {
    const svg = buildLayeredSVGContent(groups, LAYOUT, MARGIN, STROKE, extra);
    const topLevel = svg.split("\n").filter((l) => /^ {2}<g[ >]/.test(l));
    expect(topLevel).toHaveLength(3);
    for (const tag of topLevel) expect(tag).toContain('inkscape:groupmode="layer"');
  });

  it("omits the margin clip on extra groups but keeps it on pen layers", () => {
    const svg = buildLayeredSVGContent(groups, LAYOUT, MARGIN, STROKE, extra);
    expect(groupBlock(svg, "3-border")).not.toContain("clip-path");
    expect(groupBlock(svg, "1-ground")).toContain('clip-path="url(#margin-clip)"');
  });

  it("leaves the pen layer groups byte-identical", () => {
    const withExtra = buildLayeredSVGContent(groups, LAYOUT, MARGIN, STROKE, extra);
    const without = buildLayeredSVGContent(groups, LAYOUT, MARGIN, STROKE);
    for (const label of ["1-ground", "2-overlay"]) {
      expect(groupBlock(withExtra, label)).toBe(groupBlock(without, label));
    }
  });
});

describe("twoPenOffset demo composition", () => {
  it("is a valid layered definition", () => {
    expect(twoPenOffset.id).toBe("twoPenOffset");
    expect(twoPenOffset.type).toBe("layered");
    expect(twoPenOffset.category).toBe("layered");
    expect(twoPenOffset.layers).toHaveLength(2);
  });

  it("uses two distinct pen colors", () => {
    const colors = twoPenOffset.layers.map((l) => l.color);
    expect(colors).toEqual(["#1d4ed8", "#dc2626"]);
    expect(new Set(colors).size).toBe(2);
  });

  it("offsets the second layer and gives it two passes", () => {
    const [first, second] = twoPenOffset.layers;
    expect(first.passes).toBeUndefined();
    expect(second.passes).toBe(2);
    expect(second.transform).toBeDefined();
    expect(second.transform?.tx).not.toBe(0);
  });

  it("round-trips through the exporter with labels, colors and passes", () => {
    const svg = build(
      twoPenOffset.layers.map((l) => ({
        id: l.composition,
        name: l.name,
        color: l.color,
        passes: l.passes,
        svgPaths: [PATH_A],
      })),
    );
    expect(svg).toContain('inkscape:label="1-ground"');
    expect(svg).toContain('inkscape:label="2-overlay"');
    expect(svg).toContain('stroke="#1d4ed8"');
    expect(svg).toContain('stroke="#dc2626"');
    expect(svg.match(/data-passes="[^"]*"/g)).toEqual(['data-passes="2"']);
  });
});
