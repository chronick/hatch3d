import type { Composition2DDefinition } from "../../types";
import { wasmGenerateVoronoi } from "../../../wasm-pipeline-2d";

interface Point {
  x: number;
  y: number;
}

interface Triangle {
  a: number;
  b: number;
  c: number;
}

const voronoiTexture: Composition2DDefinition = {
  id: "voronoiTexture",
  name: "Voronoi Texture",
  description:
    "Voronoi diagram via Bowyer-Watson triangulation with optional Lloyd relaxation and per-cell hatch fill",
  tags: ["generative", "voronoi", "tessellation", "texture"],
  category: "2d",
  type: "2d",

  macros: {
    detail: {
      label: "Detail",
      default: 0.5,
      targets: [
        { param: "pointCount", fn: "linear", strength: 0.8 },
        { param: "fillDensity", fn: "linear", strength: 0.6 },
      ],
    },
  },

  controls: {
    pointCount: {
      type: "slider",
      label: "Points",
      default: 150,
      min: 20,
      max: 2000,
      step: 10,
      group: "Points",
    },
    distribution: {
      type: "select",
      label: "Distribution",
      default: "random",
      options: [
        { label: "Random", value: "random" },
        { label: "Grid + Jitter", value: "jitter" },
        { label: "Clustered", value: "clustered" },
      ],
      group: "Points",
    },
    relaxIterations: {
      type: "slider",
      label: "Lloyd Relaxation",
      default: 0,
      min: 0,
      max: 20,
      step: 1,
      group: "Points",
    },
    fillCells: {
      type: "toggle",
      label: "Fill Cells (experimental, may produce overlaps)",
      default: false,
      group: "Fill",
    },
    fillDensity: {
      type: "slider",
      label: "Fill Density",
      default: 6,
      min: 2,
      max: 20,
      step: 1,
      group: "Fill",
    },
    variedAngles: {
      type: "toggle",
      label: "Varied Angles",
      default: true,
      group: "Fill",
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
  },

  wasmGenerate: wasmGenerateVoronoi,

  generate({ width, height, values }) {
    const pointCount = Math.round(values.pointCount as number);
    const distribution = values.distribution as string;
    const relaxIter = Math.round(values.relaxIterations as number);
    const fillCells = values.fillCells as boolean;
    const fillDensity = Math.round(values.fillDensity as number);
    const variedAngles = values.variedAngles as boolean;
    const margin = values.margin as number;

    const xMin = margin;
    const xMax = width - margin;
    const yMin = margin;
    const yMax = height - margin;

    // Generate initial points
    const points: Point[] = [];

    if (distribution === "jitter") {
      const side = Math.ceil(Math.sqrt(pointCount));
      const dx = (xMax - xMin) / side;
      const dy = (yMax - yMin) / side;
      for (let i = 0; i < side && points.length < pointCount; i++) {
        for (let j = 0; j < side && points.length < pointCount; j++) {
          points.push({
            x: xMin + (i + 0.5) * dx + (Math.random() - 0.5) * dx * 0.8,
            y: yMin + (j + 0.5) * dy + (Math.random() - 0.5) * dy * 0.8,
          });
        }
      }
    } else if (distribution === "clustered") {
      const clusters = Math.max(3, Math.floor(pointCount / 20));
      const centers: Point[] = [];
      for (let i = 0; i < clusters; i++) {
        centers.push({
          x: xMin + Math.random() * (xMax - xMin),
          y: yMin + Math.random() * (yMax - yMin),
        });
      }
      const spread = Math.min(xMax - xMin, yMax - yMin) * 0.1;
      for (let i = 0; i < pointCount; i++) {
        const c = centers[i % clusters];
        points.push({
          x: Math.max(xMin, Math.min(xMax, c.x + (Math.random() - 0.5) * spread * 2)),
          y: Math.max(yMin, Math.min(yMax, c.y + (Math.random() - 0.5) * spread * 2)),
        });
      }
    } else {
      for (let i = 0; i < pointCount; i++) {
        points.push({
          x: xMin + Math.random() * (xMax - xMin),
          y: yMin + Math.random() * (yMax - yMin),
        });
      }
    }

    // Bowyer-Watson Delaunay triangulation
    function triangulate(pts: Point[]): Triangle[] {
      // Super-triangle encompassing all points
      const dx = xMax - xMin;
      const dy = yMax - yMin;
      const dmax = Math.max(dx, dy) * 2;
      const superA = pts.length;
      const superB = pts.length + 1;
      const superC = pts.length + 2;

      pts.push(
        { x: xMin - dmax, y: yMin - dmax },
        { x: xMin + dmax * 3, y: yMin - dmax },
        { x: xMin, y: yMin + dmax * 3 },
      );

      let triangles: Triangle[] = [{ a: superA, b: superB, c: superC }];

      function circumscribes(tri: Triangle, p: Point): boolean {
        const ax = pts[tri.a].x, ay = pts[tri.a].y;
        const bx = pts[tri.b].x, by = pts[tri.b].y;
        const cx = pts[tri.c].x, cy = pts[tri.c].y;

        const D = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
        if (Math.abs(D) < 1e-10) return false;

        const ux = ((ax * ax + ay * ay) * (by - cy) +
                     (bx * bx + by * by) * (cy - ay) +
                     (cx * cx + cy * cy) * (ay - by)) / D;
        const uy = ((ax * ax + ay * ay) * (cx - bx) +
                     (bx * bx + by * by) * (ax - cx) +
                     (cx * cx + cy * cy) * (bx - ax)) / D;

        const r2 = (ax - ux) ** 2 + (ay - uy) ** 2;
        return (p.x - ux) ** 2 + (p.y - uy) ** 2 < r2;
      }

      // Insert points one at a time
      for (let i = 0; i < pts.length - 3; i++) {
        const p = pts[i];
        const bad: Triangle[] = [];
        const good: Triangle[] = [];

        for (const tri of triangles) {
          if (circumscribes(tri, p)) {
            bad.push(tri);
          } else {
            good.push(tri);
          }
        }

        // Find boundary polygon of bad triangles
        const edges: [number, number][] = [];
        for (const tri of bad) {
          const triEdges: [number, number][] = [
            [tri.a, tri.b], [tri.b, tri.c], [tri.c, tri.a],
          ];
          for (const [ea, eb] of triEdges) {
            let shared = false;
            for (const other of bad) {
              if (other === tri) continue;
              const oe: [number, number][] = [
                [other.a, other.b], [other.b, other.c], [other.c, other.a],
              ];
              for (const [oa, ob] of oe) {
                if ((ea === oa && eb === ob) || (ea === ob && eb === oa)) {
                  shared = true;
                  break;
                }
              }
              if (shared) break;
            }
            if (!shared) edges.push([ea, eb]);
          }
        }

        triangles = good;
        for (const [ea, eb] of edges) {
          triangles.push({ a: i, b: ea, c: eb });
        }
      }

      // Remove triangles connected to super-triangle vertices
      return triangles.filter(
        (t) => t.a < superA && t.b < superA && t.c < superA,
      );
    }

    // Lloyd relaxation
    for (let iter = 0; iter < relaxIter; iter++) {
      const tris = triangulate([...points]);
      // Remove super-triangle points added during triangulation
      points.splice(pointCount);

      // Compute Voronoi centroids as average of Voronoi vertices
      const cellVertices: Point[][] = Array.from({ length: pointCount }, () => []);

      for (const tri of tris) {
        const ax = points[tri.a].x, ay = points[tri.a].y;
        const bx = points[tri.b].x, by = points[tri.b].y;
        const cx = points[tri.c].x, cy = points[tri.c].y;

        const D = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
        if (Math.abs(D) < 1e-10) continue;

        const ux = ((ax * ax + ay * ay) * (by - cy) +
                     (bx * bx + by * by) * (cy - ay) +
                     (cx * cx + cy * cy) * (ay - by)) / D;
        const uy = ((ax * ax + ay * ay) * (cx - bx) +
                     (bx * bx + by * by) * (ax - cx) +
                     (cx * cx + cy * cy) * (bx - ax)) / D;

        const cc = { x: ux, y: uy };
        if (tri.a < pointCount) cellVertices[tri.a].push(cc);
        if (tri.b < pointCount) cellVertices[tri.b].push(cc);
        if (tri.c < pointCount) cellVertices[tri.c].push(cc);
      }

      // Move each point to centroid of its Voronoi cell
      for (let i = 0; i < pointCount; i++) {
        const verts = cellVertices[i];
        if (verts.length === 0) continue;
        let sx = 0, sy = 0;
        for (const v of verts) {
          sx += v.x;
          sy += v.y;
        }
        points[i] = {
          x: Math.max(xMin, Math.min(xMax, sx / verts.length)),
          y: Math.max(yMin, Math.min(yMax, sy / verts.length)),
        };
      }
    }

    // Final triangulation
    const finalPts = [...points];
    const tris = triangulate(finalPts);
    // Remove super-triangle points
    finalPts.splice(pointCount);

    // Extract Voronoi edges from Delaunay dual
    const polylines: { x: number; y: number }[][] = [];

    function circumcenter(tri: Triangle): Point | null {
      const ax = finalPts[tri.a].x, ay = finalPts[tri.a].y;
      const bx = finalPts[tri.b].x, by = finalPts[tri.b].y;
      const cx = finalPts[tri.c].x, cy = finalPts[tri.c].y;

      const D = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
      if (Math.abs(D) < 1e-10) return null;

      return {
        x: ((ax * ax + ay * ay) * (by - cy) +
             (bx * bx + by * by) * (cy - ay) +
             (cx * cx + cy * cy) * (ay - by)) / D,
        y: ((ax * ax + ay * ay) * (cx - bx) +
             (bx * bx + by * by) * (ax - cx) +
             (cx * cx + cy * cy) * (bx - ax)) / D,
      };
    }

    // Build edge-to-triangle adjacency
    const edgeMap = new Map<string, number[]>();
    for (let i = 0; i < tris.length; i++) {
      const tri = tris[i];
      const edges: [number, number][] = [
        [Math.min(tri.a, tri.b), Math.max(tri.a, tri.b)],
        [Math.min(tri.b, tri.c), Math.max(tri.b, tri.c)],
        [Math.min(tri.a, tri.c), Math.max(tri.a, tri.c)],
      ];
      for (const [ea, eb] of edges) {
        const key = `${ea},${eb}`;
        let list = edgeMap.get(key);
        if (!list) {
          list = [];
          edgeMap.set(key, list);
        }
        list.push(i);
      }
    }

    // Voronoi edges: connect circumcenters of adjacent triangles
    for (const [, triIndices] of edgeMap) {
      if (triIndices.length !== 2) continue;
      const c1 = circumcenter(tris[triIndices[0]]);
      const c2 = circumcenter(tris[triIndices[1]]);
      if (!c1 || !c2) continue;

      // Clip to bounds
      if (c1.x < xMin - 50 || c1.x > xMax + 50 || c1.y < yMin - 50 || c1.y > yMax + 50) continue;
      if (c2.x < xMin - 50 || c2.x > xMax + 50 || c2.y < yMin - 50 || c2.y > yMax + 50) continue;

      polylines.push([
        { x: Math.max(xMin, Math.min(xMax, c1.x)), y: Math.max(yMin, Math.min(yMax, c1.y)) },
        { x: Math.max(xMin, Math.min(xMax, c2.x)), y: Math.max(yMin, Math.min(yMax, c2.y)) },
      ]);
    }

    // Optional: fill cells with hatch lines
    if (fillCells) {
      // Build Voronoi cells for each point
      const cellVerts: Point[][] = Array.from({ length: pointCount }, () => []);

      for (let i = 0; i < tris.length; i++) {
        const cc = circumcenter(tris[i]);
        if (!cc) continue;
        const tri = tris[i];
        if (tri.a < pointCount) cellVerts[tri.a].push(cc);
        if (tri.b < pointCount) cellVerts[tri.b].push(cc);
        if (tri.c < pointCount) cellVerts[tri.c].push(cc);
      }

      for (let i = 0; i < pointCount; i++) {
        const verts = cellVerts[i];
        if (verts.length < 3) continue;

        // Sort vertices by angle around the cell's center
        const center = points[i];
        verts.sort(
          (a, b) =>
            Math.atan2(a.y - center.y, a.x - center.x) -
            Math.atan2(b.y - center.y, b.x - center.x),
        );

        // Compute cell bounding box
        let minX = Infinity, maxX = -Infinity;
        let minY = Infinity, maxY = -Infinity;
        for (const v of verts) {
          if (v.x < minX) minX = v.x;
          if (v.x > maxX) maxX = v.x;
          if (v.y < minY) minY = v.y;
          if (v.y > maxY) maxY = v.y;
        }

        // Hatch fill with scan lines
        const angle = variedAngles ? i * 2.399 : 0; // golden angle for variety
        const ca = Math.cos(angle);
        const sa = Math.sin(angle);

        const cellHeight = maxY - minY;
        const cellWidth = maxX - minX;
        const extent = Math.sqrt(cellHeight ** 2 + cellWidth ** 2);
        const spacing = extent / fillDensity;

        for (let li = -fillDensity; li <= fillDensity; li++) {
          const offset = li * spacing;
          // Rotated scan line
          const lx1 = center.x + ca * (-extent) - sa * offset;
          const ly1 = center.y + sa * (-extent) + ca * offset;
          const lx2 = center.x + ca * extent - sa * offset;
          const ly2 = center.y + sa * extent + ca * offset;

          // Intersect scan line with cell polygon
          const intersections: number[] = [];
          for (let j = 0; j < verts.length; j++) {
            const k = (j + 1) % verts.length;
            const x1 = verts[j].x, y1 = verts[j].y;
            const x2 = verts[k].x, y2 = verts[k].y;

            const denom =
              (lx1 - lx2) * (y1 - y2) - (ly1 - ly2) * (x1 - x2);
            if (Math.abs(denom) < 1e-10) continue;

            const t =
              ((lx1 - x1) * (y1 - y2) - (ly1 - y1) * (x1 - x2)) / denom;
            const u =
              -((lx1 - lx2) * (ly1 - y1) - (ly1 - ly2) * (lx1 - x1)) / denom;

            if (u >= 0 && u <= 1 && t >= 0 && t <= 1) {
              intersections.push(t);
            }
          }

          intersections.sort((a, b) => a - b);

          // Draw segments between pairs
          for (let j = 0; j + 1 < intersections.length; j += 2) {
            const t1 = intersections[j];
            const t2 = intersections[j + 1];
            polylines.push([
              {
                x: lx1 + (lx2 - lx1) * t1,
                y: ly1 + (ly2 - ly1) * t1,
              },
              {
                x: lx1 + (lx2 - lx1) * t2,
                y: ly1 + (ly2 - ly1) * t2,
              },
            ]);
          }
        }
      }
    }

    return polylines;
  },
};

export default voronoiTexture;
