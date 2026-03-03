/**
 * Post-projection density limiter.
 *
 * After perspective projection, lines can pile up in foreshortened areas.
 * This module probabilistically removes polylines that pass through
 * overly dense regions of the 2D viewport.
 */

export interface DensityFilterOptions {
  /** Maximum desired polyline density per cell (default 20) */
  maxDensity: number;
  /** Grid cell size in pixels (default 40) */
  cellSize: number;
  /** Viewport width */
  width: number;
  /** Viewport height */
  height: number;
}

export function filterByProjectedDensity<T extends { x: number; y: number }[]>(
  polylines: T[],
  opts: DensityFilterOptions,
): T[] {
  const { maxDensity, cellSize, width, height } = opts;
  if (polylines.length === 0) return polylines;
  if (maxDensity <= 0) return [];

  const cols = Math.ceil(width / cellSize);
  const rows = Math.ceil(height / cellSize);
  const grid = new Uint16Array(cols * rows);

  // Pass 1: count unique polylines per cell
  const polylineCells: Set<number>[] = [];
  for (const pl of polylines) {
    const visited = new Set<number>();
    for (const pt of pl) {
      const col = Math.floor(pt.x / cellSize);
      const row = Math.floor(pt.y / cellSize);
      if (col < 0 || col >= cols || row < 0 || row >= rows) continue;
      const idx = row * cols + col;
      if (!visited.has(idx)) {
        visited.add(idx);
        grid[idx]++;
      }
    }
    polylineCells.push(visited);
  }

  // Pass 2: for each polyline, compute average density of cells it passes through
  const result: T[] = [];
  for (let i = 0; i < polylines.length; i++) {
    const cells = polylineCells[i];
    if (cells.size === 0) {
      result.push(polylines[i]);
      continue;
    }

    let totalDensity = 0;
    for (const idx of cells) {
      totalDensity += grid[idx];
    }
    const avgDensity = totalDensity / cells.size;

    if (avgDensity <= maxDensity) {
      result.push(polylines[i]);
    } else {
      // Probabilistically keep: higher density → lower chance
      const keepProb = maxDensity / avgDensity;
      if (Math.random() < keepProb) {
        result.push(polylines[i]);
      }
    }
  }

  return result;
}
