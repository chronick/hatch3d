import { describe, it, expect } from "vitest";
import stippleScene, {
  lightVector,
  shadowOffset,
  shadowPolygon,
  shadowDensityAt,
  makeShadowField,
  makeGroundDensityFn,
  faceDensity,
  type ShadowGeometry,
} from "../compositions/3d/studies/stipple-scene";
import type { Composition3DDefinition, ControlDef } from "../compositions/types";
import { SURFACES } from "../surfaces";
import { generateUVHatchLines } from "../hatch";

const DEG = Math.PI / 180;

function defaults(comp: Composition3DDefinition): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, c] of Object.entries(comp.controls ?? {})) {
    out[k] = (c as ControlDef).type === "image" ? null : (c as { default: unknown }).default;
  }
  return out;
}

function layersWith(overrides: Record<string, unknown> = {}) {
  return stippleScene.layers({
    surface: "rectFace",
    surfaceParams: {},
    hatchParams: { family: "u", count: 10, samples: 20 },
    values: { ...defaults(stippleScene), ...overrides },
  });
}

const baseGeom: ShadowGeometry = {
  slabWidth: 1.4,
  slabDepth: 0.6,
  slabHeight: 5.2,
  lightAzimuth: 215 * DEG,
  lightElevation: 38 * DEG,
  softness: 0.5,
};

describe("stippleScene metadata", () => {
  it("has valid core metadata", () => {
    expect(stippleScene.id).toBe("stippleScene");
    expect(stippleScene.name.length).toBeGreaterThan(0);
    expect(stippleScene.category).toBe("3d");
    expect(typeof stippleScene.layers).toBe("function");
  });

  it("declares every required control", () => {
    const required = [
      "lightAzimuth",
      "lightElevation",
      "stippleDensity",
      "dotSize",
      "shadowSoftness",
      "slabWidth",
      "slabHeight",
      "slabDepth",
      "seed",
    ];
    for (const key of required) {
      expect(stippleScene.controls?.[key], `missing control ${key}`).toBeDefined();
    }
  });

  it("control defaults sit inside their declared ranges", () => {
    for (const [key, c] of Object.entries(stippleScene.controls ?? {})) {
      if (c.type === "slider") {
        expect(c.default, key).toBeGreaterThanOrEqual(c.min);
        expect(c.default, key).toBeLessThanOrEqual(c.max);
      } else if (c.type === "select") {
        expect(c.options.map((o) => o.value)).toContain(c.default);
      }
    }
  });

  it("suggested presets only reference declared controls", () => {
    for (const [name, preset] of Object.entries(stippleScene.suggestedPresets ?? {})) {
      for (const key of Object.keys(preset.values.controls ?? {})) {
        expect(stippleScene.controls?.[key], `${name} → unknown control ${key}`).toBeDefined();
      }
    }
  });
});

