# Hatching Techniques for Plotter Art

Hatching is the foundational technique for creating tonal variation with a pen plotter. Since a plotter draws with a single line width, all shading must be built from the arrangement, density, and direction of lines. This document covers the classical vocabulary, tonal control methods, form-following strategies, advanced techniques, and historical context -- serving as both a reference and an idea bank for hatch3d development.

---

## Classical Hatching Vocabulary

### Parallel Hatching

The simplest form: a series of evenly spaced parallel lines. Tone is controlled entirely by spacing -- closer lines produce darker areas, wider spacing produces lighter ones. In hatch3d, the `u` and `v` families produce parallel hatching along iso-parametric curves. The `diagonal` family produces straight parallel lines at an arbitrary angle through UV space.

Parallel hatching reads as flat and uniform. It is ideal for backgrounds, flat planes, and calm areas of a composition. Its regularity can be a strength (clean, mechanical, precise) or a weakness (lifeless, monotone) depending on context.

### Cross-Hatching

Two or more layers of parallel hatching at different angles, overlaid. The classic progression:

1. **Single layer at 45 degrees** -- light tone
2. **Add 135 degrees** (perpendicular to the first) -- medium tone
3. **Add 0 degrees** (horizontal) -- dark tone
4. **Add 90 degrees** (vertical) -- very dark tone

Each additional layer darkens the perceived tone. The angle relationships matter: perpendicular layers (90-degree separation) produce the cleanest grid intersections, while non-perpendicular angles create more visually interesting moire-like interference.

In hatch3d, the `crosshatch` family generates two perpendicular sets of diagonal lines. The `hex` family generates three sets at 60-degree intervals (0, 60, 120 degrees), producing a triangular grid that reads as a denser, more uniform tone than two-layer crosshatching.

### Contour Hatching

Lines that follow the three-dimensional form of the surface rather than remaining parallel in screen space. This is the most powerful hatching technique for implying volume and depth because the curvature of the lines themselves communicates shape information, even without shading.

On a sphere, contour hatching produces latitude or longitude lines. On a cylinder, it produces horizontal rings or vertical stripes. On a torus, it follows the characteristic saddle-shaped curves. On complex organic surfaces, contour lines follow the principal curvature directions of the surface.

This is what hatch3d does best. Because the tool evaluates parametric surface functions in UV space, the `u` and `v` hatch families naturally produce iso-parametric contour lines that follow the surface form. The `rings` and `spiral` families provide additional contour-following patterns centered in UV space.

### Stippling

Tonal rendering through dots rather than lines. Density of dots controls perceived darkness. Pure stippling is not line-based, so it maps differently to pen plotters -- each dot becomes either a tiny mark (pen down, pen up in the same spot) or a very short line segment.

Stippling produces extremely smooth tonal gradients and has no directional bias (unlike hatching, which always implies a direction). However, it is slow to plot because each dot requires a separate pen-down/pen-up cycle with no efficient continuous path.

Stippling is not currently implemented in hatch3d but could be approximated by generating very short line segments distributed across the surface with density proportional to some tonal function.

### Scribble / Random Hatching

Organic, gestural marks that follow no strict geometric pattern. Lines may curve, overlap, change direction, and vary in length. The result has a hand-drawn, expressive quality that is difficult to achieve with purely geometric hatching.

Implementation approaches:
- Perlin noise displacement applied to otherwise straight hatch lines
- Random walk paths constrained to stay within a tonal region
- Short curved segments at random orientations with density controlling tone

### Circulism

Small overlapping circles drawn with varying density. Produces a soft, textured tone that is directionless (like stippling) but with more visual texture. Each circle is a closed path, making it plotter-friendly as a continuous stroke.

Could be implemented in hatch3d as a UV-space pattern: distribute circle centers across the surface, then draw small circles in UV coordinates that map onto the 3D surface as ellipses following the surface curvature.

---

## Density-Based Tonal Control

Since a pen plotter cannot vary line darkness (the pen deposits the same amount of ink everywhere), all tonal variation must come from the density and arrangement of lines.

### Spacing Controls Tone

The fundamental relationship:

