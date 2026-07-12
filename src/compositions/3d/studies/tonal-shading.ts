import type { Composition3DDefinition, LayerConfig } from "../../types";
import { tonalHatchLayers } from "../../helpers-lighting";
import { SURFACES } from "../../../surfaces";

/**
 * Tonal shading study — Krbn-style light-clipped cross-hatching.
 *
 * Instead of varying line count per region, each cross-hatch angle set is
 * clipped (point by point) to the part of the surface dark enough for it:
 * layer i of n covers where the Lambert term N·L < 0.95·(n−i)/n. Tone
 * emerges from how many angle sets overlap — the engraver's model where
 * form is direction and shading is density.
 */
const tonalShading: Composition3DDefinition = {
  id: "tonalShading",
  name: "Tonal Shading",
  description:
    "Light-driven cross-hatch shading: each hatch angle set is clipped to progressively darker surface regions, so tone builds where layers overlap",
  tags: ["study", "tonal", "lighting", "crosshatch", "krbn"],
  category: "3d",
  occlusionSensitive: true,

  macros: {
    density: {
      label: "Density",
      default: 0.5,
      targets: [{ param: "count", fn: "linear", strength: 0.8 }],
    },
    contrast: {
      label: "Contrast",
      default: 0.5,
      targets: [{ param: "toneLayers", fn: "linear", strength: 1.0 }],
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
        { label: "Twisted Ribbon", value: "twistedRibbon" },
        { label: "Conoid", value: "conoid" },
      ],
      group: "Surface",
    },
    lightAzimuth: {
      type: "slider",
      label: "Light Azimuth",
      default: 0.8,
      min: 0,
      max: 6.28,
      step: 0.01,
      group: "Light",
    },
    lightElevation: {
      type: "slider",
      label: "Light Elevation",
      default: 0.9,
      min: -1.57,
      max: 1.57,
      step: 0.01,
      group: "Light",
    },
    toneLayers: {
      type: "slider",
      label: "Tone Layers",
      default: 3,
      min: 1,
      max: 4,
      step: 1,
      group: "Hatching",
    },
    count: {
      type: "slider",
      label: "Lines / Layer",
      default: 60,
      min: 10,
      max: 200,
      step: 1,
      group: "Hatching",
    },
    baseAngle: {
      type: "slider",
      label: "Base Angle",
      default: 0.78,
      min: 0,
      max: 3.14,
      step: 0.01,
      group: "Hatching",
    },
    samples: {
      type: "slider",
      label: "Samples",
      default: 120,
      min: 40,
      max: 300,
      step: 1,
      group: "Hatching",
    },
  },

  layers: (p): LayerConfig[] => {
    const v = p.values;
    const surfaceType = v.surfaceType as string;
    const az = v.lightAzimuth as number;
    const el = v.lightElevation as number;
    const toneLayers = Math.round(v.toneLayers as number);
    const count = Math.round(v.count as number);
    const baseAngle = v.baseAngle as number;
    const samples = Math.round(v.samples as number);

    // Direction pointing toward the light
    const lightDir: [number, number, number] = [
      Math.cos(el) * Math.cos(az),
      Math.sin(el),
      Math.cos(el) * Math.sin(az),
    ];

    return tonalHatchLayers(
      surfaceType,
      SURFACES[surfaceType]?.defaults ?? p.surfaceParams,
      lightDir,
      { count, samples, angle: baseAngle },
      { layers: toneLayers, angle: baseAngle },
    );
  },
};

export default tonalShading;
