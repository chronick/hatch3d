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
 * Note: `luminance` nodes need an image resolver the CLI supplies by decoding a
 * PNG; in-browser that would be an uploaded image (a follow-up). A scene using
 * `luminance` renders a clear error here rather than silently mis-rendering.
 */

import { useCallback, useState } from "react";
import { renderSceneToSVG } from "./render-scene.js";

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

  const render = useCallback(() => {
    try {
      const { svg, layers, paths } = renderSceneToSVG(source);
      setSvg(svg);
      setError(null);
      setInfo(`${layers} layer${layers === 1 ? "" : "s"}, ${paths} paths`);
    } catch (e) {
      setSvg(null);
      setInfo(null);
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [source]);

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
        <textarea
          data-testid="scene-source"
          style={S.textarea}
          value={source}
          spellCheck={false}
          onChange={(e) => setSource(e.target.value)}
        />
        {error && <pre data-testid="scene-error" style={S.error}>{error}</pre>}
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
  error: { color: "#b91c1c", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 6, padding: 10, fontSize: 12, whiteSpace: "pre-wrap", margin: 0, maxHeight: 180, overflow: "auto" },
  preview: { flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 24, boxSizing: "border-box", background: "#fafafa", overflow: "auto" },
  svgHost: { maxWidth: "100%", maxHeight: "100%" },
  hidden: { position: "absolute", width: 1, height: 1, padding: 0, border: 0, clip: "rect(0 0 0 0)", overflow: "hidden" },
  empty: { color: "#999", fontSize: 14 },
};
