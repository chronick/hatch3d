/**
 * Preference learning system types.
 *
 * Three data layers:
 *   Observation (raw signal) → PreferenceModel (computed weights) → Generation (biased output)
 */

// ── Observations ──

export type Outcome = "accepted" | "rejected" | "evolved" | "deferred" | "unseen";

export interface Observation {
  id: string;                    // e.g. "hatch3d-2026-03-27-inkVortex-1"
  timestamp: string;             // ISO date
  composition: string;           // composition id
  presetName: string | null;     // source preset, if any
  values: Record<string, unknown>;
  camera: { theta?: number; phi?: number; dist?: number } | null;
  tags: string[];
  stats: { lines: number; verts: number; paths: number };
  outcome: Outcome;
  features: NormalizedFeatures;
  /** Optional: ID of the observation this was derived from (for lineage tracking) */
  parentId?: string;
}

// ── Normalized features (composition-independent) ──

export interface NormalizedFeatures {
  compositionId: string;
  category: "2d" | "3d";
  /** Macro-level aesthetic dimensions, 0-1 normalized */
  macroValues: Record<string, number>;
  /** Per-control normalized positions (0 = min, 1 = max) */
  controlPositions: Record<string, number>;
  /** Output statistics */
  pathDensity: number;
  vertexDensity: number;
  lineCount: number;
  /** Tag membership */
  tags: string[];
}

// ── Preference model ──

export interface ScoreEntry {
  accepted: number;
  rejected: number;
  total: number;
  score: number;  // Bayesian smoothed
}

export interface RangePreference {
  preferredMean: number;
  preferredStd: number;
  rejectedMean: number;
  rejectedStd: number;
  n: number;
}

export interface PreferenceModel {
  version: number;
  computedAt: string;
  observationCount: number;

  compositionScores: Record<string, ScoreEntry>;
  categoryScores: Record<string, ScoreEntry>;
  tagScores: Record<string, ScoreEntry>;

  /** Per-macro preferred ranges (cross-composition) */
  macroPreferences: Record<string, RangePreference>;
  /** Per-composition, per-control preferred ranges */
  controlPreferences: Record<string, Record<string, RangePreference>>;

  statPreferences: {
    pathDensity: RangePreference;
    vertexDensity: RangePreference;
    lineCount: RangePreference;
  };
}

// ── Sync state ──

export interface SyncState {
  lastActionSync: string | null;
  lastPrintQueueScan: string | null;
}

// ── Intent (creative brief → generation bias) ──

export interface IntentVector {
  /** Original brief text */
  brief: string;
  /** Per-composition weight multipliers (1.0 = neutral) */
  compositionWeights: Record<string, number>;
  /** Per-tag affinity scores (-1 to 1, 0 = neutral) */
  tagAffinities: Record<string, number>;
  /** Override exploration rate if set (0-1) */
  explorationOverride?: number;
}

// ── Generation ──

export interface GeneratedPreset {
  composition: string;
  name: string;
  description: string;
  values: Record<string, unknown>;
  camera: { theta?: number; phi?: number; dist?: number } | null;
  tags: string[];
  /** How this preset was produced */
  source: "preference" | "exploration" | "mutation" | "preset" | "directed";
  /** Confidence score from preference model (0-1) */
  confidence: number;
  /** Parent preset/observation for lineage */
  parentId?: string;
  /** Creative brief that guided generation, if any */
  brief?: string;
}
