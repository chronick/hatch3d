# Space-Filling Curves

Continuous curves that pass through every point in a 2D region. At finite resolution, they produce intricate single-path patterns — ideal for plotters.

## Classic Curves

### Hilbert Curve
Recursive L-shaped pattern that fills a square. At each level, 4 copies of the previous level are connected:
```
Level 1: U shape (4 points)
Level 2: 4 U-shapes rotated and connected (16 points)
Level N: 4^N points
```
Excellent locality — nearby points on the curve are nearby in space.

### Gosper Curve (Flowsnake)
Hexagonal space-filling curve. Fills a fractal hexagon at each level. More organic-looking than Hilbert.

### Peano Curve
The original (1890). Fills a square with a 9-segment recursive pattern. Denser than Hilbert at the same level.

### Dragon Curve
Fold a strip of paper in half repeatedly, unfold at 90deg:
```
L-system: FX, X -> X+YF+, Y -> -FX-Y
```
Not strictly space-filling but creates beautiful fractal outlines.

### Sierpinski Curve
Fills a triangle. Multiple variants (arrowhead curve fills triangle with single path).

### Moore Curve
Closed-loop variant of Hilbert curve. Returns to starting point — single continuous loop.

## L-System Implementation
Most space-filling curves are naturally expressed as L-systems:
```
Hilbert: A -> +BF-AFA-FB+
         B -> -AF+BFB+FA-
```
Where F = forward, + = turn right, - = turn left.

## Parameters
| Parameter | Effect |
|-----------|--------|
| `level` | Recursion depth (detail vs. point count) |
| `size` | Overall scale |
| `lineLength` | Segment length (decreases with level) |

## Density as Tone
Space-filling curves at different recursion levels have different visual densities:
- Level 2: sparse, architectural
- Level 4: medium density, decorative
- Level 6+: nearly solid fill

By varying recursion level spatially (deeper in dark areas), curves can represent tone.

## Variations
- **Partial fill**: Only trace portions of the curve to leave whitespace
- **Noise-perturbed**: Displace curve vertices with Perlin noise for organic feel
- **Variable segment length**: Longer segments in light areas, shorter in dark
- **Curve on surface**: Map space-filling curve onto UV space of parametric surface
- **Multi-curve layering**: Different curve types overlaid for visual complexity

## Plotter Considerations
- Single continuous path — minimal pen lifts (or zero for Moore curve)
- Very long paths — may need to limit recursion depth for reasonable plot time
- Clean geometric patterns at low levels, abstract texture at high levels
- Pairs well with other techniques (flow field + Hilbert boundary)

## Composition Ideas for Hatch3d
- **Hilbert-hatched surface**: Use space-filling curve in UV space instead of parallel lines
- **Fractal fill composition**: Surface silhouettes filled with space-filling curves
- **Level-graded density**: Vary curve recursion depth based on surface normal for light/shadow
- **Nested curves**: Hilbert curve at one scale with surfaces placed at curve vertices
- **Dragon curve border**: Decorative fractal frame around central 3D composition

## References
- Peano (1890), Hilbert (1891) — original papers
- Prusinkiewicz & Lindenmayer, "The Algorithmic Beauty of Plants" — L-system reference
- Shiffman, "The Nature of Code" — L-system implementations
