/**
 * SVG file output — ports buildSVGContent from App.tsx for headless use.
 */

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
