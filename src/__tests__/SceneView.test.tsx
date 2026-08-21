import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SceneView } from "../scene/SceneView";

const LUM_SCENE = JSON.stringify({
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
});

/** Replace the editor's contents with `json` and press Render. */
function loadScene(json: string) {
  fireEvent.change(screen.getByTestId("scene-source"), { target: { value: json } });
  fireEvent.click(screen.getByTestId("scene-render"));
}

const LAYERED_SCENE = JSON.stringify(
  {
    version: 1,
    id: "two-pen",
    page: { size: "a3", orientation: "landscape", marginMm: 15 },
    root: {
      type: "group",
      id: "root",
      children: [
        {
          type: "layer",
          id: "ground",
          pen: { color: "#2563eb", name: "ground", width: 0.25 },
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
  },
  null,
  2,
);

describe("SceneView — LayerPanel round trip (vault-2p7d)", () => {
  it("mounts the layer panel bound to the loaded scene's stack", () => {
    render(<SceneView />);
    fireEvent.change(screen.getByTestId("scene-source"), { target: { value: LAYERED_SCENE } });
    expect(screen.getByTestId("scene-layers")).toHaveTextContent("LAYERS (2)");
    expect(screen.getByTestId("layer-row-ground")).toBeInTheDocument();
    expect(screen.getByTestId("layer-row-accent")).toBeInTheDocument();
  });

  it("leaves the scene JSON byte-identical when an edit changes nothing", () => {
    render(<SceneView />);
    const source = screen.getByTestId("scene-source") as HTMLTextAreaElement;
    fireEvent.change(source, { target: { value: LAYERED_SCENE } });
    // A panel edit that re-sets a field to the value it already holds still
    // round-trips through sceneToLayers → applyLayersToScene; the doc must
    // come back untouched, not reserialized.
    const nameInput = screen.getByTestId("layer-row-ground").querySelector("input")!;
    fireEvent.change(nameInput, { target: { value: "ground" } });
    expect(source.value).toBe(LAYERED_SCENE);
  });

  it("toggling visibility off and back on changes only the visible field", () => {
    render(<SceneView />);
    const source = screen.getByTestId("scene-source") as HTMLTextAreaElement;
    fireEvent.change(source, { target: { value: LAYERED_SCENE } });
    const toggle = () =>
      fireEvent.click(screen.getByTestId("layer-row-ground").querySelector("button")!);
    toggle();
    expect(JSON.parse(source.value).root.children[0].visible).toBe(false);
    toggle();
    const before = JSON.parse(LAYERED_SCENE);
    const after = JSON.parse(source.value);
    expect(after.root.children[0].visible).toBe(true);
    delete after.root.children[0].visible;
    expect(after).toEqual(before);
  });

  it("writes a layer edit back into the scene JSON, keeping the pen width", () => {
    render(<SceneView />);
    const source = screen.getByTestId("scene-source") as HTMLTextAreaElement;
    fireEvent.change(source, { target: { value: LAYERED_SCENE } });
    const nameInput = screen.getByTestId("layer-row-ground").querySelector("input")!;
    fireEvent.change(nameInput, { target: { value: "base" } });

    const doc = JSON.parse(source.value);
    expect(doc.root.children[0].pen).toEqual({ color: "#2563eb", name: "base", width: 0.25 });
    expect(doc.page).toEqual(JSON.parse(LAYERED_SCENE).page);
    expect(doc.root.children[1]).toEqual(JSON.parse(LAYERED_SCENE).root.children[1]);
  });

  it("hides the panel for a scene with no generator-backed layer", () => {
    render(<SceneView />);
    fireEvent.change(screen.getByTestId("scene-source"), { target: { value: LUM_SCENE } });
    expect(screen.queryByTestId("scene-layers")).toBeNull();
  });
});

describe("SceneView — luminance image inputs (vault-k7ne)", () => {
  it("shows no image input for a scene without luminance nodes", () => {
    render(<SceneView />);
    expect(screen.queryByTestId("scene-image-inputs")).toBeNull();
  });

  it("offers a file input keyed by the scene's image reference", () => {
    render(<SceneView />);
    fireEvent.change(screen.getByTestId("scene-source"), { target: { value: LUM_SCENE } });
    expect(screen.getByTestId("scene-image-inputs")).toBeInTheDocument();
    expect(screen.getByTestId("scene-image-input-portrait.png")).toBeInTheDocument();
  });

  it("surfaces the missing-image error on render, alongside the input", () => {
    render(<SceneView />);
    loadScene(LUM_SCENE);
    expect(screen.getByTestId("scene-error")).toHaveTextContent(
      'no image uploaded for "portrait.png"',
    );
    expect(screen.getByTestId("scene-image-input-portrait.png")).toBeInTheDocument();
  });

  it("names every reference separately when a scene needs more than one image", () => {
    const two = JSON.parse(LUM_SCENE);
    const second = structuredClone(two.root);
    second.id = "l2";
    second.children[0].id = "port2";
    second.children[0].image = "second.png";
    render(<SceneView />);
    fireEvent.change(screen.getByTestId("scene-source"), {
      target: { value: JSON.stringify({ ...two, root: { type: "group", id: "root", children: [two.root, second] } }) },
    });
    expect(screen.getByTestId("scene-image-inputs")).toHaveTextContent("needs 2 images");
    expect(screen.getByTestId("scene-image-input-portrait.png")).toBeInTheDocument();
    expect(screen.getByTestId("scene-image-input-second.png")).toBeInTheDocument();
  });
});
