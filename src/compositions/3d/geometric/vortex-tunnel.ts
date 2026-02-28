import type { Composition3DDefinition, LayerConfig } from "../../types";

const vortexTunnel: Composition3DDefinition = {
  id: "vortexTunnel",
  name: "Vortex Tunnel",
  description: "Spiraling tunnel of torus rings with twisted ribbon spine",
  tags: ["geometric", "tunnel", "spiral"],
  category: "3d",
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
};
export default vortexTunnel;
