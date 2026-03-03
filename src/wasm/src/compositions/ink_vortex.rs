//! Fluid dynamics streamlines via point vortex fields (Biot-Savart law)
//! with Jobard-Lefer evenly-spaced seeding.
//!
//! ## Input protocol (13 f64s):
//! ```text
//! [width, height, arrangementId, vortexCount, circulationRange, epsilon,
//!  separation, stepLength, maxSteps, minLength, curlNoise, noiseScale, margin]
//! ```
//! arrangementId: 0=random, 1=ring, 2=dipole, 3=karman, 4=galaxy

use noise::OpenSimplex;
use wasm_bindgen::prelude::*;

use super::common::{encode_polylines_2d, simplex2d, SpatialHash};

struct Vortex {
    x: f64,
    y: f64,
    gamma: f64,
}

fn generate_vortices(
    arrangement: u32,
    count: usize,
    circulation_range: f64,
    width: f64,
    height: f64,
) -> Vec<Vortex> {
    let cx = width / 2.0;
    let cy = height / 2.0;
    let rx = width * 0.4;
    let ry = height * 0.4;
    let pi2 = std::f64::consts::PI * 2.0;

    match arrangement {
        1 => {
            // Ring
            (0..count)
                .map(|i| {
                    let angle = (i as f64 / count as f64) * pi2;
                    let sign = if i % 2 == 0 { 1.0 } else { -1.0 };
                    Vortex {
                        x: cx + angle.cos() * rx,
                        y: cy + angle.sin() * ry,
                        gamma: sign * circulation_range,
                    }
                })
                .collect()
        }
        2 => {
            // Dipole
            let gap = rx * 0.4;
            vec![
                Vortex { x: cx - gap, y: cy, gamma: circulation_range },
                Vortex { x: cx + gap, y: cy, gamma: -circulation_range },
            ]
        }
        3 => {
            // Kármán street
            let row_gap = height * 0.3;
            let cols = ((count + 1) / 2) + 1;
            let spacing = width / cols as f64;
            (0..count)
                .map(|i| {
                    let row = i % 2;
                    let col = i / 2;
                    Vortex {
                        x: spacing * (col as f64 + 1.0) + if row == 1 { spacing * 0.5 } else { 0.0 },
                        y: cy + if row == 0 { -row_gap } else { row_gap },
                        gamma: if row == 0 { 1.0 } else { -1.0 } * circulation_range,
                    }
                })
                .collect()
        }
        4 => {
            // Galaxy
            let pi4 = std::f64::consts::PI * 4.0;
            (0..count)
                .map(|i| {
                    let t = i as f64 / count as f64;
                    let angle = t * pi4;
                    let r_frac = 0.1 + t * 0.9;
                    Vortex {
                        x: cx + angle.cos() * rx * r_frac,
                        y: cy + angle.sin() * ry * r_frac,
                        gamma: circulation_range * (1.0 - t * 0.6) * if i % 2 == 0 { 1.0 } else { -0.5 },
                    }
                })
                .collect()
        }
        _ => {
            // Random (deterministic sin-hash, matches JS)
            (0..count)
                .map(|i| {
                    let h1 = (i as f64 * 127.1 + 311.7).sin() * 43758.5453;
                    let h2 = (i as f64 * 269.5 + 183.3).sin() * 43758.5453;
                    let h3 = (i as f64 * 419.2 + 371.9).sin() * 43758.5453;
                    let px = (h1 - h1.floor()) * width * 0.9 + width * 0.05;
                    let py = (h2 - h2.floor()) * height * 0.9 + height * 0.05;
                    let frac3 = h3 - h3.floor();
                    let sign = if frac3 > 0.5 { 1.0 } else { -1.0 };
                    Vortex {
                        x: px,
                        y: py,
                        gamma: sign * circulation_range * (0.5 + frac3 * 0.5),
                    }
                })
                .collect()
        }
    }
}

