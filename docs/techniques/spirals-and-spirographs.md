# Spirals & Spirographs

Rotational curves ranging from simple spirals to complex epicycloid patterns. Already partially in hatch3d (spirograph 2D composition, spiral hatch family).

## Spiral Types

### Archimedean Spiral
Constant spacing between turns:
```
r = a + b*theta
x = r * cos(theta)
y = r * sin(theta)
```

### Fermat Spiral
Spacing decreases with radius (nature's spiral — sunflower seeds):
```
r = a * sqrt(theta)
```

### Logarithmic (Golden) Spiral
Self-similar, appears in shells:
```
r = a * exp(b * theta)
```

### Fibonacci/Phyllotaxis
Points distributed at golden angle (137.508deg):
```
for i in 0..N:
  angle = i * 137.508 * PI/180
  r = c * sqrt(i)
  point(r*cos(angle), r*sin(angle))
```
Creates natural-looking dot distributions.

## Spirograph Curves

### Hypotrochoid (Gear Inside Circle)
```
x = (R-r)*cos(t) + d*cos((R-r)/r * t)
y = (R-r)*sin(t) - d*sin((R-r)/r * t)
```
R = fixed circle radius, r = rolling circle radius, d = pen offset from rolling circle center.

### Epitrochoid (Gear Outside Circle)
```
x = (R+r)*cos(t) - d*cos((R+r)/r * t)
y = (R+r)*sin(t) - d*sin((R+r)/r * t)
```

### Key Parameters
| Parameter | Effect |
|-----------|--------|
| R/r ratio | Number of lobes (integer ratio = closed curve) |
| d/r ratio | Lobe depth (d=r: cusps touch center; d<r: rounded; d>r: loops) |
| Revolutions | How many times around before closing |

### Special Cases
- d = r: **Epicycloid/hypocycloid** (sharp cusps)
- R/r = integer: Closes after one revolution of the outer circle
- R/r = irrational: Never closes, fills annular region

## Multi-Arm Spirals
Multiple spirals rotated by 2*PI/arms:
```
for arm in 0..numArms:
  offset = arm * 2*PI / numArms
  draw spiral with theta_start = offset
```
Creates mandala-like forms.

## Spiral Hatching (Already in Hatch3d)
Using spiral paths as hatch lines on parametric surfaces. The spiral family generates multi-arm spirals in UV space.

## Variations
- **Variable-speed spiral**: Change radial growth rate to create spacing variation
- **Noise-perturbed spiral**: Add noise to radius for organic wobble
- **Square/polygon spirals**: Instead of circular, spiral with 90deg or 60deg turns
- **Spiral fill**: Dense spiral that fills a region (single continuous path)
- **Layered spirographs**: Multiple curves with offset parameters

## Composition Ideas for Hatch3d
- **Spiral surface**: Parametric surface defined by spiral cross-section
- **Spirograph mandala**: Centered spirograph with 3D surface elements radiating outward
- **Phyllotaxis distribution**: Place small surfaces at Fibonacci spiral positions
- **Spiral-wrapped surfaces**: Spiral path mapped onto surface of revolution
- **Golden ratio compositions**: Surface proportions and placements following phi

## References
- Spirograph toy (Denys Fisher, 1965)
- Phyllotaxis: Douady & Couder (1992)
- D'Arcy Thompson, "On Growth and Form" — spiral forms in nature
