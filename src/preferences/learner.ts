/**
 * Preference model learner.
 *
 * Pure function: Observation[] → PreferenceModel
 *
 * Uses Bayesian-smoothed statistics — no ML, no gradients.
 * Designed to be swapped for more sophisticated models later
 * while keeping the same PreferenceModel output interface.
 */

import type { Observation, PreferenceModel, ScoreEntry, RangePreference } from "./types.js";

/** Laplace smoothing prior (pseudo-count added to each outcome) */
const PRIOR = 1;

/** Outcomes that count as positive signal */
const POSITIVE_OUTCOMES = new Set(["accepted", "evolved"]);
/** Outcomes that count as negative signal */
const NEGATIVE_OUTCOMES = new Set(["rejected"]);

function isPositive(obs: Observation): boolean {
  return POSITIVE_OUTCOMES.has(obs.outcome);
}

function isNegative(obs: Observation): boolean {
  return NEGATIVE_OUTCOMES.has(obs.outcome);
}

function hasSignal(obs: Observation): boolean {
  return isPositive(obs) || isNegative(obs);
}

/**
 * Compute a Bayesian-smoothed score entry from counts.
 * score = (accepted + PRIOR) / (total + 2 * PRIOR)
 * With 0 data, score = 0.5 (uninformative prior).
 */
function scoreEntry(accepted: number, rejected: number): ScoreEntry {
  const total = accepted + rejected;
  return {
    accepted,
    rejected,
    total,
    score: (accepted + PRIOR) / (total + 2 * PRIOR),
  };
}

/**
 * Compute mean and standard deviation of a number array.
 * Returns { mean: 0.5, std: 0.25 } as uninformative default for empty arrays.
 */
function meanStd(values: number[]): { mean: number; std: number } {
  if (values.length === 0) return { mean: 0.5, std: 0.25 };
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  if (values.length === 1) return { mean, std: 0.15 }; // single observation: moderate uncertainty
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / (values.length - 1);
  return { mean, std: Math.sqrt(variance) };
}

function rangePreference(positiveValues: number[], negativeValues: number[]): RangePreference {
  const pos = meanStd(positiveValues);
  const neg = meanStd(negativeValues);
  return {
    preferredMean: pos.mean,
    preferredStd: pos.std,
    rejectedMean: neg.mean,
    rejectedStd: neg.std,
    n: positiveValues.length + negativeValues.length,
  };
}

/**
 * Compute a full preference model from observations.
 */
export function computeModel(observations: Observation[]): PreferenceModel {
  const withSignal = observations.filter(hasSignal);

  // ── Composition scores ──
  const compositionScores: Record<string, ScoreEntry> = {};
  const compGroups = groupBy(withSignal, (o) => o.composition);
  for (const [comp, obs] of Object.entries(compGroups)) {
    compositionScores[comp] = scoreEntry(
      obs.filter(isPositive).length,
      obs.filter(isNegative).length,
    );
  }

  // ── Category scores ──
  const categoryScores: Record<string, ScoreEntry> = {};
  const catGroups = groupBy(withSignal, (o) => o.features.category);
  for (const [cat, obs] of Object.entries(catGroups)) {
    categoryScores[cat] = scoreEntry(
      obs.filter(isPositive).length,
      obs.filter(isNegative).length,
    );
  }

  // ── Tag scores ──
  const tagScores: Record<string, ScoreEntry> = {};
  const tagCounts: Record<string, { accepted: number; rejected: number }> = {};
  for (const obs of withSignal) {
    for (const tag of obs.features.tags) {
      if (!tagCounts[tag]) tagCounts[tag] = { accepted: 0, rejected: 0 };
      if (isPositive(obs)) tagCounts[tag].accepted++;
      if (isNegative(obs)) tagCounts[tag].rejected++;
    }
  }
  for (const [tag, counts] of Object.entries(tagCounts)) {
    tagScores[tag] = scoreEntry(counts.accepted, counts.rejected);
  }

  // ── Macro preferences (cross-composition) ──
  const macroPreferences: Record<string, RangePreference> = {};
  const allMacroKeys = new Set<string>();
  for (const obs of withSignal) {
    for (const key of Object.keys(obs.features.macroValues)) {
      allMacroKeys.add(key);
    }
  }
  for (const macroKey of allMacroKeys) {
    const posValues = withSignal
      .filter(isPositive)
      .map((o) => o.features.macroValues[macroKey])
      .filter((v): v is number => v !== undefined);
    const negValues = withSignal
      .filter(isNegative)
      .map((o) => o.features.macroValues[macroKey])
      .filter((v): v is number => v !== undefined);
    macroPreferences[macroKey] = rangePreference(posValues, negValues);
  }

  // ── Per-composition control preferences ──
  const controlPreferences: Record<string, Record<string, RangePreference>> = {};
  for (const [comp, obs] of Object.entries(compGroups)) {
    controlPreferences[comp] = {};
    const allControlKeys = new Set<string>();
    for (const o of obs) {
      for (const key of Object.keys(o.features.controlPositions)) {
        allControlKeys.add(key);
      }
    }
    for (const ctrlKey of allControlKeys) {
      const posValues = obs
        .filter(isPositive)
        .map((o) => o.features.controlPositions[ctrlKey])
        .filter((v): v is number => v !== undefined);
      const negValues = obs
        .filter(isNegative)
        .map((o) => o.features.controlPositions[ctrlKey])
        .filter((v): v is number => v !== undefined);
      if (posValues.length + negValues.length > 0) {
        controlPreferences[comp][ctrlKey] = rangePreference(posValues, negValues);
      }
    }
  }

  // ── Stat preferences ──
  const posObs = withSignal.filter(isPositive);
  const negObs = withSignal.filter(isNegative);

  const statPreferences = {
    pathDensity: rangePreference(
      posObs.map((o) => o.features.pathDensity),
      negObs.map((o) => o.features.pathDensity),
    ),
    vertexDensity: rangePreference(
      posObs.map((o) => o.features.vertexDensity),
      negObs.map((o) => o.features.vertexDensity),
    ),
    lineCount: rangePreference(
      posObs.map((o) => o.features.lineCount),
      negObs.map((o) => o.features.lineCount),
    ),
  };

  return {
    version: 1,
    computedAt: new Date().toISOString(),
    observationCount: observations.length,
    compositionScores,
    categoryScores,
    tagScores,
    macroPreferences,
    controlPreferences,
    statPreferences,
  };
}

