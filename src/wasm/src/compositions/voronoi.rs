//! Voronoi diagram via Bowyer-Watson Delaunay triangulation with optional
//! Lloyd relaxation and per-cell hatch fill.
//!
//! ## Input protocol (10 f64s):
//! ```text
//! [width, height, pointCount, distributionId, relaxIterations,
//!  fillCells, fillDensity, variedAngles, margin, seed]
//! ```
//! distributionId: 0=random, 1=jitter, 2=clustered
//! fillCells: 0.0 = false, 1.0 = true
//! variedAngles: 0.0 = false, 1.0 = true

use wasm_bindgen::prelude::*;
use super::common::encode_polylines_2d;

#[derive(Clone, Copy)]
struct Point {
    x: f64,
    y: f64,
}

#[derive(Clone, Copy)]
struct Triangle {
    a: usize,
    b: usize,
    c: usize,
}

/// Deterministic pseudo-random using sin-hash (matches JS).
fn hash_f64(seed: f64) -> f64 {
    let h = (seed).sin() * 43758.5453;
    h - h.floor()
}

/// Generate initial point distribution.
fn generate_points(
    distribution: u32,
    count: usize,
    x_min: f64,
    x_max: f64,
    y_min: f64,
    y_max: f64,
) -> Vec<Point> {
    let mut points = Vec::with_capacity(count);
    let dx = x_max - x_min;
    let dy = y_max - y_min;

    match distribution {
        1 => {
            // Grid + jitter
            let side = (count as f64).sqrt().ceil() as usize;
            let cell_dx = dx / side as f64;
            let cell_dy = dy / side as f64;
            for i in 0..side {
                for j in 0..side {
                    if points.len() >= count {
                        break;
                    }
                    let jx = hash_f64((i * side + j) as f64 * 127.1 + 311.7) - 0.5;
                    let jy = hash_f64((i * side + j) as f64 * 269.5 + 183.3) - 0.5;
                    points.push(Point {
                        x: x_min + (i as f64 + 0.5) * cell_dx + jx * cell_dx * 0.8,
                        y: y_min + (j as f64 + 0.5) * cell_dy + jy * cell_dy * 0.8,
                    });
                }
            }
        }
        2 => {
            // Clustered
            let clusters = (count / 20).max(3);
            let centers: Vec<Point> = (0..clusters)
                .map(|i| Point {
                    x: x_min + hash_f64(i as f64 * 127.1 + 500.0) * dx,
                    y: y_min + hash_f64(i as f64 * 269.5 + 700.0) * dy,
                })
                .collect();
            let spread = dx.min(dy) * 0.1;
            for i in 0..count {
                let c = &centers[i % clusters];
                let ox = (hash_f64(i as f64 * 127.1 + 311.7) - 0.5) * spread * 2.0;
                let oy = (hash_f64(i as f64 * 269.5 + 183.3) - 0.5) * spread * 2.0;
                points.push(Point {
                    x: (c.x + ox).clamp(x_min, x_max),
                    y: (c.y + oy).clamp(y_min, y_max),
                });
            }
        }
        _ => {
            // Random
            for i in 0..count {
                points.push(Point {
                    x: x_min + hash_f64(i as f64 * 127.1 + 311.7) * dx,
                    y: y_min + hash_f64(i as f64 * 269.5 + 183.3) * dy,
                });
            }
        }
    }

    points
}

/// Compute circumcenter of triangle with vertices at given points.
fn circumcenter(pts: &[Point], tri: &Triangle) -> Option<Point> {
    let ax = pts[tri.a].x;
    let ay = pts[tri.a].y;
    let bx = pts[tri.b].x;
    let by = pts[tri.b].y;
    let cx = pts[tri.c].x;
    let cy = pts[tri.c].y;

    let d = 2.0 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
    if d.abs() < 1e-10 {
        return None;
    }

    let a2 = ax * ax + ay * ay;
    let b2 = bx * bx + by * by;
    let c2 = cx * cx + cy * cy;

    Some(Point {
        x: (a2 * (by - cy) + b2 * (cy - ay) + c2 * (ay - by)) / d,
        y: (a2 * (cx - bx) + b2 * (ax - cx) + c2 * (bx - ax)) / d,
    })
}

