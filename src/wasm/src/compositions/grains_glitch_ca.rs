//! Cellular-automaton state grid → horizontal hatch tiles with segment-join
//! path optimisation. Mirrors src/compositions/2d/generative/grains-glitch-ca.ts.
//!
//! ## Input protocol (16 f64s):
//! ```text
//! [width, height, gridCols, gridRows, numStates, caIterations,
//!  neighborhoodMode, ruleBlend, shiftStrength, tileH, tileW,
//!  hatchLineGap, joinSegments, joinTolerance, seedNoise, seed]
//! ```
//! neighborhoodMode: 0=moore1, 1=moore2, 2=dir16, 3=all
//! joinSegments: 0=false, 1=true

use noise::{NoiseFn, OpenSimplex};
use wasm_bindgen::prelude::*;

use super::common::encode_polylines_2d;

// 16-direction neighbourhood at radius 3 — same offsets as the TS DIR16.
fn dir16_offsets() -> [(i32, i32); 16] {
    let mut out = [(0i32, 0i32); 16];
    for k in 0..16 {
        let theta = (k as f64) / 16.0 * std::f64::consts::PI * 2.0;
        out[k] = (
            (theta.cos() * 3.0).round() as i32,
            (theta.sin() * 3.0).round() as i32,
        );
    }
    out
}

/// Mulberry32 PRNG — bit-identical to the TS version.
struct Mulberry32(u32);

impl Mulberry32 {
    fn new(seed: u32) -> Self {
        Self(seed)
    }
    fn next(&mut self) -> f64 {
        self.0 = self.0.wrapping_add(0x6d2b79f5);
        let mut t = self.0;
        t = (t ^ (t >> 15)).wrapping_mul(t | 1);
        t ^= t.wrapping_add((t ^ (t >> 7)).wrapping_mul(t | 61));
        ((t ^ (t >> 14)) as f64) / 4294967296.0
    }
}

fn wrap(v: i32, n: i32) -> usize {
    let r = v.rem_euclid(n);
    r as usize
}

