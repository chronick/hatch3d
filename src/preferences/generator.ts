/**
 * Preference-biased preset generator.
 *
 * Three generation strategies:
 *   1. Preference — sample from learned preference distributions
 *   2. Mutation — perturb accepted presets to explore nearby parameter space
 *   3. Exploration — random parameter sampling for discovery
 *
 * Extension points for future evolution engine:
 *   - swap `sampleMacroValues()` for genetic crossover / LLM-guided mutation
 *   - swap `scorePreset()` for a learned quality predictor
 */

import type { CompositionDefinition } from "../compositions/types.js";
import { is2DComposition } from "../compositions/types.js";
import type { CompositionRegistry } from "../compositions/registry.js";
import type { Observation, PreferenceModel, GeneratedPreset, IntentVector } from "./types.js";
import { macrosToValues } from "./features.js";

interface GeneratorOptions {
  count: number;
  /** 0 = pure exploitation, 1 = pure exploration. Default 0.2 */
  explorationRate?: number;
  /** Fraction of exploitation slots that use mutation vs preference. Default 0.4 */
  mutationRate?: number;
  /** Accepted observations to use as mutation parents */
  acceptedObservations?: Observation[];
  /** Force a specific composition */
  forceComposition?: string;
  /** Existing hand-curated presets to mix in */
  curatedPresets?: GeneratedPreset[];
  /** Creative brief intent vector — biases composition + parameter selection */
  intent?: IntentVector;
  /** All observations (for staleness detection). If omitted, no staleness correction. */
  allObservations?: Observation[];
}

/**
 * Generate preference-biased presets for feed push.
 */
export function generateBiasedPresets(
  model: PreferenceModel,
  registry: CompositionRegistry,
  options: GeneratorOptions,
): GeneratedPreset[] {
  const {
    count,
    mutationRate = 0.4,
    acceptedObservations = [],
    forceComposition,
    curatedPresets = [],
    intent,
    allObservations = [],
  } = options;

  // Staleness detection: boost exploration when observations cluster tightly
  const stalenessBoost = detectStaleness(allObservations);
  const baseExploration = intent?.explorationOverride ?? options.explorationRate ?? 0.2;
  const explorationRate = Math.min(0.8, baseExploration + stalenessBoost);

  if (stalenessBoost > 0) {
    console.log(`  Staleness detected: exploration boosted by +${(stalenessBoost * 100).toFixed(0)}% → ${(explorationRate * 100).toFixed(0)}%`);
  }

  const results: GeneratedPreset[] = [];
  const usedCompositions = new Set<string>();
  const usedParents = new Set<string>();
  const allComps = [...registry.getAll().entries()];

  for (let i = 0; i < count; i++) {
    const roll = Math.random();
    const isExplore = roll < explorationRate;
    const isDirected = !isExplore && intent != null;
    const isMutate = !isExplore && !isDirected && roll < explorationRate + mutationRate * (1 - explorationRate);

    // 1. Select composition
    const compId = forceComposition ?? (
      isDirected
        ? selectDirectedComposition(model, allComps, usedCompositions, intent!)
        : selectComposition(model, allComps, usedCompositions, isExplore)
    );
    const comp = registry.get(compId);
    if (!comp) continue;
    usedCompositions.add(compId);

    if (isExplore && curatedPresets.length > 0 && Math.random() < 0.3) {
      // Occasionally pick a curated preset for diversity
      const matching = curatedPresets.filter((p) => p.composition === compId);
      if (matching.length > 0) {
        const picked = matching[Math.floor(Math.random() * matching.length)];
        results.push({ ...picked, source: "preset" });
        continue;
      }
    }

    // 2. Generate parameters
    if (isDirected) {
      results.push(generateDirectedPreset(comp, model, intent!));
      continue;
    }

    if (isMutate && acceptedObservations.length > 0) {
      const parent = selectParent(acceptedObservations, compId, usedParents);
      if (parent) {
        usedParents.add(parent.id);
        results.push(mutatePreset(comp, parent));
        continue;
      }
      // No suitable parent — fall through to preference
    }

    const preset = isExplore
      ? generateExploratoryPreset(comp)
      : generatePreferredPreset(comp, model);

    results.push(preset);
  }

  return results;
}

// ── Mutation ──

