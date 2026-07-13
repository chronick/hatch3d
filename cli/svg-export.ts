/**
 * SVG file output — re-exports the shared builder now in src/scene/svg-output.ts.
 *
 * The implementation moved to src/ (vault-2v4c) so the browser Scene view and the
 * CLIs share one serializer (guaranteeing byte-identical output). This shim keeps
 * `cli/svg-export.js` imports working (cli/render.ts, cli/patch.ts, cli/stats.ts).
 */

export {
  PAGE_SIZES,
  computeExportLayout,
  buildSVGContent,
  buildLayeredSVGContent,
} from "../src/scene/svg-output.js";
export type { ExportLayout } from "../src/scene/svg-output.js";
