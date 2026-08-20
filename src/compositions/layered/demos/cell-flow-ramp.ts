import type { LayeredCompositionDefinition, LayeredLayer } from "../../types";

/**
 * cell-flow-ramp — the cell-flow-gradient look split across four pens on a
 * warm-to-dark colour ramp.
 *
 * The r/PlotterArt "1v4l3m5" reference piece is a warm gradient: each Voronoi
 * cell's wavy fill runs hot orange and cools into a deep aubergine as it
 * crosses the cell. `cellFlowGradient` already emits every cell's fill lines
 * strictly left-to-right and contiguously, so the gradient needs no new
 * geometry — only a partition of the runs it already produces.
 *
 * Mechanism: each layer is the *same* inner composition at the *same* seed,
 * differing only in `{ penCount: N, penIndex: k }`. The inner composition maps
 * each run's nominal x onto `[k/N, (k+1)/N)` of its cell's horizontal span and
 * emits only the k-th slice. Identical seed ⇒ identical Voronoi sites,
 * identical scan positions ⇒ the N layers are a strict partition of the
 * one-pen render, with no double-inked runs and no gaps. The heavy cell
 * outline is emitted by the last (darkest) pen only, matching the reference's
 * near-black border.
 *
 * Consequences for the plot: N pen layers, exported with the Inkscape
 * `inkscape:groupmode="layer"` convention, one pen change per layer, and the
 * pens register against each other by construction rather than by luck.
 *
 * To re-ramp: edit `RAMP` — the layers are derived from it, so the pen count
 * follows the number of colours automatically.
 */

/**
 * Warm-to-dark ramp, eyeballed against the reference photo: a hot orange
 * ground, a burnt sienna, a mulberry mid-tone that carries the transition, and
 * a near-black aubergine that also draws the cell borders.
 */
const RAMP: { name: string; color: string }[] = [
  { name: "ember", color: "#f26a15" },
  { name: "sienna", color: "#bf4a22" },
  { name: "maroon", color: "#7a2f38" },
  { name: "bitumen", color: "#2b1a22" },
];

const layers: LayeredLayer[] = RAMP.map(({ name, color }, k) => ({
  composition: "cellFlowGradient",
  // Bare name: the SVG exporter already prefixes the 1-based layer index to
  // build the `inkscape:label`.
  name,
  color,
  blendMode: "over",
  paramOverrides: {
    penCount: RAMP.length,
    penIndex: k,
    // Seed is pinned here rather than left to the inner default so the
    // partition can never drift apart between layers.
    seed: 7,
  },
}));

const cellFlowRamp: LayeredCompositionDefinition = {
  id: "cellFlowRamp",
  name: "Cell Flow Ramp",
  description:
    "Voronoi cell-flow fill split across four pens on a warm orange-to-aubergine ramp — each layer is one vertical slice of every cell's left-to-right runs.",
  category: "layered",
  type: "layered",
  tags: ["layered", "multi-pen", "voronoi", "gradient", "cells", "ramp"],
  layers,
};

export default cellFlowRamp;
