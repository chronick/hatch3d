import { useState } from "react";

export function Section({
  title,
  preview,
  defaultOpen = true,
  onReset,
  children,
}: {
  title: string;
  preview?: string;
  defaultOpen?: boolean;
  onReset?: () => void;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [resetHover, setResetHover] = useState(false);
  return (
    <div>
      <div
        onClick={() => setOpen(!open)}
        style={{
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: "0.1em",
          color: "var(--fg-dim)",
          marginBottom: open ? 7 : 0,
          borderBottom: "1px solid var(--border-light)",
          paddingBottom: 4,
          cursor: "pointer",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          userSelect: "none",
        }}
      >
        <span>{title}</span>
        <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
          {open && onReset && (
            <span
              onClick={(e) => { e.stopPropagation(); onReset(); }}
              onMouseEnter={() => setResetHover(true)}
              onMouseLeave={() => setResetHover(false)}
              style={{
                fontSize: 9,
                fontWeight: 400,
                color: resetHover ? "var(--fg)" : "var(--fg-hint)",
                cursor: "pointer",
                textDecoration: "underline",
                textDecorationStyle: "dotted",
                textUnderlineOffset: 2,
              }}
            >
              reset
            </span>
          )}
          {!open && preview && (
            <span style={{ color: "var(--fg-hint)", fontSize: 9, fontWeight: 400 }}>{preview}</span>
          )}
          <span style={{ fontSize: 9 }}>{open ? "\u25BE" : "\u25B8"}</span>
        </span>
      </div>
      {open && (
        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>{children}</div>
      )}
    </div>
  );
}
