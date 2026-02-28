import type { Composition2DDefinition } from "../types";

const moireCircles: Composition2DDefinition = {
  id: "moireCircles",
  name: "Moire Circles",
  description: "Overlapping concentric circle sets creating optical moire patterns",
  tags: ["optical", "moire", "circles"],
  category: "2D/Patterns",
  type: "2d",
  controls: {
    rings: { type: "slider", label: "Rings", default: 40, min: 10, max: 80, step: 1, group: "Structure" },
    centerOffsetX: { type: "slider", label: "Offset X", default: 60, min: -200, max: 200, step: 1, group: "Structure" },
    centerOffsetY: { type: "slider", label: "Offset Y", default: 40, min: -200, max: 200, step: 1, group: "Structure" },
    smoothness: { type: "slider", label: "Smoothness", default: 120, min: 36, max: 240, step: 1, group: "Shape" },
    showSecond: { type: "toggle", label: "Second Set", default: true, group: "Shape" },
  },
  generate({ width, height, values }) {
    const rings = Math.round(values.rings as number);
    const offX = values.centerOffsetX as number;
    const offY = values.centerOffsetY as number;
    const smoothness = Math.round(values.smoothness as number);
    const showSecond = values.showSecond as boolean;

    const cx = width / 2;
    const cy = height / 2;
    const maxR = Math.hypot(width, height) / 2;
    const spacing = maxR / rings;
    const polylines: { x: number; y: number }[][] = [];

    for (let i = 1; i <= rings; i++) {
      const r = i * spacing;
      const pts: { x: number; y: number }[] = [];
      for (let j = 0; j <= smoothness; j++) {
        const a = (j / smoothness) * Math.PI * 2;
        pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
      }
      polylines.push(pts);
    }

    if (showSecond) {
      for (let i = 1; i <= rings; i++) {
        const r = i * spacing;
        const pts: { x: number; y: number }[] = [];
        for (let j = 0; j <= smoothness; j++) {
          const a = (j / smoothness) * Math.PI * 2;
          pts.push({ x: cx + offX + Math.cos(a) * r, y: cy + offY + Math.sin(a) * r });
        }
        polylines.push(pts);
      }
    }

    return polylines;
  },
};
export default moireCircles;