/** Default perturbation radius: fraction of each parameter's range */
const DEFAULT_PERTURBATION_RADIUS = 0.15;
/** Probability of flipping a toggle during mutation */
const TOGGLE_FLIP_PROBABILITY = 0.1;
/** Probability of switching a select option during mutation */
const SELECT_SWITCH_PROBABILITY = 0.15;
/** Perturbation radius for camera angles (radians) */
const CAMERA_ANGLE_PERTURBATION = 0.15;
/** Perturbation radius for camera distance (fraction) */
const CAMERA_DIST_PERTURBATION = 0.15;

/**
 * Select a parent observation for mutation.
 * Prefers: same composition, recent, not already used in this batch.
 * Falls back to any accepted observation if none match the composition.
 */
function selectParent(
  observations: Observation[],
  preferredCompId: string,
  usedParents: Set<string>,
): Observation | null {
  // Filter to accepted/evolved only, exclude already-used parents
  const eligible = observations.filter(
    (o) => (o.outcome === "accepted" || o.outcome === "evolved") && !usedParents.has(o.id),
  );
  if (eligible.length === 0) return null;

  // Prefer same composition
  const sameComp = eligible.filter((o) => o.composition === preferredCompId);
  const pool = sameComp.length > 0 ? sameComp : eligible;

  // Weight by recency: more recent observations get higher weight
  const now = Date.now();
  const weights = pool.map((o) => {
    const ageMs = now - new Date(o.timestamp).getTime();
    const ageDays = ageMs / (1000 * 60 * 60 * 24);
    // Half-life of 14 days: recent observations weighted more
    return Math.exp(-0.693 * ageDays / 14);
  });

  return pool[weightedRandomIndex(weights)];
}

/**
 * Mutate an accepted observation to explore nearby parameter space.
 *
 * Each parameter is independently perturbed by a small Gaussian offset
 * (default ±15% of range). Discrete controls (toggle, select) have a
 * small probability of switching. Camera angles get a small nudge.
 */
export function mutatePreset(
  comp: CompositionDefinition,
  parent: Observation,
  radius: number = DEFAULT_PERTURBATION_RADIUS,
): GeneratedPreset {
  const values: Record<string, unknown> = { ...parent.values };

  if (comp.controls) {
    for (const [key, ctrl] of Object.entries(comp.controls)) {
      const current = values[key];
      switch (ctrl.type) {
        case "slider": {
          if (typeof current !== "number") break;
          const range = ctrl.max - ctrl.min;
          const std = radius * range;
          let nudged = current + gaussianNoise() * std;
          if (ctrl.step) nudged = Math.round(nudged / ctrl.step) * ctrl.step;
          values[key] = Math.max(ctrl.min, Math.min(ctrl.max, nudged));
          break;
        }
        case "toggle": {
          if (Math.random() < TOGGLE_FLIP_PROBABILITY) {
            values[key] = !current;
          }
          break;
        }
        case "select": {
          if (Math.random() < SELECT_SWITCH_PROBABILITY) {
            const others = ctrl.options.filter((o) => o.value !== current);
            if (others.length > 0) {
              values[key] = others[Math.floor(Math.random() * others.length)].value;
            }
          }
          break;
        }
        case "xy": {
          if (Array.isArray(current) && current.length === 2) {
            const range = ctrl.max - ctrl.min;
            const std = radius * range;
            values[key] = [
              Math.max(ctrl.min, Math.min(ctrl.max, (current[0] as number) + gaussianNoise() * std)),
              Math.max(ctrl.min, Math.min(ctrl.max, (current[1] as number) + gaussianNoise() * std)),
            ];
          }
          break;
        }
      }
    }
  }

  // Perturb camera for 3D compositions
  let camera = parent.camera;
  if (!is2DComposition(comp) && camera) {
    camera = {
      theta: clamp((camera.theta ?? 0.5) + gaussianNoise() * CAMERA_ANGLE_PERTURBATION, 0.1, 1.2),
      phi: clamp((camera.phi ?? 0.3) + gaussianNoise() * CAMERA_ANGLE_PERTURBATION, 0.05, 0.8),
      dist: clamp((camera.dist ?? 8) * (1 + gaussianNoise() * CAMERA_DIST_PERTURBATION), 4, 20),
    };
  }

  return {
    composition: comp.id,
    name: `Mutant: ${comp.name} #${Math.floor(Math.random() * 1000)}`,
    description: `Mutated from ${parent.presetName ?? parent.id} (radius: ${(radius * 100).toFixed(0)}%)`,
    values,
    camera: is2DComposition(comp) ? null : camera,
    tags: [...(comp.tags ?? []), "mutation"],
    source: "mutation",
    confidence: 0.7, // Higher than exploration, slightly lower than pure preference
    parentId: parent.id,
  };
}

