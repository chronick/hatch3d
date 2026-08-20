import { describe, it, expect, vi } from "vitest";
import { analyzeSvg } from "../stats/analyze.js";
import {
  BALANCE_THRESHOLDS,
  balanceLabel,
  buildReportModel,
  fmtMm,
  fmtNum,
  fmtPercent,
  heatShade,
} from "../inksight/report.js";

/**
 * Same hand-built geometry as stats.test.ts: page 100×100mm, drawable 80×80mm
 * at (10,10), transform translate(10,10) scale(2), pen width 0.5mm. Two layers
 * of one 40mm segment each, so every rendered figure is checkable by hand.
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

function lightness(color: string): number {
  const m = color.match(/hsl\(\d+ \d+% ([\d.]+)%\)/);
  if (!m) throw new Error(`not an hsl() ramp color: ${color}`);
  return Number(m[1]);
}

describe("formatting", () => {
  it("groups thousands and trims trailing zeros", () => {
    expect(fmtNum(1234.5)).toBe("1,234.5");
    expect(fmtNum(1234567, 0)).toBe("1,234,567");
    expect(fmtNum(2)).toBe("2");
    expect(fmtNum(0.125, 3)).toBe("0.125");
  });

  it("renders mm and percentages", () => {
    expect(fmtMm(80)).toBe("80 mm");
    expect(fmtPercent(0.375)).toBe("37.5%");
    expect(fmtPercent(0.00625, 2)).toBe("0.63%");
  });

  it("returns a placeholder for non-finite input", () => {
    expect(fmtNum(Number.NaN)).toBe("—");
    expect(fmtPercent(Number.POSITIVE_INFINITY)).toBe("—");
  });
});

describe("heatShade", () => {
  it("ramps lightness monotonically with coverage", () => {
    const low = lightness(heatShade(0, 1));
    const mid = lightness(heatShade(0.5, 1));
    const high = lightness(heatShade(1, 1));
    expect(low).toBeLessThan(mid);
    expect(mid).toBeLessThan(high);
  });

  it("clamps out-of-range coverage and handles an empty grid", () => {
    expect(heatShade(5, 1)).toBe(heatShade(1, 1));
    expect(heatShade(-1, 1)).toBe(heatShade(0, 1));
    expect(heatShade(0, 0)).toBe(heatShade(0, 1));
  });
});

describe("balanceLabel", () => {
  it("bands the coefficient of variation", () => {
    expect(balanceLabel(BALANCE_THRESHOLDS.even - 0.1)).toBe("even");
    expect(balanceLabel(1)).toBe("uneven");
    expect(balanceLabel(BALANCE_THRESHOLDS.clumped + 0.1)).toBe("clumped");
  });
});

describe("buildReportModel", () => {
  const model = buildReportModel(analyzeSvg(FIXTURE, { grid: 4 }));

  it("summarizes the page and the pen-width provenance", () => {
    const rows = Object.fromEntries(model.summary.map((r) => [r.label, r.value]));
    expect(rows.page).toBe("100 × 100 mm");
    expect(rows.drawable).toBe("80 × 80 mm at (10, 10)");
    expect(rows["pen width"]).toBe("0.5 mm (svg)");
  });

  it("formats totals off the analyzer's numbers", () => {
    const rows = Object.fromEntries(model.totals.map((r) => [r.label, r.value]));
    expect(rows.paths).toBe("2");
    expect(rows.vertices).toBe("4");
    expect(rows["arc length"]).toBe("80 mm");
    // 80mm drawn, 44.72mm pen-up → 55.9% of drawn.
    expect(rows["pen-up travel"]).toBe("44.7 mm (55.9% of drawn)");
    expect(rows["bounding box"]).toBe("40 × 60 mm");
    // 80mm × 0.5mm pen / 6400mm² drawable = 0.625%.
    expect(rows["ink density"]).toBe("0.63%");
  });

  it("carries per-layer stroke colors through as swatches", () => {
    expect(model.layers.map((l) => l.id)).toEqual(["a", "b"]);
    expect(model.layers.map((l) => l.swatch)).toEqual(["#ff0000", "#0000ff"]);
    expect(model.layers[0].arcLength).toBe("40 mm");
  });

  it("falls back to black for a layer with no declared stroke", () => {
    const single = FIXTURE.replace(/<g id="[ab]"[^>]*>/g, "").replace(/<\/g>\s*<\/g>\s*<\/g>/, "</g></g>");
    const m = buildReportModel(analyzeSvg(single, { grid: 4 }));
    expect(m.layers).toHaveLength(1);
    expect(m.layers[0].stroke).toBeNull();
    expect(m.layers[0].swatch).toBe("#000000");
  });

  it("flattens the density grid into shaded cells", () => {
    expect(model.heatmap.cols).toBe(4);
    expect(model.heatmap.cells).toHaveLength(16);
    expect(model.heatmap.cells[0]).toMatchObject({ row: 0, col: 0 });
    for (const cell of model.heatmap.cells) {
      expect(cell.shade).toMatch(/^hsl\(/);
      expect(cell.title).toContain("%");
    }
    expect(model.heatmap.stats.map((s) => s.label)).toEqual(["max", "mean", "cv"]);
  });

  it("reports clean warnings for in-bounds, unsaturated geometry", () => {
    const margin = model.warnings[0];
    const saturation = model.warnings[1];
    expect(margin.level).toBe("ok");
    expect(saturation.level).toBe("ok");
  });

  it("escalates warnings for overflowing and saturated geometry", () => {
    const overflow = FIXTURE.replace('d="M0,0L20,0"', 'd="M0,0L100,0"');
    const m = buildReportModel(analyzeSvg(overflow, { grid: 4, penWidthMm: 100 }));
    expect(m.warnings[0]).toMatchObject({ level: "warn" });
    expect(m.warnings[0].text).toContain("margin clip");
    expect(m.warnings[1]).toMatchObject({ level: "warn" });
    expect(m.warnings[1].text).toContain("solid ink");
  });
});

/**
 * End-to-end through the page module: main.ts binds to elements at import time
 * and its render path is the only place the view-model meets the DOM, so the
 * module is (re)imported against a fresh document per case.
 */
