//! hatch3d-wasm: Rust/WASM accelerated surface evaluation + hatch generation.
//!
//! Exports a single `generate_all_layers` function that takes a flat f64 array
//! encoding all layer configs and returns a flat f64 array of 3D polylines.
//!
//! ## Input protocol (23 f64s per layer):
//! ```text
//! [num_layers, ...per_layer × 23 fields]
//! Fields: surface_id, param0-3, family, count, samples,
//!         u_min, u_max, v_min, v_max, angle, wave_amp, wave_freq,
//!         noise_amp, noise_freq, dash_len, gap_len, dash_random,
//!         tx, ty, tz
//! ```
//!
//! ## Output protocol:
//! ```text
//! [num_layers, per_layer: [num_polylines, per_polyline: [num_points, x,y,z, ...]]]
//! ```

mod hatch;
mod noise;
mod surfaces;

use wasm_bindgen::prelude::*;

use hatch::{generate_hatch_lines, HatchConfig};

const FIELDS_PER_LAYER: usize = 23;

/// Parse a single layer config from the input slice starting at `offset`.
fn parse_layer_config(input: &[f64], offset: usize) -> HatchConfig {
    HatchConfig {
        surface_id: input[offset] as u32,
        params: [
            input[offset + 1],
            input[offset + 2],
            input[offset + 3],
            input[offset + 4],
        ],
        family: input[offset + 5] as u32,
        count: input[offset + 6] as u32,
        samples: input[offset + 7] as u32,
        u_min: input[offset + 8],
        u_max: input[offset + 9],
        v_min: input[offset + 10],
        v_max: input[offset + 11],
        angle: input[offset + 12],
        wave_amp: input[offset + 13],
        wave_freq: input[offset + 14],
        noise_amp: input[offset + 15],
        noise_freq: input[offset + 16],
        dash_len: input[offset + 17],
        gap_len: input[offset + 18],
        dash_random: input[offset + 19],
        tx: input[offset + 20],
        ty: input[offset + 21],
        tz: input[offset + 22],
    }
}

