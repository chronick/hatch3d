import type { Composition3DDefinition, LayerConfig } from "../../types";

/**
 * Stipple Monolith — a dark rectangular slab standing on a ground plane,
 * rendered entirely as stipple density (no hatch lines anywhere), with an
 * analytically-projected cast shadow pooling on the ground.
 *
 * Reference: r/PlotterArt post 1u4v35p (monolith rendered in dots).
 *
 * Everything here rides on the `stipple` branch in `hatch.ts`: each dot is
 * a tiny 2-point polyline on the surface, so the normal projection +
 * hidden-line occlusion path handles it with no special casing.
 *
 * CAMERA: the scene reads best from a slightly low three-quarter view
 * (roughly theta ≈ 0.7 rad, phi ≈ 1.25 rad, dist ≈ 22). Camera state is
 * owned by the app shell, not by compositions — `CompositionPreset.values`
 * carries only controls/macros/hatchGroups — so this cannot be shipped as
 * a preset. Set it in the viewer.
 */

// ── Shadow geometry (exported, pure, testable) ──

export interface ShadowGeometry {
  /** Slab footprint extent along X. */
  slabWidth: number;
  /** Slab footprint extent along Z. */
  slabDepth: number;
  /** Slab extent along Y (it stands on the ground plane at y = 0). */
  slabHeight: number;
  /** Light azimuth in RADIANS, measured in the XZ plane from +X toward +Z. */
  lightAzimuth: number;
  /** Light elevation in RADIANS above the horizon. */
  lightElevation: number;
  /** Penumbra width in world units — how far the shadow edge fades. */
  softness: number;
}

/** Unit vector pointing from the scene toward the light. */
export function lightVector(
  azimuth: number,
  elevation: number,
): [number, number, number] {
  const ce = Math.cos(elevation);
  return [ce * Math.cos(azimuth), Math.sin(elevation), ce * Math.sin(azimuth)];
}

/**
 * Ground-plane displacement (dx, dz) from a slab corner at y = 0 to the
 * shadow of the corner directly above it at y = slabHeight.
 *
 * A point P casts to P - L * (P.y / L.y). Elevation is clamped away from the
 * horizon so a near-horizontal light does not produce an infinite shadow.
 */
export function shadowOffset(g: ShadowGeometry): [number, number] {
  const [lx, ly, lz] = lightVector(g.lightAzimuth, g.lightElevation);
  const lyClamped = Math.max(0.08, ly);
  const t = g.slabHeight / lyClamped;
  return [-lx * t, -lz * t];
}

function convexHull(pts: [number, number][]): [number, number][] {
  const sorted = [...pts].sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]));
  // Dedupe — a light directly overhead collapses the offset to zero, which
  // would otherwise feed the hull eight coincident pairs.
  const p: [number, number][] = [];
  for (const q of sorted) {
    const last = p[p.length - 1];
    if (last && Math.abs(last[0] - q[0]) < 1e-12 && Math.abs(last[1] - q[1]) < 1e-12) continue;
    p.push(q);
  }
  if (p.length < 3) return p;
  const cross = (
    o: [number, number],
    a: [number, number],
    b: [number, number],
  ) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

  const lower: [number, number][] = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) {
      lower.pop();
    }
    lower.push(q);
  }
  const upper: [number, number][] = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) {
      upper.pop();
    }
    upper.push(q);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

/**
 * The cast-shadow silhouette on the ground, as a convex polygon in (x, z).
 *
 * The slab is a box, so its shadow is the Minkowski sum of the footprint
 * rectangle with the projection segment {0 → shadowOffset} — i.e. the convex
 * hull of the footprint corners and those same corners translated by the
 * offset. That is exactly the shape a box sweeps when smeared away from a
 * directional light.
 */
export function shadowPolygon(g: ShadowGeometry): [number, number][] {
  const hw = Math.abs(g.slabWidth) / 2;
  const hd = Math.abs(g.slabDepth) / 2;
  const [ox, oz] = shadowOffset(g);
  const base: [number, number][] = [
    [-hw, -hd],
    [hw, -hd],
    [hw, hd],
    [-hw, hd],
  ];
  const pts: [number, number][] = base.slice();
  for (const [x, z] of base) pts.push([x + ox, z + oz]);
  return convexHull(pts);
}

/**
 * Signed distance from (x, z) to a convex polygon. Negative inside.
 */
