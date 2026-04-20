import type { Composition2DDefinition } from "../../types";

type Point = { x: number; y: number };
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

const sentinelTerrain: Composition2DDefinition = {
  id: "sentinelTerrain",
  name: "Sentinel Terrain",
  description:
    "Stepped quantised heightfield rendered in oblique perspective with face-class hatching — top caps lit, slope walls densely hatched at class-specific angles, painter's-order depth sort. Inspired by The Sentinel (1986).",
  tags: ["2d", "generative", "3d-projection", "heightfield", "wireframe"],
  category: "2d",
  type: "2d",

  macros: {
    density: {
      label: "Density",
      default: 0.4,
      targets: [
        { param: "hatchDensityTop", fn: "linear", strength: 0.7 },
        { param: "hatchDensitySideA", fn: "linear", strength: 0.9 },
        { param: "hatchDensitySideB", fn: "linear", strength: 0.8 },
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
    chaos: {
      label: "Chaos",
      default: 0.3,
      targets: [
        { param: "terrainSeed", fn: "linear", strength: 1.0 },
        { param: "splitIterations", fn: "linear", strength: 0.7 },
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
      default: 18,
      min: 8,
      max: 40,
      step: 1,
      group: "Terrain",
    },
    maxHeight: {
      type: "slider",
      label: "Max Height (cells)",
      default: 6,
      min: 2,
      max: 14,
      step: 1,
      group: "Terrain",
    },
    splitIterations: {
      type: "slider",
      label: "Split-Raise Iterations",
      default: 80,
      min: 10,
      max: 300,
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
    cameraElevation: {
      type: "slider",
      label: "Camera Elevation °",
      default: 28,
      min: 10,
      max: 70,
      step: 1,
      group: "Camera",
    },
    cameraAzimuth: {
      type: "slider",
      label: "Camera Azimuth °",
      default: 215,
      min: 0,
      max: 360,
      step: 1,
      group: "Camera",
    },
    perspectiveStrength: {
      type: "slider",
      label: "Perspective Strength",
      default: 0.5,
      min: 0,
      max: 1,
      step: 0.05,
      group: "Camera",
    },
    cameraDistance: {
      type: "slider",
      label: "Camera Distance",
      default: 3.5,
      min: 1.5,
      max: 8,
      step: 0.1,
      group: "Camera",
    },
    hatchAngleTop: {
      type: "slider",
      label: "Hatch Angle — Top °",
      default: 45,
      min: 0,
      max: 180,
      step: 5,
      group: "Hatching",
    },
    hatchAngleSideA: {
      type: "slider",
      label: "Hatch Angle — North/South °",
      default: 90,
      min: 0,
      max: 180,
      step: 5,
      group: "Hatching",
    },
    hatchAngleSideB: {
      type: "slider",
      label: "Hatch Angle — East/West °",
      default: 0,
      min: 0,
      max: 180,
      step: 5,
      group: "Hatching",
    },
    hatchDensityTop: {
      type: "slider",
      label: "Hatch Density — Top",
      default: 0.12,
      min: 0,
      max: 1,
      step: 0.02,
      group: "Hatching",
    },
    hatchDensitySideA: {
      type: "slider",
      label: "Hatch Density — N/S Walls",
      default: 0.65,
      min: 0,
      max: 1,
      step: 0.02,
      group: "Hatching",
    },
    hatchDensitySideB: {
      type: "slider",
      label: "Hatch Density — E/W Walls",
      default: 0.4,
      min: 0,
      max: 1,
      step: 0.02,
      group: "Hatching",
    },
    showWireframe: {
      type: "toggle",
      label: "Draw Face Outlines",
      default: true,
      group: "Hatching",
    },
    lightAzimuth: {
      type: "slider",
      label: "Light Azimuth °",
      default: 315,
      min: 0,
      max: 360,
      step: 5,
      group: "Shading",
    },
    lightElevation: {
      type: "slider",
      label: "Light Elevation °",
      default: 45,
      min: 10,
      max: 80,
      step: 5,
      group: "Shading",
    },
  },

  generate({ width, height, values }) {
    const seed = Math.floor((values.terrainSeed as number) ?? 42);
    const N = Math.max(4, Math.floor((values.gridResolution as number) ?? 18));
    const maxH = Math.max(1, Math.floor((values.maxHeight as number) ?? 6));
    const splits = Math.max(1, Math.floor((values.splitIterations as number) ?? 80));
    const plateauBias = Math.max(0, Math.min(1, (values.plateauBias as number) ?? 0.6));
    const camElev = degToRad((values.cameraElevation as number) ?? 28);
    const camAzim = degToRad((values.cameraAzimuth as number) ?? 215);
    const persp = Math.max(0, Math.min(1, (values.perspectiveStrength as number) ?? 0.5));
    const camDist = Math.max(1.5, (values.cameraDistance as number) ?? 3.5);
    const angleTop = degToRad((values.hatchAngleTop as number) ?? 45);
    const angleSideA = degToRad((values.hatchAngleSideA as number) ?? 90);
    const angleSideB = degToRad((values.hatchAngleSideB as number) ?? 0);
    const densTop = Math.max(0, Math.min(1, (values.hatchDensityTop as number) ?? 0.12));
    const densSideA = Math.max(0, Math.min(1, (values.hatchDensitySideA as number) ?? 0.65));
    const densSideB = Math.max(0, Math.min(1, (values.hatchDensitySideB as number) ?? 0.4));
    const showWire = (values.showWireframe as boolean) ?? true;
    const lightAzim = degToRad((values.lightAzimuth as number) ?? 315);
    const lightElev = degToRad((values.lightElevation as number) ?? 45);

    const rng = mulberry32(seed);

    // 1. HEIGHTFIELD — Sentinel-style split-and-raise.
    const heights = generateHeightfield(N, maxH, splits, plateauBias, rng);

    // 2. MESH — emit faces (top caps + walls) with world-space corners + normals.
    const faces = buildFaces(heights, N);

    // 3. PROJECTION — spherical camera looks at terrain centre.
    const project = makeProjector(camElev, camAzim, camDist, persp, N, maxH, width, height);

    // Light direction in world space — points FROM the surface TOWARD the
    // light, so dot(normal, light) > 0 means lit.
    const light = sphericalToCartesian(1, lightElev, lightAzim);

    // Project + classify + cull back-faces.
    type Projected = {
      polygon: Point[];
      worldPolygon: Vec3[];
      meanDepth: number;
      normal: Vec3;
      luminance: number;
      kind: FaceKind;
    };
    const camView = sphericalToCartesian(1, camElev, camAzim);
    const projected: Projected[] = [];
    for (const f of faces) {
      const facing = dot(f.normal, camView);
      if (facing <= 0.01) continue; // back-facing
      const polygon = f.corners.map(project);
      const meanDepth =
        f.corners.reduce(
          (s, p) => s + worldDepth(p, camElev, camAzim),
          0,
        ) / f.corners.length;
      const lum = Math.max(0, dot(f.normal, light));
      projected.push({
        polygon,
        worldPolygon: f.corners,
        meanDepth,
        normal: f.normal,
        luminance: lum,
        kind: f.kind,
      });
    }

    // 4. PAINTER SORT — back-to-front so subsequent hatching draws over.
    projected.sort((a, b) => b.meanDepth - a.meanDepth);

    // 5. HATCH + OUTLINES.
    const lines: Point[][] = [];
    for (const face of projected) {
      const { angle, density } = hatchSpec(face.kind, {
        angleTop,
        angleSideA,
        angleSideB,
        densTop,
        densSideA,
        densSideB,
      });
      // Luminance-weighted density: lit faces hatch sparsely, shadowed dense.
      const effectiveDensity = density * (1.1 - face.luminance);
      if (effectiveDensity > 0.01) {
        const hatchLines = hatchPolygon(face.polygon, angle, effectiveDensity);
        for (const seg of hatchLines) lines.push(seg);
      }
      if (showWire) {
        lines.push(closePolyline(face.polygon));
      }
    }

    return lines;
  },
};

// ── Heightfield generation ──────────────────────────────────────────────────

function generateHeightfield(
  N: number,
  maxH: number,
  splits: number,
  plateauBias: number,
  rng: () => number,
): number[][] {
  // Continuous heights, then quantised to integer plateaus.
  const cont: number[][] = Array.from({ length: N }, () => Array(N).fill(0));
  for (let s = 0; s < splits; s++) {
    const horizontal = rng() < 0.5;
    const cut = 1 + Math.floor(rng() * (N - 1));
    const raiseHigher = rng() < 0.5;
    // Decay gives later splits smaller deltas — produces nested plateaus.
    const decay = 1 - s / splits;
    const delta = (rng() * 0.6 + 0.4) * decay * (maxH / 5);
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) {
        const onHighSide = horizontal ? j >= cut : i >= cut;
        if (onHighSide === raiseHigher) cont[i][j] += delta;
      }
    }
  }
  // Normalise to [0, maxH], then quantise.
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
      // plateauBias=0 → keep continuous-ish (round half-up); =1 → snap to floor.
      const snapped = plateauBias * Math.floor(norm) + (1 - plateauBias) * norm;
      out[i][j] = Math.round(snapped);
    }
  }
  return out;
}

