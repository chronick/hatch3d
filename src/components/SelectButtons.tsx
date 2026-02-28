import { memo } from "react";
import { tagStyle } from "./styles";

export const SelectButtons = memo(function SelectButtons({
  options,
  value,
  onChange,
}: {
  options: { label: string; value: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          style={{
            ...tagStyle,
            background: value === opt.value ? "var(--fg)" : "transparent",
            color: value === opt.value ? "var(--bg-canvas)" : "var(--fg)",
          }}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
});
