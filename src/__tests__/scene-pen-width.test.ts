import { describe, it, expect, beforeEach } from "vitest";
import { compositionRegistry } from "../compositions/registry";
import type { Composition2DDefinition } from "../compositions/types";
import { parseSceneDoc, PenSchema } from "../scene/schema";
import { sceneToPatch } from "../scene/to-patch";
import { evalPatch, patchLayersToGroups } from "../patch/graph";
import { compileDSL } from "../patch/dsl";

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

/** Two-pen scene: one layer with an explicit pen width, one without. */
const WIDTH_SCENE = {
  version: 1, id: "pen-width",
  page: { strokeWidthMm: 0.5 },
  root: {
    type: "group", id: "root",
    children: [
      { type: "layer", id: "bold", pen: { color: "#2563eb", name: "bold", width: 0.8 }, blend: "over",
        children: [{ type: "generator", id: "ga", composition: "stripesA" }] },
      { type: "layer", id: "fine", pen: { color: "#dc2626", name: "fine" }, blend: "over",
        children: [{ type: "generator", id: "gb", composition: "stripesB" }] },
    ],
  },
};

describe("PenSchema — width", () => {
  it("accepts an optional positive width (mm)", () => {
    expect(PenSchema.safeParse({ color: "#111", width: 0.3 }).success).toBe(true);
    expect(PenSchema.safeParse({ color: "#111" }).success).toBe(true);
  });

  it("rejects width <= 0", () => {
    expect(PenSchema.safeParse({ width: 0 }).success).toBe(false);
    expect(PenSchema.safeParse({ width: -0.5 }).success).toBe(false);
  });

  it("rejects a non-numeric width", () => {
    expect(PenSchema.safeParse({ width: "0.3mm" }).success).toBe(false);
  });

  it("rejects width <= 0 through the full document parse", () => {
    const bad = structuredClone(WIDTH_SCENE) as { root: { children: { pen: { width: number } }[] } };
    bad.root.children[0].pen.width = -1;
    expect(() => parseSceneDoc(bad)).toThrow(/Invalid scene document/);
  });
});

describe("pen width — scene → patch → evaluated layer", () => {
  it("sceneToPatch carries width onto the pen node (and omits it when absent)", () => {
    const patch = sceneToPatch(parseSceneDoc(WIDTH_SCENE));
    const pens = patch.nodes.filter((n) => n.op === "pen") as { name?: string; width?: number }[];
    expect(pens.map((p) => p.name)).toEqual(["bold", "fine"]);
    expect(pens[0].width).toBe(0.8);
    expect("width" in pens[1]).toBe(false);
  });

  it("evalPatch surfaces the width on the output layer", () => {
    const { layers } = evalPatch(sceneToPatch(parseSceneDoc(WIDTH_SCENE)));
    expect(layers).toHaveLength(2);
    expect(layers[0]).toMatchObject({ name: "bold", color: "#2563eb", width: 0.8 });
    expect(layers[1].name).toBe("fine");
    expect(layers[1].width).toBeUndefined();
  });
});

describe("pen width — widthScale conversion for the exporter", () => {
  it("converts width to widthScale = width / page.strokeWidthMm", () => {
    const { layers, page } = evalPatch(sceneToPatch(parseSceneDoc(WIDTH_SCENE)));
    const groups = patchLayersToGroups(layers, page);
    expect(page.strokeWidthMm).toBe(0.5);
    expect(groups[0].widthScale).toBeCloseTo(0.8 / 0.5, 10);
  });

  it("emits no widthScale key for layers without a pen width (byte-identical output)", () => {
    const { layers, page } = evalPatch(sceneToPatch(parseSceneDoc(WIDTH_SCENE)));
    const groups = patchLayersToGroups(layers, page);
    expect("widthScale" in groups[1]).toBe(false);
  });
});

describe("pen width — DSL pen directive", () => {
  it("pen(..., width: N) compiles to a pen node with width", () => {
    const doc = compileDSL(`
      g = stripesA()
      p = pen(g, color: "#111", width: 0.3)
      out(p)
    `);
    const pen = doc.nodes.find((n) => n.op === "pen") as { width?: number };
    expect(pen.width).toBe(0.3);
  });
});
