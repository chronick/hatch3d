import type { Composition2DDefinition } from "../../types";

const PHI = (1 + Math.sqrt(5)) / 2;

// Robinson triangle types
const THICK = 0; // acute: 36-72-72 half-rhombus
const THIN = 1; // obtuse: 108-36-36 half-rhombus

interface Triangle {
  type: number; // THICK or THIN
  a: [number, number]; // apex
  b: [number, number];
  c: [number, number];
}

type Pt = { x: number; y: number };

function lerp2(
  p0: [number, number],
  p1: [number, number],
  t: number,
): [number, number] {
  return [p0[0] + (p1[0] - p0[0]) * t, p0[1] + (p1[1] - p0[1]) * t];
}

/**
 * Subdivide a list of Robinson triangles one level using Penrose P3 rules.
 * Each thick triangle (36-72-72) splits into 2 thick + 1 thin.
 * Each thin triangle (108-36-36) splits into 1 thick + 1 thin.
 */
function subdivide(triangles: Triangle[]): Triangle[] {
  const result: Triangle[] = [];
  const invPhi = 1 / PHI; // 1/phi = phi - 1

  for (const tri of triangles) {
    const { type, a, b, c } = tri;

    if (type === THICK) {
      // Thick (acute) half-rhombus: A is the 36 degree apex, B and C are 72 degree
      // Split point P on edge AB at ratio 1/phi from A
      // Split point Q on edge AC at ratio 1/phi from A
      const p = lerp2(a, b, invPhi);
      const q = lerp2(a, c, invPhi);

      // Produces: 2 thick + 1 thin
      result.push({ type: THICK, a: c, b: p, c: b });
      result.push({ type: THICK, a: q, b: p, c: c });
      result.push({ type: THIN, a: p, b: q, c: a });
    } else {
      // Thin (obtuse) half-rhombus: A is the 108 degree apex, B and C are 36 degree
      // Split point P on edge AB at ratio 1/phi from A
      const p = lerp2(b, a, invPhi);

      // Produces: 1 thick + 1 thin
      result.push({ type: THICK, a: p, b: c, c: b });
      result.push({ type: THIN, a: c, b: p, c: a });
    }
  }

  return result;
}

/**
 * Build initial wheel of 10 Robinson triangles centered at (cx, cy).
 * Alternating thick triangles arranged in a decagon.
 */
function buildWheel(
  cx: number,
  cy: number,
  radius: number,
  rotationRad: number,
): Triangle[] {
  const triangles: Triangle[] = [];

  for (let i = 0; i < 10; i++) {
    const angle0 = rotationRad + ((2 * Math.PI) / 10) * i;
    const angle1 = rotationRad + ((2 * Math.PI) / 10) * (i + 1);

    const b: [number, number] = [
      cx + radius * Math.cos(angle0),
      cy + radius * Math.sin(angle0),
    ];
    const c: [number, number] = [
      cx + radius * Math.cos(angle1),
      cy + radius * Math.sin(angle1),
    ];

    // Alternate triangle orientation for proper tiling
    if (i % 2 === 0) {
      triangles.push({ type: THICK, a: [cx, cy], b, c });
    } else {
      triangles.push({ type: THICK, a: [cx, cy], b: c, c: b });
    }
  }

  return triangles;
}

/**
 * Extract rhombus tiles from pairs of adjacent triangles sharing an edge.
 * Returns arrays of 4 vertices (the rhombus corners) and tile type.
 */
function extractRhombuses(
  triangles: Triangle[],
): { vertices: [number, number][]; type: number }[] {
  // Key triangles by their edge (b,c) which is the long edge / pairing edge
  const edgeMap = new Map<string, Triangle[]>();

  function edgeKey(
    p1: [number, number],
    p2: [number, number],
  ): string {
    // Round to avoid floating point mismatches
    const x1 = Math.round(p1[0] * 1e6);
    const y1 = Math.round(p1[1] * 1e6);
    const x2 = Math.round(p2[0] * 1e6);
    const y2 = Math.round(p2[1] * 1e6);
    // Canonical ordering
    if (x1 < x2 || (x1 === x2 && y1 < y2)) {
      return `${x1},${y1},${x2},${y2}`;
    }
    return `${x2},${y2},${x1},${y1}`;
  }

  for (const tri of triangles) {
    const key = edgeKey(tri.b, tri.c);
    let list = edgeMap.get(key);
    if (!list) {
      list = [];
      edgeMap.set(key, list);
    }
    list.push(tri);
  }

  const rhombuses: { vertices: [number, number][]; type: number }[] = [];

  for (const [, tris] of edgeMap) {
    if (tris.length === 2 && tris[0].type === tris[1].type) {
      // Pair of mirrored half-rhombuses form a full rhombus
      // Rhombus vertices: A of first, B shared, A of second, C shared
      const t1 = tris[0];
      const t2 = tris[1];
      rhombuses.push({
        vertices: [t1.a, t1.b, t2.a, t1.c],
        type: t1.type,
      });
    } else {
      // Unpaired triangles: output as individual triangle outlines
      for (const tri of tris) {
        rhombuses.push({
          vertices: [tri.a, tri.b, tri.c],
          type: tri.type,
        });
      }
    }
  }

  return rhombuses;
}

