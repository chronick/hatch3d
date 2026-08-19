import * as THREE from "three";
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
  normal: Vec3;
}

// Build 4 triangular pyramid faces sitting on top of the chosen cells. Each
// face is emitted as a degenerate rectFace quad with p11 == p01 == apex, so
// the existing rectFace surface and depth-mesh path handle them unchanged.
// Spires inherit the "top" FaceKind so they hatch with the Tops group.
function buildSpireFaces(
  heights: number[][],
  N: number,
  cellSize: number,
  heightScale: number,
  spireCount: number,
  spireHeight: number,
  rng: () => number,
): Face[] {
  if (spireCount <= 0) return [];
  const ofs = -(N * cellSize) / 2;
  const h = (i: number, j: number) => heights[i][j] * heightScale;

  // Local maxima: cells at least as tall as all 4 von Neumann neighbours.
  // Edge cells use -Infinity for missing neighbours so plateaus on the rim
  // still qualify.
  type Cand = { i: number; j: number; height: number };
  const maxima: Cand[] = [];
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      const hh = heights[i][j];
      const n = j > 0 ? heights[i][j - 1] : -Infinity;
      const s = j + 1 < N ? heights[i][j + 1] : -Infinity;
      const e = i + 1 < N ? heights[i + 1][j] : -Infinity;
      const w = i > 0 ? heights[i - 1][j] : -Infinity;
      if (hh >= n && hh >= s && hh >= e && hh >= w) {
        maxima.push({ i, j, height: hh });
      }
    }
  }
  // Tallest first; tie order is deterministic from heightfield iteration.
  maxima.sort((a, b) => b.height - a.height);

  const chosen: Cand[] = maxima.slice(0, spireCount);
  if (chosen.length < spireCount) {
    const used = new Set<string>();
    for (const c of chosen) used.add(`${c.i},${c.j}`);
    let guard = 0;
    while (chosen.length < spireCount && guard < N * N * 4) {
      const i = Math.floor(rng() * N);
      const j = Math.floor(rng() * N);
      guard++;
      const k = `${i},${j}`;
      if (used.has(k)) continue;
      used.add(k);
      chosen.push({ i, j, height: heights[i][j] });
    }
  }

  // Outward face normals — constant across spires (same pyramid geometry).
  // For each triangular face, the outward direction has a lateral component
  // (away from the spire centre) plus a +y component proportional to the
  // half-cell, both scaled so the result is a unit vector.
  const halfC = cellSize / 2;
  const apexH = spireHeight * heightScale;
  const nLen = Math.sqrt(halfC * halfC + apexH * apexH);
  const normN: Vec3 = { x: 0, y: halfC / nLen, z: -apexH / nLen };
  const normE: Vec3 = { x: apexH / nLen, y: halfC / nLen, z: 0 };
  const normS: Vec3 = { x: 0, y: halfC / nLen, z: apexH / nLen };
  const normW: Vec3 = { x: -apexH / nLen, y: halfC / nLen, z: 0 };

  const faces: Face[] = [];
  for (const c of chosen) {
    const { i, j } = c;
    const x0 = i * cellSize + ofs;
    const x1 = (i + 1) * cellSize + ofs;
    const z0 = j * cellSize + ofs;
    const z1 = (j + 1) * cellSize + ofs;
    const yTop = h(i, j);
    const apex: Vec3 = {
      x: (x0 + x1) / 2,
      y: yTop + apexH,
      z: (z0 + z1) / 2,
    };
    const NW: Vec3 = { x: x0, y: yTop, z: z0 };
    const NE: Vec3 = { x: x1, y: yTop, z: z0 };
    const SE: Vec3 = { x: x1, y: yTop, z: z1 };
    const SW: Vec3 = { x: x0, y: yTop, z: z1 };
    // Winding order chosen so the exterior side of each face is CCW (matches
    // existing buildFaces convention so HLR depth pass stays consistent).
    faces.push({ kind: "top", normal: normN, corners: [NW, NE, apex, apex] }); // -z face
    faces.push({ kind: "top", normal: normE, corners: [NE, SE, apex, apex] }); // +x face
    faces.push({ kind: "top", normal: normS, corners: [SE, SW, apex, apex] }); // +z face
    faces.push({ kind: "top", normal: normW, corners: [SW, NW, apex, apex] }); // -x face
  }
  return faces;
}

