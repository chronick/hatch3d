/// Noise displacement using the `noise` crate's OpenSimplex.
///
/// Mirrors applyNoiseDisplacement from src/hatch.ts:
/// - Computes perpendicular direction from adjacent points
/// - Applies noise-scaled offset in the XY plane

use noise::{NoiseFn, OpenSimplex};

/// Apply noise displacement to polylines in-place.
/// Each point is stored as (x, y, z) triples in `points`, with boundaries
/// described by `line_starts` (index into the points array where each line begins)
/// and `line_lengths` (number of points per line).
pub fn apply_noise_displacement(
    points: &mut [(f64, f64, f64)],
    line_starts: &[usize],
    line_lengths: &[usize],
    amplitude: f64,
    frequency: f64,
) {
    let noise = OpenSimplex::new(0);

    for (line_idx, (&start, &len)) in line_starts.iter().zip(line_lengths.iter()).enumerate() {
        if len < 2 {
            continue;
        }
        for i in 0..len {
            let idx = start + i;
            let (dx, dy, _dz) = if i == 0 {
                let a = points[idx];
                let b = points[idx + 1];
                (b.0 - a.0, b.1 - a.1, b.2 - a.2)
            } else if i == len - 1 {
                let a = points[idx - 1];
                let b = points[idx];
                (b.0 - a.0, b.1 - a.1, b.2 - a.2)
            } else {
                let a = points[idx - 1];
                let b = points[idx + 1];
                (b.0 - a.0, b.1 - a.1, b.2 - a.2)
            };

            let len_sq = dx * dx + dy * dy;
            if len_sq < 1e-16 {
                continue;
            }
            let inv_len = 1.0 / len_sq.sqrt();

            // Perpendicular in XY plane
            let perp_x = -dy * inv_len;
            let perp_y = dx * inv_len;

            let p = points[idx];
            let n = noise.get([
                p.0 * frequency + line_idx as f64 * 0.1,
                p.1 * frequency,
            ]);
            let offset = amplitude * n;

            points[idx].0 += perp_x * offset;
            points[idx].1 += perp_y * offset;
            // perp_z = 0, so z unchanged
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_noise_displacement_modifies_points() {
        let mut points = vec![
            (0.0, 0.0, 0.0),
            (1.0, 0.0, 0.0),
            (2.0, 0.0, 0.0),
        ];
        let starts = vec![0];
        let lengths = vec![3];

        let original = points.clone();
        apply_noise_displacement(&mut points, &starts, &lengths, 0.5, 2.0);

        // At least some points should have changed
        let changed = points.iter().zip(original.iter())
            .any(|(a, b)| (a.0 - b.0).abs() > 1e-12 || (a.1 - b.1).abs() > 1e-12);
        assert!(changed, "noise should modify at least some points");

        // Z should be unchanged (perpendicular is in XY)
        for (p, o) in points.iter().zip(original.iter()) {
            assert!((p.2 - o.2).abs() < 1e-12, "z should not change");
        }
    }

    #[test]
    fn test_zero_amplitude_no_change() {
        let mut points = vec![
            (0.0, 0.0, 0.0),
            (1.0, 0.0, 0.0),
        ];
        let starts = vec![0];
        let lengths = vec![2];
        let original = points.clone();

        apply_noise_displacement(&mut points, &starts, &lengths, 0.0, 2.0);

        for (p, o) in points.iter().zip(original.iter()) {
            assert!((p.0 - o.0).abs() < 1e-12);
            assert!((p.1 - o.1).abs() < 1e-12);
        }
    }
}
