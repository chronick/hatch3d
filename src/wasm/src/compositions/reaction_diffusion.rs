//! Gray-Scott reaction-diffusion simulation with marching squares contour extraction.
//!
//! ## Input protocol (11 f64s):
//! ```text
//! [width, height, N, iterations, f, k, dA, dB, threshold, levels, seedPatternId]
//! ```
//! seedPatternId: 0=center, 1=random, 2=ring, 3=line

use wasm_bindgen::prelude::*;
use super::common::encode_polylines_2d;

/// Seed pattern: center blob
fn seed_center(u: &mut [f64], v: &mut [f64], n: usize) {
    let cx = n as f64 / 2.0;
    let cy = n as f64 / 2.0;
    let r = n as f64 * 0.08;
    let r2 = r * r;
    for y in 0..n {
        for x in 0..n {
            let dx = x as f64 - cx;
            let dy = y as f64 - cy;
            if dx * dx + dy * dy < r2 {
                let idx = y * n + x;
                u[idx] = 0.5;
                v[idx] = 0.25;
            }
        }
    }
}

/// Seed pattern: deterministic pseudo-random spots
fn seed_random(u: &mut [f64], v: &mut [f64], n: usize) {
    let spots = (n as f64 * 0.05).floor().max(3.0) as usize;
    let r = n as f64 * 0.04;
    let r2 = r * r;
    let ri = r.ceil() as isize;

    for s in 0..spots {
        // Deterministic pseudo-random using sin-hash (matches JS)
        let h1 = (s as f64 * 127.1 + 311.7).sin() * 43758.5453;
        let h2 = (s as f64 * 269.5 + 183.3).sin() * 43758.5453;
        let sx = (n as f64 * 0.1 + (h1 - h1.floor()) * n as f64 * 0.8).floor() as isize;
        let sy = (n as f64 * 0.1 + (h2 - h2.floor()) * n as f64 * 0.8).floor() as isize;

        for dy in -ri..=ri {
            for dx in -ri..=ri {
                let x = sx + dx;
                let y = sy + dy;
                if x >= 0 && x < n as isize && y >= 0 && y < n as isize {
                    if (dx * dx + dy * dy) < r2 as isize {
                        let idx = y as usize * n + x as usize;
                        u[idx] = 0.5;
                        v[idx] = 0.25;
                    }
                }
            }
        }
    }
}

/// Seed pattern: ring
fn seed_ring(u: &mut [f64], v: &mut [f64], n: usize) {
    let cx = n as f64 / 2.0;
    let cy = n as f64 / 2.0;
    let r1 = n as f64 * 0.2;
    let r2 = n as f64 * 0.25;
    for y in 0..n {
        for x in 0..n {
            let d = ((x as f64 - cx).powi(2) + (y as f64 - cy).powi(2)).sqrt();
            if d > r1 && d < r2 {
                let idx = y * n + x;
                u[idx] = 0.5;
                v[idx] = 0.25;
            }
        }
    }
}

/// Seed pattern: horizontal line
fn seed_line(u: &mut [f64], v: &mut [f64], n: usize) {
    let cy = n / 2;
    let x_start = (n as f64 * 0.3).floor() as usize;
    let x_end = (n as f64 * 0.7).floor() as usize;
    for x in x_start..x_end {
        for dy_off in 0..5usize {
            let y = (cy as isize - 2 + dy_off as isize) as usize;
            if y < n {
                let idx = y * n + x;
                u[idx] = 0.5;
                v[idx] = 0.25;
            }
        }
    }
}