// ── Mesh construction ──────────────────────────────────────────────────────

type FaceKind = "top" | "wallNS" | "wallEW";

interface Face {
  corners: Vec3[];
  normal: Vec3;
  kind: FaceKind;
}

function buildFaces(heights: number[][], N: number): Face[] {
  const faces: Face[] = [];
  // Centre the terrain on the origin in world space, scale so the larger
  // horizontal extent is ~N units across.
  const ofs = -N / 2;
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      const h = heights[i][j];
      // Top cap quad.
      const x0 = i + ofs;
      const x1 = i + 1 + ofs;
      const z0 = j + ofs;
      const z1 = j + 1 + ofs;
      faces.push({
        corners: [
          { x: x0, y: h, z: z0 },
          { x: x1, y: h, z: z0 },
          { x: x1, y: h, z: z1 },
          { x: x0, y: h, z: z1 },
        ],
        normal: { x: 0, y: 1, z: 0 },
        kind: "top",
      });
      // South wall (z=z1 face) — exists if (i, j+1) lower than current.
      const hSouth = j + 1 < N ? heights[i][j + 1] : -1;
      if (hSouth < h) {
        faces.push({
          corners: [
            { x: x0, y: hSouth, z: z1 },
            { x: x1, y: hSouth, z: z1 },
            { x: x1, y: h, z: z1 },
            { x: x0, y: h, z: z1 },
          ],
          normal: { x: 0, y: 0, z: 1 },
          kind: "wallNS",
        });
      }
      // North wall (z=z0 face) — exists if (i, j-1) lower than current.
      const hNorth = j > 0 ? heights[i][j - 1] : -1;
      if (hNorth < h) {
        faces.push({
          corners: [
            { x: x1, y: hNorth, z: z0 },
            { x: x0, y: hNorth, z: z0 },
            { x: x0, y: h, z: z0 },
            { x: x1, y: h, z: z0 },
          ],
          normal: { x: 0, y: 0, z: -1 },
          kind: "wallNS",
        });
      }
      // East wall (x=x1).
      const hEast = i + 1 < N ? heights[i + 1][j] : -1;
      if (hEast < h) {
        faces.push({
          corners: [
            { x: x1, y: hEast, z: z1 },
            { x: x1, y: hEast, z: z0 },
            { x: x1, y: h, z: z0 },
            { x: x1, y: h, z: z1 },
          ],
          normal: { x: 1, y: 0, z: 0 },
          kind: "wallEW",
        });
      }
      // West wall (x=x0).
      const hWest = i > 0 ? heights[i - 1][j] : -1;
      if (hWest < h) {
        faces.push({
          corners: [
            { x: x0, y: hWest, z: z0 },
            { x: x0, y: hWest, z: z1 },
            { x: x0, y: h, z: z1 },
            { x: x0, y: h, z: z0 },
          ],
          normal: { x: -1, y: 0, z: 0 },
          kind: "wallEW",
        });
      }
    }
  }
  return faces;
}

