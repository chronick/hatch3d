import type { Composition3DDefinition, LayerConfig } from "../../types";

const mushroomColony: Composition3DDefinition = {
  id: "mushroomColony",
  name: "Mushroom Colony",
  description: "Cluster of mushrooms with hyperboloid stems and canopy caps",
  tags: ["organic", "natural", "colony"],
  category: "3d",
  hatchGroups: ["Stems", "Caps"],
  macros: {
    scale: {
      label: "Scale",
      default: 0.5,
      targets: [
        { param: "capSize", fn: "linear", strength: 1.0 },
        { param: "stemHeight", fn: "linear", strength: 1.0 },
      ],
    },
    density: {
      label: "Density",
      default: 0.5,
      targets: [
        { param: "count", fn: "linear", strength: 0.5 },
      ],
    },
    spread: {
      label: "Spread",
      default: 0.5,
      targets: [
        { param: "colonySpread", fn: "linear", strength: 1.0 },
      ],
    },
  },
  controls: {
    count: { type: "slider", label: "Count", default: 5, min: 1, max: 25, step: 1, group: "Structure" },
    colonySpread: { type: "slider", label: "Colony Spread", default: 2.2, min: 0.5, max: 10, group: "Structure" },
    capSize: { type: "slider", label: "Cap Size", default: 1.0, min: 0.3, max: 5, group: "Shape" },
    stemHeight: { type: "slider", label: "Stem Height", default: 2.5, min: 0.5, max: 10, group: "Shape" },
    stemTwist: { type: "slider", label: "Stem Twist", default: 0.2, min: 0, max: 5, group: "Shape" },
    stemWaist: { type: "slider", label: "Stem Waist", default: 0.55, min: 0.1, max: 0.9, group: "Shape" },
    capSharpness: { type: "slider", label: "Cap Sharpness", default: 5, min: 2, max: 20, group: "Shape" },
    capSag: { type: "slider", label: "Cap Sag", default: 0.5, min: 0.1, max: 1, group: "Shape" },
    colonyOffset: { type: "xy", label: "Colony Offset", default: [0, 0], min: -1.5, max: 1.5, group: "Position" },
  },
  layers: (p): LayerConfig[] => {
    const v = p.values;
    const mushroomCount = Math.round(v.count as number);
    const colonySpread = v.colonySpread as number;
    const capSize = v.capSize as number;
    const stemHeight = v.stemHeight as number;
    const stemTwist = v.stemTwist as number;
    const stemWaist = v.stemWaist as number;
    const capSharpness = v.capSharpness as number;
    const capSag = v.capSag as number;
    const colonyOffset = v.colonyOffset as [number, number];

    // Deterministic positions — procedurally generated for any count
    const positions: { x: number; z: number; s: number; h: number }[] = [
      { x: 0, z: 0, s: 1.0, h: 1.0 },
      { x: 1.0, z: 0.23, s: 0.6, h: 0.6 },
      { x: -0.82, z: 0.45, s: 0.7, h: 0.72 },
      { x: 0.36, z: -0.91, s: 0.5, h: 0.48 },
      { x: -0.45, z: -0.68, s: 0.45, h: 0.4 },
      { x: 0.7, z: 0.7, s: 0.55, h: 0.55 },
      { x: -1.0, z: -0.3, s: 0.4, h: 0.35 },
      { x: 0.2, z: 0.95, s: 0.5, h: 0.5 },
      { x: -0.5, z: 0.85, s: 0.35, h: 0.3 },
    ];
    // Generate additional positions using golden angle for counts > 9
    const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
    for (let i = positions.length; i < mushroomCount; i++) {
      const angle = i * GOLDEN_ANGLE;
      const r = 0.3 + 0.7 * Math.sqrt(i / mushroomCount);
      const sizeFactor = 0.2 + 0.4 * (1 - i / mushroomCount);
      positions.push({
        x: r * Math.cos(angle),
        z: r * Math.sin(angle),
        s: sizeFactor,
        h: sizeFactor * 0.9,
      });
    }

    const layers: LayerConfig[] = [];
    for (let i = 0; i < mushroomCount && i < positions.length; i++) {
      const m = positions[i];
      const mx = m.x * colonySpread + colonyOffset[0];
      const mz = m.z * colonySpread + colonyOffset[1];
      const mh = stemHeight * m.h;
      const ms = capSize * m.s;
      layers.push({
        surface: "hyperboloid",
        params: { radius: 0.3 * ms, height: mh, twist: stemTwist, waist: stemWaist },
        hatch: { ...p.hatchParams, family: p.hatchParams.family ?? "v" },
        transform: { x: mx, z: mz, y: -mh * 0.25 },
        group: "Stems",
      });
      layers.push({
        surface: "canopy",
        params: { radius: ms, sag: capSag * ms, sharpness: capSharpness, yOffset: mh * 0.25 },
        hatch: { ...p.hatchParams, family: p.hatchParams.family ?? "u" },
        transform: { x: mx, z: mz },
        group: "Caps",
      });
    }
    return layers;
  },
};
export default mushroomColony;
