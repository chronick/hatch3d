# Scene IR — declarative plotter scene documents

A **scene document** is a strict, diffable JSON tree that an agent authors, the
compiler turns into polylines/SVG through the existing hatch3d pipeline, and the
`stats` CLI measures. It is the keystone of the AI-native workflow: the ~47
named compositions become vocabulary **words**; scene docs are the **sentences**
that compose them. (Design pod: `active/plotter-art-workflow` in the vault.)

## Why

Layered compositions (`type: "layered"`) already stack compositions with
per-pen colors — but they're TypeScript files a human writes. A scene document
is the same idea as **data**: an agent can author it, diff it, mutate it with
legible lineage, and a routine can ship it as a plain JSON file instead of code.

v1 deliberately maps onto the proven layered pipeline, so a scene doc ported
from a layered composition renders **byte-identically** (verified in tests and
the CLI). Richer operators (region-hatch, field-distort, transform, clip) are
declared in the schema but land with the operator-extraction task (vault-23w2).

## Running one

```bash
# Render a scene to SVG (carries its own page/margin/camera)
npm run render -- --scene examples/scenes/phyllotaxis-isoblocks.scene.json -o out.svg

# Render to PNG
npm run render -- --scene examples/scenes/guilloche-single.scene.json -o out.png -f png

# Measure the result (the deterministic half of the agent loop)
npm run render -- --scene examples/scenes/guilloche-single.scene.json -o out.svg
npm run stats  -- --input out.svg
```

The core is importable — `src/scene/{schema,compile,convert}.ts` — so the
browser UI consumes the same functions the CLI does. Measurement comes from the
`@endonny/inksight` package (`analyzeSvg`), shared with the InkSight tool.

## Document shape

```jsonc
{
  "version": 1,                 // literal 1
  "id": "my-piece",             // stable; lineage = a chain of doc diffs
  "page": {
    "size": "a3",               // a3 | a4 | a5 | letter   (default a3)
    "orientation": "landscape", // landscape | portrait    (default landscape)
    "marginMm": 15,             // default 15
    "widthPx": 800,             // canvas the generators evaluate in (default 800)
    "heightPx": 800,
    "strokeWidthMm": 0.5        // pen width baked into the SVG (default 0.5)
  },
  "camera": { "theta": 0.6, "phi": 0.35, "dist": 8, "ortho": false }, // 3D generators
  "seedRefs": ["plotterart/1sf8duc"],  // provenance → preference/corpus loop
  "root": { /* a group, or a bare layer */ }
}
```

### Node types

| `type` | Role | v1 |
| ------ | ---- | -- |
| `group` | Nesting; holds layers (and, later, a transform cascade) | ✅ |
| `layer` | Binds a pen (`color`/`name`/`width`); holds one generator | ✅ |
| `generator` | A registered composition by id + `params`/`macros`/`hatchGroups`/`seed` | ✅ |
| `op:transform` | Translate/rotate/scale a subtree | ✅ |
| `op:clip` | Clip a subtree to (or away from) a region — polygon, hull, or a derived `regionOf` | ✅ |
| `op:emphasis` | Weighted mask: thin a subtree to `weight` inside a region | ✅ |
| `op:mask` | Mask a subtree by another node's convex hull (shorthand for `op:clip` + `hullOf`) | ✅ |
| `op:region-hatch` | Hatch-fill a region at angle/pitch — polygon, hull, or derived `regionOf` (non-convex + holes, even-odd) | ✅ |
| `op:field-distort` | Displace a subtree by a noise/flow field | ✅ |
| `op:image-luminance` | Deflect a subtree's scanlines by an image's brightness (isolinePortrait) | ✅ |

A `layer` may set `blend: "masked"` with `maskBy: "<sibling layer id>"` — this
maps to the layered pipeline's convex-hull masking. Default blend is `over`
(additive stacking).

