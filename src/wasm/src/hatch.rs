/// Hatch line generation ported from src/hatch.ts.
///
/// Family IDs:
///   0 = u
///   1 = v
///   2 = diagonal
///   3 = rings
///   4 = hex
///   5 = crosshatch
///   6 = spiral
///   7 = wave

use std::f64::consts::PI;

use crate::noise::apply_noise_displacement;
use crate::surfaces::evaluate_surface;

/// Parameters for hatch generation, matching the 23-field serialization protocol.
#[derive(Debug, Clone)]
pub struct HatchConfig {
    pub surface_id: u32,
    pub params: [f64; 4],
    pub family: u32,
    pub count: u32,
    pub samples: u32,
    pub u_min: f64,
    pub u_max: f64,
    pub v_min: f64,
    pub v_max: f64,
    pub angle: f64,
    pub wave_amp: f64,
    pub wave_freq: f64,
    pub noise_amp: f64,
    pub noise_freq: f64,
    pub dash_len: f64,
    pub gap_len: f64,
    pub dash_random: f64,
    pub tx: f64,
    pub ty: f64,
    pub tz: f64,
}

/// Result: a list of polylines, each polyline is a list of (x, y, z) points.
pub type Polylines = Vec<Vec<(f64, f64, f64)>>;

/// Generate hatch lines for a single layer config.
pub fn generate_hatch_lines(cfg: &HatchConfig) -> Polylines {
    let count = cfg.count.max(1) as usize;
    let samples = cfg.samples.max(1) as usize;
    let u_range = (cfg.u_min, cfg.u_max);
    let v_range = (cfg.v_min, cfg.v_max);

    let eval = |u: f64, v: f64| -> (f64, f64, f64) {
        let (x, y, z) = evaluate_surface(cfg.surface_id, u, v, &cfg.params);
        (x + cfg.tx, y + cfg.ty, z + cfg.tz)
    };

    let mut polylines = match cfg.family {
        0 => generate_u_lines(&eval, count, samples, u_range, v_range),
        1 => generate_v_lines(&eval, count, samples, u_range, v_range),
        2 => generate_diagonal_lines(&eval, cfg.angle, count, samples, u_range, v_range),
        3 => generate_ring_lines(&eval, count, samples, u_range, v_range),
        4 => generate_hex_lines(&eval, count, samples, u_range, v_range),
        5 => generate_crosshatch_lines(&eval, cfg.angle, count, samples, u_range, v_range),
        6 => generate_spiral_lines(&eval, count, samples, u_range, v_range),
        7 => generate_wave_lines(&eval, count, samples, u_range, v_range, cfg.wave_amp, cfg.wave_freq),
        _ => generate_u_lines(&eval, count, samples, u_range, v_range),
    };

    // Post-process: noise displacement
    if cfg.noise_amp > 0.0 && cfg.noise_freq > 0.0 {
        apply_noise_to_polylines(&mut polylines, cfg.noise_amp, cfg.noise_freq);
    }

    // Post-process: dashing
    if cfg.dash_len > 0.0 && cfg.gap_len > 0.0 {
        polylines = apply_dashing(&polylines, cfg.dash_len, cfg.gap_len, cfg.dash_random);
    }

    polylines
}

// ── Family generators ──

fn generate_u_lines(
    eval: &dyn Fn(f64, f64) -> (f64, f64, f64),
    count: usize,
    samples: usize,
    u_range: (f64, f64),
    v_range: (f64, f64),
) -> Polylines {
    let mut lines = Vec::with_capacity(count);
    for i in 0..count {
        let u = if count > 1 {
            u_range.0 + (i as f64 / (count - 1) as f64) * (u_range.1 - u_range.0)
        } else {
            (u_range.0 + u_range.1) / 2.0
        };
        let mut pts = Vec::with_capacity(samples + 1);
        for j in 0..=samples {
            let v = v_range.0 + (j as f64 / samples as f64) * (v_range.1 - v_range.0);
            pts.push(eval(u, v));
        }
        lines.push(pts);
    }
    lines
}

