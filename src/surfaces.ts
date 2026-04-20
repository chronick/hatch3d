import * as THREE from "three";

export type SurfaceFn = (u: number, v: number, params: Record<string, number>) => THREE.Vector3;

export interface SurfaceDefinition {
  name: string;
  fn: SurfaceFn;
  defaults: Record<string, number>;
  /**
   * Optional override for UV-grid segment count used by `buildSurfaceMesh`.
   * Flat parametric surfaces like `rectFace` only need 1x1 (2 triangles)
   * to rasterize correctly, so requesting the default 24x24 (1152 tris)
   * is 576× wasted work per layer. Curved surfaces leave this undefined
   * and get the engine default.
   */
  meshSegs?: [number, number];
}

function twistedRibbon(u: number, v: number, params: Record<string, number>): THREE.Vector3 {
  const { twist = 2, width = 1.2, height = 4, bulge = 0.3 } = params;
  const t = (v - 0.5) * height;
  const angle = v * twist * Math.PI;
  const r = (u - 0.5) * width * (1 + bulge * Math.sin(v * Math.PI * 3));
  return new THREE.Vector3(
    r * Math.cos(angle),
    t,
    r * Math.sin(angle)
  );
}

function ruledHyperboloid(u: number, v: number, params: Record<string, number>): THREE.Vector3 {
  const { radius = 1.5, height = 3.5, twist = 1.2, waist = 0.4 } = params;
  const t = (v - 0.5) * height;
  const r = radius * (1 - waist * (1 - Math.pow(2 * v - 1, 2)));
  const angle = u * Math.PI * 2 + v * twist * Math.PI;
  return new THREE.Vector3(
    r * Math.cos(angle),
    t,
    r * Math.sin(angle)
  );
}

function angularCanopy(u: number, v: number, params: Record<string, number>): THREE.Vector3 {
  const { radius = 2, sag = 0.8, sharpness = 3, yOffset = 0 } = params;
  const angle = u * Math.PI * 2;
  const r = radius * (0.3 + 0.7 * v);
  const spikeFreq = sharpness;
  const spike = 0.3 * Math.pow(Math.abs(Math.sin(angle * spikeFreq)), 2);
  const y = yOffset + sag * (1 - v) * (1 + spike) - sag * 0.5;
  return new THREE.Vector3(
    r * Math.cos(angle),
    y,
    r * Math.sin(angle)
  );
}

function flattenedTorus(u: number, v: number, params: Record<string, number>): THREE.Vector3 {
  const { majorR = 2, minorR = 0.2, ySquish = 0.25 } = params;
  const a = u * Math.PI * 2;
  const b = v * Math.PI * 2;
  return new THREE.Vector3(
    (majorR + minorR * Math.cos(b)) * Math.cos(a),
    minorR * Math.sin(b) * ySquish,
    (majorR + minorR * Math.cos(b)) * Math.sin(a)
  );
}

function conoidSurface(u: number, v: number, params: Record<string, number>): THREE.Vector3 {
  const { height = 3, spread = 2, fanAngle = 1.5 } = params;
  const t = (v - 0.5) * height;
  const fan = u * fanAngle * Math.PI;
  const r = spread * v;
  return new THREE.Vector3(
    r * Math.cos(fan),
    t,
    r * Math.sin(fan)
  );
}

// Bilinear-interpolated flat quad from 4 corners. Used as a building block
// for compositions that assemble complex geometry from many flat faces —
// e.g. heightfield terrains where each top cap and wall is one quad. Corner
// order follows UV: p00 at (0,0), p10 at (1,0), p11 at (1,1), p01 at (0,1).
function rectFace(u: number, v: number, params: Record<string, number>): THREE.Vector3 {
  const {
    p00x = 0, p00y = 0, p00z = 0,
    p10x = 1, p10y = 0, p10z = 0,
    p11x = 1, p11y = 0, p11z = 1,
    p01x = 0, p01y = 0, p01z = 1,
  } = params;
  const a = (1 - u) * (1 - v);
  const b = u * (1 - v);
  const c = u * v;
  const d = (1 - u) * v;
  return new THREE.Vector3(
    a * p00x + b * p10x + c * p11x + d * p01x,
    a * p00y + b * p10y + c * p11y + d * p01y,
    a * p00z + b * p10z + c * p11z + d * p01z,
  );
}

export const SURFACES: Record<string, SurfaceDefinition> = {
  twistedRibbon: { name: "Twisted Ribbon", fn: twistedRibbon, defaults: { twist: 2, width: 1.2, height: 4, bulge: 0.3 } },
  hyperboloid: { name: "Hyperboloid", fn: ruledHyperboloid, defaults: { radius: 1.5, height: 3.5, twist: 1.2, waist: 0.4 } },
  canopy: { name: "Angular Canopy", fn: angularCanopy, defaults: { radius: 2, sag: 0.8, sharpness: 3, yOffset: 0 } },
  torus: { name: "Flat Torus", fn: flattenedTorus, defaults: { majorR: 2, minorR: 0.2, ySquish: 0.25 } },
  conoid: { name: "Conoid", fn: conoidSurface, defaults: { height: 3, spread: 2, fanAngle: 1.5 } },
  rectFace: {
    name: "Rect Face",
    fn: rectFace,
    defaults: {
      p00x: 0, p00y: 0, p00z: 0,
      p10x: 1, p10y: 0, p10z: 0,
      p11x: 1, p11y: 0, p11z: 1,
      p01x: 0, p01y: 0, p01z: 1,
    },
    // Flat quad — a single 1x1 subdivision (2 triangles) rasterizes to
    // the exact same depth buffer as 24x24 (1152 triangles). Compositions
    // that emit hundreds of rectFace layers (e.g. sentinelTerrain3D) go
    // from ~700k total triangles to ~1.2k.
    meshSegs: [1, 1],
  },
};
