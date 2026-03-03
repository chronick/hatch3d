//! Shared utilities for 2D composition WASM entry points.
//!
//! ## 2D Output protocol:
//! ```text
//! [num_polylines, num_pts_1, x, y, x, y, ..., num_pts_2, x, y, ...]
//! ```

use noise::{NoiseFn, OpenSimplex};

/// Encode 2D polylines into a flat f64 array.
///
/// Format: `[num_polylines, num_pts_1, x1, y1, x2, y2, ..., num_pts_2, ...]`
pub fn encode_polylines_2d(polylines: &[Vec<(f64, f64)>]) -> Vec<f64> {
    let total_pts: usize = polylines.iter().map(|pl| pl.len()).sum();
    let mut out = Vec::with_capacity(1 + polylines.len() + total_pts * 2);
    out.push(polylines.len() as f64);
    for pl in polylines {
        out.push(pl.len() as f64);
        for &(x, y) in pl {
            out.push(x);
            out.push(y);
        }
    }
    out
}

/// 2D OpenSimplex noise evaluation (seed 0).
pub fn simplex2d(noise: &OpenSimplex, x: f64, y: f64) -> f64 {
    noise.get([x, y])
}

/// Fractal Brownian motion using OpenSimplex.
pub fn fbm2d(noise: &OpenSimplex, x: f64, y: f64, octaves: u32) -> f64 {
    let mut value = 0.0;
    let mut amp = 1.0;
    let mut freq = 1.0;
    let mut norm = 0.0;
    for _ in 0..octaves {
        value += amp * simplex2d(noise, x * freq, y * freq);
        norm += amp;
        amp *= 0.5;
        freq *= 2.0;
    }
    value / norm
}

/// Grid-based spatial hash for efficient nearest-distance queries.
pub struct SpatialHash {
    #[allow(dead_code)]
    cell_size: f64,
    inv_cell: f64,
    grid_w: usize,
    grid_h: usize,
    // Flat grid of cell-start indices + counts into a points array
    cells: Vec<Vec<(f64, f64)>>,
}

impl SpatialHash {
    pub fn new(cell_size: f64, width: f64, height: f64) -> Self {
        let grid_w = (width / cell_size).ceil() as usize + 1;
        let grid_h = (height / cell_size).ceil() as usize + 1;
        Self {
            cell_size,
            inv_cell: 1.0 / cell_size,
            grid_w,
            grid_h,
            cells: vec![Vec::new(); grid_w * grid_h],
        }
    }

    fn cell_idx(&self, x: f64, y: f64) -> Option<usize> {
        let gx = (x * self.inv_cell).floor() as isize;
        let gy = (y * self.inv_cell).floor() as isize;
        if gx >= 0 && (gx as usize) < self.grid_w && gy >= 0 && (gy as usize) < self.grid_h {
            Some(gy as usize * self.grid_w + gx as usize)
        } else {
            None
        }
    }

    pub fn insert(&mut self, x: f64, y: f64) {
        if let Some(idx) = self.cell_idx(x, y) {
            self.cells[idx].push((x, y));
        }
    }

    pub fn nearest_distance(&self, x: f64, y: f64) -> f64 {
        let gx = (x * self.inv_cell).floor() as isize;
        let gy = (y * self.inv_cell).floor() as isize;
        let mut best = f64::INFINITY;
        for dy in -2..=2isize {
            for dx in -2..=2isize {
                let nx = gx + dx;
                let ny = gy + dy;
                if nx < 0 || nx as usize >= self.grid_w || ny < 0 || ny as usize >= self.grid_h {
                    continue;
                }
                let idx = ny as usize * self.grid_w + nx as usize;
                for &(px, py) in &self.cells[idx] {
                    let d = ((px - x) * (px - x) + (py - y) * (py - y)).sqrt();
                    if d < best {
                        best = d;
                    }
                }
            }
        }
        best
    }
}

/// Simple occupancy grid (one bit per cell, 3x3 neighborhood check).
pub struct OccupancyGrid {
    grid_w: usize,
    grid_h: usize,
    cell_size: f64,
    cells: Vec<u8>,
}

impl OccupancyGrid {
    pub fn new(cell_size: f64, width: f64, height: f64) -> Self {
        let grid_w = (width / cell_size).ceil() as usize + 1;
        let grid_h = (height / cell_size).ceil() as usize + 1;
        Self {
            grid_w,
            grid_h,
            cell_size,
            cells: vec![0; grid_w * grid_h],
        }
    }

    pub fn is_occupied(&self, x: f64, y: f64) -> bool {
        let gx = (x / self.cell_size).floor() as isize;
        let gy = (y / self.cell_size).floor() as isize;
        for dy in -1..=1isize {
            for dx in -1..=1isize {
                let nx = gx + dx;
                let ny = gy + dy;
                if nx >= 0
                    && (nx as usize) < self.grid_w
                    && ny >= 0
                    && (ny as usize) < self.grid_h
                {
                    if self.cells[ny as usize * self.grid_w + nx as usize] != 0 {
                        return true;
                    }
                }
            }
        }
        false
    }

    pub fn mark(&mut self, x: f64, y: f64) {
        let gx = (x / self.cell_size).floor() as isize;
        let gy = (y / self.cell_size).floor() as isize;
        if gx >= 0
            && (gx as usize) < self.grid_w
            && gy >= 0
            && (gy as usize) < self.grid_h
        {
            self.cells[gy as usize * self.grid_w + gx as usize] = 1;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_encode_polylines_2d() {
        let polylines = vec![
            vec![(1.0, 2.0), (3.0, 4.0)],
            vec![(5.0, 6.0), (7.0, 8.0), (9.0, 10.0)],
        ];
        let encoded = encode_polylines_2d(&polylines);
        assert_eq!(encoded[0], 2.0); // num_polylines
        assert_eq!(encoded[1], 2.0); // first polyline: 2 points
        assert_eq!(encoded[2], 1.0); // x
        assert_eq!(encoded[3], 2.0); // y
        assert_eq!(encoded[6], 3.0); // second polyline: 3 points
        assert_eq!(encoded.len(), 1 + 2 + 2 * 2 + 3 * 2); // header + counts + coords
    }

    #[test]
    fn test_spatial_hash() {
        let mut hash = SpatialHash::new(10.0, 100.0, 100.0);
        hash.insert(50.0, 50.0);
        assert!(hash.nearest_distance(50.0, 50.0) < 0.001);
        assert!((hash.nearest_distance(60.0, 50.0) - 10.0).abs() < 0.001);
        assert_eq!(hash.nearest_distance(0.0, 0.0), f64::INFINITY);
    }

    #[test]
    fn test_occupancy_grid() {
        let mut grid = OccupancyGrid::new(10.0, 100.0, 100.0);
        assert!(!grid.is_occupied(50.0, 50.0));
        grid.mark(50.0, 50.0);
        assert!(grid.is_occupied(50.0, 50.0));
        assert!(grid.is_occupied(55.0, 55.0)); // within 3x3 neighborhood
    }

    #[test]
    fn test_fbm2d() {
        let noise = OpenSimplex::new(0);
        let val = fbm2d(&noise, 0.5, 0.5, 3);
        assert!(val.is_finite());
        assert!(val >= -1.0 && val <= 1.0);
    }
}