fn generate_v_lines(
    eval: &dyn Fn(f64, f64) -> (f64, f64, f64),
    count: usize,
    samples: usize,
    u_range: (f64, f64),
    v_range: (f64, f64),
) -> Polylines {
    let mut lines = Vec::with_capacity(count);
    for i in 0..count {
        let v = if count > 1 {
            v_range.0 + (i as f64 / (count - 1) as f64) * (v_range.1 - v_range.0)
        } else {
            (v_range.0 + v_range.1) / 2.0
        };
        let mut pts = Vec::with_capacity(samples + 1);
        for j in 0..=samples {
            let u = u_range.0 + (j as f64 / samples as f64) * (u_range.1 - u_range.0);
            pts.push(eval(u, v));
        }
        lines.push(pts);
    }
    lines
}

fn generate_diagonal_lines_inner(
    eval: &dyn Fn(f64, f64) -> (f64, f64, f64),
    angle: f64,
    count: usize,
    samples: usize,
    u_range: (f64, f64),
    v_range: (f64, f64),
) -> Polylines {
    let ca = angle.cos();
    let sa = angle.sin();
    let u_span = u_range.1 - u_range.0;
    let v_span = v_range.1 - v_range.0;

    let corners = [
        ca * u_range.0 + sa * v_range.0,
        ca * u_range.1 + sa * v_range.0,
        ca * u_range.0 + sa * v_range.1,
        ca * u_range.1 + sa * v_range.1,
    ];
    let iso_min = corners.iter().cloned().fold(f64::INFINITY, f64::min);
    let iso_max = corners.iter().cloned().fold(f64::NEG_INFINITY, f64::max);

    let max_extent = u_span.max(v_span);
    let mut lines = Vec::with_capacity(count);

    for i in 0..count {
        let iso_val = if count > 1 {
            iso_min + (i as f64 / (count - 1) as f64) * (iso_max - iso_min)
        } else {
            (iso_min + iso_max) / 2.0
        };
        let mut pts = Vec::new();
        for j in 0..=samples {
            let t = (j as f64 / samples as f64) * 2.0 - 1.0;
            let u = iso_val * ca - t * sa * max_extent;
            let v = iso_val * sa + t * ca * max_extent;
            let uc = u_range.0 + ((u - iso_min) / (iso_max - iso_min)) * u_span;
            let vc = v_range.0 + ((v - iso_min) / (iso_max - iso_min)) * v_span;
            if uc >= u_range.0 && uc <= u_range.1 && vc >= v_range.0 && vc <= v_range.1 {
                pts.push(eval(uc, vc));
            }
        }
        if pts.len() >= 2 {
            lines.push(pts);
        }
    }
    lines
}

fn generate_diagonal_lines(
    eval: &dyn Fn(f64, f64) -> (f64, f64, f64),
    angle: f64,
    count: usize,
    samples: usize,
    u_range: (f64, f64),
    v_range: (f64, f64),
) -> Polylines {
    generate_diagonal_lines_inner(eval, angle, count, samples, u_range, v_range)
}

fn generate_ring_lines(
    eval: &dyn Fn(f64, f64) -> (f64, f64, f64),
    count: usize,
    samples: usize,
    u_range: (f64, f64),
    v_range: (f64, f64),
) -> Polylines {
    let u_mid = (u_range.0 + u_range.1) / 2.0;
    let v_mid = (v_range.0 + v_range.1) / 2.0;
    let u_span = u_range.1 - u_range.0;
    let v_span = v_range.1 - v_range.0;
    let max_radius = u_span.min(v_span) / 2.0;

    let mut lines = Vec::with_capacity(count);
    for i in 0..count {
        let r = ((i + 1) as f64 / count as f64) * max_radius;
        let mut pts = Vec::new();
        for j in 0..=samples {
            let theta = (j as f64 / samples as f64) * PI * 2.0;
            let u = u_mid + r * theta.cos();
            let v = v_mid + r * theta.sin();
            if u >= u_range.0 && u <= u_range.1 && v >= v_range.0 && v <= v_range.1 {
                pts.push(eval(u, v));
            }
        }
        if pts.len() >= 2 {
            lines.push(pts);
        }
    }
    lines
}

