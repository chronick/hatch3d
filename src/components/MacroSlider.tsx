import { memo } from "react";

export const MacroSlider = memo(function MacroSlider({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span style={{ width: 70, color: "var(--fg)", flexShrink: 0, fontSize: 11, fontWeight: 600 }}>{label}</span>
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        style={{ flex: 1, accentColor: "var(--accent-color)", height: 2 }}
      />
      <span style={{ width: 44, textAlign: "right", color: "var(--fg-dim)", fontSize: 10 }}>
        {value.toFixed(2)}
      </span>
    </div>
  );
});
