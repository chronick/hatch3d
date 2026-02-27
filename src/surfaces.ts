import * as THREE from "three";

export type SurfaceFn = (u: number, v: number, params: Record<string, number>) => THREE.Vector3;

export interface SurfaceDefinition {
  name: string;
  fn: SurfaceFn;
  defaults: Record<string, number>;
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

export const SURFACES: Record<string, SurfaceDefinition> = {
  twistedRibbon: { name: "Twisted Ribbon", fn: twistedRibbon, defaults: { twist: 2, width: 1.2, height: 4, bulge: 0.3 } },
  hyperboloid: { name: "Hyperboloid", fn: ruledHyperboloid, defaults: { radius: 1.5, height: 3.5, twist: 1.2, waist: 0.4 } },
  canopy: { name: "Angular Canopy", fn: angularCanopy, defaults: { radius: 2, sag: 0.8, sharpness: 3, yOffset: 0 } },
  torus: { name: "Flat Torus", fn: flattenedTorus, defaults: { majorR: 2, minorR: 0.2, ySquish: 0.25 } },
  conoid: { name: "Conoid", fn: conoidSurface, defaults: { height: 3, spread: 2, fanAngle: 1.5 } },
};