fn generate_hex_lines(
    eval: &dyn Fn(f64, f64) -> (f64, f64, f64),
    count: usize,
    samples: usize,
    u_range: (f64, f64),
    v_range: (f64, f64),
) -> Polylines {
    let per_dir = (count / 3).max(1);
    let angles = [0.0, PI / 3.0, 2.0 * PI / 3.0];
    let mut lines = Vec::new();
    for &a in &angles {
        let mut dir_lines = generate_diagonal_lines_inner(eval, a, per_dir, samples, u_range, v_range);
        lines.append(&mut dir_lines);
    }
    lines
}

fn generate_crosshatch_lines(
    eval: &dyn Fn(f64, f64) -> (f64, f64, f64),
    angle: f64,
    count: usize,
    samples: usize,
    u_range: (f64, f64),
    v_range: (f64, f64),
) -> Polylines {
    let per_dir = (count / 2).max(1);
    let mut lines = generate_diagonal_lines_inner(eval, angle, per_dir, samples, u_range, v_range);
    let mut lines2 = generate_diagonal_lines_inner(eval, angle + PI / 2.0, per_dir, samples, u_range, v_range);
    lines.append(&mut lines2);
    lines
}

fn generate_spiral_lines(
    eval: &dyn Fn(f64, f64) -> (f64, f64, f64),
    count: usize,
    samples: usize,
    u_range: (f64, f64),
    v_range: (f64, f64),
) -> Polylines {
    let u_mid = (u_range.0 + u_range.1) / 2.0;
    let v_mid = (v_range.0 + v_range.1) / 2.0;
    let u_span = u_range.1 - u_range.0;
    let v_span = v_range.1 - v_range.0;
    let max_radius = u_span.min(v_span) / 2.0;
    let total_turns = 4.0;
    let max_theta = total_turns * PI * 2.0;

    let mut lines = Vec::with_capacity(count);
    for i in 0..count {
        let arm_offset = (i as f64 / count as f64) * PI * 2.0;
        let mut pts = Vec::new();
        for j in 0..=samples {
            let theta = (j as f64 / samples as f64) * max_theta;
            let r = (theta / max_theta) * max_radius;
            let u = u_mid + r * (theta + arm_offset).cos();
            let v = v_mid + r * (theta + arm_offset).sin();
            if u >= u_range.0 && u <= u_range.1 && v >= v_range.0 && v <= v_range.1 {
                pts.push(eval(u, v));
            }
        }
        if pts.len() >= 2 {
            lines.push(pts);
        }
    }
    lines
}

fn generate_wave_lines(
    eval: &dyn Fn(f64, f64) -> (f64, f64, f64),
    count: usize,
    samples: usize,
    u_range: (f64, f64),
    v_range: (f64, f64),
    wave_amp: f64,
    wave_freq: f64,
) -> Polylines {
    let v_span = v_range.1 - v_range.0;
    let mut lines = Vec::with_capacity(count);

    for i in 0..count {
        let v_base = if count > 1 {
            v_range.0 + (i as f64 / (count - 1) as f64) * v_span
        } else {
            (v_range.0 + v_range.1) / 2.0
        };
        let phase_shift = i as f64 * 0.3;
        let mut pts = Vec::with_capacity(samples + 1);
        for j in 0..=samples {
            let u = u_range.0 + (j as f64 / samples as f64) * (u_range.1 - u_range.0);
            let v = v_base + wave_amp * (u * wave_freq * PI * 2.0 + phase_shift).sin();
            let vc = v.clamp(v_range.0, v_range.1);
            pts.push(eval(u, vc));
        }
        lines.push(pts);
    }
    lines
}

// ── Post-processing ──

