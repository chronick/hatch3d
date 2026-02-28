# Lissajous Curves & Harmonographs

Compound harmonic motion producing elegant, continuous curves. Already partially implemented in hatch3d as a 2D composition.

## Lissajous Curves
Parametric curves from two sinusoidal oscillations:
```
x(t) = A * sin(a*t + delta)
y(t) = B * sin(b*t)
```

### Key Parameters
| Parameter | Effect |
|-----------|--------|
| `a`, `b` | Frequency ratio — determines curve topology |
| `delta` | Phase offset — rotates/transforms the figure |
| `A`, `B` | Amplitude — scales in each axis |

### Frequency Ratios
| a:b | Shape |
|-----|-------|
| 1:1 | Ellipse/circle |
| 1:2 | Figure-8 |
| 2:3 | Trefoil-like |
| 3:4 | Complex knot |
| Irrational | Never-closing, fills region |

## Harmonographs
Physical pendulum machines that draw Lissajous-like curves with natural damping:
```
x(t) = A1*sin(f1*t + p1)*exp(-d1*t) + A2*sin(f2*t + p2)*exp(-d2*t)
y(t) = A3*sin(f3*t + p3)*exp(-d3*t) + A4*sin(f4*t + p4)*exp(-d4*t)
```

The exponential decay creates spiraling inward — the line thins toward the center as the "pendulum" loses energy. Produces more complex, organic curves than pure Lissajous.

### Rotary Harmonograph
Add a rotating table beneath the pen:
```
x_rot = x*cos(w*t) - y*sin(w*t)
y_rot = x*sin(w*t) + y*cos(w*t)
```

## 3D Lissajous
Extend to three axes:
```
x(t) = sin(a*t + delta_x)
y(t) = sin(b*t + delta_y)
z(t) = sin(c*t + delta_z)
```
Project to 2D. Creates knot-like forms that look like wire sculptures.

## Layered Lissajous
Stack multiple curves with phase shifts:
```
for i in 0..numLayers:
  delta = basePhase + i * phaseStep
  draw lissajous(a, b, delta)
```
Creates interference-like patterns. Already in hatch3d's Lissajous composition.

## Variations
- **Damped**: Exponential decay for harmonograph-style spiral-in
- **Modulated frequency**: Slowly vary a/b over time for morphing shapes
- **Noise-perturbed**: Add Perlin noise to amplitude for organic imperfection
- **Thick Lissajous**: Draw multiple offset parallel Lissajous for variable stroke width
- **Lissajous fill**: Many curves with incrementally shifted parameters fill a region

## Composition Ideas for Hatch3d
- **Lissajous surface**: Use Lissajous parameters to define a parametric surface (tube along Lissajous path)
- **Harmonograph hatch**: Replace standard hatching with damped harmonograph curves on surface
- **3D Lissajous wireframe**: 3D Lissajous knot with hidden-line removal
- **Lissajous frame**: Decorative Lissajous border surrounding 3D composition
- **Morphing series**: Edition of prints with slowly changing frequency ratio

## References
- Nathaniel Bowditch (1815) — first study of these curves
- Jules Antoine Lissajous (1857) — systematic analysis
- Karl Sims — harmonograph simulations
