import type { Composition3DDefinition, LayerConfig } from "../../types";

const starburst: Composition3DDefinition = {
  id: "starburst",
  name: "Starburst",
  description: "Radial conoid arms emanating from a central torus hub",
  tags: ["geometric", "radial"],
  category: "3d",
  hatchGroups: ["Hub", "Arms"],
  macros: {
    density: {
      label: "Density",
      default: 0.5,
      targets: [
        { param: "arms", fn: "linear", strength: 0.6 },
      ],
    },
    scale: {
      label: "Scale",
      default: 0.5,
      targets: [
        { param: "reach", fn: "linear", strength: 1.0 },
        { param: "hubSize", fn: "linear", strength: 1.0 },
      ],
    },
    chaos: {
      label: "Chaos",
      default: 0.5,
      targets: [
        { param: "spreadVariation", fn: "exp", strength: 1.0 },
        { param: "heightVariation", fn: "exp", strength: 1.0 },
        { param: "fanAngleVariation", fn: "exp", strength: 1.0 },
      ],
    },
  },
  controls: {
    arms: { type: "slider", label: "Arms", default: 8, min: 3, max: 16, step: 1, group: "Structure" },
    reach: { type: "slider", label: "Reach", default: 1.8, min: 0.5, max: 3.5, group: "Structure" },
    hubSize: { type: "slider", label: "Hub Size", default: 0.5, min: 0.15, max: 1.5, group: "Structure" },
    armHeight: { type: "slider", label: "Arm Height", default: 0.3, min: 0.1, max: 1.0, group: "Shape" },
    heightVariation: { type: "slider", label: "Height Var.", default: 0.2, min: 0, max: 0.5, group: "Shape" },
    spreadVariation: { type: "slider", label: "Spread Var.", default: 0.4, min: 0, max: 1.5, group: "Shape" },
    baseFanAngle: { type: "slider", label: "Fan Angle", default: 0.4, min: 0.1, max: 1.5, group: "Shape" },
    fanAngleVariation: { type: "slider", label: "Fan Var.", default: 0.15, min: 0, max: 0.5, group: "Shape" },
    hubThickness: { type: "slider", label: "Hub Thickness", default: 0.15, min: 0.03, max: 0.4, group: "Shape" },
    armOffset: { type: "xy", label: "Arm Offset", default: [0, 0], min: -1.0, max: 1.0, group: "Position" },
  },
  layers: (p): LayerConfig[] => {
    const v = p.values;
    const armCount = Math.round(v.arms as number);
    const reach = v.reach as number;
    const hubSize = v.hubSize as number;
    const armHeight = v.armHeight as number;
    const heightVariation = v.heightVariation as number;
    const spreadVariation = v.spreadVariation as number;
    const baseFanAngle = v.baseFanAngle as number;
    const fanAngleVariation = v.fanAngleVariation as number;
    const hubThickness = v.hubThickness as number;
    const armOffset = v.armOffset as [number, number];

    const layers: LayerConfig[] = [];
    const armFamilies: Array<"u" | "v" | "diagonal"> = ["diagonal", "u", "v"];
    layers.push({
      surface: "torus",
      params: { majorR: hubSize, minorR: hubThickness, ySquish: 0.6 },
      hatch: { ...p.hatchParams, family: p.hatchParams.family ?? "u" },
      transform: { x: armOffset[0], z: armOffset[1] },
      group: "Hub",
    });
    for (let i = 0; i < armCount; i++) {
      const angle = (i / armCount) * Math.PI * 2;
      const armReach = reach + spreadVariation * Math.sin(i * 1.7);
      layers.push({
        surface: "conoid",
        params: {
          height: armHeight + heightVariation * Math.cos(i * 2.3),
          spread: armReach,
          fanAngle: baseFanAngle + fanAngleVariation * Math.sin(i * 1.3),
        },
        hatch: { ...p.hatchParams, family: p.hatchParams.family ?? armFamilies[i % 3] },
        transform: {
          x: armOffset[0] + hubSize * Math.cos(angle),
          z: armOffset[1] + hubSize * Math.sin(angle),
          y: armHeight * Math.sin(i * 0.9),
        },
        group: "Arms",
      });
    }
    return layers;
  },
};
export default starburst;
