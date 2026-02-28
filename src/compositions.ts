import type { HatchParams } from "./hatch";

// ── Control type system ──

export type MacroFn = "linear" | "log" | "exp" | "sqrt";

export interface MacroTarget {
  param: string;
  fn: MacroFn;
  strength: number;
}

export interface MacroDef {
  label: string;
  default: number;
  targets: MacroTarget[];
}

export interface SliderControl {
  type: "slider";
  label: string;
  default: number;
  min: number;
  max: number;
  step?: number;
  group: string;
}

export interface ToggleControl {
  type: "toggle";
  label: string;
  default: boolean;
  group: string;
}

export interface SelectControl {
  type: "select";
  label: string;
  default: string;
  options: { label: string; value: string }[];
  group: string;
}

export interface XYControl {
  type: "xy";
  label: string;
  default: [number, number];
  min: number;
  max: number;
  group: string;
}

export type ControlDef = SliderControl | ToggleControl | SelectControl | XYControl;

// ── Layer / Composition types ──

export interface LayerConfig {
  surface: string;
  params?: Record<string, number>;
  hatch: HatchParams;
  transform?: { x?: number; y?: number; z?: number };
  group?: string;
}

export interface CompositionInput {
  surface: string;
  surfaceParams: Record<string, number>;
  hatchParams: HatchParams;
  values: Record<string, unknown>;
}

export interface Composition {
  name: string;
  macros?: Record<string, MacroDef>;
  controls?: Record<string, ControlDef>;
  hatchGroups?: string[];
  layers: (input: CompositionInput) => LayerConfig[];
}

// ── Macro resolution helpers ──

export function applyMacroFn(fn: MacroFn, strength: number, macroValue: number): number {
  const delta = (macroValue - 0.5) * 2; // -1..1
  switch (fn) {
    case "linear":
      return 1 + strength * delta;
    case "log":
      return Math.exp(strength * Math.log(3) * delta);
    case "exp":
      return Math.exp(strength * delta);
    case "sqrt": {
      const sign = delta >= 0 ? 1 : -1;
      return 1 + strength * sign * Math.sqrt(Math.abs(delta));
    }
    default:
      return 1;
  }
}

export function getControlDefaults(controls?: Record<string, ControlDef>): Record<string, unknown> {
  if (!controls) return {};
  const result: Record<string, unknown> = {};
  for (const [key, ctrl] of Object.entries(controls)) {
    result[key] = ctrl.default;
  }
  return result;
}

export function getMacroDefaults(macros?: Record<string, MacroDef>): Record<string, number> {
  if (!macros) return {};
  const result: Record<string, number> = {};
  for (const [key, macro] of Object.entries(macros)) {
    result[key] = macro.default;
  }
  return result;
}

export function resolveValues(
  controls: Record<string, ControlDef> | undefined,
  macros: Record<string, MacroDef> | undefined,
  baseValues: Record<string, unknown>,
  macroValues: Record<string, number>,
): Record<string, unknown> {
  if (!controls) return { ...baseValues };
  const resolved: Record<string, unknown> = { ...baseValues };
  if (macros) {
    for (const [macroKey, macro] of Object.entries(macros)) {
      const mv = macroValues[macroKey] ?? macro.default;
      for (const target of macro.targets) {
        const control = controls[target.param];
        if (control?.type === "slider") {
          const modifier = applyMacroFn(target.fn, target.strength, mv);
          const val = (resolved[target.param] as number) * modifier;
          resolved[target.param] = Math.max(control.min, Math.min(control.max, val));
        }
      }
    }
  }
  return resolved;
}

/** Get unique groups from controls in declaration order */
export function getControlGroups(controls?: Record<string, ControlDef>): string[] {
  if (!controls) return [];
  const seen = new Set<string>();
  const groups: string[] = [];
  for (const ctrl of Object.values(controls)) {
    if (!seen.has(ctrl.group)) {
      seen.add(ctrl.group);
      groups.push(ctrl.group);
    }
  }
  return groups;
}

// ── Compositions ──

