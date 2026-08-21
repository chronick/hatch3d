/**
 * Round-trip converter between a LayeredCompositionDefinition and a scene
 * document. This is the migration path: every existing layered composition can
 * be turned into a scene doc (and back), so the scene IR subsumes the layered
 * format rather than replacing it wholesale.
 */

import type { LayeredCompositionDefinition, LayeredLayer } from "../compositions/types.js";
import type { SceneDoc, LayerNode, GeneratorNode, SceneNode, Pen } from "./schema.js";

/**
 * Convert a layered composition into an equivalent scene document.
 * Each LayeredLayer becomes a `layer` node wrapping one `generator` leaf.
 */
export function layeredToScene(
  comp: LayeredCompositionDefinition,
  opts: { id?: string } = {},
): SceneDoc {
  const layerNodes: LayerNode[] = comp.layers.map((layer, i) => {
    const layerId = layer.__id ?? layer.name ?? `layer-${i}`;
    const gen: GeneratorNode = {
      type: "generator",
      id: `${layerId}-gen`,
      composition: layer.composition,
    };
    if (layer.paramOverrides) gen.params = layer.paramOverrides;
    if (layer.macroOverrides) gen.macros = layer.macroOverrides;
    if (layer.hatchGroupOverrides) gen.hatchGroups = layer.hatchGroupOverrides;

    const node: LayerNode = {
      type: "layer",
      id: layerId,
      children: [gen],
    };
    const pen: NonNullable<LayerNode["pen"]> = {};
    if (layer.color) pen.color = layer.color;
    if (layer.name) pen.name = layer.name;
    if (Object.keys(pen).length) node.pen = pen;
    if (layer.blendMode && layer.blendMode !== "over") node.blend = layer.blendMode;
    if (layer.blendMode === "masked" && layer.maskBy !== undefined) {
      const target = comp.layers[layer.maskBy];
      node.maskBy = target?.__id ?? target?.name ?? `layer-${layer.maskBy}`;
    }
    if (layer.visible !== undefined) node.visible = layer.visible;
    return node;
  });

  return {
    version: 1,
    id: opts.id ?? comp.id,
    page: { size: "a3", orientation: "landscape", marginMm: 15 },
    root: { type: "group", id: "root", children: layerNodes },
  };
}

/**
 * Convert a scene document's layer stack back into a flat LayeredLayer[].
 * Inverse of the layer-flattening the compiler performs — used to verify the
 * round trip and to feed the browser's layered UI.
 */
export function sceneToLayers(doc: SceneDoc): LayeredLayer[] {
  const layerNodes = flattenLayerNodes(doc.root);
  return layerNodes.map((ln, idx) => {
    const gen = ln.children.find((c) => c.type === "generator") as GeneratorNode | undefined;
    if (!gen) throw new Error(`sceneToLayers: layer "${ln.id}" has no generator child.`);
    const layer: LayeredLayer = {
      __id: ln.id,
      composition: gen.composition,
      blendMode: ln.blend ?? "over",
    };
    const params = gen.seed !== undefined ? { seed: gen.seed, ...gen.params } : gen.params;
    if (params) layer.paramOverrides = params;
    if (gen.macros) layer.macroOverrides = gen.macros;
    if (gen.hatchGroups) {
      layer.hatchGroupOverrides = gen.hatchGroups as LayeredLayer["hatchGroupOverrides"];
    }
    if (ln.pen?.color) layer.color = ln.pen.color;
    if (ln.pen?.name) layer.name = ln.pen.name;
    if (ln.visible !== undefined) layer.visible = ln.visible;
    if (ln.blend === "masked") {
      const idxOf = ln.maskBy ? layerNodes.findIndex((l) => l.id === ln.maskBy) : idx - 1;
      layer.maskBy = Math.max(0, idxOf);
    }
    return layer;
  });
}

/**
 * Write an edited layer stack (as produced by `sceneToLayers` and mutated by
 * the LayerPanel) back into `doc`, returning the updated document.
 *
 * The inverse direction the layered UI needs: `layeredToScene` builds a fresh
 * doc and so cannot carry a real scene's page, camera, seedRefs, operator
 * nodes, pen widths or nesting. This rewrites only the parts the layer view
 * represents and leaves everything else exactly where it was — a layer the
 * user didn't touch keeps its original node identity, so
 * `applyLayersToScene(doc, sceneToLayers(doc)) === doc`.
 *
 * Layer nodes are rewritten by slot in document (flatten) order, so a reorder
 * moves layer content through the existing tree shape rather than restructuring
 * it. Added layers land in the root group; removed ones vacate their slot.
 */
export function applyLayersToScene(doc: SceneDoc, layers: LayeredLayer[]): SceneDoc {
  const originals = flattenLayerNodes(doc.root);
  const originalLayers = sceneToLayers(doc);
  const slotById = new Map(originals.map((n, i) => [n.id, i]));

  const nextNodes = layers.map((layer, i) => {
    const slot = layer.__id !== undefined ? slotById.get(layer.__id) : undefined;
    const base = slot === undefined ? undefined : originals[slot];
    if (base && slot !== undefined && deepEqual(originalLayers[slot], layer)) return base;
    return rebuildLayerNode(base, layer, i, layers);
  });

  const root = rewriteRoot(doc.root, nextNodes);
  return root === doc.root ? doc : { ...doc, root };
}

