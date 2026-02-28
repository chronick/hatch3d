# Op Art (Optical Art)

Art that exploits optical illusions through precise geometric patterns. Line-based op art maps perfectly to plotter output — creating the illusion of movement, depth, and vibration through static marks.

## Key Techniques

### Warped Grid
A regular grid with a mathematical distortion function:
```
for each grid point (u, v):
  x = u + warpX(u, v)
  y = v + warpY(u, v)
```
Warp functions: sine waves, radial bulge, noise, gravitational pull toward a point.

The regularity of the grid makes the distortion dramatically visible. The viewer perceives a flat surface being pushed or pulled.

### Line Frequency Modulation
Parallel lines with varying spacing create illusion of curvature:
- Lines converging = surface receding
- Lines diverging = surface advancing
- Sinusoidal spacing variation = undulating surface

### Bridget Riley Stripes
Parallel stripes with subtle width or spacing variation:
- Constant width + varying spacing = gentle movement
- Varying width + constant spacing = pulsing/breathing
- Both varying = complex optical vibration
- Black and white stripes of equal width create maximum visual energy

### Vasarely Spheres
Concentric shapes (circles, squares) with progressive distortion to imply spherical form:
```
for i in 0..numRings:
  radius = i * baseSpacing
  // Distort to project onto sphere surface
  projected_r = R * sin(acos(1 - radius/R))
  draw_circle(center, projected_r)
```

### Checkerboard Distortion
Regular checkerboard with bulge/warp:
- Each checker cell drawn as lines (for plotter)
- Alternating dense/sparse hatching instead of black/white
- Distortion creates sphere/wave illusion

### Radial Interference
Concentric elements with a displaced second set:
- Two sets of concentric circles, offset centers
- Creates lens/magnification illusion
- This is essentially a moire technique applied to op art

## Design Principles
1. **Precision is everything**: Even tiny irregularities break the illusion — plotters excel here
2. **Contrast drives effect**: Maximum effect from maximum contrast (dense vs. sparse, curved vs. straight)
3. **Viewer distance matters**: Designed for specific viewing distances where lines merge/separate
4. **Less is more**: Single distortion is stronger than multiple competing effects
5. **Rhythm and repetition**: The pattern must be regular enough for the eye to track, irregular enough to create illusion

## Key Parameters
| Parameter | Effect |
|-----------|--------|
| `lineCount` | Number of elements (more = finer grain, more precise illusion) |
| `warpStrength` | Magnitude of distortion |
| `warpCenter` | Focal point of distortion |
| `warpFunction` | Type of deformation (spherical, cylindrical, wave) |

## Historical Artists
- **Bridget Riley**: Stripes, waves, color vibration. Master of minimal means, maximum effect.
- **Victor Vasarely**: Father of Op Art. Geometric illusions, planetary forms.
- **Jesus Rafael Soto**: Kinetic/optical sculptures and paintings.
- **Carlos Cruz-Diez**: Color-based optical effects.

## Composition Ideas for Hatch3d
- **Op art surface**: Parametric surface with op-art-inspired hatching (variable spacing creates depth illusion independent of 3D projection)
- **Vasarely composition**: Multiple surfaces arranged to create op art illusion — the 3D form reinforced by the hatching pattern
- **Warped grid background**: Op art grid behind clean geometric surfaces
- **Riley-inspired series**: Stripe-based compositions with minimal variation (edition series)
- **Double illusion**: 3D surface creates real depth; op art hatching creates false depth — visual tension

## References
- Bridget Riley, "The Eye's Mind" (collected writings)
- Victor Vasarely, "Plasti-Cite" (1970)
- William Seitz, "The Responsive Eye" (1965 MoMA exhibition)
