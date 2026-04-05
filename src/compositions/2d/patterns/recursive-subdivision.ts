import type { Composition2DDefinition } from "../../types";

// Mulberry32 seeded PRNG
function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const recursiveSubdivision: Composition2DDefinition = {
  id: "recursiveSubdivision",
  name: "Recursive Subdivision",
  description:
    "Mondrian-style recursive rectangle splitting with hatched fills",
  tags: ["pattern", "subdivision", "mondrian", "geometric", "generative"],
  category: "2d",
  type: "2d",

  controls: {
    depth: {
      type: "slider",
      label: "Max Depth",
      default: 5,
      min: 1,
      max: 10,
      step: 1,
      group: "Structure",
    },
    margin: {
      type: "slider",
      label: "Margin",
      default: 30,
      min: 0,
      max: 100,
      step: 5,
      group: "Layout",
    },
    gap: {
      type: "slider",
      label: "Cell Gap",
      default: 3,
      min: 0,
      max: 15,
      step: 0.5,
      group: "Layout",
    },
    splitBias: {
      type: "slider",
      label: "Split Bias",
      default: 0.5,
      min: 0.1,
      max: 0.9,
      step: 0.01,
      group: "Structure",
    },
    minCellSize: {
      type: "slider",
      label: "Min Cell Size",
      default: 40,
      min: 10,
      max: 200,
      step: 5,
      group: "Structure",
    },
    splitVariation: {
      type: "slider",
      label: "Split Variation",
      default: 0.3,
      min: 0,
      max: 0.5,
      step: 0.01,
      group: "Structure",
    },
    seed: {
      type: "slider",
      label: "Seed",
      default: 42,
      min: 0,
      max: 999,
      step: 1,
      group: "Structure",
    },
    showEdges: {
      type: "toggle",
      label: "Show Edges",
      default: true,
      group: "Display",
    },
    hatchFill: {
      type: "toggle",
      label: "Hatch Fill",
      default: true,
      group: "Hatching",
    },
    hatchDensity: {
      type: "slider",
      label: "Hatch Spacing",
      default: 4,
      min: 1,
      max: 20,
      step: 0.5,
      group: "Hatching",
    },
    hatchAngle: {
      type: "slider",
      label: "Hatch Angle",
      default: 45,
      min: 0,
      max: 180,
      step: 1,
      group: "Hatching",
    },
    fillProbability: {
      type: "slider",
      label: "Fill Probability",
      default: 0.4,
      min: 0,
      max: 1,
      step: 0.05,
      group: "Hatching",
    },
    varyAngle: {
      type: "toggle",
      label: "Vary Angle Per Cell",
      default: true,
      group: "Hatching",
    },
  },

  generate({ width, height, values }) {
    const maxDepth = Math.round(values.depth as number);
    const margin = values.margin as number;
    const gap = values.gap as number;
    const splitBias = values.splitBias as number;
    const minCellSize = values.minCellSize as number;
    const splitVariation = values.splitVariation as number;
    const seed = Math.round(values.seed as number);
    const showEdges = values.showEdges as boolean;
    const hatchFill = values.hatchFill as boolean;
    const hatchDensity = values.hatchDensity as number;
    const hatchAngle = values.hatchAngle as number;
    const fillProbability = values.fillProbability as number;
    const varyAngle = values.varyAngle as boolean;

    const rand = mulberry32(seed);
    const polylines: { x: number; y: number }[][] = [];

    // Collect leaf rectangles via recursive subdivision
    const leaves: Rect[] = [];

    function subdivide(rect: Rect, depth: number): void {
      // Probability of splitting decreases with depth
      const splitProb = 1 - depth / (maxDepth + 1);
      if (depth >= maxDepth || rand() > splitProb) {
        leaves.push(rect);
        return;
      }

      // Determine split direction: prefer longer axis, modulated by splitBias
      // splitBias < 0.5 favors horizontal splits, > 0.5 favors vertical
      const aspectRatio = rect.w / (rect.w + rect.h); // 0..1, higher = wider
      const preferVertical = rand() < aspectRatio + (splitBias - 0.5) * 0.5;

      if (preferVertical) {
        // Vertical split (split along x-axis)
        const minW = minCellSize;
        if (rect.w < minW * 2) {
          leaves.push(rect);
          return;
        }
        // Split position: center +/- variation
        const center = 0.5;
        const offset = (rand() - 0.5) * 2 * splitVariation;
        const ratio = Math.max(0.2, Math.min(0.8, center + offset));
        const splitX = rect.w * ratio;

        if (splitX < minW || rect.w - splitX < minW) {
          leaves.push(rect);
          return;
        }

        subdivide({ x: rect.x, y: rect.y, w: splitX, h: rect.h }, depth + 1);
        subdivide(
          { x: rect.x + splitX, y: rect.y, w: rect.w - splitX, h: rect.h },
          depth + 1,
        );
      } else {
        // Horizontal split (split along y-axis)
        const minH = minCellSize;
        if (rect.h < minH * 2) {
          leaves.push(rect);
          return;
        }
        const center = 0.5;
        const offset = (rand() - 0.5) * 2 * splitVariation;
        const ratio = Math.max(0.2, Math.min(0.8, center + offset));
        const splitY = rect.h * ratio;

        if (splitY < minH || rect.h - splitY < minH) {
          leaves.push(rect);
          return;
        }

        subdivide({ x: rect.x, y: rect.y, w: rect.w, h: splitY }, depth + 1);
        subdivide(
          { x: rect.x, y: rect.y + splitY, w: rect.w, h: rect.h - splitY },
          depth + 1,
        );
      }
    }

    // Start with the full canvas minus margin
    subdivide(
      { x: margin, y: margin, w: width - margin * 2, h: height - margin * 2 },
      0,
    );

    // Apply gap inset to each leaf cell and generate polylines
    const halfGap = gap / 2;

    for (const leaf of leaves) {
      const rx = leaf.x + halfGap;
      const ry = leaf.y + halfGap;
      const rw = leaf.w - gap;
      const rh = leaf.h - gap;

      // Skip degenerate cells
      if (rw <= 0 || rh <= 0) continue;

      // Rectangle outline (closed: 5 points)
      if (showEdges) {
        polylines.push([
          { x: rx, y: ry },
          { x: rx + rw, y: ry },
          { x: rx + rw, y: ry + rh },
          { x: rx, y: ry + rh },
          { x: rx, y: ry },
        ]);
      }

      // Hatch fill
      if (hatchFill && rand() < fillProbability) {
        const angle = varyAngle
          ? hatchAngle + (rand() - 0.5) * 60
          : hatchAngle;
        const hatchLines = hatchRect(rx, ry, rw, rh, angle, hatchDensity);
        for (const line of hatchLines) {
          polylines.push(line);
        }
      }
    }

    return polylines;
  },
};

