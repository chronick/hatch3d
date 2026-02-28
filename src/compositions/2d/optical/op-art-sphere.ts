import type { Composition2DDefinition } from "../../types";

const opArtSphere: Composition2DDefinition = {
  id: "opArtSphere",
  name: "Op Art Sphere",
  description:
    "Parallel lines with spherical displacement creating the illusion of a 3D sphere through pure line distortion",
  tags: ["optical", "op-art", "sphere", "illusion"],
  category: "2d",
  type: "2d",

  macros: {
    intensity: {
      label: "Intensity",
      default: 0.5,
      targets: [
        { param: "bulgeStrength", fn: "linear", strength: 1.0 },
        { param: "lineCount", fn: "linear", strength: 0.5 },
      ],
    },
  },

  controls: {
    lineCount: {
      type: "slider",
      label: "Lines",
      default: 50,
      min: 15,
      max: 100,
      step: 1,
      group: "Structure",
    },
    bulgeStrength: {
      type: "slider",
      label: "Bulge",
      default: 0.7,
      min: 0.1,
      max: 1.5,
      step: 0.01,
      group: "Structure",
    },
    sphereRadius: {
      type: "slider",
      label: "Sphere Size",
      default: 0.35,
      min: 0.1,
      max: 0.48,
      step: 0.01,
      group: "Shape",
    },
    smoothness: {
      type: "slider",
      label: "Smoothness",
      default: 200,
      min: 60,
      max: 400,
      step: 1,
      group: "Shape",
    },
    orientation: {
      type: "select",
      label: "Direction",
      default: "horizontal",
      options: [
        { label: "Horizontal", value: "horizontal" },
        { label: "Vertical", value: "vertical" },
      ],
      group: "Shape",
    },
    centerX: {
      type: "slider",
      label: "Center X",
      default: 0.5,
      min: 0.2,
      max: 0.8,
      step: 0.01,
      group: "Position",
    },
    centerY: {
      type: "slider",
      label: "Center Y",
      default: 0.5,
      min: 0.2,
      max: 0.8,
      step: 0.01,
      group: "Position",
    },
  },

  generate({ width, height, values }) {
    const lineCount = Math.round(values.lineCount as number);
    const bulgeStrength = values.bulgeStrength as number;
    const sphereRadius = values.sphereRadius as number;
    const smoothness = Math.round(values.smoothness as number);
    const orientation = values.orientation as string;
    const cxNorm = values.centerX as number;
    const cyNorm = values.centerY as number;

    const cx = width * cxNorm;
    const cy = height * cyNorm;
    const size = Math.min(width, height);
    const R = size * sphereRadius;

    const polylines: { x: number; y: number }[][] = [];
    const vertical = orientation === "vertical";

    // Primary dimension (along which lines are spaced)
    const primarySize = vertical ? width : height;
    // Secondary dimension (along which each line runs)
    const secondarySize = vertical ? height : width;

    const spacing = primarySize / (lineCount + 1);

    for (let i = 1; i <= lineCount; i++) {
      const pts: { x: number; y: number }[] = [];
      const primaryPos = i * spacing;

      for (let j = 0; j <= smoothness; j++) {
        const t = j / smoothness;
        const secondaryPos = t * secondarySize;

        // Base position
        let px = vertical ? primaryPos : secondaryPos;
        let py = vertical ? secondaryPos : primaryPos;

        // Distance from sphere center
        const dx = px - cx;
        const dy = py - cy;
        const dist = Math.sqrt(dx * dx + dy * dy);

        // Spherical displacement: push lines outward from center
        // within sphere radius, creating the illusion of a bulge
        if (dist < R) {
          const normalizedDist = dist / R;
          // Spherical profile: height = sqrt(1 - r^2) for unit sphere
          const sphereHeight =
            Math.sqrt(1 - normalizedDist * normalizedDist) * R * bulgeStrength;

          // Displace perpendicular to line direction
          if (vertical) {
            // Push horizontally based on x-offset from center
            px += (dx / R) * sphereHeight;
          } else {
            // Push vertically based on y-offset from center
            py += (dy / R) * sphereHeight;
          }
        }

        pts.push({ x: px, y: py });
      }
      polylines.push(pts);
    }

    return polylines;
  },
};

export default opArtSphere;
