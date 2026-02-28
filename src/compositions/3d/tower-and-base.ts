import type { Composition3DDefinition, LayerConfig } from "../types";

const towerAndBase: Composition3DDefinition = {
  id: "towerAndBase",
  name: "Tower + Base",
  description: "Hyperboloid tower with angular canopy caps and torus ring",
  tags: ["architectural", "geometric", "multi-layer"],
  category: "3D/Architectural",
  hatchGroups: ["Canopy", "Ring", "Tower"],
  macros: {
    scale: {
      label: "Scale",
      default: 0.5,
      targets: [
        { param: "canopyRadius", fn: "linear", strength: 1.0 },
        { param: "ringSize", fn: "linear", strength: 1.0 },
        { param: "towerRadius", fn: "linear", strength: 1.0 },
      ],
    },
    height: {
      label: "Height",
      default: 0.5,
      targets: [
        { param: "towerHeight", fn: "linear", strength: 1.0 },
        { param: "canopySag", fn: "linear", strength: 1.0 },
      ],
    },
    complexity: {
      label: "Complexity",
      default: 0.5,
      targets: [
        { param: "capSharpness", fn: "exp", strength: 0.8 },
        { param: "towerTwist", fn: "exp", strength: 0.8 },
      ],
    },
  },
  controls: {
    towerHeight: { type: "slider", label: "Tower Height", default: 3, min: 1.5, max: 5, group: "Structure" },
    capSharpness: { type: "slider", label: "Cap Sharpness", default: 4, min: 1, max: 8, group: "Structure" },
    canopyRadius: { type: "slider", label: "Canopy Radius", default: 2.2, min: 1, max: 3.5, group: "Shape" },
    canopySag: { type: "slider", label: "Canopy Sag", default: 0.6, min: 0.1, max: 1.5, group: "Shape" },
    ringSize: { type: "slider", label: "Ring Size", default: 1.8, min: 0.5, max: 3, group: "Shape" },
    ringThickness: { type: "slider", label: "Ring Thickness", default: 0.12, min: 0.03, max: 0.4, group: "Shape" },
    towerRadius: { type: "slider", label: "Tower Radius", default: 0.5, min: 0.2, max: 1.5, group: "Shape" },
    towerTwist: { type: "slider", label: "Tower Twist", default: 0.5, min: 0, max: 3, group: "Shape" },
    towerWaist: { type: "slider", label: "Tower Waist", default: 0.6, min: 0, max: 1, group: "Shape" },
    showRing: { type: "toggle", label: "Show Ring", default: true, group: "Visibility" },
    showTower: { type: "toggle", label: "Show Tower", default: true, group: "Visibility" },
  },
  layers: (p): LayerConfig[] => {
    const v = p.values;
    const canopyRadius = v.canopyRadius as number;
    const canopySag = v.canopySag as number;
    const capSharpness = v.capSharpness as number;
    const towerHeight = v.towerHeight as number;
    const ringSize = v.ringSize as number;
    const ringThickness = v.ringThickness as number;
    const towerRadius = v.towerRadius as number;
    const towerTwist = v.towerTwist as number;
    const towerWaist = v.towerWaist as number;
    const showRing = v.showRing as boolean;
    const showTower = v.showTower as boolean;

    const layers: LayerConfig[] = [
      {
        surface: "canopy",
        params: { radius: canopyRadius, sag: canopySag, sharpness: capSharpness, yOffset: towerHeight * 0.6 },
        hatch: { ...p.hatchParams, family: p.hatchParams.family ?? "u" },
        group: "Canopy",
      },
    ];
    if (showRing) {
      layers.push({
        surface: "torus",
        params: { majorR: ringSize, minorR: ringThickness, ySquish: 0.2 },
        hatch: { ...p.hatchParams, family: p.hatchParams.family ?? "u" },
        transform: { y: 0 },
        group: "Ring",
      });
    }
    if (showTower) {
      layers.push({
        surface: "hyperboloid",
        params: { radius: towerRadius, height: towerHeight, twist: towerTwist, waist: towerWaist },
        hatch: { ...p.hatchParams, family: p.hatchParams.family ?? "v" },
        transform: { y: 0 },
        group: "Tower",
      });
    }
    layers.push({
      surface: "canopy",
      params: { radius: canopyRadius * 0.9, sag: canopySag * 0.83, sharpness: capSharpness * 0.75, yOffset: -towerHeight * 0.6 },
      hatch: { ...p.hatchParams, family: p.hatchParams.family ?? "u" },
      group: "Canopy",
    });
    return layers;
  },
};
export default towerAndBase;
