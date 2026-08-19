/**
 * Scene IR → patch graph lowering — the unification path.
 *
 * A Scene IR document (group/layer/generator tree) lowers to a patch graph
 * (flat named nodes), so both formats evaluate through the single patch engine
 * (src/patch/graph.ts). Because the patch generator node now matches the
 * layered per-layer semantics (resolveLayerInnerValues + macros + hatchGroups +
 * camera), a layered scene lowers to a patch that renders byte-identically to
 * the old compileScene→runLayeredPipeline path — verified in tests.
 *
 * Operator nodes (op:transform / op:clip / op:mask / op:region-hatch /
 * op:field-distort) lower to their patch-operator equivalents; see lowerNode.
 */

import type { SceneDoc, SceneNode, LayerNode, GeneratorNode, RegionRef } from "./schema.js";
import type { PatchDoc, PatchNode } from "../patch/graph.js";
import type { RegionOfSpec } from "../operators/region-shapes.js";

/** The region arguments a patch clip / emphasis node carries. */
type PatchRegionArgs =
  | { polygon: [number, number][] }
  | { hullOf: string }
  | { regionOf: RegionOfSpec };

export function sceneToPatch(doc: SceneDoc): PatchDoc {
  const nodes: PatchNode[] = [];
  const out: string[] = [];
  let gensym = 0;
  const uid = (base: string) => `${base}__${gensym++}`;

  /** Lower a geometry-producing subtree; return the id of its output node. */
  function lowerNode(node: SceneNode): string {
    switch (node.type) {
      case "generator": {
        const g = node as GeneratorNode;
        const params = g.seed !== undefined ? { seed: g.seed, ...g.params } : g.params;
        const patchNode: PatchNode = {
          op: "generator",
          id: g.id,
          composition: g.composition,
          ...(params ? { params } : {}),
          ...(g.macros ? { macros: g.macros } : {}),
          ...(g.hatchGroups ? { hatchGroups: g.hatchGroups as Record<string, unknown> } : {}),
        };
        nodes.push(patchNode);
        return g.id;
      }
      case "op:field-distort": {
        // Lower to a field source (simplex vector) + a distort operator.
        const childId = lowerNode(node.child);
        const fieldId = uid(`${node.id}_field`);
        // A deterministic seed from the node id keeps the field reproducible.
        const seed = hashSeed(node.id);
        nodes.push({ op: "simplexVector", id: fieldId, scale: node.scale, seed });
        nodes.push({ op: "distort", id: node.id, from: childId, by: fieldId, amp: node.amplitude });
        return node.id;
      }
      case "op:region-hatch": {
        const region = node.region;
        if ("hullOf" in region) {
          const srcId = lowerRegionSource(region.hullOf, node.id);
          nodes.push({ op: "regionHatch", id: node.id, from: srcId, ...hatchArgs(node.hatch) });
        } else {
          nodes.push({ op: "regionHatch", id: node.id, polygon: region.polygon, ...hatchArgs(node.hatch) });
        }
        return node.id;
      }
      case "op:image-luminance": {
        // Deflect the child's scanlines by an image's brightness: luminance
        // field → directional displacement → resample the child (so coarse
        // scanlines have vertices to bend) → distort. Mirrors the hand-authored
        // isoline-portrait patch (examples/patches/isoline-portrait.json).
        const childId = lowerNode(node.child);
        const lumId = uid(`${node.id}_lum`);
        const dirId = uid(`${node.id}_dir`);
        const resId = uid(`${node.id}_res`);
        nodes.push({ op: "luminance", id: lumId, image: node.image, invert: node.invert ?? false });
        nodes.push({ op: "directional", id: dirId, from: lumId, dir: node.dir ?? [0, 1] });
        nodes.push({ op: "resample", id: resId, from: childId, step: node.resampleStep ?? 5 });
        nodes.push({ op: "distort", id: node.id, from: resId, by: dirId, amp: node.amplitude });
        return node.id;
      }
      case "op:transform": {
        const childId = lowerNode(node.child);
        nodes.push({
          op: "transform", id: node.id, from: childId,
          ...(node.translate ? { translate: node.translate } : {}),
          ...(node.rotateDeg !== undefined ? { rotateDeg: node.rotateDeg } : {}),
          ...(node.scale !== undefined ? { scale: node.scale } : {}),
        });
        return node.id;
      }
      case "op:clip": {
        const childId = lowerNode(node.child);
        nodes.push({
          op: "clip", id: node.id, from: childId,
          ...lowerRegion(node.region, node.id),
          ...(node.mode ? { mode: node.mode } : {}),
        });
        return node.id;
      }
      case "op:emphasis": {
        const childId = lowerNode(node.child);
        nodes.push({
          op: "emphasis", id: node.id, from: childId,
          ...lowerRegion(node.region, node.id),
          weight: node.weight,
          ...(node.mode ? { mode: node.mode } : {}),
        });
        return node.id;
      }
      case "op:mask": {
        const childId = lowerNode(node.child);
        const srcId = lowerRegionSource(node.maskBy, node.id);
        nodes.push({ op: "clip", id: node.id, from: childId, hullOf: srcId });
        return node.id;
      }
      default:
        throw new Error(`sceneToPatch: node type "${(node as { type: string }).type}" cannot produce geometry here.`);
    }
  }

  // A node referenced by id (for hullOf / regionOf / maskBy) must resolve to
  // another node in the tree. We look it up and lower it; the patch engine
  // dedupes by id so lowering the same generator twice is harmless (same id,
  // overwritten).
  const byId = new Map<string, SceneNode>();
  const order = new Map<string, number>();
  const parent = new Map<string, string>();
  indexNodes(doc.root, byId, order, parent);

  /** True when `ancestorId` is on `id`'s parent chain (its own subtree). */
  function isDescendantOf(id: string, ancestorId: string): boolean {
    let cur = parent.get(id);
    while (cur !== undefined) {
      if (cur === ancestorId) return true;
      cur = parent.get(cur);
    }
    return false;
  }

  /**
   * Resolve and lower a region reference's source, enforcing progressive
   * evaluation order: the referenced node must already be settled, which means
   * it appears earlier in document order — or it sits inside the referrer's own
   * subtree, which lowers before the referrer regardless.
   *
   * This is the rule that makes "layer 2 draws around layer 1" well-defined
   * (design doc § Progressive composition semantics). Cross-branch forward
   * references are rejected here rather than silently lowering into a graph
   * whose meaning depends on traversal order.
   */
  function lowerRegionSource(id: string, referrerId: string): string {
    const n = byId.get(id);
    if (!n) throw new Error(`sceneToPatch: node "${referrerId}" references unknown node id "${id}".`);
    if (id === referrerId) {
      throw new Error(`sceneToPatch: node "${referrerId}" references its own region — references must be acyclic.`);
    }
    const here = order.get(referrerId) ?? -1;
    const there = order.get(id) ?? -1;
    if (there > here && !isDescendantOf(id, referrerId)) {
      throw new Error(
        `sceneToPatch: node "${referrerId}" references the region of "${id}", which appears later in the document — ` +
        `document order is render order, so "${referrerId}" may only reference regions of nodes defined before it. ` +
        `Move "${id}" above "${referrerId}".`,
      );
    }
    return lowerNode(n);
  }

  /** Lower a scene region reference into the patch node's region arguments. */
  function lowerRegion(region: RegionRef, referrerId: string): PatchRegionArgs {
    if ("polygon" in region) return { polygon: region.polygon };
    if ("hullOf" in region) return { hullOf: lowerRegionSource(region.hullOf, referrerId) };
    return { regionOf: { ...region.regionOf, of: lowerRegionSource(region.regionOf.of, referrerId) } };
  }

  /** Walk layers, emitting a pen node per visible layer. */
  function lowerLayers(node: SceneNode): void {
    if (node.type === "group") {
      for (const c of node.children) lowerLayers(c);
      return;
    }
    if (node.type === "layer") {
      const L = node as LayerNode;
      if (L.visible === false) return;
      if (L.children.length !== 1) {
        throw new Error(`sceneToPatch: layer "${L.id}" must hold exactly one child in v1 (found ${L.children.length}).`);
      }
      let childId = lowerNode(L.children[0]);
      // A "masked" layer clips its geometry to the hull of the maskBy sibling.
      if (L.blend === "masked" && L.maskBy) {
        const srcId = lowerRegionSource(L.maskBy, L.id);
        const clipId = uid(`${L.id}_mask`);
        nodes.push({ op: "clip", id: clipId, from: childId, hullOf: srcId });
        childId = clipId;
      }
      const penId = uid(`${L.id}_pen`);
      nodes.push({
        op: "pen", id: penId, from: childId,
        ...(L.pen?.color ? { color: L.pen.color } : {}),
        ...(L.pen?.name ? { name: L.pen.name } : {}),
        ...(L.pen?.width !== undefined ? { width: L.pen.width } : {}),
      });
      out.push(penId);
      return;
    }
    throw new Error(`sceneToPatch: root/group children must be layers, got "${node.type}".`);
  }

  lowerLayers(doc.root);
  if (out.length === 0) throw new Error("sceneToPatch: document produced no layers.");

  return {
    version: 1,
    id: doc.id,
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
    nodes,
    out,
  };
}

