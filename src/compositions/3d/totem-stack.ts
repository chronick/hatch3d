import type { Composition3DDefinition, LayerConfig } from "../types";

const totemStack: Composition3DDefinition = {
  id: "totemStack",
  name: "Totem Stack",
  description: "Stacked tiers of alternating hyperboloids and tori with canopy caps",
  tags: ["architectural", "stacked"],
  category: "3D/Architectural",
  hatchGroups: ["Tiers", "Caps"],
  macros: {
    density: {
      label: "Density",
      default: 0.5,
      targets: [
        { param: "tiers", fn: "linear", strength: 0.6 },
      ],
    },
    scale: {
      label: "Scale",
      default: 0.5,
      targets: [
        { param: "baseSize", fn: "linear", strength: 1.0 },
        { param: "hyperboloidHeight", fn: "linear", strength: 1.0 },
        { param: "spacing", fn: "linear", strength: 1.0 },
      ],
    },
    complexity: {
      label: "Complexity",
      default: 0.5,
      targets: [
        { param: "twistGrowth", fn: "exp", strength: 0.8 },
        { param: "capSharpness", fn: "exp", strength: 0.8 },
      ],
    },
  },
  controls: {
    tiers: { type: "slider", label: "Tiers", default: 5, min: 2, max: 8, step: 1, group: "Structure" },
    spacing: { type: "slider", label: "Spacing", default: 1.5, min: 0.5, max: 3, group: "Structure" },
    baseSize: { type: "slider", label: "Base Size", default: 1.0, min: 0.5, max: 1.5, group: "Structure" },
    taper: { type: "slider", label: "Taper", default: 0.12, min: 0, max: 0.25, group: "Structure" },
    hyperboloidRadius: { type: "slider", label: "Hyp. Radius", default: 0.7, min: 0.3, max: 1.5, group: "Shape" },
    hyperboloidHeight: { type: "slider", label: "Hyp. Height", default: 1.3, min: 0.5, max: 2.5, group: "Shape" },
    baseTwist: { type: "slider", label: "Base Twist", default: 0.3, min: 0, max: 1.5, group: "Shape" },
    twistGrowth: { type: "slider", label: "Twist Growth", default: 0.4, min: 0, max: 1.5, group: "Shape" },
    capRadius: { type: "slider", label: "Cap Radius", default: 0.8, min: 0.3, max: 1.5, group: "Shape" },
    capSag: { type: "slider", label: "Cap Sag", default: 0.2, min: 0, max: 0.8, group: "Shape" },
    capSharpness: { type: "slider", label: "Cap Sharpness", default: 3, min: 1, max: 8, group: "Shape" },
    showCaps: { type: "toggle", label: "Show Caps", default: true, group: "Visibility" },
    tierShape: {
      type: "select",
      label: "Tier Shape",
      default: "mixed",
      options: [
        { label: "Mixed", value: "mixed" },
        { label: "All Hyperboloid", value: "allHyperboloid" },
        { label: "All Torus", value: "allTorus" },
      ],
      group: "Style",
    },
  },
  layers: (p): LayerConfig[] => {
    const v = p.values;
    const tierCount = Math.round(v.tiers as number);
    const tierSpacing = v.spacing as number;
    const baseSize = v.baseSize as number;
    const taper = v.taper as number;
    const hypRadius = v.hyperboloidRadius as number;
    const hypHeight = v.hyperboloidHeight as number;
    const baseTwist = v.baseTwist as number;
    const twistGrowth = v.twistGrowth as number;
    const capRadius = v.capRadius as number;
    const capSag = v.capSag as number;
    const capSharpness = v.capSharpness as number;
    const showCaps = v.showCaps as boolean;
    const tierShape = v.tierShape as string;

    const layers: LayerConfig[] = [];
    const tierFamilies: Array<"u" | "v" | "diagonal"> = ["v", "u", "diagonal"];
    for (let i = 0; i < tierCount; i++) {
      const yPos = -(tierCount - 1) * tierSpacing * 0.5 + i * tierSpacing;
      const scale = baseSize - i * taper;

      const useHyperboloid = tierShape === "allHyperboloid" || (tierShape === "mixed" && i % 2 === 0);
      const useTorus = tierShape === "allTorus" || (tierShape === "mixed" && i % 2 !== 0);

      if (useHyperboloid) {
        layers.push({
          surface: "hyperboloid",
          params: {
            radius: hypRadius * scale,
            height: hypHeight,
            twist: baseTwist + i * twistGrowth,
            waist: 0.3 + i * 0.08,
          },
          hatch: { ...p.hatchParams, family: p.hatchParams.family ?? "v" },
          transform: { y: yPos },
          group: "Tiers",
        });
      } else if (useTorus) {
        layers.push({
          surface: "torus",
          params: {
            majorR: 0.9 * scale,
            minorR: 0.12 * scale,
            ySquish: 0.4,
          },
          hatch: { ...p.hatchParams, family: p.hatchParams.family ?? "u" },
          transform: { y: yPos },
          group: "Tiers",
        });
      }
      if (showCaps) {
        layers.push({
          surface: "canopy",
          params: {
            radius: capRadius * scale,
            sag: capSag,
            sharpness: capSharpness + i,
            yOffset: yPos + hypHeight * 0.5,
          },
          hatch: { ...p.hatchParams, family: p.hatchParams.family ?? tierFamilies[i % 3] },
          group: "Caps",
        });
      }
    }
    return layers;
  },
};
export default totemStack;
