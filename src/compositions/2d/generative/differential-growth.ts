import type { Composition2DDefinition } from "../../types";
import { SURFACES } from "../../../surfaces";

interface PlanarNode {
  x: number;
  y: number;
  fx: number;
  fy: number;
}

interface UVNode {
  u: number;
  v: number;
  fu: number;
  fv: number;
}

const SURFACE_MODE_OFF = "off";

function generatePlanar(
  width: number,
  height: number,
  values: Record<string, unknown>,
): { x: number; y: number }[][] {
  const initialNodeCount = Math.round(values.initialNodes as number);
  const iterations = Math.round(values.iterations as number);
  const repulsionRadius = values.repulsionRadius as number;
  const repulsionStrength = values.repulsionStrength as number;
  const springK = values.springK as number;
  const maxEdgeLength = values.maxEdgeLength as number;
  const maxNodes = Math.round(values.maxNodes as number);
  const boundaryRadius = values.boundaryRadius as number;

  const cx = width / 2;
  const cy = height / 2;
  const damping = 0.5;
  const alignStrength = 0.03;
  const restLength = maxEdgeLength * 0.6;

  // Initialize closed curve as circle
  // Scale radius so initial edge lengths are near maxEdgeLength (drives immediate subdivision)
  const nodes: PlanarNode[] = [];
  const initR = Math.max(30, (maxEdgeLength * initialNodeCount) / (2 * Math.PI) * 1.1);
  for (let i = 0; i < initialNodeCount; i++) {
    const t = (i / initialNodeCount) * Math.PI * 2;
    nodes.push({
      x: cx + initR * Math.cos(t),
      y: cy + initR * Math.sin(t),
      fx: 0,
      fy: 0,
    });
  }

  // Spatial hash grid
  const cellSize = repulsionRadius;

  function buildSpatialHash(nodeList: PlanarNode[]): Map<string, number[]> {
    const grid = new Map<string, number[]>();
    for (let i = 0; i < nodeList.length; i++) {
      const key = `${Math.floor(nodeList[i].x / cellSize)},${Math.floor(nodeList[i].y / cellSize)}`;
      let list = grid.get(key);
      if (!list) {
        list = [];
        grid.set(key, list);
      }
      list.push(i);
    }
    return grid;
  }

  function getNearby(
    grid: Map<string, number[]>,
    x: number,
    y: number,
  ): number[] {
    const gx = Math.floor(x / cellSize);
    const gy = Math.floor(y / cellSize);
    const result: number[] = [];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const list = grid.get(`${gx + dx},${gy + dy}`);
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
      nodes[i].fx = 0;
      nodes[i].fy = 0;
    }

    // Build spatial hash
    const grid = buildSpatialHash(nodes);

    // Repulsion forces (non-neighbors only)
    const rr2 = repulsionRadius * repulsionRadius;
    for (let i = 0; i < n; i++) {
      const node = nodes[i];
      const prevIdx = (i - 1 + n) % n;
      const nextIdx = (i + 1) % n;
      const nearby = getNearby(grid, node.x, node.y);

      for (const j of nearby) {
        if (j === i || j === prevIdx || j === nextIdx) continue;
        const dx = node.x - nodes[j].x;
        const dy = node.y - nodes[j].y;
        const d2 = dx * dx + dy * dy;
        if (d2 < rr2 && d2 > 0.01) {
          const d = Math.sqrt(d2);
          const force = repulsionStrength * (1 - d / repulsionRadius);
          node.fx += (dx / d) * force;
          node.fy += (dy / d) * force;
        }
      }
    }

    // Spring forces between neighbors
    for (let i = 0; i < n; i++) {
      const nextIdx = (i + 1) % n;
      const dx = nodes[nextIdx].x - nodes[i].x;
      const dy = nodes[nextIdx].y - nodes[i].y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > 0.01) {
        const force = springK * (d - restLength);
        const fx = (dx / d) * force;
        const fy = (dy / d) * force;
        nodes[i].fx += fx;
        nodes[i].fy += fy;
        nodes[nextIdx].fx -= fx;
        nodes[nextIdx].fy -= fy;
      }
    }

    // Alignment smoothing
    for (let i = 0; i < n; i++) {
      const prevIdx = (i - 1 + n) % n;
      const nextIdx = (i + 1) % n;
      const midX = (nodes[prevIdx].x + nodes[nextIdx].x) / 2;
      const midY = (nodes[prevIdx].y + nodes[nextIdx].y) / 2;
      nodes[i].fx += (midX - nodes[i].x) * alignStrength;
      nodes[i].fy += (midY - nodes[i].y) * alignStrength;
    }

    // Integrate forces with damping
    for (let i = 0; i < n; i++) {
      nodes[i].x += nodes[i].fx * damping;
      nodes[i].y += nodes[i].fy * damping;

      // Boundary constraint
      const dx = nodes[i].x - cx;
      const dy = nodes[i].y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > boundaryRadius) {
        nodes[i].x = cx + (dx / dist) * boundaryRadius;
        nodes[i].y = cy + (dy / dist) * boundaryRadius;
      }
    }

    // Random perturbation to break symmetry and drive growth
    for (let i = 0; i < nodes.length; i++) {
      nodes[i].x += (Math.random() - 0.5) * 1.0;
      nodes[i].y += (Math.random() - 0.5) * 1.0;
    }

    // Insert new nodes where edges exceed max length
    if (nodes.length < maxNodes) {
      const insertions: { after: number; x: number; y: number }[] = [];
      for (let i = 0; i < nodes.length; i++) {
        const nextIdx = (i + 1) % nodes.length;
        const dx = nodes[nextIdx].x - nodes[i].x;
        const dy = nodes[nextIdx].y - nodes[i].y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d > maxEdgeLength) {
          insertions.push({
            after: i,
            x: (nodes[i].x + nodes[nextIdx].x) / 2,
            y: (nodes[i].y + nodes[nextIdx].y) / 2,
          });
        }
      }

      // Insert in reverse order to preserve indices
      for (let k = insertions.length - 1; k >= 0; k--) {
        if (nodes.length >= maxNodes) break;
        const ins = insertions[k];
        nodes.splice(ins.after + 1, 0, {
          x: ins.x,
          y: ins.y,
          fx: 0,
          fy: 0,
        });
      }
    }
  }

  // Output as closed polyline
  const pts = nodes.map((n) => ({ x: n.x, y: n.y }));
  // Close the loop
  if (pts.length > 0) {
    pts.push({ x: pts[0].x, y: pts[0].y });
  }

  return [pts];
}

