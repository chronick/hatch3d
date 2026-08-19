/**
 * CLI-only image loader — decodes a PNG into a row-major luminance grid for the
 * patch `luminance` field. Kept OUT of src/patch (which Vite bundles for the
 * browser): pngjs is Node-oriented, so the decoder lives here and is injected
 * into evalPatch as an ImageResolver. The browser would supply its own resolver
 * from an uploaded image's canvas data.
 */

import { readFileSync } from "node:fs";
import { PNG } from "pngjs";
import type { ImageResolver } from "../src/patch/graph.js";

/** Decode a PNG at `path` into { brightness[0..1], width, height } (Rec.601 luma). */
export function loadBrightness(path: string): { brightness: Float32Array; width: number; height: number } {
  const png = PNG.sync.read(readFileSync(path));
  const { width, height, data } = png; // data is RGBA, 4 bytes/px
  const brightness = new Float32Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    brightness[i] = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  }
  return { brightness, width, height };
}

/** An ImageResolver that decodes PNG paths (resolved against cwd). */
export const pngImageResolver: ImageResolver = (path: string) => loadBrightness(path);
