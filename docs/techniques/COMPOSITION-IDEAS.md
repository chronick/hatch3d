# Composition Ideas for Hatch3d

Innovative compositions that combine the techniques in this library with hatch3d's existing pipeline. Ranked by feasibility (how much existing infrastructure they can reuse).

---

## Tier 1: Implementable Now (Uses Existing Pipeline)

These only need a new composition file — no engine changes.

### 1. Engraving Study
**Techniques**: Contour hatching, variable density, form-following lines
**Concept**: A single surface (torus or hyperboloid) rendered in the style of old master copper-plate engraving. Multiple hatch layers with density driven by a virtual light source — dense in shadow, sparse in light. Hatch direction follows the surface's principal curvature.
**Implementation**: Multiple hatch groups at different angles, with `count` parameter modulated by a macro "Light Angle." Use existing surfaces with carefully tuned hatch densities per group.

### 2. Exploded Technical Drawing
**Techniques**: Wireframe projection, section hatching, layering
**Concept**: Multiple versions of the same surface at different scales, separated vertically like an exploded engineering diagram. Each layer gets a different hatch family. Connecting lines (thin vertical dashes) between layers suggest the assembly relationship.
**Implementation**: Same surface repeated at 3-5 Y offsets with different scales and hatch families. Add thin connecting layers with sparse v-constant hatching.

### 3. Op Art Sphere
**Techniques**: Op art, warped grid, line frequency modulation
**Concept**: A flat composition (2D type) that creates the illusion of a 3D sphere purely through line spacing modulation. Parallel lines with sinusoidal displacement where amplitude follows a spherical projection. No actual 3D involved.
**Implementation**: 2D composition. Generate parallel lines with computed displacement based on distance from center. The mathematical distortion creates the depth illusion.

### 4. Fibonacci Phyllotaxis Garden
**Techniques**: Spirals, phyllotaxis, organic forms
**Concept**: Small surfaces (canopy/mushroom) placed at golden-angle positions on a Fermat spiral. Creates a natural-looking garden or colony arrangement. Density decreases from center outward.
**Implementation**: Modify mushroom-colony positioning to use Fibonacci spiral placement. Scale surfaces smaller toward edges. Already have dynamic layer generation pattern.

### 5. Crystal Lattice
**Techniques**: Tiling, parametric surfaces, geometric composition
**Concept**: Surfaces arranged on a regular 3D lattice (cubic, hexagonal, or BCC), projected to 2D with occlusion. Each node has a small surface (torus or hyperboloid). Connecting edges drawn as thin ribbons.
**Implementation**: Generate surface layers at lattice positions. Use twisted ribbon as connectors. Existing projection and occlusion handles the rest.

### 6. Atmospheric Depth Study
**Techniques**: Layering and density, atmospheric perspective
**Concept**: Multiple identical surfaces at increasing Z-depth. Front surface has full dense cross-hatching, each successive layer gets progressively sparser. Creates powerful depth without perspective distortion (orthographic projection).
**Implementation**: Same surface repeated at different Z positions. Hatch count decreases linearly with depth via macro.

---

## Tier 2: Needs New 2D Techniques (New generate() functions)

These need new 2D composition generators but no engine changes.

### 7. Truchet Maze
**Techniques**: Truchet tiles, path extraction
**Concept**: Quarter-circle Truchet tile grid with path tracing to extract continuous curves. Weighted randomness from Perlin noise creates regions of different visual density. Single-path or few-path output.
**Implementation**: New 2D composition. Generate tile grid, random orientations (noise-biased), trace connected arc paths. Output as polylines.

### 8. Flow Field Portrait
**Techniques**: Flow fields, separation distance, density modulation
**Concept**: Noise-driven flow field filling the canvas. Seed point density can be uniform (abstract) or image-modulated (portrait). Lines terminate when too close to neighbors.
**Implementation**: New 2D composition. Core flow field algorithm with configurable noise scale, step length, max steps, and separation distance.

### 9. Hilbert Fill
**Techniques**: Space-filling curves
**Concept**: Hilbert curve at configurable recursion level. Can fill full canvas or be masked to a shape. Level can vary spatially for density-as-tone effect.
**Implementation**: New 2D composition. Recursive Hilbert curve generation with L-system turtle.

### 10. Guilloche Rosette
**Techniques**: Guilloche, epicycloid layering
**Concept**: Central rosette pattern with concentric guilloche bands. Each band has slightly different wave parameters creating moire-like interference between bands. Exquisitely detailed — plays to plotter's precision strength.
**Implementation**: New 2D composition. Parametric curve generator with layered ring structure.

