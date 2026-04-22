export type { Observation, PreferenceModel, GeneratedPreset, NormalizedFeatures, SyncState, IntentVector } from "./types.js";
export { extractFeatures, macrosToValues } from "./features.js";
export { collectFromFeedAPI, collectFromPrintQueue, logGeneration, loadAllObservations } from "./collector.js";
export { computeModel, summarizeModel } from "./learner.js";
export { generateBiasedPresets, mutatePreset, detectStaleness } from "./generator.js";
export { briefToIntent } from "./intent.js";
export type {
  CorrelationScope,
  CorrelationSignal,
  ParamPair,
  CorrelationRecord,
  CorrelationStore,
} from "./correlations.js";
export {
  CORRELATION_STORE_VERSION,
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
} from "./correlations.js";
export {
  DEFAULT_CORRELATION_FILE,
  defaultCorrelationPath,
  loadCorrelationStore,
  saveCorrelationStore,
  upsertCorrelation,
} from "./correlation-store.js";
export {
  mapOutcomeToSignal,
  recordObservationCorrelations,
} from "./correlation-recorder.js";
