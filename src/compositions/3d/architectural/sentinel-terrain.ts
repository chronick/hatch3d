import type { Composition3DDefinition, LayerConfig } from "../../types";

type Vec3 = { x: number; y: number; z: number };

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function generateHeightfield(
  N: number,
  maxH: number,
  splits: number,
  plateauBias: number,
  rng: () => number,
): number[][] {
  const cont: number[][] = Array.from({ length: N }, () => Array(N).fill(0));
  for (let s = 0; s < splits; s++) {
    const horizontal = rng() < 0.5;
    const cut = 1 + Math.floor(rng() * (N - 1));
    const raiseHigher = rng() < 0.5;
    const decay = 1 - s / splits;
    const delta = (rng() * 0.6 + 0.4) * decay * (maxH / 5);
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) {
        const onHighSide = horizontal ? j >= cut : i >= cut;
        if (onHighSide === raiseHigher) cont[i][j] += delta;
      }
    }
  }
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      lo = Math.min(lo, cont[i][j]);
      hi = Math.max(hi, cont[i][j]);
    }
  }
  const span = Math.max(1e-6, hi - lo);
  const out: number[][] = Array.from({ length: N }, () => Array(N).fill(0));
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      const norm = ((cont[i][j] - lo) / span) * maxH;
      const snapped = plateauBias * Math.floor(norm) + (1 - plateauBias) * norm;
      out[i][j] = Math.round(snapped);
    }
  }
  return out;
}

type FaceKind = "top" | "wallNS" | "wallEW";

interface Face {
  kind: FaceKind;
  corners: [Vec3, Vec3, Vec3, Vec3]; // p00, p10, p11, p01
}

function buildFaces(heights: number[][], N: number, cellSize: number, heightScale: number): Face[] {
  const faces: Face[] = [];
  const ofs = -(N * cellSize) / 2;
  const h = (i: number, j: number) => heights[i][j] * heightScale;
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      const y = h(i, j);
      const x0 = i * cellSize + ofs;
      const x1 = (i + 1) * cellSize + ofs;
      const z0 = j * cellSize + ofs;
      const z1 = (j + 1) * cellSize + ofs;
      // Top cap — CCW looking down (+Y up).
      faces.push({
        kind: "top",
        corners: [
          { x: x0, y, z: z0 },
          { x: x1, y, z: z0 },
          { x: x1, y, z: z1 },
          { x: x0, y, z: z1 },
        ],
      });
      // South wall at z=z1 (normal +z).
      const ySouth = j + 1 < N ? h(i, j + 1) : -heightScale;
      if (ySouth < y) {
        faces.push({
          kind: "wallNS",
          corners: [
            { x: x0, y: ySouth, z: z1 },
            { x: x1, y: ySouth, z: z1 },
            { x: x1, y, z: z1 },
            { x: x0, y, z: z1 },
          ],
        });
      }
      // North wall at z=z0 (normal -z).
      const yNorth = j > 0 ? h(i, j - 1) : -heightScale;
      if (yNorth < y) {
        faces.push({
          kind: "wallNS",
          corners: [
            { x: x1, y: yNorth, z: z0 },
            { x: x0, y: yNorth, z: z0 },
            { x: x0, y, z: z0 },
            { x: x1, y, z: z0 },
          ],
        });
      }
      // East wall at x=x1 (normal +x).
      const yEast = i + 1 < N ? h(i + 1, j) : -heightScale;
      if (yEast < y) {
        faces.push({
          kind: "wallEW",
          corners: [
            { x: x1, y: yEast, z: z1 },
            { x: x1, y: yEast, z: z0 },
            { x: x1, y, z: z0 },
            { x: x1, y, z: z1 },
          ],
        });
      }
      // West wall at x=x0 (normal -x).
      const yWest = i > 0 ? h(i - 1, j) : -heightScale;
      if (yWest < y) {
        faces.push({
          kind: "wallEW",
          corners: [
            { x: x0, y: yWest, z: z0 },
            { x: x0, y: yWest, z: z1 },
            { x: x0, y, z: z1 },
            { x: x0, y, z: z0 },
          ],
        });
      }
    }
  }
  return faces;
}

