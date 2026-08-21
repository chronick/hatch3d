/**
 * Browser-side counterpart to cli/load-image.ts — turns an uploaded image into
 * the row-major luminance grid a `luminance` patch node needs, so the #scene
 * view can render scenes using `op:image-luminance` (vault-k7ne).
 *
 * The grid must match the CLI's byte-for-byte: canvas `getImageData` and pngjs
 * both hand back top-left-origin, row-major RGBA at 4 bytes per pixel, so the
 * conversion is the same index walk and the same Rec.601 luma over 255 — no
 * flip, no rescale. A mismatch here renders wrong silently rather than throwing.
 */

import type { ImageResolver } from "../patch/graph.js";
import type { SceneDoc, SceneNode } from "./schema.js";

export interface LuminanceGrid {
  brightness: Float32Array;
  width: number;
  height: number;
}

/**
 * Convert row-major RGBA bytes (canvas ImageData.data layout) into a brightness
 * grid. Identical arithmetic to `loadBrightness` in cli/load-image.ts.
 */
export function luminanceGridFromRGBA(
  data: ArrayLike<number>,
  width: number,
  height: number,
): LuminanceGrid {
  const brightness = new Float32Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    brightness[i] = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  }
  return { brightness, width, height };
}

/** Decode an uploaded image file to a brightness grid via a 2D canvas. */
export async function decodeImageFile(file: Blob): Promise<LuminanceGrid> {
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d canvas context available for image decoding");
    ctx.drawImage(bitmap, 0, 0);
    const { data } = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
    return luminanceGridFromRGBA(data, bitmap.width, bitmap.height);
  } finally {
    bitmap.close();
  }
}

/**
 * Every image path an `op:image-luminance` node in `doc` refers to, unique and
 * in document order — the keys the view has to collect uploads under.
 */
export function sceneImageRefs(doc: SceneDoc): string[] {
  const refs: string[] = [];
  walk(doc.root, (node) => {
    if (node.type === "op:image-luminance" && !refs.includes(node.image)) refs.push(node.image);
  });
  return refs;
}

/**
 * An ImageResolver backed by already-decoded grids, keyed by the scene's image
 * reference. Missing keys throw a message naming the reference so the view can
 * ask for exactly that file.
 */
export function gridImageResolver(grids: Record<string, LuminanceGrid>): ImageResolver {
  return (path: string) => {
    const grid = grids[path];
    if (!grid) throw new Error(`scene: no image uploaded for "${path}".`);
    return grid;
  };
}

function walk(node: SceneNode, visit: (n: SceneNode) => void): void {
  visit(node);
  if ("children" in node && Array.isArray(node.children)) {
    for (const child of node.children) walk(child, visit);
  }
  if ("child" in node && node.child) walk(node.child, visit);
}
