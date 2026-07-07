import { describe, it, expect } from "vitest";
import { detectStaleness, blendSeedScore } from "./generator.js";
import type { Observation, ScoreEntry } from "./types.js";

/** Build a minimal observation for testing */
function makeObs(overrides: Partial<Observation> & { composition: string; outcome: Observation["outcome"] }): Observation {
  return {
    id: `test-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
    presetName: null,
    values: {},
    camera: null,
    tags: [],
    stats: { lines: 100, verts: 400, paths: 50 },
    features: {
      compositionId: overrides.composition,
      category: "2d",
      macroValues: {},
      controlPositions: {},
      pathDensity: 0.5,
      vertexDensity: 0.5,
      lineCount: 100,
      tags: [],
      isSeedDerived: false,
    },
    ...overrides,
  };
}

describe("detectStaleness", () => {
  it("returns 0 for too few observations", () => {
    const obs = Array.from({ length: 5 }, (_, i) =>
      makeObs({ composition: `comp${i}`, outcome: "accepted" }),
    );
    expect(detectStaleness(obs)).toBe(0);
  });

  it("detects composition dominance", () => {
    // 12 out of 15 are the same composition = 80% dominance
    const obs: Observation[] = [];
    for (let i = 0; i < 12; i++) {
      obs.push(makeObs({ composition: "sameComp", outcome: "accepted" }));
    }
    for (let i = 0; i < 3; i++) {
      obs.push(makeObs({ composition: `other${i}`, outcome: "accepted" }));
    }
    const boost = detectStaleness(obs);
    expect(boost).toBeGreaterThanOrEqual(0.15);
  });

  it("detects reject fatigue", () => {
    // High reject rate in recent observations
    const obs: Observation[] = [];
    for (let i = 0; i < 5; i++) {
      obs.push(makeObs({ composition: `comp${i}`, outcome: "accepted" }));
    }
    for (let i = 0; i < 10; i++) {
      obs.push(makeObs({ composition: `comp${i + 5}`, outcome: "rejected" }));
    }
    const boost = detectStaleness(obs);
    expect(boost).toBeGreaterThanOrEqual(0.15);
  });

  it("detects parameter convergence", () => {
    // All accepted observations have nearly identical control positions
    const obs: Observation[] = [];
    for (let i = 0; i < 15; i++) {
      obs.push(makeObs({
        composition: `comp${i % 5}`,
        outcome: i < 5 ? "accepted" : "rejected",
        features: {
          compositionId: `comp${i % 5}`,
          category: "2d",
          macroValues: {},
          controlPositions: { param1: 0.5 + Math.random() * 0.01, param2: 0.3 + Math.random() * 0.01 },
          pathDensity: 0.5,
          vertexDensity: 0.5,
          lineCount: 100,
          tags: [],
          isSeedDerived: false,
        },
      }));
    }
    const boost = detectStaleness(obs);
    expect(boost).toBeGreaterThan(0);
  });

  it("returns 0 for diverse healthy observations", () => {
    const obs: Observation[] = [];
    for (let i = 0; i < 15; i++) {
      obs.push(makeObs({
        composition: `comp${i % 10}`,
        // Mix of outcomes, slightly more accepts than rejects
        outcome: i % 3 === 0 ? "rejected" : "accepted",
        features: {
          compositionId: `comp${i % 10}`,
          category: "2d",
          macroValues: {},
          // Wide spread of parameter values
          controlPositions: { param1: Math.random(), param2: Math.random() },
          pathDensity: Math.random(),
          vertexDensity: Math.random(),
          lineCount: Math.floor(Math.random() * 500),
          tags: [],
          isSeedDerived: false,
        },
      }));
    }
    const boost = detectStaleness(obs);
    expect(boost).toBe(0);
  });

  it("caps boost at 0.3", () => {
    // Trigger all three staleness signals simultaneously
    const obs: Observation[] = [];
    for (let i = 0; i < 15; i++) {
      obs.push(makeObs({
        composition: "sameComp",  // dominance
        outcome: i < 3 ? "accepted" : "rejected",  // fatigue
        features: {
          compositionId: "sameComp",
          category: "2d",
          macroValues: {},
          controlPositions: { p: 0.5 },  // convergence
          pathDensity: 0.5,
          vertexDensity: 0.5,
          lineCount: 100,
          tags: [],
          isSeedDerived: false,
        },
      }));
    }
    const boost = detectStaleness(obs);
    expect(boost).toBeLessThanOrEqual(0.3);
  });
});

describe("blendSeedScore", () => {
  function makeScoreEntry(accepted: number, rejected: number): ScoreEntry {
    const total = accepted + rejected;
    return { accepted, rejected, total, score: (accepted + 1) / (total + 2) };
  }

  it("returns the base score unchanged when there's no seed-derived signal", () => {
    expect(blendSeedScore(0.5, undefined)).toBe(0.5);
    expect(blendSeedScore(0.5, makeScoreEntry(0, 0))).toBe(0.5);
  });

  it("a single seed-derived observation only nudges the score, never dominates", () => {
    const base = 0.5;
    // One strongly-positive seed-derived observation (score → 1.0).
    const seedEntry: ScoreEntry = { accepted: 1, rejected: 0, total: 1, score: 1.0 };
    const blended = blendSeedScore(base, seedEntry);
    expect(blended).toBeGreaterThan(base);
    // Must stay well short of the seed score itself — no single-observation dominance.
    expect(blended).toBeLessThan(0.7);
  });

  it("blend weight grows toward the seed score as n accumulates", () => {
    const base = 0.5;
    const small = blendSeedScore(base, { accepted: 1, rejected: 0, total: 1, score: 1.0 });
    const large = blendSeedScore(base, { accepted: 18, rejected: 2, total: 20, score: 0.95 });
    expect(large).toBeGreaterThan(small);
    // With n=20 (well above the halflife), the blend should sit close to the seed score.
    expect(large).toBeGreaterThan(0.85);
  });

  it("is symmetric — a strongly negative seed-derived score pulls the blend down", () => {
    const base = 0.5;
    const seedEntry: ScoreEntry = { accepted: 0, rejected: 10, total: 10, score: 0.08 };
    const blended = blendSeedScore(base, seedEntry);
    expect(blended).toBeLessThan(base);
  });
});