| Line Spacing | Perceived Tone |
|---|---|
| Very wide (5mm+) | Near white / highlight |
| Wide (3-4mm) | Light gray |
| Medium (2mm) | Medium gray |
| Narrow (1mm) | Dark gray |
| Very narrow (0.5mm) | Near black |

The exact values depend on pen width. With a 0.3mm pen, lines closer than about 0.5mm will start to merge visually, creating solid black. With a 0.1mm technical pen, much finer gradations are possible.

### Multi-Layer Tone Progression

Each additional hatching layer at a new angle approximately doubles the line density in the overlap region:

| Layers | Approximate Tone |
|---|---|
| 1 direction | ~25% gray |
| 2 directions (crosshatch) | ~50% gray |
| 3 directions (hex/tri) | ~75% gray |
| 4 directions | ~90% gray |

These are rough perceptual estimates. The actual perceived tone depends on line weight, spacing, paper color, ink opacity, and viewing distance.

### Gradient Techniques

To create smooth tonal gradients with hatching:

1. **Variable spacing**: Gradually change the distance between lines across the surface. In UV hatching, this means non-uniform distribution of iso-parameter values.

2. **Line dropping**: Start with a dense set of lines, then selectively remove lines in lighter areas. This maintains regular spacing in the darkest regions while thinning naturally.

3. **Layer thresholding**: Define tonal zones. In the lightest zone, draw only one direction. Add a second direction where tone exceeds 40%. Add a third where it exceeds 65%. Add a fourth where it exceeds 85%. This produces a stepped approximation of a smooth gradient.

4. **Line length modulation**: In lighter areas, lines become shorter (breaking into dashes). In darker areas, lines are continuous. This is particularly effective with contour hatching.

### Mapping to Hatch3d

In the current hatch3d architecture, density is controlled by the `count` parameter -- more lines in the same UV range means denser hatching. To achieve variable density across a single surface, the approach would be either:

- Non-uniform distribution of iso-parameter values (clustered where dark, sparse where light)
- Multiple overlaid hatch groups with different UV ranges and densities
- A future adaptive density feature that modulates spacing based on a tonal function

---

## Form-Following Hatching (Contour Hatching in Depth)

### Why It Works

The human visual system is extremely sensitive to curvature. When lines bend, we involuntarily perceive the surface they must be lying on. A set of curved parallel lines on a flat page can create a powerful illusion of three-dimensional form without any other depth cues.

This perceptual phenomenon is why contour hatching is considered the most important hatching technique for figure drawing, industrial design sketching, and scientific illustration.

### Iso-Parametric Lines

On a parametric surface `S(u,v)`, two natural families of contour lines exist:

- **u-constant lines**: Fix u, sweep v. These follow one "grain" of the surface.
- **v-constant lines**: Fix v, sweep u. These follow the perpendicular grain.

Both families are iso-parametric curves -- curves along which one parameter is held constant. They naturally follow the surface because they are literally embedded in it.

The quality of contour hatching depends heavily on the parameterization. A well-chosen parameterization aligns iso-parametric curves with visually meaningful directions (e.g., along the length and around the circumference of a vase). A poor parameterization produces lines that cross the form awkwardly.

### Surface-Specific Examples

**Sphere** (`u` = longitude, `v` = latitude):
- u-constant lines: meridians (vertical great circles)
- v-constant lines: parallels (horizontal circles)
- Both families clearly communicate spherical form

**Torus** (`u` = major angle, `v` = minor angle):
- u-constant lines: circles around the tube
- v-constant lines: circles around the hole
- The curvature variation (convex outside, saddle-shaped inside) is beautifully revealed

**Moebius strip** (`u` = along the strip, `v` = across the width):
- u-constant lines reveal the twist
- v-constant lines show the strip's extent

**Complex algebraic surfaces**:
- The parameterization may not align with visually meaningful directions
- In these cases, computing principal curvature directions and hatching along those would produce better results, though this requires differential geometry computations not yet in hatch3d

### Principal Curvature Hatching

The mathematically "best" directions for contour hatching are the principal curvature directions of the surface at each point. These are the directions in which the surface curves the most and the least. Hatching along principal curvature directions produces the strongest possible form communication.

