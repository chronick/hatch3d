---
title: "WebGL occlusion under jsdom headless render"
created: 2026-04-24
task: vault-2xyq
status: complete
---

## Verdict

**Broken — but already guarded.** `cli/render.ts` hardcodes
`useOcclusion: false`, so the headless pipeline never attempts WebGL
at all. Occlusion silently drops out of every headless render, including
what the improve-mode routine will produce and score.

The risk is not a crash — it's a silent rendering difference between
browser (occlusion on) and headless (occlusion off) that will corrupt
the improve-mode LLM-vision critique signal for occlusion-sensitive
compositions.

---

## How occlusion works in hatch3d

The pipeline in `src/workers/render-pipeline.ts` is:

```
hatch lines → project → [depth-buffer clip] → SVG paths
```

The depth-buffer clip step calls `renderDepthBufferOffscreen` from
`src/occlusion.ts`, which:

1. Creates an `OffscreenCanvas` (browser-only API).
2. Passes it to `THREE.WebGLRenderer` as its canvas.
3. Renders surface meshes to a custom depth shader.
4. Reads back the pixel buffer with `readRenderTargetPixels`.
5. Uses pixel depth values to clip occluded hatch segments.

The step is gated by `req.useOcclusion` (a boolean in `RenderRequest`).

---

## What jsdom provides

jsdom implements the DOM well enough for React rendering and
attribute-based tests, but:

- **No WebGL context**: `canvas.getContext('webgl')` returns `null`.
- **No `OffscreenCanvas`**: The class does not exist in jsdom's DOM API.
- **No GPU**: jsdom is pure JavaScript; it has no native graphics path.

If `renderDepthBufferOffscreen` were called under jsdom, it would throw
immediately on `new OffscreenCanvas(...)`.

The existing test suite (`vitest` + jsdom, 412 tests) passes cleanly
because no test exercises the occlusion path. The tests cover surfaces,
hatch generation, projection, 2D compositions, and composition metadata
— all of which work without WebGL.

---

## The guard that already exists

In `cli/render.ts`, `renderOne()` builds the `RenderRequest` with:

```typescript
useOcclusion: false, // Skip in headless mode (requires WebGL)
```

This is a deliberate, already-known workaround. The CLI never asks for
occlusion; the pipeline skips the `renderDepthBufferOffscreen` call
entirely. No crash, no error — occlusion is silently absent.

The `src/App.tsx` UI defaults `useOcclusion: false` too, but the user
can toggle it on. When on, the browser's native WebGL canvas backs the
renderer correctly.

---

## Compositions affected by the headless/browser gap

All 3D compositions render without occlusion in headless mode. Visual
impact varies by geometry type:

| Composition | Impact without occlusion | Severity |
|---|---|---|
| `sentinel-terrain` | Has `buildDepthMesh` specifically for HLR; back-face hatches bleed through terrain from rear | **High** |
| `totem-stack` | Stacked box stack; hidden bottom and rear faces visible | **High** |
| `tower-and-base` | Similar to totem-stack; interior geometry bleeds | **High** |
| `nested-shells` | Inner shell hatch lines appear through outer shell | **High** |
| `crystal-lattice` | Rear lattice struts overlap front struts | **Medium** |
| `vortex-tunnel` | Tunnel interior partly visible depending on camera angle | **Medium** |
| `double-ring`, `starburst` | Mostly convex; mild back-face bleed at certain angles | **Low** |
| `ribbon-cage`, `dna-helix`, `phyllotaxis-garden` | Open mesh; occlusion rarely visible | **Low** |
| All 2D compositions | Occlusion not used; zero impact | **None** |

`sentinel-terrain` is the highest-risk composition for the improve
routine because it is the only one with a custom `buildDepthMesh` — a
signal that the composition designer considered occlusion load-bearing
for correct output.

---

## Options and recommendation

### Option A — Accept the inconsistency for v1 (recommended)

The improve routine always renders without occlusion (variants and
baseline). LLM critique compares variant against variant — both
unoccluded. The relative signal is valid for parameter tuning
(density, spacing, line-weight changes don't depend on occlusion).

**When this breaks**: if the user loads a composition in-browser with
occlusion enabled, they'll see different hatching than what the routine
optimized. For v1 this is acceptable; add a flag to surface it before v2.

### Option B — CPU painter's-algorithm fallback

Implement triangle-sort depth test in TypeScript: sort mesh triangles
by camera distance, rasterize a depth grid, sample depth per-point.
8-bit precision is sufficient for plotter hatches (~400×400 grid). Cost:
~100–200ms per render; ~2 days to implement and tune correctly.

Correct approach for v2 if headless/browser consistency is required.

### Option C — headless-gl (WebGL in Node.js)

`gl` (npm: `headless-gl`) provides a Mesa/EGL-backed WebGL context that
allows calling `renderDepthBuffer` unchanged. Requires native bindings
and a Linux + mesa install. Works well in CI on Ubuntu; fragile on Mac.

Viable if the rendering environment is locked to a known Linux Docker
image. Not appropriate for a portable tsx-based CLI.

### Option D — Mark compositions as `occlusionSensitive`

Add `occlusionSensitive?: boolean` to `Composition3DDefinition`. The
improve routine reads this flag and either skips the composition or emits
a warning in the PR body. Pairs with Option A.

---

## Recommended action plan

1. **v1 now**: ship improve-mode with `useOcclusion: false` as-is (it
   already is). Document in the routine that headless renders are
   unoccluded and the critique ignores occlusion artifacts.

2. **v1.5 cleanup** (file a follow-up task): add `occlusionSensitive`
   flag to `sentinel-terrain`, `totem-stack`, `tower-and-base`,
   `nested-shells`. Have the improve routine log a note when it
   encounters one, so the user knows the PR diff may look different
   in-browser.

3. **v2** (deferred): CPU occlusion fallback (Option B) unlocks correct
   headless rendering for all compositions without WebGL dependency.

---

## Source references

- `cli/render.ts` → `renderOne()` → `useOcclusion: false`
- `src/workers/render-pipeline.ts` → `renderDepthBufferOffscreen` call site
- `src/occlusion.ts` → `OffscreenCanvas` + `WebGLRenderer` usage
- `src/compositions/3d/architectural/sentinel-terrain.ts` → `buildDepthMesh`
- `vite.config.ts` → `test.environment: "jsdom"`