describe("stippleScene layers()", () => {
  it("returns a ground plane plus five slab faces, all rectFace", () => {
    const layers = layersWith();
    expect(layers).toHaveLength(6);
    for (const l of layers) expect(l.surface).toBe("rectFace");
    expect(layers.filter((l) => l.group === "Ground")).toHaveLength(1);
    expect(layers.filter((l) => l.group === "Slab")).toHaveLength(5);
  });

  it("every layer carries stipple params and a densityFn", () => {
    for (const l of layersWith()) {
      expect(l.hatch.stipple).toBeDefined();
      expect(l.hatch.stipple!.dotsPerUnit).toBeGreaterThan(0);
      expect(l.hatch.stipple!.dotSize).toBeGreaterThan(0);
      expect(typeof l.hatch.densityFn).toBe("function");
    }
  });

  it("gives each layer a distinct seed so the dot fields decorrelate", () => {
    const seeds = layersWith().map((l) => l.hatch.stipple!.seed);
    expect(new Set(seeds).size).toBe(seeds.length);
  });

  it("all layers are WASM-incompatible (densityFn) so they take the JS stipple path", () => {
    for (const l of layersWith()) expect(l.hatch.densityFn).toBeTruthy();
  });

  it("slab geometry follows the slab* controls", () => {
    const layers = layersWith({ slabWidth: 2, slabHeight: 6, slabDepth: 1 });
    const slab = layers.filter((l) => l.group === "Slab");
    const ys: number[] = [];
    const xs: number[] = [];
    const zs: number[] = [];
    for (const l of slab) {
      for (const key of ["p00", "p10", "p11", "p01"]) {
        xs.push(l.params![`${key}x`]);
        ys.push(l.params![`${key}y`]);
        zs.push(l.params![`${key}z`]);
      }
    }
    expect(Math.min(...ys)).toBeCloseTo(0, 9); // stands on the ground
    expect(Math.max(...ys)).toBeCloseTo(6, 9);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(2, 9);
    expect(Math.max(...zs) - Math.min(...zs)).toBeCloseTo(1, 9);
  });

  it("the face pointing away from the light is denser than the face facing it", () => {
    // Light azimuth 0deg → +X. The +X face is lit, the -X face is shaded.
    const layers = layersWith({ lightAzimuth: 0, lightElevation: 20 });
    const slab = layers.filter((l) => l.group === "Slab");
    const toneOf = (targetX: number) => {
      const face = slab.find(
        (l) =>
          l.params!.p00x === targetX &&
          l.params!.p10x === targetX &&
          l.params!.p11x === targetX,
      )!;
      return face.hatch.densityFn!(0.5, 0.5);
    };
    const hw = (stippleScene.controls!.slabWidth as { default: number }).default / 2;
    expect(toneOf(-hw)).toBeGreaterThan(toneOf(hw));
  });

  it("layers actually render into short stipple polylines through hatch.ts", () => {
    const layers = layersWith({ stippleDensity: 4, groundSize: 4 });
    let total = 0;
    for (const l of layers) {
      const polylines = generateUVHatchLines(
        SURFACES[l.surface].fn,
        l.params ?? {},
        l.hatch,
      );
      for (const p of polylines) expect(p).toHaveLength(2);
      total += polylines.length;
    }
    expect(total).toBeGreaterThan(50);
  });

  it("is deterministic — the same values produce the same layer geometry", () => {
    const a = layersWith();
    const b = layersWith();
    expect(a.map((l) => l.params)).toEqual(b.map((l) => l.params));
    expect(a.map((l) => l.hatch.stipple)).toEqual(b.map((l) => l.hatch.stipple));
  });
});

describe("cast shadow geometry", () => {
  it("the light vector points up and away as specified", () => {
    const [x, y, z] = lightVector(0, 0);
    expect(x).toBeCloseTo(1, 9);
    expect(y).toBeCloseTo(0, 9);
    expect(z).toBeCloseTo(0, 9);
    expect(lightVector(0, Math.PI / 2)[1]).toBeCloseTo(1, 9);
  });

  it("shadow offset points opposite the light in the ground plane", () => {
    // Light from +X → shadow stretches toward -X
    const [ox, oz] = shadowOffset({ ...baseGeom, lightAzimuth: 0, lightElevation: 30 * DEG });
    expect(ox).toBeLessThan(0);
    expect(Math.abs(oz)).toBeLessThan(1e-9);
  });

  it("a lower sun makes a longer shadow", () => {
    const low = shadowOffset({ ...baseGeom, lightElevation: 10 * DEG });
    const high = shadowOffset({ ...baseGeom, lightElevation: 70 * DEG });
    const len = ([x, z]: [number, number]) => Math.hypot(x, z);
    expect(len(low)).toBeGreaterThan(len(high));
  });

  it("shadow polygon is convex, non-degenerate, and contains the footprint", () => {
    const poly = shadowPolygon(baseGeom);
    expect(poly.length).toBeGreaterThanOrEqual(4);
    // Footprint corners are inside (or on) the silhouette.
    const hw = baseGeom.slabWidth / 2;
    const hd = baseGeom.slabDepth / 2;
    for (const [x, z] of [
      [0, 0],
      [hw * 0.9, hd * 0.9],
      [-hw * 0.9, -hd * 0.9],
    ]) {
      expect(shadowDensityAt(x, z, baseGeom)).toBeCloseTo(1, 9);
    }
  });

  it("survives an overhead sun (zero offset collapses to the footprint)", () => {
    const overhead = { ...baseGeom, lightElevation: 90 * DEG };
    expect(shadowDensityAt(0, 0, overhead)).toBeCloseTo(1, 9);
    expect(shadowDensityAt(50, 50, overhead)).toBe(0);
  });
});

