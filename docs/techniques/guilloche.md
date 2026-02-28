# Guilloche Patterns

Intricate, repetitive patterns originally produced by mechanical lathes for security engraving (banknotes, certificates). Composed of overlapping sinusoidal curves with complex phase relationships.

## What It Is
Guilloche patterns are created by a pen/graver tracing a path while two or more rotating gears control its position. Mathematically, they're compound parametric curves — similar to spirographs but with more parameters and layering.

## Basic Guilloche Curve
```
r(t) = R + A * sin(n * t + phase)
x(t) = r(t) * cos(t)
y(t) = r(t) * sin(t)
```
Where R = base radius, A = modulation amplitude, n = number of lobes.

## Multi-Layer Guilloche
The signature look comes from overlapping two or more curves with slight parameter variation:
```
for i in 0..numLines:
  phase_i = i * phaseStep
  draw curve with (R, A, n, phase_i)
```
The interference between layers creates the shimmering, moire-like effect.

## Rosette Pattern
Classic banknote element — multiple guilloche rings nested concentrically:
```
for ring in 0..numRings:
  R_ring = innerR + ring * ringSpacing
  for line in 0..linesPerRing:
    draw guilloche(R_ring, A, n, line * phaseStep)
```

## Envelope Patterns
Two boundary curves with connecting lines that follow them:
```
top(t) = baseY + A_top * sin(freq_top * t + phase_top)
bot(t) = baseY - A_bot * sin(freq_bot * t + phase_bot)
for i in 0..numLines:
  blend = i / numLines
  y(t) = lerp(top(t), bot(t), blend)
```
Creates ribbon-like bands with internal wave structure.

## Parameters
| Parameter | Effect |
|-----------|--------|
| `baseRadius` | Overall size of circular pattern |
| `amplitude` | Depth of wave modulation |
| `lobes` | Number of wave cycles per revolution |
| `layers` | Number of overlapping curves |
| `phaseStep` | Phase offset between layers |
| `lineWeight` | Stroke width (thinner = more refined) |

## Security Features
Original purpose was anti-counterfeiting — patterns too precise and complex to replicate by hand. Key characteristics:
- Very fine, closely spaced lines
- Complex layering that creates moire if photocopied
- Precise mathematical relationships between elements

## Plotter Suitability
Excellent plotter technique because:
- Continuous paths — minimal pen lifts
- Mathematical precision that plotters handle perfectly
- Fine detail that hand-drawing can't achieve
- Impressive visual complexity from simple equations

## Variations
- **Open guilloche**: Linear (non-circular) wave patterns — good for borders/frames
- **Asymmetric**: Different wave parameters for inner vs. outer boundary
- **Noise-modulated**: Perlin noise added to amplitude or frequency for organic variation
- **Text-following**: Guilloche band that follows a text path or arbitrary curve
- **Color-layered**: Different pen colors per layer for full security-print aesthetic

## Composition Ideas for Hatch3d
- **Guilloche surface fill**: Replace standard hatching with guilloche wave patterns on surfaces
- **Rosette composition**: Central rosette with 3D surfaces emerging from or framing it
- **Guilloche border**: Decorative security-engraving frame around 3D surface art
- **Currency-style piece**: Surface rendered in the visual language of banknote engraving
- **Envelope hatch**: Two-boundary guilloche bands following surface contours

## References
- Rose engine lathe — the mechanical device that originally produced these patterns
- Abe Pacana — modern guilloche artist and tools
- Cycloid Drawing Machine — physical device for related patterns
