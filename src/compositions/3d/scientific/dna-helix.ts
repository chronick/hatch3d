import type { Composition3DDefinition, LayerConfig } from "../../types";

const dnaHelix: Composition3DDefinition = {
  id: "dnaHelix",
  name: "DNA Helix",
  description: "Double helix strands connected by torus rungs",
  tags: ["scientific", "helix", "biological"],
  category: "3d",
  hatchGroups: ["Strands", "Rungs"],
  macros: {
    twist: {
      label: "Twist",
      default: 0.5,
      targets: [
        { param: "strandTwist", fn: "linear", strength: 1.0 },
      ],
    },
    scale: {
      label: "Scale",
      default: 0.5,
      targets: [
        { param: "strandWidth", fn: "linear", strength: 1.0 },
        { param: "rungRadius", fn: "linear", strength: 1.0 },
        { param: "height", fn: "linear", strength: 1.0 },
      ],
    },
    density: {
      label: "Density",
      default: 0.5,
      targets: [
        { param: "rungs", fn: "linear", strength: 0.8 },
      ],
    },
  },
  controls: {
    strandTwist: { type: "slider", label: "Strand Twist", default: 3, min: 1, max: 6, group: "Structure" },
    rungs: { type: "slider", label: "Rungs", default: 8, min: 2, max: 16, step: 1, group: "Structure" },
    height: { type: "slider", label: "Height", default: 6, min: 3, max: 10, group: "Structure" },
    strandWidth: { type: "slider", label: "Strand Width", default: 0.6, min: 0.2, max: 1.5, group: "Shape" },
    strandBulge: { type: "slider", label: "Strand Bulge", default: 0.5, min: 0, max: 1, group: "Shape" },
    rungRadius: { type: "slider", label: "Rung Radius", default: 0.8, min: 0.3, max: 1.5, group: "Shape" },
    rungThickness: { type: "slider", label: "Rung Thickness", default: 0.04, min: 0.02, max: 0.15, group: "Shape" },
    rungSquish: { type: "slider", label: "Rung Squish", default: 3, min: 1, max: 5, group: "Shape" },
    showRungs: { type: "toggle", label: "Show Rungs", default: true, group: "Visibility" },
    showStrands: { type: "toggle", label: "Show Strands", default: true, group: "Visibility" },
  },
  layers: (p): LayerConfig[] => {
    const v = p.values;
    const strandTwist = v.strandTwist as number;
    const rungCount = Math.round(v.rungs as number);
    const dnaHeight = v.height as number;
    const strandWidth = v.strandWidth as number;
    const strandBulge = v.strandBulge as number;
    const rungRadius = v.rungRadius as number;
    const rungThickness = v.rungThickness as number;
    const rungSquish = v.rungSquish as number;
    const showRungs = v.showRungs as boolean;
    const showStrands = v.showStrands as boolean;

    const layers: LayerConfig[] = [];
    if (showStrands) {
      layers.push(
        {
          surface: "twistedRibbon",
          params: { twist: strandTwist, width: strandWidth, height: dnaHeight, bulge: strandBulge },
          hatch: { ...p.hatchParams, family: p.hatchParams.family ?? "u" },
          group: "Strands",
        },
        {
          surface: "twistedRibbon",
          params: { twist: strandTwist, width: strandWidth, height: dnaHeight, bulge: strandBulge },
          hatch: { ...p.hatchParams, family: p.hatchParams.family ?? "v" },
          group: "Strands",
        },
      );
    }
    if (showRungs) {
      for (let i = 0; i < rungCount; i++) {
        const t = i / rungCount;
        layers.push({
          surface: "torus",
          params: { majorR: rungRadius, minorR: rungThickness, ySquish: rungSquish },
          hatch: { ...p.hatchParams, family: p.hatchParams.family ?? "u" },
          transform: { y: -dnaHeight / 2 + t * dnaHeight },
          group: "Rungs",
        });
      }
    }
    return layers;
  },
};
export default dnaHelix;
