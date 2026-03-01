import type { Composition2DDefinition } from "../../types";

const spirograph: Composition2DDefinition = {
  id: "spirograph",
  name: "Spirograph",
  description: "Hypotrochoid and epitrochoid curves with layered pen offsets",
  tags: ["mathematical", "spirograph"],
  category: "2d",
  type: "2d",
  macros: {
    complexity: {
      label: "Complexity",
      default: 0.5,
      targets: [
        { param: "revolutions", fn: "linear", strength: 1.0 },
        { param: "samples", fn: "linear", strength: 0.8 },
        { param: "layers", fn: "linear", strength: 0.5 },
      ],
    },
  },
  controls: {
    outerR: { type: "slider", label: "Outer Radius", default: 300, min: 100, max: 380, step: 1, group: "Shape" },
    innerR: { type: "slider", label: "Inner Radius", default: 180, min: 20, max: 350, step: 1, group: "Shape" },
    penOffset: { type: "slider", label: "Pen Offset", default: 120, min: 10, max: 300, step: 1, group: "Shape" },
    revolutions: { type: "slider", label: "Revolutions", default: 50, min: 5, max: 300, step: 1, group: "Shape" },
    samples: { type: "slider", label: "Samples", default: 2000, min: 500, max: 15000, step: 50, group: "Quality" },
    layers: { type: "slider", label: "Layers", default: 1, min: 1, max: 20, step: 1, group: "Layers" },
    layerOffset: { type: "slider", label: "Layer Offset", default: 20, min: 5, max: 80, step: 1, group: "Layers" },
    mode: {
      type: "select",
      label: "Mode",
      default: "hypo",
      options: [
        { label: "Hypotrochoid", value: "hypo" },
        { label: "Epitrochoid", value: "epi" },
      ],
      group: "Shape",
    },
  },
  generate({ width, height, values }) {
    const R = values.outerR as number;
    const r = values.innerR as number;
    const d = values.penOffset as number;
    const revolutions = Math.round(values.revolutions as number);
    const samples = Math.round(values.samples as number);
    const layerCount = Math.round(values.layers as number);
    const layerOffset = values.layerOffset as number;
    const mode = values.mode as string;

    const cx = width / 2;
    const cy = height / 2;
    const polylines: { x: number; y: number }[][] = [];

    for (let layer = 0; layer < layerCount; layer++) {
      const penD = d + layer * layerOffset;
      const pts: { x: number; y: number }[] = [];
      for (let i = 0; i <= samples; i++) {
        const t = (i / samples) * revolutions * Math.PI * 2;
        let x: number, y: number;
        if (mode === "hypo") {
          x = (R - r) * Math.cos(t) + penD * Math.cos(((R - r) / r) * t);
          y = (R - r) * Math.sin(t) - penD * Math.sin(((R - r) / r) * t);
        } else {
          x = (R + r) * Math.cos(t) - penD * Math.cos(((R + r) / r) * t);
          y = (R + r) * Math.sin(t) - penD * Math.sin(((R + r) / r) * t);
        }
        pts.push({ x: cx + x, y: cy + y });
      }
      polylines.push(pts);
    }

    return polylines;
  },
};
export default spirograph;
