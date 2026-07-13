/**
 * renderSceneToSVG — the pure Scene-IR → SVG path, shared by the in-browser
 * SceneView and available headless. Runs the exact pipeline the CLI uses
 * (parseSceneDoc → sceneToPatch → evalPatch → buildLayeredSVGContent), so an
 * in-browser render is byte-identical to `render --scene` (vault-2v4c). Kept
 * separate from SceneView.tsx so that component file only exports a component.
 */

import { parseSceneDoc } from "./schema.js";
import { sceneToPatch } from "./to-patch.js";
import { evalPatch } from "../patch/graph.js";
import { polylinesToSVGPaths } from "../projection.js";
import { buildLayeredSVGContent, computeExportLayout } from "./svg-output.js";
import type { LayerGroupResult } from "../workers/render-worker.types.js";

/** Render a scene document string to an SVG string via the CLI-identical path. */
export function renderSceneToSVG(sceneJson: string): { svg: string; layers: number; paths: number } {
  const raw: unknown = JSON.parse(sceneJson);
  const doc = parseSceneDoc(raw);
  const patch = sceneToPatch(doc);
  const { layers, page } = evalPatch(patch);
  const layout = computeExportLayout(page.size, page.orientation, page.marginMm, page.widthPx, page.heightPx);
  const groups: LayerGroupResult[] = layers.map((l) => ({
    id: l.id,
    name: l.name,
    color: l.color,
    svgPaths: polylinesToSVGPaths(l.geometry),
  }));
  const svg = buildLayeredSVGContent(groups, layout, page.marginMm, page.strokeWidthMm);
  const paths = groups.reduce((s, g) => s + g.svgPaths.length, 0);
  return { svg, layers: layers.length, paths };
}