Computing principal curvatures requires:
1. First fundamental form coefficients (E, F, G from the metric tensor)
2. Second fundamental form coefficients (L, M, N from the shape operator)
3. Solving the characteristic equation of the shape operator

This is computationally intensive but could be approximated numerically by finite differences on the surface function.

---

## Direction as Expression

The direction of hatching lines carries emotional and compositional meaning beyond their tonal function.

### Directional Associations

- **Horizontal lines**: Calm, stable, restful. Suggest horizon, landscape, repose.
- **Vertical lines**: Tension, growth, aspiration. Suggest trees, columns, standing figures.
- **Diagonal lines** (ascending left-to-right): Movement, energy, dynamism. The most "active" direction in Western visual culture (possibly because of left-to-right reading direction).
- **Diagonal lines** (descending left-to-right): Falling, decline, instability.
- **Curved lines**: Organic, flowing, natural. Suggest growth, water, biological forms.
- **Radiating lines**: Explosion, revelation, focus. Draw the eye to the center.

### Compositional Applications

Varying hatching direction across a composition creates visual rhythm and hierarchy:

- Use calm horizontal hatching for backgrounds and receding planes
- Use dynamic diagonal hatching for areas of emphasis or action
- Let the hatching direction shift gradually to guide the viewer's eye
- Contrast mechanical straight-line hatching against organic curved-line hatching to create tension

In hatch3d, different hatch groups can be assigned to different surfaces, each with its own family and angle. A composition might use `v`-family (horizontal) hatching on a ground plane, `diagonal` hatching on an active sculptural element, and `spiral` hatching on an organic form.

---

## Advanced Techniques Not Yet in Hatch3d

### 1. Adaptive Density Hatching

Line spacing varies based on a lighting computation. At each point on the surface, compute the surface normal and the dot product with a light direction vector (N dot L). Where the surface faces the light (N dot L close to 1), hatching is sparse or absent. Where the surface faces away (N dot L close to 0 or negative), hatching is dense.

**Implementation approach**: Instead of distributing iso-parameter values uniformly, compute a cumulative density function based on the integral of (1 - N dot L) along the parameter direction, then distribute lines according to the inverse of that CDF. This naturally clusters lines in shadow areas.

**Parameters needed**: Light direction (azimuth, elevation), ambient density (minimum spacing even in fully lit areas), shadow density (maximum spacing in darkest areas).

### 2. Variable-Width Hatching

Line weight varies along the stroke. Thicker in shadow areas, thinner in highlights. On a pen plotter, this can be approximated by:

- Drawing multiple closely-spaced parallel paths to simulate a thick line
- Using a brush pen and varying pressure (if the plotter supports Z-axis control)
- Drawing single-width lines but with density modulation to simulate weight variation

In engraving tradition, swelling lines (thick in the middle, thin at the ends) are characteristic of high-craft printmaking.

### 3. Noise-Perturbed Hatching

Apply Perlin noise or simplex noise displacement to otherwise regular hatch lines. The noise can be applied in UV space (before surface evaluation) or in screen space (after projection).

UV-space noise produces organic undulations that follow the surface form. Screen-space noise produces jittery lines that break the mechanical regularity of the plotter.

**Parameters**: Noise frequency (scale of perturbation), noise amplitude (strength of displacement), noise octaves (complexity of the perturbation pattern).

### 4. Tonal Crosshatch Progression

Automatically determine how many hatch layers to apply based on a computed brightness value at each point on the surface. Divide the surface into tonal zones:

- Zone 1 (brightest): No hatching or very sparse single-direction
- Zone 2: Single direction at medium density
- Zone 3: Two-direction crosshatch
- Zone 4: Three-direction (hex pattern)
- Zone 5 (darkest): Four-direction dense crosshatch

Each zone is rendered as a separate clip region with its own hatch configuration. The boundaries between zones can be smoothed by feathering line density near the edges.

### 5. Radial Gradient Hatching

Line spacing changes radially from a focal point. Dense at the center, sparse at the edges (or vice versa). This creates a spotlight or vignette effect.

