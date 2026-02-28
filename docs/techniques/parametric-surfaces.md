# Parametric Surfaces

The core technique of hatch3d — defining 3D surfaces as functions of two parameters (u, v) and rendering them with hatch lines. This document covers the mathematical landscape beyond what's currently implemented.

## Currently in Hatch3d
5 surfaces: Twisted Ribbon, Hyperboloid, Angular Canopy, Flat Torus, Conoid.

## Surface Families Worth Adding

### Minimal Surfaces
Surfaces that minimize area for given boundary conditions. Elegant, organic, architectural.

**Enneper Surface**:
```
x = u - u^3/3 + u*v^2
y = v - v^3/3 + v*u^2
z = u^2 - v^2
```

**Costa Surface**: Famous minimal surface with three punctures. Complex to parameterize but visually stunning.

**Scherk Surface**:
```
z = ln(cos(y) / cos(x))
```
Periodic, saddle-like. Good for tiling compositions.

### Classical Surfaces

**Klein Bottle** (immersed in 3D):
```
x = (a + cos(v/2)*sin(u) - sin(v/2)*sin(2*u)) * cos(v)
y = (a + cos(v/2)*sin(u) - sin(v/2)*sin(2*u)) * sin(v)
z = sin(v/2)*sin(u) + cos(v/2)*sin(2*u)
```
Self-intersecting — interesting occlusion challenge.

**Mobius Strip**:
```
x = (1 + v/2 * cos(u/2)) * cos(u)
y = (1 + v/2 * cos(u/2)) * sin(u)
z = v/2 * sin(u/2)
```

**Boy's Surface**: Non-orientable surface immersed in 3D. Complex and visually intriguing.

### Seashell Surfaces
```
x = (1 + v*cos(n*u/2)) * cos(n*u/2) * (1 + exp(b*u))
y = (1 + v*cos(n*u/2)) * sin(n*u/2) * (1 + exp(b*u))
z = v*sin(n*u/2) * (1 + exp(b*u)) + c*exp(b*u)
```
Logarithmic spiral growth — produces realistic shell forms.

### Superquadrics
Generalized ellipsoids with exponent parameters:
```
x = a * sign(cos(v)) * |cos(v)|^n1 * sign(cos(u)) * |cos(u)|^n2
y = b * sign(cos(v)) * |cos(v)|^n1 * sign(sin(u)) * |sin(u)|^n2
z = c * sign(sin(v)) * |sin(v)|^n1
```
n1=n2=1 gives sphere, n1=n2=0.1 gives cube, n1=n2=2 gives astroid.

### Developable Surfaces
Surfaces with zero Gaussian curvature — can be unrolled flat. Cones, cylinders, tangent surfaces. Interesting because hatch lines maintain consistent spacing when unrolled.

## Warp Functions
Apply to any surface for variation:

### Sine Warp
```
x' = x + amp * sin(y * freq)
y' = y + amp * sin(z * freq)
```

### Twist
```
angle = z * twistRate
x' = x * cos(angle) - y * sin(angle)
y' = x * sin(angle) + y * cos(angle)
```

### Taper
```
scale = 1 - abs(z) * taperRate
x' = x * scale
y' = y * scale
```

### Noise Displacement
```
normal = surfaceNormal(u, v)
offset = noise3D(x * scale, y * scale, z * scale) * strength
position += normal * offset
```
Adds organic texture to any mathematical surface.

## UV Mapping Strategies
How UV parameters map to surface position affects hatch line quality:

- **Uniform**: Equal parameter steps = equal surface distance (ideal but rare)
- **Arc-length parameterization**: Reparameterize so that equal parameter steps = equal arc length
- **Adaptive**: More samples where curvature is high

## Composition Ideas
- **Minimal surface gallery**: Enneper, Scherk, Costa-like surfaces with clean hatching
- **Shell collection**: Multiple seashell surfaces at different growth parameters
- **Superquadric morphing**: Series of prints interpolating between sphere/cube/star
- **Klein bottle study**: Non-orientable surface with careful occlusion
- **Noise-displaced surfaces**: Familiar forms (torus, sphere) with organic noise perturbation
- **Developable surface series**: Cones and cylinders that could theoretically be cut from flat paper

## References
- Alfred Gray, "Modern Differential Geometry of Curves and Surfaces" (1997)
- Paul Bourke — extensive parametric surface gallery
- Mathworld — Weisstein's surface catalog