/// Run Gray-Scott simulation.
fn simulate(
    u: &mut [f64],
    v: &mut [f64],
    u_next: &mut [f64],
    v_next: &mut [f64],
    n: usize,
    iterations: usize,
    f: f64,
    k: f64,
    d_a: f64,
    d_b: f64,
) {
    for _ in 0..iterations {
        for y in 0..n {
            for x in 0..n {
                let idx = y * n + x;
                let xm = if x == 0 { n - 1 } else { x - 1 };
                let xp = if x == n - 1 { 0 } else { x + 1 };
                let ym = if y == 0 { n - 1 } else { y - 1 };
                let yp = if y == n - 1 { 0 } else { y + 1 };

                let lap_u = u[y * n + xm] + u[y * n + xp]
                    + u[ym * n + x] + u[yp * n + x]
                    - 4.0 * u[idx];
                let lap_v = v[y * n + xm] + v[y * n + xp]
                    + v[ym * n + x] + v[yp * n + x]
                    - 4.0 * v[idx];

                let u_val = u[idx];
                let v_val = v[idx];
                let uvv = u_val * v_val * v_val;

                u_next[idx] = (u_val + d_a * lap_u - uvv + f * (1.0 - u_val)).clamp(0.0, 1.0);
                v_next[idx] = (v_val + d_b * lap_v + uvv - (f + k) * v_val).clamp(0.0, 1.0);
            }
        }
        // Swap
        u.copy_from_slice(u_next);
        v.copy_from_slice(v_next);
    }
}

/// Marching squares contour extraction on the v field.
fn extract_contours(
    v: &[f64],
    n: usize,
    width: f64,
    height: f64,
    threshold: f64,
    levels: usize,
) -> Vec<Vec<(f64, f64)>> {
    let scale_x = width / n as f64;
    let scale_y = height / n as f64;
    let margin = width * 0.05;
    let sx_factor = 1.0 - margin * 2.0 / width;
    let sy_factor = 1.0 - margin * 2.0 / height;

    let mut polylines = Vec::new();

    for level in 0..levels {
        let iso_value = threshold
            + (level as f64 / (levels as f64 - 1.0).max(1.0)) * threshold * 0.5;

        let mut segments: Vec<(f64, f64, f64, f64)> = Vec::new();

        for y in 0..n - 1 {
            for x in 0..n - 1 {
                let v00 = v[y * n + x];
                let v10 = v[y * n + x + 1];
                let v01 = v[(y + 1) * n + x];
                let v11 = v[(y + 1) * n + x + 1];

                let config = (if v00 >= iso_value { 1 } else { 0 })
                    | (if v10 >= iso_value { 2 } else { 0 })
                    | (if v01 >= iso_value { 4 } else { 0 })
                    | (if v11 >= iso_value { 8 } else { 0 });

                if config == 0 || config == 15 {
                    continue;
                }

                let lerp = |a: f64, b: f64| -> f64 {
                    let d = b - a;
                    if d.abs() < 1e-12 {
                        0.5
                    } else {
                        (iso_value - a) / d
                    }
                };

                let xf = x as f64;
                let yf = y as f64;
                let top = (xf + lerp(v00, v10), yf);
                let right = (xf + 1.0, yf + lerp(v10, v11));
                let bottom = (xf + lerp(v01, v11), yf + 1.0);
                let left = (xf, yf + lerp(v00, v01));

                let mut push_edge = |a: (f64, f64), b: (f64, f64)| {
                    segments.push((
                        margin + a.0 * scale_x * sx_factor,
                        margin + a.1 * scale_y * sy_factor,
                        margin + b.0 * scale_x * sx_factor,
                        margin + b.1 * scale_y * sy_factor,
                    ));
                };

                match config {
                    1 => push_edge(top, left),
                    2 => push_edge(right, top),
                    3 => push_edge(right, left),
                    4 => push_edge(left, bottom),
                    5 => push_edge(top, bottom),
                    6 => {
                        push_edge(right, top);
                        push_edge(left, bottom);
                    }
                    7 => push_edge(right, bottom),
                    8 => push_edge(bottom, right),
                    9 => {
                        push_edge(top, left);
                        push_edge(bottom, right);
                    }
                    10 => push_edge(bottom, top),
                    11 => push_edge(bottom, left),
                    12 => push_edge(left, right),
                    13 => push_edge(top, right),
                    14 => push_edge(left, top),
                    _ => {}
                }
            }
        }

        // Chain segments into polylines
        let eps = scale_x * 0.5;
        let mut used = vec![false; segments.len()];

        for i in 0..segments.len() {
            if used[i] {
                continue;
            }
            used[i] = true;
            let seg = segments[i];
            let mut chain: Vec<(f64, f64)> = vec![(seg.0, seg.1), (seg.2, seg.3)];

            // Grow forward
            let mut growing = true;
            while growing {
                growing = false;
                let (tx, ty) = *chain.last().unwrap();
                for j in 0..segments.len() {
                    if used[j] {
                        continue;
                    }
                    let s = segments[j];
                    if (s.0 - tx).abs() < eps && (s.1 - ty).abs() < eps {
                        chain.push((s.2, s.3));
                        used[j] = true;
                        growing = true;
                        break;
                    }
                    if (s.2 - tx).abs() < eps && (s.3 - ty).abs() < eps {
                        chain.push((s.0, s.1));
                        used[j] = true;
                        growing = true;
                        break;
                    }
                }
            }

            // Grow backward
            growing = true;
            while growing {
                growing = false;
                let (hx, hy) = chain[0];
                for j in 0..segments.len() {
                    if used[j] {
                        continue;
                    }
                    let s = segments[j];
                    if (s.2 - hx).abs() < eps && (s.3 - hy).abs() < eps {
                        chain.insert(0, (s.0, s.1));
                        used[j] = true;
                        growing = true;
                        break;
                    }
                    if (s.0 - hx).abs() < eps && (s.1 - hy).abs() < eps {
                        chain.insert(0, (s.2, s.3));
                        used[j] = true;
                        growing = true;
                        break;
                    }
                }
            }

            if chain.len() >= 2 {
                polylines.push(chain);
            }
        }
    }

    polylines
}

