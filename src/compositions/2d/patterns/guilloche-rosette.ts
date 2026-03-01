import type { Composition2DDefinition } from "../../types";

const guillocheRosette: Composition2DDefinition = {
  id: "guillocheRosette",
  name: "Guilloche Rosette",
  description:
    "Concentric guilloche bands with parametric wave modulation creating moire interference",
  tags: ["pattern", "guilloche", "rosette", "currency"],
  category: "2d",
  type: "2d",

  macros: {
    complexity: {
      label: "Complexity",
      default: 0.5,
      targets: [
        { param: "layersPerRing", fn: "linear", strength: 0.8 },
        { param: "lobes", fn: "linear", strength: 0.6 },
      ],
    },
  },

  controls: {
    rings: {
      type: "slider",
      label: "Rings",
      default: 4,
      min: 2,
      max: 20,
      step: 1,
      group: "Structure",
    },
    layersPerRing: {
      type: "slider",
      label: "Layers / Ring",
      default: 10,
      min: 3,
      max: 50,
      step: 1,
      group: "Structure",
    },
    lobes: {
      type: "slider",
      label: "Lobes",
      default: 8,
      min: 3,
      max: 60,
      step: 1,
      group: "Shape",
    },
    amplitude: {
      type: "slider",
      label: "Amplitude",
      default: 30,
      min: 5,
      max: 200,
      step: 1,
      group: "Shape",
    },
    phaseStep: {
      type: "slider",
      label: "Phase Step",
      default: 0.15,
      min: 0.01,
      max: 0.5,
      step: 0.01,
      group: "Shape",
    },
    innerRadius: {
      type: "slider",
      label: "Inner Radius",
      default: 80,
      min: 50,
      max: 200,
      step: 5,
      group: "Size",
    },
    ringSpacing: {
      type: "slider",
      label: "Ring Spacing",
      default: 50,
      min: 20,
      max: 200,
      step: 5,
      group: "Size",
    },
  },

  generate({ width, height, values }) {
    const rings = Math.round(values.rings as number);
    const layersPerRing = Math.round(values.layersPerRing as number);
    const lobes = Math.round(values.lobes as number);
    const amplitude = values.amplitude as number;
    const phaseStep = values.phaseStep as number;
    const innerRadius = values.innerRadius as number;
    const ringSpacing = values.ringSpacing as number;

    const cx = width / 2;
    const cy = height / 2;
    const samples = 360;
    const polylines: { x: number; y: number }[][] = [];

    for (let ring = 0; ring < rings; ring++) {
      const ringR = innerRadius + ring * ringSpacing;

      for (let layer = 0; layer < layersPerRing; layer++) {
        const phase = layer * phaseStep;
        const pts: { x: number; y: number }[] = [];

        for (let s = 0; s <= samples; s++) {
          const t = (s / samples) * Math.PI * 2;
          const r = ringR + amplitude * Math.sin(lobes * t + phase);
          pts.push({
            x: cx + r * Math.cos(t),
            y: cy + r * Math.sin(t),
          });
        }

        polylines.push(pts);
      }
    }

    return polylines;
  },
};

export default guillocheRosette;