const sentinelTerrain3D: Composition3DDefinition = {
  id: "sentinelTerrain3D",
  name: "Sentinel Terrain (3D)",
  description:
    "Stepped heightfield terrain emitted as one flat-quad layer per face, so the engine's WebGL depth-buffer gives correct hidden-line removal. Same generator as the 2D sentinelTerrain but with true HLR.",
  tags: ["3d", "architectural", "heightfield", "hidden-line-removal"],
  category: "3d",
  type: "3d",
  hatchGroups: ["Tops", "WallsNS", "WallsEW"],

  macros: {
    density: {
      label: "Density",
      default: 0.5,
      targets: [
        { param: "hatchCountTops", fn: "linear", strength: 0.6 },
        { param: "hatchCountWallsNS", fn: "linear", strength: 0.9 },
        { param: "hatchCountWallsEW", fn: "linear", strength: 0.8 },
      ],
    },
    fracture: {
      label: "Fracture",
      default: 0.5,
      targets: [
        { param: "gridResolution", fn: "linear", strength: 0.8 },
        { param: "maxHeight", fn: "linear", strength: 0.6 },
        { param: "plateauBias", fn: "linear", strength: -0.7 },
      ],
    },
  },

  controls: {
    terrainSeed: {
      type: "slider",
      label: "Terrain Seed",
      default: 42,
      min: 0,
      max: 9999,
      step: 1,
      group: "Terrain",
    },
    gridResolution: {
      type: "slider",
      label: "Grid Resolution",
      default: 14,
      min: 6,
      max: 24,
      step: 1,
      group: "Terrain",
    },
    maxHeight: {
      type: "slider",
      label: "Max Height (cells)",
      default: 6,
      min: 2,
      max: 12,
      step: 1,
      group: "Terrain",
    },
    splitIterations: {
      type: "slider",
      label: "Split-Raise Iterations",
      default: 60,
      min: 10,
      max: 200,
      step: 5,
      group: "Terrain",
    },
    plateauBias: {
      type: "slider",
      label: "Plateau Quantisation",
      default: 0.6,
      min: 0,
      max: 1,
      step: 0.05,
      group: "Terrain",
    },
    cellSize: {
      type: "slider",
      label: "Cell Size (world units)",
      default: 0.3,
      min: 0.1,
      max: 1,
      step: 0.05,
      group: "Terrain",
    },
    heightScale: {
      type: "slider",
      label: "Height Scale",
      default: 0.3,
      min: 0.05,
      max: 1,
      step: 0.05,
      group: "Terrain",
    },
    hatchAngleTops: {
      type: "slider",
      label: "Hatch Angle — Tops",
      default: 0.5,
      min: 0,
      max: 3.14,
      step: 0.05,
      group: "Hatching",
    },
    hatchAngleWallsNS: {
      type: "slider",
      label: "Hatch Angle — N/S Walls",
      default: 1.57,
      min: 0,
      max: 3.14,
      step: 0.05,
      group: "Hatching",
    },
    hatchAngleWallsEW: {
      type: "slider",
      label: "Hatch Angle — E/W Walls",
      default: 0,
      min: 0,
      max: 3.14,
      step: 0.05,
      group: "Hatching",
    },
    hatchCountTops: {
      type: "slider",
      label: "Line Count — Tops",
      default: 3,
      min: 0,
      max: 20,
      step: 1,
      group: "Hatching",
    },
    hatchCountWallsNS: {
      type: "slider",
      label: "Line Count — N/S Walls",
      default: 14,
      min: 0,
      max: 30,
      step: 1,
      group: "Hatching",
    },
    hatchCountWallsEW: {
      type: "slider",
      label: "Line Count — E/W Walls",
      default: 8,
      min: 0,
      max: 30,
      step: 1,
      group: "Hatching",
    },
    hatchSamples: {
      type: "slider",
      label: "Samples per Line",
      default: 12,
      min: 4,
      max: 32,
      step: 1,
      group: "Hatching",
    },
  },

  layers: (input): LayerConfig[] => {
    const v = input.values;
    const N = Math.max(4, Math.floor((v.gridResolution as number) ?? 14));
    const maxH = Math.max(1, Math.floor((v.maxHeight as number) ?? 6));
    const splits = Math.max(1, Math.floor((v.splitIterations as number) ?? 60));
    const plateauBias = Math.max(0, Math.min(1, (v.plateauBias as number) ?? 0.6));
    const cellSize = Math.max(0.05, (v.cellSize as number) ?? 0.3);
    const heightScale = Math.max(0.05, (v.heightScale as number) ?? 0.3);
    const seed = Math.floor((v.terrainSeed as number) ?? 42);

    const angleTops = (v.hatchAngleTops as number) ?? 0.5;
    const angleNS = (v.hatchAngleWallsNS as number) ?? 1.57;
    const angleEW = (v.hatchAngleWallsEW as number) ?? 0;
    const countTops = Math.max(0, Math.floor((v.hatchCountTops as number) ?? 3));
    const countNS = Math.max(0, Math.floor((v.hatchCountWallsNS as number) ?? 14));
    const countEW = Math.max(0, Math.floor((v.hatchCountWallsEW as number) ?? 8));
    const samples = Math.max(4, Math.floor((v.hatchSamples as number) ?? 12));

    const rng = mulberry32(seed);
    const heights = generateHeightfield(N, maxH, splits, plateauBias, rng);
    const faces = buildFaces(heights, N, cellSize, heightScale);

    // Inflate each face slightly in its own plane so adjacent faces overlap
    // at shared edges — otherwise the per-face meshes leave 1-pixel cracks in
    // the depth buffer and back-face hatches leak through. The overlap is
    // small enough that double-drawn boundary lines are invisible under
    // typical pen-plotter line widths.
    const edgeInflation = Math.max(0.002, cellSize * 0.02);

    const layers: LayerConfig[] = [];
    for (const f of faces) {
      const inflated = inflateFaceInPlane(f.corners, edgeInflation);
      const [p00, p10, p11, p01] = inflated;
      const { angle, count, group } = faceClassHatch(f.kind, {
        angleTops,
        angleNS,
        angleEW,
        countTops,
        countNS,
        countEW,
      });
      if (count === 0) continue;
      layers.push({
        surface: "rectFace",
        params: {
          p00x: p00.x, p00y: p00.y, p00z: p00.z,
          p10x: p10.x, p10y: p10.y, p10z: p10.z,
          p11x: p11.x, p11y: p11.y, p11z: p11.z,
          p01x: p01.x, p01y: p01.y, p01z: p01.z,
        },
        hatch: {
          family: "diagonal",
          angle,
          count,
          samples,
          // Pull the hatch uv range slightly inward so lines stay inside the
          // original (un-inflated) face — only the mesh itself is inflated,
          // so the depth buffer gets full coverage without lines drifting
          // outside the visually intended face area.
          uRange: [0.02, 0.98],
          vRange: [0.02, 0.98],
        },
        group,
      });
    }
    return layers;
  },
};