describe("shadow density function", () => {
  it("is higher inside the projected shadow rectangle than outside", () => {
    const g: ShadowGeometry = { ...baseGeom, lightAzimuth: 0, lightElevation: 30 * DEG };
    const [ox] = shadowOffset(g);
    // Midpoint of the smear, well inside the silhouette
    const inside = shadowDensityAt(ox * 0.5, 0, g);
    // Same distance on the opposite (lit) side — outside the shadow
    const outside = shadowDensityAt(-ox * 0.5, 0, g);
    expect(inside).toBeCloseTo(1, 9);
    expect(outside).toBe(0);
    expect(inside).toBeGreaterThan(outside);
  });

  it("falls off smoothly across the penumbra and is monotone non-increasing outward", () => {
    const g: ShadowGeometry = {
      ...baseGeom,
      lightAzimuth: 0,
      lightElevation: 30 * DEG,
      softness: 1.0,
    };
    const hd = g.slabDepth / 2;
    const [ox] = shadowOffset(g);
    const x = ox * 0.5;
    const samples = [0, 0.25, 0.5, 0.75, 1.0, 1.5].map((t) =>
      shadowDensityAt(x, hd + t, g),
    );
    for (let i = 1; i < samples.length; i++) {
      expect(samples[i]).toBeLessThanOrEqual(samples[i - 1] + 1e-12);
    }
    expect(samples[0]).toBeGreaterThan(0.9);
    expect(samples[samples.length - 1]).toBe(0);
    // Intermediate values prove a soft edge rather than a hard step
    expect(samples[2]).toBeGreaterThan(0);
    expect(samples[2]).toBeLessThan(1);
  });

  it("a larger softness widens the penumbra", () => {
    const hard = { ...baseGeom, lightAzimuth: 0, lightElevation: 30 * DEG, softness: 0.05 };
    const soft = { ...baseGeom, lightAzimuth: 0, lightElevation: 30 * DEG, softness: 2.0 };
    const [ox] = shadowOffset(hard);
    const probe = baseGeom.slabDepth / 2 + 0.6;
    expect(shadowDensityAt(ox * 0.5, probe, hard)).toBe(0);
    expect(shadowDensityAt(ox * 0.5, probe, soft)).toBeGreaterThan(0);
  });

  it("moving lightAzimuth moves the shadow", () => {
    const east: ShadowGeometry = { ...baseGeom, lightAzimuth: 0, lightElevation: 30 * DEG };
    const west: ShadowGeometry = {
      ...baseGeom,
      lightAzimuth: Math.PI,
      lightElevation: 30 * DEG,
    };
    const [ox] = shadowOffset(east);
    const probe = ox * 0.7; // deep in the east-lit shadow, on the -X side
    expect(shadowDensityAt(probe, 0, east)).toBeCloseTo(1, 9);
    expect(shadowDensityAt(probe, 0, west)).toBe(0);
    // and the mirrored probe flips
    expect(shadowDensityAt(-probe, 0, west)).toBeCloseTo(1, 9);
    expect(shadowDensityAt(-probe, 0, east)).toBe(0);
  });

  it("sweeping the azimuth sweeps the shadow centroid around the slab", () => {
    const angles = [0, 90, 180, 270].map((deg) =>
      shadowOffset({ ...baseGeom, lightAzimuth: deg * DEG, lightElevation: 30 * DEG }),
    );
    expect(angles[0][0]).toBeLessThan(0); // light from +X → shadow to -X
    expect(angles[1][1]).toBeLessThan(0); // light from +Z → shadow to -Z
    expect(angles[2][0]).toBeGreaterThan(0);
    expect(angles[3][1]).toBeGreaterThan(0);
  });

  it("makeShadowField matches the standalone pure function", () => {
    const field = makeShadowField(baseGeom);
    for (const [x, z] of [
      [0, 0],
      [1, 1],
      [-2, 0.4],
      [3.5, -3.5],
      [0.2, -0.9],
    ]) {
      expect(field(x, z)).toBeCloseTo(shadowDensityAt(x, z, baseGeom), 12);
    }
  });
});

