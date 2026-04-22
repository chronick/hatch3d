import { describe, it, expect } from "vitest";
import {
  canonicalizePair,
  pairKey,
  pairsEqual,
  correlationRecordsEqual,
  makeEmptyCorrelation,
  makeEmptyStore,
  updateCorrelation,
  enumerateFeaturePairs,
  serializeStore,
  deserializeStore,
  CORRELATION_STORE_VERSION,
  type ParamPair,
  type CorrelationRecord,
  type CorrelationStore,
} from "../preferences/correlations";
import type { NormalizedFeatures } from "../preferences/types";

const FIXED_TS = "2026-04-21T00:00:00.000Z";

describe("canonicalizePair", () => {
  it("sorts macro pair params alphabetically", () => {
    const p = canonicalizePair({ paramA: "turbulence", paramB: "density", scope: "macro" });
    expect(p.paramA).toBe("density");
    expect(p.paramB).toBe("turbulence");
  });

  it("leaves already-sorted pairs untouched", () => {
    const p = canonicalizePair({ paramA: "density", paramB: "turbulence", scope: "macro" });
    expect(p.paramA).toBe("density");
    expect(p.paramB).toBe("turbulence");
  });

  it("preserves compositionId on control-scoped pairs", () => {
    const p = canonicalizePair({ paramA: "twist", paramB: "ribbons", scope: "control", compositionId: "testCage" });
    expect(p.paramA).toBe("ribbons");
    expect(p.paramB).toBe("twist");
    expect(p.compositionId).toBe("testCage");
  });

  it("omits compositionId on macro-scoped pairs", () => {
    const p = canonicalizePair({ paramA: "b", paramB: "a", scope: "macro", compositionId: "ignored" } as ParamPair);
    expect(p.scope).toBe("macro");
    expect((p as { compositionId?: string }).compositionId).toBeUndefined();
  });
});

describe("pairKey", () => {
  it("returns the same key regardless of input order", () => {
    const k1 = pairKey({ paramA: "density", paramB: "turbulence", scope: "macro" });
    const k2 = pairKey({ paramA: "turbulence", paramB: "density", scope: "macro" });
    expect(k1).toBe(k2);
  });

  it("differentiates macro vs control scope", () => {
    const kMacro = pairKey({ paramA: "density", paramB: "turbulence", scope: "macro" });
    const kCtrl = pairKey({ paramA: "density", paramB: "turbulence", scope: "control", compositionId: "testFlow" });
    expect(kMacro).not.toBe(kCtrl);
  });

  it("differentiates control pairs by compositionId", () => {
    const a = pairKey({ paramA: "ribbons", paramB: "twist", scope: "control", compositionId: "testCage" });
    const b = pairKey({ paramA: "ribbons", paramB: "twist", scope: "control", compositionId: "otherCage" });
    expect(a).not.toBe(b);
  });
});

describe("pairsEqual", () => {
  it("treats reversed pairs as equal", () => {
    expect(
      pairsEqual(
        { paramA: "a", paramB: "b", scope: "macro" },
        { paramA: "b", paramB: "a", scope: "macro" },
      ),
    ).toBe(true);
  });

  it("treats different scopes as unequal", () => {
    expect(
      pairsEqual(
        { paramA: "a", paramB: "b", scope: "macro" },
        { paramA: "a", paramB: "b", scope: "control", compositionId: "x" },
      ),
    ).toBe(false);
  });
});

describe("makeEmptyCorrelation", () => {
  it("zeros all running sums", () => {
    const rec = makeEmptyCorrelation(
      { paramA: "density", paramB: "turbulence", scope: "macro" },
      FIXED_TS,
    );
    expect(rec.nPositive).toBe(0);
    expect(rec.nNegative).toBe(0);
    expect(rec.sumAPos).toBe(0);
    expect(rec.sumBPos).toBe(0);
    expect(rec.sumAAPos).toBe(0);
    expect(rec.sumBBPos).toBe(0);
    expect(rec.sumABPos).toBe(0);
    expect(rec.sumANeg).toBe(0);
    expect(rec.sumBNeg).toBe(0);
    expect(rec.sumAANeg).toBe(0);
    expect(rec.sumBBNeg).toBe(0);
    expect(rec.sumABNeg).toBe(0);
    expect(rec.lastUpdatedAt).toBe(FIXED_TS);
  });

  it("canonicalizes the pair on construction", () => {
    const rec = makeEmptyCorrelation({ paramA: "turbulence", paramB: "density", scope: "macro" });
    expect(rec.paramA).toBe("density");
    expect(rec.paramB).toBe("turbulence");
  });
});

