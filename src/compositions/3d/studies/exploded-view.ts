import type { Composition3DDefinition, LayerConfig } from "../../types";

const explodedView: Composition3DDefinition = {
  id: "explodedView",
  name: "Exploded View",
  description:
    "Technical drawing style: same surface repeated at different scales, separated vertically with distinct hatch families per tier",
  tags: ["study", "technical", "exploded", "architectural"],
  category: "3d",
  hatchGroups: ["Tiers", "Connectors"],

  macros: {
    separation: {
      label: "Separation",
      default: 0.5,
      targets: [{ param: "tierSpacing", fn: "linear", strength: 1.0 }],
    },
    scale: {
      label: "Scale",
      default: 0.5,
      targets: [
        { param: "baseRadius", fn: "linear", strength: 1.0 },
        { param: "baseHeight", fn: "linear", strength: 1.0 },
      ],
    },
    density: {
      label: "Density",
      default: 0.5,
      targets: [{ param: "hatchCount", fn: "linear", strength: 0.7 }],
    },
  },

  controls: {
    tiers: {
      type: "slider",
      label: "Tiers",
      default: 4,
      min: 2,
      max: 20,
      step: 1,
      group: "Structure",
    },
    tierSpacing: {
      type: "slider",
      label: "Tier Spacing",
      default: 2.5,
      min: 1.0,
      max: 12.0,
      group: "Structure",
    },
    scaleDecay: {
      type: "slider",
      label: "Scale Decay",
      default: 0.75,
      min: 0.4,
      max: 1.0,
      step: 0.01,
      group: "Structure",
    },
    baseRadius: {
      type: "slider",
      label: "Base Radius",
      default: 2.0,
      min: 0.8,
      max: 6.0,
      group: "Shape",
    },
    baseHeight: {
      type: "slider",
      label: "Base Height",
      default: 2.5,
      min: 1.0,
      max: 8.0,
      group: "Shape",
    },
    twist: {
      type: "slider",
      label: "Twist",
      default: 1.2,
      min: 0,
      max: 10.0,
      group: "Shape",
    },
    waist: {
      type: "slider",
      label: "Waist",
      default: 0.35,
      min: 0,
      max: 1.0,
      group: "Shape",
    },
    hatchCount: {
      type: "slider",
      label: "Hatch Lines",
      default: 25,
      min: 8,
      max: 150,
      step: 1,
      group: "Hatching",
    },
    showConnectors: {
      type: "toggle",
      label: "Connectors",
      default: true,
      group: "Visibility",
    },
  },

  layers: (p): LayerConfig[] => {
    const v = p.values;
    const tierCount = Math.round(v.tiers as number);
    const tierSpacing = v.tierSpacing as number;
    const scaleDecay = v.scaleDecay as number;
    const baseRadius = v.baseRadius as number;
    const baseHeight = v.baseHeight as number;
    const twist = v.twist as number;
    const waist = v.waist as number;
    const hatchCount = Math.round(v.hatchCount as number);
    const showConnectors = v.showConnectors as boolean;

    const layers: LayerConfig[] = [];
    const families: Array<"u" | "v" | "diagonal" | "rings" | "crosshatch"> = [
      "v",
      "u",
      "diagonal",
      "crosshatch",
      "rings",
    ];

    // Center the stack vertically
    const totalHeight = (tierCount - 1) * tierSpacing;
    const startY = -totalHeight / 2;

    for (let i = 0; i < tierCount; i++) {
      const scale = Math.pow(scaleDecay, i);
      const yPos = startY + i * tierSpacing;

      // Each tier is the same surface at decreasing scale
      layers.push({
        surface: "hyperboloid",
        params: {
          radius: baseRadius * scale,
          height: baseHeight * scale,
          twist: twist * (1 + i * 0.15),
          waist,
        },
        hatch: {
          ...p.hatchParams,
          family: p.hatchParams.family ?? families[i % families.length],
          count: hatchCount,
        },
        transform: { y: yPos },
        group: "Tiers",
      });
    }

    // Thin vertical connectors between tiers (using narrow twisted ribbons)
    if (showConnectors && tierCount > 1) {
      for (let i = 0; i < tierCount - 1; i++) {
        const yBottom = startY + i * tierSpacing;
        const yTop = startY + (i + 1) * tierSpacing;
        const yMid = (yBottom + yTop) / 2;
        const connectorHeight = tierSpacing * 0.6;

        layers.push({
          surface: "twistedRibbon",
          params: {
            twist: 0.5,
            width: 0.08,
            height: connectorHeight,
            bulge: 0,
          },
          hatch: {
            family: "v",
            count: 4,
            samples: 40,
          },
          transform: { y: yMid },
          group: "Connectors",
        });
      }
    }

    return layers;
  },
};

export default explodedView;
