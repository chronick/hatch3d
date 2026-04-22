import { describe, it, expect } from "vitest";
import {
  mapOutcomeToSignal,
  recordObservationCorrelations,
} from "../preferences/correlation-recorder";
import {
  makeEmptyStore,
  pairKey,
} from "../preferences/correlations";
import type { Observation } from "../preferences/types";

const FIXED_TS = "2026-04-21T00:00:00.000Z";

function makeObservation(overrides: Partial<Observation> = {}): Observation {
  return {
    id: "obs-1",
    timestamp: FIXED_TS,
    composition: "testFlow",
    presetName: null,
    values: {},
    camera: null,
    tags: [],
    stats: { lines: 0, verts: 0, paths: 0 },
    outcome: "accepted",
    features: {
      compositionId: "testFlow",
      category: "2d",
      macroValues: { density: 0.4, turbulence: 0.6, contrast: 0.2 },
      controlPositions: { seedSpacing: 0.3, maxSteps: 0.8 },
      pathDensity: 0.1,
      vertexDensity: 100,
      lineCount: 200,
      tags: [],
    },
    ...overrides,
  };
}

describe("mapOutcomeToSignal", () => {
  it("maps accepted and evolved to positive", () => {
    expect(mapOutcomeToSignal("accepted")).toBe("positive");
    expect(mapOutcomeToSignal("evolved")).toBe("positive");
  });

  it("maps rejected to negative", () => {
    expect(mapOutcomeToSignal("rejected")).toBe("negative");
  });

  it("returns null for deferred and unseen", () => {
    expect(mapOutcomeToSignal("deferred")).toBeNull();
    expect(mapOutcomeToSignal("unseen")).toBeNull();
  });
});

describe("recordObservationCorrelations", () => {
  it("produces a correlation entry for every macro pair and every control pair", () => {
    const store = recordObservationCorrelations(makeEmptyStore(), makeObservation(), FIXED_TS);
    // 3 macros → 3 pairs, 2 controls → 1 pair = 4 entries
    expect(Object.keys(store.pairs)).toHaveLength(4);
  });

  it("records the canonical values for a single positive rating", () => {
    const store = recordObservationCorrelations(makeEmptyStore(), makeObservation(), FIXED_TS);
    const key = pairKey({ paramA: "density", paramB: "turbulence", scope: "macro" });
    const rec = store.pairs[key];
    expect(rec).toBeDefined();
    expect(rec.nPositive).toBe(1);
    expect(rec.nNegative).toBe(0);
    expect(rec.sumAPos).toBeCloseTo(0.4); // density
    expect(rec.sumBPos).toBeCloseTo(0.6); // turbulence
  });

  it("records control pairs namespaced by compositionId", () => {
    const store = recordObservationCorrelations(makeEmptyStore(), makeObservation(), FIXED_TS);
    const key = pairKey({
      paramA: "maxSteps",
      paramB: "seedSpacing",
      scope: "control",
      compositionId: "testFlow",
    });
    const rec = store.pairs[key];
    expect(rec).toBeDefined();
    expect(rec.compositionId).toBe("testFlow");
    expect(rec.nPositive).toBe(1);
  });

  it("records rejected as a negative signal", () => {
    const store = recordObservationCorrelations(
      makeEmptyStore(),
      makeObservation({ outcome: "rejected" }),
      FIXED_TS,
    );
    const key = pairKey({ paramA: "density", paramB: "turbulence", scope: "macro" });
    expect(store.pairs[key].nNegative).toBe(1);
    expect(store.pairs[key].nPositive).toBe(0);
  });

  it("leaves the store unchanged for no-signal outcomes", () => {
    const seed = makeEmptyStore();
    const a = recordObservationCorrelations(seed, makeObservation({ outcome: "deferred" }));
    const b = recordObservationCorrelations(seed, makeObservation({ outcome: "unseen" }));
    expect(a).toBe(seed); // returns the same reference when no work to do
    expect(b).toBe(seed);
  });

  it("is idempotent over multiple identical observations in the positive bucket", () => {
    let store = makeEmptyStore();
    store = recordObservationCorrelations(store, makeObservation(), FIXED_TS);
    store = recordObservationCorrelations(store, makeObservation(), FIXED_TS);
    const key = pairKey({ paramA: "density", paramB: "turbulence", scope: "macro" });
    expect(store.pairs[key].nPositive).toBe(2);
    expect(store.pairs[key].sumAPos).toBeCloseTo(0.8);
    expect(store.pairs[key].sumBPos).toBeCloseTo(1.2);
  });

  it("skips pairs when a feature value is missing", () => {
    const obs = makeObservation({
      features: {
        compositionId: "testFlow",
        category: "2d",
        macroValues: { density: 0.4 },
        controlPositions: {},
        pathDensity: 0,
        vertexDensity: 0,
        lineCount: 0,
        tags: [],
      },
    });
    const store = recordObservationCorrelations(makeEmptyStore(), obs, FIXED_TS);
    // Only one macro present → no pairs possible → empty store
    expect(Object.keys(store.pairs)).toHaveLength(0);
  });
});
