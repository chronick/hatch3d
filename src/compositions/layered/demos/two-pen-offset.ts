import type { LayeredCompositionDefinition } from "../../types";

/**
 * Two-pen multi-layer demo — the reference piece for the plotter layer path.
 *
 * Pen 1 lays down a flow-field ground in blue; pen 2 draws an offset
 * Lissajous overlay in red, plotted twice (`passes: 2`) so a water-based
 * pen builds up enough ink to read against the ground.
 *
 * Demonstrates the whole chain:
 *   layered definition → per-layer color/name/passes → SVG export with
 *   `inkscape:groupmode="layer"`, `inkscape:label="N-name"` and
 *   `data-passes="N"` → vpype `read --multilayer` → per-pen AxiDraw plot.
 *
 * Pass expansion lives at plot time: the artifact holds one copy of each
 * path, and `/plot` repeats the layer N times on the machine.
 */
const twoPenOffset: LayeredCompositionDefinition = {
  id: "twoPenOffset",
  name: "Two-Pen Offset",
  description:
    "Blue flow-field ground with an offset red Lissajous overlay — multi-pen layer demo (second pen plots twice).",
  category: "layered",
  type: "layered",
  tags: ["layered", "demo", "two-pen", "multi-pen", "passes"],
  layers: [
    {
      composition: "flowField",
      name: "ground",
      color: "#1d4ed8",
      blendMode: "over",
    },
    {
      composition: "spirograph",
      name: "overlay",
      color: "#dc2626",
      blendMode: "over",
      // Slight offset so the two pens read as distinct passes, not a
      // registration error.
      transform: { tx: 24, ty: -18, scale: 0.82 },
      paramOverrides: {
        mode: "lissajous",
        freqX: 5,
        freqY: 4,
        layers: 6,
        samples: 1500,
      },
      // Water-based pen: two passes for ink build-up.
      passes: 2,
    },
  ],
};

export default twoPenOffset;
