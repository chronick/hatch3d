import { describe, it, expect } from "vitest";
import type { Composition2DDefinition, Composition3DDefinition } from "../compositions/types";
import { CompositionRegistry } from "../compositions/registry";
import { extractFeatures, macrosToValues } from "../preferences/features";
import { computeModel, summarizeModel } from "../preferences/learner";
import { generateBiasedPresets, mutatePreset } from "../preferences/generator";
import type { Observation, PreferenceModel } from "../preferences/types";

// ── Test fixtures ──

function makeComp2D(): Composition2DDefinition {
  return {
    id: "testFlow",
    name: "Test Flow",
    type: "2d",
    category: "2d",
    tags: ["generative", "organic"],
    macros: {
      density: {
        label: "Density",
        default: 0.5,
        targets: [
          { param: "seedSpacing", fn: "linear", strength: -0.6 },
          { param: "maxSteps", fn: "linear", strength: 0.5 },
        ],
      },
    },
    controls: {
      seedSpacing: { type: "slider", label: "Seed Spacing", default: 10, min: 2, max: 30, step: 1, group: "Layout" },
      maxSteps: { type: "slider", label: "Max Steps", default: 400, min: 50, max: 1000, step: 10, group: "Layout" },
      noiseScale: { type: "slider", label: "Noise Scale", default: 0.005, min: 0.001, max: 0.02, step: 0.001, group: "Noise" },
      arrangement: { type: "select", label: "Arrangement", default: "random", options: [{ label: "Random", value: "random" }, { label: "Grid", value: "grid" }], group: "Layout" },
    },
    generate: () => [],
  };
}

function makeComp3D(): Composition3DDefinition {
  return {
    id: "testCage",
    name: "Test Cage",
    category: "3d",
    tags: ["3d", "organic"],
    controls: {
      ribbons: { type: "slider", label: "Ribbons", default: 8, min: 2, max: 30, step: 1, group: "Shape" },
      twist: { type: "slider", label: "Twist", default: 2, min: 0, max: 6, step: 0.1, group: "Shape" },
    },
    layers: (p) => [{ surface: p.surface, params: p.surfaceParams, hatch: p.hatchParams }],
  };
}

