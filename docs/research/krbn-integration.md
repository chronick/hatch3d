# Krbn → hatch3d: integration notes

Source: [vpalos/Krbn](https://github.com/vpalos/Krbn) — a strokes-first NPR
engine that renders 3D scenes as hand-drawn pencil-style SVG. Its pipeline
(extract → visibility → abstraction → style → emit) derives, classifies, and
styles *strokes* rather than shading pixels. hatch3d lives entirely in Krbn's
"mesh regime" (sampled polylines, numerical visibility), so its styling and
coherence ideas transfer directly even though its exact-conic silhouette
machinery does not.

## Adopted (this integration)

### 1. Determinism via identity-keyed randomness

Krbn's core discipline: every random decision is keyed on a **stable identity**
(element id, line key), never on emission order or `Math.random()`, so the same
scene always emits the same, diffable SVG.

- `src/utils/prng.ts` — canonical `mulberry32` (shared with the patch engine)
  plus `hash01(seed, id)` for stateless per-item decisions.
- `HatchParams.seed` — noise displacement, dash randomness, and density-fn
  filtering are now seeded; density keep-decisions are hashed per line index so
  one line's fate never depends on another's.
- `filterByProjectedDensity` takes a `seed`; the pipeline threads
  `RenderRequest.seed` (UI: DISPLAY → Seed) into every layer.
- The Rust/WASM path was already fixed-seed (`OpenSimplex::new(0)`, LCG); the
  TS path now matches that philosophy. Layers with a non-default seed that
  feeds stochastic post-processing fall back to TS (`isLayerWasmCompatible`).

The noise field samples object-space positions, so wobble stays anchored to
the surface as parameters change — Krbn's anti-"boiling" property.

### 2. Depth-emphasis stroke width (width bands)

Krbn bolds strokes nearer than the focal plane and thins farther ones:
`clamp((refDepth/depth)^0.55, 0.55, 1.6)`, ref = camera target. A plotter
can't vary width along a stroke, so we use Krbn's own proposed fallback
(IDEAS.md "stroke bands"): quantize per-polyline width into 3 levels and emit
each band as its own `<g>` pen layer (`width-near` / `width-mid` /
`width-far`, `LayerGroupResult.widthScale`) — swap pens per band on a plotter.

`render-pipeline.ts`: `depthWidthBand()` / `depthBandScale()`; request flag
`depthWidthEnabled` (UI: DISPLAY → Depth width, 3D only). Bands survive
occlusion splits (segments inherit the parent line's band) and density
filtering (index-aligned via `filterByProjectedDensityIndices`).

### 3. Ghosted hidden lines

Krbn never z-culls: strokes split into visible/hidden intervals, and hidden
runs are drawn faint and dashed ("ghost") or dropped. That's the honest
plotter analog of transparency (you can't composite alpha with a pen, but you
can draw a faint dashed line).

- `occlusion.ts` — `splitPolylineByDepth()` returns `{visible, hidden}`;
  `clipPolylineByDepth()` is now a thin back-compat wrapper.
- Request flag `hiddenMode: "drop" | "ghost"` (UI: DISPLAY → Ghost hidden,
  shown when occlusion is on). Ghost runs emit as a `hidden` layer group with
  Krbn's defaults: width ×0.9, opacity 0.32, dash 4/3.

### 4. Tonal cross-hatch layering (light-clipped angle sets)

Krbn's tonal model: **form is direction, shading is density.** Instead of one
density per region, draw n angle sets, each clipped to the part of the surface
dark enough for it — layer i of n covers where `N·L < 0.95·(n−i)/n`. Tone
emerges from how many layers overlap.

- `HatchParams.clipFn(u, v)` — point-level UV clipping in
  `generateUVHatchLines` (the `LineCollector` splits polylines at clip
  boundaries). WASM-incompatible layers fall back to TS.
- `helpers-lighting.ts` — `surfaceNormalUV()` + `tonalHatchLayers()` (this
  finally puts the previously-dormant lighting helpers to work).
- `src/compositions/3d/studies/tonal-shading.ts` — "Tonal Shading" study with
  light azimuth/elevation, 1–4 tone layers, base angle.

## Deferred (worth stealing later)

- **Silhouette extraction as an interpolated zero-set** (Hertzmann–Zorin):
  per-vertex `g = n·toEye`, contour = zero set interpolated *through* faces —
  moves continuously with the camera, unlike per-edge sign tests. Krbn's
  `zeroSetChains` is generic over any per-vertex scalar. hatch3d's parametric
  surfaces give normals in closed form, so this is cheaper here than in Krbn.
- **Suggestive contours** (DeCarlo): zero-set of radial curvature where it
  increases away from the eye. Again cheaper for us — curvature is analytic.
- **Abstraction filtering with stateless fades**: drop strokes whose screen
  extent < `base·(1−importance)`; fade in `[cutoff, 1.6·cutoff)` derived
  purely from the continuous quantity (no cross-frame state, no popping).
- **Dyadic density ladder**: hatch iso-values on a fixed dyadic grid so a
  density change adds/removes complete levels instead of moving every line.
  Krbn's recorded failed experiment: fractional/per-line LOD fades read as
  banding — sparse hatch lines must arrive in complete levels.
- **Cross-layer consolidation**: merge near-collinear overlapping strokes
  from different layers so coincident edges draw once (pen-plotter friendly).
- **Variable width along a stroke** (taper + pressure fbm sharing the wobble
  seed) for raster/preview output; plotter output correctly ignores width.
- **Per-pen stroke width in the scene schema** — `PenSchema` currently defers
  this; `LayerGroupResult.widthScale` is the natural carrier now that it
  exists.

## Krbn file pointers (for the deferred items)

| Idea | Krbn file |
|---|---|
| 3D seeded wobble field, densify | `src/pipeline/wobble.ts` |
| Taper/pressure width + depthEmphasis | `src/pipeline/width.ts` |
| Tonal layer clipping | `src/scene/scene.ts:383-468` |
| Zero-set silhouettes + coherent chaining | `src/mesh/silhouette.ts` |
| Suggestive contours / curvature | `src/mesh/suggestive.ts`, `curvature.ts` |
| Abstraction + stateless fade | `src/pipeline/abstract.ts` |
| Consolidation | `src/pipeline/consolidate.ts` |
| Dyadic ladder / streamline atlas | `src/primitives/hatch-field.ts`, `src/mesh/mesh-hatch.ts` |