Could be combined with any hatch family. For parallel hatching, lines near the focal point are closely spaced while lines far from it are widely spaced. For rings, the ring spacing varies with distance from center.

### 6. Woven Hatching

At intersections where two hatch families cross, alternate which line is "on top" -- creating a visual weave pattern. This is achieved by breaking lines at intersection points and omitting short segments in an alternating checkerboard pattern.

**Implementation approach**:
1. Generate both hatch families
2. Compute all intersection points between the two families
3. For each intersection, assign an over/under state based on parity
4. Break lines at intersections and remove segments where the line passes "under"

The result looks like a woven textile draped over the surface form.

### 7. Broken Line Hatching

Deliberately introduce gaps in hatch lines. The gaps can be:
- **Regular**: Evenly spaced dashes, like a dashed line
- **Random**: Perlin-noise-modulated gaps for an atmospheric, sketchy quality
- **Tonal**: More gaps in lighter areas, fewer in darker areas

Broken lines create texture and atmospheric depth. They suggest incompleteness and air, useful for depicting fog, distance, or translucency.

### 8. Parallel Curve Hatching

Instead of straight lines, use offset curves derived from a base curve. The base curve might be a boundary contour, a feature line, or an arbitrary decorative path. Offset curves at increasing distances from the base create a ripple-like pattern that follows the base curve's shape.

**Implementation approach**: Given a base curve as a polyline, compute offset curves by displacing each point along the local normal direction. Handle self-intersections in the offset curves by clipping.

---

## Historical Context

### Albrecht Durer (1471-1528)

The German Renaissance master elevated cross-hatching to an art form in his engravings and woodcuts. Durer's technique is characterized by:
- Systematic parallel lines that follow the form of each surface
- Careful gradation from light to dark through line density
- Cross-hatching reserved for the darkest shadows
- Background hatching with consistent direction to unify the composition

His engraving "Melencolia I" (1514) is a masterclass in hatching technique: every surface -- stone, fabric, flesh, metal, wood -- is rendered with distinct hatching patterns that communicate both form and material.

### Rembrandt van Rijn (1606-1669)

Rembrandt's etchings demonstrate a more expressive approach to hatching:
- Varied pressure and direction within a single stroke
- Deliberately rough, energetic marks in some areas
- Extremely delicate, sparse hatching in highlights
- Dense, chaotic scribble-hatching in deep shadows

His approach prioritizes emotional impact over technical precision, using hatching direction and density to create dramatic chiaroscuro effects.

### Copper Plate Engraving Tradition

The engraver's burin cuts V-shaped grooves in copper. Deeper cuts hold more ink, producing thicker lines. This physical constraint led to the development of "swelling line" technique -- lines that gradually thicken and thin as the burin is pushed deeper and shallower into the plate.

Engraving conventions that map directly to plotter art:
- **Lozenge patterns**: Diamond-shaped gaps left between crosshatched lines
- **Flick hatching**: Lines that taper to a point, suggesting light catching an edge
- **Dot-and-lozenge**: Stippled dots placed in the diamond gaps of crosshatching
- **Ruled gradients**: Perfectly straight, mechanically even lines (originally cut with a ruling machine) -- this is what a plotter does naturally

### Technical Illustration Conventions

Engineering and architectural drawing developed standardized hatching patterns to indicate materials in cross-section views:

| Material | Hatching Pattern |
|---|---|
| Cast iron / general metal | Evenly spaced 45-degree lines |
| Steel | 45-degree lines, wider spacing |
| Brass / copper | 45-degree lines with one line extra close |
| Aluminum | 45-degree lines, widely spaced |
| Concrete | Dots and triangles (stipple + random shapes) |
| Earth | Short random dashes |
| Wood (end grain) | Concentric irregular rings |
| Wood (with grain) | Parallel wavy lines |
| Glass | 45-degree lines, very widely spaced |
| Water / liquid | Horizontal wavy lines |
| Insulation | Irregular scribble loops |

These conventions offer a ready-made vocabulary for "material-indication mode" in hatch3d -- applying different hatch families to different surfaces to suggest what they are made of.

### Japanese Ukiyo-e

