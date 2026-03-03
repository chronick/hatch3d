import type { Composition2DDefinition } from "../../types";

interface Node {
  x: number;
  y: number;
  fx: number;
  fy: number;
}

const differentialGrowth: Composition2DDefinition = {
  id: "differentialGrowth",
  name: "Differential Growth",
  description:
    "Force-based closed curve growth simulation with spatial hashing for path separation",
  tags: ["generative", "simulation", "growth", "organic"],
  category: "2d",
  manualRefresh: true,
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
      default: 500,
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
    const alignStrength = 0.3;
    const restLength = maxEdgeLength * 0.6;

    // Initialize closed curve as circle
    const nodes: Node[] = [];
    const initR = 30;
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

    function buildSpatialHash(nodeList: Node[]): Map<string, number[]> {
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
  },
};

export default differentialGrowth;
