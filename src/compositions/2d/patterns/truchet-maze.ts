import { createNoise2D } from "simplex-noise";
import type { Composition2DDefinition } from "../../types";

const truchetMaze: Composition2DDefinition = {
  id: "truchetMaze",
  name: "Truchet Maze",
  description:
    "Quarter-circle Truchet tiles with connected path extraction for continuous plotter-friendly curves",
  tags: ["pattern", "truchet", "maze", "tiling"],
  category: "2d",
  type: "2d",

  controls: {
    gridSize: {
      type: "slider",
      label: "Grid Size",
      default: 15,
      min: 5,
      max: 80,
      step: 1,
      group: "Grid",
    },
    arcSamples: {
      type: "slider",
      label: "Arc Smoothness",
      default: 12,
      min: 8,
      max: 48,
      step: 1,
      group: "Quality",
    },
    bias: {
      type: "slider",
      label: "Orientation Bias",
      default: 0.5,
      min: 0,
      max: 1,
      step: 0.01,
      group: "Pattern",
    },
    noiseScale: {
      type: "slider",
      label: "Noise Variation",
      default: 0,
      min: 0,
      max: 0.1,
      step: 0.005,
      group: "Pattern",
    },
  },

  generate({ width, height, values }) {
    const gridSize = Math.round(values.gridSize as number);
    const arcSamples = Math.round(values.arcSamples as number);
    const bias = values.bias as number;
    const noiseScale = values.noiseScale as number;

    const noise2D = noiseScale > 0 ? createNoise2D() : null;

    const tileW = width / gridSize;
    const tileH = height / gridSize;
    const r = Math.min(tileW, tileH) / 2;

    // Each tile produces two arcs. We track arc endpoints to join connected paths.
    // Arc endpoint key: "col,row,corner" where corner is 0=TL,1=TR,2=BR,3=BL

    // Build all arcs first
    type Arc = { x: number; y: number }[];
    const arcs: { arc: Arc; startKey: string; endKey: string }[] = [];

    for (let row = 0; row < gridSize; row++) {
      for (let col = 0; col < gridSize; col++) {
        const ox = col * tileW;
        const oy = row * tileH;

        // Determine tile orientation
        let threshold = bias;
        if (noise2D && noiseScale > 0) {
          threshold += noise2D(col * noiseScale * 100, row * noiseScale * 100) * 0.3;
          threshold = Math.max(0.05, Math.min(0.95, threshold));
        }

        // Seeded random based on grid position for deterministic results
        const hash =
          Math.sin(col * 12.9898 + row * 78.233) * 43758.5453;
        const rand = hash - Math.floor(hash);
        const orientation = rand < threshold ? 0 : 1;

        if (orientation === 0) {
          // Arc from TL corner to BR corner (two arcs)
          // Arc 1: from top edge to left edge (centered at TL)
          const arc1: Arc = [];
          for (let s = 0; s <= arcSamples; s++) {
            const t = (s / arcSamples) * (Math.PI / 2);
            arc1.push({
              x: ox + r * Math.cos(Math.PI + t),           // from left going down
              y: oy + r * Math.sin(Math.PI + t),           // from top going right
            });
          }
          // Fix: arc from top-left corner
          const a1: Arc = [];
          for (let s = 0; s <= arcSamples; s++) {
            const t = (s / arcSamples) * (Math.PI / 2);
            a1.push({
              x: ox + r * Math.sin(t),     // 0 → r (top edge midpoint → right)
              y: oy + r * (1 - Math.cos(t)), // 0 → r (top → left edge midpoint)
            });
          }
          arcs.push({
            arc: a1,
            startKey: `${col},${row},top`,
            endKey: `${col},${row},left`,
          });

          // Arc 2: from bottom-right corner
          const a2: Arc = [];
          for (let s = 0; s <= arcSamples; s++) {
            const t = (s / arcSamples) * (Math.PI / 2);
            a2.push({
              x: ox + tileW - r * Math.sin(t),
              y: oy + tileH - r * (1 - Math.cos(t)),
            });
          }
          arcs.push({
            arc: a2,
            startKey: `${col},${row},bottom`,
            endKey: `${col},${row},right`,
          });
        } else {
          // Arc from TR corner to BL corner
          // Arc 1: from top-right corner
          const a1: Arc = [];
          for (let s = 0; s <= arcSamples; s++) {
            const t = (s / arcSamples) * (Math.PI / 2);
            a1.push({
              x: ox + tileW - r * Math.sin(t),
              y: oy + r * (1 - Math.cos(t)),
            });
          }
          arcs.push({
            arc: a1,
            startKey: `${col},${row},top`,
            endKey: `${col},${row},right`,
          });

          // Arc 2: from bottom-left corner
          const a2: Arc = [];
          for (let s = 0; s <= arcSamples; s++) {
            const t = (s / arcSamples) * (Math.PI / 2);
            a2.push({
              x: ox + r * Math.sin(t),
              y: oy + tileH - r * (1 - Math.cos(t)),
            });
          }
          arcs.push({
            arc: a2,
            startKey: `${col},${row},bottom`,
            endKey: `${col},${row},left`,
          });
        }
      }
    }

    // Build adjacency: edge midpoints that are shared between neighboring tiles
    // Map edge keys to canonical shared keys
    function canonicalEdgeKey(key: string): string {
      const parts = key.split(",");
      const col = parseInt(parts[0]);
      const row = parseInt(parts[1]);
      const side = parts[2];

      if (side === "top" && row > 0) return `${col},${row - 1},bottom`;
      if (side === "left" && col > 0) return `${col - 1},${row},right`;
      return key;
    }

    // Group arcs by their canonical edge endpoints for chaining
    const edgeToArcs = new Map<string, number[]>();
    for (let i = 0; i < arcs.length; i++) {
      for (const key of [arcs[i].startKey, arcs[i].endKey]) {
        const canonical = canonicalEdgeKey(key);
        let list = edgeToArcs.get(canonical);
        if (!list) {
          list = [];
          edgeToArcs.set(canonical, list);
        }
        list.push(i);
      }
    }

    // Chain arcs into continuous paths
    const used = new Uint8Array(arcs.length);
    const polylines: { x: number; y: number }[][] = [];

    for (let startIdx = 0; startIdx < arcs.length; startIdx++) {
      if (used[startIdx]) continue;
      used[startIdx] = 1;

      let path = [...arcs[startIdx].arc];
      let currentEndKey = arcs[startIdx].endKey;

      // Extend forward
      let extended = true;
      while (extended) {
        extended = false;
        const canonical = canonicalEdgeKey(currentEndKey);
        const neighbors = edgeToArcs.get(canonical);
        if (!neighbors) break;

        for (const ni of neighbors) {
          if (used[ni]) continue;
          const neighbor = arcs[ni];
          const nStart = canonicalEdgeKey(neighbor.startKey);
          const nEnd = canonicalEdgeKey(neighbor.endKey);

          if (nStart === canonical) {
            used[ni] = 1;
            path.push(...neighbor.arc.slice(1));
            currentEndKey = neighbor.endKey;
            extended = true;
            break;
          } else if (nEnd === canonical) {
            used[ni] = 1;
            path.push(...[...neighbor.arc].reverse().slice(1));
            currentEndKey = neighbor.startKey;
            extended = true;
            break;
          }
        }
      }

      if (path.length >= 2) {
        polylines.push(path);
      }
    }

    return polylines;
  },
};

export default truchetMaze;
