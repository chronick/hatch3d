import type { Composition2DDefinition } from "../../types";

const hilbertFill: Composition2DDefinition = {
  id: "hilbertFill",
  name: "Hilbert Fill",
  description: "Hilbert space-filling curve via L-system turtle graphics",
  tags: ["pattern", "hilbert", "space-filling", "fractal"],
  category: "2d",
  type: "2d",

  controls: {
    level: {
      type: "slider",
      label: "Recursion Level",
      default: 5,
      min: 1,
      max: 8,
      step: 1,
      group: "Curve",
    },
    margin: {
      type: "slider",
      label: "Margin",
      default: 40,
      min: 10,
      max: 100,
      step: 5,
      group: "Layout",
    },
    rotation: {
      type: "slider",
      label: "Rotation",
      default: 0,
      min: 0,
      max: 360,
      step: 1,
      group: "Layout",
    },
  },

  generate({ width, height, values }) {
    const level = Math.round(values.level as number);
    const margin = values.margin as number;
    const rotationDeg = values.rotation as number;

    // Generate Hilbert curve string via L-system
    // A → +BF−AFA−FB+
    // B → −AF+BFB+FA−
    let str = "A";
    for (let i = 0; i < level; i++) {
      let next = "";
      for (const ch of str) {
        if (ch === "A") next += "+BF-AFA-FB+";
        else if (ch === "B") next += "-AF+BFB+FA-";
        else next += ch;
      }
      str = next;
    }

    // Execute turtle
    const points: { x: number; y: number }[] = [];
    let x = 0;
    let y = 0;
    let heading = 0; // 0=right, 90=down, etc
    points.push({ x, y });

    const step = 1; // unit step, we'll scale later

    for (const ch of str) {
      if (ch === "F") {
        const rad = (heading * Math.PI) / 180;
        x += step * Math.cos(rad);
        y += step * Math.sin(rad);
        points.push({ x, y });
      } else if (ch === "+") {
        heading = (heading + 90) % 360;
      } else if (ch === "-") {
        heading = (heading - 90 + 360) % 360;
      }
    }

    if (points.length === 0) return [];

    // Find bounding box
    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity;
    for (const pt of points) {
      if (pt.x < minX) minX = pt.x;
      if (pt.x > maxX) maxX = pt.x;
      if (pt.y < minY) minY = pt.y;
      if (pt.y > maxY) maxY = pt.y;
    }

    const rangeX = maxX - minX || 1;
    const rangeY = maxY - minY || 1;
    const drawW = width - margin * 2;
    const drawH = height - margin * 2;
    const scale = Math.min(drawW / rangeX, drawH / rangeY);

    // Apply rotation and scale
    const rotRad = (rotationDeg * Math.PI) / 180;
    const cosR = Math.cos(rotRad);
    const sinR = Math.sin(rotRad);

    // Center the curve
    const cx = width / 2;
    const cy = height / 2;

    const scaled = points.map((pt) => {
      // Normalize to centered coordinates
      const nx = (pt.x - minX - rangeX / 2) * scale;
      const ny = (pt.y - minY - rangeY / 2) * scale;
      // Rotate
      return {
        x: cx + nx * cosR - ny * sinR,
        y: cy + nx * sinR + ny * cosR,
      };
    });

    return [scaled];
  },
};

export default hilbertFill;
