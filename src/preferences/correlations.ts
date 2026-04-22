/**
 * Cross-parameter correlation schema.
 *
 * Records observed joint values for pairs of parameters (e.g. density × turbulence),
 * bucketed by positive/negative user signal. No learning algorithm — this layer
 * only defines the shape that accumulates observations.
 *
 * Parameters live in two scopes:
 *   - "macro": cross-composition aesthetic macros (from NormalizedFeatures.macroValues)
 *   - "control": per-composition controls (from NormalizedFeatures.controlPositions)
 *
 * Control-scoped pairs are namespaced by compositionId; macro-scoped pairs are global.
 * Both values are 0-1 normalized on the way in, so running sums stay bounded.
 *
 * Pair ordering is unordered: paramA and paramB are sorted lexicographically so that
 * (density, turbulence) and (turbulence, density) map to the same record.
 */

import type { NormalizedFeatures } from "./types.js";

export type CorrelationScope = "macro" | "control";
export type CorrelationSignal = "positive" | "negative";

/** Identity of a parameter pair. paramA < paramB lexicographically. */
export interface ParamPair {
  paramA: string;
  paramB: string;
  scope: CorrelationScope;
  /** Required for scope="control", omitted for scope="macro". */
  compositionId?: string;
}

/**
 * Running statistics for one parameter pair.
 *
 * Stored as raw sums so mean/variance/covariance can be computed on demand
 * without rescanning observations. Both values are in [0, 1] so squared sums
 * fit comfortably in a double.
 */
export interface CorrelationRecord extends ParamPair {
  nPositive: number;
  nNegative: number;

  sumAPos: number;
  sumBPos: number;
  sumAAPos: number;
  sumBBPos: number;
  sumABPos: number;

  sumANeg: number;
  sumBNeg: number;
  sumAANeg: number;
  sumBBNeg: number;
  sumABNeg: number;

  lastUpdatedAt: string;
}

/**
 * Collection of correlation records, keyed by pairKey().
 * Versioned for forward-compatible persistence.
 */
export interface CorrelationStore {
  version: number;
  pairs: Record<string, CorrelationRecord>;
}

export const CORRELATION_STORE_VERSION = 1;

/** Canonical pair order: alphabetical. Returns a new pair with paramA < paramB. */
export function canonicalizePair(pair: ParamPair): ParamPair {
  if (pair.paramA <= pair.paramB) {
    return pair.scope === "control"
      ? { paramA: pair.paramA, paramB: pair.paramB, scope: pair.scope, compositionId: pair.compositionId }
      : { paramA: pair.paramA, paramB: pair.paramB, scope: pair.scope };
  }
  return pair.scope === "control"
    ? { paramA: pair.paramB, paramB: pair.paramA, scope: pair.scope, compositionId: pair.compositionId }
    : { paramA: pair.paramB, paramB: pair.paramA, scope: pair.scope };
}

/** Stable key for a pair. Same output for (a,b) and (b,a). */
export function pairKey(pair: ParamPair): string {
  const c = canonicalizePair(pair);
  const compPart = c.scope === "control" ? `:${c.compositionId ?? ""}` : "";
  return `${c.scope}${compPart}:${c.paramA}|${c.paramB}`;
}

/** Deep value equality for two pair identities. */
export function pairsEqual(a: ParamPair, b: ParamPair): boolean {
  return pairKey(a) === pairKey(b);
}

/** Full equality for correlation records (identity + all running sums). */
export function correlationRecordsEqual(a: CorrelationRecord, b: CorrelationRecord): boolean {
  return (
    pairsEqual(a, b) &&
    a.nPositive === b.nPositive &&
    a.nNegative === b.nNegative &&
    a.sumAPos === b.sumAPos &&
    a.sumBPos === b.sumBPos &&
    a.sumAAPos === b.sumAAPos &&
    a.sumBBPos === b.sumBBPos &&
    a.sumABPos === b.sumABPos &&
    a.sumANeg === b.sumANeg &&
    a.sumBNeg === b.sumBNeg &&
    a.sumAANeg === b.sumAANeg &&
    a.sumBBNeg === b.sumBBNeg &&
    a.sumABNeg === b.sumABNeg &&
    a.lastUpdatedAt === b.lastUpdatedAt
  );
}

/** Build a zeroed correlation record for a pair. Canonicalizes ordering. */
export function makeEmptyCorrelation(pair: ParamPair, now: string = new Date().toISOString()): CorrelationRecord {
  const c = canonicalizePair(pair);
  return {
    ...c,
    nPositive: 0,
    nNegative: 0,
    sumAPos: 0,
    sumBPos: 0,
    sumAAPos: 0,
    sumBBPos: 0,
    sumABPos: 0,
    sumANeg: 0,
    sumBNeg: 0,
    sumAANeg: 0,
    sumBBNeg: 0,
    sumABNeg: 0,
    lastUpdatedAt: now,
  };
}

export function makeEmptyStore(): CorrelationStore {
  return { version: CORRELATION_STORE_VERSION, pairs: {} };
}

/**
 * Fold a single observation into a correlation record.
 * valueA and valueB are expected in [0, 1] (already normalized upstream).
 * Returns a new record — does not mutate the input.
 */
export function updateCorrelation(
  record: CorrelationRecord,
  valueA: number,
  valueB: number,
  signal: CorrelationSignal,
  now: string = new Date().toISOString(),
): CorrelationRecord {
  const next: CorrelationRecord = { ...record, lastUpdatedAt: now };
  if (signal === "positive") {
    next.nPositive += 1;
    next.sumAPos += valueA;
    next.sumBPos += valueB;
    next.sumAAPos += valueA * valueA;
    next.sumBBPos += valueB * valueB;
    next.sumABPos += valueA * valueB;
  } else {
    next.nNegative += 1;
    next.sumANeg += valueA;
    next.sumBNeg += valueB;
    next.sumAANeg += valueA * valueA;
    next.sumBBNeg += valueB * valueB;
    next.sumABNeg += valueA * valueB;
  }
  return next;
}

/**
 * Enumerate every unordered pair of keys present in a features map.
 * Used by the recorder to produce the param pairs observed in a single rating.
 */
export function enumerateFeaturePairs(
  features: NormalizedFeatures,
  scope: CorrelationScope,
): ParamPair[] {
  const source = scope === "macro" ? features.macroValues : features.controlPositions;
  const keys = Object.keys(source).sort();
  const out: ParamPair[] = [];
  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      out.push(
        scope === "control"
          ? { paramA: keys[i], paramB: keys[j], scope, compositionId: features.compositionId }
          : { paramA: keys[i], paramB: keys[j], scope },
      );
    }
  }
  return out;
}

/** Serialize a store to a JSON-safe string. */
export function serializeStore(store: CorrelationStore): string {
  return JSON.stringify(store);
}

/**
 * Parse a serialized store. Throws if the envelope is malformed;
 * unknown versions are returned as-is so callers can decide on migration.
 */
export function deserializeStore(text: string): CorrelationStore {
  const parsed = JSON.parse(text) as unknown;
  if (
    !parsed ||
    typeof parsed !== "object" ||
    typeof (parsed as CorrelationStore).version !== "number" ||
    typeof (parsed as CorrelationStore).pairs !== "object" ||
    (parsed as CorrelationStore).pairs === null
  ) {
    throw new Error("deserializeStore: malformed correlation store envelope");
  }
  return parsed as CorrelationStore;
}