/**
 * Generate parallel hatch lines inside an axis-aligned rectangle.
 * Lines are at the given angle (degrees) with the given spacing.
 * Returns an array of 2-point polylines (line segments).
 */
function hatchRect(
  rx: number,
  ry: number,
  rw: number,
  rh: number,
  angleDeg: number,
  spacing: number,
): { x: number; y: number }[][] {
  const lines: { x: number; y: number }[][] = [];
  const rad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  // Direction along the hatch line and perpendicular to it
  const dx = cos;
  const dy = sin;
  // Perpendicular direction (used for stepping between lines)
  const px = -sin;
  const py = cos;

  // Rectangle center
  const cx = rx + rw / 2;
  const cy = ry + rh / 2;

  // Project rectangle corners onto the perpendicular axis to find
  // the range of offsets we need to cover
  const corners = [
    { x: rx, y: ry },
    { x: rx + rw, y: ry },
    { x: rx + rw, y: ry + rh },
    { x: rx, y: ry + rh },
  ];

  let minProj = Infinity;
  let maxProj = -Infinity;
  for (const c of corners) {
    const proj = (c.x - cx) * px + (c.y - cy) * py;
    if (proj < minProj) minProj = proj;
    if (proj > maxProj) maxProj = proj;
  }

  // Also find the range along the line direction for max extent
  let minLine = Infinity;
  let maxLine = -Infinity;
  for (const c of corners) {
    const proj = (c.x - cx) * dx + (c.y - cy) * dy;
    if (proj < minLine) minLine = proj;
    if (proj > maxLine) maxLine = proj;
  }

  // Generate lines at each offset along the perpendicular
  const startOffset = Math.ceil(minProj / spacing) * spacing;
  for (let d = startOffset; d <= maxProj; d += spacing) {
    // Line passes through center + d * perpendicular direction
    // Parameterized: P(t) = (cx + d*px + t*dx, cy + d*py + t*dy)
    // Clip to rectangle: rx <= P.x <= rx+rw, ry <= P.y <= ry+rh

    const ox = cx + d * px;
    const oy = cy + d * py;

    // Find t range where the line is inside the rectangle
    let tMin = minLine * 2;
    let tMax = maxLine * 2;

    // Clip against x bounds
    if (Math.abs(dx) > 1e-10) {
      const t1 = (rx - ox) / dx;
      const t2 = (rx + rw - ox) / dx;
      const tLo = Math.min(t1, t2);
      const tHi = Math.max(t1, t2);
      tMin = Math.max(tMin, tLo);
      tMax = Math.min(tMax, tHi);
    } else {
      // Line is vertical relative to x — check if inside x bounds
      if (ox < rx || ox > rx + rw) continue;
    }

    // Clip against y bounds
    if (Math.abs(dy) > 1e-10) {
      const t1 = (ry - oy) / dy;
      const t2 = (ry + rh - oy) / dy;
      const tLo = Math.min(t1, t2);
      const tHi = Math.max(t1, t2);
      tMin = Math.max(tMin, tLo);
      tMax = Math.min(tMax, tHi);
    } else {
      if (oy < ry || oy > ry + rh) continue;
    }

    if (tMin >= tMax) continue;

    lines.push([
      { x: ox + tMin * dx, y: oy + tMin * dy },
      { x: ox + tMax * dx, y: oy + tMax * dy },
    ]);
  }

  return lines;
}

export default recursiveSubdivision;
