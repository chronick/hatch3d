# Flow Fields

## What It Is

A vector field where every point in space has a direction. Particles (or pen strokes) launched into the field follow these directions, creating organic flowing line patterns. One of the most popular techniques in generative plotter art.

The appeal is immediate: flow fields produce line work that feels natural and hand-drawn, yet exhibits a coherent underlying structure. For pen plotters, the technique is ideal because it directly produces polyline paths with no rasterization step.

## Core Algorithm

1. Define a vector field: for each (x, y), compute an angle theta
2. Place seed points across the canvas
3. For each seed, trace a path: step in the field direction, sample new direction, repeat
4. Collect all paths as polylines for SVG output

In pseudocode:

```
for each seed point (sx, sy):
    path = [(sx, sy)]
    (x, y) = (sx, sy)
    for step in 0..maxSteps:
        theta = field(x, y)
        x += cos(theta) * stepLength
        y += sin(theta) * stepLength
        if outOfBounds(x, y) or tooCloseToOtherPath(x, y):
            break
        path.append((x, y))
    emit path
```

### Integration Method

The simplest approach is Euler integration (step directly in the sampled direction). For smoother results, use Runge-Kutta (RK4) integration:

```
k1 = field(x, y)
k2 = field(x + stepLength/2 * cos(k1), y + stepLength/2 * sin(k1))
k3 = field(x + stepLength/2 * cos(k2), y + stepLength/2 * sin(k2))
k4 = field(x + stepLength * cos(k3), y + stepLength * sin(k3))
theta = (k1 + 2*k2 + 2*k3 + k4) / 6
```

RK4 produces paths that more faithfully follow the field, especially in regions of high curvature, at the cost of 4x the field evaluations per step.

## Field Sources

### Perlin/Simplex Noise

- `angle = noise2D(x * scale, y * scale) * 2 * PI`
- Scale controls wavelength (larger scale value = tighter variation, smaller = smoother and broader)
- Multiple octaves for fractal detail: `angle = sum(noise(x * scale * 2^i) * 0.5^i for i in 0..octaves)`
- Most common approach -- produces organic, wind-like patterns
- Seed the noise function with different values to get entirely different fields from the same parameters

### Curl Noise

- Divergence-free field (particles never converge or diverge, just flow side by side)
- Computed from the curl of a scalar noise field
- `vx = (noise(x, y + eps) - noise(x, y - eps)) / (2 * eps)`
- `vy = -(noise(x + eps, y) - noise(x - eps, y)) / (2 * eps)`
- Produces incompressible fluid-like motion -- excellent for smoke, water, and fabric effects
- Because the field is divergence-free, paths maintain even spacing naturally, reducing the need for aggressive separation distance checks
- The `eps` parameter controls the finite difference resolution; smaller values give sharper features

### Analytical Fields

- Circular: `angle = atan2(y - cy, x - cx) + PI/2` (tangent to circles centered at (cx, cy))
- Radial: `angle = atan2(y - cy, x - cx)` (pointing outward from center)
- Sink/source: combine radial + rotation with falloff
- Dipole: two opposing sources create saddle-point topology
- Gravity wells: `angle = atan2(y - cy, x - cx)`, strength falls off with `1/r^2`
- Custom: compose multiple singularities with weighted blending

Analytical fields are useful when you want precise geometric control. They can be combined with noise fields via blending: `angle = lerp(analyticalAngle, noiseAngle, blendFactor)`.

### Image-Derived Fields

- Compute gradient of brightness at each pixel to get a direction field
- Edge tangent field: run edge detection, then use the tangent to each edge as the field direction
- Structure tensor approach: compute local orientation from image gradients for smoother fields
- Useful for "painterly" rendering of photographs -- lines follow contours and texture
- Typically requires preprocessing the image into a lookup grid

## Parameters

| Parameter | Effect | Typical Range |
|-----------|--------|---------------|
| `noiseScale` | Wavelength of field variation | 0.001 - 0.01 |
| `stepLength` | Distance per integration step | 1 - 5 px |
| `maxSteps` | Maximum path length in steps | 50 - 500 |
| `seedSpacing` | Distance between seed points on initial grid | 5 - 20 px |
| `minDistance` | Minimum separation between paths | 2 - 10 px |
| `noiseOctaves` | Fractal detail layers | 1 - 4 |
| `noiseSeed` | Random seed for noise field | any integer |

### Parameter Interactions

- `stepLength` and `maxSteps` together determine maximum line length (`stepLength * maxSteps`)
- Smaller `stepLength` gives smoother curves but costs more computation
- `seedSpacing` should generally be >= `minDistance` to avoid immediate termination
- Higher `noiseScale` with more octaves creates turbulent, chaotic flows
- Lower `noiseScale` with one octave creates smooth, laminar flows

## Separation Distance

The key to beautiful flow fields -- enforce minimum distance between all paths:

1. Maintain a spatial grid of "occupied" cells (a 2D array where each cell covers `minDistance` units)
2. Before placing a new point, check the cell and its neighbors for any existing path points
3. If any existing point is closer than `minDistance`, terminate the current path
4. After placing a point, mark its cell as occupied

This creates even density without overlap -- the signature look of polished flow field art.

### Implementation Details

The spatial grid acts as a spatial hash for O(1) proximity lookups:

