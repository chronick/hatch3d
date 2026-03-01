import type { MacroFn, MacroDef, ControlDef } from "./types";

export { lightModulatedLayers } from "./helpers-lighting";

export function applyMacroFn(fn: MacroFn, strength: number, macroValue: number): number {
  const delta = (macroValue - 0.5) * 2; // -1..1
  switch (fn) {
    case "linear":
      return 1 + strength * delta;
    case "log":
      return Math.exp(strength * Math.log(3) * delta);
    case "exp":
      return Math.exp(strength * delta);
    case "sqrt": {
      const sign = delta >= 0 ? 1 : -1;
      return 1 + strength * sign * Math.sqrt(Math.abs(delta));
    }
    default:
      return 1;
  }
}

export function getControlDefaults(controls?: Record<string, ControlDef>): Record<string, unknown> {
  if (!controls) return {};
  const result: Record<string, unknown> = {};
  for (const [key, ctrl] of Object.entries(controls)) {
    result[key] = ctrl.default;
  }
  return result;
}

export function getMacroDefaults(macros?: Record<string, MacroDef>): Record<string, number> {
  if (!macros) return {};
  const result: Record<string, number> = {};
  for (const [key, macro] of Object.entries(macros)) {
    result[key] = macro.default;
  }
  return result;
}

export function resolveValues(
  controls: Record<string, ControlDef> | undefined,
  macros: Record<string, MacroDef> | undefined,
  baseValues: Record<string, unknown>,
  macroValues: Record<string, number>,
): Record<string, unknown> {
  if (!controls) return { ...baseValues };
  const resolved: Record<string, unknown> = { ...baseValues };
  if (macros) {
    for (const [macroKey, macro] of Object.entries(macros)) {
      const mv = macroValues[macroKey] ?? macro.default;
      for (const target of macro.targets) {
        const control = controls[target.param];
        if (control?.type === "slider") {
          const modifier = applyMacroFn(target.fn, target.strength, mv);
          const val = (resolved[target.param] as number) * modifier;
          resolved[target.param] = Math.max(control.min, Math.min(control.max, val));
        }
      }
    }
  }
  return resolved;
}

/** Get unique groups from controls in declaration order */
export function getControlGroups(controls?: Record<string, ControlDef>): string[] {
  if (!controls) return [];
  const seen = new Set<string>();
  const groups: string[] = [];
  for (const ctrl of Object.values(controls)) {
    if (!seen.has(ctrl.group)) {
      seen.add(ctrl.group);
      groups.push(ctrl.group);
    }
  }
  return groups;
}
