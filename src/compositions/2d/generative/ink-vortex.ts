import { createNoise2D } from "simplex-noise";
import type { Composition2DDefinition } from "../../types";

// ── Spatial Hash for efficient nearest-distance queries ──

class SpatialHash {
  cells = new Map<string, { x: number; y: number }[]>();
  cellSize: number;
  constructor(cellSize: number) {
    this.cellSize = cellSize;
  }

  key(x: number, y: number): string {
    return `${Math.floor(x / this.cellSize)},${Math.floor(y / this.cellSize)}`;
  }

  insert(x: number, y: number) {
    const k = this.key(x, y);
    const bucket = this.cells.get(k);
    if (bucket) bucket.push({ x, y });
    else this.cells.set(k, [{ x, y }]);
  }

  nearestDistance(x: number, y: number): number {
    const gx = Math.floor(x / this.cellSize);
    const gy = Math.floor(y / this.cellSize);
    let best = Infinity;
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const bucket = this.cells.get(`${gx + dx},${gy + dy}`);
        if (!bucket) continue;
        for (const p of bucket) {
          const d = Math.hypot(p.x - x, p.y - y);
          if (d < best) best = d;
        }
      }
    }
    return best;
  }
}

// ── Vortex generation presets ──

interface Vortex {
  x: number;
  y: number;
  gamma: number; // circulation strength
}

function generateVortices(
  arrangement: string,
  count: number,
  circulationRange: number,
  width: number,
  height: number,
): Vortex[] {
  const cx = width / 2;
  const cy = height / 2;
  const rx = width * 0.4;
  const ry = height * 0.4;

  switch (arrangement) {
    case "ring": {
      return Array.from({ length: count }, (_, i) => {
        const angle = (i / count) * Math.PI * 2;
        const sign = i % 2 === 0 ? 1 : -1;
        return {
          x: cx + Math.cos(angle) * rx,
          y: cy + Math.sin(angle) * ry,
          gamma: sign * circulationRange,
        };
      });
    }

    case "dipole": {
      const gap = rx * 0.4;
      return [
        { x: cx - gap, y: cy, gamma: circulationRange },
        { x: cx + gap, y: cy, gamma: -circulationRange },
      ];
    }

    case "karman": {
      // Von Kármán vortex street: two staggered rows
      const vortices: Vortex[] = [];
      const rowGap = height * 0.3;
      const spacing = width / (Math.ceil(count / 2) + 1);
      for (let i = 0; i < count; i++) {
        const row = i % 2;
        const col = Math.floor(i / 2);
        vortices.push({
          x: spacing * (col + 1) + (row === 1 ? spacing * 0.5 : 0),
          y: cy + (row === 0 ? -rowGap : rowGap),
          gamma: (row === 0 ? 1 : -1) * circulationRange,
        });
      }
      return vortices;
    }

    case "galaxy": {
      // Spiral arm arrangement with decaying circulation
      return Array.from({ length: count }, (_, i) => {
        const t = i / count;
        const angle = t * Math.PI * 4; // two full spiral turns
        const rFrac = 0.1 + t * 0.9;
        return {
          x: cx + Math.cos(angle) * rx * rFrac,
          y: cy + Math.sin(angle) * ry * rFrac,
          gamma: circulationRange * (1 - t * 0.6) * (i % 2 === 0 ? 1 : -0.5),
        };
      });
    }

    default: {
      // "random" — seeded pseudo-random using simple hash
      return Array.from({ length: count }, (_, i) => {
        // Deterministic pseudo-random based on index
        const h1 = Math.sin(i * 127.1 + 311.7) * 43758.5453;
        const h2 = Math.sin(i * 269.5 + 183.3) * 43758.5453;
        const h3 = Math.sin(i * 419.2 + 371.9) * 43758.5453;
        const px = (h1 - Math.floor(h1)) * width * 0.9 + width * 0.05;
        const py = (h2 - Math.floor(h2)) * height * 0.9 + height * 0.05;
        const sign = (h3 - Math.floor(h3)) > 0.5 ? 1 : -1;
        return {
          x: px,
          y: py,
          gamma: sign * circulationRange * (0.5 + (h3 - Math.floor(h3)) * 0.5),
        };
      });
    }
  }
}

// ── Composition definition ──

