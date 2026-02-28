import type { Composition3DDefinition, LayerConfig } from "../types";

const ribbonCage: Composition3DDefinition = {
  id: "ribbonCage",
  name: "Ribbon Cage",
  description: "Multiple twisted ribbons arranged in a cylindrical cage",
  tags: ["organic", "cage", "ribbons"],
  category: "3D/Organic",
  hatchGroups: ["Ribbons"],
  macros: {
    density: {
      label: "Density",
      default: 0.5,
      targets: [
        { param: "ribbons", fn: "linear", strength: 0.8 },
        { param: "baseTwist", fn: "linear", strength: 0.8 },
      ],
    },
    scale: {
      label: "Scale",
      default: 0.5,
      targets: [
        { param: "height", fn: "linear", strength: 1.0 },
        { param: "cageRadius", fn: "linear", strength: 1.0 },
        { param: "width", fn: "linear", strength: 1.0 },
      ],
    },
    chaos: {
      label: "Chaos",
      default: 0.5,
      targets: [
        { param: "twistVariation", fn: "exp", strength: 1.0 },
        { param: "bulgeProgression", fn: "exp", strength: 1.0 },
      ],
    },
  },
  controls: {
    ribbons: { type: "slider", label: "Ribbons", default: 6, min: 2, max: 12, step: 1, group: "Structure" },
    cageRadius: { type: "slider", label: "Cage Radius", default: 0.3, min: 0.05, max: 1.5, group: "Structure" },
    baseTwist: { type: "slider", label: "Base Twist", default: 1.5, min: 0.3, max: 4, group: "Shape" },
    twistVariation: { type: "slider", label: "Twist Variation", default: 0.8, min: 0, max: 2, group: "Shape" },
    width: { type: "slider", label: "Width", default: 0.5, min: 0.2, max: 1.5, group: "Shape" },
    height: { type: "slider", label: "Height", default: 4.5, min: 2, max: 7, group: "Shape" },
    baseBulge: { type: "slider", label: "Base Bulge", default: 0.15, min: 0, max: 0.5, group: "Shape" },
    bulgeProgression: { type: "slider", label: "Bulge Growth", default: 0.05, min: 0, max: 0.15, group: "Shape" },
  },
  layers: (p): LayerConfig[] => {
    const v = p.values;
    const n = Math.round(v.ribbons as number);
    const cageRadius = v.cageRadius as number;
    const baseTwist = v.baseTwist as number;
    const twistVariation = v.twistVariation as number;
    const ribbonWidth = v.width as number;
    const ribbonHeight = v.height as number;
    const baseBulge = v.baseBulge as number;
    const bulgeProgression = v.bulgeProgression as number;
    const families: Array<"u" | "v"> = ["u", "v"];
    const layers: LayerConfig[] = [];
    for (let i = 0; i < n; i++) {
      const phase = (i / n) * Math.PI;
      layers.push({
        surface: "twistedRibbon",
        params: {
          twist: baseTwist + Math.sin(phase) * twistVariation,
          width: ribbonWidth,
          height: ribbonHeight,
          bulge: baseBulge + i * bulgeProgression,
        },
        hatch: {
          ...p.hatchParams,
          family: p.hatchParams.family ?? families[i % 2],
        },
        transform: {
          x: cageRadius * Math.cos((i / n) * Math.PI * 2),
          z: cageRadius * Math.sin((i / n) * Math.PI * 2),
        },
        group: "Ribbons",
      });
    }
    return layers;
  },
};
export default ribbonCage;
