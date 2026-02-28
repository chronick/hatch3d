import { memo } from "react";

export const Toggle = memo(function Toggle({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div
      onClick={() => onChange(!value)}
      style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}
    >
      <div
        style={{
          width: 28,
          height: 14,
          borderRadius: 7,
          background: value ? "var(--fg)" : "var(--toggle-off)",
          position: "relative",
          transition: "background 0.15s",
          flexShrink: 0,
        }}
      >
        <div
          style={{
            width: 10,
            height: 10,
            borderRadius: 5,
            background: "var(--bg-canvas)",
            position: "absolute",
            top: 2,
            left: value ? 16 : 2,
            transition: "left 0.15s",
          }}
        />
      </div>
      <span style={{ color: "var(--fg-muted)" }}>{label}</span>
    </div>
  );
});
