# Moire Patterns

Visual interference patterns created when two regular patterns overlap with slight offset, rotation, or scale difference. Already partially implemented in hatch3d (Moire Circles 2D composition).

## The Physics
When two periodic structures with slightly different frequencies overlap, a beat frequency emerges — large-scale patterns from small-scale repetition. The moire fringe spacing is:
```
fringe_period = period1 * period2 / |period1 - period2|
```

## Types of Moire

### Linear Moire
Two sets of parallel lines with slight angle difference:
```
Set A: lines at angle 0, spacing s
Set B: lines at angle theta, spacing s
Fringe spacing = s / (2 * sin(theta/2))
```
Even 1-2deg rotation creates dramatic large-scale patterns.

### Circular Moire
Two sets of concentric circles with offset centers (what hatch3d already does):
- Set A centered at (0, 0)
- Set B centered at (dx, dy)
- Produces hyperbolic-looking fringe patterns

### Radial Moire
Two sets of radial lines (spokes) with slight rotation offset. Creates spiraling patterns.

### Grid Moire
Overlapping grids (2D line sets). Produces complex 2D fringe patterns.

### Parametric Moire
Overlap any two parametric patterns with slight variation:
- Two spiral sets with different arm counts
- Two wave patterns with different frequencies
- Two Truchet grids at different scales

## Control Parameters
| Parameter | Effect |
|-----------|--------|
| `lineCount` | Number of lines per set (more = finer texture) |
| `angleOffset` | Rotation between sets (small = dramatic fringes) |
| `centerOffset` | Position offset between circular sets |
| `scaleRatio` | Scale difference between sets |
| `lineWeight` | Thickness affects fringe visibility |

## Design Principles
- Small parameter differences create the strongest visual effects
- The moire pattern exists at a much larger scale than the individual lines
- Viewing distance matters — fine lines merge at distance, fringes dominate
- Motion effects: slight rotation creates dramatic pattern shift (interactive/animated potential)

## Plotter Advantages
Pen plotters excel at moire because:
- Precise, consistent line weight
- Can draw very fine, closely spaced lines
- No pixel aliasing artifacts (unlike screen rendering)
- Physical paper moire has depth that screens can't capture

## Variations
- **Multi-set moire**: Three or more overlapping pattern sets
- **Curved line moire**: Instead of straight lines, use sinusoidal or noise-perturbed lines
- **Density-graded**: Vary line spacing across the set for controlled fringe locations
- **Moire animation**: Series of prints with incrementally changing offset (flip book)
- **Color moire**: Different pen colors per set — creates color mixing at fringes

## Composition Ideas for Hatch3d
- **Surface moire**: Two surfaces with slightly offset hatching create moire fringes
- **Moire shadow**: Surface casts "shadow" as second hatch pattern, offset by light angle
- **Nested surface moire**: Inner and outer shell with similar but not identical hatching
- **Moire background**: Fine-line moire pattern as backdrop for bold 3D surface foreground
- **Interactive moire**: Two-layer print (on transparency + paper) that reveals moire when moved

## References
- Lord Rayleigh, interference pattern studies
- Isaac Amidror, "The Theory of the Moire Phenomenon" (2009)
- Maks Surguy — plotter-friendly moire pattern experiments
