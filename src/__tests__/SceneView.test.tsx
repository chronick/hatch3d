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