/** Single sample from standard normal distribution (Box-Muller) */
function gaussianNoise(): number {
  const u1 = Math.random();
  const u2 = Math.random();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

// ── Composition selection ──

function selectComposition(
  model: PreferenceModel,
  allComps: [string, CompositionDefinition][],
  usedCompositions: Set<string>,
  isExplore: boolean,
): string {
  if (isExplore) {
    // Uniform random, preferring unused
    const unused = allComps.filter(([id]) => !usedCompositions.has(id));
    const pool = unused.length > 0 ? unused : allComps;
    return pool[Math.floor(Math.random() * pool.length)][0];
  }

  // Weighted by preference score
  const weights = allComps.map(([id]) => {
    const entry = model.compositionScores[id];
    // Unseen compositions get a curiosity bonus (0.6 > neutral 0.5)
    return entry ? entry.score : 0.6;
  });

  // Penalize already-used compositions in this batch
  for (let i = 0; i < allComps.length; i++) {
    if (usedCompositions.has(allComps[i][0])) {
      weights[i] *= 0.2;
    }
  }

  return allComps[weightedRandomIndex(weights)][0];
}

// ── Staleness detection ──

/** Number of recent observations to check for convergence */
const STALENESS_WINDOW = 15;
/** If >70% of recent observations are the same composition, that's stale */
const COMPOSITION_DOMINANCE_THRESHOLD = 0.7;
/** If recent reject rate exceeds this, boost exploration (fatigue signal) */
const REJECT_FATIGUE_THRESHOLD = 0.6;
/** If parameter variance (normalized) drops below this, we're stuck in a local optimum */
const PARAMETER_VARIANCE_FLOOR = 0.02;

/**
 * Detect staleness in recent observations.
 * Returns a boost to add to the exploration rate (0 = fine, up to 0.3 = very stale).
 */
export function detectStaleness(observations: Observation[]): number {
  if (observations.length < STALENESS_WINDOW) return 0;

  const recent = observations.slice(-STALENESS_WINDOW);
  const withSignal = recent.filter((o) => o.outcome !== "unseen");
  if (withSignal.length < 5) return 0;

  let boost = 0;

  // 1. Composition dominance: one composition appearing too often
  const compCounts = new Map<string, number>();
  for (const obs of recent) {
    compCounts.set(obs.composition, (compCounts.get(obs.composition) ?? 0) + 1);
  }
  const maxCompFraction = Math.max(...compCounts.values()) / recent.length;
  if (maxCompFraction > COMPOSITION_DOMINANCE_THRESHOLD) {
    boost += 0.15;
  }

  // 2. Reject fatigue: high reject rate means current direction isn't working
  const rejectCount = withSignal.filter((o) => o.outcome === "rejected").length;
  if (rejectCount / withSignal.length > REJECT_FATIGUE_THRESHOLD) {
    boost += 0.15;
  }

  // 3. Parameter convergence: low variance across recent accepted observations
  const accepted = recent.filter((o) => o.outcome === "accepted" || o.outcome === "evolved");
  if (accepted.length >= 3) {
    const variances = computeParameterVariance(accepted);
    if (variances.length > 0) {
      const meanVariance = variances.reduce((a, b) => a + b, 0) / variances.length;
      if (meanVariance < PARAMETER_VARIANCE_FLOOR) {
        boost += 0.1;
      }
    }
  }

  return Math.min(0.3, boost);
}

/**
 * Compute normalized variance of slider parameters across observations.
 * Returns an array of per-parameter variances (0-1 scale).
 */
function computeParameterVariance(observations: Observation[]): number[] {
  if (observations.length < 2) return [];

  // Collect all numeric control values
  const paramValues = new Map<string, number[]>();
  for (const obs of observations) {
    for (const [key, val] of Object.entries(obs.features?.controlPositions ?? {})) {
      if (typeof val === "number") {
        if (!paramValues.has(key)) paramValues.set(key, []);
        paramValues.get(key)!.push(val);
      }
    }
  }

  const variances: number[] = [];
  for (const [, values] of paramValues) {
    if (values.length < 2) continue;
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((a, v) => a + (v - mean) ** 2, 0) / values.length;
    variances.push(variance);
  }
  return variances;
}

// ── Directed composition selection (intent-biased) ──

function selectDirectedComposition(
  model: PreferenceModel,
  allComps: [string, CompositionDefinition][],
  usedCompositions: Set<string>,
  intent: IntentVector,
): string {
  // Combine preference scores with intent weights
  const weights = allComps.map(([id]) => {
    const prefScore = model.compositionScores[id]?.score ?? 0.6;
    const intentWeight = intent.compositionWeights[id] ?? 1.0;
    // Multiply: intent amplifies or suppresses the preference score
    return prefScore * intentWeight;
  });

  // Penalize already-used compositions in this batch
  for (let i = 0; i < allComps.length; i++) {
    if (usedCompositions.has(allComps[i][0])) {
      weights[i] *= 0.2;
    }
  }

  return allComps[weightedRandomIndex(weights)][0];
}

// ── Directed parameter generation ──

function generateDirectedPreset(
  comp: CompositionDefinition,
  model: PreferenceModel,
  intent: IntentVector,
): GeneratedPreset {
  // Start from preferred preset, then nudge based on tag affinities
  const base = generatePreferredPreset(comp, model);

  // Override source and add brief metadata
  return {
    ...base,
    name: `Directed: ${comp.name} #${Math.floor(Math.random() * 1000)}`,
    description: `Brief: "${intent.brief}" → ${comp.name}`,
    source: "directed",
    brief: intent.brief,
    tags: [...base.tags.filter((t) => t !== "preference-generated"), "directed", ...matchingBriefTags(intent)],
  };
}

/** Extract tags from intent that had positive affinity */
function matchingBriefTags(intent: IntentVector): string[] {
  return Object.entries(intent.tagAffinities)
    .filter(([, v]) => v > 0)
    .map(([k]) => `brief:${k}`);
}

// ── Parameter generation ──

function generatePreferredPreset(comp: CompositionDefinition, model: PreferenceModel): GeneratedPreset {
  const hasMacros = comp.macros && Object.keys(comp.macros).length > 0;

  let values: Record<string, unknown>;
  let confidence = 0.5;

  if (hasMacros) {
    // Sample macro values from preferred distribution, then forward-compute
    const sampledMacros: Record<string, number> = {};
    for (const [key, macro] of Object.entries(comp.macros!)) {
      const pref = model.macroPreferences[key];
      if (pref && pref.n > 0) {
        sampledMacros[key] = sampleFromPreference(pref.preferredMean, pref.preferredStd);
        confidence = Math.min(1, 0.5 + pref.n * 0.05); // More data = higher confidence
      } else {
        sampledMacros[key] = macro.default;
      }
    }
    values = macrosToValues(comp, sampledMacros);

    // Also perturb non-macro-targeted controls using per-composition control prefs
    perturbControlValues(comp, values, model.controlPreferences[comp.id]);
  } else {
    // No macros — use per-composition control preferences directly
    values = generateFromControlPreferences(comp, model.controlPreferences[comp.id]);
  }

  return {
    composition: comp.id,
    name: `Preferred: ${comp.name} #${Math.floor(Math.random() * 1000)}`,
    description: `Generated from preference model (confidence: ${(confidence * 100).toFixed(0)}%)`,
    values,
    camera: is2DComposition(comp) ? null : sampleCamera(),
    tags: [...(comp.tags ?? []), "preference-generated"],
    source: "preference",
    confidence,
  };
}

function generateExploratoryPreset(comp: CompositionDefinition): GeneratedPreset {
  const values: Record<string, unknown> = {};

  if (comp.controls) {
    for (const [key, ctrl] of Object.entries(comp.controls)) {
      switch (ctrl.type) {
        case "slider": {
          // Random within full range
          values[key] = ctrl.min + Math.random() * (ctrl.max - ctrl.min);
          if (ctrl.step) {
            values[key] = Math.round((values[key] as number) / ctrl.step) * ctrl.step;
          }
          break;
        }
        case "toggle":
          values[key] = Math.random() < 0.5;
          break;
        case "select":
          values[key] = ctrl.options[Math.floor(Math.random() * ctrl.options.length)].value;
          break;
        case "xy":
          values[key] = [
            ctrl.min + Math.random() * (ctrl.max - ctrl.min),
            ctrl.min + Math.random() * (ctrl.max - ctrl.min),
          ];
          break;
      }
    }
  }

  return {
    composition: comp.id,
    name: `Explore: ${comp.name} #${Math.floor(Math.random() * 1000)}`,
    description: "Exploratory generation — random parameter sampling",
    values,
    camera: is2DComposition(comp) ? null : sampleCamera(),
    tags: [...(comp.tags ?? []), "exploration"],
    source: "exploration",
    confidence: 0,
  };
}

// ── Helpers ──

/** Sample from a Gaussian, clamped to [0, 1] */
function sampleFromPreference(mean: number, std: number): number {
  // Box-Muller transform
  const u1 = Math.random();
  const u2 = Math.random();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  const value = mean + z * std;
  return Math.max(0, Math.min(1, value));
}

function sampleCamera(): { theta: number; phi: number; dist: number } {
  return {
    theta: 0.3 + Math.random() * 0.6,
    phi: 0.2 + Math.random() * 0.4,
    dist: 6 + Math.random() * 6,
  };
}

/**
 * Perturb control values that aren't targeted by macros,
 * using per-composition control preferences if available.
 */
function perturbControlValues(
  comp: CompositionDefinition,
  values: Record<string, unknown>,
  controlPrefs?: Record<string, { preferredMean: number; preferredStd: number; n: number }>,
): void {
  if (!comp.controls || !comp.macros) return;

  // Find controls NOT targeted by any macro
  const macroTargets = new Set<string>();
  for (const macro of Object.values(comp.macros)) {
    for (const target of macro.targets) {
      macroTargets.add(target.param);
    }
  }

  for (const [key, ctrl] of Object.entries(comp.controls)) {
    if (macroTargets.has(key)) continue; // already set by macro
    if (ctrl.type !== "slider") continue;

    const pref = controlPrefs?.[key];
    if (pref && pref.n > 0) {
      // Sample from preferred distribution, mapped back to control range
      const normalizedPos = sampleFromPreference(pref.preferredMean, pref.preferredStd);
      let val = ctrl.min + normalizedPos * (ctrl.max - ctrl.min);
      if (ctrl.step) val = Math.round(val / ctrl.step) * ctrl.step;
      values[key] = Math.max(ctrl.min, Math.min(ctrl.max, val));
    }
    // Otherwise keep the default (already set by macrosToValues)
  }
}

function generateFromControlPreferences(
  comp: CompositionDefinition,
  controlPrefs?: Record<string, { preferredMean: number; preferredStd: number; n: number }>,
): Record<string, unknown> {
  const values: Record<string, unknown> = {};

  if (!comp.controls) return values;

  for (const [key, ctrl] of Object.entries(comp.controls)) {
    switch (ctrl.type) {
      case "slider": {
        const pref = controlPrefs?.[key];
        if (pref && pref.n > 0) {
          const normalizedPos = sampleFromPreference(pref.preferredMean, pref.preferredStd);
          let val = ctrl.min + normalizedPos * (ctrl.max - ctrl.min);
          if (ctrl.step) val = Math.round(val / ctrl.step) * ctrl.step;
          values[key] = Math.max(ctrl.min, Math.min(ctrl.max, val));
        } else {
          values[key] = ctrl.default;
        }
        break;
      }
      case "toggle":
        values[key] = ctrl.default;
        break;
      case "select":
        values[key] = ctrl.default;
        break;
      case "xy":
        values[key] = [...ctrl.default];
        break;
      case "image":
        // Image values are never sampled by the preference generator —
        // they're always null until the user picks a file in the UI.
        values[key] = null;
        break;
    }
  }

  return values;
}

function weightedRandomIndex(weights: number[]): number {
  const total = weights.reduce((a, b) => a + b, 0);
  if (total === 0) return Math.floor(Math.random() * weights.length);
  let r = Math.random() * total;
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i];
    if (r <= 0) return i;
  }
  return weights.length - 1;
}
