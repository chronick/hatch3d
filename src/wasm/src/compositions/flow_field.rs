//! Noise-driven flow field with domain warping, ridged noise, and multiple
//! field morphologies. Uses shared streamline tracer.
//!
//! ## Input protocol (13 f64s):
//! ```text
//! [width, height, morphologyId, noiseScale, octaves, warpAmount, noiseBlend,
//!  uniformAngle, separation, stepLength, maxSteps, minLength, margin]
//! ```
//! morphologyId: 0=warp, 1=ridged, 2=curl, 3=radial, 4=spiral, 5=uniform

use noise::OpenSimplex;
use wasm_bindgen::prelude::*;

use super::common::{
    curl_noise, curl_ridged, encode_polylines_2d, fbm2d, trace_streamlines, StreamlineParams,
};

/// Domain-warped curl noise velocity.
fn domain_warp_velocity(
    noise: &OpenSimplex,
    px: f64,
    py: f64,
    noise_scale: f64,
    octaves: u32,
    warp_amount: f64,
) -> (f64, f64) {
    let wx = px
        + fbm2d(
            noise,
            px * noise_scale + 5.2,
            py * noise_scale + 1.3,
            octaves,
        ) * warp_amount;
    let wy = py
        + fbm2d(
            noise,
            px * noise_scale + 9.7,
            py * noise_scale + 2.8,
            octaves,
        ) * warp_amount;
    curl_noise(noise, wx, wy, noise_scale, octaves)
}

/// WASM entry point for flow field.
#[wasm_bindgen]
pub fn generate_flow_field(input: &[f64]) -> Box<[f64]> {
    if input.len() < 13 {
        return encode_polylines_2d(&[]).into_boxed_slice();
    }

    let width = input[0];
    let height = input[1];
    let morphology = input[2] as u32; // 0=warp, 1=ridged, 2=curl, 3=radial, 4=spiral, 5=uniform
    let noise_scale = input[3];
    let octaves = input[4] as u32;
    let warp_amount = input[5];
    let noise_blend = input[6];
    let uniform_angle = input[7]; // already in radians
    let d_sep = input[8];
    let step_len = input[9];
    let max_steps = input[10] as usize;
    let min_len = input[11] as usize;
    let margin = input[12];

    let cx = width / 2.0;
    let cy = height / 2.0;
    let noise = OpenSimplex::new(0);
    let ux = uniform_angle.cos();
    let uy = uniform_angle.sin();

    let velocity_at = move |px: f64, py: f64| -> (f64, f64) {
        match morphology {
            0 => {
                // Domain warp
                domain_warp_velocity(&noise, px, py, noise_scale, octaves, warp_amount)
            }
            1 => {
                // Ridged
                curl_ridged(&noise, px, py, noise_scale, octaves)
            }
            2 => {
                // Curl noise
                curl_noise(&noise, px, py, noise_scale, octaves)
            }
            3 => {
                // Radial + noise blend
                let dx = px - cx;
                let dy = py - cy;
                let r = (dx * dx + dy * dy).sqrt() + 1e-8;
                let twist = 0.6;
                let bx = (dx / r) * (1.0 - twist) + (-dy / r) * twist;
                let by = (dy / r) * (1.0 - twist) + (dx / r) * twist;
                let (nx, ny) = curl_noise(&noise, px, py, noise_scale, octaves);
                (
                    bx * (1.0 - noise_blend) + nx * noise_blend,
                    by * (1.0 - noise_blend) + ny * noise_blend,
                )
            }
            4 => {
                // Spiral + noise blend
                let dx = px - cx;
                let dy = py - cy;
                let r = (dx * dx + dy * dy).sqrt() + 1e-8;
                let tightness = 0.3;
                let bx = -dy / r + (-dx / r) * tightness;
                let by = dx / r + (-dy / r) * tightness;
                let (nx, ny) = curl_noise(&noise, px, py, noise_scale, octaves);
                (
                    bx * (1.0 - noise_blend) + nx * noise_blend,
                    by * (1.0 - noise_blend) + ny * noise_blend,
                )
            }
            _ => {
                // Uniform + noise blend
                let (nx, ny) = curl_noise(&noise, px, py, noise_scale, octaves);
                (
                    ux * (1.0 - noise_blend) + nx * noise_blend,
                    uy * (1.0 - noise_blend) + ny * noise_blend,
                )
            }
        }
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
    fn test_basic_flow_field() {
        let input = vec![
            400.0, // width
            300.0, // height
            0.0,   // morphology = warp
            0.003, // noiseScale
            3.0,   // octaves
            200.0, // warpAmount
            0.5,   // noiseBlend
            0.0,   // uniformAngle
            7.0,   // separation
            3.0,   // stepLength
            400.0, // maxSteps
            15.0,  // minLength
            20.0,  // margin
        ];
        let result = generate_flow_field(&input);
        assert!(result.len() >= 1);
        let num_polylines = result[0] as usize;
        assert!(num_polylines > 0, "should produce some streamlines");

        let mut pos = 1;
        for _ in 0..num_polylines {
            let num_pts = result[pos] as usize;
            pos += 1;
            assert!(
                num_pts >= 15,
                "each polyline should have >= minLength points"
            );
            for i in 0..num_pts * 2 {
                assert!(result[pos + i].is_finite());
            }
            pos += num_pts * 2;
        }
        assert_eq!(pos, result.len());
    }

    #[test]
    fn test_all_morphologies() {
        for morph in 0..6 {
            let input = vec![
                400.0, 300.0, morph as f64, 0.003, 3.0, 200.0, 0.5, 0.0, 10.0, 3.0, 200.0, 10.0,
                20.0,
            ];
            let result = generate_flow_field(&input);
            assert!(result.len() >= 1);
            for &v in result.iter() {
                assert!(v.is_finite(), "morphology {morph}: non-finite value");
            }
        }
    }

    #[test]
    fn test_empty_input() {
        let result = generate_flow_field(&[]);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0], 0.0);
    }
}
