/**
 * Correlation store persistence.
 *
 * Mirrors the on-disk convention used for observations / sync-state / model:
 * a single JSON file under data/preferences/. Load returns an empty store for
 * any failure mode (missing file, corrupt envelope, future version) so that
 * callers never have to guard against bad state — the worst case is that we
 * start re-accumulating from zero.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  CORRELATION_STORE_VERSION,
  canonicalizePair,
  deserializeStore,
  makeEmptyCorrelation,
  makeEmptyStore,
  pairKey,
  serializeStore,
  updateCorrelation,
  type CorrelationRecord,
  type CorrelationSignal,
  type CorrelationStore,
  type ParamPair,
} from "./correlations.js";

export const DEFAULT_CORRELATION_FILE = "correlations.json";

/** Resolve the default path alongside the other preference artifacts. */
export function defaultCorrelationPath(): string {
  const dataDir = resolve(import.meta.dirname ?? __dirname, "../../data/preferences");
  return join(dataDir, DEFAULT_CORRELATION_FILE);
}

/**
 * Load a store from disk. Any failure — missing file, malformed JSON,
 * unknown version — resolves to a fresh empty store rather than throwing.
 * This matches the spirit of the task: preference stores that predate the
 * correlation field must not crash the app.
 */
export function loadCorrelationStore(path: string = defaultCorrelationPath()): CorrelationStore {
  if (!existsSync(path)) return makeEmptyStore();
  try {
    const raw = readFileSync(path, "utf-8");
    const store = deserializeStore(raw);
    if (store.version !== CORRELATION_STORE_VERSION) {
      // Future: add migration hooks here. For now, unknown version → empty default.
      return makeEmptyStore();
    }
    return store;
  } catch {
    return makeEmptyStore();
  }
}

/** Persist a store to disk, creating parent directories as needed. */
export function saveCorrelationStore(
  store: CorrelationStore,
  path: string = defaultCorrelationPath(),
): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, serializeStore(store));
}

/**
 * Fold one observation (param pair + signal) into a store.
 * Creates the record if it does not yet exist. Returns a new store; does not
 * mutate the input.
 */
export function upsertCorrelation(
  store: CorrelationStore,
  pair: ParamPair,
  valueA: number,
  valueB: number,
  signal: CorrelationSignal,
  now: string = new Date().toISOString(),
): CorrelationStore {
  const canonical = canonicalizePair(pair);
  const key = pairKey(canonical);
  // canonicalizePair reorders paramA/paramB — we need to reorder the values to match.
  const reordered =
    canonical.paramA === pair.paramA && canonical.paramB === pair.paramB
      ? { a: valueA, b: valueB }
      : { a: valueB, b: valueA };
  const existing: CorrelationRecord = store.pairs[key] ?? makeEmptyCorrelation(canonical, now);
  const updated = updateCorrelation(existing, reordered.a, reordered.b, signal, now);
  return {
    ...store,
    pairs: { ...store.pairs, [key]: updated },
  };
}
