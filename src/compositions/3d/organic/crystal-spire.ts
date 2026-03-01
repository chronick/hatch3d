import type { Composition3DDefinition } from "../../types";

const crystalSpire: Composition3DDefinition = {
  id: "crystalSpire",
  name: "Crystal Spire",
  description: "Intertwined twisted ribbons forming a crystal spire",
  tags: ["organic", "twisted", "ribbons"],
  category: "3d",
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
    primaryTwist: { type: "slider", label: "Primary Twist", default: 2.5, min: 0.5, max: 12, group: "Shape" },
    secondaryTwist: { type: "slider", label: "Secondary Twist", default: -1.5, min: -12, max: -0.5, group: "Shape" },
    primaryWidth: { type: "slider", label: "Primary Width", default: 0.8, min: 0.3, max: 5, group: "Shape" },
    secondaryWidth: { type: "slider", label: "Secondary Width", default: 1.2, min: 0.3, max: 5, group: "Shape" },
    height: { type: "slider", label: "Height", default: 5, min: 2, max: 15, group: "Shape" },
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
};
export default crystalSpire;
