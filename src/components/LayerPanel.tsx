import { useState } from "react";
import type {
  LayeredLayer,
  LayerBlendMode,
  CompositionDefinition,
} from "../compositions/types";
import { isLayeredComposition, is2DComposition } from "../compositions/types";
import { selectStyle } from "./styles";

const PEN_PALETTE = [
  "#000000",
  "#dc2626",
  "#2563eb",
  "#16a34a",
  "#ea580c",
  "#9333ea",
  "#0891b2",
  "#ca8a04",
];

interface LayerPanelProps {
  layers: LayeredLayer[];
  onChange: (layers: LayeredLayer[]) => void;
  /** All registered compositions (for the add-layer picker). */
  availableCompositions: CompositionDefinition[];
  /** Reset to the composition definition's original layers. */
  onReset?: () => void;
}

/**
 * Editor for a layered composition's layer stack.
 *
 * Per layer: visibility, name, color, blend mode, reorder, delete.
 * Bottom: add a new layer from the registry.
 *
 * paramOverrides editing is intentionally deferred — surface it later
 * by expanding a layer to show the inner composition's controls.
 */
export function LayerPanel({
  layers,
  onChange,
  availableCompositions,
  onReset,
}: LayerPanelProps) {
  const [picking, setPicking] = useState(false);

  const update = (idx: number, patch: Partial<LayeredLayer>) => {
    onChange(layers.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  };
  const remove = (idx: number) => onChange(layers.filter((_, i) => i !== idx));
  const move = (idx: number, dir: -1 | 1) => {
    const j = idx + dir;
    if (j < 0 || j >= layers.length) return;
    const next = [...layers];
    [next[idx], next[j]] = [next[j], next[idx]];
    onChange(next);
  };
  const add = (compositionId: string) => {
    const nextColor = PEN_PALETTE[layers.length % PEN_PALETTE.length];
    onChange([
      ...layers,
      {
        composition: compositionId,
        name: compositionId,
        color: nextColor,
        blendMode: "over",
        visible: true,
      },
    ]);
    setPicking(false);
  };

  // Only non-layered compositions can be added as inner layers.
  const innerCandidates = availableCompositions
    .filter((c) => !isLayeredComposition(c))
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div
        style={{
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: "0.1em",
          color: "var(--fg-dim)",
          marginBottom: 4,
          borderBottom: "1px solid var(--border-light)",
          paddingBottom: 4,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <span>LAYERS ({layers.length})</span>
        {onReset && layers.length > 0 && (
          <span
            onClick={onReset}
            style={{
              fontSize: 9,
              fontWeight: 400,
              color: "var(--fg-hint)",
              cursor: "pointer",
              textDecoration: "underline",
              textDecorationStyle: "dotted",
              textUnderlineOffset: 2,
            }}
          >
            reset
          </span>
        )}
      </div>

      {layers.length === 0 && (
        <div style={{ fontSize: 10, color: "var(--fg-hint)", padding: "4px 0" }}>
          No layers — add one below.
        </div>
      )}

      {layers.map((layer, i) => {
        const visible = layer.visible !== false;
        return (
          <div
            key={i}
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 4,
              padding: 6,
              border: "1px solid var(--border-light)",
              opacity: visible ? 1 : 0.5,
              background: "var(--panel-bg, transparent)",
            }}
          >
            <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
              <button
                title={visible ? "Hide layer" : "Show layer"}
                onClick={() => update(i, { visible: !visible })}
                style={iconBtn}
              >
                {visible ? "👁" : "—"}
              </button>
              <button
                title="Move up"
                onClick={() => move(i, -1)}
                disabled={i === 0}
                style={{ ...iconBtn, opacity: i === 0 ? 0.3 : 1 }}
              >
                ▲
              </button>
              <button
                title="Move down"
                onClick={() => move(i, 1)}
                disabled={i === layers.length - 1}
                style={{ ...iconBtn, opacity: i === layers.length - 1 ? 0.3 : 1 }}
              >
                ▼
              </button>
              <input
                value={layer.name ?? ""}
                placeholder={layer.composition}
                onChange={(e) => update(i, { name: e.target.value })}
                style={{
                  flex: 1,
                  background: "transparent",
                  border: "1px solid var(--border-light)",
                  color: "var(--fg)",
                  fontSize: 10,
                  fontFamily: "inherit",
                  padding: "2px 4px",
                }}
              />
              <button
                title="Remove layer"
                onClick={() => remove(i)}
                style={{ ...iconBtn, color: "var(--fg-hint)" }}
              >
                ×
              </button>
            </div>

            <div
              style={{
                display: "flex",
                gap: 4,
                alignItems: "center",
                fontSize: 10,
                color: "var(--fg-dim)",
              }}
            >
              <span style={{ flex: 1, fontFamily: "monospace" }}>
                {layer.composition}
              </span>

              <input
                type="color"
                value={layer.color ?? "#000000"}
                onChange={(e) => update(i, { color: e.target.value })}
                title="Pen color"
                style={{
                  width: 24,
                  height: 18,
                  padding: 0,
                  border: "1px solid var(--border-light)",
                  cursor: "pointer",
                  background: "transparent",
                }}
              />

              <select
                value={layer.blendMode ?? "over"}
                onChange={(e) =>
                  update(i, { blendMode: e.target.value as LayerBlendMode })
                }
                style={{ ...selectStyle, fontSize: 9, padding: "1px 4px" }}
                title="Blend mode"
              >
                <option value="over">over</option>
                <option value="masked">masked</option>
              </select>

              {layer.blendMode === "masked" && (
                <select
                  value={layer.maskBy ?? Math.max(0, i - 1)}
                  onChange={(e) =>
                    update(i, { maskBy: parseInt(e.target.value, 10) })
                  }
                  style={{ ...selectStyle, fontSize: 9, padding: "1px 4px" }}
                  title="Mask by layer index"
                >
                  {layers.map((other, j) =>
                    j === i ? null : (
                      <option key={j} value={j}>
                        ⤴ {j}: {other.name ?? other.composition}
                      </option>
                    ),
                  )}
                </select>
              )}
            </div>
          </div>
        );
      })}

      {picking ? (
        <div style={{ display: "flex", gap: 4 }}>
          <select
            autoFocus
            onChange={(e) => {
              if (e.target.value) add(e.target.value);
            }}
            style={{ ...selectStyle, flex: 1, fontSize: 10 }}
            defaultValue=""
          >
            <option value="" disabled>
              Pick a composition…
            </option>
            {innerCandidates.map((c) => (
              <option key={c.id} value={c.id}>
                {c.category === "2d" ? "2D" : "3D"} · {c.name}
              </option>
            ))}
          </select>
          <button onClick={() => setPicking(false)} style={iconBtn}>
            ×
          </button>
        </div>
      ) : (
        <button
          onClick={() => setPicking(true)}
          style={{
            ...selectStyle,
            fontSize: 10,
            padding: "4px 8px",
            textAlign: "center",
          }}
        >
          + add layer
        </button>
      )}

      {is2DLayerWarning(layers, availableCompositions)}
    </div>
  );
}