A layer's `pen` may set `width` (mm, positive) in addition to `color`/`name`.
It becomes a per-layer `stroke-width` on that pen's `<g>` in the exported SVG
(as a scale relative to `page.strokeWidthMm` — e.g. `width: 0.8` on a 0.5mm
page renders that group at 1.6× the global width). Layers without a `width`
inherit the global `page.strokeWidthMm`, and a doc with no pen widths renders
byte-identically to before the field existed.

The schema is **strict**: unknown keys are rejected, so a malformed doc fails
loudly at parse time rather than silently mis-rendering (`parseSceneDoc` throws a
path-prefixed error). Operator nodes lower to the patch engine's operators (see
"Compiler internals" below) — the `--scene` render path evaluates them exactly
like a hand-authored patch.

## Progressive composition

The strongest community work is built from small components arranged with
masking, where later layers respond to the space earlier layers already
occupy. Three things make that expressible: **derived regions**, **document
order as render order**, and **weighted masks**.

### Region references — `regionOf`

Anywhere a region is taken (`op:clip`, `op:emphasis`) it may be written three
ways:

```jsonc
{ "polygon": [[0, 0], [200, 0], [200, 200]] }        // explicit
{ "hullOf": "n1" }                                    // another node's hull
{ "regionOf": { "of": "n1", "kind": "bbox",           // a derived region
                "offsetPx": 12, "cornerRadius": 18 } }
```

`hullOf: X` is exactly `regionOf: { of: X, kind: "hull" }` — kept as the short
form, resolved by the same code.

| `kind` | The region | Exact? |
| ------ | ---------- | ------ |
| `bbox` | Axis-aligned bounds of the node's geometry | exact |
| `hull` | Convex hull | exact |
| `outline` | Offset silhouette — the node's strokes buffered by a radius, unioned | approximate (raster) |
| `occupied` | The same union at ≈ one stroke width: "where the ink actually is" | approximate (raster) |

| Field | Meaning | Default |
| ----- | ------- | ------- |
| `of` | Node id the region is derived from | (required) |
| `kind` | One of the four above | (required) |
| `offsetPx` | Grow (+) / shrink (−) the region, in canvas px | `0` |
| `cornerRadius` | Round the region polygon's corners | `0` |

`offsetPx` is exact polygon offsetting for `bbox`/`hull` (a negative offset
that would collapse the shape yields an empty region, and the clip fails open).
For `outline`/`occupied` it is folded into the raster stroke radius, so
`offsetPx: -4` on an `outline` cancels its base radius entirely and empties the
region.

`cornerRadius` applies to `bbox` and `hull`. On a `bbox` that is the
rounded-rectangle idiom. It is a **no-op** for `outline`/`occupied`: the
buffered union already rounds its own corners by construction, and layering a
second approximation on top of the first would only add error.

`outline`/`occupied` contour an exact distance-to-segment field on a
radius-adaptive grid (192–512 cells across, scaled to the stroke radius —
see `rasterGridSpec` in `src/operators/region-shapes.ts`), accurate to about
0.2 cell; sub-cell stroke radii are widened to one cell so thin strokes stay
connected. They correctly return several rings for
disjoint blobs and for holes — the even-odd rule composes them.

### Document order is render order

A node may reference the region of a node **defined before it**, never after —
no forward references, no cycles. This is checked at parse time
(`parsePatchDoc`) and at lowering time (`sceneToPatch`), and the error names
both nodes:

```text
Invalid patch document:
  • nodes.1.regionOf.of: node "around" references the region of "shape", but
    "shape" is declared later in the document — document order is evaluation
    order, so "around" may only reference nodes defined before it.
    Move "shape" above "around".
```

The rule is what makes *"layer 2 draws around layer 1"* well-defined: the
region names an area that is already settled. In a scene tree, "before" means
earlier in pre-order; a node may additionally reference something inside its
own subtree, which lowers before it regardless.

This complements occlusion rather than replacing it: `occult`-style z-occlusion
hides overlaps after the fact, while progressive regions let layers avoid or
seek each other by construction.

### `op:clip` — clip to, or away from, a region

