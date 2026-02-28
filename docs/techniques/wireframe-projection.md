# Wireframe Projection & Hidden-Line Removal

Rendering 3D geometry as line drawings with proper visibility. The core rendering pipeline of hatch3d.

## Projection Types

### Orthographic
Parallel projection — no perspective foreshortening:
```
screenX = worldX * scale + offsetX
screenY = worldZ * scale + offsetY  (or worldY, depending on convention)
```
Clean, technical look. Good for architectural/engineering drawings.

### Perspective
Objects appear smaller with distance:
```
screenX = focalLength * worldX / worldZ
screenY = focalLength * worldY / worldZ
```
Natural, photographic look. Hatch3d uses Three.js camera for this.

### Axonometric (Isometric, Dimetric, Trimetric)
Parallel projection at specific angles. Isometric: equal foreshortening on all three axes. Popular in technical illustration and video games.

### Oblique (Cabinet, Cavalier)
Front face shown true-size, depth axis at an angle. Simple to construct manually.

## Hidden-Line Removal Methods

### Depth Buffer (What Hatch3d Uses)
1. Render surfaces to a depth buffer (WebGL)
2. For each hatch line point, sample depth buffer
3. If point's depth > buffer value + epsilon, it's hidden — clip it
4. Connect remaining visible segments

Advantages: handles any geometry, GPU-accelerated
Disadvantages: resolution-limited, requires WebGL context

### Painter's Algorithm
Sort surfaces far-to-near, draw in order. Near surfaces naturally occlude far ones.
- Simple for non-intersecting surfaces
- Fails for intersecting or cyclically overlapping geometry

### Ray Casting
For each line segment, test against all surfaces for intersection. Precise but slow.

### Analytical (BSP Trees)
Binary space partition for exact visibility computation. Complex to implement but resolution-independent.

### vpype occult
Post-process SVG: closed paths treated as opaque, lines behind them are clipped. Simple but limited to 2D stacking order.

## Line Types in Technical Drawing

### Visible Lines
Primary outlines — drawn solid, full weight.

### Hidden Lines
Lines behind surfaces — traditionally drawn dashed. On plotter: skip hidden segments or draw with lighter pen / dashed pattern.

### Silhouette Lines
Boundary between visible and hidden surface regions. Often the strongest visual element.

### Section Lines
Hatching within cut surfaces — indicates material.

### Construction Lines
Light guide lines — thin weight or not drawn in final output.

## Composition Ideas
- **Exploded view**: Surfaces separated along axis to show hidden structure
- **X-ray mode**: All lines visible but hidden lines dashed — technical illustration aesthetic
- **Section cut**: Clip composition with a plane, hatch the cut surface
- **Multi-view**: Orthographic projections from front/side/top arranged together (engineering drawing style)
- **Depth-coded line weight**: Lines thicker in foreground, thinner in background (aerial perspective)

## References
- Ivan Sutherland, "Sketchpad" (1963) — foundational hidden-line work
- Appel's algorithm (1967) — quantitative invisibility
- Roberts (1963) — first practical hidden-line algorithm
