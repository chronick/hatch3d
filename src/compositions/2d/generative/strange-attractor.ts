import type { Composition2DDefinition } from "../../types";

type AttractorFn = (
  x: number,
  y: number,
  z: number,
) => [number, number, number];

// ── Attractor Systems ──

function lorenz(x: number, y: number, z: number): [number, number, number] {
  const sigma = 10,
    rho = 28,
    beta = 8 / 3;
  return [sigma * (y - x), x * (rho - z) - y, x * y - beta * z];
}

function aizawa(x: number, y: number, z: number): [number, number, number] {
  const a = 0.95,
    b = 0.7,
    c = 0.6,
    d = 3.5,
    e = 0.25,
    f = 0.1;
  return [
    (z - b) * x - d * y,
    d * x + (z - b) * y,
    c + a * z - (z * z * z) / 3 - (x * x + y * y) * (1 + e * z) + f * z * x * x * x,
  ];
}

function thomas(x: number, y: number, z: number): [number, number, number] {
  const b = 0.208186;
  return [Math.sin(y) - b * x, Math.sin(z) - b * y, Math.sin(x) - b * z];
}

function halvorsen(x: number, y: number, z: number): [number, number, number] {
  const a = 1.89;
  return [
    -a * x - 4 * y - 4 * z - y * y,
    -a * y - 4 * z - 4 * x - z * z,
    -a * z - 4 * x - 4 * y - x * x,
  ];
}

function clifford(x: number, y: number): [number, number, number] {
  const a = -1.4,
    b = 1.6,
    c = 1.0,
    d = 0.7;
  return [Math.sin(a * y) + c * Math.cos(a * x), Math.sin(b * x) + d * Math.cos(b * y), 0];
}

const SYSTEMS: Record<
  string,
  { fn: AttractorFn; is3D: boolean; scale: number; init: [number, number, number] }
> = {
  lorenz: { fn: lorenz, is3D: true, scale: 8, init: [0.1, 0, 0] },
  aizawa: { fn: aizawa, is3D: true, scale: 120, init: [0.1, 0, 0] },
  thomas: { fn: thomas, is3D: true, scale: 80, init: [1.1, 1.1, -0.01] },
  halvorsen: { fn: halvorsen, is3D: true, scale: 20, init: [-1.48, -1.51, 2.04] },
  clifford: {
    fn: (x, y, _z) => clifford(x, y),
    is3D: false,
    scale: 120,
    init: [0.1, 0.1, 0],
  },
};

const strangeAttractor: Composition2DDefinition = {
  id: "strangeAttractor",
  name: "Strange Attractor",
  description:
    "3D chaotic attractor systems projected to 2D with configurable viewing angle",
  tags: ["generative", "chaos", "attractor", "mathematical"],
  category: "2d",
  type: "2d",

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
    rotationAngle: {
      type: "slider",
      label: "Rotation",
      default: 0.3,
      min: 0,
      max: 6.283,
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
  },

  generate({ width, height, values }) {
    const systemName = values.system as string;
    const iterations = Math.round(values.iterations as number);
    const dt = values.dt as number;
    const rotation = values.rotationAngle as number;
    const scaleMul = values.scale as number;
    const trailCount = Math.round(values.trailCount as number);

    const sys = SYSTEMS[systemName] ?? SYSTEMS.lorenz;
    const cosR = Math.cos(rotation);
    const sinR = Math.sin(rotation);

    const polylines: { x: number; y: number }[][] = [];

    for (let trail = 0; trail < trailCount; trail++) {
      let x = sys.init[0] + trail * 0.01;
      let y = sys.init[1] + trail * 0.01;
      let z = sys.init[2];

      const pts: { x: number; y: number }[] = [];

      // Skip transient
      for (let i = 0; i < 500; i++) {
        const [dx, dy, dz] = sys.fn(x, y, z);
        x += dx * dt;
        y += dy * dt;
        z += dz * dt;
      }

      for (let i = 0; i < iterations; i++) {
        const [dx, dy, dz] = sys.fn(x, y, z);
        x += dx * dt;
        y += dy * dt;
        z += dz * dt;

        // Project 3D to 2D via Y-axis rotation
        let px: number, py: number;
        if (sys.is3D) {
          px = x * cosR + z * sinR;
          py = y;
        } else {
          px = x;
          py = y;
        }

        pts.push({
          x: width / 2 + px * sys.scale * scaleMul,
          y: height / 2 + py * sys.scale * scaleMul,
        });
      }

      polylines.push(pts);
    }

    return polylines;
  },
};

export default strangeAttractor;
