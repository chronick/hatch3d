//! Noise-driven flow field with bidirectional streamline tracing.
//!
//! ## Input protocol (8 f64s):
//! ```text
//! [width, height, noiseScale, octaves, stepLength, maxSteps, seedSpacing, minDistance]
//! ```

use noise::OpenSimplex;
use wasm_bindgen::prelude::*;

use super::common::{encode_polylines_2d, fbm2d, OccupancyGrid};

/// WASM entry point for flow field.
#[wasm_bindgen]
pub fn generate_flow_field(input: &[f64]) -> Box<[f64]> {
    if input.len() < 8 {
        return encode_polylines_2d(&[]).into_boxed_slice();
    }

    let width = input[0];
    let height = input[1];
    let noise_scale = input[2];
    let octaves = input[3] as u32;
    let step_length = input[4];
    let max_steps = input[5] as usize;
    let seed_spacing = input[6];
    let min_distance = input[7];

    let noise = OpenSimplex::new(0);
    let mut grid = OccupancyGrid::new(min_distance, width, height);
    let mut polylines: Vec<Vec<(f64, f64)>> = Vec::new();

    let in_bounds = |x: f64, y: f64| -> bool { x >= 0.0 && x < width && y >= 0.0 && y < height };

    let cols = (width / seed_spacing).floor() as usize;
    let rows = (height / seed_spacing).floor() as usize;

    for row in 0..rows {
        for col in 0..cols {
            let sx = (col as f64 + 0.5) * seed_spacing;
            let sy = (row as f64 + 0.5) * seed_spacing;

            if grid.is_occupied(sx, sy) {
                continue;
            }

            // Trace forward
            let forward = trace_direction(
                sx, sy, 1.0, max_steps, step_length, noise_scale, octaves,
                &noise, &mut grid, width, height, &in_bounds,
            );
            // Trace backward
            let backward = trace_direction(
                sx, sy, -1.0, max_steps, step_length, noise_scale, octaves,
                &noise, &mut grid, width, height, &in_bounds,
            );

            // Combine: reverse backward + forward (skip duplicate seed)
            let mut combined = Vec::with_capacity(forward.len() + backward.len());
            for i in (0..backward.len()).rev() {
                combined.push(backward[i]);
            }
            let skip = if !backward.is_empty() { 1 } else { 0 };
            for i in skip..forward.len() {
                combined.push(forward[i]);
            }

            if combined.len() >= 3 {
                polylines.push(combined);
            }
        }
    }

    encode_polylines_2d(&polylines).into_boxed_slice()
}

fn trace_direction(
    start_x: f64,
    start_y: f64,
    direction: f64,
    max_steps: usize,
    step_length: f64,
    noise_scale: f64,
    octaves: u32,
    noise: &OpenSimplex,
    grid: &mut OccupancyGrid,
    _width: f64,
    _height: f64,
    in_bounds: &dyn Fn(f64, f64) -> bool,
) -> Vec<(f64, f64)> {
    let mut pts = Vec::new();
    let mut x = start_x;
    let mut y = start_y;

    for step in 0..max_steps {
        if !in_bounds(x, y) {
            break;
        }
        if step > 2 && grid.is_occupied(x, y) {
            break;
        }

        pts.push((x, y));
        grid.mark(x, y);

        let angle = fbm2d(noise, x * noise_scale, y * noise_scale, octaves)
            * std::f64::consts::PI
            * 2.0
            * direction;
        x += angle.cos() * step_length;
        y += angle.sin() * step_length;
    }

    pts
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_basic_flow_field() {
        let input = vec![
            400.0, // width
            300.0, // height
            0.004, // noiseScale
            2.0,   // octaves
            3.0,   // stepLength
            100.0, // maxSteps
            20.0,  // seedSpacing
            10.0,  // minDistance
        ];
        let result = generate_flow_field(&input);
        assert!(result.len() >= 1);
        let num_polylines = result[0] as usize;
        assert!(num_polylines > 0, "should produce some streamlines");

        // Validate output format
        let mut pos = 1;
        for _ in 0..num_polylines {
            let num_pts = result[pos] as usize;
            pos += 1;
            assert!(num_pts >= 3, "each polyline should have >= 3 points");
            for i in 0..num_pts * 2 {
                assert!(result[pos + i].is_finite());
            }
            pos += num_pts * 2;
        }
        assert_eq!(pos, result.len());
    }

    #[test]
    fn test_empty_input() {
        let result = generate_flow_field(&[]);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0], 0.0);
    }
}