Woodblock printing developed its own line conventions:
- **Bokashi**: Gradual tone achieved by wiping ink from the block (not directly translatable to plotter, but the tonal effect can be approximated with density gradients)
- **Key lines**: Bold outlines defining form boundaries
- **Pattern fills**: Geometric patterns (waves, clouds, geometric motifs) filling regions
- **Rain lines**: Fine parallel diagonal lines for atmosphere

The ukiyo-e approach of combining bold outlines with patterned fills maps well to a hatch3d workflow: use one hatch group for outlines (high-count contour lines at surface boundaries) and another for tonal fill (interior hatching).

---

## Composition Ideas for Hatch3d

### Light-Responsive Hatching

Add a "light direction" parameter to the pipeline. At each hatch sample point, compute the surface normal via finite differences:

```
N = normalize(cross(dS/du, dS/dv))
```

Then compute `brightness = max(0, dot(N, lightDir))`. Use this brightness value to:
- Modulate line spacing (skip lines where brightness is high)
- Control which hatch layers are present (add crosshatch layers in shadow)
- Vary the UV range of hatching (hatch only the shadow side of a surface)

This single addition would dramatically increase the three-dimensionality of hatch3d output.

### Material-Indication Mode

Assign different hatch patterns to different surfaces in a composition, borrowing from technical illustration conventions:
- Ground plane: widely spaced horizontal lines (earth)
- Metallic sculptural element: dense 45-degree crosshatch (steel)
- Organic form: contour-following curves (wood grain)
- Glass/transparent element: very sparse parallel lines

### Atmospheric Perspective

For compositions with depth, modulate hatching density based on distance from camera:
- Foreground surfaces: dense, high-contrast hatching with multiple layers
- Middle ground: medium density, single direction
- Background: very sparse, light hatching or just outlines

This creates a sense of depth and atmosphere purely through line density.

### Ink Wash Simulation

Simulate the effect of ink wash (sumi-e) by drawing many nearly-parallel lines with slight random offsets. Where lines are densely packed, they merge visually into a wash-like tone. Where they thin out, individual lines become visible, creating the characteristic edge quality of a brush wash.

**Parameters**: Base line count, maximum random offset, density gradient function.

### Engraving Style

Emulate the look of fine copper plate engraving:
- Use contour-following hatch lines that swell (multiple parallel paths close together) in shadow areas
- Add a second crosshatch layer at a consistent angle (typically 15-30 degrees off the first)
- Keep line count high and spacing tight
- Use the spiral family for circular forms (like coins and medallions)

### Multi-Pen Layering

Design compositions for multi-pen plotting:
- First pen (fine, black): Dense contour hatching for shadows and detail
- Second pen (medium, gray or colored): Background parallel hatching at a different angle
- Third pen (bold, accent color): Sparse structural lines, outlines, or key features

Each pen pass is a separate set of hatch groups with coordinated but distinct parameters.

### Negative Space Hatching

Hatch the background/negative space rather than the object itself. The object is defined by the absence of lines -- a silhouette cut out of a hatched field. This inverts the usual figure/ground relationship and produces striking graphic results.

**Implementation**: Generate hatching that covers the entire frame, then clip (remove) lines that fall within the surface projection.

---

## References

- Durer, Albrecht. "Melencolia I" (1514) -- exemplar of systematic cross-hatching
- Pham, Duc Truong. "Pen Plotter Art & Algorithms" -- technical overview of plotter hatching
- Craftsy. "6 Basic Forms of Hatching and Cross Hatching" -- accessible introduction
- Love Life Drawing. "Hatching tutorial -- parallel, crosshatching and contour hatching" -- practical drawing instruction
- Wikipedia. "Hatching" -- comprehensive historical overview with examples
- ISO 128-50: Technical drawing conventions for section hatching patterns
- Hodges, Elaine R.S. "The Guild Handbook of Scientific Illustration" -- definitive reference for scientific hatching technique
- Saito, Takafumi and Tokiichiro Takahashi. "Comprehensible Rendering of 3-D Shapes" (SIGGRAPH 1990) -- seminal paper on computer-generated hatching for 3D illustration
