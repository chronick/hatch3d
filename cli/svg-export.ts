/**
 * SVG file output — ports buildSVGContent from App.tsx for headless use.
 */

import type { LayerGroupResult } from "../src/workers/render-worker.types.js";

export const PAGE_SIZES: Record<string, { w: number; h: number }> = {
  a3: { w: 420, h: 297 },
  a4: { w: 297, h: 210 },
  a5: { w: 210, h: 148 },
  letter: { w: 279.4, h: 215.9 },
};

export interface ExportLayout {
  pageW: number;
  pageH: number;
  contentW: number;
  contentH: number;
  scale: number;
  cx: number;
  cy: number;
}

export function computeExportLayout(
  pageSize: string,
  orientation: "landscape" | "portrait",
  margin: number,
  width: number,
  height: number,
): ExportLayout {
  const page = PAGE_SIZES[pageSize] ?? PAGE_SIZES.a3;
  const pageW = orientation === "portrait" ? page.h : page.w;
  const pageH = orientation === "portrait" ? page.w : page.h;
  const contentW = pageW - margin * 2;
  const contentH = pageH - margin * 2;
  const scale = Math.min(contentW / width, contentH / height);
  const cx = margin + (contentW - width * scale) / 2;
  const cy = margin + (contentH - height * scale) / 2;
  return { pageW, pageH, contentW, contentH, scale, cx, cy };
}

/** Escape a string for safe inclusion as an SVG attribute value. */
function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
}

export function buildSVGContent(
  svgPaths: string[],
  layout: ExportLayout,
  margin: number,
  strokeWidth: number,
): string {
  const { pageW, pageH, contentW, contentH, scale, cx, cy } = layout;
  const clipInset = 0;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${pageW}mm" height="${pageH}mm" viewBox="0 0 ${pageW} ${pageH}">
  <defs>
    <clipPath id="margin-clip">
      <rect x="${margin + clipInset}" y="${margin + clipInset}" width="${contentW - clipInset * 2}" height="${contentH - clipInset * 2}"/>
    </clipPath>
  </defs>
  <g clip-path="url(#margin-clip)">
    <g transform="translate(${cx},${cy}) scale(${scale})" fill="none" stroke="black" stroke-width="${strokeWidth / scale}" stroke-linecap="round" stroke-linejoin="round">
      ${svgPaths.map((d) => `<path d="${d}"/>`).join("\n      ")}
    </g>
  </g>
</svg>`;
}

export const INKSCAPE_NS = "http://www.inkscape.org/namespaces/inkscape";

/**
 * Build SVG output with one top-level <g> per layered-composition layer,
 * using the plotter-portable Inkscape layer convention:
 *
 *   <g inkscape:groupmode="layer" inkscape:label="1-ground" id="ground">
 *
 * The label always starts with the 1-based layer number — vpype's
 * `read --multilayer` and the AxiDraw layers mode both key off that leading
 * number, and both treat *top-level* groups as layers (hence the per-layer
 * clip + transform wrappers rather than one shared outer pair).
 *
 * The label body falls back to the pen color, then to `penN`. Layers that
 * don't specify a color keep the previous `stroke="black"` default.
 *
 * `passes` is emitted as `data-passes="N"` metadata only — paths are never
 * duplicated here. Pass expansion (re-plotting a layer for ink build-up)
 * happens at plot time, not in the artifact.
 */
export function buildLayeredSVGContent(
  layerGroups: LayerGroupResult[],
  layout: ExportLayout,
  margin: number,
  strokeWidth: number,
): string {
  const { pageW, pageH, contentW, contentH, scale, cx, cy } = layout;
  const clipInset = 0;
  const layerSvg = layerGroups
    .map((g, i) => {
      const num = i + 1;
      const label = g.name ?? g.color ?? `pen${num}`;
      const idAttr = g.name ? ` id="${escapeAttr(g.name)}"` : ` id="layer-${i}"`;
      const stroke = g.color ? escapeAttr(g.color) : "black";
      const passesAttr =
        typeof g.passes === "number" && Number.isFinite(g.passes)
          ? ` data-passes="${Math.max(1, Math.round(g.passes))}"`
          : "";
      const paths = g.svgPaths.map((d) => `<path d="${d}"/>`).join("\n        ");
      return `  <g inkscape:groupmode="layer" inkscape:label="${escapeAttr(`${num}-${label}`)}"${idAttr}${passesAttr}>
    <g clip-path="url(#margin-clip)">
      <g transform="translate(${cx},${cy}) scale(${scale})" fill="none" stroke="${stroke}" stroke-width="${strokeWidth / scale}" stroke-linecap="round" stroke-linejoin="round">
        ${paths}
      </g>
    </g>
  </g>`;
    })
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="${INKSCAPE_NS}" width="${pageW}mm" height="${pageH}mm" viewBox="0 0 ${pageW} ${pageH}">
  <defs>
    <clipPath id="margin-clip">
      <rect x="${margin + clipInset}" y="${margin + clipInset}" width="${contentW - clipInset * 2}" height="${contentH - clipInset * 2}"/>
    </clipPath>
  </defs>
${layerSvg}
</svg>`;
}