/// Main entry point: generate all layers in a single WASM call.
///
/// Input: flat f64 slice following the input protocol above.
/// Output: flat f64 slice following the output protocol above.
#[wasm_bindgen]
pub fn generate_all_layers(input: &[f64]) -> Box<[f64]> {
    if input.is_empty() {
        return Box::new([0.0]);
    }

    let num_layers = input[0] as usize;
    let expected_len = 1 + num_layers * FIELDS_PER_LAYER;
    if input.len() < expected_len {
        return Box::new([0.0]);
    }

    // Pre-estimate output size: header + typical polyline data
    let mut output = Vec::with_capacity(1 + num_layers * 1024);
    output.push(num_layers as f64);

    for layer_idx in 0..num_layers {
        let offset = 1 + layer_idx * FIELDS_PER_LAYER;
        let cfg = parse_layer_config(input, offset);
        let polylines = generate_hatch_lines(&cfg);

        output.push(polylines.len() as f64);
        for line in &polylines {
            output.push(line.len() as f64);
            for &(x, y, z) in line {
                output.push(x);
                output.push(y);
                output.push(z);
            }
        }
    }

    output.into_boxed_slice()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_input(layers: &[HatchConfig]) -> Vec<f64> {
        let mut input = vec![layers.len() as f64];
        for cfg in layers {
            input.push(cfg.surface_id as f64);
            input.push(cfg.params[0]);
            input.push(cfg.params[1]);
            input.push(cfg.params[2]);
            input.push(cfg.params[3]);
            input.push(cfg.family as f64);
            input.push(cfg.count as f64);
            input.push(cfg.samples as f64);
            input.push(cfg.u_min);
            input.push(cfg.u_max);
            input.push(cfg.v_min);
            input.push(cfg.v_max);
            input.push(cfg.angle);
            input.push(cfg.wave_amp);
            input.push(cfg.wave_freq);
            input.push(cfg.noise_amp);
            input.push(cfg.noise_freq);
            input.push(cfg.dash_len);
            input.push(cfg.gap_len);
            input.push(cfg.dash_random);
            input.push(cfg.tx);
            input.push(cfg.ty);
            input.push(cfg.tz);
        }
        input
    }

    #[test]
    fn test_empty_input() {
        let result = generate_all_layers(&[]);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0], 0.0);
    }

    #[test]
    fn test_single_layer_roundtrip() {
        let cfg = HatchConfig {
            surface_id: 0,
            params: [2.0, 1.2, 4.0, 0.3],
            family: 0,
            count: 5,
            samples: 10,
            u_min: 0.0,
            u_max: 1.0,
            v_min: 0.0,
            v_max: 1.0,
            angle: 0.0,
            wave_amp: 0.0,
            wave_freq: 0.0,
            noise_amp: 0.0,
            noise_freq: 0.0,
            dash_len: 0.0,
            gap_len: 0.0,
            dash_random: 0.0,
            tx: 0.0,
            ty: 0.0,
            tz: 0.0,
        };

        let input = make_input(&[cfg]);
        let output = generate_all_layers(&input);

        // Parse output
        assert!(output.len() > 1);
        let num_layers = output[0] as usize;
        assert_eq!(num_layers, 1);

        let num_polylines = output[1] as usize;
        assert_eq!(num_polylines, 5);

        // Verify first polyline has expected number of points
        let num_points = output[2] as usize;
        assert_eq!(num_points, 11); // samples + 1
    }

    #[test]
    fn test_multi_layer_output_structure() {
        let cfg1 = HatchConfig {
            surface_id: 0,
            params: [2.0, 1.2, 4.0, 0.3],
            family: 0,
            count: 3,
            samples: 5,
            u_min: 0.0, u_max: 1.0,
            v_min: 0.0, v_max: 1.0,
            angle: 0.0,
            wave_amp: 0.0, wave_freq: 0.0,
            noise_amp: 0.0, noise_freq: 0.0,
            dash_len: 0.0, gap_len: 0.0, dash_random: 0.0,
            tx: 0.0, ty: 0.0, tz: 0.0,
        };
        let cfg2 = HatchConfig {
            surface_id: 1,
            family: 1,
            count: 2,
            samples: 4,
            ..cfg1.clone()
        };

        let input = make_input(&[cfg1, cfg2]);
        let output = generate_all_layers(&input);

        let num_layers = output[0] as usize;
        assert_eq!(num_layers, 2);

        // Walk the output to verify structure
        let mut pos = 1;
        for _layer in 0..num_layers {
            let num_polylines = output[pos] as usize;
            pos += 1;
            for _pl in 0..num_polylines {
                let num_points = output[pos] as usize;
                pos += 1;
                pos += num_points * 3; // x, y, z per point
            }
        }
        assert_eq!(pos, output.len(), "output should be fully consumed");
    }

    #[test]
    fn test_all_surfaces_all_families() {
        for surface_id in 0..5u32 {
            for family in 0..8u32 {
                let cfg = HatchConfig {
                    surface_id,
                    params: [1.0, 1.0, 1.0, 0.0],
                    family,
                    count: 5,
                    samples: 10,
                    u_min: 0.0, u_max: 1.0,
                    v_min: 0.0, v_max: 1.0,
                    angle: 0.5,
                    wave_amp: 0.05, wave_freq: 6.0,
                    noise_amp: 0.0, noise_freq: 0.0,
                    dash_len: 0.0, gap_len: 0.0, dash_random: 0.0,
                    tx: 0.0, ty: 0.0, tz: 0.0,
                };
                let input = make_input(&[cfg]);
                let output = generate_all_layers(&input);
                assert!(output[0] as usize == 1, "surface {surface_id} family {family}");

                // Verify all values are finite
                for &v in output.iter() {
                    assert!(v.is_finite(), "surface {surface_id} family {family}: non-finite value");
                }
            }
        }
    }
}
