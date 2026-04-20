import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { SURFACES } from "../surfaces";

describe("surfaces", () => {
  it("exports all registered surfaces", () => {
    expect(Object.keys(SURFACES)).toEqual([
      "twistedRibbon",
      "hyperboloid",
      "canopy",
      "torus",
      "conoid",
      "rectFace",
    ]);
  });

  it.each(Object.entries(SURFACES))("%s returns Vector3 at defaults", (_key, surface) => {
    const result = surface.fn(0.5, 0.5, surface.defaults);
    expect(result).toBeInstanceOf(THREE.Vector3);
    expect(Number.isFinite(result.x)).toBe(true);
    expect(Number.isFinite(result.y)).toBe(true);
    expect(Number.isFinite(result.z)).toBe(true);
  });

  it.each(Object.entries(SURFACES))("%s returns different points for different UV", (_key, surface) => {
    const a = surface.fn(0, 0, surface.defaults);
    const b = surface.fn(1, 1, surface.defaults);
    expect(a.distanceTo(b)).toBeGreaterThan(0);
  });
});
