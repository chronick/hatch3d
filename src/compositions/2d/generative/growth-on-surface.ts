import type { Composition2DDefinition } from "../../types";
import { SURFACES } from "../../../surfaces";

interface Node {
  u: number;
  v: number;
  fu: number;
  fv: number;
}

const growthOnSurface: Composition2DDefinition = {
  id: "growthOnSurface",
  name: "Growth on Surface",
  description:
    "Differential growth simulation in UV space mapped through a parametric surface, creating organic forms distorted by 3D geometry",
  tags: ["generative", "simulation", "growth", "surface", "organic"],
  category: "2d",
  type: "2d",

  macros: {
    growth: {
      label: "Growth",
      default: 0.5,
      targets: [
        { param: "iterations", fn: "linear", strength: 0.8 },
        { param: "maxNodes", fn: "linear", strength: 0.6 },
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
    viewScale: {
      type: "slider",
      label: "Scale",
      default: 120,
      min: 50,
      max: 300,
      step: 5,
      group: "View",
    },
    initialNodes: {
      type: "slider",
      label: "Initial Nodes",
      default: 40,
      min: 20,
      max: 200,
      step: 5,
      group: "Init",
    },
    initialRadius: {
      type: "slider",
      label: "Init Radius",
      default: 0.08,
      min: 0.02,
      max: 0.25,
      step: 0.01,
      group: "Init",
    },
    iterations: {
      type: "slider",
      label: "Iterations",
      default: 400,
      min: 50,
      max: 3000,
      step: 50,
      group: "Simulation",
    },
    repulsionRadius: {
      type: "slider",
      label: "Repulsion Radius",
      default: 0.04,
      min: 0.01,
      max: 0.15,
      step: 0.005,
      group: "Forces",
    },
    repulsionStrength: {
      type: "slider",
      label: "Repulsion",
      default: 0.008,
      min: 0.001,
      max: 0.03,
      step: 0.001,
      group: "Forces",
    },
    springK: {
      type: "slider",
      label: "Spring Stiffness",
      default: 0.15,
      min: 0.05,
      max: 0.5,
      step: 0.01,
      group: "Forces",
    },
    maxEdgeLength: {
      type: "slider",
      label: "Max Edge Length",
      default: 0.03,
      min: 0.01,
      max: 0.1,
      step: 0.005,
      group: "Growth",
    },
    maxNodes: {
      type: "slider",
      label: "Max Nodes",
      default: 2000,
      min: 500,
      max: 8000,
      step: 100,
      group: "Growth",
    },
  },

  generate({ width, height, values }) {
    const surfaceKey = values.surfaceType as string;
    const rotX = values.rotationX as number;
    const rotY = values.rotationY as number;
    const viewScale = values.viewScale as number;
    const initialNodeCount = Math.round(values.initialNodes as number);
    const initialRadius = values.initialRadius as number;
    const iterations = Math.round(values.iterations as number);
    const repulsionRadius = values.repulsionRadius as number;
    const repulsionStrength = values.repulsionStrength as number;
    const springK = values.springK as number;
    const maxEdgeLength = values.maxEdgeLength as number;
    const maxNodes = Math.round(values.maxNodes as number);

    const cx = width / 2;
    const cy = height / 2;

    // Surface projection setup
    const surfaceDef = SURFACES[surfaceKey];
    if (!surfaceDef) return [];

    const surfaceFn = surfaceDef.fn;
    const surfaceParams = surfaceDef.defaults;
    const cosX = Math.cos(rotX), sinX = Math.sin(rotX);
    const cosY = Math.cos(rotY), sinY = Math.sin(rotY);

    function projectPoint(u: number, v: number): { x: number; y: number } {
      const p = surfaceFn(u, v, surfaceParams);
      const x1 = p.x * cosY + p.z * sinY;
      const y1 = p.y;
      const z1 = -p.x * sinY + p.z * cosY;
      const x2 = x1;
      const y2 = y1 * cosX - z1 * sinX;
      return { x: cx + x2 * viewScale, y: cy - y2 * viewScale };
    }

    // Initialize closed curve as circle in UV space centered at (0.5, 0.5)
    const damping = 0.5;
    const alignStrength = 0.3;
    const restLength = maxEdgeLength * 0.6;

    const nodes: Node[] = [];
    for (let i = 0; i < initialNodeCount; i++) {
      const t = (i / initialNodeCount) * Math.PI * 2;
      nodes.push({
        u: 0.5 + initialRadius * Math.cos(t),
        v: 0.5 + initialRadius * Math.sin(t),
        fu: 0,
        fv: 0,
      });
    }

    // Spatial hash for repulsion (in UV space)
    const cellSize = repulsionRadius;

    function buildSpatialHash(nodeList: Node[]): Map<string, number[]> {
      const grid = new Map<string, number[]>();
      for (let i = 0; i < nodeList.length; i++) {
        const key = `${Math.floor(nodeList[i].u / cellSize)},${Math.floor(nodeList[i].v / cellSize)}`;
        let list = grid.get(key);
        if (!list) {
          list = [];
          grid.set(key, list);
        }
        list.push(i);
      }
      return grid;
    }

    function getNearby(grid: Map<string, number[]>, u: number, v: number): number[] {
      const gu = Math.floor(u / cellSize);
      const gv = Math.floor(v / cellSize);
      const result: number[] = [];
      for (let dv = -1; dv <= 1; dv++) {
        for (let du = -1; du <= 1; du++) {
          const list = grid.get(`${gu + du},${gv + dv}`);
          if (list) {
            for (const idx of list) result.push(idx);
          }
        }
      }
      return result;
    }

    // Simulation loop
    for (let iter = 0; iter < iterations; iter++) {
      const n = nodes.length;

      // Reset forces
      for (let i = 0; i < n; i++) {
        nodes[i].fu = 0;
        nodes[i].fv = 0;
      }

      const grid = buildSpatialHash(nodes);
      const rr2 = repulsionRadius * repulsionRadius;

      // Repulsion forces (non-neighbors only)
      for (let i = 0; i < n; i++) {
        const node = nodes[i];
        const prevIdx = (i - 1 + n) % n;
        const nextIdx = (i + 1) % n;
        const nearby = getNearby(grid, node.u, node.v);

        for (const j of nearby) {
          if (j === i || j === prevIdx || j === nextIdx) continue;
          const du = node.u - nodes[j].u;
          const dv = node.v - nodes[j].v;
          const d2 = du * du + dv * dv;
          if (d2 < rr2 && d2 > 1e-10) {
            const d = Math.sqrt(d2);
            const force = repulsionStrength * (1 - d / repulsionRadius);
            node.fu += (du / d) * force;
            node.fv += (dv / d) * force;
          }
        }
      }

      // Spring forces between neighbors
      for (let i = 0; i < n; i++) {
        const nextIdx = (i + 1) % n;
        const du = nodes[nextIdx].u - nodes[i].u;
        const dv = nodes[nextIdx].v - nodes[i].v;
        const d = Math.sqrt(du * du + dv * dv);
        if (d > 1e-10) {
          const force = springK * (d - restLength);
          const fu = (du / d) * force;
          const fv = (dv / d) * force;
          nodes[i].fu += fu;
          nodes[i].fv += fv;
          nodes[nextIdx].fu -= fu;
          nodes[nextIdx].fv -= fv;
        }
      }

      // Alignment smoothing
      for (let i = 0; i < n; i++) {
        const prevIdx = (i - 1 + n) % n;
        const nextIdx = (i + 1) % n;
        const midU = (nodes[prevIdx].u + nodes[nextIdx].u) / 2;
        const midV = (nodes[prevIdx].v + nodes[nextIdx].v) / 2;
        nodes[i].fu += (midU - nodes[i].u) * alignStrength;
        nodes[i].fv += (midV - nodes[i].v) * alignStrength;
      }

      // Integrate forces
      for (let i = 0; i < n; i++) {
        nodes[i].u += nodes[i].fu * damping;
        nodes[i].v += nodes[i].fv * damping;

        // Boundary: keep within UV [0.05, 0.95]
        nodes[i].u = Math.max(0.05, Math.min(0.95, nodes[i].u));
        nodes[i].v = Math.max(0.05, Math.min(0.95, nodes[i].v));
      }

      // Insert new nodes where edges are too long
      if (nodes.length < maxNodes) {
        const insertions: { after: number; u: number; v: number }[] = [];
        for (let i = 0; i < nodes.length; i++) {
          const nextIdx = (i + 1) % nodes.length;
          const du = nodes[nextIdx].u - nodes[i].u;
          const dv = nodes[nextIdx].v - nodes[i].v;
          const d = Math.sqrt(du * du + dv * dv);
          if (d > maxEdgeLength) {
            insertions.push({
              after: i,
              u: (nodes[i].u + nodes[nextIdx].u) / 2,
              v: (nodes[i].v + nodes[nextIdx].v) / 2,
            });
          }
        }

        for (let k = insertions.length - 1; k >= 0; k--) {
          if (nodes.length >= maxNodes) break;
          const ins = insertions[k];
          nodes.splice(ins.after + 1, 0, {
            u: ins.u,
            v: ins.v,
            fu: 0,
            fv: 0,
          });
        }
      }
    }

    // Project all nodes through the surface and output
    const pts = nodes.map((n) => projectPoint(n.u, n.v));
    // Close the loop
    if (pts.length > 0) {
      pts.push({ x: pts[0].x, y: pts[0].y });
    }

    return [pts];
  },
};

export default growthOnSurface;