export const COMPOSITIONS: Record<string, Composition> = {
  single: {
    name: "Single Surface",
    layers: (p) => [
      { surface: p.surface, params: p.surfaceParams, hatch: p.hatchParams },
    ],
  },

  towerAndBase: {
    name: "Tower + Base",
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
  },

  doubleRing: {
    name: "Double Ring",
    hatchGroups: ["Rings", "Connector"],
    macros: {
      scale: {
        label: "Scale",
        default: 0.5,
        targets: [
          { param: "ringRadius", fn: "linear", strength: 1.0 },
          { param: "connectorSpread", fn: "linear", strength: 1.0 },
        ],
      },
      separation: {
        label: "Separation",
        default: 0.5,
        targets: [
          { param: "ringSpacing", fn: "linear", strength: 1.0 },
          { param: "connectorHeight", fn: "linear", strength: 1.0 },
        ],
      },
    },
    controls: {
      ringSpacing: { type: "slider", label: "Ring Spacing", default: 1.3, min: 0.2, max: 3, group: "Structure" },
      ringRadius: { type: "slider", label: "Ring Radius", default: 2, min: 0.5, max: 3.5, group: "Structure" },
      ringThickness: { type: "slider", label: "Ring Thickness", default: 0.15, min: 0.03, max: 0.4, group: "Shape" },
      ringSquish: { type: "slider", label: "Ring Squish", default: 0.3, min: 0.1, max: 1.5, group: "Shape" },
      connectorHeight: { type: "slider", label: "Connector Height", default: 2.5, min: 0.5, max: 4, group: "Shape" },
      connectorSpread: { type: "slider", label: "Connector Spread", default: 1.8, min: 0.3, max: 3.5, group: "Shape" },
      connectorFanAngle: { type: "slider", label: "Fan Angle", default: 1.2, min: 0.2, max: 2.5, group: "Shape" },
      showConnector: { type: "toggle", label: "Show Connector", default: true, group: "Visibility" },
      ringOffset: { type: "xy", label: "Ring Offset", default: [0, 0], min: -0.5, max: 0.5, group: "Visibility" },
    },
    layers: (p): LayerConfig[] => {
      const v = p.values;
      const ringSpacing = v.ringSpacing as number;
      const ringRadius = v.ringRadius as number;
      const ringThickness = v.ringThickness as number;
      const ringSquish = v.ringSquish as number;
      const connectorHeight = v.connectorHeight as number;
      const connectorSpread = v.connectorSpread as number;
      const connectorFanAngle = v.connectorFanAngle as number;
      const showConnector = v.showConnector as boolean;
      const ringOffset = v.ringOffset as [number, number];

      const layers: LayerConfig[] = [
        {
          surface: "torus",
          params: { majorR: ringRadius, minorR: ringThickness, ySquish: ringSquish },
          hatch: { ...p.hatchParams, family: p.hatchParams.family ?? "u" },
          transform: { y: ringSpacing, x: ringOffset[0], z: ringOffset[1] },
          group: "Rings",
        },
        {
          surface: "torus",
          params: { majorR: ringRadius, minorR: ringThickness, ySquish: ringSquish },
          hatch: { ...p.hatchParams, family: p.hatchParams.family ?? "u" },
          transform: { y: -ringSpacing, x: -ringOffset[0], z: -ringOffset[1] },
          group: "Rings",
        },
      ];
      if (showConnector) {
        layers.push({
          surface: "conoid",
          params: { height: connectorHeight, spread: connectorSpread, fanAngle: connectorFanAngle },
          hatch: { ...p.hatchParams, family: p.hatchParams.family ?? "v" },
          transform: { y: 0 },
          group: "Connector",
        });
      }
      return layers;
    },
  },

  crystalSpire: {
    name: "Crystal Spire",
    hatchGroups: ["Primary", "Secondary"],
    macros: {
      twist: {
        label: "Twist",
        default: 0.5,
        targets: [
          { param: "primaryTwist", fn: "linear", strength: 1.0 },
          { param: "secondaryTwist", fn: "linear", strength: 1.0 },
        ],
      },
      scale: {
        label: "Scale",
        default: 0.5,
        targets: [
          { param: "primaryWidth", fn: "linear", strength: 1.0 },
          { param: "secondaryWidth", fn: "linear", strength: 1.0 },
          { param: "height", fn: "linear", strength: 1.0 },
        ],
      },
    },
    controls: {
      primaryTwist: { type: "slider", label: "Primary Twist", default: 2.5, min: 0.5, max: 5, group: "Shape" },
      secondaryTwist: { type: "slider", label: "Secondary Twist", default: -1.5, min: -5, max: -0.5, group: "Shape" },
      primaryWidth: { type: "slider", label: "Primary Width", default: 0.8, min: 0.3, max: 2, group: "Shape" },
      secondaryWidth: { type: "slider", label: "Secondary Width", default: 1.2, min: 0.3, max: 2, group: "Shape" },
      height: { type: "slider", label: "Height", default: 5, min: 2, max: 8, group: "Shape" },
      primaryBulge: { type: "slider", label: "Primary Bulge", default: 0.4, min: 0, max: 1, group: "Shape" },
      secondaryBulge: { type: "slider", label: "Secondary Bulge", default: 0.2, min: 0, max: 1, group: "Shape" },
    },
    layers: (p) => {
      const v = p.values;
      return [
        {
          surface: "twistedRibbon",
          params: {
            twist: v.primaryTwist as number,
            width: v.primaryWidth as number,
            height: v.height as number,
            bulge: v.primaryBulge as number,
          },
          hatch: { ...p.hatchParams, family: p.hatchParams.family ?? "u" },
          group: "Primary",
        },
        {
          surface: "twistedRibbon",
          params: {
            twist: v.secondaryTwist as number,
            width: v.secondaryWidth as number,
            height: v.height as number,
            bulge: v.secondaryBulge as number,
          },
          hatch: { ...p.hatchParams, family: p.hatchParams.family ?? "v" },
          group: "Secondary",
        },
      ];
    },
  },

  ribbonCage: {
    name: "Ribbon Cage",
    hatchGroups: ["Ribbons"],
    macros: {
      density: {
        label: "Density",
        default: 0.5,
        targets: [
          { param: "ribbons", fn: "linear", strength: 0.8 },
          { param: "baseTwist", fn: "linear", strength: 0.8 },
        ],
      },
      scale: {
        label: "Scale",
        default: 0.5,
        targets: [
          { param: "height", fn: "linear", strength: 1.0 },
          { param: "cageRadius", fn: "linear", strength: 1.0 },
          { param: "width", fn: "linear", strength: 1.0 },
        ],
      },
      chaos: {
        label: "Chaos",
        default: 0.5,
        targets: [
          { param: "twistVariation", fn: "exp", strength: 1.0 },
          { param: "bulgeProgression", fn: "exp", strength: 1.0 },
        ],
      },
    },
    controls: {
      ribbons: { type: "slider", label: "Ribbons", default: 6, min: 2, max: 12, step: 1, group: "Structure" },
      cageRadius: { type: "slider", label: "Cage Radius", default: 0.3, min: 0.05, max: 1.5, group: "Structure" },
      baseTwist: { type: "slider", label: "Base Twist", default: 1.5, min: 0.3, max: 4, group: "Shape" },
      twistVariation: { type: "slider", label: "Twist Variation", default: 0.8, min: 0, max: 2, group: "Shape" },
      width: { type: "slider", label: "Width", default: 0.5, min: 0.2, max: 1.5, group: "Shape" },
      height: { type: "slider", label: "Height", default: 4.5, min: 2, max: 7, group: "Shape" },
      baseBulge: { type: "slider", label: "Base Bulge", default: 0.15, min: 0, max: 0.5, group: "Shape" },
      bulgeProgression: { type: "slider", label: "Bulge Growth", default: 0.05, min: 0, max: 0.15, group: "Shape" },
    },
    layers: (p): LayerConfig[] => {
      const v = p.values;
      const n = Math.round(v.ribbons as number);
      const cageRadius = v.cageRadius as number;
      const baseTwist = v.baseTwist as number;
      const twistVariation = v.twistVariation as number;
      const ribbonWidth = v.width as number;
      const ribbonHeight = v.height as number;
      const baseBulge = v.baseBulge as number;
      const bulgeProgression = v.bulgeProgression as number;
      const families: Array<"u" | "v"> = ["u", "v"];
      const layers: LayerConfig[] = [];
      for (let i = 0; i < n; i++) {
        const phase = (i / n) * Math.PI;
        layers.push({
          surface: "twistedRibbon",
          params: {
            twist: baseTwist + Math.sin(phase) * twistVariation,
            width: ribbonWidth,
            height: ribbonHeight,
            bulge: baseBulge + i * bulgeProgression,
          },
          hatch: {
            ...p.hatchParams,
            family: p.hatchParams.family ?? families[i % 2],
          },
          transform: {
            x: cageRadius * Math.cos((i / n) * Math.PI * 2),
            z: cageRadius * Math.sin((i / n) * Math.PI * 2),
          },
          group: "Ribbons",
        });
      }
      return layers;
    },
  },

  dnaHelix: {
    name: "DNA Helix",
    hatchGroups: ["Strands", "Rungs"],
    macros: {
      twist: {
        label: "Twist",
        default: 0.5,
        targets: [
          { param: "strandTwist", fn: "linear", strength: 1.0 },
        ],
      },
      scale: {
        label: "Scale",
        default: 0.5,
        targets: [
          { param: "strandWidth", fn: "linear", strength: 1.0 },
          { param: "rungRadius", fn: "linear", strength: 1.0 },
          { param: "height", fn: "linear", strength: 1.0 },
        ],
      },
      density: {
        label: "Density",
        default: 0.5,
        targets: [
          { param: "rungs", fn: "linear", strength: 0.8 },
        ],
      },
    },
    controls: {
      strandTwist: { type: "slider", label: "Strand Twist", default: 3, min: 1, max: 6, group: "Structure" },
      rungs: { type: "slider", label: "Rungs", default: 8, min: 2, max: 16, step: 1, group: "Structure" },
      height: { type: "slider", label: "Height", default: 6, min: 3, max: 10, group: "Structure" },
      strandWidth: { type: "slider", label: "Strand Width", default: 0.6, min: 0.2, max: 1.5, group: "Shape" },
      strandBulge: { type: "slider", label: "Strand Bulge", default: 0.5, min: 0, max: 1, group: "Shape" },
      rungRadius: { type: "slider", label: "Rung Radius", default: 0.8, min: 0.3, max: 1.5, group: "Shape" },
      rungThickness: { type: "slider", label: "Rung Thickness", default: 0.04, min: 0.02, max: 0.15, group: "Shape" },
      rungSquish: { type: "slider", label: "Rung Squish", default: 3, min: 1, max: 5, group: "Shape" },
      showRungs: { type: "toggle", label: "Show Rungs", default: true, group: "Visibility" },
      showStrands: { type: "toggle", label: "Show Strands", default: true, group: "Visibility" },
    },
    layers: (p): LayerConfig[] => {
      const v = p.values;
      const strandTwist = v.strandTwist as number;
      const rungCount = Math.round(v.rungs as number);
      const dnaHeight = v.height as number;
      const strandWidth = v.strandWidth as number;
      const strandBulge = v.strandBulge as number;
      const rungRadius = v.rungRadius as number;
      const rungThickness = v.rungThickness as number;
      const rungSquish = v.rungSquish as number;
      const showRungs = v.showRungs as boolean;
      const showStrands = v.showStrands as boolean;

      const layers: LayerConfig[] = [];
      if (showStrands) {
        layers.push(
          {
            surface: "twistedRibbon",
            params: { twist: strandTwist, width: strandWidth, height: dnaHeight, bulge: strandBulge },
            hatch: { ...p.hatchParams, family: p.hatchParams.family ?? "u" },
            group: "Strands",
          },
          {
            surface: "twistedRibbon",
            params: { twist: strandTwist, width: strandWidth, height: dnaHeight, bulge: strandBulge },
            hatch: { ...p.hatchParams, family: p.hatchParams.family ?? "v" },
            group: "Strands",
          },
        );
      }
      if (showRungs) {
        for (let i = 0; i < rungCount; i++) {
          const t = i / rungCount;
          layers.push({
            surface: "torus",
            params: { majorR: rungRadius, minorR: rungThickness, ySquish: rungSquish },
            hatch: { ...p.hatchParams, family: p.hatchParams.family ?? "u" },
            transform: { y: -dnaHeight / 2 + t * dnaHeight },
            group: "Rungs",
          });
        }
      }
      return layers;
    },
  },

  totemStack: {
    name: "Totem Stack",
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
  },

  starburst: {
    name: "Starburst",
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
  },

  mushroomColony: {
    name: "Mushroom Colony",
    hatchGroups: ["Stems", "Caps"],
    macros: {
      scale: {
        label: "Scale",
        default: 0.5,
        targets: [
          { param: "capSize", fn: "linear", strength: 1.0 },
          { param: "stemHeight", fn: "linear", strength: 1.0 },
        ],
      },
      density: {
        label: "Density",
        default: 0.5,
        targets: [
          { param: "count", fn: "linear", strength: 0.5 },
        ],
      },
      spread: {
        label: "Spread",
        default: 0.5,
        targets: [
          { param: "colonySpread", fn: "linear", strength: 1.0 },
        ],
      },
    },
    controls: {
      count: { type: "slider", label: "Count", default: 5, min: 1, max: 9, step: 1, group: "Structure" },
      colonySpread: { type: "slider", label: "Colony Spread", default: 2.2, min: 0.5, max: 4, group: "Structure" },
      capSize: { type: "slider", label: "Cap Size", default: 1.0, min: 0.3, max: 2, group: "Shape" },
      stemHeight: { type: "slider", label: "Stem Height", default: 2.5, min: 0.5, max: 4, group: "Shape" },
      stemTwist: { type: "slider", label: "Stem Twist", default: 0.2, min: 0, max: 1.5, group: "Shape" },
      stemWaist: { type: "slider", label: "Stem Waist", default: 0.55, min: 0.1, max: 0.9, group: "Shape" },
      capSharpness: { type: "slider", label: "Cap Sharpness", default: 5, min: 2, max: 10, group: "Shape" },
      capSag: { type: "slider", label: "Cap Sag", default: 0.5, min: 0.1, max: 1, group: "Shape" },
      colonyOffset: { type: "xy", label: "Colony Offset", default: [0, 0], min: -1.5, max: 1.5, group: "Position" },
    },
    layers: (p): LayerConfig[] => {
      const v = p.values;
      const mushroomCount = Math.round(v.count as number);
      const colonySpread = v.colonySpread as number;
      const capSize = v.capSize as number;
      const stemHeight = v.stemHeight as number;
      const stemTwist = v.stemTwist as number;
      const stemWaist = v.stemWaist as number;
      const capSharpness = v.capSharpness as number;
      const capSag = v.capSag as number;
      const colonyOffset = v.colonyOffset as [number, number];

      // Deterministic positions for up to 9 mushrooms
      const positions = [
        { x: 0, z: 0, s: 1.0, h: 1.0 },
        { x: 1.0, z: 0.23, s: 0.6, h: 0.6 },
        { x: -0.82, z: 0.45, s: 0.7, h: 0.72 },
        { x: 0.36, z: -0.91, s: 0.5, h: 0.48 },
        { x: -0.45, z: -0.68, s: 0.45, h: 0.4 },
        { x: 0.7, z: 0.7, s: 0.55, h: 0.55 },
        { x: -1.0, z: -0.3, s: 0.4, h: 0.35 },
        { x: 0.2, z: 0.95, s: 0.5, h: 0.5 },
        { x: -0.5, z: 0.85, s: 0.35, h: 0.3 },
      ];

      const layers: LayerConfig[] = [];
      for (let i = 0; i < mushroomCount && i < positions.length; i++) {
        const m = positions[i];
        const mx = m.x * colonySpread + colonyOffset[0];
        const mz = m.z * colonySpread + colonyOffset[1];
        const mh = stemHeight * m.h;
        const ms = capSize * m.s;
        layers.push({
          surface: "hyperboloid",
          params: { radius: 0.3 * ms, height: mh, twist: stemTwist, waist: stemWaist },
          hatch: { ...p.hatchParams, family: p.hatchParams.family ?? "v" },
          transform: { x: mx, z: mz, y: -mh * 0.25 },
          group: "Stems",
        });
        layers.push({
          surface: "canopy",
          params: { radius: ms, sag: capSag * ms, sharpness: capSharpness, yOffset: mh * 0.25 },
          hatch: { ...p.hatchParams, family: p.hatchParams.family ?? "u" },
          transform: { x: mx, z: mz },
          group: "Caps",
        });
      }
      return layers;
    },
  },

  nestedShells: {
    name: "Nested Shells",
    hatchGroups: ["Shells", "Caps"],
    macros: {
      density: {
        label: "Density",
        default: 0.5,
        targets: [
          { param: "shells", fn: "linear", strength: 0.6 },
        ],
      },
      scale: {
        label: "Scale",
        default: 0.5,
        targets: [
          { param: "outerRadius", fn: "linear", strength: 1.0 },
          { param: "height", fn: "linear", strength: 1.0 },
        ],
      },
      twist: {
        label: "Twist",
        default: 0.5,
        targets: [
          { param: "innerTwist", fn: "linear", strength: 1.0 },
          { param: "outerTwist", fn: "linear", strength: 1.0 },
        ],
      },
    },
    controls: {
      shells: { type: "slider", label: "Shells", default: 4, min: 1, max: 8, step: 1, group: "Structure" },
      outerRadius: { type: "slider", label: "Outer Radius", default: 1.8, min: 0.8, max: 3.5, group: "Structure" },
      innerRadius: { type: "slider", label: "Inner Radius", default: 0.8, min: 0.2, max: 2, group: "Structure" },
      height: { type: "slider", label: "Height", default: 3, min: 1.5, max: 6, group: "Structure" },
      heightGrowth: { type: "slider", label: "Height Growth", default: 1.5, min: 0, max: 3, group: "Structure" },
      outerTwist: { type: "slider", label: "Outer Twist", default: 0.5, min: 0, max: 3, group: "Shape" },
      innerTwist: { type: "slider", label: "Inner Twist", default: 2.0, min: 0.5, max: 5, group: "Shape" },
      outerWaist: { type: "slider", label: "Outer Waist", default: 0.25, min: 0, max: 1, group: "Shape" },
      innerWaist: { type: "slider", label: "Inner Waist", default: 0.4, min: 0, max: 1, group: "Shape" },
      capSag: { type: "slider", label: "Cap Sag", default: 0.4, min: 0.1, max: 1.5, group: "Shape" },
      capSharpness: { type: "slider", label: "Cap Sharpness", default: 6, min: 1, max: 10, group: "Shape" },
      showCaps: { type: "toggle", label: "Show Caps", default: true, group: "Visibility" },
    },
    layers: (p): LayerConfig[] => {
      const v = p.values;
      const shellCount = Math.round(v.shells as number);
      const outerRadius = v.outerRadius as number;
      const innerRadius = v.innerRadius as number;
      const baseHeight = v.height as number;
      const heightGrowth = v.heightGrowth as number;
      const outerTwist = v.outerTwist as number;
      const innerTwist = v.innerTwist as number;
      const outerWaist = v.outerWaist as number;
      const innerWaist = v.innerWaist as number;
      const capSag = v.capSag as number;
      const capSharpness = v.capSharpness as number;
      const showCaps = v.showCaps as boolean;

      const layers: LayerConfig[] = [];
      const shellFamilies: Array<"u" | "v" | "diagonal"> = ["u", "v", "diagonal"];
      for (let i = 0; i < shellCount; i++) {
        const t = shellCount > 1 ? i / (shellCount - 1) : 0;
        const radius = outerRadius - t * (outerRadius - innerRadius);
        layers.push({
          surface: "hyperboloid",
          params: {
            radius,
            height: baseHeight + t * heightGrowth,
            twist: outerTwist + t * (innerTwist - outerTwist),
            waist: outerWaist + t * (innerWaist - outerWaist),
          },
          hatch: { ...p.hatchParams, family: p.hatchParams.family ?? shellFamilies[i % 3] },
          group: "Shells",
        });
      }
      if (showCaps) {
        layers.push({
          surface: "canopy",
          params: { radius: outerRadius, sag: capSag, sharpness: capSharpness, yOffset: baseHeight * 0.73 },
          hatch: { ...p.hatchParams, family: p.hatchParams.family ?? "diagonal" },
          group: "Caps",
        });
        layers.push({
          surface: "canopy",
          params: { radius: outerRadius, sag: capSag, sharpness: capSharpness, yOffset: -baseHeight * 0.73 },
          hatch: { ...p.hatchParams, family: p.hatchParams.family ?? "u" },
          group: "Caps",
        });
      }
      return layers;
    },
  },

  vortexTunnel: {
    name: "Vortex Tunnel",
    hatchGroups: ["Rings", "Spine"],
    macros: {
      density: {
        label: "Density",
        default: 0.5,
        targets: [
          { param: "rings", fn: "linear", strength: 0.6 },
        ],
      },
      scale: {
        label: "Scale",
        default: 0.5,
        targets: [
          { param: "baseRadius", fn: "linear", strength: 1.0 },
          { param: "spineWidth", fn: "linear", strength: 1.0 },
        ],
      },
      motion: {
        label: "Motion",
        default: 0.5,
        targets: [
          { param: "amplitude", fn: "linear", strength: 1.0 },
          { param: "spineTwist", fn: "linear", strength: 1.0 },
        ],
      },
    },
    controls: {
      rings: { type: "slider", label: "Rings", default: 7, min: 3, max: 16, step: 1, group: "Structure" },
      verticalSpan: { type: "slider", label: "Vertical Span", default: 8, min: 2, max: 12, group: "Structure" },
      baseRadius: { type: "slider", label: "Base Radius", default: 1.2, min: 0.5, max: 2.5, group: "Structure" },
      amplitude: { type: "slider", label: "Amplitude", default: 0.6, min: 0, max: 2, group: "Shape" },
      minTubeRadius: { type: "slider", label: "Min Tube Radius", default: 0.06, min: 0.02, max: 0.2, group: "Shape" },
      tubeGrowth: { type: "slider", label: "Tube Growth", default: 0.04, min: 0, max: 0.1, group: "Shape" },
      baseSquish: { type: "slider", label: "Base Squish", default: 0.3, min: 0.1, max: 1.5, group: "Shape" },
      squishVariation: { type: "slider", label: "Squish Var.", default: 0.5, min: 0, max: 1.5, group: "Shape" },
      spineTwist: { type: "slider", label: "Spine Twist", default: 4, min: 1, max: 8, group: "Shape" },
      spineWidth: { type: "slider", label: "Spine Width", default: 0.3, min: 0.1, max: 1, group: "Shape" },
      spineBulge: { type: "slider", label: "Spine Bulge", default: 0.6, min: 0, max: 1, group: "Shape" },
      showSpine: { type: "toggle", label: "Show Spine", default: true, group: "Visibility" },
      showRings: { type: "toggle", label: "Show Rings", default: true, group: "Visibility" },
    },
    layers: (p): LayerConfig[] => {
      const v = p.values;
      const ringCount = Math.round(v.rings as number);
      const verticalSpan = v.verticalSpan as number;
      const baseRadius = v.baseRadius as number;
      const amplitude = v.amplitude as number;
      const minTubeRadius = v.minTubeRadius as number;
      const tubeGrowth = v.tubeGrowth as number;
      const baseSquish = v.baseSquish as number;
      const squishVariation = v.squishVariation as number;
      const spineTwist = v.spineTwist as number;
      const spineWidth = v.spineWidth as number;
      const spineBulge = v.spineBulge as number;
      const showSpine = v.showSpine as boolean;
      const showRings = v.showRings as boolean;

      const layers: LayerConfig[] = [];
      const ringFamilies: Array<"u" | "v"> = ["u", "v"];
      if (showRings) {
        for (let i = 0; i < ringCount; i++) {
          const t = ringCount > 1 ? i / (ringCount - 1) : 0.5;
          const y = -verticalSpan / 2 + t * verticalSpan;
          const r = baseRadius + amplitude * Math.sin(t * Math.PI * 2);
          layers.push({
            surface: "torus",
            params: {
              majorR: r,
              minorR: minTubeRadius + t * tubeGrowth,
              ySquish: baseSquish + squishVariation * Math.sin(t * Math.PI),
            },
            hatch: { ...p.hatchParams, family: p.hatchParams.family ?? ringFamilies[i % 2] },
            transform: { y },
            group: "Rings",
          });
        }
      }
      if (showSpine) {
        layers.push({
          surface: "twistedRibbon",
          params: { twist: spineTwist, width: spineWidth, height: verticalSpan, bulge: spineBulge },
          hatch: { ...p.hatchParams, family: p.hatchParams.family ?? "u" },
          group: "Spine",
        });
      }
      return layers;
    },
  },
};
