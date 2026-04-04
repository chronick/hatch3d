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

/// Ridged FBM — abs(noise) creates sharp peaks/ridges.
pub fn ridged_fbm2d(noise: &OpenSimplex, x: f64, y: f64, octaves: u32) -> f64 {
    let mut value = 0.0;
    let mut amp = 1.0;
    let mut freq = 1.0;
    let mut norm = 0.0;
    for _ in 0..octaves {
        let n = 1.0 - simplex2d(noise, x * freq, y * freq).abs();
        value += amp * n * n; // square for sharper ridges
        norm += amp;
        amp *= 0.5;
        freq *= 2.0;
    }
    value / norm
}

/// Curl of a scalar noise field — divergence-free flow vectors.
pub fn curl_noise(noise: &OpenSimplex, px: f64, py: f64, noise_scale: f64, octaves: u32) -> (f64, f64) {
    let eps = 1.0;
    let sx = px * noise_scale;
    let sy = py * noise_scale;
    let ens = eps * noise_scale;
    let n = fbm2d(noise, sx, sy + ens, octaves);
    let s = fbm2d(noise, sx, sy - ens, octaves);
    let e = fbm2d(noise, sx + ens, sy, octaves);
    let w = fbm2d(noise, sx - ens, sy, octaves);
    let inv = 1.0 / (2.0 * ens);
    ((n - s) * inv, -(e - w) * inv)
}

/// Curl of ridged noise field.
pub fn curl_ridged(noise: &OpenSimplex, px: f64, py: f64, noise_scale: f64, octaves: u32) -> (f64, f64) {
    let eps = 1.0;
    let sx = px * noise_scale;
    let sy = py * noise_scale;
    let ens = eps * noise_scale;
    let n = ridged_fbm2d(noise, sx, sy + ens, octaves);
    let s = ridged_fbm2d(noise, sx, sy - ens, octaves);
    let e = ridged_fbm2d(noise, sx + ens, sy, octaves);
    let w = ridged_fbm2d(noise, sx - ens, sy, octaves);
    let inv = 1.0 / (2.0 * ens);
    ((n - s) * inv, -(e - w) * inv)
}

