import { createNoise2D } from "simplex-noise";
import type { Composition2DDefinition } from "../../types";

// ── Seeded PRNG (mulberry32) ──

function mulberry32(a: number) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Spatial hash for trail avoidance ──

class SpatialHash {
  private cells = new Map<number, { x: number; y: number }[]>();
  private invCell: number;

  constructor(cellSize: number) {
    this.invCell = 1 / cellSize;
  }

  private key(cx: number, cy: number): number {
    // Cantor-style pairing; works for positive and moderate negative coords
    return cx * 73856093 + cy * 19349663;
  }

  insert(x: number, y: number): void {
    const cx = Math.floor(x * this.invCell);
    const cy = Math.floor(y * this.invCell);
    const k = this.key(cx, cy);
    let bucket = this.cells.get(k);
    if (!bucket) {
      bucket = [];
      this.cells.set(k, bucket);
    }
    bucket.push({ x, y });
  }

  hasNeighbor(x: number, y: number, radius: number): boolean {
    const r2 = radius * radius;
    const cx = Math.floor(x * this.invCell);
    const cy = Math.floor(y * this.invCell);

    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const bucket = this.cells.get(this.key(cx + dx, cy + dy));
        if (!bucket) continue;
        for (let i = 0; i < bucket.length; i++) {
          const p = bucket[i];
          const ex = p.x - x;
          const ey = p.y - y;
          if (ex * ex + ey * ey < r2) return true;
        }
      }
    }
    return false;
  }
}

// ── Composition definition ──

const perlinWorms: Composition2DDefinition = {
  id: "perlinWorms",
  name: "Perlin Worms",
  description: "Autonomous agents leaving trails through a noise field",
  tags: ["generative", "noise", "agents", "organic", "trails"],
  category: "2d",
  type: "2d",

  controls: {
    wormCount: {
      type: "slider",
      label: "Worm Count",
      default: 150,
      min: 10,
      max: 500,
      step: 5,
      group: "Agents",
    },
    maxSteps: {
      type: "slider",
      label: "Max Steps",
      default: 200,
      min: 20,
      max: 1000,
      step: 10,
      group: "Agents",
    },
    stepSize: {
      type: "slider",
      label: "Step Size",
      default: 3,
      min: 0.5,
      max: 10,
      step: 0.25,
      group: "Agents",
    },
    noiseScale: {
      type: "slider",
      label: "Noise Scale",
      default: 0.005,
      min: 0.001,
      max: 0.03,
      step: 0.001,
      group: "Noise",
    },
    turnStrength: {
      type: "slider",
      label: "Turn Strength",
      default: 1.5,
      min: 0.1,
      max: 4,
      step: 0.1,
      group: "Noise",
    },
    avoidance: {
      type: "toggle",
      label: "Trail Avoidance",
      default: true,
      group: "Agents",
    },
    avoidRadius: {
      type: "slider",
      label: "Avoid Radius",
      default: 5,
      min: 1,
      max: 20,
      step: 0.5,
      group: "Agents",
    },
    thickness: {
      type: "slider",
      label: "Line Thickness",
      default: 0,
      min: 0,
      max: 3,
      step: 0.25,
      group: "Style",
    },
    seed: {
      type: "slider",
      label: "Seed",
      default: 42,
      min: 0,
      max: 999,
      step: 1,
      group: "Structure",
    },
    margin: {
      type: "slider",
      label: "Margin",
      default: 20,
      min: 0,
      max: 80,
      step: 5,
      group: "Layout",
    },
  },

  generate({ width, height, values }) {
    const wormCount = Math.round(values.wormCount as number);
    const maxSteps = Math.round(values.maxSteps as number);
    const stepSize = values.stepSize as number;
    const noiseScale = values.noiseScale as number;
    const turnStrength = values.turnStrength as number;
    const avoidance = values.avoidance as boolean;
    const avoidRadius = values.avoidRadius as number;
    const thickness = values.thickness as number;
    const seed = Math.round(values.seed as number);
    const margin = values.margin as number;

    const rng = mulberry32(seed);
    const noise2D = createNoise2D(() => rng());

    const PI = Math.PI;
    const inertiaFactor = 0.1;

    // Bounding box with margin
    const xMin = margin;
    const yMin = margin;
    const xMax = width - margin;
    const yMax = height - margin;

    // Spatial hash for avoidance (cell size = avoidRadius for efficient lookups)
    const hash = avoidance ? new SpatialHash(avoidRadius) : null;

    const polylines: { x: number; y: number }[][] = [];

    for (let w = 0; w < wormCount; w++) {
      // Random start position within margins
      let x = xMin + rng() * (xMax - xMin);
      let y = yMin + rng() * (yMax - yMin);
      let heading = rng() * PI * 2;

      const trail: { x: number; y: number }[] = [{ x, y }];

      // Insert starting point into hash
      if (hash) hash.insert(x, y);

      let alive = true;
      for (let s = 0; s < maxSteps && alive; s++) {
        // Sample noise to get turn delta
        const n = noise2D(x * noiseScale, y * noiseScale);
        const angleDelta = n * turnStrength * PI;

        // Apply inertia: heading changes gradually
        heading += angleDelta * inertiaFactor;

        // Move forward
        x += Math.cos(heading) * stepSize;
        y += Math.sin(heading) * stepSize;

        // Bounds check
        if (x < xMin || x > xMax || y < yMin || y > yMax) {
          alive = false;
          break;
        }

        // Avoidance check
        if (hash) {
          if (hash.hasNeighbor(x, y, avoidRadius)) {
            alive = false;
            break;
          }
          hash.insert(x, y);
        }

        trail.push({ x, y });
      }

      // Only keep trails with at least 2 points
      if (trail.length >= 2) {
        if (thickness > 0) {
          // Generate ribbon: center + two parallel offset lines
          const left: { x: number; y: number }[] = [];
          const right: { x: number; y: number }[] = [];

          for (let i = 0; i < trail.length; i++) {
            // Compute direction at this point
            let dx: number, dy: number;
            if (i === 0) {
              dx = trail[1].x - trail[0].x;
              dy = trail[1].y - trail[0].y;
            } else if (i === trail.length - 1) {
              dx = trail[i].x - trail[i - 1].x;
              dy = trail[i].y - trail[i - 1].y;
            } else {
              dx = trail[i + 1].x - trail[i - 1].x;
              dy = trail[i + 1].y - trail[i - 1].y;
            }

            // Normalize
            const len = Math.hypot(dx, dy) || 1e-8;
            const nx = -dy / len;
            const ny = dx / len;

            left.push({
              x: trail[i].x + nx * thickness,
              y: trail[i].y + ny * thickness,
            });
            right.push({
              x: trail[i].x - nx * thickness,
              y: trail[i].y - ny * thickness,
            });
          }

          polylines.push(trail, left, right);
        } else {
          polylines.push(trail);
        }
      }
    }

    return polylines;
  },
};

export default perlinWorms;
