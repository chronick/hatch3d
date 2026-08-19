import { describe, it, expect } from "vitest";
import { analyzeSvg, parsePolyline, parseSvg } from "../stats/analyze.js";

/**
 * A hand-built fixture with exactly-known geometry so every reported field can
 * be checked against a value computed by hand.
 *
 * Page 100×100mm, margin clip 10..90 (80×80mm drawable). Transform is
 * translate(10,10) scale(2) — so path-space (0,0) maps to mm (10,10), and a
 * path-space length L becomes 2·L mm. stroke-width 0.25 in path-space → pen
 * width 0.5mm (0.25 × scale).
 *
 * Two layers:
 *  - "a" (#ff0000): one horizontal segment (0,0)→(20,0) path-space
 *      = mm (10,10)→(50,10), length 40mm.
 *  - "b" (#0000ff): one vertical segment (0,10)→(0,30) path-space
 *      = mm (10,30)→(10,70), length 40mm.
 */
const FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="100mm" viewBox="0 0 100 100">
  <defs>
    <clipPath id="margin-clip">
      <rect x="10" y="10" width="80" height="80"/>
    </clipPath>
  </defs>
  <g clip-path="url(#margin-clip)">
    <g transform="translate(10,10) scale(2)" fill="none" stroke="black" stroke-width="0.25" stroke-linecap="round">
      <g id="a" stroke="#ff0000">
        <path d="M0,0L20,0"/>
      </g>
      <g id="b" stroke="#0000ff">
        <path d="M0,10L0,30"/>
      </g>
    </g>
  </g>
</svg>`;

describe("parsePolyline", () => {
  it("parses M/L polylines into points", () => {
    expect(parsePolyline("M1,2L3,4L5,6")).toEqual([
      { x: 1, y: 2 },
      { x: 3, y: 4 },
      { x: 5, y: 6 },
    ]);
  });

  it("handles negative and decimal coordinates", () => {
    expect(parsePolyline("M-1.5,2.25L3,-4.75")).toEqual([
      { x: -1.5, y: 2.25 },
      { x: 3, y: -4.75 },
    ]);
  });

  it("throws a clear error on curve commands", () => {
    expect(() => parsePolyline("M0,0C1,1 2,2 3,3")).toThrow(/non-polyline command 'C'/);
    expect(() => parsePolyline("M0,0Q1,1 2,2")).toThrow(/non-polyline command 'Q'/);
    expect(() => parsePolyline("M0,0A1,1 0 0 1 2,2")).toThrow(/non-polyline command 'A'/);
  });

  it("rejects closepath explicitly", () => {
    expect(() => parsePolyline("M0,0L1,1Z")).toThrow(/closepath/);
  });
});

describe("parseSvg", () => {
  it("extracts page, drawable, scale, and layer grouping", () => {
    const p = parseSvg(FIXTURE);
    expect(p.page).toEqual({ widthMm: 100, heightMm: 100 });
    expect(p.drawable).toMatchObject({ xMm: 10, yMm: 10, widthMm: 80, heightMm: 80, areaMm2: 6400 });
    expect(p.scale).toBe(2);
    expect(p.strokeWidthAttr).toBe(0.25);
    expect(p.layers.map((l) => l.id)).toEqual(["a", "b"]);
    expect(p.layers.map((l) => l.stroke)).toEqual(["#ff0000", "#0000ff"]);
  });

  it("treats a single-group SVG as one default layer", () => {
    const single = FIXTURE.replace(/<g id="[ab]"[^>]*>/g, "").replace(/<\/g>\s*<\/g>\s*<\/g>/, "</g></g>");
    const p = parseSvg(single);
    expect(p.layers).toHaveLength(1);
    expect(p.layers[0].id).toBe("default");
  });
});

describe("analyzeSvg", () => {
  it("computes every top-level field from known geometry", () => {
    const r = analyzeSvg(FIXTURE, { grid: 4 });

    // Pen width recovered from SVG: 0.25 path-space × scale 2 = 0.5mm.
    expect(r.penWidthMm).toBe(0.5);
    expect(r.penWidthSource).toBe("svg");
    expect(r.scale).toBe(2);

    // Two 40mm segments, one vertex pair each.
    expect(r.totals.layers).toBe(2);
    expect(r.totals.paths).toBe(2);
    expect(r.totals.vertices).toBe(4);
    expect(r.totals.segments).toBe(2);
    expect(r.totals.arcLengthMm).toBe(80);

    // Pen-up: gap from path a's end (50,10) to path b's start (10,30) =
    // hypot(40, 20) = 44.721...
    expect(r.totals.penUpTravelMm).toBeCloseTo(44.72, 1);

    // Bounding box spans (10,10)→(50,70): 40mm × 60mm.
    expect(r.totals.boundingBox).toMatchObject({ xMm: 10, yMm: 10, widthMm: 40, heightMm: 60 });
    expect(r.totals.bboxCoverageRatio).toBeCloseTo((40 * 60) / 6400, 3);

    // Global ink density = arcLength × penWidth / drawableArea.
    expect(r.totals.inkDensity).toBeCloseTo((80 * 0.5) / 6400, 4);

    // No geometry leaves the drawable rect.
    expect(r.warnings.marginViolationPaths).toBe(0);
  });

  it("splits per-layer stats with stroke colors", () => {
    const r = analyzeSvg(FIXTURE, { grid: 4 });
    const a = r.layers.find((l) => l.id === "a")!;
    const b = r.layers.find((l) => l.id === "b")!;
    expect(a.stroke).toBe("#ff0000");
    expect(b.stroke).toBe("#0000ff");
    expect(a.arcLengthMm).toBe(40);
    expect(b.arcLengthMm).toBe(40);
    expect(a.paths).toBe(1);
    expect(b.paths).toBe(1);
  });

  it("produces a density grid of the requested resolution", () => {
    const r = analyzeSvg(FIXTURE, { grid: 4 });
    expect(r.densityGrid.cols).toBe(4);
    expect(r.densityGrid.rows).toBe(4);
    expect(r.densityGrid.cells).toHaveLength(4);
    expect(r.densityGrid.cells[0]).toHaveLength(4);
    // Ink is concentrated in a few cells → coefficient of variation > 0.
    expect(r.densityGrid.cv).toBeGreaterThan(0);
  });

  it("honors a pen-width override and flags saturation", () => {
    // A giant pen width forces the occupied cells past the saturation line.
    const r = analyzeSvg(FIXTURE, { grid: 4, penWidthMm: 100 });
    expect(r.penWidthSource).toBe("flag");
    expect(r.penWidthMm).toBe(100);
    expect(r.warnings.saturatedCells).toBeGreaterThan(0);
  });

  it("counts margin violations for geometry outside the drawable rect", () => {
    // Extend path a well past the right edge (path-space x=100 → mm x=210).
    const overflow = FIXTURE.replace('d="M0,0L20,0"', 'd="M0,0L100,0"');
    const r = analyzeSvg(overflow, { grid: 4 });
    expect(r.warnings.marginViolationPaths).toBe(1);
  });

  it("throws on curves rather than mis-measuring", () => {
    const curved = FIXTURE.replace('d="M0,0L20,0"', 'd="M0,0C1,1 2,2 3,3"');
    expect(() => analyzeSvg(curved)).toThrow(/non-polyline command 'C'/);
  });
});
