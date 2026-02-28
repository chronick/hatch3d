import type { Composition3DDefinition, LayerConfig } from "../../types";

const atmosphericDepth: Composition3DDefinition = {
  id: "atmosphericDepth",
  name: "Atmospheric Depth",
  description:
    "Identical surfaces at increasing depth with progressively sparser hatching, demonstrating atmospheric perspective through line density alone",
  tags: ["study", "atmospheric", "depth", "perspective"],
  category: "3d",
  hatchGroups: ["Foreground", "Midground", "Background"],

  macros: {
    density: {
      label: "Density",
      default: 0.5,
      targets: [{ param: "frontCount", fn: "linear", strength: 0.8 }],
    },
    scale: {
      label: "Scale",
      default: 0.5,
      targets: [
        { param: "radius", fn: "linear", strength: 1.0 },
        { param: "height", fn: "linear", strength: 1.0 },
      ],
    },
    fade: {
      label: "Fade",
      default: 0.5,
      targets: [
        { param: "densityFalloff", fn: "linear", strength: 0.8 },
        { param: "depthSpacing", fn: "linear", strength: 0.6 },
      ],
    },
  },

  controls: {
    planes: {
      type: "slider",
      label: "Depth Planes",
      default: 4,
      min: 2,
      max: 7,
      step: 1,
      group: "Structure",
    },
    depthSpacing: {
      type: "slider",
      label: "Depth Spacing",
      default: 2.5,
      min: 1.0,
      max: 5.0,
      group: "Structure",
    },
    densityFalloff: {
      type: "slider",
      label: "Density Falloff",
      default: 0.55,
      min: 0.2,
      max: 0.9,
      step: 0.01,
      group: "Structure",
    },
    surfaceType: {
      type: "select",
      label: "Surface",
      default: "torus",
      options: [
        { label: "Torus", value: "torus" },
        { label: "Hyperboloid", value: "hyperboloid" },
        { label: "Canopy", value: "canopy" },
      ],
      group: "Shape",
    },
    radius: {
      type: "slider",
      label: "Radius",
      default: 1.8,
      min: 0.5,
      max: 3.0,
      group: "Shape",
    },
    height: {
      type: "slider",
      label: "Height",
      default: 2.5,
      min: 1.0,
      max: 4.0,
      group: "Shape",
    },
    frontCount: {
      type: "slider",
      label: "Front Hatch Lines",
      default: 40,
      min: 15,
      max: 80,
      step: 1,
      group: "Hatching",
    },
    lateralSpread: {
      type: "slider",
      label: "Lateral Spread",
      default: 0,
      min: 0,
      max: 3.0,
      group: "Position",
    },
  },

  layers: (p): LayerConfig[] => {
    const v = p.values;
    const planeCount = Math.round(v.planes as number);
    const depthSpacing = v.depthSpacing as number;
    const densityFalloff = v.densityFalloff as number;
    const surfaceType = v.surfaceType as string;
    const radius = v.radius as number;
    const height = v.height as number;
    const frontCount = Math.round(v.frontCount as number);
    const lateralSpread = v.lateralSpread as number;

    const surfaceParams: Record<string, Record<string, number>> = {
      torus: { majorR: radius, minorR: radius * 0.12, ySquish: 0.3 },
      hyperboloid: { radius, height, twist: 1.0, waist: 0.35 },
      canopy: { radius, sag: height * 0.3, sharpness: 5, yOffset: 0 },
    };

    const params = surfaceParams[surfaceType] ?? surfaceParams.torus;
    const layers: LayerConfig[] = [];
    const families: Array<"u" | "v" | "diagonal" | "crosshatch"> = [
      "crosshatch",
      "diagonal",
      "u",
      "v",
    ];

    // Group names for 3-tier labeling
    const groupNames = ["Foreground", "Midground", "Background"];

    for (let i = 0; i < planeCount; i++) {
      const t = planeCount > 1 ? i / (planeCount - 1) : 0;

      // Hatch density decays exponentially with depth
      const density = Math.pow(densityFalloff, i);
      const count = Math.max(3, Math.round(frontCount * density));

      // Z position: deeper planes are further back
      const z = -i * depthSpacing;

      // Optional lateral spread (stagger in X)
      const x = lateralSpread > 0 ? (i % 2 === 0 ? 1 : -1) * lateralSpread * t : 0;

      // Group assignment: first = Foreground, last = Background, middle = Midground
      let group: string;
      if (i === 0) group = groupNames[0];
      else if (i === planeCount - 1) group = groupNames[2];
      else group = groupNames[1];

      layers.push({
        surface: surfaceType,
        params,
        hatch: {
          ...p.hatchParams,
          family: p.hatchParams.family ?? families[i % families.length],
          count,
        },
        transform: { z, x },
        group,
      });
    }

    return layers;
  },
};

export default atmosphericDepth;
