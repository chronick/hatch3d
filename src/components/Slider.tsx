import { memo } from "react";

export const Slider = memo(function Slider({
  label,
  value,
  onChange,
  min,
  max,
  step,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step: number;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span style={{ width: 70, color: "var(--fg-muted)", flexShrink: 0, fontSize: 11 }}>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        style={{ flex: 1, accentColor: "var(--accent-color)", height: 2 }}
      />
      <span style={{ width: 44, textAlign: "right", color: "var(--fg-dim)", fontSize: 10 }}>
        {typeof value === "number" && value % 1 !== 0 ? value.toFixed(2) : value}
      </span>
    </div>
  );
});