function generateOnSurface(
  width: number,
  height: number,
  values: Record<string, unknown>,
  surfaceKey: string,
): { x: number; y: number }[][] {
  const surfaceDef = SURFACES[surfaceKey];
  if (!surfaceDef) return [];

  const initialNodeCount = Math.round(values.initialNodes as number);
  const iterations = Math.round(values.iterations as number);
  const springK = values.springK as number;
  const repulsionStrength = values.repulsionStrength as number;
  const maxNodes = Math.round(values.maxNodes as number);

  // Pixel-space controls reinterpreted in UV space via viewScale.
  // viewScale is the projection factor (UV → pixels), so dividing pixel-space
  // values by viewScale gives the matching UV-space magnitudes.
  const viewScale = values.viewScale as number;
  const repulsionRadius = (values.repulsionRadius as number) / viewScale;
  const maxEdgeLength = (values.maxEdgeLength as number) / viewScale;
  const rotX = values.rotationX as number;
  const rotY = values.rotationY as number;

  const cx = width / 2;
  const cy = height / 2;

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

  const damping = 0.5;
  const alignStrength = 0.03;
  const restLength = maxEdgeLength * 0.6;

  // Initialize closed curve as circle in UV space centered at (0.5, 0.5).
  // Scale radius so initial edges are near maxEdgeLength (drives subdivision).
  const initR = Math.min(0.45, (maxEdgeLength * initialNodeCount) / (2 * Math.PI) * 1.1);
  const nodes: UVNode[] = [];
  for (let i = 0; i < initialNodeCount; i++) {
    const t = (i / initialNodeCount) * Math.PI * 2;
    nodes.push({
      u: 0.5 + initR * Math.cos(t),
      v: 0.5 + initR * Math.sin(t),
      fu: 0,
      fv: 0,
    });
  }

  const cellSize = repulsionRadius;

  function buildSpatialHash(nodeList: UVNode[]): Map<string, number[]> {
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

  for (let iter = 0; iter < iterations; iter++) {
    const n = nodes.length;

    for (let i = 0; i < n; i++) {
      nodes[i].fu = 0;
      nodes[i].fv = 0;
    }

    const grid = buildSpatialHash(nodes);
    const rr2 = repulsionRadius * repulsionRadius;

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

    for (let i = 0; i < n; i++) {
      const prevIdx = (i - 1 + n) % n;
      const nextIdx = (i + 1) % n;
      const midU = (nodes[prevIdx].u + nodes[nextIdx].u) / 2;
      const midV = (nodes[prevIdx].v + nodes[nextIdx].v) / 2;
      nodes[i].fu += (midU - nodes[i].u) * alignStrength;
      nodes[i].fv += (midV - nodes[i].v) * alignStrength;
    }

    for (let i = 0; i < n; i++) {
      nodes[i].u += nodes[i].fu * damping;
      nodes[i].v += nodes[i].fv * damping;

      // Boundary: keep within UV [0.05, 0.95]
      nodes[i].u = Math.max(0.05, Math.min(0.95, nodes[i].u));
      nodes[i].v = Math.max(0.05, Math.min(0.95, nodes[i].v));
    }

    // Random perturbation, scaled to UV via viewScale (mirrors planar 1px scale)
    const perturb = 1.0 / viewScale;
    for (let i = 0; i < nodes.length; i++) {
      nodes[i].u += (Math.random() - 0.5) * perturb;
      nodes[i].v += (Math.random() - 0.5) * perturb;
      nodes[i].u = Math.max(0.05, Math.min(0.95, nodes[i].u));
      nodes[i].v = Math.max(0.05, Math.min(0.95, nodes[i].v));
    }

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

  const pts = nodes.map((n) => projectPoint(n.u, n.v));
  if (pts.length > 0) {
    pts.push({ x: pts[0].x, y: pts[0].y });
  }
  return [pts];
}

const differentialGrowth: Composition2DDefinition = {
  id: "differentialGrowth",
  name: "Differential Growth",
  description:
    "Force-based closed curve growth simulation with spatial hashing for path separation. Optionally maps the simulation through a parametric surface via surfaceMode.",
  tags: ["generative", "simulation", "growth", "organic"],
  category: "2d",
  renderMode: "manual",
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
    surfaceMode: {
      type: "select",
      label: "Surface Mode",
      default: SURFACE_MODE_OFF,
      options: [
        { label: "Off (planar)", value: SURFACE_MODE_OFF },
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
      group: "Surface",
    },
    rotationY: {
      type: "slider",
      label: "Rotation Y",
      default: 0.3,
      min: 0,
      max: 6.28,
      step: 0.01,
      group: "Surface",
    },
    viewScale: {
      type: "slider",
      label: "View Scale",
      default: 120,
      min: 50,
      max: 300,
      step: 5,
      group: "Surface",
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
    iterations: {
      type: "slider",
      label: "Iterations",
      default: 3000,
      min: 100,
      max: 5000,
      step: 50,
      group: "Simulation",
    },
    repulsionRadius: {
      type: "slider",
      label: "Repulsion Radius",
      default: 15,
      min: 5,
      max: 60,
      step: 1,
      group: "Forces",
    },
    repulsionStrength: {
      type: "slider",
      label: "Repulsion",
      default: 0.8,
      min: 0.1,
      max: 2.0,
      step: 0.05,
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
      default: 10,
      min: 5,
      max: 40,
      step: 1,
      group: "Growth",
    },
    maxNodes: {
      type: "slider",
      label: "Max Nodes",
      default: 2000,
      min: 500,
      max: 10000,
      step: 100,
      group: "Growth",
    },
    boundaryRadius: {
      type: "slider",
      label: "Boundary",
      default: 300,
      min: 100,
      max: 350,
      step: 10,
      group: "Layout",
    },
  },

  generate({ width, height, values }) {
    const surfaceMode = (values.surfaceMode as string) ?? SURFACE_MODE_OFF;
    if (surfaceMode === SURFACE_MODE_OFF) {
      return generatePlanar(width, height, values);
    }
    return generateOnSurface(width, height, values, surfaceMode);
  },
};

export default differentialGrowth;