export function convexPolygonSDF(
  x: number,
  z: number,
  poly: [number, number][],
): number {
  if (poly.length < 3) return Infinity;
  let minDist = Infinity;
  let inside = true;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const ex = b[0] - a[0];
    const ez = b[1] - a[1];
    const px = x - a[0];
    const pz = z - a[1];
    const len2 = ex * ex + ez * ez;
    const t = len2 > 0 ? Math.max(0, Math.min(1, (px * ex + pz * ez) / len2)) : 0;
    const dx = px - ex * t;
    const dz = pz - ez * t;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d < minDist) minDist = d;
    // convexHull emits counter-clockwise winding; a point left of every edge
    // (cross > 0) is inside.
    if (ex * pz - ez * px < 0) inside = false;
  }
  return inside ? -minDist : minDist;
}

/**
 * Shadow occupancy at a ground point: 1 fully inside the umbra, falling
 * smoothly to 0 across `softness` world units outside the silhouette.
 *
 * Pure and allocation-heavy (rebuilds the polygon per call) — intended for
 * tests and one-off queries. The composition uses `makeShadowField`.
 */
export function shadowDensityAt(x: number, z: number, g: ShadowGeometry): number {
  return shadowFalloff(convexPolygonSDF(x, z, shadowPolygon(g)), g.softness);
}

function shadowFalloff(d: number, softness: number): number {
  if (d <= 0) return 1;
  const w = Math.max(1e-6, softness);
  if (d >= w) return 0;
  const t = d / w;
  // smoothstep, inverted
  return 1 - t * t * (3 - 2 * t);
}

/** Precomputed shadow field — polygon built once, then cheap per-point queries. */
export function makeShadowField(g: ShadowGeometry): (x: number, z: number) => number {
  const poly = shadowPolygon(g);
  const softness = g.softness;
  return (x: number, z: number) => shadowFalloff(convexPolygonSDF(x, z, poly), softness);
}

// ── Ground density ──

export interface GroundDensityOptions {
  /** Ground plane half-extent; the plane spans [-groundSize, groundSize]. */
  groundSize: number;
  /** Ambient stipple density at the near (+Z) edge of the ground. */
  ambientNear: number;
  /** Ambient stipple density at the far (-Z) edge of the ground. */
  ambientFar: number;
  /** How much the cast shadow adds on top of ambient, 0..1. */
  shadowStrength: number;
}

/**
 * Ground densityFn in UV space: ambient depth gradient + cast shadow.
 * u maps to x over [-groundSize, groundSize]; v maps to z over the same.
 */
export function makeGroundDensityFn(
  g: ShadowGeometry,
  o: GroundDensityOptions,
): (u: number, v: number) => number {
  const shadow = makeShadowField(g);
  const span = 2 * o.groundSize;
  return (u: number, v: number): number => {
    const x = -o.groundSize + u * span;
    const z = -o.groundSize + v * span;
    // tDepth: 0 at the near edge (+Z, toward the default camera), 1 at the far edge.
    const tDepth = (o.groundSize - z) / span;
    const ambient = o.ambientNear + (o.ambientFar - o.ambientNear) * tDepth;
    const d = ambient + o.shadowStrength * shadow(x, z);
    return d > 1 ? 1 : d < 0 ? 0 : d;
  };
}

/**
 * Face density from the face normal vs the light direction: faces turned
 * away from the light get dense stipple, lit faces get sparse stipple.
 */
export function faceDensity(
  normal: [number, number, number],
  g: ShadowGeometry,
  litDensity: number,
  shadedDensity: number,
): number {
  const [lx, ly, lz] = lightVector(g.lightAzimuth, g.lightElevation);
  const brightness = Math.max(0, normal[0] * lx + normal[1] * ly + normal[2] * lz);
  return shadedDensity + (litDensity - shadedDensity) * brightness;
}

// ── Composition ──

const DEG = Math.PI / 180;

interface Face {
  name: string;
  normal: [number, number, number];
  corners: [number, number, number][]; // p00, p10, p11, p01
  extentU: number;
  extentV: number;
}

/** Slab faces (4 sides + top). The bottom sits flush on the ground and is never visible. */
function slabFaces(w: number, h: number, d: number): Face[] {
  const hw = w / 2;
  const hd = d / 2;
  return [
    {
      name: "front",
      normal: [0, 0, 1],
      corners: [
        [-hw, 0, hd],
        [hw, 0, hd],
        [hw, h, hd],
        [-hw, h, hd],
      ],
      extentU: w,
      extentV: h,
    },
    {
      name: "back",
      normal: [0, 0, -1],
      corners: [
        [hw, 0, -hd],
        [-hw, 0, -hd],
        [-hw, h, -hd],
        [hw, h, -hd],
      ],
      extentU: w,
      extentV: h,
    },
    {
      name: "right",
      normal: [1, 0, 0],
      corners: [
        [hw, 0, hd],
        [hw, 0, -hd],
        [hw, h, -hd],
        [hw, h, hd],
      ],
      extentU: d,
      extentV: h,
    },
    {
      name: "left",
      normal: [-1, 0, 0],
      corners: [
        [-hw, 0, -hd],
        [-hw, 0, hd],
        [-hw, h, hd],
        [-hw, h, -hd],
      ],
      extentU: d,
      extentV: h,
    },
    {
      name: "top",
      normal: [0, 1, 0],
      corners: [
        [-hw, h, hd],
        [hw, h, hd],
        [hw, h, -hd],
        [-hw, h, -hd],
      ],
      extentU: w,
      extentV: d,
    },
  ];
}