// ── Projection ──────────────────────────────────────────────────────────────

function makeProjector(
  elev: number,
  azim: number,
  dist: number,
  persp: number,
  N: number,
  maxH: number,
  width: number,
  height: number,
): (p: Vec3) => Point {
  const cam = sphericalToCartesian(dist * Math.max(N, maxH), elev, azim);
  // World-up.
  const up = { x: 0, y: 1, z: 0 };
  // Build camera basis.
  const forward = normalize({ x: -cam.x, y: -cam.y, z: -cam.z });
  const right = normalize(cross(forward, up));
  const cameraUp = cross(right, forward);

  // Uniform fit: project all eight corners of the bounding box and find the
  // min/max so the terrain fills the canvas. We don't have access to the
  // actual mesh here, so use the bbox of the heightfield extent.
  const halfX = N / 2;
  const halfZ = N / 2;
  const corners: Vec3[] = [
    { x: -halfX, y: 0, z: -halfZ },
    { x: halfX, y: 0, z: -halfZ },
    { x: halfX, y: 0, z: halfZ },
    { x: -halfX, y: 0, z: halfZ },
    { x: -halfX, y: maxH, z: -halfZ },
    { x: halfX, y: maxH, z: -halfZ },
    { x: halfX, y: maxH, z: halfZ },
    { x: -halfX, y: maxH, z: halfZ },
  ];
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  const projectRaw = (p: Vec3): Point => {
    const dx = p.x - cam.x;
    const dy = p.y - cam.y;
    const dz = p.z - cam.z;
    const camX = dot({ x: dx, y: dy, z: dz }, right);
    const camY = dot({ x: dx, y: dy, z: dz }, cameraUp);
    const camZ = dot({ x: dx, y: dy, z: dz }, forward);
    // Mix of orthographic (persp=0) and perspective (persp=1).
    const denomP = Math.max(0.1, camZ);
    const xPersp = camX / denomP;
    const yPersp = camY / denomP;
    const xOrtho = camX / Math.max(N, maxH);
    const yOrtho = camY / Math.max(N, maxH);
    return {
      x: xPersp * persp + xOrtho * (1 - persp),
      y: yPersp * persp + yOrtho * (1 - persp),
    };
  };
  for (const c of corners) {
    const p = projectRaw(c);
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  const spanX = Math.max(1e-6, maxX - minX);
  const spanY = Math.max(1e-6, maxY - minY);
  const fitMargin = 0.92;
  const scale = Math.min((width * fitMargin) / spanX, (height * fitMargin) / spanY);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;

  return (p: Vec3): Point => {
    const r = projectRaw(p);
    return {
      x: width / 2 + (r.x - cx) * scale,
      // Flip Y because canvas Y points down.
      y: height / 2 - (r.y - cy) * scale,
    };
  };
}

// Approximate world-space depth from the camera origin for painter sort.
function worldDepth(p: Vec3, elev: number, azim: number): number {
  const v = sphericalToCartesian(1, elev, azim);
  return -dot(p, v);
}

// ── Hatching ────────────────────────────────────────────────────────────────

function hatchSpec(
  kind: FaceKind,
  opts: {
    angleTop: number;
    angleSideA: number;
    angleSideB: number;
    densTop: number;
    densSideA: number;
    densSideB: number;
  },
): { angle: number; density: number } {
  if (kind === "top") return { angle: opts.angleTop, density: opts.densTop };
  if (kind === "wallNS")
    return { angle: opts.angleSideA, density: opts.densSideA };
  return { angle: opts.angleSideB, density: opts.densSideB };
}

function hatchPolygon(
  poly: Point[],
  angle: number,
  density: number,
): Point[][] {
  // Direction vector of hatch lines.
  const dir = { x: Math.cos(angle), y: Math.sin(angle) };
  // Perpendicular for slicing across the polygon.
  const perp = { x: -dir.y, y: dir.x };
  // Project polygon onto perpendicular axis to find slice extent.
  const projs = poly.map((p) => p.x * perp.x + p.y * perp.y);
  const lo = Math.min(...projs);
  const hi = Math.max(...projs);
  const span = hi - lo;
  if (span < 1) return [];
  // Density 0 → no lines. Density 1 → spacing ≈ 2px (very dense).
  const spacing = Math.max(1.5, 30 * (1 - density) + 1.5);
  const lines: Point[][] = [];
  for (let t = lo + spacing / 2; t < hi; t += spacing) {
    // Line: all points where (x*perp.x + y*perp.y) == t.
    const seg = clipLineToPolygon(poly, dir, perp, t);
    if (seg) lines.push(seg);
  }
  return lines;
}

// Find the entry/exit segment of a polygon clipped against the line
// {(x,y): x*perp.x + y*perp.y == t}, parametrised along `dir`.
function clipLineToPolygon(
  poly: Point[],
  dir: Point,
  perp: Point,
  t: number,
): Point[] | null {
  const intersections: Point[] = [];
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % n];
    const da = a.x * perp.x + a.y * perp.y - t;
    const db = b.x * perp.x + b.y * perp.y - t;
    if (Math.sign(da) === Math.sign(db) && Math.abs(da) > 1e-9 && Math.abs(db) > 1e-9) {
      continue;
    }
    if (Math.abs(da - db) < 1e-9) continue;
    const u = da / (da - db);
    intersections.push({
      x: a.x + (b.x - a.x) * u,
      y: a.y + (b.y - a.y) * u,
    });
  }
  if (intersections.length < 2) return null;
  // Sort along dir.
  intersections.sort((a, b) => a.x * dir.x + a.y * dir.y - (b.x * dir.x + b.y * dir.y));
  return [intersections[0], intersections[intersections.length - 1]];
}

function closePolyline(poly: Point[]): Point[] {
  if (poly.length === 0) return [];
  return [...poly, poly[0]];
}

// ── Vec3 helpers ────────────────────────────────────────────────────────────

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}
function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}
function normalize(v: Vec3): Vec3 {
  const l = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / l, y: v.y / l, z: v.z / l };
}
function sphericalToCartesian(r: number, elev: number, azim: number): Vec3 {
  return {
    x: r * Math.cos(elev) * Math.sin(azim),
    y: r * Math.sin(elev),
    z: r * Math.cos(elev) * Math.cos(azim),
  };
}
function degToRad(d: number): number {
  return (d * Math.PI) / 180;
}

export default sentinelTerrain;
