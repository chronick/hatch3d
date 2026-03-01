import type { Composition3DDefinition, LayerConfig } from "../../types";

const engravingStudy: Composition3DDefinition = {
  id: "engravingStudy",
  name: "Engraving Study",
  description:
    "Single surface rendered in old-master engraving style with multi-layer cross-hatching at progressive angles for tonal depth",
  tags: ["study", "engraving", "tonal", "classical"],
  category: "3d",
  hatchGroups: ["Primary", "Cross 1", "Cross 2", "Cross 3"],

  macros: {
    density: {
      label: "Density",
      default: 0.5,
      targets: [
        { param: "primaryCount", fn: "linear", strength: 0.8 },
        { param: "cross1Count", fn: "linear", strength: 0.8 },
        { param: "cross2Count", fn: "linear", strength: 0.8 },
        { param: "cross3Count", fn: "linear", strength: 0.8 },
      ],
    },
    scale: {
      label: "Scale",
      default: 0.5,
      targets: [
        { param: "radius", fn: "linear", strength: 1.0 },
        { param: "height", fn: "linear", strength: 1.0 },
      ],
    },
    complexity: {
      label: "Complexity",
      default: 0.5,
      targets: [
        { param: "twist", fn: "exp", strength: 0.8 },
        { param: "waist", fn: "linear", strength: 0.6 },
      ],
    },
  },

  controls: {
    surfaceType: {
      type: "select",
      label: "Surface",
      default: "torus",
      options: [
        { label: "Torus", value: "torus" },
        { label: "Hyperboloid", value: "hyperboloid" },
        { label: "Canopy", value: "canopy" },
        { label: "Conoid", value: "conoid" },
      ],
      group: "Surface",
    },
    radius: {
      type: "slider",
      label: "Radius",
      default: 2.0,
      min: 0.8,
      max: 6.0,
      group: "Surface",
    },
    height: {
      type: "slider",
      label: "Height",
      default: 3.0,
      min: 1.0,
      max: 10.0,
      group: "Surface",
    },
    twist: {
      type: "slider",
      label: "Twist",
      default: 1.0,
      min: 0,
      max: 10.0,
      group: "Surface",
    },
    waist: {
      type: "slider",
      label: "Waist",
      default: 0.4,
      min: 0,
      max: 1.0,
      group: "Surface",
    },
    primaryCount: {
      type: "slider",
      label: "Primary Lines",
      default: 35,
      min: 10,
      max: 200,
      step: 1,
      group: "Hatching",
    },
    primaryAngle: {
      type: "slider",
      label: "Primary Angle",
      default: 0.78,
      min: 0,
      max: 3.14,
      step: 0.01,
      group: "Hatching",
    },
    cross1Count: {
      type: "slider",
      label: "Cross 1 Lines",
      default: 25,
      min: 0,
      max: 150,
      step: 1,
      group: "Hatching",
    },
    cross2Count: {
      type: "slider",
      label: "Cross 2 Lines",
      default: 18,
      min: 0,
      max: 120,
      step: 1,
      group: "Hatching",
    },
    cross3Count: {
      type: "slider",
      label: "Cross 3 Lines",
      default: 12,
      min: 0,
      max: 100,
      step: 1,
      group: "Hatching",
    },
    samples: {
      type: "slider",
      label: "Samples",
      default: 80,
      min: 30,
      max: 300,
      step: 1,
      group: "Hatching",
    },
  },

  layers: (p): LayerConfig[] => {
    const v = p.values;
    const surfaceType = v.surfaceType as string;
    const radius = v.radius as number;
    const height = v.height as number;
    const twist = v.twist as number;
    const waist = v.waist as number;
    const primaryCount = Math.round(v.primaryCount as number);
    const primaryAngle = v.primaryAngle as number;
    const cross1Count = Math.round(v.cross1Count as number);
    const cross2Count = Math.round(v.cross2Count as number);
    const cross3Count = Math.round(v.cross3Count as number);
    const samples = Math.round(v.samples as number);

    // Map surface type to params
    const surfaceParams: Record<string, Record<string, number>> = {
      torus: { majorR: radius, minorR: radius * 0.15, ySquish: 0.3 },
      hyperboloid: { radius, height, twist, waist },
      canopy: { radius, sag: height * 0.3, sharpness: 5, yOffset: 0 },
      conoid: { height, spread: radius, fanAngle: 1.5 },
    };

    const params = surfaceParams[surfaceType] ?? surfaceParams.torus;
    const layers: LayerConfig[] = [];

    // Primary hatch — the dominant direction (like the engraver's first pass)
    layers.push({
      surface: surfaceType,
      params,
      hatch: {
        family: "diagonal",
        count: primaryCount,
        samples,
        angle: primaryAngle,
      },
      group: "Primary",
    });

    // Cross 1 — perpendicular to primary (first cross-hatch layer)
    if (cross1Count > 0) {
      layers.push({
        surface: surfaceType,
        params,
        hatch: {
          family: "diagonal",
          count: cross1Count,
          samples,
          angle: primaryAngle + Math.PI / 2,
        },
        group: "Cross 1",
      });
    }

    // Cross 2 — 45deg offset (adds medium-tone density)
    if (cross2Count > 0) {
      layers.push({
        surface: surfaceType,
        params,
        hatch: {
          family: "diagonal",
          count: cross2Count,
          samples,
          angle: primaryAngle + Math.PI / 4,
        },
        group: "Cross 2",
      });
    }

    // Cross 3 — remaining 45deg offset (fills in deepest shadows)
    if (cross3Count > 0) {
      layers.push({
        surface: surfaceType,
        params,
        hatch: {
          family: "diagonal",
          count: cross3Count,
          samples,
          angle: primaryAngle + (3 * Math.PI) / 4,
        },
        group: "Cross 3",
      });
    }

    return layers;
  },
};

export default engravingStudy;
