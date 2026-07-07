/**
 * Round-trip converter between a LayeredCompositionDefinition and a scene
 * document. This is the migration path: every existing layered composition can
 * be turned into a scene doc (and back), so the scene IR subsumes the layered
 * format rather than replacing it wholesale.
 */

import type { LayeredCompositionDefinition, LayeredLayer } from "../compositions/types.js";
import type { SceneDoc, LayerNode, GeneratorNode } from "./schema.js";

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
    if (gen.params) layer.paramOverrides = gen.params;
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

function flattenLayerNodes(node: SceneDoc["root"]): LayerNode[] {
  if (node.type === "layer") return [node];
  if (node.type === "group") {
    return (node.children as SceneDoc["root"][]).flatMap(flattenLayerNodes);
  }
  return [];
}