/**
 * Summarize a model as human-readable text.
 */
export function summarizeModel(model: PreferenceModel): string {
  const lines: string[] = [];
  lines.push(`Preference Model v${model.version} (${model.observationCount} observations, computed ${model.computedAt})`);
  lines.push("");

  // Top compositions
  const compEntries = Object.entries(model.compositionScores)
    .sort((a, b) => b[1].score - a[1].score);
  lines.push("Composition affinity:");
  for (const [comp, entry] of compEntries) {
    const bar = "█".repeat(Math.round(entry.score * 20));
    lines.push(`  ${comp.padEnd(25)} ${bar} ${(entry.score * 100).toFixed(0)}% (${entry.accepted}/${entry.total})`);
  }
  lines.push("");

  // Tag preferences
  const tagEntries = Object.entries(model.tagScores)
    .filter(([, e]) => e.total >= 2)
    .sort((a, b) => b[1].score - a[1].score);
  if (tagEntries.length > 0) {
    lines.push("Tag affinity (2+ observations):");
    for (const [tag, entry] of tagEntries.slice(0, 15)) {
      lines.push(`  ${tag.padEnd(20)} ${(entry.score * 100).toFixed(0)}% (${entry.accepted}/${entry.total})`);
    }
    lines.push("");
  }

  // Macro preferences
  if (Object.keys(model.macroPreferences).length > 0) {
    lines.push("Macro preferences:");
    for (const [macro, pref] of Object.entries(model.macroPreferences)) {
      if (pref.n > 0) {
        lines.push(`  ${macro.padEnd(20)} preferred: ${pref.preferredMean.toFixed(2)} ± ${pref.preferredStd.toFixed(2)} (n=${pref.n})`);
      }
    }
    lines.push("");
  }

  // Stat preferences
  lines.push("Output stat preferences:");
  const sp = model.statPreferences;
  lines.push(`  pathDensity          preferred: ${sp.pathDensity.preferredMean.toFixed(2)} ± ${sp.pathDensity.preferredStd.toFixed(2)}`);
  lines.push(`  vertexDensity        preferred: ${sp.vertexDensity.preferredMean.toFixed(2)} ± ${sp.vertexDensity.preferredStd.toFixed(2)}`);
  lines.push(`  lineCount            preferred: ${sp.lineCount.preferredMean.toFixed(0)} ± ${sp.lineCount.preferredStd.toFixed(0)}`);

  return lines.join("\n");
}

// ── Utility ──

function groupBy<T>(items: T[], key: (item: T) => string): Record<string, T[]> {
  const groups: Record<string, T[]> = {};
  for (const item of items) {
    const k = key(item);
    if (!groups[k]) groups[k] = [];
    groups[k].push(item);
  }
  return groups;
}