const inkVortex: Composition2DDefinition = {
  id: "inkVortex",
  name: "Ink Vortex",
  description:
    "Fluid dynamics streamlines via point vortex fields and Jobard-Lefer evenly-spaced seeding. Produces engraving-like flow patterns.",
  tags: ["generative", "fluid", "vortex", "streamlines", "engraving"],
  category: "2d",
  type: "2d",

  macros: {
    density: {
      label: "Density",
      default: 0.5,
      targets: [
        { param: "separation", fn: "linear", strength: -0.7 },
        { param: "maxSteps", fn: "linear", strength: 0.5 },
      ],
    },
    turbulence: {
      label: "Turbulence",
      default: 0.0,
      targets: [
        { param: "curlNoise", fn: "linear", strength: 1.0 },
        { param: "noiseScale", fn: "linear", strength: 0.6 },
      ],
    },
  },

  controls: {
    arrangement: {
      type: "select",
      label: "Arrangement",
      default: "random",
      options: [
        { label: "Random", value: "random" },
        { label: "Ring", value: "ring" },
        { label: "Dipole", value: "dipole" },
        { label: "Kármán Street", value: "karman" },
        { label: "Galaxy", value: "galaxy" },
      ],
      group: "Vortices",
    },
    vortexCount: {
      type: "slider",
      label: "Vortex Count",
      default: 6,
      min: 2,
      max: 20,
      step: 1,
      group: "Vortices",
    },
    circulationRange: {
      type: "slider",
      label: "Circulation",
      default: 1.0,
      min: 0.2,
      max: 5.0,
      step: 0.1,
      group: "Vortices",
    },
    epsilon: {
      type: "slider",
      label: "Regularization",
      default: 30,
      min: 5,
      max: 100,
      step: 1,
      group: "Vortices",
    },
    separation: {
      type: "slider",
      label: "Separation",
      default: 8,
      min: 3,
      max: 30,
      step: 1,
      group: "Streamlines",
    },
    stepLength: {
      type: "slider",
      label: "Step Length",
      default: 3,
      min: 1,
      max: 10,
      step: 0.5,
      group: "Streamlines",
    },
    maxSteps: {
      type: "slider",
      label: "Max Steps",
      default: 300,
      min: 50,
      max: 1000,
      step: 10,
      group: "Streamlines",
    },
    minLength: {
      type: "slider",
      label: "Min Length",
      default: 15,
      min: 5,
      max: 50,
      step: 1,
      group: "Streamlines",
    },
    curlNoise: {
      type: "slider",
      label: "Curl Noise",
      default: 0.0,
      min: 0,
      max: 1,
      step: 0.01,
      group: "Turbulence",
    },
    noiseScale: {
      type: "slider",
      label: "Noise Scale",
      default: 0.005,
      min: 0.001,
      max: 0.02,
      step: 0.001,
      group: "Turbulence",
    },
    margin: {
      type: "slider",
      label: "Margin",
      default: 20,
      min: 0,
      max: 80,
      step: 1,
      group: "Layout",
    },
  },

  generate({ width, height, values }) {
    const arrangement = values.arrangement as string;
    const vortexCount = Math.round(values.vortexCount as number);
    const circulationRange = values.circulationRange as number;
    const epsilon = values.epsilon as number;
    const dSep = values.separation as number;
    const stepLen = values.stepLength as number;
    const maxSteps = Math.round(values.maxSteps as number);
    const minLen = Math.round(values.minLength as number);
    const curlNoise = values.curlNoise as number;
    const noiseScale = values.noiseScale as number;
    const margin = values.margin as number;

    // Visible region (seeds placed here)
    const x0 = margin;
    const y0 = margin;
    const x1 = width - margin;
    const y1 = height - margin;

    // Extended trace region — streamlines can arc past the canvas so edge
    // lines don't terminate prematurely. SVG viewBox clips the overflow.
    const buf = Math.max(width, height) * 0.5;
    const tx0 = -buf;
    const ty0 = -buf;
    const tx1 = width + buf;
    const ty1 = height + buf;

    function inTraceBounds(x: number, y: number): boolean {
      return x >= tx0 && x <= tx1 && y >= ty0 && y <= ty1;
    }

    function inSeedBounds(x: number, y: number): boolean {
      return x >= x0 && x <= x1 && y >= y0 && y <= y1;
    }

    // Generate vortex configuration
    const vortices = generateVortices(
      arrangement,
      vortexCount,
      circulationRange,
      width,
      height,
    );

    // Optional curl noise for organic turbulence
    const noise2D = curlNoise > 0 ? createNoise2D() : null;

    function curlField(x: number, y: number): { vx: number; vy: number } {
      if (!noise2D) return { vx: 0, vy: 0 };
      const eps = 1;
      const n = noise2D(x * noiseScale, (y + eps) * noiseScale);
      const s = noise2D(x * noiseScale, (y - eps) * noiseScale);
      const e = noise2D((x + eps) * noiseScale, y * noiseScale);
      const w = noise2D((x - eps) * noiseScale, y * noiseScale);
      // Curl of scalar noise field: perpendicular to gradient
      return { vx: (n - s) / (2 * eps), vy: -(e - w) / (2 * eps) };
    }

    // Biot-Savart velocity from all vortices + optional curl noise
    function velocityAt(
      px: number,
      py: number,
    ): { vx: number; vy: number } {
      let vx = 0;
      let vy = 0;

      for (const v of vortices) {
        const dx = px - v.x;
        const dy = py - v.y;
        const r2 = dx * dx + dy * dy + epsilon * epsilon; // regularized
        const factor = v.gamma / (2 * Math.PI * r2);
        // Perpendicular velocity (counter-clockwise for positive gamma)
        vx += -dy * factor;
        vy += dx * factor;
      }

      // Blend with curl noise
      if (curlNoise > 0) {
        const cn = curlField(px, py);
        vx = vx * (1 - curlNoise) + cn.vx * curlNoise;
        vy = vy * (1 - curlNoise) + cn.vy * curlNoise;
      }

      return { vx, vy };
    }

    // Spatial hash for streamline distance queries
    const hash = new SpatialHash(dSep);

    // RK2 (midpoint method) integration in one direction
    function traceDirection(
      sx: number,
      sy: number,
      dir: 1 | -1,
    ): { x: number; y: number }[] {
      const pts: { x: number; y: number }[] = [];
      let x = sx;
      let y = sy;

      for (let step = 0; step < maxSteps; step++) {
        if (!inTraceBounds(x, y)) break;

        // After initial segment, check distance to existing streamlines
        if (step > 2 && hash.nearestDistance(x, y) < dSep * 0.5) break;

        pts.push({ x, y });

        // RK2 midpoint: evaluate velocity at start, step to midpoint, re-evaluate
        const v0 = velocityAt(x, y);
        const mag0 = Math.hypot(v0.vx, v0.vy);
        if (mag0 < 1e-8) break; // stagnation point

        const nx0 = (v0.vx / mag0) * dir;
        const ny0 = (v0.vy / mag0) * dir;
        const mx = x + nx0 * stepLen * 0.5;
        const my = y + ny0 * stepLen * 0.5;

        const v1 = velocityAt(mx, my);
        const mag1 = Math.hypot(v1.vx, v1.vy);
        if (mag1 < 1e-8) break;

        x += (v1.vx / mag1) * dir * stepLen;
        y += (v1.vy / mag1) * dir * stepLen;
      }

      return pts;
    }

    // Full bidirectional streamline from a seed
    function traceStreamline(
      sx: number,
      sy: number,
    ): { x: number; y: number }[] | null {
      const forward = traceDirection(sx, sy, 1);
      const backward = traceDirection(sx, sy, -1);

      const combined = [
        ...backward.reverse(),
        ...forward.slice(backward.length > 0 ? 1 : 0),
      ];

      if (combined.length < minLen) return null;

      // Register all points in spatial hash
      for (const p of combined) {
        hash.insert(p.x, p.y);
      }

      return combined;
    }

    // ── Jobard-Lefer evenly-spaced streamline seeding ──

    const polylines: { x: number; y: number }[][] = [];

    // Seed queue: candidate seed points from perpendicular offsets
    const seedQueue: { x: number; y: number }[] = [];

    // Initial seed at center
    seedQueue.push({ x: width / 2, y: height / 2 });

    // Dense grid seeds to ensure full-page coverage
    const gridStep = dSep * 3;
    for (let gy = y0; gy <= y1; gy += gridStep) {
      for (let gx = x0; gx <= x1; gx += gridStep) {
        seedQueue.push({ x: gx, y: gy });
      }
    }

    while (seedQueue.length > 0) {
      const seed = seedQueue.shift()!;

      // Skip if too close to existing streamlines
      if (hash.nearestDistance(seed.x, seed.y) < dSep * 0.8) continue;

      const line = traceStreamline(seed.x, seed.y);
      if (!line) continue;

      polylines.push(line);

      // Generate candidate seeds perpendicular to this streamline
      const seedInterval = Math.max(4, Math.floor(line.length / 20));
      for (let i = 0; i < line.length - 1; i += seedInterval) {
        const p0 = line[i];
        const p1 = line[i + 1];
        const dx = p1.x - p0.x;
        const dy = p1.y - p0.y;
        const len = Math.hypot(dx, dy);
        if (len < 1e-8) continue;

        // Unit perpendicular
        const px = -dy / len;
        const py = dx / len;

        // Seeds on both sides at distance dSep
        const left = { x: p0.x + px * dSep, y: p0.y + py * dSep };
        const right = { x: p0.x - px * dSep, y: p0.y - py * dSep };

        if (inSeedBounds(left.x, left.y)) seedQueue.push(left);
        if (inSeedBounds(right.x, right.y)) seedQueue.push(right);
      }
    }

    return polylines;
  },
};

export default inkVortex;
