import type { Composition2DDefinition } from "../../types";

type Pt = { x: number; y: number };

function generateConcentricCircles(
  cx: number,
  cy: number,
  rings: number,
  maxR: number,
  smoothness: number,
): Pt[][] {
  const spacing = maxR / rings;
  const polylines: Pt[][] = [];
  for (let i = 1; i <= rings; i++) {
    const r = i * spacing;
    const pts: Pt[] = [];
    for (let j = 0; j <= smoothness; j++) {
      const a = (j / smoothness) * Math.PI * 2;
      pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
    }
    polylines.push(pts);
  }
  return polylines;
}

function generateParallelLines(
  cx: number,
  cy: number,
  lineCount: number,
  maxExtent: number,
  rotation: number,
  length: number,
): Pt[][] {
  const spacing = maxExtent / lineCount;
  const cosA = Math.cos(rotation);
  const sinA = Math.sin(rotation);
  const polylines: Pt[][] = [];
  const half = lineCount / 2;
  for (let i = -half; i <= half; i++) {
    const offset = i * spacing;
    // Line perpendicular to the rotation direction
    const px = cx + offset * cosA;
    const py = cy + offset * sinA;
    polylines.push([
      { x: px - length * sinA, y: py + length * cosA },
      { x: px + length * sinA, y: py - length * cosA },
    ]);
  }
  return polylines;
}

const moireCircles: Composition2DDefinition = {
  id: "moireCircles",
  name: "Moire Circles",
  description: "Overlapping pattern sets creating optical moire interference patterns",
  tags: ["optical", "moire", "circles", "interference"],
  category: "2d",
  type: "2d",

  macros: {
    density: {
      label: "Density",
      default: 0.5,
      targets: [
        { param: "rings", fn: "linear", strength: 0.7 },
        { param: "smoothness", fn: "linear", strength: 0.3 },
      ],
    },
    separation: {
      label: "Separation",
      default: 0.5,
      targets: [
        { param: "centerOffsetX", fn: "linear", strength: 0.6 },
        { param: "centerOffsetY", fn: "linear", strength: 0.4 },
      ],
    },
  },

  controls: {
    patternType: {
      type: "select",
      label: "Pattern Type",
      default: "circles",
      options: [
        { label: "Circles", value: "circles" },
        { label: "Lines", value: "lines" },
      ],
      group: "Pattern",
    },
    rings: { type: "slider", label: "Ring / Line Count", default: 40, min: 10, max: 200, step: 1, group: "Structure" },
    centerOffsetX: { type: "slider", label: "Offset X", default: 60, min: -300, max: 300, step: 1, group: "Structure" },
    centerOffsetY: { type: "slider", label: "Offset Y", default: 40, min: -300, max: 300, step: 1, group: "Structure" },
    rotation: { type: "slider", label: "Rotation", default: 0, min: 0, max: 180, step: 1, group: "Structure" },
    smoothness: { type: "slider", label: "Smoothness", default: 120, min: 36, max: 500, step: 1, group: "Shape" },
    showSecond: { type: "toggle", label: "Second Set", default: true, group: "Sets" },
    showThird: { type: "toggle", label: "Third Set", default: false, group: "Sets" },
    thirdOffsetX: { type: "slider", label: "Third Offset X", default: -40, min: -300, max: 300, step: 1, group: "Sets" },
    thirdOffsetY: { type: "slider", label: "Third Offset Y", default: 70, min: -300, max: 300, step: 1, group: "Sets" },
  },

  generate({ width, height, values }) {
    const patternType = values.patternType as string;
    const rings = Math.round(values.rings as number);
    const offX = values.centerOffsetX as number;
    const offY = values.centerOffsetY as number;
    const rotation = ((values.rotation as number) * Math.PI) / 180;
    const smoothness = Math.round(values.smoothness as number);
    const showSecond = values.showSecond as boolean;
    const showThird = values.showThird as boolean;
    const thirdOffX = values.thirdOffsetX as number;
    const thirdOffY = values.thirdOffsetY as number;

    const cx = width / 2;
    const cy = height / 2;
    const maxR = Math.hypot(width, height) / 2;
    const polylines: Pt[][] = [];

    if (patternType === "circles") {
      polylines.push(...generateConcentricCircles(cx, cy, rings, maxR, smoothness));
      if (showSecond) {
        polylines.push(...generateConcentricCircles(cx + offX, cy + offY, rings, maxR, smoothness));
      }
      if (showThird) {
        polylines.push(...generateConcentricCircles(cx + thirdOffX, cy + thirdOffY, rings, maxR, smoothness));
      }
    } else {
      // Lines mode
      const len = maxR;
      polylines.push(...generateParallelLines(cx, cy, rings, maxR, rotation, len));
      if (showSecond) {
        polylines.push(...generateParallelLines(cx + offX, cy + offY, rings, maxR, rotation, len));
      }
      if (showThird) {
        polylines.push(...generateParallelLines(cx + thirdOffX, cy + thirdOffY, rings, maxR, rotation, len));
      }
    }

    return polylines;
  },
};
export default moireCircles;