/// Apply noise displacement to polylines.
fn apply_noise_to_polylines(polylines: &mut Polylines, amplitude: f64, frequency: f64) {
    // Flatten into a single points array for the noise function
    let total_points: usize = polylines.iter().map(|l| l.len()).sum();
    let mut flat_points = Vec::with_capacity(total_points);
    let mut line_starts = Vec::with_capacity(polylines.len());
    let mut line_lengths = Vec::with_capacity(polylines.len());

    let mut offset = 0;
    for line in polylines.iter() {
        line_starts.push(offset);
        line_lengths.push(line.len());
        for &pt in line {
            flat_points.push(pt);
        }
        offset += line.len();
    }

    apply_noise_displacement(&mut flat_points, &line_starts, &line_lengths, amplitude, frequency);

    // Copy back
    let mut idx = 0;
    for line in polylines.iter_mut() {
        for pt in line.iter_mut() {
            *pt = flat_points[idx];
            idx += 1;
        }
    }
}

/// Apply dashing post-process (matching src/hatch.ts applyDashing).
fn apply_dashing(
    polylines: &Polylines,
    dash_length: f64,
    gap_length: f64,
    dash_random: f64,
) -> Polylines {
    let mut result = Vec::new();

    // Simple seeded random for determinism — use a basic LCG
    let mut rng_state: u64 = 42;
    let mut next_random = || -> f64 {
        rng_state = rng_state.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        ((rng_state >> 33) as f64) / (u32::MAX as f64)
    };

    let randomize = |base: f64, randomness: f64, rng: &mut dyn FnMut() -> f64| -> f64 {
        if randomness <= 0.0 {
            return base;
        }
        base * (1.0 + (rng() * 2.0 - 1.0) * randomness)
    };

    for pts in polylines {
        if pts.len() < 2 {
            result.push(pts.clone());
            continue;
        }

        let mut drawing = true;
        let mut remaining = randomize(dash_length, dash_random, &mut next_random);
        let mut current = vec![pts[0]];

        for i in 1..pts.len() {
            let dx = pts[i].0 - pts[i - 1].0;
            let dy = pts[i].1 - pts[i - 1].1;
            let dz = pts[i].2 - pts[i - 1].2;
            let seg_len = (dx * dx + dy * dy + dz * dz).sqrt();
            let mut consumed = 0.0;

            while consumed < seg_len {
                let step = remaining.min(seg_len - consumed);
                let t = (consumed + step) / seg_len;

                let interp = (
                    pts[i - 1].0 + dx * t,
                    pts[i - 1].1 + dy * t,
                    pts[i - 1].2 + dz * t,
                );

                if drawing {
                    current.push(interp);
                }

                consumed += step;
                remaining -= step;

                if remaining <= 0.0 {
                    if drawing && current.len() >= 2 {
                        result.push(current);
                    }
                    drawing = !drawing;
                    remaining = if drawing {
                        randomize(dash_length, dash_random, &mut next_random)
                    } else {
                        randomize(gap_length, dash_random, &mut next_random)
                    };
                    if drawing {
                        current = vec![interp];
                    } else {
                        current = Vec::new();
                    }
                }
            }
        }

        if drawing && current.len() >= 2 {
            result.push(current);
        }
    }

    result
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_config(family: u32) -> HatchConfig {
        HatchConfig {
            surface_id: 0, // twistedRibbon
            params: [2.0, 1.2, 4.0, 0.3],
            family,
            count: 10,
            samples: 20,
            u_min: 0.0,
            u_max: 1.0,
            v_min: 0.0,
            v_max: 1.0,
            angle: 0.0,
            wave_amp: 0.05,
            wave_freq: 6.0,
            noise_amp: 0.0,
            noise_freq: 0.0,
            dash_len: 0.0,
            gap_len: 0.0,
            dash_random: 0.0,
            tx: 0.0,
            ty: 0.0,
            tz: 0.0,
        }
    }

    #[test]
    fn test_u_family_line_count() {
        let cfg = make_config(0);
        let lines = generate_hatch_lines(&cfg);
        assert_eq!(lines.len(), 10);
        for line in &lines {
            assert_eq!(line.len(), 21); // samples + 1
        }
    }

    #[test]
    fn test_v_family_line_count() {
        let cfg = make_config(1);
        let lines = generate_hatch_lines(&cfg);
        assert_eq!(lines.len(), 10);
    }

    #[test]
    fn test_diagonal_family() {
        let cfg = make_config(2);
        let lines = generate_hatch_lines(&cfg);
        assert!(!lines.is_empty(), "diagonal should produce lines");
    }

    #[test]
    fn test_ring_family() {
        let cfg = make_config(3);
        let lines = generate_hatch_lines(&cfg);
        assert!(!lines.is_empty(), "rings should produce lines");
    }

    #[test]
    fn test_hex_family() {
        let cfg = make_config(4);
        let lines = generate_hatch_lines(&cfg);
        assert!(!lines.is_empty(), "hex should produce lines");
    }

    #[test]
    fn test_crosshatch_family() {
        let cfg = make_config(5);
        let lines = generate_hatch_lines(&cfg);
        assert!(!lines.is_empty(), "crosshatch should produce lines");
    }

    #[test]
    fn test_spiral_family() {
        let cfg = make_config(6);
        let lines = generate_hatch_lines(&cfg);
        assert!(!lines.is_empty(), "spiral should produce lines");
    }

    #[test]
    fn test_wave_family() {
        let cfg = make_config(7);
        let lines = generate_hatch_lines(&cfg);
        assert_eq!(lines.len(), 10);
    }

    #[test]
    fn test_all_families_finite() {
        for family in 0..8 {
            let cfg = make_config(family);
            let lines = generate_hatch_lines(&cfg);
            for line in &lines {
                for &(x, y, z) in line {
                    assert!(x.is_finite(), "family {family}: x not finite");
                    assert!(y.is_finite(), "family {family}: y not finite");
                    assert!(z.is_finite(), "family {family}: z not finite");
                }
            }
        }
    }

    #[test]
    fn test_dashing_splits_lines() {
        let mut cfg = make_config(0);
        cfg.count = 5;
        cfg.samples = 40;
        cfg.dash_len = 0.3;
        cfg.gap_len = 0.1;
        let lines = generate_hatch_lines(&cfg);
        // Dashing should produce more polylines than the original count
        assert!(lines.len() > 5, "dashing should split lines: got {}", lines.len());
    }

    #[test]
    fn test_noise_modifies_output() {
        let mut cfg = make_config(0);
        cfg.count = 3;
        cfg.samples = 10;

        let clean = generate_hatch_lines(&cfg);

        cfg.noise_amp = 0.5;
        cfg.noise_freq = 2.0;
        let noisy = generate_hatch_lines(&cfg);

        // Same number of lines
        assert_eq!(clean.len(), noisy.len());

        // But at least some points should differ
        let mut any_diff = false;
        for (cl, nl) in clean.iter().zip(noisy.iter()) {
            for (c, n) in cl.iter().zip(nl.iter()) {
                if (c.0 - n.0).abs() > 1e-12 || (c.1 - n.1).abs() > 1e-12 {
                    any_diff = true;
                }
            }
        }
        assert!(any_diff, "noise should modify some points");
    }

    #[test]
    fn test_transform_offset() {
        let mut cfg = make_config(0);
        cfg.count = 1;
        cfg.samples = 1;
        cfg.tx = 10.0;
        cfg.ty = 20.0;
        cfg.tz = 30.0;

        let lines = generate_hatch_lines(&cfg);

        // Also generate without transform for comparison
        let mut cfg_no_t = cfg.clone();
        cfg_no_t.tx = 0.0;
        cfg_no_t.ty = 0.0;
        cfg_no_t.tz = 0.0;
        let lines_no_t = generate_hatch_lines(&cfg_no_t);

        for (l, l_nt) in lines.iter().zip(lines_no_t.iter()) {
            for (&(x, y, z), &(xn, yn, zn)) in l.iter().zip(l_nt.iter()) {
                assert!((x - xn - 10.0).abs() < 1e-10, "x transform");
                assert!((y - yn - 20.0).abs() < 1e-10, "y transform");
                assert!((z - zn - 30.0).abs() < 1e-10, "z transform");
            }
        }
    }
}