/// Bowyer-Watson Delaunay triangulation.
/// Modifies `pts` by appending super-triangle vertices; caller should account for this.
fn triangulate(pts: &mut Vec<Point>, x_min: f64, x_max: f64, y_min: f64, y_max: f64) -> Vec<Triangle> {
    let dmax = (x_max - x_min).max(y_max - y_min) * 2.0;
    let super_a = pts.len();
    let super_b = pts.len() + 1;
    let super_c = pts.len() + 2;

    pts.push(Point { x: x_min - dmax, y: y_min - dmax });
    pts.push(Point { x: x_min + dmax * 3.0, y: y_min - dmax });
    pts.push(Point { x: x_min, y: y_min + dmax * 3.0 });

    let mut triangles = vec![Triangle { a: super_a, b: super_b, c: super_c }];

    let n_points = pts.len() - 3; // original point count

    for i in 0..n_points {
        let p = pts[i];
        let mut bad = Vec::new();
        let mut good = Vec::new();

        for tri in &triangles {
            if point_in_circumcircle(pts, tri, &p) {
                bad.push(*tri);
            } else {
                good.push(*tri);
            }
        }

        // Find boundary polygon
        let mut edges: Vec<(usize, usize)> = Vec::new();
        for tri in &bad {
            let tri_edges = [(tri.a, tri.b), (tri.b, tri.c), (tri.c, tri.a)];
            for &(ea, eb) in &tri_edges {
                let mut shared = false;
                for other in &bad {
                    if std::ptr::eq(tri, other) {
                        continue;
                    }
                    let oe = [(other.a, other.b), (other.b, other.c), (other.c, other.a)];
                    for &(oa, ob) in &oe {
                        if (ea == oa && eb == ob) || (ea == ob && eb == oa) {
                            shared = true;
                            break;
                        }
                    }
                    if shared {
                        break;
                    }
                }
                if !shared {
                    edges.push((ea, eb));
                }
            }
        }

        triangles = good;
        for (ea, eb) in edges {
            triangles.push(Triangle { a: i, b: ea, c: eb });
        }
    }

    // Remove triangles connected to super-triangle vertices
    triangles.retain(|t| t.a < super_a && t.b < super_a && t.c < super_a);
    triangles
}

fn point_in_circumcircle(pts: &[Point], tri: &Triangle, p: &Point) -> bool {
    let ax = pts[tri.a].x;
    let ay = pts[tri.a].y;
    let bx = pts[tri.b].x;
    let by = pts[tri.b].y;
    let cx = pts[tri.c].x;
    let cy = pts[tri.c].y;

    let d = 2.0 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
    if d.abs() < 1e-10 {
        return false;
    }

    let a2 = ax * ax + ay * ay;
    let b2 = bx * bx + by * by;
    let c2 = cx * cx + cy * cy;

    let ux = (a2 * (by - cy) + b2 * (cy - ay) + c2 * (ay - by)) / d;
    let uy = (a2 * (cx - bx) + b2 * (ax - cx) + c2 * (bx - ax)) / d;
    let r2 = (ax - ux).powi(2) + (ay - uy).powi(2);

    (p.x - ux).powi(2) + (p.y - uy).powi(2) < r2
}