// Fixed light direction used by the shadow gating. Picked to roughly match the
// upper-front-right lighting convention used in the original Sentinel artwork.
const LIGHT_DIR: Vec3 = (() => {
  const lx = 1, ly = 2, lz = 1;
  const len = Math.sqrt(lx * lx + ly * ly + lz * lz);
  return { x: lx / len, y: ly / len, z: lz / len };
})();

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
        normal: { x: 0, y: 1, z: 0 },
        corners: [
          { x: x0, y, z: z0 },
          { x: x1, y, z: z0 },
          { x: x1, y, z: z1 },
          { x: x0, y, z: z1 },
        ],
      });
      // Perimeter walls drop to y=0 (ground plane), not below — keeps the
      // terrain visually sitting on a plane rather than framed by a tall box.
      const edgeBottom = 0;
      // South wall at z=z1 (normal +z).
      const ySouth = j + 1 < N ? h(i, j + 1) : edgeBottom;
      if (ySouth < y) {
        faces.push({
          kind: "wallNS",
          normal: { x: 0, y: 0, z: 1 },
          corners: [
            { x: x0, y: ySouth, z: z1 },
            { x: x1, y: ySouth, z: z1 },
            { x: x1, y, z: z1 },
            { x: x0, y, z: z1 },
          ],
        });
      }
      // North wall at z=z0 (normal -z).
      const yNorth = j > 0 ? h(i, j - 1) : edgeBottom;
      if (yNorth < y) {
        faces.push({
          kind: "wallNS",
          normal: { x: 0, y: 0, z: -1 },
          corners: [
            { x: x1, y: yNorth, z: z0 },
            { x: x0, y: yNorth, z: z0 },
            { x: x0, y, z: z0 },
            { x: x1, y, z: z0 },
          ],
        });
      }
      // East wall at x=x1 (normal +x).
      const yEast = i + 1 < N ? h(i + 1, j) : edgeBottom;
      if (yEast < y) {
        faces.push({
          kind: "wallEW",
          normal: { x: 1, y: 0, z: 0 },
          corners: [
            { x: x1, y: yEast, z: z1 },
            { x: x1, y: yEast, z: z0 },
            { x: x1, y, z: z0 },
            { x: x1, y, z: z1 },
          ],
        });
      }
      // West wall at x=x0 (normal -x).
      const yWest = i > 0 ? h(i - 1, j) : edgeBottom;
      if (yWest < y) {
        faces.push({
          kind: "wallEW",
          normal: { x: -1, y: 0, z: 0 },
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
  hatchGroups: ["Tops", "WallsNS", "WallsEW", "shadow"],
  occlusionSensitive: true,

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
      default: 10,
      min: 6,
      max: 20,
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
    spireCount: {
      type: "slider",
      label: "Spire Count",
      default: 0,
      min: 0,
      max: 12,
      step: 1,
      group: "Spires",
    },
    spireHeight: {
      type: "slider",
      label: "Spire Height (cells)",
      default: 4,
      min: 1,
      max: 12,
      step: 0.5,
      group: "Spires",
    },
    crossHatchShadow: {
      type: "toggle",
      label: "Cross-Hatch Shadow",
      default: false,
      group: "Shading",
    },
    shadowThreshold: {
      type: "slider",
      label: "Shadow Threshold",
      default: 0.25,
      min: 0.05,
      max: 0.5,
      step: 0.05,
      group: "Shading",
      showWhen: { control: "crossHatchShadow", equals: true },
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
    const spireCount = Math.max(0, Math.floor((v.spireCount as number) ?? 0));
    const spireHeight = Math.max(0, (v.spireHeight as number) ?? 4);
    const crossHatchShadow = (v.crossHatchShadow as boolean) ?? false;
    const shadowThreshold = Math.max(
      0.05,
      Math.min(0.5, (v.shadowThreshold as number) ?? 0.25),
    );

    const rng = mulberry32(seed);
    const heights = generateHeightfield(N, maxH, splits, plateauBias, rng);
    const faces = buildFaces(heights, N, cellSize, heightScale);
    if (spireCount > 0) {
      faces.push(
        ...buildSpireFaces(heights, N, cellSize, heightScale, spireCount, spireHeight, rng),
      );
    }

    const layers: LayerConfig[] = [];
    for (const f of faces) {
      const [p00, p10, p11, p01] = f.corners;
      const { angle, count, group } = faceClassHatch(f.kind, {
        angleTops,
        angleNS,
        angleEW,
        countTops,
        countNS,
        countEW,
      });
      if (count === 0) continue;
      const params = {
        p00x: p00.x, p00y: p00.y, p00z: p00.z,
        p10x: p10.x, p10y: p10.y, p10z: p10.z,
        p11x: p11.x, p11y: p11.y, p11z: p11.z,
        p01x: p01.x, p01y: p01.y, p01z: p01.z,
      };
      layers.push({
        surface: "rectFace",
        params,
        hatch: {
          family: "diagonal",
          angle,
          count,
          samples,
        },
        group,
      });
      if (crossHatchShadow) {
        const lighting =
          f.normal.x * LIGHT_DIR.x +
          f.normal.y * LIGHT_DIR.y +
          f.normal.z * LIGHT_DIR.z;
        if (lighting < shadowThreshold) {
          layers.push({
            surface: "rectFace",
            params,
            hatch: {
              family: "diagonal",
              angle: angle + Math.PI / 2,
              count,
              samples,
            },
            group: "shadow",
          });
        }
      }
    }
    return layers;
  },

  // Unified depth-buffer mesh: all terrain faces in ONE BufferGeometry with
  // shared vertices at face boundaries. Eliminates inter-face rasterisation
  // cracks that otherwise let back-face hatches leak through HLR. Hatching
  // still runs per-layer (unchanged) — this only replaces the depth path.
  buildDepthMesh: (input) => {
    const v = input.values;
    const N = Math.max(4, Math.floor((v.gridResolution as number) ?? 10));
    const maxH = Math.max(1, Math.floor((v.maxHeight as number) ?? 6));
    const splits = Math.max(1, Math.floor((v.splitIterations as number) ?? 60));
    const plateauBias = Math.max(0, Math.min(1, (v.plateauBias as number) ?? 0.6));
    const cellSize = Math.max(0.05, (v.cellSize as number) ?? 0.3);
    const heightScale = Math.max(0.05, (v.heightScale as number) ?? 0.3);
    const seed = Math.floor((v.terrainSeed as number) ?? 42);
    const spireCount = Math.max(0, Math.floor((v.spireCount as number) ?? 0));
    const spireHeight = Math.max(0, (v.spireHeight as number) ?? 4);

    const rng = mulberry32(seed);
    const heights = generateHeightfield(N, maxH, splits, plateauBias, rng);
    const faces = buildFaces(heights, N, cellSize, heightScale);
    if (spireCount > 0) {
      faces.push(
        ...buildSpireFaces(heights, N, cellSize, heightScale, spireCount, spireHeight, rng),
      );
    }

    // Vertex dedup — two faces that share a corner in world space get the
    // same index in the mesh. Key by quantised coord so floating-point
    // imprecision doesn't split physically-identical vertices. Quant unit
    // is 1/10000 of a world unit — safe below any face size we generate.
    const key = (p: Vec3) =>
      `${Math.round(p.x * 10000)},${Math.round(p.y * 10000)},${Math.round(p.z * 10000)}`;
    const vertexMap = new Map<string, number>();
    const vertices: number[] = [];
    const indices: number[] = [];

    const getIndex = (p: Vec3) => {
      const k = key(p);
      let idx = vertexMap.get(k);
      if (idx === undefined) {
        idx = vertices.length / 3;
        vertices.push(p.x, p.y, p.z);
        vertexMap.set(k, idx);
      }
      return idx;
    };

    for (const f of faces) {
      const [p00, p10, p11, p01] = f.corners;
      const i00 = getIndex(p00);
      const i10 = getIndex(p10);
      const i11 = getIndex(p11);
      const i01 = getIndex(p01);
      // Two triangles per quad, CCW as viewed along the face normal.
      indices.push(i00, i10, i11, i00, i11, i01);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(new Float32Array(vertices), 3),
    );
    geo.setIndex(indices);
    return geo;
  },
};

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
