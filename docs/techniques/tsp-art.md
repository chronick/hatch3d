# TSP Art (Traveling Salesman Art)

Creating images from a single continuous path by solving (or approximating) the Traveling Salesman Problem on stipple points. The ultimate plotter technique — one pen-down, one pen-up.

## The Concept
1. Convert image to stipple points (Voronoi stippling or other method)
2. Find shortest tour visiting all points exactly once
3. Draw the tour as a single continuous path
4. Line density inherently represents image tones

## Pipeline
```
Image -> Stippling (N points) -> TSP Solve -> Single Path SVG
```

## TSP Solvers

### Nearest Neighbor (Greedy)
Simple: always go to closest unvisited point. Fast (O(n^2)) but produces ~25% longer tours than optimal. Good enough for art — the "imperfection" adds character.

### 2-Opt Improvement
After initial tour, iteratively improve by reversing segments:
1. For each pair of edges (a-b, c-d), check if reconnecting as (a-c, b-d) shortens tour
2. If shorter, reverse the segment between b and c
3. Repeat until no improvement found

Significantly improves tour quality. Multiple passes recommended.

### 3-Opt
Like 2-opt but considers reconnecting 3 edges. Better results, much slower.

### Lin-Kernighan Heuristic
Gold standard TSP heuristic. Complex but produces near-optimal tours. Available in Concorde solver.

### Or-Tools / Concorde
Production TSP solvers that handle thousands of points efficiently.

## Point Count and Quality
| Points | Plot Time | Detail | Aesthetic |
|--------|-----------|--------|-----------|
| 1,000 | Minutes | Low | Sketch-like |
| 5,000 | ~30 min | Medium | Clear image |
| 10,000 | ~1 hour | High | Photographic |
| 50,000+ | Hours | Very high | Dense, rich |

## Plotter Considerations
- Single continuous path — literally one pen stroke
- Very long path with many direction changes — use sturdy pen
- Pen speed should be consistent to avoid ink pooling at direction changes
- Path crosses itself frequently — paper must handle multiple passes

## Variations
- **TSP with line weight**: Vary drawing speed or pressure (if plotter supports it)
- **Multi-tour**: Several shorter tours on different layers/colors
- **Stipple density from depth**: 3D scene → depth map → variable-density stippling → TSP
- **Abstract TSP**: Use non-image-derived point sets (random, noise, mathematical)
- **Open tour**: Don't return to start — produces more linear compositions

## Composition Ideas for Hatch3d
- **TSP surface fill**: Stipple points on projected surface, solve TSP for single-path surface rendering
- **TSP background**: Image-based TSP path behind geometric surfaces
- **Surface sample TSP**: Sample points on parametric surface, project to 2D, solve TSP — single-path surface drawing
- **Abstract TSP frame**: Random/noise points arranged around central 3D composition, connected by TSP tour

## References
- Robert Bosch, "Opt Art" — pioneering TSP art
- Craig Kaplan, "TSP Art" (2005)
- Evil Mad Scientist, StippleGen with TSP mode
