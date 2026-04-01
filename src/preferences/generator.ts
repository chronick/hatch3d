/**
 * Preference-biased preset generator.
 *
 * Replaces the simple selectPresets() in feed-push.ts with preference-aware
 * generation. Balances exploitation (more of what's liked) with exploration
 * (surprise and discovery).
 *
 * Extension points for future evolution engine:
 *   - swap `sampleMacroValues()` for genetic crossover / LLM-guided mutation
 *   - swap `scorePreset()` for a learned quality predictor
 *   - add `mutate()` for parameter perturbation
 */

import type { CompositionDefinition, SliderControl } from "../compositions/types.js";
import { is2DComposition } from "../compositions/types.js";
import type { CompositionRegistry } from "../compositions/registry.js";
import type { PreferenceModel, GeneratedPreset } from "./types.js";
import { macrosToValues } from "./features.js";

interface GeneratorOptions {
  count: number;
  /** 0 = pure exploitation, 1 = pure exploration. Default 0.2 */
  explorationRate?: number;
  /** Force a specific composition */
  forceComposition?: string;
  /** Existing hand-curated presets to mix in */
  curatedPresets?: GeneratedPreset[];
}

/**
 * Generate preference-biased presets for feed push.
 */
export function generateBiasedPresets(
  model: PreferenceModel,
  registry: CompositionRegistry,
  options: GeneratorOptions,
): GeneratedPreset[] {
  const { count, explorationRate = 0.2, forceComposition, curatedPresets = [] } = options;
  const results: GeneratedPreset[] = [];
  const usedCompositions = new Set<string>();
  const allComps = [...registry.getAll().entries()];

  for (let i = 0; i < count; i++) {
    const isExplore = Math.random() < explorationRate;

    // 1. Select composition
    const compId = forceComposition ?? selectComposition(model, allComps, usedCompositions, isExplore);
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
    const preset = isExplore
      ? generateExploratoryPreset(comp)
      : generatePreferredPreset(comp, model);

    results.push(preset);
  }

  return results;
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
