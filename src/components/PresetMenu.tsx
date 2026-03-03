import { useState, useCallback } from "react";
import type { CompositionPreset } from "../compositions/types";
import { tagStyle, btnStyle } from "./styles";
import { Section } from "./Section";

export interface PresetMenuProps {
  compositionKey: string;
  suggested: Record<string, CompositionPreset>;
  user: Record<string, CompositionPreset>;
  onSave: (name: string) => void;
  onLoad: (preset: CompositionPreset) => void;
  onDelete: (key: string) => void;
}

export function PresetMenu({
  compositionKey,
  suggested,
  user,
  onSave,
  onLoad,
  onDelete,
}: PresetMenuProps) {
  const [name, setName] = useState("");

  const handleSave = useCallback(() => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onSave(trimmed);
    setName("");
  }, [name, onSave]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") handleSave();
    },
    [handleSave],
  );

  const suggestedEntries = Object.entries(suggested);
  const userEntries = Object.entries(user);
  const hasPresets = suggestedEntries.length > 0 || userEntries.length > 0;

  const presetItemStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 4,
    padding: "3px 0",
  };

  const presetNameBtn: React.CSSProperties = {
    ...tagStyle,
    flex: 1,
    textAlign: "left",
    background: "transparent",
    color: "var(--fg)",
    border: "none",
    padding: "2px 4px",
    fontSize: 10,
    cursor: "pointer",
  };

  return (
    <Section title="PRESETS" preview={`${suggestedEntries.length + userEntries.length} saved`}>
      {/* Save row */}
      <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Preset name..."
          style={{
            flex: 1,
            padding: "4px 6px",
            fontSize: 10,
            fontFamily: "inherit",
            border: "1px solid var(--border)",
            background: "transparent",
            color: "var(--fg)",
            outline: "none",
          }}
        />
        <button
          onClick={handleSave}
          disabled={!name.trim()}
          style={{
            ...btnStyle,
            padding: "4px 10px",
            fontSize: 10,
            opacity: name.trim() ? 1 : 0.3,
            cursor: name.trim() ? "pointer" : "default",
          }}
        >
          Save
        </button>
      </div>

      {!hasPresets && (
        <div style={{ color: "var(--fg-faint)", fontSize: 10, padding: "4px 0" }}>
          No presets for {compositionKey}
        </div>
      )}

      {/* Suggested presets */}
      {suggestedEntries.length > 0 && (
        <div>
          <div style={{ fontSize: 9, color: "var(--fg-dim)", letterSpacing: "0.08em", marginBottom: 2 }}>
            SUGGESTED
          </div>
          {suggestedEntries.map(([key, preset]) => (
            <div key={key} style={presetItemStyle}>
              <button
                onClick={() => onLoad(preset)}
                style={presetNameBtn}
                title={preset.description || preset.name}
              >
                {preset.name}
              </button>
            </div>
          ))}
        </div>
      )}

      {/* User presets */}
      {userEntries.length > 0 && (
        <div>
          <div style={{ fontSize: 9, color: "var(--fg-dim)", letterSpacing: "0.08em", marginBottom: 2 }}>
            YOUR PRESETS
          </div>
          {userEntries.map(([key, preset]) => (
            <div key={key} style={presetItemStyle}>
              <button
                onClick={() => onLoad(preset)}
                style={presetNameBtn}
                title={preset.name}
              >
                {preset.name}
              </button>
              <button
                onClick={() => onDelete(key)}
                style={{
                  ...tagStyle,
                  padding: "1px 5px",
                  fontSize: 9,
                  background: "transparent",
                  color: "var(--fg-dim)",
                }}
                title="Delete preset"
              >
                &times;
              </button>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}
