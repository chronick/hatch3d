/**
 * SceneView — a dev-accessible in-browser renderer for Scene IR documents
 * (vault-2v4c). Reachable at `#scene`. Paste or load a `.scene.json`, render it,
 * and get the same SVG `render --scene` produces headlessly.
 *
 * It runs the identical pipeline the CLI uses — parseSceneDoc → sceneToPatch →
 * evalPatch → buildLayeredSVGContent — so the in-browser result is byte-identical
 * to `npm run render -- --scene <doc>` (the acceptance gate). Kept out of the main
 * App component so it adds no state or risk to that 1400-line file.
 *
 * `luminance` nodes need an image resolver the CLI supplies by decoding a PNG;
 * here the images are uploaded and decoded through a canvas (see image-grid.ts),
 * keyed by the exact reference the scene uses. Until an image arrives the view
 * renders a clear error plus the file input for the reference it is waiting on.
 *
 * The doc's layer stack is editable through the app's own LayerPanel, bound via
 * sceneToLayers / applyLayersToScene (vault-2p7d). The scene JSON stays the
 * single source of truth: the panel is derived from it and every edit is
 * written straight back, so what renders is always what the textarea shows.
 */

import { useCallback, useMemo, useState } from "react";
import { renderSceneToSVG } from "./render-scene.js";
import { parseSceneDoc, type SceneDoc } from "./schema.js";
import { applyLayersToScene, sceneToLayers } from "./convert.js";
import {
  decodeImageFile,
  gridImageResolver,
  sceneImageRefs,
  type LuminanceGrid,
} from "./image-grid.js";
import { LayerPanel } from "../components/LayerPanel.js";
import { compositionRegistry } from "../compositions/registry.js";
import type { LayeredLayer } from "../compositions/types.js";

const EXAMPLE_SCENE = `{
  "version": 1,
  "id": "phyllotaxis-isoblocks",
  "page": { "size": "a3", "orientation": "landscape", "marginMm": 15 },
  "root": {
    "type": "group",
    "id": "root",
    "children": [
      {
        "type": "layer",
        "id": "ground",
        "pen": { "color": "#2563eb", "name": "ground" },
        "blend": "over",
        "children": [
          { "type": "generator", "id": "ground-gen", "composition": "isoWoodBlocks" }
        ]
      },
      {
        "type": "layer",
        "id": "accent",
        "pen": { "color": "#dc2626", "name": "accent" },
        "blend": "over",
        "children": [
          { "type": "generator", "id": "accent-gen", "composition": "phyllotaxisGarden" }
        ]
      }
    ]
  }
}`;

export function SceneView() {
  const [source, setSource] = useState(EXAMPLE_SCENE);
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [images, setImages] = useState<Record<string, LuminanceGrid>>({});
  const [layerNote, setLayerNote] = useState<string | null>(null);

  // The parsed doc drives both the image inputs and the layer panel, so both
  // reflect the textarea without waiting for a render attempt to fail.
  const doc = useMemo<SceneDoc | null>(() => {
    try {
      return parseSceneDoc(JSON.parse(source));
    } catch {
      return null;
    }
  }, [source]);

  const missingImages = (doc ? sceneImageRefs(doc) : []).filter((ref) => !images[ref]);

  // sceneToLayers only describes layers built around a generator; an operator-
  // only layer has no panel representation, so the panel stays hidden for it.
  const layers = useMemo<LayeredLayer[] | null>(() => {
    if (!doc) return null;
    try {
      return sceneToLayers(doc);
    } catch {
      return null;
    }
  }, [doc]);

  const renderSource = useCallback(
    (src: string, grids: Record<string, LuminanceGrid>) => {
      try {
        const { svg, layers, paths } = renderSceneToSVG(src, {
          resolveImage: gridImageResolver(grids),
        });
        setSvg(svg);
        setError(null);
        setInfo(`${layers} layer${layers === 1 ? "" : "s"}, ${paths} paths`);
      } catch (e) {
        setSvg(null);
        setInfo(null);
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [],
  );

  const render = useCallback(() => renderSource(source, images), [renderSource, source, images]);

  const loadImage = useCallback(
    (ref: string, file: File) => {
      decodeImageFile(file).then(
        (grid) => {
          const next = { ...images, [ref]: grid };
          setImages(next);
          renderSource(source, next);
        },
        (e: unknown) => setError(`could not decode "${file.name}": ${e instanceof Error ? e.message : String(e)}`),
      );
    },
    [images, renderSource, source],
  );

  const onLayersChange = useCallback(
    (next: LayeredLayer[]) => {
      if (!doc) return;
      if (!next.length) {
        setLayerNote("A scene needs at least one layer — the last one can't be removed here.");
        return;
      }
      setLayerNote(describeUnrepresented(next));
      const updated = applyLayersToScene(doc, next);
      if (updated === doc) return;
      const json = JSON.stringify(updated, null, 2);
      setSource(json);
      if (svg) renderSource(json, images);
    },
    [doc, svg, images, renderSource],
  );

  const loadFile = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = () => setSource(String(reader.result));
    reader.readAsText(file);
  }, []);

  const download = useCallback(() => {
    if (!svg) return;
    const blob = new Blob([svg], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "scene.svg";
    a.click();
    URL.revokeObjectURL(url);
  }, [svg]);

  return (
    <div style={S.wrap}>
      <div style={S.panel}>
        <div style={S.header}>
          <strong>Scene IR</strong>
          <span style={S.sub}>
            renders via the same path as <code>render --scene</code> ·{" "}
            <a href="#" style={S.link}>← app</a>
          </span>
        </div>
        <div style={S.toolbar}>
          <button data-testid="scene-render" style={S.btn} onClick={render}>Render</button>
          <label style={{ ...S.btn, ...S.fileBtn }}>
            Load .scene.json
            <input
              type="file"
              accept=".json,application/json"
              style={{ display: "none" }}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) loadFile(f); }}
            />
          </label>
          <button style={S.btn} onClick={download} disabled={!svg}>Download SVG</button>
          {info && <span data-testid="scene-info" style={S.info}>{info}</span>}
        </div>
        {layers && (
          <div data-testid="scene-layers" style={S.layers}>
            <LayerPanel
              layers={layers}
              onChange={onLayersChange}
              availableCompositions={Array.from(compositionRegistry.getAll().values())}
            />
            {layerNote && <div data-testid="scene-layer-note" style={S.layerNote}>{layerNote}</div>}
          </div>
        )}
        <textarea
          data-testid="scene-source"
          style={S.textarea}
          value={source}
          spellCheck={false}
          onChange={(e) => setSource(e.target.value)}
        />
        {error && <pre data-testid="scene-error" style={S.error}>{error}</pre>}
        {missingImages.length > 0 && (
          <div data-testid="scene-image-inputs" style={S.images}>
            <span style={S.imagesHint}>
              {missingImages.length === 1
                ? "This scene needs an image for its luminance node — upload it to render."
                : `This scene needs ${missingImages.length} images — upload each one under its own reference below.`}
            </span>
            {missingImages.map((ref) => (
              <label key={ref} style={{ ...S.btn, ...S.fileBtn }}>
                Upload <code style={S.imageRef}>{ref}</code>
                <input
                  data-testid={`scene-image-input-${ref}`}
                  type="file"
                  accept="image/*"
                  style={{ display: "none" }}
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) loadImage(ref, f); }}
                />
              </label>
            ))}
          </div>
        )}
      </div>
      <div style={S.preview}>
        {svg ? (
          <>
            <div
              data-testid="scene-preview"
              style={S.svgHost}
              // The SVG is produced by our own serializer from validated geometry.
              dangerouslySetInnerHTML={{ __html: svg }}
            />
            {/* Raw SVG text for exact byte-comparison against the CLI (dev/test). */}
            <textarea data-testid="scene-svg-output" readOnly style={S.hidden} value={svg} />
          </>
        ) : (
          <div style={S.empty}>Render a scene to preview it here.</div>
        )}
      </div>
    </div>
  );
}

