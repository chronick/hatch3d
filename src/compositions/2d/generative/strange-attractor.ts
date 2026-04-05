import type { Composition2DDefinition } from "../../types";

// ── Attractor Systems ──
// Each system has a primary "chaos" parameter that shifts its behavior
// from periodic to chaotic when perturbed.

function lorenz(
  x: number,
  y: number,
  z: number,
  chaos: number,
): [number, number, number] {
  const sigma = 10;
  const rho = 28 + chaos * 12; // 16–40: periodic → hyperchaotic
  const beta = 8 / 3;
  return [sigma * (y - x), x * (rho - z) - y, x * y - beta * z];
}

function aizawa(
  x: number,
  y: number,
  z: number,
  chaos: number,
): [number, number, number] {
  const a = 0.95 + chaos * 0.15; // torus → chaotic breakup
  const b = 0.7;
  const c = 0.6;
  const d = 3.5;
  const e = 0.25;
  const f = 0.1;
  return [
    (z - b) * x - d * y,
    d * x + (z - b) * y,
    c + a * z - (z * z * z) / 3 - (x * x + y * y) * (1 + e * z) + f * z * x * x * x,
  ];
}

function thomas(
  x: number,
  y: number,
  z: number,
  chaos: number,
): [number, number, number] {
  const b = 0.208186 - chaos * 0.06; // lower dissipation → more chaotic
  return [Math.sin(y) - b * x, Math.sin(z) - b * y, Math.sin(x) - b * z];
}

function halvorsen(
  x: number,
  y: number,
  z: number,
  chaos: number,
): [number, number, number] {
  const a = 1.89 + chaos * 0.5; // higher → more spread
  return [
    -a * x - 4 * y - 4 * z - y * y,
    -a * y - 4 * z - 4 * x - z * z,
    -a * z - 4 * x - 4 * y - x * x,
  ];
}

function dejong(
  x: number,
  y: number,
  _z: number,
  chaos: number,
): [number, number, number] {
  const a = -2.24 + chaos * 0.5;
  const b = 0.43 - chaos * 0.3;
  const c = -0.65 + chaos * 0.2;
  const d = -2.43 + chaos * 0.4;
  return [Math.sin(a * y) - Math.cos(b * x), Math.sin(c * x) - Math.cos(d * y), 0];
}

function clifford(
  x: number,
  y: number,
  _z: number,
  chaos: number,
): [number, number, number] {
  const a = -1.4 + chaos * 0.3;
  const b = 1.6 + chaos * 0.2;
  const c = 1.0 - chaos * 0.15;
  const d = 0.7 + chaos * 0.25;
  return [Math.sin(a * y) + c * Math.cos(a * x), Math.sin(b * x) + d * Math.cos(b * y), 0];
}

interface SystemDef {
  fn: (x: number, y: number, z: number, chaos: number) => [number, number, number];
  is3D: boolean;
  scale: number;
  init: [number, number, number];
  /** 2D attractors use iterated map, not differential eq */
  isMap?: boolean;
}

const SYSTEMS: Record<string, SystemDef> = {
  lorenz: { fn: lorenz, is3D: true, scale: 8, init: [0.1, 0, 0] },
  aizawa: { fn: aizawa, is3D: true, scale: 120, init: [0.1, 0, 0] },
  thomas: { fn: thomas, is3D: true, scale: 80, init: [1.1, 1.1, -0.01] },
  halvorsen: { fn: halvorsen, is3D: true, scale: 20, init: [-1.48, -1.51, 2.04] },
  dejong: { fn: dejong, is3D: false, scale: 120, init: [0.1, 0.1, 0], isMap: true },
  clifford: { fn: clifford, is3D: false, scale: 120, init: [0.1, 0.1, 0], isMap: true },
};