```jsonc
{ "type": "op:clip", "id": "around",
  "mode": "outside",
  "region": { "regionOf": { "of": "focus", "kind": "bbox",
                            "offsetPx": 12, "cornerRadius": 18 } },
  "child": { "type": "generator", "id": "ground", "composition": "contourMap" } }
```

| Field | Meaning | Default |
| ----- | ------- | ------- |
| `region` | Any of the three region forms | (required) |
| `mode` | `inside` keeps what the region covers; `outside` keeps the rest | `inside` |
| `child` | Subtree to clip | (required) |

`mode: "inside"` with a plain `polygon`/`hullOf` still uses the v1 convex
half-plane clip (byte-identical to before). Anything with a `regionOf`, or any
`mode: "outside"`, goes through even-odd ring clipping — derived regions are not
convex in general, and "outside" has no convex form at all.

Full example: `examples/scenes/draw-around.scene.json`.

### `op:emphasis` — masking as a dial

```jsonc
{ "type": "op:emphasis", "id": "halo",
  "region": { "regionOf": { "of": "focus", "kind": "hull", "offsetPx": 70 } },
  "weight": 0.3, "mode": "inside",
  "child": { "type": "generator", "id": "ground", "composition": "contourMap" } }
```

| Field | Meaning | Default |
| ----- | ------- | ------- |
| `region` | Any of the three region forms | (required) |
| `weight` | Fraction of ink **kept** inside the masked zone, 0–1 | (required) |
| `mode` | Whether the masked zone is the region's `inside` or its `outside` | `inside` |
| `child` | Subtree to de-emphasise | (required) |

`weight: 1` is a no-op, `weight: 0` is a full clip of the zone, and anything
between de-emphasises: a focal component can suppress a background texture to
0.3 in its halo instead of punching a hard hole. The child is first split at the
region boundary so membership is exact per span, then in-zone spans are thinned
by `fieldThin` with a constant `weight` signal — a deterministic index hash, no
RNG, so the same document thins identically on every render.

Full example: `examples/scenes/emphasis-halo.scene.json`.

```bash
npm run render -- --scene examples/scenes/draw-around.scene.json   -o draw-around.svg
npm run render -- --scene examples/scenes/emphasis-halo.scene.json -o halo.svg
```


### `op:image-luminance` — the isolinePortrait motif

Deflects a child subtree's scanlines by an image's brightness — the corpus's
most-recurring motif (`corpus/art/motifs/isoline.md`): horizontal lines pushed by
a portrait's tone. Fields:

| Field | Meaning | Default |
| ----- | ------- | ------- |
| `image` | Path to the image; the CLI decodes a PNG, the browser passes an uploaded grid | (required) |
| `amplitude` | Peak displacement (canvas px) at full brightness | (required) |
| `dir` | Displacement axis | `[0, 1]` (down) |
| `resampleStep` | Subdivide the child to this max step so coarse scanlines can bend | `5` |
| `invert` | Invert brightness | `false` |
| `child` | Geometry to deflect — usually an `op:region-hatch` scanline fill | (required) |

It lowers to `luminance → directional → resample(child) → distort`, byte-identical
to the hand-authored `examples/patches/isoline-portrait.json`. Full example:
`examples/scenes/isoline-portrait.scene.json`.

## Example 1 — two-pen layered (byte-identical to `phyllotaxisIsoblocks`)

`examples/scenes/phyllotaxis-isoblocks.scene.json`:

```jsonc
{
  "version": 1,
  "id": "phyllotaxis-isoblocks",
  "page": { "size": "a3", "orientation": "landscape", "marginMm": 15 },
  "root": {
    "type": "group", "id": "root",
    "children": [
      { "type": "layer", "id": "ground", "pen": { "color": "#2563eb", "name": "ground" }, "blend": "over",
        "children": [ { "type": "generator", "id": "ground-gen", "composition": "isoWoodBlocks" } ] },
      { "type": "layer", "id": "accent", "pen": { "color": "#dc2626", "name": "accent" }, "blend": "over",
        "children": [ { "type": "generator", "id": "accent-gen", "composition": "phyllotaxisGarden" } ] }
    ]
  }
}
```

