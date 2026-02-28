# Penrose Tiling

Aperiodic tilings that never repeat but maintain long-range order. Mathematically fascinating and visually striking — five-fold symmetry that can't exist in periodic tilings.

## Tile Sets

### Kite and Dart (P2)
Two quadrilaterals derived from the golden ratio:
- **Kite**: Four sides, wider shape
- **Dart**: Four sides, thinner/concave
- Matching rules force aperiodicity (edge markings that constrain which tiles can be adjacent)

### Thin and Thick Rhombus (P3)
Two rhombuses with angles:
- **Thin**: 36deg / 144deg
- **Thick**: 72deg / 108deg
- Simpler to implement than P2, same mathematical properties

## Generation Methods

### Substitution/Inflation
1. Start with a single tile (or small patch)
2. Replace each tile with a pattern of smaller tiles (subdivision rules)
3. Scale up to maintain size
4. Repeat to desired resolution

This is the most common implementation approach. Each level roughly multiplies tile count by phi^2.

### De Bruijn's Method (Pentagrid)
Five sets of parallel lines at 72deg intervals. Intersections define vertices of the Penrose tiling. More mathematically elegant but harder to implement.

### Robinson Triangle Decomposition
Kite decomposes into 2 triangles, dart into 2 triangles. Subdivision operates on triangles. Clean recursive implementation.

## Properties
- **Aperiodic**: No translational symmetry
- **Self-similar**: Appears at multiple scales
- **Five-fold symmetry**: Local 5-fold rotational patterns
- **Golden ratio**: phi = (1+sqrt(5))/2 appears throughout (edge ratios, frequencies)
- **Quasicrystalline**: Models real quasicrystal atomic structure

## Plotter Output
- Draw tile edges as paths
- Optional: draw only certain edge types for cleaner patterns
- Arc decorations on tiles (kite/dart interiors)
- Dual graph: connect tile centers instead of drawing edges
- Ammann bars: highlight specific lines that run through the tiling

## Variations
- **Colored/layered**: Assign kites and darts to different pen layers
- **Hatched tiles**: Fill each tile type with different hatch pattern
- **Partial tiling**: Only draw tiles within a boundary (circle, polygon)
- **Defect tiling**: Introduce deliberate "errors" for visual tension
- **3D Penrose**: Extend to 3D quasicrystalline structures

## Composition Ideas for Hatch3d
- **Penrose surface tiling**: Map Penrose tiling onto UV space of parametric surface
- **Tiled ground plane**: Penrose floor beneath 3D surface composition
- **Per-tile hatching**: Each Penrose tile hatched with different pattern/density
- **Penrose layout**: Position multiple surfaces at Penrose tile centroids
- **Quasicrystal structure**: 3D Penrose arrangement of surfaces

## References
- Roger Penrose (1974) — original tilings
- De Bruijn (1981) — algebraic theory
- Martin Gardner, Scientific American columns on Penrose tiles
