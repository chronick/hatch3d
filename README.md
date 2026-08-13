# hatch3d

Parametric surface hatching for pen-plotter SVG art.

hatch3d evaluates parametric surfaces in UV space, generates families of hatch
lines along them, projects the result through a 3D camera, optionally clips by
a GPU depth buffer for hidden-line removal, and emits SVG paths sized in
millimetres for a plotter. Everything is deterministic: same parameters + seed
→ identical output, so renders are diffable and measurable.

There are two front ends over the same geometry pipeline:

- **A headless CLI family** (`cli/`) — render, measure, and compose without a
  browser. This is the primary interface for agent-driven workflows.
- **A React web app** — interactive parameter sliders and orbit-camera preview,
  with SVG export. Three.js is used only for math and the depth pass; all
  visible output is SVG.

## Quick start

```bash
npm install

# List the ~46 built-in compositions (2D, 3D, layered)
npm run render:list

# Render one to SVG, measure it
npm run render -- -c flowField -o out.svg
npm run stats -- -i out.svg

# Interactive web app
npm run dev
```

## The pipeline

```
surfaces.ts → hatch.ts → projection.ts → occlusion.ts → SVG output
```

- **`src/surfaces.ts`** — pure parametric surface functions
  `(u, v, params) → Vector3`. The `SURFACES` registry is the single source of
  truth; adding a surface is one function plus one registry entry.
- **`src/hatch.ts`** — sweeps iso-line families (u-constant, v-constant,
  diagonal) across a surface in UV space, with seeded stochastic
  post-processing (noise displacement, dashing, density filtering) and
  point-by-point clip functions for light-driven tonal layering.
- **`src/projection.ts`** — projects 3D polylines to 2D screen coordinates via
  a Three.js camera; builds the mesh for the depth pass; converts polylines to
  SVG path data.
- **`src/occlusion.ts`** — optional hidden-line removal: renders surface meshes
  to a WebGL depth buffer and splits polylines into visible/hidden runs. Hidden
  runs can be ghosted as a faint second pen layer, and depth-emphasis
  stroke-width bands can make nearer strokes bolder.
- **`src/compositions/`** — registry of ~46 named presets across three kinds:
  2D generators (flow fields, reaction-diffusion, Truchet, Voronoi, TSP art,
  …), 3D multi-surface scenes, and layered multi-pen combinations.

## CLI tools

Headless Node CLIs run via `tsx` — no browser required. Full reference with
flags and report schemas: [`cli/README.md`](cli/README.md).

| Command | Purpose |
| ------- | ------- |
| `npm run render -- -c <id> -o out.svg` | Render a composition to SVG/PNG (`-p key=value` overrides params) |
| `npm run render -- --scene s.scene.json -o out.svg` | Render a Scene IR document ([`docs/scene-ir.md`](docs/scene-ir.md)) |
| `npm run stats -- -i out.svg` | Deterministic SVG measurement: arc length, ink-density grid, pen-travel, plottability warnings |
| `npm run stats:diff -- a.svg b.svg …` | Variability metrics across rendered variants |
| `npm run patch -- --dsl <file>.patch -o out.svg` | Evaluate a signal-flow patch (eurorack-style graph DSL; examples in `examples/patches/`) |
| `npm run feed` | Render curated presets and push to the personal feed app |
| `npm run pref:sync` | Recompute the preference model from curation signals |

The `stats` CLI is the measurement half of an agent loop: it emits structured
JSON (per-layer breakdowns, an ink-coverage grid, margin/saturation warnings)
so renders can be judged by number as well as by eye. Scene IR documents and
the patch DSL exist so an agent can author compositions as data — strict,
zod-validated, diffable — rather than as TypeScript.

## Development

```bash
npm test           # vitest, single run
npm run test:watch
npm run lint       # eslint
npm run build      # tsc -b && vite build
```

Tests live in `src/__tests__/` (jsdom environment). An optional Rust/WASM
implementation of the pipeline lives in `src/wasm/` with a prebuilt `pkg/`
checked in; rebuilding it (`npm run wasm:build`) requires `wasm-pack`.

## Docs

- [`cli/README.md`](cli/README.md) — CLI flags, stats report schema, patch DSL
- [`docs/scene-ir.md`](docs/scene-ir.md) — declarative scene document format
- [`docs/techniques/`](docs/techniques/) — notes on plotter-art techniques
  (flow fields, reaction-diffusion, guilloché, TSP art, …) that back the
  compositions
- [`examples/`](examples/) — sample patches and scene documents

## Status

Personal tool under active development — the geometry/measurement core is
well-tested (600+ tests) and the CLIs are stable; the web app and the
feed/preference tooling are wired to a personal setup and may not be useful
as-is.

## License

[MIT](LICENSE)
