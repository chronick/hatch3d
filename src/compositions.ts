import type { HatchParams } from "./hatch";

export interface LayerConfig {
  surface: string;
  params?: Record<string, number>;
  hatch: HatchParams;
  transform?: { x?: number; y?: number; z?: number };
}

interface CompositionInput {
  surface: string;
  surfaceParams: Record<string, number>;
  hatchParams: HatchParams;
}

export interface Composition {
  name: string;
  layers: (input: CompositionInput) => LayerConfig[];
}

export const COMPOSITIONS: Record<string, Composition> = {
  single: {
    name: "Single Surface",
    layers: (p) => [
      { surface: p.surface, params: p.surfaceParams, hatch: p.hatchParams },
    ],
  },
  towerAndBase: {
    name: "Tower + Base",
    layers: () => [
      {
        surface: "canopy",
        params: { radius: 2.2, sag: 0.6, sharpness: 4, yOffset: 1.8 },
        hatch: { family: "u", count: 35, samples: 50 },
      },
      {
        surface: "torus",
        params: { majorR: 1.8, minorR: 0.12, ySquish: 0.2 },
        hatch: { family: "u", count: 20, samples: 40 },
        transform: { y: 0 },
      },
      {
        surface: "hyperboloid",
        params: { radius: 0.5, height: 3, twist: 0.5, waist: 0.6 },
        hatch: { family: "v", count: 18, samples: 50 },
        transform: { y: 0 },
      },
      {
        surface: "canopy",
        params: { radius: 2, sag: 0.5, sharpness: 3, yOffset: -1.8 },
        hatch: { family: "u", count: 30, samples: 50 },
      },
    ],
  },
  doubleRing: {
    name: "Double Ring",
    layers: () => [
      {
        surface: "torus",
        params: { majorR: 2, minorR: 0.15, ySquish: 0.3 },
        hatch: { family: "u", count: 25, samples: 40 },
        transform: { y: 1.3 },
      },
      {
        surface: "torus",
        params: { majorR: 2, minorR: 0.15, ySquish: 0.3 },
        hatch: { family: "u", count: 25, samples: 40 },
        transform: { y: -1.3 },
      },
      {
        surface: "conoid",
        params: { height: 2.5, spread: 1.8, fanAngle: 1.2 },
        hatch: { family: "v", count: 20, samples: 40 },
        transform: { y: 0 },
      },
    ],
  },
  crystalSpire: {
    name: "Crystal Spire",
    layers: () => [
      {
        surface: "twistedRibbon",
        params: { twist: 2.5, width: 0.8, height: 5, bulge: 0.4 },
        hatch: { family: "u", count: 40, samples: 60 },
      },
      {
        surface: "twistedRibbon",
        params: { twist: -1.5, width: 1.2, height: 5, bulge: 0.2 },
        hatch: { family: "v", count: 25, samples: 60 },
      },
    ],
  },
};
