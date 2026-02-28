# Halftone Techniques

Converting continuous-tone images to plottable line/dot patterns. The plotter equivalent of newspaper print reproduction.

## Classic Dot Halftone
Regular grid where dot size represents brightness:
```
for each grid cell (i, j):
  brightness = sampleImage(i * cellSize, j * cellSize)
  radius = (1 - brightness) * maxRadius
  draw_circle(i * cellSize, j * cellSize, radius)
```

## Line-Based Halftone (Best for Plotters)

### Sine Wave Amplitude
Horizontal lines where wave amplitude encodes brightness:
```
for each row y:
  for each sample x:
    brightness = image(x, y)
    amplitude = (1 - brightness) * maxAmplitude
    plotY = y + amplitude * sin(x * frequency)
  draw_polyline(samples)
```
Dark areas = large waves, light areas = flat lines.

### Zigzag/Sawtooth
Similar to sine but with sharp angles. More aggressive, mechanical aesthetic.

### Density Lines
Parallel lines with varying spacing:
```
currentY = 0
while currentY < height:
  brightness = averageBrightness(currentY)
  spacing = minSpacing + brightness * (maxSpacing - minSpacing)
  draw_horizontal_line(currentY)
  currentY += spacing
```

## Spiral Halftone
Single spiral from center outward with amplitude modulation:
```
for t in 0..maxT:
  r = a * t  // Archimedean spiral radius
  angle = t
  brightness = sampleImage(r * cos(angle), r * sin(angle))
  amplitude = (1 - brightness) * maxAmp
  x = (r + amplitude * sin(r * freq)) * cos(angle)
  y = (r + amplitude * sin(r * freq)) * sin(angle)
```
Single continuous path — ideal for plotters.

## Concentric Circle Halftone
Concentric circles with radius modulation by brightness. Similar to spiral but discrete circles.

## Cross-Hatch Halftone
Multiple angle passes, each active only in sufficiently dark regions:
```
for angle in [0, 45, 90, 135]:
  for each line at this angle:
    for each point on line:
      brightness = sampleImage(point)
      if brightness < threshold_for_this_angle:
        draw point
```

## Parameters
| Parameter | Effect |
|-----------|--------|
| `resolution` | Grid/line density (higher = finer detail) |
| `amplitude` | Maximum wave height (line halftone) |
| `frequency` | Wave frequency (line halftone) |
| `minSize/maxSize` | Dot size range |
| `angle` | Rotation of halftone grid |
| `contrast` | Input level adjustment |

## Plotter Considerations
- Line-based halftones are much faster to plot than dot-based (fewer pen lifts)
- Spiral halftone is a single continuous path — fastest possible
- Fine detail limited by pen nib width
- Preview at actual pen width to check tonal range

## Composition Ideas for Hatch3d
- **Photo-to-surface**: Image halftone mapped onto parametric surface UV space
- **Halftone shadow**: Compute shadow/lighting on 3D surface, render shadow as halftone
- **Mixed media**: Geometric hatching on lit surfaces, halftone in shadow regions
- **Portrait surface**: Face photo halftoned onto torus or sphere surface
- **Spiral halftone background**: Image rendered as single spiral behind geometric composition

## References
- Ostromoukhov, "Artistic Halftoning" (1999)
- Inglis & Kaplan, "Op Art rendering" (2012)
- SquiggleDraw — open source amplitude modulation tool