/// WASM entry point for reaction-diffusion.
///
/// Input: `[width, height, N, iterations, f, k, dA, dB, threshold, levels, seedPatternId]`
/// Output: 2D polyline protocol
#[wasm_bindgen]
pub fn generate_reaction_diffusion(input: &[f64]) -> Box<[f64]> {
    if input.len() < 11 {
        return encode_polylines_2d(&[]).into_boxed_slice();
    }

    let width = input[0];
    let height = input[1];
    let n = input[2] as usize;
    let iterations = input[3] as usize;
    let f = input[4];
    let k = input[5];
    let d_a = input[6];
    let d_b = input[7];
    let threshold = input[8];
    let levels = input[9] as usize;
    let seed_pattern = input[10] as u32;

    let size = n * n;
    let mut u = vec![1.0f64; size];
    let mut v = vec![0.0f64; size];
    let mut u_next = vec![0.0f64; size];
    let mut v_next = vec![0.0f64; size];

    // Apply seed pattern
    match seed_pattern {
        0 => seed_center(&mut u, &mut v, n),
        1 => seed_random(&mut u, &mut v, n),
        2 => seed_ring(&mut u, &mut v, n),
        _ => seed_line(&mut u, &mut v, n),
    }

    simulate(&mut u, &mut v, &mut u_next, &mut v_next, n, iterations, f, k, d_a, d_b);

    let polylines = extract_contours(&v, n, width, height, threshold, levels);

    encode_polylines_2d(&polylines).into_boxed_slice()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_basic_simulation() {
        let input = vec![
            800.0, // width
            600.0, // height
            50.0,  // N (small for test speed)
            100.0, // iterations (few for test)
            0.037, // f
            0.06,  // k
            1.0,   // dA
            0.5,   // dB
            0.25,  // threshold
            1.0,   // levels
            0.0,   // seedPattern = center
        ];
        let result = generate_reaction_diffusion(&input);
        assert!(result.len() >= 1);
        let num_polylines = result[0] as usize;
        // With few iterations the center blob may not produce many contours
        // but the format should be valid
        let mut pos = 1;
        for _ in 0..num_polylines {
            let num_pts = result[pos] as usize;
            pos += 1;
            pos += num_pts * 2;
        }
        assert_eq!(pos, result.len());
    }

    #[test]
    fn test_all_seed_patterns() {
        for seed in 0..4 {
            let input = vec![
                400.0, 300.0, 30.0, 50.0, 0.037, 0.06, 1.0, 0.5, 0.25, 1.0,
                seed as f64,
            ];
            let result = generate_reaction_diffusion(&input);
            assert!(result.len() >= 1);
            // All values should be finite
            for &v in result.iter() {
                assert!(v.is_finite(), "seed pattern {seed}: non-finite value");
            }
        }
    }

    #[test]
    fn test_empty_input() {
        let result = generate_reaction_diffusion(&[]);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0], 0.0);
    }
}
