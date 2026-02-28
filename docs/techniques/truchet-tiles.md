# Truchet Tiles

Simple tiles with asymmetric patterns that create emergent complexity when placed randomly on a grid. A perfect example of "simple rules, complex output."

## Classic Truchet Tile
A square tile divided diagonally into two triangles (black/white). When randomly oriented (0 or 90deg), the grid produces winding paths.

## Quarter-Circle Truchet (Most Common in Plotter Art)
Each tile has two quarter-circle arcs connecting opposite corners. Random rotation creates continuous curving paths:
```
Tile A: arcs connecting top-left to bottom-right corners
Tile B: arcs connecting top-right to bottom-left corners (90deg rotation)
```
The result is a network of smooth, continuous curves — ideal for single-path plotting.

## Multi-Scale Truchet
Subdivide tiles recursively:
1. Place large tile
2. If random < threshold, subdivide into 4 smaller tiles
3. Each sub-tile gets its own random rotation
4. Repeat to desired depth

Creates organic-looking patterns with detail variation.

## Tile Variations

### Arc Tiles (Smith Tiles)
Four arc configurations per tile instead of two. More possible patterns, richer output.

### Line Tiles
Straight diagonal lines instead of arcs. Creates angular, crystalline patterns.

### Triangle Grid Truchet
Truchet on triangular instead of square grid. Three orientations per tile.

### Hex Truchet
Hexagonal tiles with arc or line elements. Six possible orientations.

### Weighted Randomness
Instead of 50/50 random orientation, bias based on:
- Image brightness (dark areas favor one orientation)
- Noise field (smooth spatial variation)
- Radial distance (from center)

## Path Extraction
The key plotter challenge: individual tiles contain arcs, but for efficient plotting we want continuous paths. Algorithm:
1. Place all tiles and collect arc segments
2. Build adjacency graph (which arcs connect at tile borders)
3. Trace connected paths through the graph
4. Result: small number of long continuous curves

## Parameters
| Parameter | Effect |
|-----------|--------|
| `gridSize` | Number of tiles per row/column |
| `tileSize` | Physical size of each tile |
| `bias` | Probability of each orientation (0.5 = fully random) |
| `lineWidth` | Stroke width of arcs |
| `subdivisionDepth` | Max recursion for multi-scale |

## Composition Ideas for Hatch3d
- **Truchet surface texture**: Map Truchet pattern onto UV space of parametric surface
- **Truchet as hatch**: Replace parallel hatch lines with Truchet-generated curves on surface
- **Background pattern**: Truchet grid as background layer behind 3D forms
- **Truchet mask**: Use Truchet paths to clip/mask surface hatching
- **3D Truchet**: Tile pattern on surface of cube/sphere, project with occlusion

## References
- Sebastien Truchet (1704) — original tile concept
- Cyril Stanley Smith (1987) — quarter-circle variant
- Christopher Carlson, "Multi-Scale Truchet Patterns"
- Ink & Algorithms, "Masters of Truchet"
