# Layering & Density Control

Strategies for multi-pass plotting, ink density management, and visual hierarchy through layered line work.

## Multi-Pass Plotting

### Same-Pen Layering
Multiple hatch families drawn sequentially with the same pen:
- Each pass adds density/darkness
- Cross-hatching is inherently multi-pass (each angle is a pass)
- Order matters: first pass sets the foundation, subsequent passes add texture

### Multi-Pen Layering
Different pens (color, width, type) for different elements:
- **Thick pen**: Major contours, silhouettes, foreground
- **Thin pen**: Fine hatching, background detail, textures
- **Color 1**: Primary surfaces
- **Color 2**: Secondary surfaces or shadows

### Registration
When using multiple pens, alignment between passes is critical:
- Home position must be consistent
- Paper must not shift between passes
- SVG layers map to pen passes — design with this in mind

## Density Control Strategies

### Hierarchy Through Density
Visual importance communicated by ink density:
- **Focal surface**: Dense hatching (dark)
- **Supporting surfaces**: Medium hatching
- **Background elements**: Sparse hatching or outlines only
- **Empty space**: Strategic void

### Depth Through Density
Atmospheric perspective via line density:
```
density_multiplier = 1.0 - (depth / maxDepth) * fadeAmount
hatchCount = baseCount * density_multiplier
```
Near objects are dense (dark), far objects are sparse (light).

### Light-Based Density
Surface brightness from lighting model:
```
brightness = dot(surfaceNormal, lightDirection)
hatchSpacing = minSpacing + brightness * (maxSpacing - minSpacing)
```

### Curvature-Based Density
More lines where surface curves sharply:
```
curvature = estimateCurvature(surface, u, v)
hatchCount = baseCount + curvature * curvatureBoost
```

## Visual Weight

### Line Weight Hierarchy
Even with single pen width, visual weight varies through:
- **Density**: More lines = heavier
- **Length**: Longer lines = heavier than short dashes
- **Direction**: Lines aligned with gravity feel heavier
- **Contrast**: Dense areas next to empty space feel heaviest

### Grouping
The eye groups nearby lines. Hatch groups (already in hatch3d) naturally create visual grouping. Use spacing between groups to create visual separation.

## Multi-Layer Composition Structure

### Three-Layer Standard
1. **Background**: Sparse, low-detail (flow field, simple grid, or empty)
2. **Midground**: Medium detail, supporting forms
3. **Foreground**: Dense, focal surfaces with full hatching

### Figure-Ground Relationship
The most important compositional relationship:
- Clear separation between subject and background
- Can be achieved through density contrast alone
- Negative space (undrawn background) is the simplest figure-ground separation

## Plotter Considerations
- Total ink density affects dry time (dense areas need longer between passes)
- Very dense hatching can saturate paper (especially with water-based markers)
- Pen choice (ballpoint vs. felt tip vs. fountain) affects how layers interact
- Plotting speed affects line quality — slower = more consistent

## Composition Ideas for Hatch3d
1. **Depth-faded compositions**: Automatic density reduction for distant surfaces
2. **Spotlight effect**: One surface densely hatched (lit), others sparse (ambient)
3. **Layer-separated export**: Output each hatch group as separate SVG for multi-pen plotting
4. **Progressive reveal**: Series of prints adding one hatch layer at a time (process documentation)
5. **Density-mapped macros**: Single "atmosphere" macro controls density falloff with depth