function rectFaceParams(corners: [number, number, number][]): Record<string, number> {
  const [p00, p10, p11, p01] = corners;
  return {
    p00x: p00[0], p00y: p00[1], p00z: p00[2],
    p10x: p10[0], p10y: p10[1], p10z: p10[2],
    p11x: p11[0], p11y: p11[1], p11z: p11[2],
    p01x: p01[0], p01y: p01[1], p01z: p01[2],
  };
}

/**
 * `stipple.dotsPerUnit` is per unit of *UV* length, but the controls express
 * density in dots per *world* unit so dot spacing stays consistent across
 * faces of different sizes. rectFace UV is always [0,1]², so the conversion
 * is a straight multiply by the face's world extent. A single scalar has to
 * cover both axes, so non-square faces use the geometric mean (mild
 * anisotropy, correct total count).
 */
function dotsPerUV(dotsPerWorldUnit: number, extentU: number, extentV: number): number {
  return dotsPerWorldUnit * Math.sqrt(Math.max(1e-6, extentU * extentV));
}

const stippleScene: Composition3DDefinition = {
  id: "stippleScene",
  name: "Stipple Monolith",
  description:
    "A slab standing on a ground plane, rendered purely in stipple: dot density carries the lighting, and an analytically projected cast shadow pools on the ground. Best viewed from a slightly low three-quarter camera (theta ~0.7, phi ~1.25, dist ~22).",
  tags: ["study", "stipple", "dots", "shadow", "monolith", "lighting"],
  category: "3d",
  hatchGroups: ["Ground", "Slab"],
  renderMode: "debounced",

  controls: {
    lightAzimuth: {
      type: "slider",
      label: "Light Azimuth",
      // 235° back-lights the slab and throws the shadow toward the viewer —
      // the reference monolith read: near-black front face, mid-tone left
      // face, long shadow pooling forward across the lit ground.
      default: 235,
      min: 0,
      max: 360,
      step: 1,
      group: "Light",
    },
    lightElevation: {
      type: "slider",
      label: "Light Elevation",
      default: 38,
      min: 5,
      max: 85,
      step: 1,
      group: "Light",
    },
    shadowSoftness: {
      type: "slider",
      label: "Shadow Softness",
      default: 0.5,
      min: 0.01,
      max: 4,
      step: 0.01,
      group: "Light",
    },
    shadowStrength: {
      type: "slider",
      label: "Shadow Strength",
      default: 0.9,
      min: 0,
      max: 1,
      step: 0.01,
      group: "Light",
    },
    stippleDensity: {
      type: "slider",
      label: "Stipple Density",
      default: 14,
      min: 3,
      max: 45,
      step: 0.5,
      group: "Stipple",
    },
    dotSize: {
      type: "slider",
      label: "Dot Size",
      default: 0.03,
      min: 0.004,
      max: 0.15,
      step: 0.002,
      group: "Stipple",
    },
    dotShape: {
      type: "select",
      label: "Dot Shape",
      default: "point",
      options: [
        { label: "Point", value: "point" },
        { label: "Cross", value: "cross" },
      ],
      group: "Stipple",
    },
    seed: {
      type: "slider",
      label: "Seed",
      default: 7,
      min: 1,
      max: 9999,
      step: 1,
      group: "Stipple",
    },
    slabWidth: {
      type: "slider",
      label: "Slab Width",
      default: 1.4,
      min: 0.2,
      max: 6,
      step: 0.05,
      group: "Slab",
    },
    slabHeight: {
      type: "slider",
      label: "Slab Height",
      default: 5.2,
      min: 0.5,
      max: 14,
      step: 0.1,
      group: "Slab",
    },
    slabDepth: {
      type: "slider",
      label: "Slab Depth",
      default: 0.6,
      min: 0.1,
      max: 4,
      step: 0.05,
      group: "Slab",
    },
    groundSize: {
      type: "slider",
      label: "Ground Size",
      default: 9,
      min: 3,
      max: 24,
      step: 0.5,
      group: "Ground",
    },
    ambientNear: {
      type: "slider",
      label: "Ground Near Tone",
      default: 0.08,
      min: 0,
      max: 1,
      step: 0.01,
      group: "Ground",
    },
    ambientFar: {
      type: "slider",
      label: "Ground Far Tone",
      default: 0.42,
      min: 0,
      max: 1,
      step: 0.01,
      group: "Ground",
    },
    slabLitTone: {
      type: "slider",
      label: "Slab Lit Tone",
      default: 0.1,
      min: 0,
      max: 1,
      step: 0.01,
      group: "Slab",
    },
    slabShadedTone: {
      type: "slider",
      label: "Slab Shaded Tone",
      default: 0.95,
      min: 0,
      max: 1,
      step: 0.01,
      group: "Slab",
    },
  },

  suggestedPresets: {
    lowSun: {
      name: "Low Sun",
      description: "Raking light, long shadow across the ground",
      values: {
        controls: {
          lightAzimuth: 200,
          lightElevation: 14,
          shadowSoftness: 1.2,
          shadowStrength: 0.95,
          stippleDensity: 16,
          dotSize: 0.03,
          dotShape: "point",
          seed: 7,
          slabWidth: 1.2,
          slabHeight: 6,
          slabDepth: 0.5,
          groundSize: 14,
          ambientNear: 0.06,
          ambientFar: 0.4,
          slabLitTone: 0.08,
          slabShadedTone: 0.98,
        },
      },
    },
    highNoon: {
      name: "High Noon",
      description: "Steep light, tight shadow pooled at the base",
      values: {
        controls: {
          lightAzimuth: 250,
          lightElevation: 72,
          shadowSoftness: 0.2,
          shadowStrength: 0.85,
          stippleDensity: 20,
          dotSize: 0.022,
          dotShape: "point",
          seed: 21,
          slabWidth: 1.6,
          slabHeight: 4.4,
          slabDepth: 0.8,
          groundSize: 8,
          ambientNear: 0.05,
          ambientFar: 0.3,
          slabLitTone: 0.06,
          slabShadedTone: 0.9,
        },
      },
    },
  },

  layers: (p): LayerConfig[] => {
    const v = p.values;
    const num = (key: string, fallback: number): number => {
      const raw = v[key];
      return typeof raw === "number" && Number.isFinite(raw) ? raw : fallback;
    };

    const slabWidth = num("slabWidth", 1.4);
    const slabHeight = num("slabHeight", 5.2);
    const slabDepth = num("slabDepth", 0.6);
    const groundSize = num("groundSize", 9);
    const density = num("stippleDensity", 14);
    const dotSize = num("dotSize", 0.03);
    const seed = Math.round(num("seed", 7));
    const shape = (v.dotShape as "point" | "cross") ?? "point";

    const geom: ShadowGeometry = {
      slabWidth,
      slabDepth,
      slabHeight,
      lightAzimuth: num("lightAzimuth", 235) * DEG,
      lightElevation: num("lightElevation", 38) * DEG,
      softness: num("shadowSoftness", 0.5),
    };

    const litTone = num("slabLitTone", 0.1);
    const shadedTone = num("slabShadedTone", 0.95);

    const layers: LayerConfig[] = [];

    // ── Ground plane: one big quad in XZ at y = 0 ──
    const groundDensityFn = makeGroundDensityFn(geom, {
      groundSize,
      ambientNear: num("ambientNear", 0.08),
      ambientFar: num("ambientFar", 0.42),
      shadowStrength: num("shadowStrength", 0.9),
    });

    layers.push({
      surface: "rectFace",
      params: rectFaceParams([
        [-groundSize, 0, -groundSize],
        [groundSize, 0, -groundSize],
        [groundSize, 0, groundSize],
        [-groundSize, 0, groundSize],
      ]),
      hatch: {
        densityFn: groundDensityFn,
        stipple: {
          dotsPerUnit: dotsPerUV(density, 2 * groundSize, 2 * groundSize),
          dotSize,
          shape,
          seed,
        },
      },
      group: "Ground",
    });

    // ── Slab faces ──
    slabFaces(slabWidth, slabHeight, slabDepth).forEach((face, i) => {
      const tone = faceDensity(face.normal, geom, litTone, shadedTone);
      layers.push({
        surface: "rectFace",
        params: rectFaceParams(face.corners),
        hatch: {
          densityFn: () => tone,
          stipple: {
            dotsPerUnit: dotsPerUV(density, face.extentU, face.extentV),
            dotSize,
            shape,
            seed: seed + 101 * (i + 1),
          },
        },
        group: "Slab",
      });
    });

    return layers;
  },
};

export default stippleScene;