/**
 * Compute intersection of a line segment with a polygon edge.
 * Returns parameter t along the hatch line, or null if no intersection.
 */
function segmentIntersection(
  lx0: number,
  ly0: number,
  ldx: number,
  ldy: number,
  ex0: number,
  ey0: number,
  ex1: number,
  ey1: number,
): number | null {
  const edx = ex1 - ex0;
  const edy = ey1 - ey0;
  const denom = ldx * edy - ldy * edx;
  if (Math.abs(denom) < 1e-12) return null;

  const t = ((ex0 - lx0) * edy - (ey0 - ly0) * edx) / denom;
  const u = ((ex0 - lx0) * ldy - (ey0 - ly0) * ldx) / denom;

  if (u >= -1e-9 && u <= 1 + 1e-9) {
    return t;
  }
  return null;
}

/**
 * Generate parallel hatch lines inside a convex polygon.
 */
function hatchPolygon(
  vertices: [number, number][],
  angleDeg: number,
  spacing: number,
): Pt[][] {
  if (vertices.length < 3 || spacing <= 0) return [];

  const angleRad = (angleDeg * Math.PI) / 180;
  const dirX = Math.cos(angleRad);
  const dirY = Math.sin(angleRad);
  // Normal to hatch direction
  const normX = -dirY;
  const normY = dirX;

  // Project all vertices onto the normal axis
  let minProj = Infinity;
  let maxProj = -Infinity;
  for (const v of vertices) {
    const proj = v[0] * normX + v[1] * normY;
    if (proj < minProj) minProj = proj;
    if (proj > maxProj) maxProj = proj;
  }

  const lines: Pt[][] = [];
  const n = vertices.length;

  // Step through parallel lines
  const startProj = Math.ceil(minProj / spacing) * spacing;
  for (let proj = startProj; proj <= maxProj; proj += spacing) {
    // Line origin at this projection distance
    const lx0 = normX * proj;
    const ly0 = normY * proj;

    // Find intersections with polygon edges
    const intersections: number[] = [];
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const t = segmentIntersection(
        lx0,
        ly0,
        dirX,
        dirY,
        vertices[i][0],
        vertices[i][1],
        vertices[j][0],
        vertices[j][1],
      );
      if (t !== null) {
        intersections.push(t);
      }
    }

    // Sort and take pairs
    intersections.sort((a, b) => a - b);

    // Remove near-duplicate intersections (from vertices)
    const deduped: number[] = [];
    for (const t of intersections) {
      if (deduped.length === 0 || Math.abs(t - deduped[deduped.length - 1]) > 1e-6) {
        deduped.push(t);
      }
    }

    for (let k = 0; k + 1 < deduped.length; k += 2) {
      const t0 = deduped[k];
      const t1 = deduped[k + 1];
      if (Math.abs(t1 - t0) > 1e-6) {
        lines.push([
          { x: lx0 + dirX * t0, y: ly0 + dirY * t0 },
          { x: lx0 + dirX * t1, y: ly0 + dirY * t1 },
        ]);
      }
    }
  }

  return lines;
}

/**
 * Clip a polyline to a rectangular canvas [0, width] x [0, height].
 * Returns segments that are inside the bounds.
 */
