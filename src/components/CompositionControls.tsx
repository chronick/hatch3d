import { memo, useMemo, useRef, useEffect } from "react";
import type { ControlDef, MacroDef } from "../compositions/types";
import { getControlGroups } from "../compositions/helpers";
import { Section } from "./Section";
import { MacroSlider } from "./MacroSlider";
import { ControlRenderer } from "./ControlRenderer";
import { HatchGroupControls } from "./HatchGroupControls";
import { HATCH_GROUP_DEFAULT, type HatchGroupConfig } from "./HatchGroupControls.types";

export const CompositionControls = memo(function CompositionControls({
  controls,
  macros,
  hatchGroups,
  currentValues,
  currentMacros,
  resolvedValues,
  currentHatchGroups,
  onControlChange,
  onMacroChange,
  onHatchGroupChange,
  onResetMacros,
  onResetGroup,
  onResetAll: _onResetAll,
}: {
  controls?: Record<string, ControlDef>;
  macros?: Record<string, MacroDef>;
  hatchGroups?: string[];
  currentValues: Record<string, unknown>;
  currentMacros: Record<string, number>;
  resolvedValues: Record<string, unknown>;
  currentHatchGroups: Record<string, HatchGroupConfig>;
  onControlChange: (key: string, val: unknown) => void;
  onMacroChange: (key: string, val: number) => void;
  onHatchGroupChange: (groupName: string, config: HatchGroupConfig) => void;
  onResetMacros: () => void;
  onResetGroup: (group: string) => void;
  onResetAll: () => void;
}) {
  // Memoize groups so they don't recompute on every value change
  const groups = useMemo(() => getControlGroups(controls), [controls]);

  // Stable per-macro callbacks via a ref to avoid re-rendering all MacroSliders when one changes
  const onMacroChangeRef = useRef(onMacroChange);
  useEffect(() => {
    onMacroChangeRef.current = onMacroChange;
  });
  const macroHandlers = useMemo(() => {
    if (!macros) return {} as Record<string, (v: number) => void>;
    const handlers: Record<string, (v: number) => void> = {};
    for (const key of Object.keys(macros)) {
      handlers[key] = (v: number) => onMacroChangeRef.current(key, v);
    }
    return handlers;
  }, [macros]);

  const macroPreview = macros
    ? Object.values(currentMacros).map((v) => v.toFixed(1)).join(" \u00b7 ")
    : undefined;

  // Pre-compute grouped controls so we don't filter on every render
  const groupedControls = useMemo(() => {
    if (!controls) return new Map<string, [string, ControlDef][]>();
    const map = new Map<string, [string, ControlDef][]>();
    for (const [key, ctrl] of Object.entries(controls)) {
      let arr = map.get(ctrl.group);
      if (!arr) { arr = []; map.set(ctrl.group, arr); }
      arr.push([key, ctrl]);
    }
    return map;
  }, [controls]);

  // Stable per-group reset handlers
  const onResetGroupRef = useRef(onResetGroup);
  useEffect(() => {
    onResetGroupRef.current = onResetGroup;
  });
  const groupResetHandlers = useMemo(() => {
    const handlers: Record<string, () => void> = {};
    for (const g of groups) {
      handlers[g] = () => onResetGroupRef.current(g);
    }
    return handlers;
  }, [groups]);

  return (
    <>
      {macros && Object.keys(macros).length > 0 && (
        <Section title="MACROS" preview={macroPreview} onReset={onResetMacros}>
          {Object.entries(macros).map(([key, macro]) => (
            <MacroSlider
              key={key}
              label={macro.label}
              value={currentMacros[key] ?? macro.default}
              onChange={macroHandlers[key]}
            />
          ))}
        </Section>
      )}
      {groups.map((group) => {
        const groupControls = groupedControls.get(group) ?? [];
        const previewParts = groupControls
          .slice(0, 2)
          .map(([k, c]) => {
            const v = resolvedValues[k];
            if (c.type === "slider") return `${(v as number).toFixed(1)}`;
            if (c.type === "toggle") return (v as boolean) ? "on" : "off";
            if (c.type === "image") return v ? "loaded" : "—";
            return String(v);
          });
        return (
          <Section key={group} title={group.toUpperCase()} preview={previewParts.join(" \u00b7 ")} defaultOpen={group !== "Visibility" && group !== "Position" && group !== "Style"} onReset={groupResetHandlers[group]}>
            {groupControls.map(([key, ctrl]) => (
              <ControlRenderer
                key={key}
                controlKey={key}
                control={ctrl}
                value={currentValues[key] ?? (ctrl.type === "image" ? null : ctrl.default)}
                onChange={onControlChange}
              />
            ))}
          </Section>
        );
      })}
      {hatchGroups && hatchGroups.length > 0 && (
        <>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", color: "var(--fg-dim)", borderBottom: "1px solid var(--border-light)", paddingBottom: 4 }}>
            HATCH GROUPS
          </div>
          {hatchGroups.map((groupName) => {
            const config = currentHatchGroups[groupName] ?? HATCH_GROUP_DEFAULT;
            const preview = config.family === "inherit" ? "global" : config.family;
            return (
              <Section
                key={groupName}
                title={groupName}
                preview={preview}
                onReset={() => onHatchGroupChange(groupName, HATCH_GROUP_DEFAULT)}
              >
                <HatchGroupControls
                  groupName={groupName}
                  config={config}
                  onChange={onHatchGroupChange}
                />
              </Section>
            );
          })}
        </>
      )}
    </>
  );
});
