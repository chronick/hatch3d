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
  const decimals = typeof value === "number" && value % 1 !== 0
    ? Math.max(2, -Math.floor(Math.log10(step)))
    : 0;

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
        style={{ flex: 1 }}
      />
      <span style={{ width: 50, textAlign: "right", color: "var(--fg-dim)", fontSize: 10, flexShrink: 0 }}>
        {decimals > 0 ? value.toFixed(decimals) : value}
      </span>
    </div>
  );
});
