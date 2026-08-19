import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { LayerPanel } from "../components/LayerPanel";
import type {
  LayeredLayer,
  Composition2DDefinition,
} from "../compositions/types";

function makeLayer(id: string, composition = "noop"): LayeredLayer {
  return {
    __id: id,
    composition,
    name: id,
    color: "#000000",
    blendMode: "over",
    visible: true,
  };
}

const stubComp: Composition2DDefinition = {
  id: "noop",
  name: "Noop",
  type: "2d",
  category: "2d",
  generate: () => [],
};

describe("LayerPanel — stable identity across reorder", () => {
  it("re-uses the same DOM node for a layer when its position changes", () => {
    const a = makeLayer("aaa");
    const b = makeLayer("bbb");
    const c = makeLayer("ccc");
    const onChange = vi.fn();
    const { rerender } = render(
      <LayerPanel
        layers={[a, b, c]}
        onChange={onChange}
        availableCompositions={[stubComp]}
      />,
    );

    // Capture the middle row's DOM node BEFORE reorder.
    const middleBefore = screen.getByTestId("layer-row-bbb");

    // Reverse the layer order.
    rerender(
      <LayerPanel
        layers={[c, b, a]}
        onChange={onChange}
        availableCompositions={[stubComp]}
      />,
    );

    // Re-query the same testid; it must be the SAME Node, not a remount.
    // A naive index-keyed list would replace this node and the assertion
    // would fail.
    const middleAfter = screen.getByTestId("layer-row-bbb");
    expect(middleAfter).toBe(middleBefore);
  });

  it("add assigns a non-empty __id to the new layer", () => {
    const onChange = vi.fn<(layers: LayeredLayer[]) => void>();
    render(
      <LayerPanel
        layers={[]}
        onChange={onChange}
        availableCompositions={[stubComp]}
      />,
    );

    fireEvent.click(screen.getByText("+ add layer"));
    // After clicking the picker opens with a select element.
    const picker = screen.getByRole("combobox");
    fireEvent.change(picker, { target: { value: "noop" } });

    expect(onChange).toHaveBeenCalledTimes(1);
    const arg = onChange.mock.calls[0][0];
    expect(arg).toHaveLength(1);
    expect(typeof arg[0].__id).toBe("string");
    expect(arg[0].__id!.length).toBeGreaterThan(0);
    expect(arg[0].composition).toBe("noop");
  });
});
