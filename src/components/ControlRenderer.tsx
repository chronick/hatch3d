import { memo, useCallback } from "react";
import type { ControlDef } from "../compositions/types";
import { Slider } from "./Slider";
import { Toggle } from "./Toggle";
import { SelectButtons } from "./SelectButtons";
import { ControlXYPad } from "./ControlXYPad";

export const ControlRenderer = memo(function ControlRenderer({
  controlKey,
  control,
  value,
  onChange,
}: {
  controlKey: string;
  control: ControlDef;
  value: unknown;
  onChange: (key: string, val: unknown) => void;
}) {
  // Stable per-key callback so children don't re-render from new closure refs
  const handleChange = useCallback(
    (v: unknown) => onChange(controlKey, v),
    [onChange, controlKey],
  );

  switch (control.type) {
    case "slider":
      return (
        <Slider
          label={control.label}
          value={value as number}
          onChange={handleChange as (v: number) => void}
          min={control.min}
          max={control.max}
          step={control.step ?? (control.max - control.min > 10 ? 1 : 0.01)}
        />
      );
    case "toggle":
      return (
        <Toggle
          label={control.label}
          value={value as boolean}
          onChange={handleChange as (v: boolean) => void}
        />
      );
    case "select":
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <span style={{ color: "var(--fg-muted)", fontSize: 10 }}>{control.label}</span>
          <SelectButtons
            options={control.options}
            value={value as string}
            onChange={handleChange as (v: string) => void}
          />
        </div>
      );
    case "xy":
      return (
        <ControlXYPad
          label={control.label}
          value={value as [number, number]}
          min={control.min}
          max={control.max}
          onChange={handleChange as (v: [number, number]) => void}
        />
      );
    default:
      return null;
  }
});