/** A layer node carrying `layer`'s edits, keeping `base`'s unrepresented parts. */
function rebuildLayerNode(
  base: LayerNode | undefined,
  layer: LayeredLayer,
  idx: number,
  layers: LayeredLayer[],
): LayerNode {
  const id = base?.id ?? layer.__id ?? layer.name ?? `layer-${idx}`;
  const baseGen = base?.children.find((c) => c.type === "generator") as GeneratorNode | undefined;

  const gen: GeneratorNode = {
    type: "generator",
    id: baseGen?.id ?? `${id}-gen`,
    composition: layer.composition,
  };
  // sceneToLayers folds `gen.seed` into paramOverrides.seed; pull it back out
  // only when the source node carried a separate seed field.
  let params = layer.paramOverrides;
  if (baseGen?.seed !== undefined && params && "seed" in params) {
    const { seed, ...rest } = params;
    gen.seed = seed as string | number;
    params = baseGen.params !== undefined || Object.keys(rest).length ? rest : undefined;
  }
  if (params) gen.params = params;
  if (layer.macroOverrides) gen.macros = layer.macroOverrides;
  if (layer.hatchGroupOverrides) gen.hatchGroups = layer.hatchGroupOverrides;
  const nextGen = baseGen ? withKeyOrderOf(baseGen, gen) : gen;

  // Operator children (op:clip, op:image-luminance, …) have no layer-view
  // representation; they ride along in place.
  const children: SceneNode[] = base
    ? base.children.map((c) => (c === baseGen ? nextGen : c))
    : [nextGen];

  const node: LayerNode = { type: "layer", id, children };

  const pen: Pen = { ...base?.pen };
  if (layer.color) pen.color = layer.color;
  else delete pen.color;
  if (layer.name) pen.name = layer.name;
  else delete pen.name;
  if (Object.keys(pen).length) node.pen = pen;

  // Keep an explicitly-written `blend: "over"` explicit — sceneToLayers
  // defaults the field, so dropping it would edit a doc nobody touched.
  if (base?.blend !== undefined) node.blend = layer.blendMode ?? "over";
  else if (layer.blendMode && layer.blendMode !== "over") node.blend = layer.blendMode;

  if (node.blend === "masked" && layer.maskBy !== undefined) {
    const targetId = layers[layer.maskBy]?.__id;
    if (targetId !== undefined) node.maskBy = targetId;
    else if (base?.maskBy !== undefined) node.maskBy = base.maskBy;
  }
  // Same rule as `blend`: only `visible: false` changes rendering, so an
  // implicit default stays implicit rather than being written into the doc.
  if (base?.visible !== undefined) node.visible = layer.visible ?? true;
  else if (layer.visible === false) node.visible = false;
  // Keep the source doc's field order so an edit shows up as a one-line diff
  // in the JSON the user is reading, not a reshuffle of the whole node.
  return base ? withKeyOrderOf(base, node) : node;
}

/** `next`'s entries, ordered as in `base`; keys base lacks keep their order at the end. */
function withKeyOrderOf<T extends object>(base: T, next: T): T {
  const out: Record<string, unknown> = {};
  const source = next as Record<string, unknown>;
  for (const k of Object.keys(base)) if (k in source) out[k] = source[k];
  for (const k of Object.keys(source)) if (!(k in out)) out[k] = source[k];
  return out as T;
}

/** Fill the tree's layer slots from `next`, appending leftovers to the root. */
function rewriteRoot(root: SceneNode, next: LayerNode[]): SceneNode {
  const cursor = { i: 0 };
  const rewritten = rewriteLayerSlots(root, next, cursor);
  const extra = next.slice(cursor.i);
  if (!rewritten) {
    return extra.length === 1 ? extra[0] : { type: "group", id: root.id, children: extra };
  }
  if (!extra.length) return rewritten;
  if (rewritten.type === "group") {
    return { ...rewritten, children: [...rewritten.children, ...extra] };
  }
  return { type: "group", id: `${root.id}-group`, children: [rewritten, ...extra] };
}

/**
 * Replace each layer node encountered (in flatten order) with the next entry
 * from `next`, dropping slots past its end. Returns the node unchanged — same
 * object — when nothing below it moved.
 */
function rewriteLayerSlots(
  node: SceneNode,
  next: LayerNode[],
  cursor: { i: number },
): SceneNode | null {
  if (node.type === "layer") {
    if (cursor.i >= next.length) return null;
    return next[cursor.i++];
  }
  if (node.type !== "group") return node;
  const children: SceneNode[] = [];
  let changed = false;
  for (const child of node.children) {
    const rewritten = rewriteLayerSlots(child, next, cursor);
    if (rewritten !== child) changed = true;
    if (rewritten) children.push(rewritten);
  }
  if (!changed) return node;
  return { ...node, children };
}

function flattenLayerNodes(node: SceneDoc["root"]): LayerNode[] {
  if (node.type === "layer") return [node];
  if (node.type === "group") {
    return (node.children as SceneDoc["root"][]).flatMap(flattenLayerNodes);
  }
  return [];
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a as object);
  const kb = Object.keys(b as object);
  if (ka.length !== kb.length) return false;
  return ka.every(
    (k) =>
      Object.prototype.hasOwnProperty.call(b, k) &&
      deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
  );
}