### 11. Differential Growth Fill
**Techniques**: Differential growth
**Concept**: Single closed curve that grows to fill a bounded region. Starts as a circle, grows over iterations into coral-like complexity. The boundary can be a circle, rectangle, or arbitrary polygon.
**Implementation**: New 2D composition with simulation loop. Force-based node system with spatial hashing. Output is polyline(s).

### 12. Strange Attractor Study
**Techniques**: Strange attractors, projection
**Concept**: 3D attractor (Lorenz, Aizawa, Thomas) projected to 2D. Single continuous path with hundreds of thousands of points. Parameter exploration through macros.
**Implementation**: New 2D composition. Numerical integration + projection. Very long single polyline output.

---

## Tier 3: Needs Engine Enhancements

These require changes to the rendering pipeline.

### 13. Light-Responsive Hatching
**Techniques**: Hatching density from lighting, form-following hatching
**Concept**: Surface normal computed at each hatch point. Given a configurable light direction, hatch line spacing varies based on N dot L. Lit areas are sparse, shadow areas are dense. The standard technique of pen-and-ink illustration.
**Engine Change**: `hatch.ts` needs access to surface normals at each UV point. Spacing modulation based on external function.

### 14. Noise-Perturbed Hatching
**Techniques**: Noise displacement, organic imperfection
**Concept**: All hatch families gain an optional Perlin noise displacement. Lines that should be straight become gently wavy. Controlled by amplitude and frequency parameters.
**Engine Change**: Post-process step in `hatch.ts` that displaces generated UV points with noise.

### 15. Variable-Density Hatching
**Techniques**: Adaptive density, curvature-responsive
**Concept**: Hatch line count varies spatially based on surface curvature or user-defined density map. High-curvature regions get more lines, flat regions get fewer.
**Engine Change**: `generateUVHatchLines()` needs non-uniform line spacing option.

### 16. Broken/Dashed Hatching
**Techniques**: Broken line hatching, atmospheric texture
**Concept**: Hatch lines with configurable gaps. Random or regular gaps create texture and prevent mechanical look. Gap probability can vary spatially.
**Engine Change**: Post-process in `hatch.ts` to insert gaps in generated polylines.

### 17. Multi-Technique Surface
**Techniques**: Multiple hatching + fill techniques per surface
**Concept**: Different regions of a single surface rendered with different techniques — hatching in one area, stippling in another, flow field in a third. Regions defined by UV coordinate ranges or surface properties.
**Engine Change**: Composition layer config needs per-region rendering options.

---

## Tier 4: Ambitious / Long-Term

### 18. Reaction-Diffusion Surface
Run Gray-Scott simulation on UV space, extract contours, map onto 3D surface. Organic Turing patterns on mathematical forms.

### 19. Growth-on-Surface
Differential growth simulation running on parametric surface UV space. Organic tendrils that wrap 3D forms.

### 20. TSP Surface
Sample points on projected surface, solve traveling salesman for single-path rendering of 3D form.

### 21. Photo-Mapped Surface
Image halftone (sine-wave amplitude modulation) mapped onto parametric surface UV space. Portraits on mathematical forms.

### 22. Voronoi Surface Texture
Generate Voronoi cells in UV space, draw cell edges on 3D surface. Each cell independently hatch-filled.

---

## Quick Reference: Technique to Composition Mapping

| Technique | Best Used For | Existing Support |
|-----------|---------------|------------------|
| Contour hatching | 3D form communication | Yes (u/v-constant) |
| Cross-hatching | Tonal shading | Yes (crosshatch family) |
| Flow fields | Organic texture | No (new 2D type) |
| Differential growth | Organic fill patterns | No (new 2D type) |
| Truchet tiles | Background patterns | No (new 2D type) |
| Guilloche | Decorative borders/fills | No (new 2D type) |
| Space-filling curves | Region fill, texture | No (new 2D type) |
| Strange attractors | Abstract single-path art | No (new 2D type) |
| Stippling | Dot-based tonal rendering | No (new technique) |
| Op art distortion | Optical illusion effects | Partial (2D possible) |
| Halftone | Image reproduction | No (new 2D type) |
| Moire | Interference patterns | Yes (moire-circles) |
| Noise perturbation | Organic imperfection | No (engine addition) |
| Light-responsive density | Ink illustration shading | No (engine addition) |
