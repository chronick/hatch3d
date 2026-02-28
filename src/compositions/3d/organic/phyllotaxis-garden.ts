import type { Composition3DDefinition, LayerConfig } from "../../types";

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5)); // ~137.508 degrees in radians

const phyllotaxisGarden: Composition3DDefinition = {
  id: "phyllotaxisGarden",
  name: "Phyllotaxis Garden",
  description:
    "Surfaces arranged in Fibonacci spiral pattern (golden angle), creating a natural garden-like colony",
  tags: ["organic", "fibonacci", "phyllotaxis", "natural"],
  category: "3d",
  hatchGroups: ["Caps", "Stems"],

  macros: {
    scale: {
      label: "Scale",
      default: 0.5,
      targets: [
        { param: "capSize", fn: "linear", strength: 1.0 },
        { param: "stemHeight", fn: "linear", strength: 1.0 },
        { param: "spread", fn: "linear", strength: 0.8 },
      ],
    },
    density: {
      label: "Density",
      default: 0.5,
      targets: [{ param: "count", fn: "linear", strength: 0.6 }],
    },
    variety: {
      label: "Variety",
      default: 0.5,
      targets: [
        { param: "sizeVariation", fn: "linear", strength: 0.8 },
        { param: "capSharpness", fn: "exp", strength: 0.5 },
      ],
    },
  },

  controls: {
    count: {
      type: "slider",
      label: "Count",
      default: 13,
      min: 3,
      max: 34,
      step: 1,
      group: "Structure",
    },
    spread: {
      type: "slider",
      label: "Spread",
      default: 0.55,
      min: 0.2,
      max: 1.2,
      step: 0.01,
      group: "Structure",
    },
    sizeVariation: {
      type: "slider",
      label: "Size Variation",
      default: 0.6,
      min: 0,
      max: 1.0,
      step: 0.01,
      group: "Structure",
    },
    capSize: {
      type: "slider",
      label: "Cap Size",
      default: 0.9,
      min: 0.3,
      max: 2.0,
      group: "Shape",
    },
    capSharpness: {
      type: "slider",
      label: "Cap Sharpness",
      default: 5,
      min: 1,
      max: 10,
      step: 1,
      group: "Shape",
    },
    capSag: {
      type: "slider",
      label: "Cap Sag",
      default: 0.45,
      min: 0.1,
      max: 1.2,
      group: "Shape",
    },
    stemHeight: {
      type: "slider",
      label: "Stem Height",
      default: 1.8,
      min: 0.3,
      max: 3.5,
      group: "Shape",
    },
    stemWaist: {
      type: "slider",
      label: "Stem Waist",
      default: 0.5,
      min: 0.1,
      max: 0.9,
      group: "Shape",
    },
    showStems: {
      type: "toggle",
      label: "Show Stems",
      default: true,
      group: "Visibility",
    },
  },

  layers: (p): LayerConfig[] => {
    const v = p.values;
    const count = Math.round(v.count as number);
    const spread = v.spread as number;
    const sizeVariation = v.sizeVariation as number;
    const capSize = v.capSize as number;
    const capSharpness = v.capSharpness as number;
    const capSag = v.capSag as number;
    const stemHeight = v.stemHeight as number;
    const stemWaist = v.stemWaist as number;
    const showStems = v.showStems as boolean;

    const layers: LayerConfig[] = [];
    const capFamilies: Array<"u" | "v" | "rings" | "diagonal"> = [
      "u",
      "rings",
      "diagonal",
      "v",
    ];

    for (let i = 0; i < count; i++) {
      // Fermat spiral with golden angle
      const angle = i * GOLDEN_ANGLE;
      const r = spread * Math.sqrt(i);
      const x = r * Math.cos(angle);
      const z = r * Math.sin(angle);

      // Size decreases from center outward (largest in center)
      // First element is always full size, then decay based on distance
      const distFactor = count > 1 ? i / (count - 1) : 0;
      const sizeScale = 1 - distFactor * sizeVariation;
      const cs = capSize * sizeScale;
      const sh = stemHeight * sizeScale;

      // Cap
      layers.push({
        surface: "canopy",
        params: {
          radius: cs,
          sag: capSag * cs,
          sharpness: capSharpness,
          yOffset: sh * 0.35,
        },
        hatch: {
          ...p.hatchParams,
          family: p.hatchParams.family ?? capFamilies[i % capFamilies.length],
        },
        transform: { x, z },
        group: "Caps",
      });

      // Stem
      if (showStems) {
        layers.push({
          surface: "hyperboloid",
          params: {
            radius: 0.15 * cs,
            height: sh,
            twist: 0.2,
            waist: stemWaist,
          },
          hatch: {
            ...p.hatchParams,
            family: p.hatchParams.family ?? "v",
          },
          transform: { x, z, y: -sh * 0.15 },
          group: "Stems",
        });
      }
    }

    return layers;
  },
};

export default phyllotaxisGarden;