function inflateFaceInPlane(
  corners: [Vec3, Vec3, Vec3, Vec3],
  eps: number,
): [Vec3, Vec3, Vec3, Vec3] {
  const [p00, p10, p11, p01] = corners;
  const uAxis = normalize(sub(p10, p00));
  const vAxis = normalize(sub(p01, p00));
  const dNeg = scaleV(uAxis, -eps);
  const dPos = scaleV(uAxis, eps);
  const dVNeg = scaleV(vAxis, -eps);
  const dVPos = scaleV(vAxis, eps);
  return [
    add(p00, add(dNeg, dVNeg)),
    add(p10, add(dPos, dVNeg)),
    add(p11, add(dPos, dVPos)),
    add(p01, add(dNeg, dVPos)),
  ];
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}
function add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}
function scaleV(v: Vec3, s: number): Vec3 {
  return { x: v.x * s, y: v.y * s, z: v.z * s };
}
function normalize(v: Vec3): Vec3 {
  const l = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / l, y: v.y / l, z: v.z / l };
}

function faceClassHatch(
  kind: FaceKind,
  opts: {
    angleTops: number;
    angleNS: number;
    angleEW: number;
    countTops: number;
    countNS: number;
    countEW: number;
  },
): { angle: number; count: number; group: string } {
  if (kind === "top")
    return { angle: opts.angleTops, count: opts.countTops, group: "Tops" };
  if (kind === "wallNS")
    return { angle: opts.angleNS, count: opts.countNS, group: "WallsNS" };
  return { angle: opts.angleEW, count: opts.countEW, group: "WallsEW" };
}

export default sentinelTerrain3D;
