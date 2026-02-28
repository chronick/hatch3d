# Voronoi Diagrams & Delaunay Triangulation

Fundamental spatial partitioning structures. Voronoi divides space into cells closest to each seed point; Delaunay connects points into a triangulation (the dual of Voronoi).

## Voronoi Diagram
For a set of seed points, each Voronoi cell contains all positions closer to its seed than any other:
```
cell(p) = { x : distance(x, p) < distance(x, q) for all q != p }
```

### Properties
- Cell edges are perpendicular bisectors between neighboring seeds
- Cells are convex polygons
- Models natural phenomena: crystal grain boundaries, cell biology, territory division

## Delaunay Triangulation
Connects points such that no point lies inside the circumscribed circle of any triangle. The dual graph of the Voronoi diagram.

### Properties
- Maximizes the minimum angle of all triangles (avoids slivers)
- Unique for points in general position
- Natural basis for mesh generation

## Lloyd Relaxation
Iteratively move each point to the centroid of its Voronoi cell:
1. Compute Voronoi diagram
2. Move each seed to its cell's centroid
3. Repeat

Produces increasingly uniform (but organic-looking) point distributions. The basis of Voronoi stippling.

## Generation Algorithms
- **Fortune's Algorithm**: O(n log n) sweep line for Voronoi — the standard
- **Bowyer-Watson**: Incremental Delaunay triangulation
- **Libraries**: d3-delaunay, scipy.spatial.Voronoi, paper.js Voronoi

## Plotter Applications

### Voronoi Cell Edges
Draw cell boundaries — produces organic-looking cellular patterns. Different seed distributions create different aesthetics:
- Random: chaotic, natural
- Blue noise: regular but organic
- Phyllotaxis: radially organized
- Image-weighted: dense in dark areas

### Delaunay Mesh
Draw triangle edges — creates triangulated mesh look. Good for low-poly aesthetic.

### Voronoi Hatching
Hatch each Voronoi cell independently with different patterns or densities:
- Density based on cell area (small cell = dark = dense hatch)
- Different angle per cell
- Mixed techniques per cell (some hatched, some stippled)

### Relaxed Voronoi
After Lloyd relaxation, cells become more regular — produces clean, tile-like patterns.

## Variations
- **Weighted Voronoi**: Seeds have different weights, creating unequal cell sizes
- **Centroidal Voronoi**: The result of Lloyd relaxation — seeds at cell centroids
- **Voronoi + Noise**: Perturb cell edges with noise for organic boundaries
- **Nested Voronoi**: Subdivide each cell with its own Voronoi diagram
- **3D Voronoi**: Volumetric cell partitioning, slice and project

## Composition Ideas for Hatch3d
- **Voronoi surface texture**: Generate Voronoi cells in UV space, draw cell edges on surface
- **Voronoi-hatched composition**: Each Voronoi cell on a surface gets independent hatch direction
- **Shattered surface**: Voronoi crack pattern overlaid on smooth surface hatching
- **Cell-based composition**: Place different small surfaces in each Voronoi cell
- **Delaunay wireframe**: Connect surface sample points with Delaunay triangulation as alternative to hatching

## References
- Georgy Voronoi (1908) — original definition
- Boris Delaunay (1934) — triangulation dual
- Fortune (1987) — efficient computation
- Fabax Art, "Voronoi Hatch" plotter pieces