function clipPolylineToCanvas(
  polyline: Pt[],
  width: number,
  height: number,
): Pt[][] {
  if (polyline.length < 2) return [];

  const result: Pt[][] = [];
  let current: Pt[] = [];

  function clipSegment(
    p0: Pt,
    p1: Pt,
  ): [Pt, Pt] | null {
    let t0 = 0;
    let t1 = 1;
    const dx = p1.x - p0.x;
    const dy = p1.y - p0.y;

    function clipEdge(p: number, q: number): boolean {
      if (Math.abs(p) < 1e-12) {
        return q >= 0;
      }
      const t = q / p;
      if (p < 0) {
        if (t > t1) return false;
        if (t > t0) t0 = t;
      } else {
        if (t < t0) return false;
        if (t < t1) t1 = t;
      }
      return true;
    }

    if (
      !clipEdge(-dx, p0.x - 0) ||
      !clipEdge(dx, width - p0.x) ||
      !clipEdge(-dy, p0.y - 0) ||
      !clipEdge(dy, height - p0.y)
    ) {
      return null;
    }

    if (t0 > t1) return null;

    return [
      { x: p0.x + t0 * dx, y: p0.y + t0 * dy },
      { x: p0.x + t1 * dx, y: p0.y + t1 * dy },
    ];
  }

  for (let i = 0; i < polyline.length - 1; i++) {
    const p0 = polyline[i];
    const p1 = polyline[i + 1];

    const clipped = clipSegment(p0, p1);
    if (clipped) {
      const [c0, c1] = clipped;
      if (current.length === 0) {
        current.push(c0);
      } else {
        // Check continuity
        const last = current[current.length - 1];
        const dist = Math.abs(last.x - c0.x) + Math.abs(last.y - c0.y);
        if (dist > 1e-4) {
          if (current.length >= 2) result.push(current);
          current = [c0];
        }
      }
      current.push(c1);
    } else {
      if (current.length >= 2) result.push(current);
      current = [];
    }
  }

  if (current.length >= 2) result.push(current);
  return result;
}

const penroseTiling: Composition2DDefinition = {
  id: "penroseTiling",
  name: "Penrose Tiling",
  description:
    "Aperiodic Penrose P3 rhombus tiling with optional hatch fills",
  tags: ["pattern", "penrose", "tiling", "aperiodic", "geometric"],
  category: "2d",
  type: "2d",

  controls: {
    subdivisions: {
      type: "slider",
      label: "Subdivisions",
      default: 5,
      min: 2,
      max: 8,
      step: 1,
      group: "Tiling",
    },
    scale: {
      type: "slider",
      label: "Scale",
      default: 1,
      min: 0.3,
      max: 3,
      step: 0.05,
      group: "Tiling",
    },
    rotation: {
      type: "slider",
      label: "Rotation",
      default: 0,
      min: 0,
      max: 360,
      step: 1,
      group: "Tiling",
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
      label: "Hatch Density",
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
    thickHatch: {
      type: "toggle",
      label: "Hatch Thick Tiles",
      default: true,
      group: "Hatching",
    },
    thinHatch: {
      type: "toggle",
      label: "Hatch Thin Tiles",
      default: true,
      group: "Hatching",
    },
  },

  generate({ width, height, values }) {
    const subdivisions = Math.round(values.subdivisions as number);
    const scale = values.scale as number;
    const rotationDeg = values.rotation as number;
    const showEdges = values.showEdges as boolean;
    const hatchFill = values.hatchFill as boolean;
    const hatchDensity = values.hatchDensity as number;
    const hatchAngle = values.hatchAngle as number;
    const thickHatch = values.thickHatch as boolean;
    const thinHatch = values.thinHatch as boolean;

    const cx = width / 2;
    const cy = height / 2;

    // Initial radius must be large enough to cover the canvas after subdivision.
    // Each subdivision shrinks features by phi, so we need radius * phi^(-n) to
    // still cover the canvas diagonal.
    const diagonal = Math.sqrt(width * width + height * height);
    const baseRadius = (diagonal * 0.75 * scale * Math.pow(PHI, subdivisions - 3));
    const rotationRad = (rotationDeg * Math.PI) / 180;

    // Build initial wheel and subdivide
    let triangles = buildWheel(cx, cy, baseRadius, rotationRad);
    for (let i = 0; i < subdivisions; i++) {
      triangles = subdivide(triangles);
    }

    // Extract rhombus tiles
    const rhombuses = extractRhombuses(triangles);

    const polylines: Pt[][] = [];

    for (const rhombus of rhombuses) {
      const verts = rhombus.vertices;

      if (showEdges) {
        // Closed polyline for the tile outline
        const outline: Pt[] = verts.map((v) => ({ x: v[0], y: v[1] }));
        outline.push({ x: verts[0][0], y: verts[0][1] }); // close

        // Clip and add
        const clipped = clipPolylineToCanvas(outline, width, height);
        for (const seg of clipped) {
          if (seg.length >= 2) polylines.push(seg);
        }
      }

      if (hatchFill) {
        const shouldHatch =
          (rhombus.type === THICK && thickHatch) ||
          (rhombus.type === THIN && thinHatch);

        if (shouldHatch) {
          const hatchLines = hatchPolygon(verts, hatchAngle, hatchDensity);
          for (const line of hatchLines) {
            const clipped = clipPolylineToCanvas(line, width, height);
            for (const seg of clipped) {
              if (seg.length >= 2) polylines.push(seg);
            }
          }
        }
      }
    }

    return polylines;
  },
};

export default penroseTiling;