/// WASM entry point for ink vortex.
#[wasm_bindgen]
pub fn generate_ink_vortex(input: &[f64]) -> Box<[f64]> {
    if input.len() < 13 {
        return encode_polylines_2d(&[]).into_boxed_slice();
    }

    let width = input[0];
    let height = input[1];
    let arrangement_id = input[2] as u32;
    let vortex_count = input[3] as usize;
    let circulation_range = input[4];
    let epsilon = input[5];
    let d_sep = input[6];
    let step_len = input[7];
    let max_steps = input[8] as usize;
    let min_len = input[9] as usize;
    let curl_noise = input[10];
    let noise_scale = input[11];
    let margin = input[12];

    let x0 = margin;
    let y0 = margin;
    let x1 = width - margin;
    let y1 = height - margin;

    // Extended trace region
    let buf = width.max(height) * 0.5;
    let tx0 = -buf;
    let ty0 = -buf;
    let tx1 = width + buf;
    let ty1 = height + buf;

    let vortices = generate_vortices(arrangement_id, vortex_count, circulation_range, width, height);

    let noise = if curl_noise > 0.0 {
        Some(OpenSimplex::new(0))
    } else {
        None
    };

    let epsilon_sq = epsilon * epsilon;
    let two_pi = std::f64::consts::PI * 2.0;

    // Velocity function: Biot-Savart + optional curl noise
    let velocity_at = |px: f64, py: f64| -> (f64, f64) {
        let mut vx = 0.0;
        let mut vy = 0.0;

        for v in &vortices {
            let dx = px - v.x;
            let dy = py - v.y;
            let r2 = dx * dx + dy * dy + epsilon_sq;
            let factor = v.gamma / (two_pi * r2);
            vx += -dy * factor;
            vy += dx * factor;
        }

        if curl_noise > 0.0 {
            if let Some(ref n) = noise {
                let eps_curl = 1.0;
                let nn = simplex2d(n, px * noise_scale, (py + eps_curl) * noise_scale);
                let ns = simplex2d(n, px * noise_scale, (py - eps_curl) * noise_scale);
                let ne = simplex2d(n, (px + eps_curl) * noise_scale, py * noise_scale);
                let nw = simplex2d(n, (px - eps_curl) * noise_scale, py * noise_scale);
                let cnx = (nn - ns) / (2.0 * eps_curl);
                let cny = -(ne - nw) / (2.0 * eps_curl);
                vx = vx * (1.0 - curl_noise) + cnx * curl_noise;
                vy = vy * (1.0 - curl_noise) + cny * curl_noise;
            }
        }

        (vx, vy)
    };

    // Spatial hash for streamline distance queries
    // Extended region for the spatial hash to handle trace overflow
    let hash_width = width + buf * 2.0;
    let hash_height = height + buf * 2.0;
    let mut hash = SpatialHash::new(d_sep, hash_width, hash_height);

    // Offset to convert from trace coords to hash coords (shift by buf)
    let hash_offset = buf;

    let in_trace_bounds = |x: f64, y: f64| -> bool {
        x >= tx0 && x <= tx1 && y >= ty0 && y <= ty1
    };

    let in_seed_bounds = |x: f64, y: f64| -> bool { x >= x0 && x <= x1 && y >= y0 && y <= y1 };

    // RK2 trace in one direction
    let trace_direction = |sx: f64, sy: f64, dir: f64, hash: &SpatialHash| -> Vec<(f64, f64)> {
        let mut pts = Vec::new();
        let mut x = sx;
        let mut y = sy;

        for step in 0..max_steps {
            if !in_trace_bounds(x, y) {
                break;
            }
            if step > 2 && hash.nearest_distance(x + hash_offset, y + hash_offset) < d_sep * 0.5 {
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

    // Seed queue
    let mut seed_queue: Vec<(f64, f64)> = Vec::new();
    seed_queue.push((width / 2.0, height / 2.0));

    // Dense grid seeds for full-page coverage
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

        // Register points in spatial hash
        for &(px, py) in &combined {
            hash.insert(px + hash_offset, py + hash_offset);
        }

        // Generate perpendicular seed candidates (Jobard-Lefer)
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

    encode_polylines_2d(&polylines).into_boxed_slice()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_basic_ink_vortex() {
        let input = vec![
            800.0, // width
            600.0, // height
            0.0,   // arrangement = random
            6.0,   // vortexCount
            1.0,   // circulationRange
            30.0,  // epsilon
            8.0,   // separation
            3.0,   // stepLength
            200.0, // maxSteps
            10.0,  // minLength
            0.0,   // curlNoise (off)
            0.005, // noiseScale
            20.0,  // margin
        ];
        let result = generate_ink_vortex(&input);
        assert!(result.len() >= 1);
        let num_polylines = result[0] as usize;
        assert!(num_polylines > 0, "should produce streamlines");

        // Validate format
        let mut pos = 1;
        for _ in 0..num_polylines {
            let num_pts = result[pos] as usize;
            pos += 1;
            for i in 0..num_pts * 2 {
                assert!(result[pos + i].is_finite());
            }
            pos += num_pts * 2;
        }
        assert_eq!(pos, result.len());
    }

    #[test]
    fn test_all_arrangements() {
        for arr in 0..5 {
            let input = vec![
                400.0, 300.0, arr as f64, 4.0, 1.0, 30.0, 12.0, 3.0, 100.0, 5.0, 0.0, 0.005, 10.0,
            ];
            let result = generate_ink_vortex(&input);
            assert!(result.len() >= 1);
            for &v in result.iter() {
                assert!(v.is_finite(), "arrangement {arr}: non-finite value");
            }
        }
    }

    #[test]
    fn test_with_curl_noise() {
        let input = vec![
            400.0, 300.0, 0.0, 4.0, 1.0, 30.0, 12.0, 3.0, 100.0, 5.0,
            0.5,   // curlNoise enabled
            0.005, 10.0,
        ];
        let result = generate_ink_vortex(&input);
        assert!(result.len() >= 1);
        let num_polylines = result[0] as usize;
        assert!(num_polylines > 0);
    }

    #[test]
    fn test_empty_input() {
        let result = generate_ink_vortex(&[]);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0], 0.0);
    }
}
