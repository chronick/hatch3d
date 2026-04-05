import { createNoise2D } from "simplex-noise";
import type { Composition2DDefinition } from "../../types";

// Mulberry32 seeded PRNG — deterministic, fast, good distribution
function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Point = { x: number; y: number };
type Arc = Point[];
type ArcEntry = { arc: Arc; startKey: string; endKey: string };

/**
 * Chain arc segments into continuous polyline paths.
 * Shared across all tile types.
 */
function chainArcs(
  arcs: ArcEntry[],
  canonicalEdgeKey: (key: string) => string,
): Point[][] {
  // Group arcs by their canonical edge endpoints
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
  const polylines: Point[][] = [];

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
}

/** Canonical edge key for square grid tiles */
function squareCanonicalEdgeKey(key: string): string {
  const parts = key.split(",");
  const col = parseInt(parts[0]);
  const row = parseInt(parts[1]);
  const side = parts[2];

  if (side === "top" && row > 0) return `${col},${row - 1},bottom`;
  if (side === "left" && col > 0) return `${col - 1},${row},right`;
  return key;
}

// ── Quarter-circle tile generator (original behavior) ──

function generateQuarterCircle(
  width: number,
  height: number,
  gridSize: number,
  arcSamples: number,
  rand: () => number,
  getThreshold: (col: number, row: number, bias: number) => number,
  bias: number,
): Point[][] {
  const tileW = width / gridSize;
  const tileH = height / gridSize;
  const r = Math.min(tileW, tileH) / 2;

  const arcs: ArcEntry[] = [];

  for (let row = 0; row < gridSize; row++) {
    for (let col = 0; col < gridSize; col++) {
      const ox = col * tileW;
      const oy = row * tileH;
      const threshold = getThreshold(col, row, bias);
      const orientation = rand() < threshold ? 0 : 1;

      if (orientation === 0) {
        // Arc 1: from top-left corner
        const a1: Arc = [];
        for (let s = 0; s <= arcSamples; s++) {
          const t = (s / arcSamples) * (Math.PI / 2);
          a1.push({
            x: ox + r * Math.sin(t),
            y: oy + r * (1 - Math.cos(t)),
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

  return chainArcs(arcs, squareCanonicalEdgeKey);
}

// ── Diagonal tile generator ──

function generateDiagonal(
  width: number,
  height: number,
  gridSize: number,
  arcSamples: number,
  rand: () => number,
  getThreshold: (col: number, row: number, bias: number) => number,
  bias: number,
): Point[][] {
  const tileW = width / gridSize;
  const tileH = height / gridSize;

  const arcs: ArcEntry[] = [];

  for (let row = 0; row < gridSize; row++) {
    for (let col = 0; col < gridSize; col++) {
      const ox = col * tileW;
      const oy = row * tileH;
      const threshold = getThreshold(col, row, bias);
      const orientation = rand() < threshold ? 0 : 1;

      if (orientation === 0) {
        // Diagonal from TL to BR — splits into two segments meeting at edges
        // Segment 1: top edge midpoint to left edge midpoint
        const a1: Arc = [];
        for (let s = 0; s <= arcSamples; s++) {
          const t = s / arcSamples;
          a1.push({
            x: ox + tileW * 0.5 * (1 - t),
            y: oy + tileH * 0.5 * t,
          });
        }
        arcs.push({
          arc: a1,
          startKey: `${col},${row},top`,
          endKey: `${col},${row},left`,
        });

        // Segment 2: right edge midpoint to bottom edge midpoint
        const a2: Arc = [];
        for (let s = 0; s <= arcSamples; s++) {
          const t = s / arcSamples;
          a2.push({
            x: ox + tileW * (1 - 0.5 * t),
            y: oy + tileH * (0.5 + 0.5 * t),
          });
        }
        arcs.push({
          arc: a2,
          startKey: `${col},${row},right`,
          endKey: `${col},${row},bottom`,
        });
      } else {
        // Diagonal from TR to BL
        // Segment 1: top edge midpoint to right edge midpoint
        const a1: Arc = [];
        for (let s = 0; s <= arcSamples; s++) {
          const t = s / arcSamples;
          a1.push({
            x: ox + tileW * (0.5 + 0.5 * t),
            y: oy + tileH * 0.5 * t,
          });
        }
        arcs.push({
          arc: a1,
          startKey: `${col},${row},top`,
          endKey: `${col},${row},right`,
        });

        // Segment 2: left edge midpoint to bottom edge midpoint
        const a2: Arc = [];
        for (let s = 0; s <= arcSamples; s++) {
          const t = s / arcSamples;
          a2.push({
            x: ox + tileW * 0.5 * t,
            y: oy + tileH * (0.5 + 0.5 * t),
          });
        }
        arcs.push({
          arc: a2,
          startKey: `${col},${row},left`,
          endKey: `${col},${row},bottom`,
        });
      }
    }
  }

  return chainArcs(arcs, squareCanonicalEdgeKey);
}

// ── Triangle tile generator ──

function generateTriangle(
  width: number,
  height: number,
  gridSize: number,
  _arcSamples: number,
  rand: () => number,
  getThreshold: (col: number, row: number, bias: number) => number,
  bias: number,
): Point[][] {
  const tileW = width / gridSize;
  const tileH = height / gridSize;

  // Each cell has a diagonal (two orientations) that creates two triangles.
  // We output the diagonal line + cell borders as chainable segments.
  const arcs: ArcEntry[] = [];

  for (let row = 0; row < gridSize; row++) {
    for (let col = 0; col < gridSize; col++) {
      const ox = col * tileW;
      const oy = row * tileH;
      const threshold = getThreshold(col, row, bias);
      const orientation = rand() < threshold ? 0 : 1;

      if (orientation === 0) {
        // Diagonal TL to BR
        arcs.push({
          arc: [
            { x: ox, y: oy },
            { x: ox + tileW, y: oy + tileH },
          ],
          startKey: `${col},${row},tl`,
          endKey: `${col},${row},br`,
        });
      } else {
        // Diagonal TR to BL
        arcs.push({
          arc: [
            { x: ox + tileW, y: oy },
            { x: ox, y: oy + tileH },
          ],
          startKey: `${col},${row},tr`,
          endKey: `${col},${row},bl`,
        });
      }

      // Cell borders — top and left edges only (right and bottom handled by neighbors)
      // Top edge
      if (row === 0) {
        arcs.push({
          arc: [
            { x: ox, y: oy },
            { x: ox + tileW, y: oy },
          ],
          startKey: `${col},${row},tl`,
          endKey: `${col},${row},tr`,
        });
      }
      // Left edge
      if (col === 0) {
        arcs.push({
          arc: [
            { x: ox, y: oy },
            { x: ox, y: oy + tileH },
          ],
          startKey: `${col},${row},tl`,
          endKey: `${col},${row},bl`,
        });
      }
      // Bottom edge (always — connects to neighbor or is boundary)
      arcs.push({
        arc: [
          { x: ox, y: oy + tileH },
          { x: ox + tileW, y: oy + tileH },
        ],
        startKey: `${col},${row},bl`,
        endKey: `${col},${row},br`,
      });
      // Right edge
      arcs.push({
        arc: [
          { x: ox + tileW, y: oy },
          { x: ox + tileW, y: oy + tileH },
        ],
        startKey: `${col},${row},tr`,
        endKey: `${col},${row},br`,
      });
    }
  }

  // Triangle corners share positions with neighbors — canonical keys via position
  function triangleCanonicalEdgeKey(key: string): string {
    const parts = key.split(",");
    const col = parseInt(parts[0]);
    const row = parseInt(parts[1]);
    const corner = parts[2];

    // Map each corner to the canonical "owner"
    // tl of (col,row) = br of (col-1,row-1), tr of (col-1,row), bl of (col,row-1)
    // We pick the cell with the smallest (row,col) that owns this vertex
    if (corner === "tr") {
      // Same as tl of (col+1, row) if exists
      if (col + 1 < Infinity) return `${col + 1},${row},tl`;
    }
    if (corner === "bl") {
      // Same as tl of (col, row+1) if exists
      return `${col},${row + 1},tl`;
    }
    if (corner === "br") {
      // Same as tl of (col+1, row+1)
      return `${col + 1},${row + 1},tl`;
    }
    return key; // tl is canonical
  }

  return chainArcs(arcs, triangleCanonicalEdgeKey);
}

// ── Hexagonal tile generator ──

function generateHex(
  width: number,
  height: number,
  gridSize: number,
  arcSamples: number,
  rand: () => number,
  getThreshold: (col: number, row: number, bias: number) => number,
  bias: number,
): Point[][] {
  // Pointy-top hexagonal grid
  const hexSize = Math.min(width, height) / (gridSize * 2);
  const hexW = Math.sqrt(3) * hexSize; // width of one hex
  const hexH = 2 * hexSize; // height of one hex

  // Compute grid dimensions to cover the canvas
  const cols = Math.ceil(width / hexW) + 2;
  const rows = Math.ceil(height / (hexH * 0.75)) + 2;

  const arcs: ArcEntry[] = [];

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      // Hex center position (pointy-top, odd-row offset)
      const cx = col * hexW + (row % 2 === 1 ? hexW / 2 : 0);
      const cy = row * hexH * 0.75;

      // Skip hexes entirely outside canvas (with margin)
      if (cx < -hexW || cx > width + hexW || cy < -hexH || cy > height + hexH)
        continue;

      // 6 edge midpoints for pointy-top hex
      // Vertex i is at angle (60*i - 30) degrees from top
      // Edge i connects vertex i to vertex (i+1)%6
      // Edge midpoint i is at angle (60*i) degrees
      const edgeMids: Point[] = [];
      for (let i = 0; i < 6; i++) {
        // Midpoint of edge i: average of vertex i and vertex (i+1)
        const v1Angle = (Math.PI / 3) * i - Math.PI / 6 - Math.PI / 2;
        const v2Angle = (Math.PI / 3) * (i + 1) - Math.PI / 6 - Math.PI / 2;
        edgeMids.push({
          x: cx + (hexSize * (Math.cos(v1Angle) + Math.cos(v2Angle))) / 2,
          y: cy + (hexSize * (Math.sin(v1Angle) + Math.sin(v2Angle))) / 2,
        });
      }

      // Three possible matchings of opposite edge pairs:
      // Matching 0: (0,3), (1,4), (2,5)
      // Matching 1: (0,5), (1,2), (3,4)  — rotated 60 degrees
      // Matching 2: (0,1), (2,3), (4,5)  — rotated 120 degrees
      const threshold = getThreshold(col, row, bias);
      const r = rand();
      let matching: [number, number][];
      if (r < threshold * 0.67) {
        matching = [
          [0, 3],
          [1, 4],
          [2, 5],
        ];
      } else if (r < threshold * 0.67 + (1 - threshold * 0.67) * 0.5) {
        matching = [
          [0, 5],
          [1, 2],
          [3, 4],
        ];
      } else {
        matching = [
          [0, 1],
          [2, 3],
          [4, 5],
        ];
      }

      // Draw curves connecting matched edge midpoints through the hex interior
      for (const [e1, e2] of matching) {
        const p1 = edgeMids[e1];
        const p2 = edgeMids[e2];

        // Cubic-like curve approximated with sample points
        // Control points pulled toward center for smooth curves
        const pull = 0.6; // How much the curve bends toward center
        const cp1x = p1.x + (cx - p1.x) * pull;
        const cp1y = p1.y + (cy - p1.y) * pull;
        const cp2x = p2.x + (cx - p2.x) * pull;
        const cp2y = p2.y + (cy - p2.y) * pull;

        const curve: Arc = [];
        for (let s = 0; s <= arcSamples; s++) {
          const t = s / arcSamples;
          const u = 1 - t;
          // Cubic bezier
          const x =
            u * u * u * p1.x +
            3 * u * u * t * cp1x +
            3 * u * t * t * cp2x +
            t * t * t * p2.x;
          const y =
            u * u * u * p1.y +
            3 * u * u * t * cp1y +
            3 * u * t * t * cp2y +
            t * t * t * p2.y;
          curve.push({ x, y });
        }

        // Edge keys for chaining across hex boundaries
        // Use edge index + hex grid position as unique identifier
        arcs.push({
          arc: curve,
          startKey: `hex:${col},${row},e${e1}`,
          endKey: `hex:${col},${row},e${e2}`,
        });
      }
    }
  }

  // Canonical edge key for hex grid — shared edges between adjacent hexes
  function hexCanonicalEdgeKey(key: string): string {
    if (!key.startsWith("hex:")) return key;
    const inner = key.slice(4); // remove "hex:"
    const parts = inner.split(",");
    const col = parseInt(parts[0]);
    const row = parseInt(parts[1]);
    const edge = parseInt(parts[2].slice(1)); // e.g., "e3" -> 3

    // Each edge is shared with a neighbor. Map to the canonical (lower) cell.
    // For pointy-top hex with odd-row offset:
    // Edge 0 (top): neighbor at (col + (row%2===1?1:0) - 1, row - 1) edge 3 — but we need exact neighbors
    // Neighbors for pointy-top, odd-row offset:
    const isOddRow = row % 2 === 1;
    // [dcol, drow, opposite_edge] for each of the 6 edges
    // Pointy-top hex with odd-row offset layout
    const neighbors: [number, number, number][] = isOddRow
      ? [
          [0, -1, 3], // edge 0: top-right
          [1, 0, 4], // edge 1: right
          [0, 1, 5], // edge 2: bottom-right
          [-1, 1, 0], // edge 3: bottom-left
          [-1, 0, 1], // edge 4: left
          [-1, -1, 2], // edge 5: top-left
        ]
      : [
          [1, -1, 3], // edge 0: top-right
          [1, 0, 4], // edge 1: right
          [1, 1, 5], // edge 2: bottom-right
          [0, 1, 0], // edge 3: bottom-left
          [-1, 0, 1], // edge 4: left
          [0, -1, 2], // edge 5: top-left
        ];

    // Pointy-top hex edges (starting from top, going clockwise):
    // Edge 0: top-right, Edge 1: right, Edge 2: bottom-right
    // Edge 3: bottom-left, Edge 4: left, Edge 5: top-left
    // Opposite pairs: (0,3), (1,4), (2,5)

    // For edges 3, 4, 5 — map to the neighbor's corresponding edge
    if (edge >= 3) {
      const [dc, dr, oppEdge] = neighbors[edge];
      const nc = col + dc;
      const nr = row + dr;
      return `hex:${nc},${nr},e${oppEdge}`;
    }

    return key;
  }

  return chainArcs(arcs, hexCanonicalEdgeKey);
}

const truchetMaze: Composition2DDefinition = {
  id: "truchetMaze",
  name: "Truchet Maze",
  description:
    "Truchet tiling with connected path extraction — quarter-circle, diagonal, triangle, and hexagonal tile variants",
  tags: ["pattern", "truchet", "maze", "tiling", "hexagonal"],
  category: "2d",
  type: "2d",

  macros: {
    density: {
      label: "Density",
      default: 0.5,
      targets: [
        { param: "gridSize", fn: "linear", strength: 0.7 },
        { param: "arcSamples", fn: "linear", strength: 0.3 },
      ],
    },
  },

  controls: {
    tileType: {
      type: "select",
      label: "Tile Type",
      default: "quarter-circle",
      options: [
        { label: "Quarter Circle", value: "quarter-circle" },
        { label: "Diagonal", value: "diagonal" },
        { label: "Triangle", value: "triangle" },
        { label: "Hexagon", value: "hex" },
      ],
      group: "Tile",
    },
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
    seed: {
      type: "slider",
      label: "Seed",
      default: 42,
      min: 0,
      max: 999,
      step: 1,
      group: "Pattern",
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
    const seed = Math.round(values.seed as number);
    const tileType = (values.tileType as string) || "quarter-circle";

    // Seeded PRNG for deterministic results
    const rand = mulberry32(seed);

    // Seeded noise (use seed to initialize noise too)
    const noiseRand = mulberry32(seed + 7919);
    const noise2D =
      noiseScale > 0 ? createNoise2D(() => noiseRand()) : null;

    // Threshold function shared across all tile types
    function getThreshold(
      col: number,
      row: number,
      baseBias: number,
    ): number {
      let threshold = baseBias;
      if (noise2D && noiseScale > 0) {
        threshold +=
          noise2D(col * noiseScale * 100, row * noiseScale * 100) * 0.3;
        threshold = Math.max(0.05, Math.min(0.95, threshold));
      }
      return threshold;
    }

    switch (tileType) {
      case "diagonal":
        return generateDiagonal(
          width,
          height,
          gridSize,
          arcSamples,
          rand,
          getThreshold,
          bias,
        );
      case "triangle":
        return generateTriangle(
          width,
          height,
          gridSize,
          arcSamples,
          rand,
          getThreshold,
          bias,
        );
      case "hex":
        return generateHex(
          width,
          height,
          gridSize,
          arcSamples,
          rand,
          getThreshold,
          bias,
        );
      case "quarter-circle":
      default:
        return generateQuarterCircle(
          width,
          height,
          gridSize,
          arcSamples,
          rand,
          getThreshold,
          bias,
        );
    }
  },
};

export default truchetMaze;
