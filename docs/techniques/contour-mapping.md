# Contour Mapping

Extracting isolines (contour lines) from scalar fields — the same technique used in topographic maps. Produces clean, parallel-ish curves that naturally communicate elevation/value.

## Core Algorithm: Marching Squares

For each cell in a grid, evaluate the scalar field at all four corners against a threshold:
1. Classify each corner as above/below threshold (4-bit state, 16 cases)
2. Determine which edges the contour crosses
3. Interpolate along edges for precise crossing position
4. Connect crossing points to form line segments

### Edge Interpolation
```
t = (threshold - value_a) / (value_b - value_a)
crossing_point = point_a + t * (point_b - point_a)
```

### Ambiguous Cases
Cases 5 and 10 (saddle points) have two valid interpretations. Resolve by:
- Checking center value (average of 4 corners)
- Or always choosing the same convention

## Scalar Field Sources

### Perlin/Simplex Noise
```
height(x, y) = noise(x * scale, y * scale)
```
Produces terrain-like contours. Multiple octaves for fractal detail.

### Mathematical Functions
- `sin(x) * cos(y)` — egg-crate pattern
- `sin(sqrt(x^2 + y^2))` — concentric rings
- `x^2 - y^2` — hyperbolic contours
- Sum of Gaussians — mountain peaks

### Image Data
Use image brightness as height field:
- Photo portrait -> topographic portrait
- Any image -> "terrain" interpretation

### Simulation Output
- Reaction-diffusion concentration
- Fluid simulation pressure field
- Temperature/density fields

## Parameters
| Parameter | Effect |
|-----------|--------|
| `levels` | Number of contour lines (more = finer gradation) |
| `resolution` | Grid density (higher = smoother curves) |
| `range` | Min/max height values to contour |
| `smoothing` | Pre-blur scalar field for smoother contours |

## Aesthetic Qualities
- Lines naturally bunch together at steep gradients (cliffs)
- Lines spread apart at gentle slopes (plains)
- Closed contours indicate peaks or depressions
- The pattern inherently communicates 3D structure

## Variations
- **Labeled contours**: Major contours thicker/different pen than minor
- **Filled contours**: Alternate fills between contour levels (using hatching for plotter)
- **Index contours**: Every Nth contour emphasized (like real topo maps)
- **Animated contours**: Shift threshold values for flowing effect
- **Multi-field contours**: Overlay contours from two different fields

## Composition Ideas for Hatch3d
- **Topo surface**: Contour lines on parametric surface as alternative to UV hatching
- **Noise terrain background**: Perlin noise contour map as ground plane beneath 3D forms
- **Contour portrait**: Image-derived contours combined with geometric surface elements
- **Height-field composition**: Use contour mapping to define regions where different surfaces are placed
- **Nested contour surfaces**: Stack contour slices of a 3D surface at different Z heights

## References
- Marching Squares algorithm (Lorensen & Cline, 1987 — derived from Marching Cubes)
- d3-contour library
- scikit-image measure.find_contours