Renders byte-for-byte the same SVG as `render -c phyllotaxisIsoblocks`.

## Example 2 — single generator with overrides + provenance

`examples/scenes/guilloche-single.scene.json` — A4 portrait, a 0.3mm black pen,
one composition with explicit params, tagged with the seed that inspired it:

```jsonc
{
  "version": 1,
  "id": "guilloche-single",
  "page": { "size": "a4", "orientation": "portrait", "marginMm": 20, "strokeWidthMm": 0.3 },
  "seedRefs": ["plotterart/1sf8duc"],
  "root": {
    "type": "layer", "id": "rosette", "pen": { "color": "#111111", "name": "black" },
    "children": [
      { "type": "generator", "id": "rosette-gen", "composition": "guillocheRosette",
        "params": { "rings": 7, "layersPerRing": 8, "lobes": 32, "amplitude": 128,
                    "phaseStep": 0.13, "innerRadius": 70, "ringSpacing": 35 } }
    ]
  }
}
```

Measuring it (`stats`) reports `inkDensity ≈ 1.33` and 20 saturated grid cells —
i.e. this parameter set over-inks the page for a 0.3mm pen. That is exactly the
deterministic signal an agent loop uses to reject a candidate before spending a
vision critique on it.

## Compiler internals — unified with the patch engine

`render --scene` lowers the scene document to a **patch graph** (`sceneToPatch`,
`src/scene/to-patch.ts`) and evaluates it through the single patch engine
(`src/patch/graph.ts`) — the same path `cli/patch.ts` uses. This is the
convergence: one evaluator for both scene docs and patches (see
`active/plotter-art-workflow/design/patch-model.md`).

Byte-identical is preserved because the patch `generator` node applies the same
per-layer semantics as `runLayeredPipeline` (`resolveLayerInnerValues` + macros +
hatchGroups + camera). A layered scene lowers to generator + pen nodes and
renders the same SVG it always did (verified in tests + the examples).

Operator lowering (`sceneToPatch`):
- `op:field-distort` → a `simplexVector` field + a `distort` node
- `op:region-hatch` → a `regionHatch` node
- `op:transform` → a `transform` node
- `op:clip` / `op:mask` → a `clip` node (region / hull of the mask sibling)
- `op:emphasis` → an `emphasis` node
- `op:image-luminance` → a `luminance` field + `directional` + `resample`(child) + `distort`

The patch evaluator is a single in-order fold over `nodes`, writing each
signal into an environment keyed by id, so document order has always been
evaluation order and references could only ever resolve backwards. What
changed is that the contract is now *stated*: `parsePatchDoc` validates every
reference up front (`nodes.<i>.<field>` paths, both node ids named) instead of
letting a forward reference die mid-evaluation with a bare "unknown node".

`compileScene` (`src/scene/compile.ts`) remains as the alternate scene →
`LayeredCompositionDefinition` converter (no operators — the layered shape can't
hold them); `layeredToScene` / `sceneToLayers` (`src/scene/convert.ts`) provide
the round trip.

## Not yet (follow-ups)

- **Browser UI authoring** — the compiler is headless-first; wiring scene docs
  into `App.tsx`'s live editor is a separate UI task (vault-2v4c).
- **Multiple generators per layer** — a layer holds one child subtree; merging
  several generators into one pen would need a `merge` node.
- **`op:field-distort` `field: "flow"`** — currently always lowers to simplex;
  a flow-field source is a follow-up.
- **`op:mask` stays hull-only** — it is the shorthand; `op:clip` carries the
  full region vocabulary, and two ways to say the same thing would be worse for
  an agent-authored IR than one short form and one general one.
- **Exact Minkowski offsetting** — `outline`/`occupied` now use an exact
  distance field on a radius-adaptive grid (192–512 cells, ~0.2-cell worst
  error), which is accurate enough for plotting; a true Minkowski sum remains
  unbuilt if sub-cell exactness is ever needed.
