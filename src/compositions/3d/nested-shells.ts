import type { Composition3DDefinition, LayerConfig } from "../types";

const nestedShells: Composition3DDefinition = {
  id: "nestedShells",
  name: "Nested Shells",
  description: "Concentric hyperboloid shells with canopy caps",
  tags: ["geometric", "concentric", "shells"],
  category: "3D/Geometric",
  hatchGroups: ["Shells", "Caps"],
  macros: {
    density: {
      label: "Density",
      default: 0.5,
      targets: [
        { param: "shells", fn: "linear", strength: 0.6 },
      ],
    },
    scale: {
      label: "Scale",
      default: 0.5,
      targets: [
        { param: "outerRadius", fn: "linear", strength: 1.0 },
        { param: "height", fn: "linear", strength: 1.0 },
      ],
    },
    twist: {
      label: "Twist",
      default: 0.5,
      targets: [
        { param: "innerTwist", fn: "linear", strength: 1.0 },
        { param: "outerTwist", fn: "linear", strength: 1.0 },
      ],
    },
  },
  controls: {
    shells: { type: "slider", label: "Shells", default: 4, min: 1, max: 8, step: 1, group: "Structure" },
    outerRadius: { type: "slider", label: "Outer Radius", default: 1.8, min: 0.8, max: 3.5, group: "Structure" },
    innerRadius: { type: "slider", label: "Inner Radius", default: 0.8, min: 0.2, max: 2, group: "Structure" },
    height: { type: "slider", label: "Height", default: 3, min: 1.5, max: 6, group: "Structure" },
    heightGrowth: { type: "slider", label: "Height Growth", default: 1.5, min: 0, max: 3, group: "Structure" },
    outerTwist: { type: "slider", label: "Outer Twist", default: 0.5, min: 0, max: 3, group: "Shape" },
    innerTwist: { type: "slider", label: "Inner Twist", default: 2.0, min: 0.5, max: 5, group: "Shape" },
    outerWaist: { type: "slider", label: "Outer Waist", default: 0.25, min: 0, max: 1, group: "Shape" },
    innerWaist: { type: "slider", label: "Inner Waist", default: 0.4, min: 0, max: 1, group: "Shape" },
    capSag: { type: "slider", label: "Cap Sag", default: 0.4, min: 0.1, max: 1.5, group: "Shape" },
    capSharpness: { type: "slider", label: "Cap Sharpness", default: 6, min: 1, max: 10, group: "Shape" },
    showCaps: { type: "toggle", label: "Show Caps", default: true, group: "Visibility" },
  },
  layers: (p): LayerConfig[] => {
    const v = p.values;
    const shellCount = Math.round(v.shells as number);
    const outerRadius = v.outerRadius as number;
    const innerRadius = v.innerRadius as number;
    const baseHeight = v.height as number;
    const heightGrowth = v.heightGrowth as number;
    const outerTwist = v.outerTwist as number;
    const innerTwist = v.innerTwist as number;
    const outerWaist = v.outerWaist as number;
    const innerWaist = v.innerWaist as number;
    const capSag = v.capSag as number;
    const capSharpness = v.capSharpness as number;
    const showCaps = v.showCaps as boolean;

    const layers: LayerConfig[] = [];
    const shellFamilies: Array<"u" | "v" | "diagonal"> = ["u", "v", "diagonal"];
    for (let i = 0; i < shellCount; i++) {
      const t = shellCount > 1 ? i / (shellCount - 1) : 0;
      const radius = outerRadius - t * (outerRadius - innerRadius);
      layers.push({
        surface: "hyperboloid",
        params: {
          radius,
          height: baseHeight + t * heightGrowth,
          twist: outerTwist + t * (innerTwist - outerTwist),
          waist: outerWaist + t * (innerWaist - outerWaist),
        },
        hatch: { ...p.hatchParams, family: p.hatchParams.family ?? shellFamilies[i % 3] },
        group: "Shells",
      });
    }
    if (showCaps) {
      layers.push({
        surface: "canopy",
        params: { radius: outerRadius, sag: capSag, sharpness: capSharpness, yOffset: baseHeight * 0.73 },
        hatch: { ...p.hatchParams, family: p.hatchParams.family ?? "diagonal" },
        group: "Caps",
      });
      layers.push({
        surface: "canopy",
        params: { radius: outerRadius, sag: capSag, sharpness: capSharpness, yOffset: -baseHeight * 0.73 },
        hatch: { ...p.hatchParams, family: p.hatchParams.family ?? "u" },
        group: "Caps",
      });
    }
    return layers;
  },
};
export default nestedShells;
