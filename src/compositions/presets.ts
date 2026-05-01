import type { CompositionPreset, LayeredLayer } from "./types";

const USER_PRESETS_KEY = "hatch3d-user-presets";

export interface StoredPresets {
  [compositionId: string]: Record<string, CompositionPreset>;
}

/** Load all user presets from localStorage */
export function loadUserPresets(): StoredPresets {
  try {
    const raw = localStorage.getItem(USER_PRESETS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

/** Save a user preset for a given composition */
export function saveUserPreset(compositionId: string, presetKey: string, preset: CompositionPreset): void {
  const all = loadUserPresets();
  if (!all[compositionId]) all[compositionId] = {};
  all[compositionId][presetKey] = preset;
  localStorage.setItem(USER_PRESETS_KEY, JSON.stringify(all));
}

/** Delete a user preset */
export function deleteUserPreset(compositionId: string, presetKey: string): void {
  const all = loadUserPresets();
  if (all[compositionId]) {
    delete all[compositionId][presetKey];
    if (Object.keys(all[compositionId]).length === 0) delete all[compositionId];
  }
  localStorage.setItem(USER_PRESETS_KEY, JSON.stringify(all));
}

/**
 * Strip per-instance `__id` from each layer for preset serialization.
 * Pure: returns a new array of shallow copies; does not mutate input.
 */
export function buildLayeredPresetValues(layers: LayeredLayer[]): LayeredLayer[] {
  return layers.map(({ __id, ...rest }) => rest);
}

/** Get all presets for a composition (author suggested + user saved) */
export function getPresetsForComposition(
  compositionId: string,
  suggestedPresets?: Record<string, CompositionPreset>,
): { suggested: Record<string, CompositionPreset>; user: Record<string, CompositionPreset> } {
  const userAll = loadUserPresets();
  return {
    suggested: suggestedPresets ?? {},
    user: userAll[compositionId] ?? {},
  };
}