/// WASM entry point for voronoi texture.
#[wasm_bindgen]
pub fn generate_voronoi(input: &[f64]) -> Box<[f64]> {
    if input.len() < 10 {
        return encode_polylines_2d(&[]).into_boxed_slice();
    }

    let width = input[0];
    let height = input[1];
    let point_count = input[2] as usize;
    let distribution = input[3] as u32;
    let relax_iter = input[4] as usize;
    let fill_cells = input[5] > 0.5;
    let fill_density = input[6] as usize;
    let varied_angles = input[7] > 0.5;
    let margin = input[8];
    // input[9] = seed (reserved for future use)

    let x_min = margin;
    let x_max = width - margin;
    let y_min = margin;
    let y_max = height - margin;

    let mut points = generate_points(distribution, point_count, x_min, x_max, y_min, y_max);

    // Lloyd relaxation
    for _ in 0..relax_iter {
        let mut pts_copy: Vec<Point> = points[..point_count].to_vec();
        let tris = triangulate(&mut pts_copy, x_min, x_max, y_min, y_max);
        // Remove super-triangle points from copy (they were appended)
        pts_copy.truncate(point_count);

        let mut cell_sums: Vec<(f64, f64, usize)> = vec![(0.0, 0.0, 0); point_count];

        for tri in &tris {
            if let Some(cc) = circumcenter(&pts_copy, tri) {
                for &idx in &[tri.a, tri.b, tri.c] {
                    if idx < point_count {
                        cell_sums[idx].0 += cc.x;
                        cell_sums[idx].1 += cc.y;
                        cell_sums[idx].2 += 1;
                    }
                }
            }
        }

        for i in 0..point_count {
            let (sx, sy, count) = cell_sums[i];
            if count > 0 {
                points[i] = Point {
                    x: (sx / count as f64).clamp(x_min, x_max),
                    y: (sy / count as f64).clamp(y_min, y_max),
                };
            }
        }
    }

    // Final triangulation
    let mut final_pts = points[..point_count].to_vec();
    let tris = triangulate(&mut final_pts, x_min, x_max, y_min, y_max);
    final_pts.truncate(point_count);

    let mut polylines: Vec<Vec<(f64, f64)>> = Vec::new();

    // Build edge-to-triangle adjacency
    let mut edge_map: std::collections::HashMap<(usize, usize), Vec<usize>> = std::collections::HashMap::new();
    for (i, tri) in tris.iter().enumerate() {
        let edges = [
            (tri.a.min(tri.b), tri.a.max(tri.b)),
            (tri.b.min(tri.c), tri.b.max(tri.c)),
            (tri.a.min(tri.c), tri.a.max(tri.c)),
        ];
        for &(ea, eb) in &edges {
            edge_map.entry((ea, eb)).or_default().push(i);
        }
    }

    // Voronoi edges: connect circumcenters of adjacent triangles
    for (_, tri_indices) in &edge_map {
        if tri_indices.len() != 2 {
            continue;
        }
        let c1 = circumcenter(&final_pts, &tris[tri_indices[0]]);
        let c2 = circumcenter(&final_pts, &tris[tri_indices[1]]);
        if let (Some(c1), Some(c2)) = (c1, c2) {
            if c1.x < x_min - 50.0 || c1.x > x_max + 50.0 || c1.y < y_min - 50.0 || c1.y > y_max + 50.0 {
                continue;
            }
            if c2.x < x_min - 50.0 || c2.x > x_max + 50.0 || c2.y < y_min - 50.0 || c2.y > y_max + 50.0 {
                continue;
            }
            polylines.push(vec![
                (c1.x.clamp(x_min, x_max), c1.y.clamp(y_min, y_max)),
                (c2.x.clamp(x_min, x_max), c2.y.clamp(y_min, y_max)),
            ]);
        }
    }

    // Optional cell fill
    if fill_cells {
        // Build Voronoi cells for each point
        let mut cell_verts: Vec<Vec<Point>> = vec![Vec::new(); point_count];
        for tri in &tris {
            if let Some(cc) = circumcenter(&final_pts, tri) {
                for &idx in &[tri.a, tri.b, tri.c] {
                    if idx < point_count {
                        cell_verts[idx].push(cc);
                    }
                }
            }
        }

        for i in 0..point_count {
            let verts = &mut cell_verts[i];
            if verts.len() < 3 {
                continue;
            }

            let center = &points[i.min(points.len() - 1)];
            verts.sort_by(|a, b| {
                let ang_a = (a.y - center.y).atan2(a.x - center.x);
                let ang_b = (b.y - center.y).atan2(b.x - center.x);
                ang_a.partial_cmp(&ang_b).unwrap_or(std::cmp::Ordering::Equal)
            });

            // Cell bounding box
            let mut min_x = f64::INFINITY;
            let mut max_x = f64::NEG_INFINITY;
            let mut min_y = f64::INFINITY;
            let mut max_y = f64::NEG_INFINITY;
            for v in verts.iter() {
                if v.x < min_x { min_x = v.x; }
                if v.x > max_x { max_x = v.x; }
                if v.y < min_y { min_y = v.y; }
                if v.y > max_y { max_y = v.y; }
            }

            let angle = if varied_angles { i as f64 * 2.399 } else { 0.0 };
            let ca = angle.cos();
            let sa = angle.sin();

            let cell_h = max_y - min_y;
            let cell_w = max_x - min_x;
            let extent = (cell_h * cell_h + cell_w * cell_w).sqrt();
            let spacing = extent / fill_density as f64;

            let fd = fill_density as isize;
            for li in -fd..=fd {
                let offset = li as f64 * spacing;
                let lx1 = center.x + ca * (-extent) - sa * offset;
                let ly1 = center.y + sa * (-extent) + ca * offset;
                let lx2 = center.x + ca * extent - sa * offset;
                let ly2 = center.y + sa * extent + ca * offset;

                // Intersect scan line with polygon
                let mut intersections: Vec<f64> = Vec::new();
                let nv = verts.len();
                for j in 0..nv {
                    let k = (j + 1) % nv;
                    let x1 = verts[j].x;
                    let y1 = verts[j].y;
                    let x2 = verts[k].x;
                    let y2 = verts[k].y;

                    let denom = (lx1 - lx2) * (y1 - y2) - (ly1 - ly2) * (x1 - x2);
                    if denom.abs() < 1e-10 {
                        continue;
                    }

                    let t = ((lx1 - x1) * (y1 - y2) - (ly1 - y1) * (x1 - x2)) / denom;
                    let u = -((lx1 - lx2) * (ly1 - y1) - (ly1 - ly2) * (lx1 - x1)) / denom;

                    if u >= 0.0 && u <= 1.0 && t >= 0.0 && t <= 1.0 {
                        intersections.push(t);
                    }
                }

                intersections.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));

                let mut j = 0;
                while j + 1 < intersections.len() {
                    let t1 = intersections[j];
                    let t2 = intersections[j + 1];
                    polylines.push(vec![
                        (lx1 + (lx2 - lx1) * t1, ly1 + (ly2 - ly1) * t1),
                        (lx1 + (lx2 - lx1) * t2, ly1 + (ly2 - ly1) * t2),
                    ]);
                    j += 2;
                }
            }
        }
    }

    encode_polylines_2d(&polylines).into_boxed_slice()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_basic_voronoi() {
        let input = vec![
            800.0,  // width
            600.0,  // height
            50.0,   // pointCount
            0.0,    // distribution = random
            0.0,    // relaxIterations
            0.0,    // fillCells = false
            6.0,    // fillDensity
            1.0,    // variedAngles
            30.0,   // margin
            0.0,    // seed
        ];
        let result = generate_voronoi(&input);
        assert!(result.len() >= 1);
        let num_polylines = result[0] as usize;
        assert!(num_polylines > 0, "should produce voronoi edges");

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
    fn test_with_fill() {
        let input = vec![
            400.0, 300.0, 30.0, 0.0, 0.0,
            1.0, // fillCells = true
            6.0, 1.0, 20.0, 0.0,
        ];
        let result = generate_voronoi(&input);
        let num_polylines = result[0] as usize;
        // With fill, should have more polylines than just edges
        assert!(num_polylines > 30, "fill should add many hatch segments");
    }

    #[test]
    fn test_with_relaxation() {
        let input = vec![
            400.0, 300.0, 30.0, 0.0,
            3.0, // relaxIterations
            0.0, 6.0, 1.0, 20.0, 0.0,
        ];
        let result = generate_voronoi(&input);
        assert!(result.len() >= 1);
        for &v in result.iter() {
            assert!(v.is_finite());
        }
    }

    #[test]
    fn test_all_distributions() {
        for dist in 0..3 {
            let input = vec![
                400.0, 300.0, 30.0, dist as f64, 0.0, 0.0, 6.0, 1.0, 20.0, 0.0,
            ];
            let result = generate_voronoi(&input);
            assert!(result.len() >= 1);
            for &v in result.iter() {
                assert!(v.is_finite(), "distribution {dist}: non-finite value");
            }
        }
    }

    #[test]
    fn test_empty_input() {
        let result = generate_voronoi(&[]);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0], 0.0);
    }
}
