/**
 * SVG output — the single source of truth for hatch3d's SVG serialization,
 * shared by the headless CLIs and the in-browser Scene view.
 *
 * Originally ported from App.tsx's buildSVGContent for headless use in
 * cli/svg-export.ts; relocated to src/ (2026-07, vault-2v4c) so the browser
 * Scene view can import the *same* builder the CLI uses — that shared function
 * is what makes an in-browser scene render byte-identical to `render --scene`.
 * Pure (no Node APIs); cli/svg-export.ts re-exports it for back-compat.
 */

import type { LayerGroupResult } from "../workers/render-worker.types.js";

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

/** Inkscape namespace URI emitted on layered SVG roots (vpype/AxiDraw layer convention). */
export const INKSCAPE_NS = "http://www.inkscape.org/namespaces/inkscape";

/**
 * Build SVG output with one TOP-LEVEL <g> group per layered-composition layer.
 *
 * Each layer group carries the Inkscape layer convention —
 * `inkscape:groupmode="layer"` and `inkscape:label="<n>-<name>"` — because
 * vpype's `read_multilayer_svg` treats each *top-level* group as a layer
 * (nested groups collapse into one). Per-layer clip + transform wrappers
 * preserve the exact clip/scale semantics of the single-group form, so the
 * <path> elements are byte-identical to the previous output.
 *
 * `data-passes` (plot-time ink build-up) is emitted only when a layer sets
 * `passes`; the artifact still holds one copy of each path.
 *
 * The default `stroke="black"` on each transform group is the fallback for
 * layers that don't specify a color.
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
      const label = `${i + 1}-${g.name ?? g.color ?? `pen${i + 1}`}`;
      const idAttr = g.name ? ` id="${escapeAttr(g.name)}"` : ` id="layer-${i}"`;
      const passesAttr = g.passes !== undefined ? ` data-passes="${g.passes}"` : "";
      const stroke = g.color ? ` stroke="${escapeAttr(g.color)}"` : ` stroke="black"`;
      // Paths are in viewport px inside the scale() transform, so per-group
      // width compensates by /scale like the parent <g> does; dash values
      // are viewport px and scale naturally with the transform.
      const widthAttr = ` stroke-width="${(
        (strokeWidth * (g.widthScale ?? 1)) /
        scale
      ).toFixed(4)}"`;
      const dashAttr = g.dash ? ` stroke-dasharray="${g.dash.join(" ")}"` : "";
      const opacityAttr = g.opacity !== undefined ? ` opacity="${g.opacity}"` : "";
      const paths = g.svgPaths.map((d) => `<path d="${d}"/>`).join("\n        ");
      return `  <g inkscape:groupmode="layer" inkscape:label="${escapeAttr(label)}"${idAttr}${passesAttr}>
    <g clip-path="url(#margin-clip)">
      <g transform="translate(${cx},${cy}) scale(${scale})" fill="none"${stroke}${widthAttr}${dashAttr}${opacityAttr} stroke-linecap="round" stroke-linejoin="round">
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
