import type { HatchParams } from "../../../hatch";
import type { Composition3DDefinition, LayerConfig } from "../../types";

const multiTechnique: Composition3DDefinition = {
  id: "multiTechnique",
  name: "Multi-Technique Surface",
  description:
    "Single surface divided into UV regions, each rendered with a different hatch family and density for visual contrast",
  tags: ["study", "technique", "multi-hatch", "educational"],
  category: "3d",
  hatchGroups: ["Region A", "Region B", "Region C", "Region D"],

  macros: {
    density: {
      label: "Density",
      default: 0.5,
      targets: [
        { param: "countA", fn: "linear", strength: 0.8 },
        { param: "countB", fn: "linear", strength: 0.8 },
        { param: "countC", fn: "linear", strength: 0.8 },
        { param: "countD", fn: "linear", strength: 0.8 },
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
  },

  controls: {
    surfaceType: {
      type: "select",
      label: "Surface",
      default: "hyperboloid",
      options: [
        { label: "Hyperboloid", value: "hyperboloid" },
        { label: "Torus", value: "torus" },
        { label: "Canopy", value: "canopy" },
        { label: "Conoid", value: "conoid" },
        { label: "Twisted Ribbon", value: "twistedRibbon" },
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
      default: 3.5,
      min: 1.0,
      max: 10.0,
      group: "Surface",
    },
    layout: {
      type: "select",
      label: "Region Layout",
      default: "quadrants",
      options: [
        { label: "Quadrants", value: "quadrants" },
        { label: "H-Strips", value: "hstrips" },
        { label: "V-Strips", value: "vstrips" },
      ],
      group: "Layout",
    },
    boundary: {
      type: "slider",
      label: "Region Boundary",
      default: 0.5,
      min: 0.2,
      max: 0.8,
      step: 0.05,
      group: "Layout",
    },
    familyA: {
      type: "select",
      label: "Region A Family",
      default: "u",
      options: [
        { label: "U-lines", value: "u" },
        { label: "V-lines", value: "v" },
        { label: "Diagonal", value: "diagonal" },
        { label: "Crosshatch", value: "crosshatch" },
        { label: "Rings", value: "rings" },
        { label: "Wave", value: "wave" },
      ],
      group: "Techniques",
    },
    familyB: {
      type: "select",
      label: "Region B Family",
      default: "crosshatch",
      options: [
        { label: "U-lines", value: "u" },
        { label: "V-lines", value: "v" },
        { label: "Diagonal", value: "diagonal" },
        { label: "Crosshatch", value: "crosshatch" },
        { label: "Rings", value: "rings" },
        { label: "Wave", value: "wave" },
      ],
      group: "Techniques",
    },
    familyC: {
      type: "select",
      label: "Region C Family",
      default: "diagonal",
      options: [
        { label: "U-lines", value: "u" },
        { label: "V-lines", value: "v" },
        { label: "Diagonal", value: "diagonal" },
        { label: "Crosshatch", value: "crosshatch" },
        { label: "Rings", value: "rings" },
        { label: "Wave", value: "wave" },
      ],
      group: "Techniques",
    },
    familyD: {
      type: "select",
      label: "Region D Family",
      default: "wave",
      options: [
        { label: "U-lines", value: "u" },
        { label: "V-lines", value: "v" },
        { label: "Diagonal", value: "diagonal" },
        { label: "Crosshatch", value: "crosshatch" },
        { label: "Rings", value: "rings" },
        { label: "Wave", value: "wave" },
      ],
      group: "Techniques",
    },
    countA: {
      type: "slider",
      label: "Density A",
      default: 25,
      min: 5,
      max: 100,
      step: 1,
      group: "Density",
    },
    countB: {
      type: "slider",
      label: "Density B",
      default: 20,
      min: 5,
      max: 100,
      step: 1,
      group: "Density",
    },
    countC: {
      type: "slider",
      label: "Density C",
      default: 30,
      min: 5,
      max: 100,
      step: 1,
      group: "Density",
    },
    countD: {
      type: "slider",
      label: "Density D",
      default: 15,
      min: 5,
      max: 100,
      step: 1,
      group: "Density",
    },
    samples: {
      type: "slider",
      label: "Samples",
      default: 60,
      min: 20,
      max: 200,
      step: 1,
      group: "Quality",
    },
  },

  layers: (p): LayerConfig[] => {
    const v = p.values;
    const surfaceType = v.surfaceType as string;
    const radius = v.radius as number;
    const height = v.height as number;
    const layout = v.layout as string;
    const boundary = v.boundary as number;
    const samples = Math.round(v.samples as number);

    const families = [
      v.familyA as string,
      v.familyB as string,
      v.familyC as string,
      v.familyD as string,
    ];
    const counts = [
      Math.round(v.countA as number),
      Math.round(v.countB as number),
      Math.round(v.countC as number),
      Math.round(v.countD as number),
    ];
    const groupNames = ["Region A", "Region B", "Region C", "Region D"];

    const surfaceParams: Record<string, Record<string, number>> = {
      hyperboloid: { radius, height, twist: 1.2, waist: 0.4 },
      torus: { majorR: radius, minorR: radius * 0.15, ySquish: 0.3 },
      canopy: { radius, sag: height * 0.3, sharpness: 3, yOffset: 0 },
      conoid: { height, spread: radius, fanAngle: 1.5 },
      twistedRibbon: { twist: 2, width: radius * 0.6, height, bulge: 0.3 },
    };
    const params = surfaceParams[surfaceType] ?? surfaceParams.hyperboloid;

    // Compute UV regions based on layout
    type UVRegion = { uRange: [number, number]; vRange: [number, number] };
    let regions: UVRegion[];

    if (layout === "hstrips") {
      // 4 horizontal strips
      const b = boundary;
      regions = [
        { uRange: [0, 1], vRange: [0, b * 0.5] },
        { uRange: [0, 1], vRange: [b * 0.5, b] },
        { uRange: [0, 1], vRange: [b, b + (1 - b) * 0.5] },
        { uRange: [0, 1], vRange: [b + (1 - b) * 0.5, 1] },
      ];
    } else if (layout === "vstrips") {
      // 4 vertical strips
      const b = boundary;
      regions = [
        { uRange: [0, b * 0.5], vRange: [0, 1] },
        { uRange: [b * 0.5, b], vRange: [0, 1] },
        { uRange: [b, b + (1 - b) * 0.5], vRange: [0, 1] },
        { uRange: [b + (1 - b) * 0.5, 1], vRange: [0, 1] },
      ];
    } else {
      // Quadrants split at boundary
      regions = [
        { uRange: [0, boundary], vRange: [0, boundary] },
        { uRange: [boundary, 1], vRange: [0, boundary] },
        { uRange: [0, boundary], vRange: [boundary, 1] },
        { uRange: [boundary, 1], vRange: [boundary, 1] },
      ];
    }

    const layers: LayerConfig[] = [];
    for (let i = 0; i < 4; i++) {
      layers.push({
        surface: surfaceType,
        params,
        hatch: {
          family: families[i] as HatchParams["family"] ?? "u",
          count: counts[i],
          samples,
          uRange: regions[i].uRange,
          vRange: regions[i].vRange,
          angle: i * 0.4,
        },
        group: groupNames[i],
      });
    }

    return layers;
  },
};

export default multiTechnique;