const strangeAttractor: Composition2DDefinition = {
  id: "strangeAttractor",
  name: "Strange Attractor",
  description:
    "3D chaotic attractor systems projected to 2D with configurable chaos, viewing angle, and line segmentation for plotting",
  tags: ["generative", "chaos", "attractor", "mathematical"],
  category: "2d",
  type: "2d",

  macros: {
    density: {
      label: "Density",
      default: 0.5,
      targets: [
        { param: "iterations", fn: "linear", strength: 0.8 },
        { param: "trailCount", fn: "linear", strength: 0.6 },
      ],
    },
    chaos: {
      label: "Chaos",
      default: 0.0,
      targets: [
        { param: "chaosAmount", fn: "linear", strength: 1.0 },
      ],
    },
  },

  controls: {
    system: {
      type: "select",
      label: "System",
      default: "lorenz",
      options: [
        { label: "Lorenz", value: "lorenz" },
        { label: "Aizawa", value: "aizawa" },
        { label: "Thomas", value: "thomas" },
        { label: "Halvorsen", value: "halvorsen" },
        { label: "De Jong (2D)", value: "dejong" },
        { label: "Clifford (2D)", value: "clifford" },
      ],
      group: "System",
    },
    iterations: {
      type: "slider",
      label: "Iterations",
      default: 50000,
      min: 10000,
      max: 500000,
      step: 5000,
      group: "System",
    },
    dt: {
      type: "slider",
      label: "Time Step",
      default: 0.005,
      min: 0.001,
      max: 0.02,
      step: 0.001,
      group: "System",
    },
    chaosAmount: {
      type: "slider",
      label: "Chaos",
      default: 0.0,
      min: -1,
      max: 1,
      step: 0.01,
      group: "System",
    },
    rotationAngle: {
      type: "slider",
      label: "Rotation",
      default: 0.0,
      min: 0,
      max: 6.283,
      step: 0.01,
      group: "View",
    },
    elevation: {
      type: "slider",
      label: "Elevation",
      default: 0.0,
      min: -1.57,
      max: 1.57,
      step: 0.01,
      group: "View",
    },
    scale: {
      type: "slider",
      label: "Scale",
      default: 1.0,
      min: 0.5,
      max: 15.0,
      step: 0.1,
      group: "View",
    },
    trailCount: {
      type: "slider",
      label: "Trails",
      default: 1,
      min: 1,
      max: 20,
      step: 1,
      group: "View",
    },
    segmentGap: {
      type: "slider",
      label: "Segment Gap",
      default: 50,
      min: 10,
      max: 200,
      step: 5,
      group: "Plotting",
    },
    margin: {
      type: "slider",
      label: "Margin",
      default: 20,
      min: 0,
      max: 80,
      step: 1,
      group: "Plotting",
    },
  },

  generate({ width, height, values }) {
    const systemName = values.system as string;
    const iterations = Math.round(values.iterations as number);
    const dt = values.dt as number;
    const chaosAmount = values.chaosAmount as number;
    const rotation = values.rotationAngle as number;
    const elevation = values.elevation as number;
    const scaleMul = values.scale as number;
    const trailCount = Math.round(values.trailCount as number);
    const segmentGap = values.segmentGap as number;
    const margin = values.margin as number;

    const sys = SYSTEMS[systemName] ?? SYSTEMS.lorenz;
    const cosR = Math.cos(rotation);
    const sinR = Math.sin(rotation);
    const cosE = Math.cos(elevation);
    const sinE = Math.sin(elevation);

    // Helper: integrate one step
    function step(
      x: number, y: number, z: number,
    ): [number, number, number] {
      if (sys.isMap) {
        const [nx, ny] = sys.fn(x, y, z, chaosAmount);
        return [nx, ny, 0];
      }
      const [dx, dy, dz] = sys.fn(x, y, z, chaosAmount);
      return [x + dx * dt, y + dy * dt, z + dz * dt];
    }

    // Helper: project 3D → 2D (raw, unscaled)
    function project(x: number, y: number, z: number): [number, number] {
      if (sys.is3D) {
        const rx = x * cosR + z * sinR;
        const rz = -x * sinR + z * cosR;
        return [rx, y * cosE - rz * sinE];
      }
      return [x, y];
    }

    // ── Pass 1: Compute bounding box ──
    // Run all trails at full iteration count to capture exact extent.
    let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
    for (let trail = 0; trail < trailCount; trail++) {
      let x = sys.init[0] + trail * 0.01;
      let y = sys.init[1] + trail * 0.01;
      let z = sys.init[2];
      const transientSteps = sys.isMap ? 100 : 500;
      for (let i = 0; i < transientSteps; i++) {
        [x, y, z] = step(x, y, z);
      }
      for (let i = 0; i < iterations; i++) {
        [x, y, z] = step(x, y, z);
        if (!isFinite(x) || !isFinite(y) || !isFinite(z)) break;
        const [px, py] = project(x, y, z);
        if (px < bx0) bx0 = px;
        if (px > bx1) bx1 = px;
        if (py < by0) by0 = py;
        if (py > by1) by1 = py;
      }
    }

    // Auto-fit: scale and center to fill canvas within margin, like all other compositions.
    const availW = width - margin * 2;
    const availH = height - margin * 2;
    const bboxW = bx1 - bx0 || 1;
    const bboxH = by1 - by0 || 1;
    const autoScale = Math.min(availW / bboxW, availH / bboxH);
    const fitScale = autoScale * scaleMul;
    const bboxCx = (bx0 + bx1) / 2;
    const bboxCy = (by0 + by1) / 2;
    const cx = width / 2;
    const cy = height / 2;

    const gapSq = segmentGap * segmentGap;

    // ── Local density grid ──
    // Track how many points land in each cell; probabilistically skip
    // points in over-dense regions to prevent over-inking.
    const densityCellSize = 12;
    const maxPointsPerCell = 30;
    const densityCols = Math.ceil(width / densityCellSize);
    const densityRows = Math.ceil(height / densityCellSize);
    const densityGrid = new Uint16Array(densityCols * densityRows);

    function checkDensity(sx: number, sy: number): boolean {
      const col = Math.floor(sx / densityCellSize);
      const row = Math.floor(sy / densityCellSize);
      if (col < 0 || col >= densityCols || row < 0 || row >= densityRows) return false;
      const idx = row * densityCols + col;
      const count = densityGrid[idx];
      if (count >= maxPointsPerCell) {
        // Probabilistically skip: the denser it gets, the less likely we add
        const keepProb = maxPointsPerCell / (count + 1);
        if (Math.random() > keepProb) return false;
      }
      densityGrid[idx]++;
      return true;
    }

    // Break long trails into fixed-length segments for density filtering
    const maxSegmentLen = 200;

    const polylines: { x: number; y: number }[][] = [];

    // ── Pass 2: Generate polylines ──
    for (let trail = 0; trail < trailCount; trail++) {
      let x = sys.init[0] + trail * 0.01;
      let y = sys.init[1] + trail * 0.01;
      let z = sys.init[2];

      const transientSteps = sys.isMap ? 100 : 500;
      for (let i = 0; i < transientSteps; i++) {
        [x, y, z] = step(x, y, z);
      }

      let currentSegment: { x: number; y: number }[] = [];

      for (let i = 0; i < iterations; i++) {
        [x, y, z] = step(x, y, z);
        if (!isFinite(x) || !isFinite(y) || !isFinite(z)) break;

        const [px, py] = project(x, y, z);

        // Map to canvas: center on bbox center, apply auto-fit scale
        const sx = cx + (px - bboxCx) * fitScale;
        const sy = cy + (py - bboxCy) * fitScale;

        // Local density check: skip points in over-dense cells
        if (!checkDensity(sx, sy)) {
          // Flush current segment and start fresh
          if (currentSegment.length >= 2) {
            polylines.push(currentSegment);
          }
          currentSegment = [];
          continue;
        }

        // Segment on distance jumps — compare to last ACCEPTED point in segment
        if (currentSegment.length > 0) {
          const prev = currentSegment[currentSegment.length - 1];
          const dx = sx - prev.x;
          const dy = sy - prev.y;
          if (dx * dx + dy * dy > gapSq) {
            if (currentSegment.length >= 2) {
              polylines.push(currentSegment);
            }
            currentSegment = [];
          }
        }

        // Break into fixed-length segments
        if (currentSegment.length >= maxSegmentLen) {
          polylines.push(currentSegment);
          currentSegment = [currentSegment[currentSegment.length - 1]];
        }

        currentSegment.push({ x: sx, y: sy });
      }

      if (currentSegment.length >= 2) {
        polylines.push(currentSegment);
      }
    }

    return polylines;
  },
};

export default strangeAttractor;