/**
 * LayerPanel edits per-layer transform, camera and pass count; the scene IR has
 * no field for any of them, so they don't survive the write-back. Name them
 * rather than dropping them silently.
 */
function describeUnrepresented(layers: LayeredLayer[]): string | null {
  const fields = new Set<string>();
  for (const l of layers) {
    if (l.transform) fields.add("transform");
    if (l.camera) fields.add("camera");
    if (l.passes !== undefined) fields.add("passes");
  }
  if (!fields.size) return null;
  return `Not stored in the scene doc — dropped on write-back: ${[...fields].join(", ")}.`;
}

const S: Record<string, React.CSSProperties> = {
  wrap: { display: "flex", height: "100vh", width: "100vw", fontFamily: "system-ui, sans-serif", color: "#111", background: "#fff" },
  panel: { display: "flex", flexDirection: "column", width: "min(46%, 640px)", borderRight: "1px solid #ddd", padding: 16, boxSizing: "border-box", gap: 10 },
  header: { display: "flex", flexDirection: "column", gap: 2 },
  sub: { fontSize: 12, color: "#666" },
  link: { color: "#2563eb", textDecoration: "none" },
  toolbar: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" },
  btn: { padding: "6px 12px", border: "1px solid #ccc", borderRadius: 6, background: "#f6f6f6", cursor: "pointer", fontSize: 13 },
  fileBtn: { display: "inline-flex", alignItems: "center" },
  info: { fontSize: 12, color: "#166534" },
  textarea: { flex: 1, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 12, lineHeight: 1.4, padding: 10, border: "1px solid #ddd", borderRadius: 6, resize: "none", whiteSpace: "pre", overflow: "auto" },
  layers: { maxHeight: "40%", overflow: "auto", border: "1px solid #ddd", borderRadius: 6, padding: 8, fontFamily: "inherit" },
  layerNote: { marginTop: 6, fontSize: 11, color: "#92400e" },
  images: { display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 6, padding: 10, border: "1px solid #fde68a", background: "#fffbeb", borderRadius: 6 },
  imagesHint: { fontSize: 12, color: "#92400e" },
  imageRef: { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", marginLeft: 4 },
  error: { color: "#b91c1c", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 6, padding: 10, fontSize: 12, whiteSpace: "pre-wrap", margin: 0, maxHeight: 180, overflow: "auto" },
  preview: { flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 24, boxSizing: "border-box", background: "#fafafa", overflow: "auto" },
  svgHost: { maxWidth: "100%", maxHeight: "100%" },
  hidden: { position: "absolute", width: 1, height: 1, padding: 0, border: 0, clip: "rect(0 0 0 0)", overflow: "hidden" },
  empty: { color: "#999", fontSize: 14 },
};
