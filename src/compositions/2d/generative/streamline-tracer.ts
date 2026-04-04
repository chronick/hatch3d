/**
 * Shared streamline tracing infrastructure for 2D flow compositions.
 *
 * Provides:
 * - SpatialHash for efficient nearest-distance queries
 * - RK2 midpoint integration
 * - Jobard-Lefer evenly-spaced seeding
 * - Extended trace bounds with margin support
 *
 * Used by: flow-field, ink-vortex, and any future streamline-based composition.
 */

// ── Spatial Hash ──

export class SpatialHash {
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

// ── Types ──

export type VelocityFn = (x: number, y: number) => { vx: number; vy: number };

export interface StreamlineParams {
  width: number;
  height: number;
  separation: number;
  stepLength: number;
  maxSteps: number;
  minLength: number;
  margin: number;
}

// ── Streamline Tracer ──

/**
 * Trace evenly-spaced streamlines through a velocity field using
 * RK2 integration and Jobard-Lefer adaptive seeding.
 */
export function traceStreamlines(
  velocityAt: VelocityFn,
  params: StreamlineParams,
): { x: number; y: number }[][] {
  const { width, height, separation: dSep, stepLength: stepLen, maxSteps, minLength: minLen, margin } = params;

  // Visible seed region
  const x0 = margin;
  const y0 = margin;
  const x1 = width - margin;
  const y1 = height - margin;

  // Extended trace region — streamlines arc past canvas, SVG viewBox clips
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
      if (step > 2 && hash.nearestDistance(x, y) < dSep * 0.5) break;

      pts.push({ x, y });

      const v0 = velocityAt(x, y);
      const mag0 = Math.hypot(v0.vx, v0.vy);
      if (mag0 < 1e-8) break;

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

  function traceOne(
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

    for (const p of combined) {
      hash.insert(p.x, p.y);
    }

    return combined;
  }

  // ── Jobard-Lefer evenly-spaced seeding ──

  const polylines: { x: number; y: number }[][] = [];
  const seedQueue: { x: number; y: number }[] = [];

  // Initial seed at center
  seedQueue.push({ x: width / 2, y: height / 2 });

  // Dense grid seeds for full-page coverage
  const gridStep = dSep * 3;
  for (let gy = y0; gy <= y1; gy += gridStep) {
    for (let gx = x0; gx <= x1; gx += gridStep) {
      seedQueue.push({ x: gx, y: gy });
    }
  }

  while (seedQueue.length > 0) {
    const seed = seedQueue.shift()!;

    if (hash.nearestDistance(seed.x, seed.y) < dSep * 0.8) continue;

    const line = traceOne(seed.x, seed.y);
    if (!line) continue;

    polylines.push(line);

    // Perpendicular seed candidates
    const seedInterval = Math.max(4, Math.floor(line.length / 20));
    for (let i = 0; i < line.length - 1; i += seedInterval) {
      const p0 = line[i];
      const p1 = line[i + 1];
      const dx = p1.x - p0.x;
      const dy = p1.y - p0.y;
      const len = Math.hypot(dx, dy);
      if (len < 1e-8) continue;

      const px = -dy / len;
      const py = dx / len;

      const left = { x: p0.x + px * dSep, y: p0.y + py * dSep };
      const right = { x: p0.x - px * dSep, y: p0.y - py * dSep };

      if (inSeedBounds(left.x, left.y)) seedQueue.push(left);
      if (inSeedBounds(right.x, right.y)) seedQueue.push(right);
    }
  }

  return polylines;
}

// ── Noise helpers ──

/** Fractal Brownian motion */
export function fbm(
  noise2D: (x: number, y: number) => number,
  x: number,
  y: number,
  octaves: number,
): number {
  let value = 0;
  let amp = 1;
  let freq = 1;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    value += amp * noise2D(x * freq, y * freq);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return value / norm;
}

/** Curl of a scalar noise field — divergence-free flow vectors */
export function curlNoise(
  noise2D: (x: number, y: number) => number,
  px: number,
  py: number,
  noiseScale: number,
  octaves: number,
): { vx: number; vy: number } {
  const eps = 1;
  const sx = px * noiseScale;
  const sy = py * noiseScale;
  const ens = eps * noiseScale;
  const n = fbm(noise2D, sx, sy + ens, octaves);
  const s = fbm(noise2D, sx, sy - ens, octaves);
  const e = fbm(noise2D, sx + ens, sy, octaves);
  const w = fbm(noise2D, sx - ens, sy, octaves);
  const inv = 1 / (2 * ens);
  return { vx: (n - s) * inv, vy: -(e - w) * inv };
}