describe("updateCorrelation", () => {
  it("accumulates positive signal into the positive bucket only", () => {
    const seed = makeEmptyCorrelation(
      { paramA: "density", paramB: "turbulence", scope: "macro" },
      FIXED_TS,
    );
    const next = updateCorrelation(seed, 0.3, 0.7, "positive", FIXED_TS);
    expect(next.nPositive).toBe(1);
    expect(next.nNegative).toBe(0);
    expect(next.sumAPos).toBeCloseTo(0.3);
    expect(next.sumBPos).toBeCloseTo(0.7);
    expect(next.sumAAPos).toBeCloseTo(0.09);
    expect(next.sumBBPos).toBeCloseTo(0.49);
    expect(next.sumABPos).toBeCloseTo(0.21);
    expect(next.sumANeg).toBe(0);
  });

  it("accumulates negative signal into the negative bucket only", () => {
    const seed = makeEmptyCorrelation(
      { paramA: "density", paramB: "turbulence", scope: "macro" },
      FIXED_TS,
    );
    const next = updateCorrelation(seed, 0.4, 0.2, "negative", FIXED_TS);
    expect(next.nNegative).toBe(1);
    expect(next.nPositive).toBe(0);
    expect(next.sumANeg).toBeCloseTo(0.4);
    expect(next.sumBNeg).toBeCloseTo(0.2);
    expect(next.sumABNeg).toBeCloseTo(0.08);
    expect(next.sumAPos).toBe(0);
  });

  it("does not mutate the input record", () => {
    const seed = makeEmptyCorrelation(
      { paramA: "density", paramB: "turbulence", scope: "macro" },
      FIXED_TS,
    );
    updateCorrelation(seed, 0.5, 0.5, "positive");
    expect(seed.nPositive).toBe(0);
    expect(seed.sumAPos).toBe(0);
  });
});

describe("correlationRecordsEqual", () => {
  it("is true for structurally identical records", () => {
    const a = makeEmptyCorrelation({ paramA: "x", paramB: "y", scope: "macro" }, FIXED_TS);
    const b = makeEmptyCorrelation({ paramA: "x", paramB: "y", scope: "macro" }, FIXED_TS);
    expect(correlationRecordsEqual(a, b)).toBe(true);
  });

  it("is false when running sums diverge", () => {
    const a = makeEmptyCorrelation({ paramA: "x", paramB: "y", scope: "macro" }, FIXED_TS);
    const b = updateCorrelation(a, 0.5, 0.5, "positive", FIXED_TS);
    expect(correlationRecordsEqual(a, b)).toBe(false);
  });
});

describe("enumerateFeaturePairs", () => {
  const features: NormalizedFeatures = {
    compositionId: "testFlow",
    category: "2d",
    macroValues: { density: 0.5, turbulence: 0.3, contrast: 0.7 },
    controlPositions: { seedSpacing: 0.4, maxSteps: 0.6 },
    pathDensity: 0.1,
    vertexDensity: 100,
    lineCount: 200,
    tags: [],
  };

  it("enumerates all unordered macro pairs", () => {
    const pairs = enumerateFeaturePairs(features, "macro");
    // 3 macros → C(3,2) = 3 pairs
    expect(pairs).toHaveLength(3);
    const keys = pairs.map(pairKey).sort();
    expect(keys).toEqual([
      pairKey({ paramA: "contrast", paramB: "density", scope: "macro" }),
      pairKey({ paramA: "contrast", paramB: "turbulence", scope: "macro" }),
      pairKey({ paramA: "density", paramB: "turbulence", scope: "macro" }),
    ].sort());
  });

  it("enumerates control pairs with compositionId", () => {
    const pairs = enumerateFeaturePairs(features, "control");
    expect(pairs).toHaveLength(1);
    expect(pairs[0].compositionId).toBe("testFlow");
    expect(pairs[0].scope).toBe("control");
  });

  it("returns empty when fewer than two parameters are present", () => {
    const sparse: NormalizedFeatures = { ...features, macroValues: { only: 0.5 } };
    expect(enumerateFeaturePairs(sparse, "macro")).toHaveLength(0);
  });
});

describe("serializeStore / deserializeStore", () => {
  it("round-trips an empty store", () => {
    const s = makeEmptyStore();
    const text = serializeStore(s);
    const back = deserializeStore(text);
    expect(back.version).toBe(CORRELATION_STORE_VERSION);
    expect(back.pairs).toEqual({});
  });

  it("round-trips a store with multiple records byte-identically", () => {
    const store: CorrelationStore = makeEmptyStore();
    const p1 = makeEmptyCorrelation({ paramA: "density", paramB: "turbulence", scope: "macro" }, FIXED_TS);
    const p1Updated = updateCorrelation(p1, 0.3, 0.6, "positive", FIXED_TS);
    store.pairs[pairKey(p1Updated)] = p1Updated;

    const p2 = makeEmptyCorrelation({ paramA: "ribbons", paramB: "twist", scope: "control", compositionId: "testCage" }, FIXED_TS);
    const p2Updated = updateCorrelation(p2, 0.8, 0.2, "negative", FIXED_TS);
    store.pairs[pairKey(p2Updated)] = p2Updated;

    const back = deserializeStore(serializeStore(store));
    expect(back.version).toBe(store.version);
    expect(Object.keys(back.pairs).sort()).toEqual(Object.keys(store.pairs).sort());
    for (const key of Object.keys(store.pairs)) {
      expect(correlationRecordsEqual(back.pairs[key] as CorrelationRecord, store.pairs[key])).toBe(true);
    }
  });

  it("rejects malformed envelopes", () => {
    expect(() => deserializeStore("null")).toThrow();
    expect(() => deserializeStore(JSON.stringify({ version: 1 }))).toThrow();
    expect(() => deserializeStore(JSON.stringify({ pairs: {} }))).toThrow();
  });
});
