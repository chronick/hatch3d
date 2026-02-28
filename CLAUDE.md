# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

Hatch3d is a parametric surface hatching tool that generates pen-plotter-style SVG art. It evaluates parametric surfaces in UV space, generates hatch lines along those surfaces, projects them through a 3D camera, optionally clips by a GPU depth buffer for hidden-line removal, and outputs SVG paths.

## Commands

- `npm run dev` — Start Vite dev server with HMR
- `npm run build` — Type-check then build for production (`tsc -b && vite build`)
- `npm run lint` — ESLint
- `npm test` — Run all tests once (`vitest run`)
- `npm run test:watch` — Run tests in watch mode
- Single test file: `npx vitest run src/__tests__/hatch.test.ts`

## Architecture

The rendering pipeline flows in one direction:

```
surfaces.ts → hatch.ts → projection.ts → occlusion.ts → App.tsx (SVG output)
```

**`surfaces.ts`** — Parametric surface functions `(u, v, params) → Vector3`. Each surface has a name, function, and default params. The `SURFACES` registry is the single source of truth for available surfaces.

**`hatch.ts`** — Generates families of polylines by sweeping across a surface in UV space. Supports u-constant, v-constant, and diagonal iso-line families.

**`projection.ts`** — Projects 3D polylines to 2D screen coordinates via a Three.js camera. Also contains `buildSurfaceMesh` (generates BufferGeometry for the depth pass) and `polylinesToSVGPaths` (converts 2D points to SVG path `d` strings).

**`occlusion.ts`** — Optional hidden-line removal. Renders surface meshes to a WebGL depth buffer using a custom shader, then clips 2D polylines by sampling the depth buffer per-point.

**`compositions.ts`** — Multi-layer presets that combine several surfaces with different hatch configs and transforms. The `COMPOSITIONS` registry parallels `SURFACES`.

**`App.tsx`** — Single-component React app. All state lives as `useState` hooks. The main `useMemo` block runs the full pipeline on every parameter change. Generic sliders (paramA–D) map to surface-specific params via a linear remap off defaults. Mouse drag/wheel handlers provide orbit camera control. Export button serializes current SVG paths to a downloadable file.

## Key Patterns

- Surface functions are pure: `(u: number, v: number, params: Record<string, number>) → THREE.Vector3`. Adding a new surface means writing one function and adding an entry to the `SURFACES` record.
- Three.js is used only for math (Vector3, Camera, BufferGeometry) and the depth-buffer WebGL pass — there is no Three.js scene rendered to screen. All visible output is SVG.
- Tests live in `src/__tests__/` and cover surfaces, hatch generation, and projection. Test environment is jsdom (configured in `vite.config.ts`).
