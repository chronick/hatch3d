import type { Composition3DDefinition, LayerConfig } from "../../types";

const crystalLattice: Composition3DDefinition = {
  id: "crystalLattice",
  name: "Crystal Lattice",
  description:
    "Surfaces arranged on a 3D lattice (cubic or hexagonal), connected by thin ribbon edges",
  tags: ["geometric", "lattice", "crystal", "grid"],
  category: "3d",
  hatchGroups: ["Nodes", "Connectors"],

  macros: {
    scale: {
      label: "Scale",
      default: 0.5,
      targets: [
        { param: "nodeSize", fn: "linear", strength: 1.0 },
        { param: "spacing", fn: "linear", strength: 0.8 },
      ],
    },
    density: {
      label: "Density",
      default: 0.5,
      targets: [{ param: "hatchCount", fn: "linear", strength: 0.7 }],
    },
    complexity: {
      label: "Complexity",
      default: 0.5,
      targets: [
        { param: "gridSize", fn: "linear", strength: 0.5 },
        { param: "nodeSize", fn: "linear", strength: -0.3 },
      ],
    },
  },

  controls: {
    gridSize: {
      type: "slider",
      label: "Grid Size",
      default: 2,
      min: 1,
      max: 6,
      step: 1,
      group: "Structure",
    },
    spacing: {
      type: "slider",
      label: "Spacing",
      default: 2.2,
      min: 1.0,
      max: 8.0,
      group: "Structure",
    },
    nodeSize: {
      type: "slider",
      label: "Node Size",
      default: 0.4,
      min: 0.1,
      max: 2.0,
      group: "Shape",
    },
    nodeShape: {
      type: "select",
      label: "Node Shape",
      default: "torus",
      options: [
        { label: "Torus", value: "torus" },
        { label: "Hyperboloid", value: "hyperboloid" },
        { label: "Canopy", value: "canopy" },
      ],
      group: "Shape",
    },
    connectorWidth: {
      type: "slider",
      label: "Connector Width",
      default: 0.04,
      min: 0.01,
      max: 0.15,
      group: "Shape",
    },
    hatchCount: {
      type: "slider",
      label: "Hatch Lines",
      default: 20,
      min: 8,
      max: 150,
      step: 1,
      group: "Hatching",
    },
    showConnectors: {
      type: "toggle",
      label: "Connectors",
      default: true,
      group: "Visibility",
    },
  },

  layers: (p): LayerConfig[] => {
    const v = p.values;
    const gridSize = Math.round(v.gridSize as number);
    const spacing = v.spacing as number;
    const nodeSize = v.nodeSize as number;
    const nodeShape = v.nodeShape as string;
    const connectorWidth = v.connectorWidth as number;
    const hatchCount = Math.round(v.hatchCount as number);
    const showConnectors = v.showConnectors as boolean;

    const layers: LayerConfig[] = [];
    const nodeFamilies: Array<"u" | "v" | "rings" | "diagonal"> = [
      "u",
      "v",
      "rings",
      "diagonal",
    ];

    // Node surface params by shape type
    const nodeParams: Record<string, Record<string, number>> = {
      torus: { majorR: nodeSize, minorR: nodeSize * 0.25, ySquish: 0.5 },
      hyperboloid: {
        radius: nodeSize * 0.5,
        height: nodeSize * 1.5,
        twist: 0.5,
        waist: 0.3,
      },
      canopy: { radius: nodeSize, sag: nodeSize * 0.3, sharpness: 4, yOffset: 0 },
    };

    // Generate lattice nodes: centered grid from -gridSize to +gridSize
    const positions: { x: number; y: number; z: number; idx: number }[] = [];
    let idx = 0;
    for (let ix = -gridSize; ix <= gridSize; ix++) {
      for (let iy = -gridSize; iy <= gridSize; iy++) {
        for (let iz = -gridSize; iz <= gridSize; iz++) {
          positions.push({
            x: ix * spacing,
            y: iy * spacing,
            z: iz * spacing,
            idx: idx++,
          });
        }
      }
    }

    // Add node surfaces
    for (const pos of positions) {
      layers.push({
        surface: nodeShape,
        params: nodeParams[nodeShape] ?? nodeParams.torus,
        hatch: {
          ...p.hatchParams,
          family:
            p.hatchParams.family ?? nodeFamilies[pos.idx % nodeFamilies.length],
          count: hatchCount,
        },
        transform: { x: pos.x, y: pos.y, z: pos.z },
        group: "Nodes",
      });
    }

    // Add connectors along each axis between adjacent nodes
    if (showConnectors) {
      const dim = 2 * gridSize + 1;
      for (let ix = -gridSize; ix <= gridSize; ix++) {
        for (let iy = -gridSize; iy <= gridSize; iy++) {
          for (let iz = -gridSize; iz <= gridSize; iz++) {
            const x = ix * spacing;
            const y = iy * spacing;
            const z = iz * spacing;

            // Connector in Y direction (between this node and one above)
            if (iy < gridSize) {
              const midY = y + spacing / 2;
              layers.push({
                surface: "twistedRibbon",
                params: {
                  twist: 0,
                  width: connectorWidth,
                  height: spacing * 0.55,
                  bulge: 0,
                },
                hatch: { family: "v", count: 3, samples: 20 },
                transform: { x, y: midY, z },
                group: "Connectors",
              });
            }

            // Only add X/Z connectors for the first Y layer to limit density
            if (iy === 0) {
              if (ix < gridSize) {
                layers.push({
                  surface: "twistedRibbon",
                  params: {
                    twist: Math.PI / 2,
                    width: connectorWidth,
                    height: spacing * 0.55,
                    bulge: 0,
                  },
                  hatch: { family: "v", count: 3, samples: 20 },
                  transform: { x: x + spacing / 2, y, z },
                  group: "Connectors",
                });
              }
            }
          }
        }
      }
    }

    return layers;
  },
};

export default crystalLattice;