/// Grid-based spatial hash for efficient nearest-distance queries.
pub struct SpatialHash {
    #[allow(dead_code)]
    cell_size: f64,
    inv_cell: f64,
    grid_w: usize,
    grid_h: usize,
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

// ── Shared streamline tracer ──

/// Parameters for the streamline tracer.
pub struct StreamlineParams {
    pub width: f64,
    pub height: f64,
    pub d_sep: f64,
    pub step_len: f64,
    pub max_steps: usize,
    pub min_len: usize,
    pub margin: f64,
}

/// Trace evenly-spaced streamlines through a velocity field using
/// RK2 integration and Jobard-Lefer adaptive seeding.
pub fn trace_streamlines<F>(velocity_at: F, params: &StreamlineParams) -> Vec<Vec<(f64, f64)>>
where
    F: Fn(f64, f64) -> (f64, f64),
{
    let StreamlineParams { width, height, d_sep, step_len, max_steps, min_len, margin } = *params;

    let x0 = margin;
    let y0 = margin;
    let x1 = width - margin;
    let y1 = height - margin;

    let buf = width.max(height) * 0.5;
    let tx0 = -buf;
    let ty0 = -buf;
    let tx1 = width + buf;
    let ty1 = height + buf;

    let in_trace_bounds = |x: f64, y: f64| -> bool {
        x >= tx0 && x <= tx1 && y >= ty0 && y <= ty1
    };
    let in_seed_bounds = |x: f64, y: f64| -> bool {
        x >= x0 && x <= x1 && y >= y0 && y <= y1
    };

    let hash_width = width + buf * 2.0;
    let hash_height = height + buf * 2.0;
    let mut hash = SpatialHash::new(d_sep, hash_width, hash_height);
    let hash_offset = buf;

    let trace_direction = |sx: f64, sy: f64, dir: f64, hash: &SpatialHash| -> Vec<(f64, f64)> {
        let mut pts = Vec::new();
        let mut x = sx;
        let mut y = sy;

        for step in 0..max_steps {
            if !in_trace_bounds(x, y) {
                break;
            }
            if step > 2
                && hash.nearest_distance(x + hash_offset, y + hash_offset) < d_sep * 0.5
            {
                break;
            }

            pts.push((x, y));

            // RK2 midpoint
            let (v0x, v0y) = velocity_at(x, y);
            let mag0 = (v0x * v0x + v0y * v0y).sqrt();
            if mag0 < 1e-8 {
                break;
            }

            let nx0 = (v0x / mag0) * dir;
            let ny0 = (v0y / mag0) * dir;
            let mx = x + nx0 * step_len * 0.5;
            let my = y + ny0 * step_len * 0.5;

            let (v1x, v1y) = velocity_at(mx, my);
            let mag1 = (v1x * v1x + v1y * v1y).sqrt();
            if mag1 < 1e-8 {
                break;
            }

            x += (v1x / mag1) * dir * step_len;
            y += (v1y / mag1) * dir * step_len;
        }

        pts
    };

    let mut polylines: Vec<Vec<(f64, f64)>> = Vec::new();
    let mut seed_queue: Vec<(f64, f64)> = Vec::new();

    seed_queue.push((width / 2.0, height / 2.0));

    let grid_step = d_sep * 3.0;
    let mut gy = y0;
    while gy <= y1 {
        let mut gx = x0;
        while gx <= x1 {
            seed_queue.push((gx, gy));
            gx += grid_step;
        }
        gy += grid_step;
    }

    let mut queue_idx = 0;
    while queue_idx < seed_queue.len() {
        let (sx, sy) = seed_queue[queue_idx];
        queue_idx += 1;

        if hash.nearest_distance(sx + hash_offset, sy + hash_offset) < d_sep * 0.8 {
            continue;
        }

        let forward = trace_direction(sx, sy, 1.0, &hash);
        let backward = trace_direction(sx, sy, -1.0, &hash);

        let mut combined = Vec::with_capacity(forward.len() + backward.len());
        for i in (0..backward.len()).rev() {
            combined.push(backward[i]);
        }
        let skip = if !backward.is_empty() { 1 } else { 0 };
        for i in skip..forward.len() {
            combined.push(forward[i]);
        }

        if combined.len() < min_len {
            continue;
        }

        for &(px, py) in &combined {
            hash.insert(px + hash_offset, py + hash_offset);
        }

        // Perpendicular seed candidates (Jobard-Lefer)
        let seed_interval = 4usize.max(combined.len() / 20);
        let mut i = 0;
        while i < combined.len().saturating_sub(1) {
            let p0 = combined[i];
            let p1 = combined[i + 1];
            let dx = p1.0 - p0.0;
            let dy = p1.1 - p0.1;
            let len = (dx * dx + dy * dy).sqrt();
            if len > 1e-8 {
                let px = -dy / len;
                let py = dx / len;
                let left = (p0.0 + px * d_sep, p0.1 + py * d_sep);
                let right = (p0.0 - px * d_sep, p0.1 - py * d_sep);
                if in_seed_bounds(left.0, left.1) {
                    seed_queue.push(left);
                }
                if in_seed_bounds(right.0, right.1) {
                    seed_queue.push(right);
                }
            }
            i += seed_interval;
        }

        polylines.push(combined);
    }

    polylines
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
    fn test_fbm2d() {
        let noise = OpenSimplex::new(0);
        let val = fbm2d(&noise, 0.5, 0.5, 3);
        assert!(val.is_finite());
        assert!(val >= -1.0 && val <= 1.0);
    }

    #[test]
    fn test_trace_streamlines_basic() {
        // Simple uniform field pointing right
        let velocity = |_x: f64, _y: f64| -> (f64, f64) { (1.0, 0.0) };
        let params = StreamlineParams {
            width: 200.0,
            height: 200.0,
            d_sep: 10.0,
            step_len: 3.0,
            max_steps: 100,
            min_len: 5,
            margin: 10.0,
        };
        let result = trace_streamlines(velocity, &params);
        assert!(!result.is_empty(), "should produce streamlines");
        for line in &result {
            assert!(line.len() >= 5);
        }
    }
}
