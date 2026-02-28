# Stippling

Representing tone through dot density rather than lines. Dots placed closer together appear darker; further apart appears lighter.

## Weighted Voronoi Stippling (Secord's Method)

The gold standard algorithm for converting images to stipple drawings.

### Algorithm
1. Distribute N seed points randomly (or uniformly) across canvas
2. Compute Voronoi diagram of the points
3. For each Voronoi cell, compute the weighted centroid using image brightness as weight
4. Move each point to its cell's weighted centroid
5. Repeat steps 2-4 (Lloyd relaxation) until convergence
6. Dark image regions attract and concentrate points; light regions spread them out

### Key Insight
Standard Lloyd relaxation produces uniform distributions. By weighting the centroid calculation with image darkness, points concentrate in dark areas and spread in light areas.

### Parameters
| Parameter | Effect |
|-----------|--------|
| `numPoints` | Total stipple count (more = finer detail, longer plot) |
| `iterations` | Lloyd relaxation iterations (10-50 usually sufficient) |
| `minDotSize` | Smallest dot radius |
| `maxDotSize` | Largest dot radius (optional: vary by cell area) |

## Other Stippling Approaches

### Poisson Disk Sampling
- Points distributed with minimum separation distance
- Distance varies by desired density (closer = darker)
- Produces blue noise distribution (no clumping)
- Faster than Voronoi stippling but less precise tonal control

### Dithering-Based
- Apply Floyd-Steinberg or Atkinson dithering to image
- Extract dot positions from dithered pixels
- Fast but produces grid-aligned artifacts

### Halftone Dots
- Regular grid with dot size proportional to darkness
- Classic print technique (newspapers, comics)
- On plotter: draw circles of varying radius

## Plotter Output
Stipple dots on a plotter can be drawn as:
- **Tiny circles**: `<circle r="0.3mm"/>` — clean, mechanical feel
- **Dots**: Pen touches down and lifts — fastest, most organic
- **Small spirals**: Tiny spiral at each point — more ink, richer dot
- **Varied radius circles**: Larger circles in darker regions for emphasis

## Plotter Considerations
- Thousands of individual pen lifts — slow to plot
- Optimize with TSP path ordering (visit all dots in shortest route)
- Consider minimum dot size your pen can make reliably
- Paper quality matters — absorbent paper bleeds, coated paper stays crisp

## Composition Ideas for Hatch3d
- **Stippled shadows**: Use stippling for shadow regions, hatching for lit regions — mixed technique
- **Stipple fill**: Fill projected surface silhouettes with Voronoi stippling
- **Stipple density from depth**: Points denser on surfaces facing camera, sparser on edges
- **Stipple + line hybrid**: Hatch lines on one surface, stippled dots on adjacent surface for contrast

## References
- Adrian Secord, "Weighted Voronoi Stippling" (2002)
- Evil Mad Scientist, StippleGen Processing sketch
- Robert Hodgin, stippling experiments