async function bootPage(): Promise<HTMLElement> {
  document.body.innerHTML =
    '<div id="drop"></div><input type="file" id="file"><div id="output" hidden></div>';
  URL.createObjectURL = vi.fn(() => "blob:inksight-test");
  URL.revokeObjectURL = vi.fn();
  vi.resetModules();
  await import("../inksight/main.js");
  return document.getElementById("output")!;
}

async function dropFile(name: string, text: string): Promise<void> {
  const input = document.getElementById("file") as HTMLInputElement;
  Object.defineProperty(input, "files", {
    configurable: true,
    value: [{ name, text: () => Promise.resolve(text) } as unknown as File],
  });
  input.dispatchEvent(new Event("change"));
  await Promise.resolve();
  await Promise.resolve();
}

describe("inksight page", () => {
  it("renders the full report for a hatch3d SVG", async () => {
    const out = await bootPage();
    await dropFile("t.svg", FIXTURE);

    expect(out.hidden).toBe(false);
    expect(out.textContent).toContain("80 mm");
    expect(out.textContent).toContain("0.5 mm (svg)");
    // 8×8 is the analyzer default grid.
    expect(out.querySelector(".heat")!.children).toHaveLength(64);
    expect(out.querySelectorAll("tbody tr")).not.toHaveLength(0);
    expect(out.querySelector("pre")!.textContent).toContain('"arcLengthMm": 80');
    // The dropped markup only ever reaches the page as an object-URL image.
    expect(out.querySelector("img")!.src).toBe("blob:inksight-test");
    expect(out.querySelector("svg")).toBeNull();
  });

  it("shows the analyzer error and the scope note for a non-hatch3d SVG", async () => {
    const out = await bootPage();
    await dropFile("bad.svg", '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0,0C1,1 2,2 3,3"/></svg>');

    expect(out.textContent).toContain("no viewBox");
    expect(out.textContent).toContain("InkSight v1 measures hatch3d-exporter SVGs");
    // The thumbnail is still offered so the file can be eyeballed.
    expect(out.querySelector("img")).not.toBeNull();
    expect(out.querySelector("pre")).toBeNull();
  });
});