#[wasm_bindgen]
pub fn generate_grains_glitch_ca(input: &[f64]) -> Box<[f64]> {
    if input.len() < 16 {
        return encode_polylines_2d(&[]).into_boxed_slice();
    }
    let width = input[0];
    let height = input[1];
    let grid_cols = (input[2] as usize).max(4);
    let grid_rows = (input[3] as usize).max(4);
    let num_states = (input[4] as usize).max(2);
    let ca_iterations = input[5] as usize;
    let neighborhood_mode = input[6] as u32;
    let rule_blend = input[7].clamp(0.0, 1.0);
    let shift_strength = input[8].clamp(0.0, 1.0);
    let tile_h = input[9].max(2.0);
    let tile_w = input[10].max(4.0);
    let hatch_line_gap = input[11].clamp(0.1, 0.9);
    let join_segments = input[12] != 0.0;
    let join_tolerance = input[13].max(0.0);
    let seed_noise = input[14].clamp(0.0, 0.5);
    let seed = input[15] as u32;

    // ── Layout (same logic as TS) ──
    let aspect = tile_w / tile_h;
    let px_per_col_w = width / grid_cols as f64;
    let px_per_row_h = height / grid_rows as f64;
    let mut px_per_col = px_per_col_w;
    let mut px_per_row = px_per_col_w / aspect;
    if px_per_row * grid_rows as f64 > height {
        px_per_row = px_per_row_h;
        px_per_col = px_per_row_h * aspect;
    }
    let total_w = px_per_col * grid_cols as f64;
    let total_h = px_per_row * grid_rows as f64;
    let x0 = (width - total_w) / 2.0;
    let y0 = (height - total_h) / 2.0;

    let mut rng = Mulberry32::new(seed);
    // Note: TS uses simplex-noise seeded with the same rng; here we use the
    // noise crate's OpenSimplex with the seed directly. Algorithm parity is
    // exact; specific noise values differ from TS.
    let noise = OpenSimplex::new(seed);

    let idx = |i: usize, j: usize| j * grid_cols + i;

    // ── 1. GRID INIT ──
    let mut current: Vec<u32> = vec![0; grid_cols * grid_rows];
    for j in 0..grid_rows {
        for i in 0..grid_cols {
            let base = 0.5 + 0.5 * noise.get([i as f64 * 0.04, j as f64 * 0.04]);
            let perturbed = base + seed_noise * (rng.next() * 2.0 - 1.0);
            let clamped = perturbed.clamp(0.0, 0.999);
            current[idx(i, j)] = (clamped * num_states as f64).floor() as u32;
        }
    }
    let mut next: Vec<u32> = vec![0; grid_cols * grid_rows];

    // ── 2. CA EVOLUTION ──
    let kernels_moore1 = neighborhood_mode == 0 || neighborhood_mode == 3;
    let kernels_moore2 = neighborhood_mode == 1 || neighborhood_mode == 3;
    let kernels_dir16 = neighborhood_mode == 2 || neighborhood_mode == 3;
    let dir16 = dir16_offsets();
    let cols_i = grid_cols as i32;
    let rows_i = grid_rows as i32;

    let mut votes = vec![0u32; num_states];
    for _ in 0..ca_iterations {
        for j in 0..grid_rows {
            let row_shift = (shift_strength
                * (j as f64) / (grid_rows.max(2) as f64 - 1.0)
                * tile_w)
                .floor() as i32;
            for i in 0..grid_cols {
                votes.iter_mut().for_each(|v| *v = 0);
                let mut total: u32 = 0;
                if kernels_moore1 {
                    for dj in -1..=1 {
                        for di in -1..=1 {
                            if di == 0 && dj == 0 {
                                continue;
                            }
                            let ni = wrap(i as i32 + di + row_shift, cols_i);
                            let nj = wrap(j as i32 + dj, rows_i);
                            votes[current[idx(ni, nj)] as usize] += 1;
                            total += 1;
                        }
                    }
                }
                if kernels_moore2 {
                    for dj in -2..=2 {
                        for di in -2..=2 {
                            if di == 0 && dj == 0 {
                                continue;
                            }
                            let ni = wrap(i as i32 + di + row_shift, cols_i);
                            let nj = wrap(j as i32 + dj, rows_i);
                            let w = if di.abs() == 2 || dj.abs() == 2 { 1u32 } else { 2u32 };
                            votes[current[idx(ni, nj)] as usize] += w;
                            total += w;
                        }
                    }
                }
                if kernels_dir16 {
                    for (dx, dy) in dir16.iter() {
                        let ni = wrap(i as i32 + dx + row_shift, cols_i);
                        let nj = wrap(j as i32 + dy, rows_i);
                        votes[current[idx(ni, nj)] as usize] += 1;
                        total += 1;
                    }
                }
                if total == 0 {
                    next[idx(i, j)] = current[idx(i, j)];
                    continue;
                }
                let mut best_state: u32 = 0;
                let mut best_score = f64::NEG_INFINITY;
                for s in 0..num_states {
                    let jitter = rule_blend * rng.next() * total as f64 * 0.3;
                    let score = votes[s] as f64 + jitter;
                    if score > best_score {
                        best_score = score;
                        best_state = s as u32;
                    }
                }
                next[idx(i, j)] = best_state;
            }
        }
        std::mem::swap(&mut current, &mut next);
    }

    // ── 3. TILE MAPPING ──
    let max_lines = ((1.0 - hatch_line_gap) * px_per_row).floor().max(1.0) as i32;
    // Each segment: (y, x1, x2, state)
    let mut segments: Vec<(f64, f64, f64, u32)> = Vec::new();
    for j in 0..grid_rows {
        let y_top = y0 + j as f64 * px_per_row;
        for i in 0..grid_cols {
            let state = current[idx(i, j)];
            if state == 0 {
                continue;
            }
            let line_count = ((state as f64 / (num_states as f64 - 1.0)) * max_lines as f64)
                .round()
                .max(1.0) as i32;
            let x_left = x0 + i as f64 * px_per_col;
            let x_right = x_left + px_per_col;
            for l in 0..line_count {
                let y = y_top + ((l as f64 + 0.5) / line_count as f64) * px_per_row;
                segments.push((y, x_left, x_right, state));
            }
        }
    }

    // ── 4. SEGMENT JOIN ──
    let polylines: Vec<Vec<(f64, f64)>> = if !join_segments {
        segments
            .into_iter()
            .map(|(y, x1, x2, _)| vec![(x1, y), (x2, y)])
            .collect()
    } else {
        // Sort by (y asc, x1 asc).
        segments.sort_by(|a, b| {
            a.0.partial_cmp(&b.0)
                .unwrap_or(std::cmp::Ordering::Equal)
                .then(a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal))
        });
        let mut out: Vec<Vec<(f64, f64)>> = Vec::new();
        let mut i = 0;
        while i < segments.len() {
            let (y, x1_start, mut x_end, state) = segments[i];
            let mut k = i + 1;
            while k < segments.len() {
                let (yk, x1k, x2k, sk) = segments[k];
                if (yk - y).abs() > 0.01 || sk != state || x1k > x_end + join_tolerance {
                    break;
                }
                if x2k > x_end {
                    x_end = x2k;
                }
                k += 1;
            }
            out.push(vec![(x1_start, y), (x_end, y)]);
            i = k;
        }
        out
    };

    encode_polylines_2d(&polylines).into_boxed_slice()
}