```
gridSize = ceil(canvasWidth / minDistance) x ceil(canvasHeight / minDistance)
cellX = floor(x / minDistance)
cellY = floor(y / minDistance)

// Check 3x3 neighborhood
for dx in -1..1:
    for dy in -1..1:
        for point in grid[cellX + dx][cellY + dy]:
            if distance(point, (x, y)) < minDistance:
                return TOO_CLOSE
```

### Ordering Strategy

Process seeds in random order rather than left-to-right, top-to-bottom. Sequential ordering creates visible sweep artifacts where later lines are systematically shorter. Randomized order distributes line lengths more evenly.

## Multi-Scale Fields

- Layer multiple noise fields at different scales for fractal structure
- Low-frequency noise for overall flow direction, high-frequency for local turbulence
- Blend with weighted sum: `angle = 0.7 * noise(x * 0.003) + 0.3 * noise(x * 0.02)`
- Can also blend between entirely different field types (noise + analytical)
- Smooth interpolation between fields using `smoothstep` or cosine interpolation

### Domain Warping

A powerful extension: use one noise field to warp the input coordinates of another:

```
wx = x + amplitude * noise(x * scale1, y * scale1)
wy = y + amplitude * noise(x * scale1 + 100, y * scale1 + 100)
angle = noise(wx * scale2, wy * scale2) * 2 * PI
```

Domain warping creates swirling, folded patterns that look like geological strata or ink in water.

## Variations

### Bidirectional Tracing
Trace both forward AND backward from each seed point. This doubles path length on average and eliminates the directional bias that makes all lines appear to "start" from the same region. Simply negate the field direction for the backward pass.

### Variable Line Weight
- Thicker lines where flow velocity is lower or curvature is higher
- Map curvature to stroke-width for emphasis on turning points
- For plotters: simulate weight by drawing parallel offset lines (2-3 passes for "bold")

### Density-Modulated Seeding
- Place more seed points in darker regions of a source image
- Map pixel brightness to local seed probability
- Creates tonal reproduction through line density alone -- ideal for portrait rendering

### Bounded Regions
- Confine flow to shapes: circle, polygon, text outlines
- Use signed distance fields for smooth boundary testing
- Lines can terminate at boundaries or wrap (periodic boundaries)
- Boolean operations: flow inside one shape but outside another

### Time-Varying Fields
- Add a time dimension to noise: `angle = noise3D(x * scale, y * scale, t)`
- Each "frame" produces a different flow field -- useful for animation
- For static plots, the time parameter acts as an additional creative control

### Streamline Density Control
- Vary `minDistance` spatially across the canvas
- Tighter spacing in areas of interest, wider in background
- Can be driven by an image brightness map or analytical function

## Composition Ideas for Hatch3d

### Surface Flow Fields
Instead of regular UV-space hatching, use noise-driven flow on the parametric surface itself. Evaluate the noise field in UV space, but step along the actual surface, producing lines that follow organic flow across 3D form while respecting surface curvature.

### Flow-Hatched Surfaces
Replace the regular parallel hatch lines in `hatch.ts` with flow-field traces. The UV-space grid of seed points feeds into a 2D flow field, and the resulting curved paths are mapped through the surface function. This creates hatching that suggests material texture (wood grain, brushed metal, turbulent fluid).

### Atmospheric Flow
Add a background flow field layer behind 3D compositions. The flow field lives in 2D screen space and provides atmospheric context -- wind, water, or abstract texture -- while the foreground shows solid hatched geometry.

### Vortex Compositions
Place analytical singularity points (vortices, sinks, sources) around surface forms to create complex flow topology. The singularities interact with each other to produce saddle points and separatrices -- natural focal points in the composition.

### 3D Flow Projection
Compute a flow field in 3D space (using 3D noise), trace particles through it, then project the resulting 3D paths to 2D using the same camera as the surface rendering. This creates volumetric flow effects that can interact with surfaces via depth-buffer occlusion.

### Hybrid Hatch + Flow
Use regular hatching on surfaces and flow fields in the spaces between them. The contrast between ordered geometric hatching and organic flow emphasizes the form of the 3D objects.

## Performance Considerations

- Field evaluation is the bottleneck -- cache noise values in a lookup grid for large canvases
- Spatial hash grid for separation checking keeps path generation O(n) rather than O(n^2)
- Path tracing is embarrassingly parallel -- each seed is independent (except for separation checking)
- For interactive use, generate at lower resolution first, then refine
- Typical plotter-resolution output (A3 at 0.3mm line spacing) may produce 10,000+ paths

## Key Artists

- **Tyler Hobbs** -- "Fidenza" series, one of the most influential flow field works in generative art; explores color palette and density variation within noise-driven flows
- **Anders Hoff (inconvergent)** -- Flow-based generative systems, extensive writing on algorithms and process; "Sand Spline" and related work
- **Matt DesLauriers** -- Penplot toolkit with flow examples, detailed blog posts on plotter workflow
- **Manolo Gamboa Naon** -- Dense, colorful flow compositions with strong graphic design sensibility
- **Licia He** -- Plotter-first flow field work with emphasis on ink and paper materiality

## References

- Tyler Hobbs, "Flow Fields" essay -- detailed walkthrough of the technique with visual examples
- Daniel Shiffman, "The Nature of Code" -- foundational creative coding text covering vector fields and particle systems
- Bridson, "Fast Poisson Disk Sampling" -- the underlying technique behind separation distance enforcement
- Ken Perlin, "Improving Noise" (2002) -- the noise function most flow fields are built on
- Robert Bridson et al., "Curl-Noise for Procedural Fluid Flow" (SIGGRAPH 2007) -- curl noise technique for divergence-free fields
