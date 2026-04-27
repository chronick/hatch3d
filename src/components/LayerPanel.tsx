import { useState, useMemo } from "react";
import type {
  LayeredLayer,
  LayerBlendMode,
  LayerTransform,
  LayerCamera,
  CompositionDefinition,
  ControlDef,
} from "../compositions/types";
import { isLayeredComposition, is2DComposition } from "../compositions/types";
import { selectStyle } from "./styles";
import { CompositionControls } from "./CompositionControls";
import { Slider } from "./Slider";
import { Toggle } from "./Toggle";
import { Section } from "./Section";

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
  const [expandedIdxRaw, setExpandedIdx] = useState<number | null>(null);

  // Clamp expanded state at render time so removing the expanded layer
  // (or any layer ahead of it shifting the range) doesn't leave us
  // pointing at a missing slot.
  const expandedIdx =
    expandedIdxRaw !== null && expandedIdxRaw < layers.length
      ? expandedIdxRaw
      : null;

  // Quick lookup so per-layer panels can resolve their inner composition.
  const compById = useMemo(() => {
    const m = new Map<string, CompositionDefinition>();
    for (const c of availableCompositions) m.set(c.id, c);
    return m;
  }, [availableCompositions]);

  const update = (idx: number, patch: Partial<LayeredLayer>) => {
    onChange(layers.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  };

  const updateOverrides = (
    idx: number,
    mutator: (
      prev: Record<string, unknown>,
    ) => Record<string, unknown> | undefined,
  ) => {
    const layer = layers[idx];
    const prev = layer.paramOverrides ?? {};
    const next = mutator(prev);
    onChange(
      layers.map((l, i) =>
        i === idx ? { ...l, paramOverrides: next } : l,
      ),
    );
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
        const inner = compById.get(layer.composition);
        const innerControls = inner?.controls;
        const expanded = expandedIdx === i;
        const overrideCount = Object.keys(layer.paramOverrides ?? {}).length;
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
              <button
                title={expanded ? "Hide layer panel" : "Per-layer params, transform, camera"}
                onClick={() => setExpandedIdx(expanded ? null : i)}
                style={{
                  ...iconBtn,
                  background: overrideCount > 0 || layer.transform || layer.camera
                    ? "var(--fg)"
                    : "transparent",
                  color: overrideCount > 0 || layer.transform || layer.camera
                    ? "var(--bg-canvas)"
                    : "var(--fg)",
                }}
              >
                {expanded ? "▾" : "▸"}
                {overrideCount > 0 ? overrideCount : ""}
              </button>
            </div>

            {expanded && inner && (
              <LayerOverrideEditor
                inner={inner}
                overrides={layer.paramOverrides ?? {}}
                transform={layer.transform}
                camera={layer.camera}
                onControlChange={(key, val) =>
                  updateOverrides(i, (prev) => ({ ...prev, [key]: val }))
                }
                onResetGroup={(group) =>
                  innerControls
                    ? updateOverrides(i, (prev) => {
                        const next = { ...prev };
                        for (const [k, c] of Object.entries(innerControls)) {
                          if (c.group === group) delete next[k];
                        }
                        return Object.keys(next).length ? next : undefined;
                      })
                    : undefined
                }
                onResetAll={() => updateOverrides(i, () => undefined)}
                onTransformChange={(t) => update(i, { transform: t })}
                onCameraChange={(c) => update(i, { camera: c })}
              />
            )}
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

/**
 * Renders a layer's inner-composition controls bound to its
 * `paramOverrides`, plus 2D transform and (for 3D inners) camera
 * sections. Macros and hatch groups are intentionally suppressed in
 * v1 — only direct control values are editable per layer.
 */
function LayerOverrideEditor({
  inner,
  overrides,
  transform,
  camera,
  onControlChange,
  onResetGroup,
  onResetAll,
  onTransformChange,
  onCameraChange,
}: {
  inner: CompositionDefinition;
  overrides: Record<string, unknown>;
  transform?: LayerTransform;
  camera?: LayerCamera;
  onControlChange: (key: string, val: unknown) => void;
  onResetGroup: ((group: string) => void) | undefined;
  onResetAll: () => void;
  onTransformChange: (t: LayerTransform | undefined) => void;
  onCameraChange: (c: LayerCamera | undefined) => void;
}) {
  const controls = inner.controls;
  const innerIs3D = !is2DComposition(inner) && !isLayeredComposition(inner);

  // Resolve "current values" the same way App.tsx does for the main panel:
  // defaults + overrides. Used for slider/toggle current values + previews.
  const resolved = useMemo(() => {
    const out: Record<string, unknown> = {};
    if (controls) {
      for (const [key, ctrl] of Object.entries(controls)) {
        out[key] = (ctrl as ControlDef).type === "image"
          ? null
          : (ctrl as { default: unknown }).default;
      }
    }
    Object.assign(out, overrides);
    return out;
  }, [controls, overrides]);

  const tx = transform?.tx ?? 0;
  const ty = transform?.ty ?? 0;
  const scale = transform?.scale ?? 1;
  const rotate = transform?.rotate ?? 0;
  const transformIsIdentity =
    tx === 0 && ty === 0 && scale === 1 && rotate === 0;

  const updateTransform = (patch: Partial<LayerTransform>) => {
    const next: LayerTransform = { tx, ty, scale, rotate, ...patch };
    const clean: LayerTransform = {};
    if (next.tx) clean.tx = next.tx;
    if (next.ty) clean.ty = next.ty;
    if (next.scale !== undefined && next.scale !== 1) clean.scale = next.scale;
    if (next.rotate) clean.rotate = next.rotate;
    onTransformChange(Object.keys(clean).length ? clean : undefined);
  };

  const camTheta = camera?.theta;
  const camPhi = camera?.phi;
  const camDist = camera?.dist;
  const camPanX = camera?.panX;
  const camPanY = camera?.panY;
  const camOrtho = camera?.ortho;
  const cameraIsEmpty = camera === undefined || Object.keys(camera).length === 0;

  const updateCamera = (patch: Partial<LayerCamera>) => {
    const next: LayerCamera = { ...camera, ...patch };
    // Drop fields explicitly set to undefined (treat as "fall back to outer")
    const clean: LayerCamera = {};
    for (const [k, v] of Object.entries(next)) {
      if (v !== undefined) (clean as Record<string, unknown>)[k] = v;
    }
    onCameraChange(Object.keys(clean).length ? clean : undefined);
  };

  return (
    <div
      style={{
        marginTop: 4,
        paddingTop: 6,
        borderTop: "1px dashed var(--border-light)",
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <Section
        title="TRANSFORM"
        preview={transformIsIdentity ? "identity" : `${scale.toFixed(2)}× ${tx.toFixed(0)},${ty.toFixed(0)}`}
        onReset={transformIsIdentity ? undefined : () => onTransformChange(undefined)}
        defaultOpen={!transformIsIdentity}
      >
        <Slider
          label="Pan X"
          value={tx}
          onChange={(v) => updateTransform({ tx: v })}
          min={-400}
          max={400}
          step={1}
        />
        <Slider
          label="Pan Y"
          value={ty}
          onChange={(v) => updateTransform({ ty: v })}
          min={-400}
          max={400}
          step={1}
        />
        <Slider
          label="Scale"
          value={scale}
          onChange={(v) => updateTransform({ scale: v })}
          min={0.1}
          max={4}
          step={0.01}
        />
        <Slider
          label="Rotate"
          value={rotate}
          onChange={(v) => updateTransform({ rotate: v })}
          min={-Math.PI}
          max={Math.PI}
          step={0.01}
        />
      </Section>

      {innerIs3D && (
        <Section
          title="CAMERA"
          preview={cameraIsEmpty ? "inherit" : "override"}
          onReset={cameraIsEmpty ? undefined : () => onCameraChange(undefined)}
          defaultOpen={!cameraIsEmpty}
        >
          <Toggle
            label="Ortho"
            value={camOrtho ?? false}
            onChange={(v) => updateCamera({ ortho: v })}
          />
          <Slider
            label="Dist"
            value={camDist ?? 8}
            onChange={(v) => updateCamera({ dist: v })}
            min={1}
            max={30}
            step={0.1}
          />
          <Slider
            label="Theta"
            value={camTheta ?? 0.6}
            onChange={(v) => updateCamera({ theta: v })}
            min={-Math.PI}
            max={Math.PI}
            step={0.01}
          />
          <Slider
            label="Phi"
            value={camPhi ?? 0.35}
            onChange={(v) => updateCamera({ phi: v })}
            min={-Math.PI / 2}
            max={Math.PI / 2}
            step={0.01}
          />
          <Slider
            label="Pan X"
            value={camPanX ?? 0}
            onChange={(v) => updateCamera({ panX: v })}
            min={-2}
            max={2}
            step={0.01}
          />
          <Slider
            label="Pan Y"
            value={camPanY ?? 0}
            onChange={(v) => updateCamera({ panY: v })}
            min={-2}
            max={2}
            step={0.01}
          />
        </Section>
      )}

      {controls && Object.keys(controls).length > 0 && onResetGroup && (
        <CompositionControls
          controls={controls}
          macros={undefined}
          hatchGroups={undefined}
          currentValues={resolved}
          currentMacros={{}}
          resolvedValues={resolved}
          currentHatchGroups={{}}
          onControlChange={onControlChange}
          onMacroChange={() => {}}
          onHatchGroupChange={() => {}}
          onResetMacros={() => {}}
          onResetGroup={onResetGroup}
          onResetAll={onResetAll}
        />
      )}
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