const iconBtn: React.CSSProperties = {
  padding: "1px 5px",
  fontSize: 11,
  fontFamily: "inherit",
  border: "1px solid var(--border-light)",
  background: "transparent",
  color: "var(--fg)",
  cursor: "pointer",
  borderRadius: 0,
  minWidth: 22,
  lineHeight: 1.2,
};

/**
 * Mixing 2D and 3D inner compositions in one layered stack works but
 * coordinate spaces don't match (3D depends on camera, 2D fills the
 * canvas directly). Surface a hint when both are present.
 */
function is2DLayerWarning(
  layers: LayeredLayer[],
  registry: CompositionDefinition[],
) {
  const lookup = new Map(registry.map((c) => [c.id, c]));
  let has2D = false;
  let has3D = false;
  for (const l of layers) {
    const c = lookup.get(l.composition);
    if (!c) continue;
    if (is2DComposition(c)) has2D = true;
    else if (!isLayeredComposition(c)) has3D = true;
  }
  if (has2D && has3D) {
    return (
      <div
        style={{
          fontSize: 9,
          color: "var(--fg-hint)",
          fontStyle: "italic",
          padding: "2px 0",
        }}
      >
        ⚠ mixing 2D and 3D layers — alignment depends on the 3D camera.
      </div>
    );
  }
  return null;
}
