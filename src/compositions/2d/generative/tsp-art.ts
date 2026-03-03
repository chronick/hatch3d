import type { Composition2DDefinition } from "../../types";
import { SURFACES } from "../../../surfaces";

const tspArt: Composition2DDefinition = {
  id: "tspArt",
  name: "TSP Art",
  description:
    "Sample points from a 3D surface projection, then connect them via a travelling salesman path for a single continuous line drawing",
  tags: ["generative", "tsp", "optimization", "single-line"],
  category: "2d",
  renderMode: "manual",
  type: "2d",

  macros: {
    detail: {
      label: "Detail",
      default: 0.5,
      targets: [
        { param: "pointCount", fn: "linear", strength: 0.8 },
        { param: "optimizationPasses", fn: "linear", strength: 0.6 },
      ],
    },
  },

  controls: {
    surfaceType: {
      type: "select",
      label: "Surface",
      default: "torus",
      options: [
        { label: "Torus", value: "torus" },
        { label: "Hyperboloid", value: "hyperboloid" },
        { label: "Canopy", value: "canopy" },
        { label: "Conoid", value: "conoid" },
        { label: "Twisted Ribbon", value: "twistedRibbon" },
      ],
      group: "Surface",
    },
    pointCount: {
      type: "slider",
      label: "Points",
      default: 600,
      min: 200,
      max: 5000,
      step: 50,
      group: "Sampling",
    },
    distribution: {
      type: "select",
      label: "Distribution",
      default: "uniform",
      options: [
        { label: "Uniform Grid", value: "uniform" },
        { label: "Random", value: "random" },
        { label: "Poisson Disk", value: "poisson" },
      ],
      group: "Sampling",
    },
    rotationX: {
      type: "slider",
      label: "Rotation X",
      default: 0.4,
      min: 0,
      max: 3.14,
      step: 0.01,
      group: "View",
    },
    rotationY: {
      type: "slider",
      label: "Rotation Y",
      default: 0.3,
      min: 0,
      max: 6.28,
      step: 0.01,
      group: "View",
    },
    scale: {
      type: "slider",
      label: "Scale",
      default: 120,
      min: 50,
      max: 300,
      step: 5,
      group: "View",
    },
    optimizationPasses: {
      type: "slider",
      label: "2-Opt Passes",
      default: 3,
      min: 0,
      max: 10,
      step: 1,
      group: "Solver",
    },
  },

  generate({ width, height, values }) {
    const surfaceKey = values.surfaceType as string;
    const pointCount = Math.round(values.pointCount as number);
    const distribution = values.distribution as string;
    const rotX = values.rotationX as number;
    const rotY = values.rotationY as number;
    const scale = values.scale as number;
    const passes = Math.round(values.optimizationPasses as number);

    const cx = width / 2;
    const cy = height / 2;

    const surfaceDef = SURFACES[surfaceKey];
    if (!surfaceDef) return [];

    const surfaceFn = surfaceDef.fn;
    const params = surfaceDef.defaults;

    // Rotation matrix (Rx * Ry)
    const cosX = Math.cos(rotX), sinX = Math.sin(rotX);
    const cosY = Math.cos(rotY), sinY = Math.sin(rotY);

    function project(x3: number, y3: number, z3: number): { x: number; y: number } {
      // Apply Y rotation
      const x1 = x3 * cosY + z3 * sinY;
      const y1 = y3;
      const z1 = -x3 * sinY + z3 * cosY;
      // Apply X rotation
      const x2 = x1;
      const y2 = y1 * cosX - z1 * sinX;
      // Orthographic projection
      return { x: cx + x2 * scale, y: cy - y2 * scale };
    }

    // Sample points from the surface
    const points: { x: number; y: number }[] = [];

    if (distribution === "random") {
      for (let i = 0; i < pointCount; i++) {
        const u = Math.random();
        const v = Math.random();
        const p = surfaceFn(u, v, params);
        points.push(project(p.x, p.y, p.z));
      }
    } else if (distribution === "poisson") {
      // Simple Poisson-disk-like sampling in UV space
      const minDist = 1 / Math.sqrt(pointCount);
      const active: { u: number; v: number }[] = [];
      const grid = new Map<string, boolean>();
      const cellSize = minDist / Math.SQRT2;

      function gridKey(u: number, v: number): string {
        return `${Math.floor(u / cellSize)},${Math.floor(v / cellSize)}`;
      }

      function canPlace(u: number, v: number): boolean {
        const gi = Math.floor(u / cellSize);
        const gj = Math.floor(v / cellSize);
        for (let di = -2; di <= 2; di++) {
          for (let dj = -2; dj <= 2; dj++) {
            if (grid.has(`${gi + di},${gj + dj}`)) {
              // Check distance to actual point — simplified: just reject
              return false;
            }
          }
        }
        return true;
      }

      // Seed
      const seed = { u: 0.5, v: 0.5 };
      active.push(seed);
      grid.set(gridKey(seed.u, seed.v), true);

      while (active.length > 0 && points.length < pointCount) {
        const idx = Math.floor(Math.random() * active.length);
        const pt = active[idx];
        let placed = false;

        for (let attempt = 0; attempt < 30; attempt++) {
          const angle = Math.random() * Math.PI * 2;
          const dist = minDist + Math.random() * minDist;
          const nu = pt.u + Math.cos(angle) * dist;
          const nv = pt.v + Math.sin(angle) * dist;

          if (nu >= 0 && nu <= 1 && nv >= 0 && nv <= 1 && canPlace(nu, nv)) {
            active.push({ u: nu, v: nv });
            grid.set(gridKey(nu, nv), true);
            const p = surfaceFn(nu, nv, params);
            points.push(project(p.x, p.y, p.z));
            placed = true;
            break;
          }
        }

        if (!placed) {
          active.splice(idx, 1);
        }
      }

      // Add seed point
      const sp = surfaceFn(seed.u, seed.v, params);
      points.push(project(sp.x, sp.y, sp.z));
    } else {
      // Uniform grid
      const side = Math.ceil(Math.sqrt(pointCount));
      for (let i = 0; i < side && points.length < pointCount; i++) {
        for (let j = 0; j < side && points.length < pointCount; j++) {
          const u = (i + 0.5) / side;
          const v = (j + 0.5) / side;
          const p = surfaceFn(u, v, params);
          points.push(project(p.x, p.y, p.z));
        }
      }
    }

    if (points.length < 2) return [];

    // Nearest-neighbor TSP heuristic
    const n = points.length;
    const visited = new Uint8Array(n);
    const order: number[] = [0];
    visited[0] = 1;

    for (let step = 1; step < n; step++) {
      const last = order[order.length - 1];
      let bestDist = Infinity;
      let bestIdx = -1;

      for (let j = 0; j < n; j++) {
        if (visited[j]) continue;
        const dx = points[last].x - points[j].x;
        const dy = points[last].y - points[j].y;
        const d2 = dx * dx + dy * dy;
        if (d2 < bestDist) {
          bestDist = d2;
          bestIdx = j;
        }
      }

      if (bestIdx >= 0) {
        visited[bestIdx] = 1;
        order.push(bestIdx);
      }
    }

    // 2-opt local optimization
    function dist(i: number, j: number): number {
      const a = points[order[i]];
      const b = points[order[j]];
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      return Math.sqrt(dx * dx + dy * dy);
    }

    for (let pass = 0; pass < passes; pass++) {
      let improved = true;
      while (improved) {
        improved = false;
        for (let i = 0; i < order.length - 2; i++) {
          for (let j = i + 2; j < order.length - 1; j++) {
            const oldDist = dist(i, i + 1) + dist(j, j + 1);
            const newDist = dist(i, j) + dist(i + 1, j + 1);
            if (newDist < oldDist - 1e-6) {
              // Reverse segment between i+1 and j
              let left = i + 1;
              let right = j;
              while (left < right) {
                const tmp = order[left];
                order[left] = order[right];
                order[right] = tmp;
                left++;
                right--;
              }
              improved = true;
            }
          }
        }
      }
    }

    // Build output polyline
    const path = order.map((idx) => ({ x: points[idx].x, y: points[idx].y }));

    return [path];
  },
};

export default tspArt;