/**
 * Pre-order walk building three indexes: id → node, id → document position
 * (pre-order is document order), and id → parent id. The last two exist for
 * the progressive-order check in `lowerRegionSource`.
 */
function indexNodes(
  node: SceneNode,
  map: Map<string, SceneNode>,
  order: Map<string, number>,
  parent: Map<string, string>,
  counter: { n: number } = { n: 0 },
): void {
  map.set(node.id, node);
  order.set(node.id, counter.n++);
  const visit = (child: SceneNode) => {
    parent.set(child.id, node.id);
    indexNodes(child, map, order, parent, counter);
  };
  if ("children" in node && Array.isArray(node.children)) {
    for (const c of node.children) visit(c);
  }
  if ("child" in node && node.child) visit(node.child as SceneNode);
}

function hatchArgs(hatch: Record<string, unknown>): { angleDeg: number; pitch: number } {
  const angleDeg = Number(hatch.angleDeg ?? hatch.angle ?? 0);
  const pitch = Number(hatch.pitch ?? hatch.pitchMm ?? hatch.spacing);
  if (!Number.isFinite(pitch) || pitch <= 0) {
    throw new Error(`sceneToPatch: op:region-hatch needs a positive pitch (got ${hatch.pitch ?? hatch.pitchMm})`);
  }
  return { angleDeg, pitch };
}

/** Small deterministic string→int hash for field seeds. */
function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
