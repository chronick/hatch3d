import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadCorrelationStore,
  saveCorrelationStore,
  upsertCorrelation,
} from "../preferences/correlation-store";
import {
  correlationRecordsEqual,
  makeEmptyStore,
  pairKey,
  CORRELATION_STORE_VERSION,
  type CorrelationRecord,
} from "../preferences/correlations";

const FIXED_TS = "2026-04-21T00:00:00.000Z";

describe("correlation-store", () => {
  let dir: string;
  let path: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "hatch3d-corr-"));
    path = join(dir, "correlations.json");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  describe("loadCorrelationStore", () => {
    it("returns an empty store when the file does not exist", () => {
      const store = loadCorrelationStore(path);
      expect(store.version).toBe(CORRELATION_STORE_VERSION);
      expect(store.pairs).toEqual({});
    });

    it("returns an empty store when the file is malformed", () => {
      writeFileSync(path, "{ not valid json");
      const store = loadCorrelationStore(path);
      expect(store.pairs).toEqual({});
    });

    it("returns an empty store when the version is unknown", () => {
      writeFileSync(path, JSON.stringify({ version: 999, pairs: {} }));
      const store = loadCorrelationStore(path);
      expect(store.version).toBe(CORRELATION_STORE_VERSION);
      expect(store.pairs).toEqual({});
    });
  });

  describe("saveCorrelationStore", () => {
    it("writes a round-trippable store to disk", () => {
      const store = makeEmptyStore();
      const withOne = upsertCorrelation(
        store,
        { paramA: "density", paramB: "turbulence", scope: "macro" },
        0.4,
        0.6,
        "positive",
        FIXED_TS,
      );
      saveCorrelationStore(withOne, path);
      expect(existsSync(path)).toBe(true);

      const back = loadCorrelationStore(path);
      expect(Object.keys(back.pairs)).toHaveLength(1);
      const key = pairKey({ paramA: "density", paramB: "turbulence", scope: "macro" });
      expect(
        correlationRecordsEqual(back.pairs[key] as CorrelationRecord, withOne.pairs[key]),
      ).toBe(true);
    });

    it("creates missing parent directories", () => {
      const nested = join(dir, "nested", "dir", "correlations.json");
      const store = makeEmptyStore();
      saveCorrelationStore(store, nested);
      expect(existsSync(nested)).toBe(true);
    });
  });

  describe("upsertCorrelation", () => {
    it("creates a record on first observation", () => {
      const store = upsertCorrelation(
        makeEmptyStore(),
        { paramA: "density", paramB: "turbulence", scope: "macro" },
        0.3,
        0.7,
        "positive",
        FIXED_TS,
      );
      const key = pairKey({ paramA: "density", paramB: "turbulence", scope: "macro" });
      const rec = store.pairs[key];
      expect(rec).toBeDefined();
      expect(rec.nPositive).toBe(1);
      expect(rec.sumAPos).toBeCloseTo(0.3);
      expect(rec.sumBPos).toBeCloseTo(0.7);
    });

    it("accumulates across calls", () => {
      let store = makeEmptyStore();
      store = upsertCorrelation(
        store,
        { paramA: "density", paramB: "turbulence", scope: "macro" },
        0.3,
        0.7,
        "positive",
        FIXED_TS,
      );
      store = upsertCorrelation(
        store,
        { paramA: "density", paramB: "turbulence", scope: "macro" },
        0.5,
        0.5,
        "negative",
        FIXED_TS,
      );
      const key = pairKey({ paramA: "density", paramB: "turbulence", scope: "macro" });
      expect(store.pairs[key].nPositive).toBe(1);
      expect(store.pairs[key].nNegative).toBe(1);
    });

    it("canonicalizes ordering and reorders values to match", () => {
      // Passing (turbulence, density) with values (0.3, 0.7) should map to
      // the canonical (density, turbulence) record with (0.7, 0.3) — so the
      // density value lands in sumAPos and turbulence lands in sumBPos.
      const store = upsertCorrelation(
        makeEmptyStore(),
        { paramA: "turbulence", paramB: "density", scope: "macro" },
        0.3,
        0.7,
        "positive",
        FIXED_TS,
      );
      const key = pairKey({ paramA: "density", paramB: "turbulence", scope: "macro" });
      const rec = store.pairs[key];
      expect(rec.paramA).toBe("density");
      expect(rec.paramB).toBe("turbulence");
      expect(rec.sumAPos).toBeCloseTo(0.7); // density value
      expect(rec.sumBPos).toBeCloseTo(0.3); // turbulence value
    });

    it("does not mutate the input store", () => {
      const seed = makeEmptyStore();
      upsertCorrelation(
        seed,
        { paramA: "a", paramB: "b", scope: "macro" },
        0.5,
        0.5,
        "positive",
        FIXED_TS,
      );
      expect(Object.keys(seed.pairs)).toHaveLength(0);
    });
  });
});
