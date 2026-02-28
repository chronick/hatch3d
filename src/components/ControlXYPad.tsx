import { XYPad } from "./XYPad";

export function ControlXYPad({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: [number, number];
  min: number;
  max: number;
  onChange: (v: [number, number]) => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <span style={{ color: "var(--fg-muted)", fontSize: 10 }}>{label}</span>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <XYPad
          valueX={value[0]}
          valueY={value[1]}
          onChangeX={(x) => onChange([x, value[1]])}
          onChangeY={(y) => onChange([value[0], y])}
          min={min}
          max={max}
          size={100}
        />
        <span style={{ color: "var(--fg-dim)", fontSize: 10 }}>
          {value[0].toFixed(2)}, {value[1].toFixed(2)}
        </span>
      </div>
    </div>
  );
}
