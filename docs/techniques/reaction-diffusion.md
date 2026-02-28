# Reaction-Diffusion

## What It Is
Simulation of two interacting chemicals (activator/inhibitor) that diffuse and react, producing organic patterns: spots, stripes, mazes, waves. Based on Alan Turing's 1952 paper "The Chemical Basis of Morphogenesis."

## Gray-Scott Model
The standard model for generative art. Two chemicals U (substrate) and V (catalyst):

```
dU/dt = Du * laplacian(U) - U*V^2 + f*(1-U)
dV/dt = Dv * laplacian(V) + U*V^2 - (k+f)*V
```

### Parameters
| Parameter | Meaning | Typical Value |
|-----------|---------|---------------|
| `Du` | Diffusion rate of U | 0.16 - 0.21 |
| `Dv` | Diffusion rate of V | 0.08 - 0.12 |
| `f` | Feed rate (replenish U) | 0.01 - 0.08 |
| `k` | Kill rate (remove V) | 0.04 - 0.07 |

### Pattern Map (f, k values)
| f | k | Pattern |
|---|---|---------|
| 0.035 | 0.065 | Spots (mitosis) |
| 0.042 | 0.063 | Stripes/worms |
| 0.025 | 0.055 | Maze/labyrinth |
| 0.039 | 0.058 | Holes (negative spots) |
| 0.026 | 0.051 | Pulsing waves |
| 0.014 | 0.054 | Moving spots |
| 0.018 | 0.051 | Branching coral |

## Implementation
1. Initialize two 2D grids (U=1.0 everywhere, V=0.0 with seed spots)
2. Each timestep: compute Laplacian via discrete 4-neighbor stencil
3. Apply update equations
4. Repeat 1000-10000 iterations
5. Convert scalar field to vector output

### Discrete Laplacian
```
L(x,y) = grid[x+1][y] + grid[x-1][y] + grid[x][y+1] + grid[x][y-1] - 4*grid[x][y]
```

Or use the 9-point stencil for smoother results:
```
L = 0.05*nw + 0.2*n + 0.05*ne + 0.2*w - 1.0*c + 0.2*e + 0.05*sw + 0.2*s + 0.05*se
```

## Vectorization for Plotter
The output is a scalar field -- must be converted to lines:
1. **Contour extraction**: Marching squares at threshold values -> isolines
2. **Threshold + boundary trace**: Binary threshold, then trace boundaries
3. **Stippling**: Map V concentration to dot density
4. **Flow field overlay**: Use gradient of V as a flow field, trace streamlines

## Variations
- **Spatially varying parameters**: f and k change across the grid -> different patterns in different regions
- **Anisotropic diffusion**: Diffusion rates vary by direction -> stretched/oriented patterns
- **Multi-species**: 3+ chemicals for more complex interactions
- **On surfaces**: Run simulation on UV parameterization of a 3D surface

## Performance Notes
- Compute-heavy (thousands of iterations over large grids)
- GPU acceleration via WebGL compute or WASM highly beneficial
- Can pre-compute and cache results
- Grid resolution 256x256 is workable, 512x512 is better, 1024x1024 is ideal

## Composition Ideas for Hatch3d
- **Turing surface texture**: Run RD on UV space of parametric surface, use resulting pattern to modulate hatch density
- **Organic boundary composition**: RD-generated pattern defines regions; different surfaces/hatching in each region
- **Living surface**: Contour lines of RD simulation mapped onto 3D surface as replacement for regular hatching
- **Maze composition**: Use maze-pattern RD output as the layout for a multi-surface arrangement

## References
- Alan Turing, "The Chemical Basis of Morphogenesis" (1952)
- Karl Sims, reaction-diffusion tutorial
- Robert Munafo's Gray-Scott parameter space explorer
