import { useState } from "react";

export function HoverReset({
  label,
  onReset,
  children,
}: {
  label: string;
  onReset: () => void;
  children: React.ReactNode;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ display: "inline-flex", alignItems: "baseline", gap: 4 }}
    >
      {hovered ? (
        <span
          onClick={onReset}
          style={{
            color: "var(--fg-dim)",
            fontWeight: 600,
            cursor: "pointer",
            textDecoration: "underline",
            textDecorationStyle: "dotted",
            textUnderlineOffset: 2,
          }}
        >
          reset
        </span>
      ) : (
        <span style={{ color: "var(--fg-dim)", fontWeight: 600 }}>{label}</span>
      )}
      {" "}{children}
    </div>
  );
}
