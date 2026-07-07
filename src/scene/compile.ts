/**
 * Scene IR compiler — scene document → a registrable LayeredComposition.
 *
 * v1 strategy: flatten the scene tree into a `LayeredCompositionDefinition` and
 * render it through the existing layered pipeline. Because it produces the exact
 * same structure a hand-written `LayeredCompositionDefinition` would, a scene doc
 * ported from a layered composition renders byte-identically — that equivalence
 * is the v1 acceptance gate, and reusing the proven definition shape is how we
 * guarantee it.
 *
 * The tree currently supported: a `group` (or bare `layer`) root containing
 * `layer` nodes, each holding exactly one `generator` leaf (any registered
 * composition by id + param/macro/hatch overrides). Operator nodes
 * (op:transform, op:clip, op:region-hatch, op:field-distort) parse but the
 * compiler rejects them with a pointer to the operator-extraction task
 * (vault-23w2). A `layer` with `blend: "masked"` maps to the layered pipeline's
 * convex-hull masking.
 */

import type { SceneDoc, LayerNode, GeneratorNode } from "./schema.js";
import { parseSceneDoc } from "./schema.js";
import type { LayeredLayer, LayeredCompositionDefinition } from "../compositions/types.js";
import { compositionRegistry } from "../compositions/registry.js";
import { isLayeredComposition } from "../compositions/types.js";

export interface CompiledScene {
  /** A registrable layered composition equivalent to the scene's layer stack. */
  composition: LayeredCompositionDefinition;
  page: {
    size: string;
    orientation: "landscape" | "portrait";
    marginMm: number;
    widthPx: number;
    heightPx: number;
    strokeWidthMm: number;
  };
  camera: { theta: number; phi: number; dist: number; ortho: boolean };
  seedRefs: string[];
}

const OPERATOR_TYPES = new Set([
  "op:transform",
  "op:clip",
  "op:mask",
  "op:region-hatch",
  "op:field-distort",
]);

/** Collect the `layer` nodes from a root (group of layers, or a bare layer). */
function collectLayers(node: SceneDoc["root"]): LayerNode[] {
  if (node.type === "layer") return [node];
  if (node.type === "group") {
    const out: LayerNode[] = [];
    for (const child of node.children as SceneDoc["root"][]) {
      if (child.type === "layer") out.push(child);
      else if (child.type === "group") out.push(...collectLayers(child));
      else {
        throw new Error(
          `Scene compile: group child of type "${child.type}" is not supported in v1; ` +
            `wrap generators in a "layer" node. (Operators: see vault-23w2.)`,
        );
      }
    }
    return out;
  }
  throw new Error(
    `Scene compile: root must be a "group" or "layer" in v1, got "${node.type}".`,
  );
}

/** Extract the single generator leaf from a layer's children, rejecting operators. */
function generatorOf(layer: LayerNode): GeneratorNode {
  const gens: GeneratorNode[] = [];
  for (const child of layer.children as SceneDoc["root"][]) {
    if (child.type === "generator") {
      gens.push(child as GeneratorNode);
    } else if (OPERATOR_TYPES.has(child.type)) {
      throw new Error(
        `Scene compile: operator node "${child.type}" (id "${(child as { id: string }).id}") ` +
          `is not implemented in v1. Operators land with vault-23w2 (operator extraction).`,
      );
    } else {
      throw new Error(
        `Scene compile: layer "${layer.id}" child of type "${child.type}" is not supported; ` +
          `v1 layers hold exactly one generator.`,
      );
    }
  }
  if (gens.length !== 1) {
    throw new Error(
      `Scene compile: layer "${layer.id}" must contain exactly one generator in v1 (found ${gens.length}).`,
    );
  }
  return gens[0];
}

/** Compile a scene document (validated or raw) into a CompiledScene. */
export function compileScene(input: unknown): CompiledScene {
  const doc = parseSceneDoc(input);

  const layerNodes = collectLayers(doc.root);
  if (layerNodes.length === 0) {
    throw new Error("Scene compile: document has no layer nodes.");
  }

  const layers: LayeredLayer[] = layerNodes.map((ln, idx) => {
    const gen = generatorOf(ln);

    const inner = compositionRegistry.get(gen.composition);
    if (!inner) {
      throw new Error(
        `Scene compile: generator "${gen.id}" references unknown composition "${gen.composition}". ` +
          `Use \`render --list\` to see registered ids.`,
      );
    }
    if (isLayeredComposition(inner)) {
      throw new Error(
        `Scene compile: generator "${gen.id}" references a layered composition ("${gen.composition}"); ` +
          `nest its layers directly instead (nested layered is not supported).`,
      );
    }

    let maskBy: number | undefined;
    if (ln.blend === "masked") {
      if (ln.maskBy) {
        maskBy = layerNodes.findIndex((l) => l.id === ln.maskBy);
        if (maskBy < 0) {
          throw new Error(
            `Scene compile: layer "${ln.id}" masks by unknown layer id "${ln.maskBy}".`,
          );
        }
      } else {
        maskBy = Math.max(0, idx - 1);
      }
    }

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
    if (maskBy !== undefined) layer.maskBy = maskBy;
    if (ln.pen?.color) layer.color = ln.pen.color;
    if (ln.pen?.name) layer.name = ln.pen.name;
    if (ln.visible !== undefined) layer.visible = ln.visible;
    return layer;
  });

  const composition: LayeredCompositionDefinition = {
    id: `scene:${doc.id}`,
    name: doc.id,
    description: `Compiled scene document "${doc.id}"`,
    category: "layered",
    type: "layered",
    tags: ["scene"],
    layers,
  };

  return {
    composition,
    page: {
      size: doc.page.size,
      orientation: doc.page.orientation,
      marginMm: doc.page.marginMm,
      widthPx: doc.page.widthPx ?? 800,
      heightPx: doc.page.heightPx ?? 800,
      strokeWidthMm: doc.page.strokeWidthMm ?? 0.5,
    },
    camera: {
      theta: doc.camera?.theta ?? 0.6,
      phi: doc.camera?.phi ?? 0.35,
      dist: doc.camera?.dist ?? 8,
      ortho: doc.camera?.ortho ?? false,
    },
    seedRefs: doc.seedRefs ?? [],
  };
}
