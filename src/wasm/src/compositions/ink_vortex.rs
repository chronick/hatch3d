//! Fluid dynamics streamlines via point vortex fields (Biot-Savart law)
//! with shared streamline tracer.
//!
//! ## Input protocol (13 f64s):
//! ```text
//! [width, height, arrangementId, vortexCount, circulationRange, epsilon,
//!  separation, stepLength, maxSteps, minLength, curlNoise, noiseScale, margin]
//! ```
//! arrangementId: 0=random, 1=ring, 2=dipole, 3=karman, 4=galaxy

use noise::OpenSimplex;
use wasm_bindgen::prelude::*;

use super::common::{
    encode_polylines_2d, simplex2d, trace_streamlines, StreamlineParams,
};

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
    let curl_noise_amt = input[10];
    let noise_scale = input[11];
    let margin = input[12];

    let vortices = generate_vortices(arrangement_id, vortex_count, circulation_range, width, height);
    let epsilon_sq = epsilon * epsilon;
    let two_pi = std::f64::consts::PI * 2.0;

    let noise = if curl_noise_amt > 0.0 {
        Some(OpenSimplex::new(0))
    } else {
        None
    };

    let velocity_at = move |px: f64, py: f64| -> (f64, f64) {
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

        if curl_noise_amt > 0.0 {
            if let Some(ref n) = noise {
                let eps_curl = 1.0;
                let nn = simplex2d(n, px * noise_scale, (py + eps_curl) * noise_scale);
                let ns = simplex2d(n, px * noise_scale, (py - eps_curl) * noise_scale);
                let ne = simplex2d(n, (px + eps_curl) * noise_scale, py * noise_scale);
                let nw = simplex2d(n, (px - eps_curl) * noise_scale, py * noise_scale);
                let cnx = (nn - ns) / (2.0 * eps_curl);
                let cny = -(ne - nw) / (2.0 * eps_curl);
                vx = vx * (1.0 - curl_noise_amt) + cnx * curl_noise_amt;
                vy = vy * (1.0 - curl_noise_amt) + cny * curl_noise_amt;
            }
        }

        (vx, vy)
    };

    let params = StreamlineParams {
        width,
        height,
        d_sep,
        step_len,
        max_steps,
        min_len,
        margin,
    };

    let polylines = trace_streamlines(velocity_at, &params);
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
