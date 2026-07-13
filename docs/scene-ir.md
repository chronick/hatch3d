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

The core is importable — `src/scene/{schema,compile,convert}.ts` and
`src/stats/analyze.ts` — so the browser UI and the InkSight tool consume the
same functions the CLI does.

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
| `op:transform` | Translate/rotate/scale a subtree | declared, deferred → vault-23w2 |
| `op:clip` | Clip a subtree to a polygon / another node's hull | declared, deferred |
| `op:mask` | Mask a subtree by another node's convex hull | declared, deferred |
| `op:region-hatch` | Hatch-fill a region at angle/pitch | declared, deferred |
| `op:field-distort` | Displace a subtree by a noise/flow field | declared, deferred |

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
path-prefixed error). Operator nodes parse but the compiler rejects them with a
pointer to vault-23w2, so the format is forward-compatible without pretending
the operators exist yet.

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
- `op:clip` / `op:mask` → a `clip` node (hull of the region / mask sibling)

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
- **Non-convex clip** — `clip` uses the convex hull of the region; true concave
  clipping is a follow-up.
