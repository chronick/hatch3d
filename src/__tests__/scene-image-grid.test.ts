import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PNG } from "pngjs";
import { loadBrightness } from "../../cli/load-image";
import { luminanceGridFromRGBA, sceneImageRefs, gridImageResolver } from "../scene/image-grid";
import { parseSceneDoc } from "../scene/schema";
import { renderSceneToSVG } from "../scene/render-scene";

/** RGBA bytes for a 3×2 image with a distinct value per pixel (row-major). */
function fixtureRGBA(): { data: Uint8ClampedArray; width: number; height: number } {
  const width = 3;
  const height = 2;
  const px: [number, number, number][] = [
    [255, 0, 0], [0, 255, 0], [0, 0, 255],   // top row
    [0, 0, 0], [255, 255, 255], [10, 200, 90], // bottom row
  ];
  const data = new Uint8ClampedArray(width * height * 4);
  px.forEach(([r, g, b], i) => {
    data[i * 4] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = 255;
  });
  return { data, width, height };
}

describe("luminanceGridFromRGBA — matches cli/load-image.ts", () => {
  it("produces the same grid the PNG decoder does, same orientation", () => {
    const { data, width, height } = fixtureRGBA();

    // The same pixels, through the CLI's pngjs path.
    const png = new PNG({ width, height });
    png.data = Buffer.from(data);
    const path = join(mkdtempSync(join(tmpdir(), "hatch3d-img-")), "fixture.png");
    writeFileSync(path, PNG.sync.write(png));
    const viaPng = loadBrightness(path);

    const viaCanvas = luminanceGridFromRGBA(data, width, height);

    expect(viaCanvas.width).toBe(viaPng.width);
    expect(viaCanvas.height).toBe(viaPng.height);
    expect(Array.from(viaCanvas.brightness)).toEqual(Array.from(viaPng.brightness));
  });

  it("normalizes Rec.601 luma to 0..1 in row-major order", () => {
    const { data, width, height } = fixtureRGBA();
    const { brightness } = luminanceGridFromRGBA(data, width, height);
    expect(brightness).toHaveLength(6);
    expect(brightness[0]).toBeCloseTo(0.299, 6);   // pure red, first pixel of row 0
    expect(brightness[1]).toBeCloseTo(0.587, 6);   // pure green
    expect(brightness[2]).toBeCloseTo(0.114, 6);   // pure blue
    expect(brightness[3]).toBe(0);                 // black, first pixel of row 1
    expect(brightness[4]).toBe(1);                 // white
  });

  it("ignores alpha", () => {
    const width = 1;
    const height = 1;
    const opaque = luminanceGridFromRGBA([128, 128, 128, 255], width, height);
    const transparent = luminanceGridFromRGBA([128, 128, 128, 0], width, height);
    expect(transparent.brightness[0]).toBe(opaque.brightness[0]);
  });
});

// ── Scene image references ──

const LUM_SCENE = {
  version: 1,
  id: "port",
  page: { size: "a4", orientation: "portrait", widthPx: 600, heightPx: 600 },
  root: {
    type: "layer",
    id: "l",
    pen: { color: "#111" },
    children: [
      {
        type: "op:image-luminance",
        id: "port",
        image: "portrait.png",
        amplitude: 40,
        child: {
          type: "op:region-hatch",
          id: "lines",
          region: { polygon: [[0, 0], [600, 0], [600, 600], [0, 600]] },
          hatch: { angle: 0, pitch: 7 },
        },
      },
    ],
  },
};

describe("sceneImageRefs", () => {
  it("finds nested image references", () => {
    expect(sceneImageRefs(parseSceneDoc(LUM_SCENE))).toEqual(["portrait.png"]);
  });

  it("returns none for a scene without luminance nodes", () => {
    const doc = parseSceneDoc({
      version: 1,
      id: "plain",
      root: { type: "layer", id: "l", children: [{ type: "generator", id: "g", composition: "x" }] },
    });
    expect(sceneImageRefs(doc)).toEqual([]);
  });

  it("dedupes repeated references and keeps document order", () => {
    const doc = parseSceneDoc({
      version: 1,
      id: "multi",
      root: {
        type: "group",
        id: "root",
        children: [
          { ...LUM_SCENE.root, id: "a" },
          { ...LUM_SCENE.root, id: "b" },
          {
            ...LUM_SCENE.root,
            id: "c",
            children: [{ ...LUM_SCENE.root.children[0], id: "c-op", image: "second.png" }],
          },
        ],
      },
    });
    expect(sceneImageRefs(doc)).toEqual(["portrait.png", "second.png"]);
  });
});

describe("gridImageResolver in the browser render path", () => {
  const grid = luminanceGridFromRGBA(
    new Uint8ClampedArray(8 * 8 * 4).map((_, i) => (i % 4 === 3 ? 255 : (i / 4) % 256)),
    8,
    8,
  );

  it("throws naming the missing reference when no image is uploaded", () => {
    // Baseline (vault-k7ne): without a resolver evalPatch fails on the
    // luminance node; the browser resolver names the reference instead.
    expect(() => renderSceneToSVG(JSON.stringify(LUM_SCENE))).toThrow(/needs an image resolver/);
    expect(() =>
      renderSceneToSVG(JSON.stringify(LUM_SCENE), { resolveImage: gridImageResolver({}) }),
    ).toThrow(/no image uploaded for "portrait\.png"/);
  });

  it("renders once the reference resolves to a grid", () => {
    const { svg, layers, paths } = renderSceneToSVG(JSON.stringify(LUM_SCENE), {
      resolveImage: gridImageResolver({ "portrait.png": grid }),
    });
    expect(layers).toBe(1);
    expect(paths).toBeGreaterThan(0);
    expect(svg).toContain("<path");
  });

  it("produces the geometry the CLI's resolver would for the same pixels", () => {
    const { data, width, height } = fixtureRGBA();
    const png = new PNG({ width, height });
    png.data = Buffer.from(data);
    const path = join(mkdtempSync(join(tmpdir(), "hatch3d-img-")), "portrait.png");
    writeFileSync(path, PNG.sync.write(png));

    const viaCli = renderSceneToSVG(JSON.stringify(LUM_SCENE), {
      resolveImage: () => loadBrightness(path),
    });
    const viaBrowser = renderSceneToSVG(JSON.stringify(LUM_SCENE), {
      resolveImage: gridImageResolver({ "portrait.png": luminanceGridFromRGBA(data, width, height) }),
    });
    expect(viaBrowser.svg).toBe(viaCli.svg);
  });
});
