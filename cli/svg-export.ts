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

/**
 * Build SVG output with one <g> group per layered-composition layer,
 * using each layer's stroke color and (optionally) its name as the group id.
 *
 * The default `stroke="black"` on the outer transform group is the fallback
 * for layers that don't specify a color.
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
      const idAttr = g.name ? ` id="${escapeAttr(g.name)}"` : ` id="layer-${i}"`;
      const stroke = g.color ? ` stroke="${escapeAttr(g.color)}"` : "";
      const paths = g.svgPaths.map((d) => `<path d="${d}"/>`).join("\n        ");
      return `      <g${idAttr}${stroke}>
        ${paths}
      </g>`;
    })
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${pageW}mm" height="${pageH}mm" viewBox="0 0 ${pageW} ${pageH}">
  <defs>
    <clipPath id="margin-clip">
      <rect x="${margin + clipInset}" y="${margin + clipInset}" width="${contentW - clipInset * 2}" height="${contentH - clipInset * 2}"/>
    </clipPath>
  </defs>
  <g clip-path="url(#margin-clip)">
    <g transform="translate(${cx},${cy}) scale(${scale})" fill="none" stroke="black" stroke-width="${strokeWidth / scale}" stroke-linecap="round" stroke-linejoin="round">
${layerSvg}
    </g>
  </g>
</svg>`;
}
