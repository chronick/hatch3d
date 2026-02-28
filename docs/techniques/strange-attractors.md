# Strange Attractors

Chaotic dynamical systems that produce infinitely complex, never-repeating trajectories. The output is a single long continuous path — ideal for pen plotters.

## What It Is
A set of differential equations whose solutions trace fractal-like paths through space. Small parameter changes produce dramatically different forms. The path never exactly repeats but stays bounded in a region.

## Classic Systems

### Lorenz Attractor (Butterfly)
```
dx/dt = sigma * (y - x)
dy/dt = x * (rho - z) - y
dz/dt = x * y - beta * z
```
Parameters: sigma=10, rho=28, beta=8/3. The iconic butterfly shape.

### Aizawa Attractor (Torus with Detail)
```
dx/dt = (z - b)*x - d*y
dy/dt = d*x + (z - b)*y
dz/dt = c + a*z - z^3/3 - (x^2 + y^2)*(1 + e*z) + f*z*x^3
```
Parameters: a=0.95, b=0.7, c=0.6, d=3.5, e=0.25, f=0.1

### Halvorsen Attractor (Three-lobed Symmetric)
```
dx/dt = -a*x - 4*y - 4*z - y^2
dy/dt = -a*y - 4*z - 4*x - z^2
dz/dt = -a*z - 4*x - 4*y - x^2
```
Parameter: a=1.89

### Thomas Attractor (Smooth Loops)
```
dx/dt = sin(y) - b*x
dy/dt = sin(z) - b*y
dz/dt = sin(x) - b*z
```
Parameter: b=0.208186. Elegant, slow-moving loops.

### Sprott Attractors
Family of minimal chaotic systems (A through S) with few terms. Good for parameter exploration — small equations, diverse output.

### Clifford Attractor (2D)
```
x_next = sin(a*y) + c*cos(a*x)
y_next = sin(b*x) + d*cos(b*y)
```
Parameters: a=-1.4, b=1.6, c=1.0, d=0.7. Purely 2D — no projection needed.

### De Jong Attractor (2D)
```
x_next = sin(a*y) - cos(b*x)
y_next = sin(c*x) - cos(d*y)
```

## Integration Methods

### Euler (Simple, Fast)
```
x += dx/dt * dt
y += dy/dt * dt
z += dz/dt * dt
```
Use small dt (0.001-0.01). Accumulates error over many steps.

### Runge-Kutta 4th Order (Accurate)
More computationally expensive but much more stable for long trajectories. Recommended for high-quality output.

## 3D to 2D Projection
Simple Y-axis rotation for 3D attractors:
```
px = x * cos(angle) - z * sin(angle)
py = y
```
Or use perspective projection for depth.

## Plotter Considerations
- Attractors generate one very long continuous path — minimal pen lifts
- High iteration counts (100k-1M points) create dense overlapping regions
- Line density naturally communicates the attractor's structure
- May need to subsample or simplify for plotter speed
- Multiple shorter trajectories from different starting points can be more plotter-friendly

## Variations
- **Multi-trajectory**: Launch from several initial conditions, get multiple overlapping paths
- **Parameter animation**: Slowly vary a parameter across a series of prints (edition of evolution)
- **Projection angle sweep**: Same attractor, different viewing angles
- **Color-coded layers**: Segment path into layers (by z-depth, time, or velocity) for multi-pen plotting
- **Attractor blending**: Interpolate between two attractor systems

## Composition Ideas for Hatch3d
- **Attractor as surface texture**: Project attractor path onto parametric surface UV space
- **Attractor spine**: Use attractor trajectory as the path along which surfaces are placed
- **Chaotic hatch fill**: Replace regular hatching with short attractor segments seeded across surface
- **Background layer**: Full attractor behind surface composition for contrast (geometric surface + chaotic background)
- **Attractor-shaped surfaces**: Use attractor path to define the control points of a parametric surface

## References
- Edward Lorenz, "Deterministic Nonperiodic Flow" (1963)
- Sprott, "Strange Attractors: Creating Patterns in Chaos"
- Paul Bourke's attractor gallery