describe("ground density function", () => {
  const opts = {
    groundSize: 9,
    ambientNear: 0.08,
    ambientFar: 0.42,
    shadowStrength: 0.9,
  };

  it("stays inside [0, 1] across the whole plane", () => {
    const fn = makeGroundDensityFn(baseGeom, opts);
    for (let i = 0; i <= 20; i++) {
      for (let j = 0; j <= 20; j++) {
        const d = fn(i / 20, j / 20);
        expect(d).toBeGreaterThanOrEqual(0);
        expect(d).toBeLessThanOrEqual(1);
      }
    }
  });

  it("applies an ambient depth gradient — far edge denser than near edge", () => {
    // Query a lit strip well away from the slab and its shadow.
    const g: ShadowGeometry = { ...baseGeom, lightAzimuth: 0, lightElevation: 40 * DEG };
    const fn = makeGroundDensityFn(g, opts);
    const near = fn(0.95, 0.98); // z ≈ +9 (near edge)
    const far = fn(0.95, 0.02); // z ≈ -9 (far edge)
    expect(far).toBeGreaterThan(near);
    expect(near).toBeCloseTo(opts.ambientNear, 1);
  });

  it("boosts density inside the cast shadow relative to the same depth outside it", () => {
    const g: ShadowGeometry = { ...baseGeom, lightAzimuth: 0, lightElevation: 30 * DEG };
    const fn = makeGroundDensityFn(g, opts);
    const [ox] = shadowOffset(g);
    const toU = (x: number) => (x + opts.groundSize) / (2 * opts.groundSize);
    const vMid = 0.5; // z = 0
    const inShadow = fn(toU(ox * 0.5), vMid);
    const outShadow = fn(toU(-ox * 0.5), vMid);
    expect(inShadow).toBeGreaterThan(outShadow);
    expect(inShadow - outShadow).toBeGreaterThan(0.5);
  });
});

describe("faceDensity", () => {
  it("a face pointing at the light is sparse; a face pointing away is dense", () => {
    const g: ShadowGeometry = { ...baseGeom, lightAzimuth: 0, lightElevation: 0 };
    const lit = faceDensity([1, 0, 0], g, 0.1, 0.95);
    const away = faceDensity([-1, 0, 0], g, 0.1, 0.95);
    expect(lit).toBeCloseTo(0.1, 9);
    expect(away).toBeCloseTo(0.95, 9);
  });

  it("is monotone in the angle between normal and light", () => {
    const g: ShadowGeometry = { ...baseGeom, lightAzimuth: 0, lightElevation: 0 };
    let prev = -Infinity;
    for (let deg = 0; deg <= 90; deg += 15) {
      const a = deg * DEG;
      const d = faceDensity([Math.cos(a), 0, Math.sin(a)], g, 0.1, 0.95);
      expect(d).toBeGreaterThanOrEqual(prev - 1e-12);
      prev = d;
    }
  });
});
