import type { Composition2D } from "./compositions";

export const COMPOSITIONS_2D: Record<string, Composition2D> = {
  moireCircles: {
    type: "2d",
    name: "Moire Circles",
    controls: {
      rings: { type: "slider", label: "Rings", default: 40, min: 10, max: 80, step: 1, group: "Structure" },
      centerOffsetX: { type: "slider", label: "Offset X", default: 60, min: -200, max: 200, step: 1, group: "Structure" },
      centerOffsetY: { type: "slider", label: "Offset Y", default: 40, min: -200, max: 200, step: 1, group: "Structure" },
      smoothness: { type: "slider", label: "Smoothness", default: 120, min: 36, max: 240, step: 1, group: "Shape" },
      showSecond: { type: "toggle", label: "Second Set", default: true, group: "Shape" },
    },
    generate({ width, height, values }) {
      const rings = Math.round(values.rings as number);
      const offX = values.centerOffsetX as number;
      const offY = values.centerOffsetY as number;
      const smoothness = Math.round(values.smoothness as number);
      const showSecond = values.showSecond as boolean;

      const cx = width / 2;
      const cy = height / 2;
      const maxR = Math.hypot(width, height) / 2;
      const spacing = maxR / rings;
      const polylines: { x: number; y: number }[][] = [];

      for (let i = 1; i <= rings; i++) {
        const r = i * spacing;
        const pts: { x: number; y: number }[] = [];
        for (let j = 0; j <= smoothness; j++) {
          const a = (j / smoothness) * Math.PI * 2;
          pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
        }
        polylines.push(pts);
      }

      if (showSecond) {
        for (let i = 1; i <= rings; i++) {
          const r = i * spacing;
          const pts: { x: number; y: number }[] = [];
          for (let j = 0; j <= smoothness; j++) {
            const a = (j / smoothness) * Math.PI * 2;
            pts.push({ x: cx + offX + Math.cos(a) * r, y: cy + offY + Math.sin(a) * r });
          }
          polylines.push(pts);
        }
      }

      return polylines;
    },
  },

  spirograph: {
    type: "2d",
    name: "Spirograph",
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
      revolutions: { type: "slider", label: "Revolutions", default: 50, min: 5, max: 150, step: 1, group: "Shape" },
      samples: { type: "slider", label: "Samples", default: 2000, min: 500, max: 6000, step: 50, group: "Quality" },
      layers: { type: "slider", label: "Layers", default: 1, min: 1, max: 6, step: 1, group: "Layers" },
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
  },

  lissajous: {
    type: "2d",
    name: "Lissajous",
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
  },
};
