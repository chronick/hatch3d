/**
 * Feature extraction: transform raw config.json parameters into
 * composition-independent normalized features for preference learning.
 */

import type { CompositionDefinition } from "../compositions/types.js";
import type { SliderControl } from "../compositions/types.js";
import { is2DComposition } from "../compositions/types.js";
import { applyMacroFn } from "../compositions/helpers.js";
import type { NormalizedFeatures } from "./types.js";

/**
 * Extract normalized features from a generation config.
 *
 * For each slider control, compute its normalized position (0 = min, 1 = max).
 * For each macro, reverse-compute its approximate value by examining how far
 * each target parameter has moved from its default.
 */
export function extractFeatures(
  comp: CompositionDefinition,
  values: Record<string, unknown>,
  stats: { lines: number; verts: number; paths: number },
): NormalizedFeatures {
  const category = is2DComposition(comp) ? "2d" : "3d";
  const controlPositions: Record<string, number> = {};
  const macroValues: Record<string, number> = {};

  // Normalize each slider control to 0-1
  if (comp.controls) {
    for (const [key, ctrl] of Object.entries(comp.controls)) {
      if (ctrl.type === "slider") {
        const val = values[key] as number | undefined;
        if (val !== undefined) {
          const range = ctrl.max - ctrl.min;
          controlPositions[key] = range > 0 ? (val - ctrl.min) / range : 0.5;
        }
      }
    }
  }

  // Reverse-compute macro values from parameter positions
  if (comp.macros && comp.controls) {
    for (const [macroKey, macro] of Object.entries(comp.macros)) {
      macroValues[macroKey] = reverseMacro(macro, comp.controls, values);
    }
  }

  // Compute stat features
  // pathDensity: paths per 1000px^2 (normalized to typical A3 800x800 canvas)
  const canvasArea = 800 * 800;
  const pathDensity = stats.paths / (canvasArea / 1000);
  const vertexDensity = stats.paths > 0 ? stats.verts / stats.paths : 0;

  return {
    compositionId: comp.id,
    category,
    macroValues,
    controlPositions,
    pathDensity,
    vertexDensity,
    lineCount: stats.lines,
    tags: comp.tags ?? [],
  };
}

/**
 * Reverse-compute approximate macro value from observed parameter values.
 *
 * The forward pass: macroValue → modifier → param = default * modifier
 * The reverse: param/default → modifier → macroValue
 *
 * We average across all targets, weighted by |strength|.
 */
function reverseMacro(
  macro: { default: number; targets: { param: string; fn: string; strength: number }[] },
  controls: Record<string, import("../compositions/types.js").ControlDef>,
  values: Record<string, unknown>,
): number {
  let weightedSum = 0;
  let totalWeight = 0;

  for (const target of macro.targets) {
    const ctrl = controls[target.param];
    if (!ctrl || ctrl.type !== "slider") continue;

    const currentVal = values[target.param] as number | undefined;
    if (currentVal === undefined) continue;

    const defaultVal = (ctrl as SliderControl).default;
    if (defaultVal === 0) continue; // can't reverse from zero default

    // Forward: modifier = applyMacroFn(fn, strength, macroValue)
    //          param = default * modifier
    // So: modifier = param / default
    const modifier = currentVal / defaultVal;

    // Binary search for the macroValue that produces this modifier
    const estimated = invertMacroFn(
      target.fn as import("../compositions/types.js").MacroFn,
      target.strength,
      modifier,
    );

    const weight = Math.abs(target.strength);
    weightedSum += estimated * weight;
    totalWeight += weight;
  }

  return totalWeight > 0 ? Math.max(0, Math.min(1, weightedSum / totalWeight)) : macro.default;
}

/**
 * Invert applyMacroFn: given a modifier value, find the macroValue (0-1) that produces it.
 * Uses binary search since the functions are monotonic in delta.
 */
function invertMacroFn(
  fn: import("../compositions/types.js").MacroFn,
  strength: number,
  targetModifier: number,
): number {
  let lo = 0;
  let hi = 1;

  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) / 2;
    const modifier = applyMacroFn(fn, strength, mid);
    if (modifier < targetModifier) {
      // Depends on whether strength is positive or negative
      if (strength >= 0) lo = mid;
      else hi = mid;
    } else {
      if (strength >= 0) hi = mid;
      else lo = mid;
    }
  }

  return (lo + hi) / 2;
}

/**
 * Forward-compute: given macro values, generate concrete parameter values.
 * Used by the generator to produce new presets from preference-sampled macros.
 */
export function macrosToValues(
  comp: CompositionDefinition,
  macroValues: Record<string, number>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  // Start from control defaults
  if (comp.controls) {
    for (const [key, ctrl] of Object.entries(comp.controls)) {
      if (ctrl.type === "xy") result[key] = [...ctrl.default];
      else if (ctrl.type === "image") result[key] = null;
      else result[key] = ctrl.default;
    }
  }

  // Apply macros
  if (comp.macros && comp.controls) {
    for (const [macroKey, macro] of Object.entries(comp.macros)) {
      const mv = macroValues[macroKey] ?? macro.default;
      for (const target of macro.targets) {
        const ctrl = comp.controls[target.param];
        if (ctrl?.type === "slider") {
          const modifier = applyMacroFn(target.fn as import("../compositions/types.js").MacroFn, target.strength, mv);
          const val = (result[target.param] as number) * modifier;
          result[target.param] = Math.max(ctrl.min, Math.min(ctrl.max, val));
        }
      }
    }
  }

  return result;
}
