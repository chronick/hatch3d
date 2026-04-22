/**
 * Correlation recorder.
 *
 * Fold observations into a correlation store. Given one rated observation,
 * produces updated correlation records for every parameter pair present in
 * its normalized features (both macros and controls).
 *
 * Pure: no file I/O, no hidden state. The collector wraps this with the
 * persistence layer; tests can call it directly.
 */

import {
  enumerateFeaturePairs,
  type CorrelationSignal,
  type CorrelationStore,
} from "./correlations.js";
import { upsertCorrelation } from "./correlation-store.js";
import type { Observation, Outcome } from "./types.js";

/**
 * Map an observation outcome to a correlation signal.
 * Accepted and evolved count as positive; rejected as negative.
 * Deferred and unseen carry no signal (returns null).
 */
export function mapOutcomeToSignal(outcome: Outcome): CorrelationSignal | null {
  if (outcome === "accepted" || outcome === "evolved") return "positive";
  if (outcome === "rejected") return "negative";
  return null;
}

/**
 * Fold one observation into a correlation store. Returns a new store; does
 * not mutate the input. Observations with no signal (deferred, unseen) are
 * returned unchanged.
 */
export function recordObservationCorrelations(
  store: CorrelationStore,
  observation: Observation,
  now: string = new Date().toISOString(),
): CorrelationStore {
  const signal = mapOutcomeToSignal(observation.outcome);
  if (!signal) return store;

  const features = observation.features;
  let next = store;

  for (const pair of enumerateFeaturePairs(features, "macro")) {
    const a = features.macroValues[pair.paramA];
    const b = features.macroValues[pair.paramB];
    if (typeof a !== "number" || typeof b !== "number") continue;
    next = upsertCorrelation(next, pair, a, b, signal, now);
  }

  for (const pair of enumerateFeaturePairs(features, "control")) {
    const a = features.controlPositions[pair.paramA];
    const b = features.controlPositions[pair.paramB];
    if (typeof a !== "number" || typeof b !== "number") continue;
    next = upsertCorrelation(next, pair, a, b, signal, now);
  }

  return next;
}
