/// Parametric surface functions ported from src/surfaces.ts.
///
/// Each function takes (u, v, params) and returns (x, y, z).
/// Surface IDs:
///   0 = twistedRibbon
///   1 = hyperboloid (ruledHyperboloid)
///   2 = canopy (angularCanopy)
///   3 = torus (flattenedTorus)
///   4 = conoid (conoidSurface)

use std::f64::consts::PI;

/// Evaluate a surface by ID. Returns (x, y, z).
/// `params` is a 4-element slice [param0, param1, param2, param3].
pub fn evaluate_surface(surface_id: u32, u: f64, v: f64, params: &[f64; 4]) -> (f64, f64, f64) {
    match surface_id {
        0 => twisted_ribbon(u, v, params),
        1 => ruled_hyperboloid(u, v, params),
        2 => angular_canopy(u, v, params),
        3 => flattened_torus(u, v, params),
        4 => conoid_surface(u, v, params),
        _ => (0.0, 0.0, 0.0),
    }
}

/// twistedRibbon: params = [twist, width, height, bulge]
/// defaults: [2, 1.2, 4, 0.3]
fn twisted_ribbon(u: f64, v: f64, params: &[f64; 4]) -> (f64, f64, f64) {
    let twist = params[0];
    let width = params[1];
    let height = params[2];
    let bulge = params[3];

    let t = (v - 0.5) * height;
    let angle = v * twist * PI;
    let r = (u - 0.5) * width * (1.0 + bulge * (v * PI * 3.0).sin());

    (r * angle.cos(), t, r * angle.sin())
}

/// ruledHyperboloid: params = [radius, height, twist, waist]
/// defaults: [1.5, 3.5, 1.2, 0.4]
fn ruled_hyperboloid(u: f64, v: f64, params: &[f64; 4]) -> (f64, f64, f64) {
    let radius = params[0];
    let height = params[1];
    let twist = params[2];
    let waist = params[3];

    let t = (v - 0.5) * height;
    let r = radius * (1.0 - waist * (1.0 - (2.0 * v - 1.0).powi(2)));
    let angle = u * PI * 2.0 + v * twist * PI;

    (r * angle.cos(), t, r * angle.sin())
}

/// angularCanopy: params = [radius, sag, sharpness, yOffset]
/// defaults: [2, 0.8, 3, 0]
fn angular_canopy(u: f64, v: f64, params: &[f64; 4]) -> (f64, f64, f64) {
    let radius = params[0];
    let sag = params[1];
    let sharpness = params[2];
    let y_offset = params[3];

    let angle = u * PI * 2.0;
    let r = radius * (0.3 + 0.7 * v);
    let spike_freq = sharpness;
    let spike = 0.3 * (angle * spike_freq).sin().abs().powi(2);
    let y = y_offset + sag * (1.0 - v) * (1.0 + spike) - sag * 0.5;

    (r * angle.cos(), y, r * angle.sin())
}

/// flattenedTorus: params = [majorR, minorR, ySquish, _unused]
/// defaults: [2, 0.2, 0.25, 0]
fn flattened_torus(u: f64, v: f64, params: &[f64; 4]) -> (f64, f64, f64) {
    let major_r = params[0];
    let minor_r = params[1];
    let y_squish = params[2];

    let a = u * PI * 2.0;
    let b = v * PI * 2.0;

    (
        (major_r + minor_r * b.cos()) * a.cos(),
        minor_r * b.sin() * y_squish,
        (major_r + minor_r * b.cos()) * a.sin(),
    )
}

/// conoidSurface: params = [height, spread, fanAngle, _unused]
/// defaults: [3, 2, 1.5, 0]
fn conoid_surface(u: f64, v: f64, params: &[f64; 4]) -> (f64, f64, f64) {
    let height = params[0];
    let spread = params[1];
    let fan_angle = params[2];

    let t = (v - 0.5) * height;
    let fan = u * fan_angle * PI;
    let r = spread * v;

    (r * fan.cos(), t, r * fan.sin())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn approx_eq(a: f64, b: f64) -> bool {
        (a - b).abs() < 1e-10
    }

    #[test]
    fn test_twisted_ribbon_center() {
        // u=0.5, v=0.5 → r=0 (since u-0.5=0), so x=0, z=0
        let (x, y, z) = twisted_ribbon(0.5, 0.5, &[2.0, 1.2, 4.0, 0.3]);
        assert!(approx_eq(x, 0.0), "x={x}");
        assert!(approx_eq(y, 0.0), "y={y}"); // (0.5-0.5)*4 = 0
        assert!(approx_eq(z, 0.0), "z={z}");
    }

    #[test]
    fn test_hyperboloid_origin() {
        // u=0, v=0.5 → t=0, angle=0 + 0.5*1.2*PI
        let (x, y, z) = ruled_hyperboloid(0.0, 0.5, &[1.5, 3.5, 1.2, 0.4]);
        assert!(approx_eq(y, 0.0), "y={y}");
        // r = 1.5 * (1 - 0.4*(1 - 0)) = 1.5 * 0.6 = 0.9
        let r = 0.9_f64;
        let angle = 0.5 * 1.2 * PI;
        assert!(approx_eq(x, r * angle.cos()), "x={x}");
        assert!(approx_eq(z, r * angle.sin()), "z={z}");
    }

    #[test]
    fn test_flattened_torus_basic() {
        // u=0, v=0 → a=0, b=0 → x = majorR + minorR, y=0, z=0
        let (x, y, z) = flattened_torus(0.0, 0.0, &[2.0, 0.2, 0.25, 0.0]);
        assert!(approx_eq(x, 2.2), "x={x}");
        assert!(approx_eq(y, 0.0), "y={y}");
        assert!(approx_eq(z, 0.0), "z={z}");
    }

    #[test]
    fn test_conoid_at_origin() {
        // u=0, v=0 → r=0, so x=0,z=0; t=(0-0.5)*3=-1.5
        let (x, y, z) = conoid_surface(0.0, 0.0, &[3.0, 2.0, 1.5, 0.0]);
        assert!(approx_eq(x, 0.0), "x={x}");
        assert!(approx_eq(y, -1.5), "y={y}");
        assert!(approx_eq(z, 0.0), "z={z}");
    }

    #[test]
    fn test_all_surfaces_via_dispatch() {
        let params = [1.0, 1.0, 1.0, 0.0];
        for id in 0..5 {
            let (x, y, z) = evaluate_surface(id, 0.5, 0.5, &params);
            assert!(x.is_finite(), "surface {id} x not finite");
            assert!(y.is_finite(), "surface {id} y not finite");
            assert!(z.is_finite(), "surface {id} z not finite");
        }
    }
}
