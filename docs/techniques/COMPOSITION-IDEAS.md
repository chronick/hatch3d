# Composition Ideas for Hatch3d

Innovative compositions that combine the techniques in this library with hatch3d's existing pipeline. Ranked by feasibility (how much existing infrastructure they can reuse).

---

## Tier 1: Implementable Now (Uses Existing Pipeline) — ALL COMPLETE

These only need a new composition file — no engine changes.

### 1. Engraving Study ✅
**Techniques**: Contour hatching, variable density, form-following lines
**Concept**: A single surface (torus or hyperboloid) rendered in the style of old master copper-plate engraving. Multiple hatch layers with density driven by a virtual light source — dense in shadow, sparse in light. Hatch direction follows the surface's principal curvature.
**Implementation**: `src/compositions/3d/studies/engraving-study.ts`

### 2. Exploded Technical Drawing ✅
**Techniques**: Wireframe projection, section hatching, layering
**Concept**: Multiple versions of the same surface at different scales, separated vertically like an exploded engineering diagram.
**Implementation**: `src/compositions/3d/studies/exploded-view.ts`

### 3. Op Art Sphere ✅
**Techniques**: Op art, warped grid, line frequency modulation
**Concept**: A flat composition (2D type) that creates the illusion of a 3D sphere purely through line spacing modulation.
**Implementation**: `src/compositions/2d/optical/op-art-sphere.ts`

### 4. Fibonacci Phyllotaxis Garden ✅
**Techniques**: Spirals, phyllotaxis, organic forms
**Concept**: Small surfaces placed at golden-angle positions on a Fermat spiral.
**Implementation**: `src/compositions/3d/organic/phyllotaxis-garden.ts`

### 5. Crystal Lattice ✅
**Techniques**: Tiling, parametric surfaces, geometric composition
**Concept**: Surfaces arranged on a regular 3D lattice, projected to 2D with occlusion.
**Implementation**: `src/compositions/3d/geometric/crystal-lattice.ts`

### 6. Atmospheric Depth Study ✅
**Techniques**: Layering and density, atmospheric perspective
**Concept**: Multiple identical surfaces at increasing Z-depth with progressively sparser hatching.
**Implementation**: `src/compositions/3d/studies/atmospheric-depth.ts`

---

## Tier 2: Needs New 2D Techniques (New generate() functions) — ALL COMPLETE

These need new 2D composition generators but no engine changes.

### 7. Truchet Maze ✅
**Implementation**: `src/compositions/2d/patterns/truchet-maze.ts`

### 8. Flow Field Portrait ✅
**Implementation**: `src/compositions/2d/generative/flow-field.ts`

### 9. Hilbert Fill ✅
**Implementation**: `src/compositions/2d/patterns/hilbert-fill.ts`

### 10. Guilloche Rosette ✅
**Implementation**: `src/compositions/2d/patterns/guilloche-rosette.ts`

### 11. Differential Growth Fill ✅
**Implementation**: `src/compositions/2d/generative/differential-growth.ts`

### 12. Strange Attractor Study ✅
**Implementation**: `src/compositions/2d/generative/strange-attractor.ts`

---

## Tier 3: Needs Engine Enhancements — ALL COMPLETE

### 13. Light-Responsive Hatching ✅ (merged with #15)
**Engine Change**: `densityFn` callback in `HatchParams` + `lightDensityFn` helper in `helpers-density.ts`

### 14. Noise-Perturbed Hatching ✅
**Engine Change**: `noiseAmplitude`/`noiseFrequency` in `HatchParams` (post-process in `hatch.ts`)

### 15. Variable-Density Hatching ✅ (merged with #13)
**Engine Change**: `densityFn`/`densityOversample` in `HatchParams` with oversample-and-filter approach. Also `curvatureDensityFn` and `radialDensityFn` helpers.

### 16. Broken/Dashed Hatching ✅
**Engine Change**: `dashLength`/`gapLength`/`dashRandom` in `HatchParams` (post-process in `hatch.ts`)

### 17. Multi-Technique Surface ✅ (reclassified — no engine change needed)
**Implementation**: `src/compositions/3d/studies/multi-technique.ts` — Uses existing `uRange`/`vRange` per-layer system to divide a single surface into UV regions with different hatch families.

---

## Tier 4: Ambitious / Long-Term — ALL COMPLETE

### 18. Reaction-Diffusion ✅
Gray-Scott simulation with marching squares contour extraction for organic Turing-pattern line art.
**Implementation**: `src/compositions/2d/generative/reaction-diffusion.ts`

### 19. Growth-on-Surface ✅
Differential growth simulation in UV space mapped through a parametric surface for organic tendrils on 3D forms.
**Implementation**: `src/compositions/2d/generative/growth-on-surface.ts`

### 20. TSP Art ✅
Sample points from projected surface, solve traveling salesman (nearest-neighbor + 2-opt) for single continuous path.
**Implementation**: `src/compositions/2d/generative/tsp-art.ts`

### 21. Photo-Halftone ✅
Horizontal lines with sine-wave amplitude modulation driven by built-in test patterns. Optional surface mapping.
**Implementation**: `src/compositions/2d/generative/photo-halftone.ts`

### 22. Voronoi Texture ✅
Bowyer-Watson Voronoi diagram with optional Lloyd relaxation and per-cell hatch fill.
**Implementation**: `src/compositions/2d/generative/voronoi-texture.ts`

---

## Quick Reference: Technique to Composition Mapping

| Technique | Best Used For | Support |
|-----------|---------------|---------|
| Contour hatching | 3D form communication | Yes (u/v-constant) |
| Cross-hatching | Tonal shading | Yes (crosshatch family) |
| Flow fields | Organic texture | Yes (`flowField`) |
| Differential growth | Organic fill patterns | Yes (`differentialGrowth` with `surfaceMode` toggle) |
| Truchet tiles | Background patterns | Yes (`truchetMaze`) |
| Guilloche | Decorative borders/fills | Yes (`guillocheRosette`) |
| Space-filling curves | Region fill, texture | Yes (`hilbertFill`) |
| Strange attractors | Abstract single-path art | Yes (`strangeAttractor`) |
| Stippling | Dot-based tonal rendering | No (future technique) |
| Op art distortion | Optical illusion effects | Yes (`opArtSphere`) |
| Halftone | Image reproduction | Yes (`photoHalftone`) |
| Moire | Interference patterns | Yes (`moireCircles`) |
| Noise perturbation | Organic imperfection | Yes (`noiseAmplitude`/`noiseFrequency`) |
| Light-responsive density | Ink illustration shading | Yes (`densityFn` + `lightDensityFn`) |
| Curvature-responsive density | Detail emphasis | Yes (`densityFn` + `curvatureDensityFn`) |
| Dashed/broken lines | Atmospheric texture | Yes (`dashLength`/`gapLength`) |
| Reaction-diffusion | Organic patterns | Yes (`reactionDiffusion`) |
| TSP art | Single-line drawing | Yes (`tspArt`) |
| Voronoi tessellation | Cell-based texture | Yes (`voronoiTexture`) |