function makeObservation(overrides: Partial<Observation> = {}): Observation {
  const comp = makeComp2D();
  const values = { seedSpacing: 8, maxSteps: 600, noiseScale: 0.008, arrangement: "random" };
  const stats = { lines: 200, verts: 50000, paths: 200 };
  return {
    id: `test-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
    composition: "testFlow",
    presetName: "Test Preset",
    values,
    camera: null,
    tags: ["generative", "organic"],
    stats,
    outcome: "accepted",
    features: extractFeatures(comp, values, stats),
    ...overrides,
  };
}

// ── Feature extraction tests ──

describe("extractFeatures", () => {
  const comp = makeComp2D();

  it("normalizes slider controls to 0-1", () => {
    const features = extractFeatures(comp, { seedSpacing: 10, maxSteps: 400, noiseScale: 0.005 }, { lines: 100, verts: 10000, paths: 100 });
    // seedSpacing: (10 - 2) / (30 - 2) = 8/28 ≈ 0.286
    expect(features.controlPositions.seedSpacing).toBeCloseTo(8 / 28, 2);
    // maxSteps: (400 - 50) / (1000 - 50) = 350/950 ≈ 0.368
    expect(features.controlPositions.maxSteps).toBeCloseTo(350 / 950, 2);
  });

  it("computes category correctly", () => {
    const features2d = extractFeatures(makeComp2D(), {}, { lines: 0, verts: 0, paths: 0 });
    expect(features2d.category).toBe("2d");

    const features3d = extractFeatures(makeComp3D(), {}, { lines: 0, verts: 0, paths: 0 });
    expect(features3d.category).toBe("3d");
  });

  it("computes path and vertex density", () => {
    const features = extractFeatures(comp, {}, { lines: 200, verts: 60000, paths: 200 });
    expect(features.pathDensity).toBeCloseTo(200 / (800 * 800 / 1000), 2);
    expect(features.vertexDensity).toBe(300); // 60000 / 200
  });

  it("handles missing values gracefully", () => {
    const features = extractFeatures(comp, {}, { lines: 0, verts: 0, paths: 0 });
    expect(features.compositionId).toBe("testFlow");
    expect(features.vertexDensity).toBe(0);
  });

  it("reverse-computes macro values", () => {
    // At default macro values (0.5), seedSpacing=10, maxSteps=400
    // Increase density → seedSpacing goes down, maxSteps goes up
    const highDensity = extractFeatures(comp, { seedSpacing: 4, maxSteps: 700 }, { lines: 0, verts: 0, paths: 0 });
    const lowDensity = extractFeatures(comp, { seedSpacing: 20, maxSteps: 200 }, { lines: 0, verts: 0, paths: 0 });

    // High density should have higher macro value than low density
    expect(highDensity.macroValues.density).toBeGreaterThan(lowDensity.macroValues.density);
  });
});

// ── macrosToValues round-trip tests ──

describe("macrosToValues", () => {
  const comp = makeComp2D();

  it("returns defaults when macros are at default", () => {
    const values = macrosToValues(comp, { density: 0.5 });
    expect(values.seedSpacing).toBe(10);
    expect(values.maxSteps).toBe(400);
    // noiseScale is not a macro target, so stays at default
    expect(values.noiseScale).toBe(0.005);
  });

  it("high density decreases seedSpacing and increases maxSteps", () => {
    const high = macrosToValues(comp, { density: 0.9 });
    const low = macrosToValues(comp, { density: 0.1 });
    expect(high.seedSpacing as number).toBeLessThan(low.seedSpacing as number);
    expect(high.maxSteps as number).toBeGreaterThan(low.maxSteps as number);
  });

  it("clamps values to control min/max", () => {
    const extreme = macrosToValues(comp, { density: 1.0 });
    expect(extreme.seedSpacing as number).toBeGreaterThanOrEqual(2);
    expect(extreme.maxSteps as number).toBeLessThanOrEqual(1000);
  });
});

// ── Learner tests ──

describe("computeModel", () => {
  it("returns empty model with no observations", () => {
    const model = computeModel([]);
    expect(model.observationCount).toBe(0);
    expect(Object.keys(model.compositionScores)).toHaveLength(0);
  });

  it("computes composition scores with Bayesian smoothing", () => {
    const observations: Observation[] = [
      makeObservation({ outcome: "accepted" }),
      makeObservation({ outcome: "accepted" }),
      makeObservation({ outcome: "rejected" }),
    ];

    const model = computeModel(observations);
    const score = model.compositionScores.testFlow;
    expect(score.accepted).toBe(2);
    expect(score.rejected).toBe(1);
    // Bayesian: (2 + 1) / (3 + 2) = 0.6
    expect(score.score).toBeCloseTo(0.6, 2);
  });

  it("gives neutral score (0.5) with no data", () => {
    // A composition with 0 accepted, 0 rejected should score ~0.5
    // No composition scores at all when empty, but verify the scoring function
    // by adding a single observation with equal accept/reject
    const obs = [
      makeObservation({ outcome: "accepted" }),
      makeObservation({ outcome: "rejected" }),
    ];
    const m = computeModel(obs);
    // (1+1)/(2+2) = 0.5
    expect(m.compositionScores.testFlow.score).toBeCloseTo(0.5, 2);
  });

  it("computes tag scores", () => {
    const obs = [
      makeObservation({ outcome: "accepted", tags: ["dense", "fluid"] }),
      makeObservation({ outcome: "rejected", tags: ["sparse", "fluid"] }),
    ];
    // Manually set features tags to match
    obs[0].features.tags = ["dense", "fluid"];
    obs[1].features.tags = ["sparse", "fluid"];

    const model = computeModel(obs);
    expect(model.tagScores.dense.score).toBeGreaterThan(model.tagScores.sparse.score);
    // "fluid" appears in both, should be neutral
    expect(model.tagScores.fluid.score).toBeCloseTo(0.5, 2);
  });

  it("computes stat preferences", () => {
    const accepted = makeObservation({ outcome: "accepted" });
    accepted.features.pathDensity = 0.5;
    const rejected = makeObservation({ outcome: "rejected" });
    rejected.features.pathDensity = 2.0;

    const model = computeModel([accepted, rejected]);
    expect(model.statPreferences.pathDensity.preferredMean).toBeCloseTo(0.5, 2);
    expect(model.statPreferences.pathDensity.rejectedMean).toBeCloseTo(2.0, 2);
  });

  it("summarizeModel produces readable output", () => {
    const obs = [
      makeObservation({ outcome: "accepted" }),
      makeObservation({ outcome: "rejected" }),
    ];
    const model = computeModel(obs);
    const summary = summarizeModel(model);
    expect(summary).toContain("Preference Model v1");
    expect(summary).toContain("testFlow");
    expect(summary).toContain("Composition affinity:");
  });
});

// ── Generator tests ──

describe("generateBiasedPresets", () => {
  function makeRegistry(): CompositionRegistry {
    const reg = new CompositionRegistry();
    reg.register(makeComp2D());
    reg.register(makeComp3D());
    return reg;
  }

  function makeModel(): PreferenceModel {
    return computeModel([
      makeObservation({ outcome: "accepted", composition: "testFlow" }),
      makeObservation({ outcome: "accepted", composition: "testFlow" }),
      makeObservation({ outcome: "rejected", composition: "testCage",
        features: extractFeatures(makeComp3D(), { ribbons: 5, twist: 1 }, { lines: 50, verts: 5000, paths: 50 }),
      }),
    ]);
  }

  it("generates the requested number of presets", () => {
    const presets = generateBiasedPresets(makeModel(), makeRegistry(), { count: 5 });
    expect(presets).toHaveLength(5);
  });

  it("each preset has required fields", () => {
    const presets = generateBiasedPresets(makeModel(), makeRegistry(), { count: 3 });
    for (const p of presets) {
      expect(p.composition).toBeTruthy();
      expect(p.name).toBeTruthy();
      expect(p.values).toBeDefined();
      expect(p.tags).toBeDefined();
      expect(["preference", "exploration", "mutation", "preset"]).toContain(p.source);
      expect(typeof p.confidence).toBe("number");
    }
  });

  it("respects forceComposition", () => {
    const presets = generateBiasedPresets(makeModel(), makeRegistry(), {
      count: 5,
      forceComposition: "testFlow",
    });
    for (const p of presets) {
      expect(p.composition).toBe("testFlow");
    }
  });

  it("full exploration generates from all compositions", () => {
    // With explorationRate=1, we should get random compositions
    const presets = generateBiasedPresets(makeModel(), makeRegistry(), {
      count: 20,
      explorationRate: 1.0,
    });
    const compositions = new Set(presets.map((p) => p.composition));
    // With 20 presets and 2 compositions, both should appear
    expect(compositions.size).toBe(2);
  });

  it("generates values within control ranges", () => {
    const presets = generateBiasedPresets(makeModel(), makeRegistry(), {
      count: 10,
      forceComposition: "testFlow",
    });
    for (const p of presets) {
      if (p.values.seedSpacing !== undefined) {
        expect(p.values.seedSpacing as number).toBeGreaterThanOrEqual(2);
        expect(p.values.seedSpacing as number).toBeLessThanOrEqual(30);
      }
      if (p.values.maxSteps !== undefined) {
        expect(p.values.maxSteps as number).toBeGreaterThanOrEqual(50);
        expect(p.values.maxSteps as number).toBeLessThanOrEqual(1000);
      }
    }
  });

  it("uses mutation when acceptedObservations provided", () => {
    const observations = [
      makeObservation({ outcome: "accepted", composition: "testFlow" }),
      makeObservation({ outcome: "accepted", composition: "testFlow" }),
    ];

    const presets = generateBiasedPresets(makeModel(), makeRegistry(), {
      count: 20,
      mutationRate: 1.0, // Force all exploitation slots to mutation
      explorationRate: 0,
      acceptedObservations: observations,
      forceComposition: "testFlow",
    });

    const mutationPresets = presets.filter((p) => p.source === "mutation");
    expect(mutationPresets.length).toBeGreaterThan(0);

    for (const p of mutationPresets) {
      expect(p.parentId).toBeTruthy();
      expect(p.tags).toContain("mutation");
    }
  });

  it("falls back to preference when no accepted observations available", () => {
    const presets = generateBiasedPresets(makeModel(), makeRegistry(), {
      count: 5,
      mutationRate: 1.0,
      explorationRate: 0,
      acceptedObservations: [], // No parents available
      forceComposition: "testFlow",
    });

    // Should all be preference since mutation has no parents
    for (const p of presets) {
      expect(p.source).not.toBe("mutation");
    }
  });
});

// ── Mutation tests ──

describe("mutatePreset", () => {
  it("preserves composition and produces nearby values", () => {
    const comp = makeComp2D();
    const parent = makeObservation({ composition: "testFlow" });

    const mutant = mutatePreset(comp, parent);

    expect(mutant.composition).toBe("testFlow");
    expect(mutant.source).toBe("mutation");
    expect(mutant.parentId).toBe(parent.id);
    expect(mutant.tags).toContain("mutation");
  });

  it("keeps slider values within control ranges", () => {
    const comp = makeComp2D();
    const parent = makeObservation({ composition: "testFlow" });

    // Run many mutations to test bounds
    for (let i = 0; i < 50; i++) {
      const mutant = mutatePreset(comp, parent);
      expect(mutant.values.seedSpacing as number).toBeGreaterThanOrEqual(2);
      expect(mutant.values.seedSpacing as number).toBeLessThanOrEqual(30);
      expect(mutant.values.maxSteps as number).toBeGreaterThanOrEqual(50);
      expect(mutant.values.maxSteps as number).toBeLessThanOrEqual(1000);
      expect(mutant.values.noiseScale as number).toBeGreaterThanOrEqual(0.001);
      expect(mutant.values.noiseScale as number).toBeLessThanOrEqual(0.02);
    }
  });

  it("produces varied outputs across mutations", () => {
    const comp = makeComp2D();
    const parent = makeObservation({ composition: "testFlow" });

    const seedSpacings = new Set<number>();
    for (let i = 0; i < 20; i++) {
      const mutant = mutatePreset(comp, parent);
      seedSpacings.add(mutant.values.seedSpacing as number);
    }

    // With 20 mutations, we should get more than 1 distinct value
    expect(seedSpacings.size).toBeGreaterThan(1);
  });

  it("respects step quantization", () => {
    const comp = makeComp2D();
    const parent = makeObservation({ composition: "testFlow" });

    for (let i = 0; i < 20; i++) {
      const mutant = mutatePreset(comp, parent);
      // seedSpacing has step=1, should be integer
      expect(Number.isInteger(mutant.values.seedSpacing as number)).toBe(true);
      // maxSteps has step=10, should be multiple of 10
      expect((mutant.values.maxSteps as number) % 10).toBe(0);
    }
  });

  it("small radius produces values closer to parent", () => {
    const comp = makeComp2D();
    const parent = makeObservation({
      composition: "testFlow",
      values: { seedSpacing: 15, maxSteps: 500, noiseScale: 0.01, arrangement: "random" },
    });
    // Recompute features for the new values
    parent.features = extractFeatures(comp, parent.values, parent.stats);

    let totalDrift = 0;
    const n = 50;
    for (let i = 0; i < n; i++) {
      const mutant = mutatePreset(comp, parent, 0.05); // 5% radius
      // Measure normalized drift for seedSpacing: range is 28
      const drift = Math.abs((mutant.values.seedSpacing as number) - 15) / 28;
      totalDrift += drift;
    }

    const avgDrift = totalDrift / n;
    // With 5% radius, average drift should be small (well under 15%)
    expect(avgDrift).toBeLessThan(0.15);
  });

  it("handles 3D compositions with camera perturbation", () => {
    const comp = makeComp3D();
    const parent = makeObservation({
      composition: "testCage",
      values: { ribbons: 12, twist: 3 },
      camera: { theta: 0.6, phi: 0.3, dist: 8 },
    });
    parent.features = extractFeatures(comp, parent.values, parent.stats);

    const mutant = mutatePreset(comp, parent);
    expect(mutant.camera).not.toBeNull();
    expect(mutant.camera!.theta).toBeGreaterThan(0);
    expect(mutant.camera!.phi).toBeGreaterThan(0);
    expect(mutant.camera!.dist).toBeGreaterThan(0);
  });
});
