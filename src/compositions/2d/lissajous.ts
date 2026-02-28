import type { Composition2DDefinition } from "../types";

const lissajous: Composition2DDefinition = {
  id: "lissajous",
  name: "Lissajous",
  description: "Lissajous curves with phase-shifted layers and optional damping",
  tags: ["mathematical", "lissajous", "waves"],
  category: "2D/Patterns",
  type: "2d",
  controls: {
    freqX: { type: "slider", label: "Freq X", default: 3, min: 1, max: 12, step: 1, group: "Shape" },
    freqY: { type: "slider", label: "Freq Y", default: 4, min: 1, max: 12, step: 1, group: "Shape" },
    phase: { type: "slider", label: "Phase", default: 0.5, min: 0, max: Math.PI, step: 0.01, group: "Shape" },
    amplitude: { type: "slider", label: "Amplitude", default: 350, min: 100, max: 390, step: 1, group: "Shape" },
    layers: { type: "slider", label: "Layers", default: 5, min: 1, max: 12, step: 1, group: "Layers" },
    phaseStep: { type: "slider", label: "Phase Step", default: 0.15, min: 0.01, max: 0.5, step: 0.01, group: "Layers" },
    samples: { type: "slider", label: "Samples", default: 1000, min: 200, max: 4000, step: 50, group: "Quality" },
    damping: { type: "slider", label: "Damping", default: 0, min: 0, max: 0.5, step: 0.01, group: "Shape" },
  },
  generate({ width, height, values }) {
    const freqX = Math.round(values.freqX as number);
    const freqY = Math.round(values.freqY as number);
    const basePhase = values.phase as number;
    const amplitude = values.amplitude as number;
    const layerCount = Math.round(values.layers as number);
    const phaseStep = values.phaseStep as number;
    const samples = Math.round(values.samples as number);
    const damping = values.damping as number;

    const cx = width / 2;
    const cy = height / 2;
    const polylines: { x: number; y: number }[][] = [];

    for (let layer = 0; layer < layerCount; layer++) {
      const ph = basePhase + layer * phaseStep;
      const pts: { x: number; y: number }[] = [];
      for (let i = 0; i <= samples; i++) {
        const t = (i / samples) * Math.PI * 2;
        const decay = damping > 0 ? Math.exp(-damping * Math.abs(t - Math.PI)) : 1;
        const x = amplitude * decay * Math.sin(freqX * t + ph);
        const y = amplitude * decay * Math.sin(freqY * t);
        pts.push({ x: cx + x, y: cy + y });
      }
      polylines.push(pts);
    }

    return polylines;
  },
};
export default lissajous;
