import type { LayeredCompositionDefinition } from "../../types";

/**
 * Demo of LayeredComposition (v1).
 *
 * Stacks an `isoWoodBlocks` ground field with a `phyllotaxisGarden` accent
 * on top. Each layer emits its own SVG <g> group with a distinct stroke
 * color so a pen plotter can run them on separate pens.
 *
 * Demonstrates:
 *   - registry round-trip for `type: "layered"`
 *   - per-layer color + <g> grouping in headless + browser SVG output
 *   - blendMode: "over" (additive stacking)
 */
const phyllotaxisIsoblocks: LayeredCompositionDefinition = {
  id: "phyllotaxisIsoblocks",
  name: "Phyllotaxis × Iso-Blocks",
  description:
    "Two-pen demo of LayeredComposition: iso-wood-block ground, phyllotaxis accent.",
  category: "layered",
  type: "layered",
  tags: ["layered", "demo", "two-pen"],
  layers: [
    {
      composition: "isoWoodBlocks",
      name: "ground",
      color: "#2563eb",
      blendMode: "over",
    },
    {
      composition: "phyllotaxisGarden",
      name: "accent",
      color: "#dc2626",
      blendMode: "over",
    },
  ],
};

export default phyllotaxisIsoblocks;
