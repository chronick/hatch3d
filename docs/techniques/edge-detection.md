# Edge Detection for Plotter Art

Converting photographic images to line drawings by extracting edges and contours.

## Algorithms

### Canny Edge Detection
The gold standard. Multi-step process:
1. Gaussian blur (noise reduction)
2. Gradient magnitude and direction (Sobel operators)
3. Non-maximum suppression (thin edges to 1px)
4. Hysteresis thresholding (strong edges + connected weak edges)

Output: binary edge map. Need vectorization step for plotter.

### Sobel Operator
Computes gradient in x and y directions:
```
Gx = [[-1,0,1],[-2,0,2],[-1,0,1]] * image
Gy = [[-1,-2,-1],[0,0,0],[1,2,1]] * image
magnitude = sqrt(Gx^2 + Gy^2)
direction = atan2(Gy, Gx)
```

### Difference of Gaussians (DoG)
Subtract two blurred versions of image (different sigma values). Approximates Laplacian of Gaussian. Simple, effective for artistic line extraction.

### XDoG (Extended DoG)
Enhanced DoG with thresholding and sharpening for clean, stylized line art:
```
dog = G(sigma) - tau * G(k * sigma)
if dog >= epsilon: result = 1
else: result = 1 + tanh(phi * dog)
```
Produces excellent pen-and-ink style output.

## Vectorization (Raster to Vector)

### Potrace
Standard bitmap-to-vector tool. Traces boundaries of black regions, outputs Bezier curves. Available as library and CLI.

### Centerline Tracing
Instead of outline tracing, extracts the center line of strokes:
- Skeletonize the edge map (morphological thinning)
- Trace the skeleton as polylines
- Smooth with spline fitting
- Better for thin lines than Potrace (which creates outlines)

### Direct Polyline Extraction
1. Walk along edge pixels, collecting connected paths
2. Apply Ramer-Douglas-Peucker simplification
3. Optionally smooth with Catmull-Rom splines

## Multi-Scale Edge Extraction
Extract edges at multiple blur levels for rich, layered line drawings:
- Low blur: fine detail (textures, small features)
- Medium blur: main contours (object boundaries)
- High blur: major structure only (silhouettes)
- Layer onto different pen layers for multi-pass plotting

## Parameters
| Parameter | Effect |
|-----------|--------|
| `sigma` | Blur amount (higher = fewer/smoother edges) |
| `lowThreshold` | Weak edge cutoff (Canny) |
| `highThreshold` | Strong edge cutoff (Canny) |
| `simplification` | RDP tolerance for vectorization |
| `minLength` | Discard paths shorter than this |

## Composition Ideas for Hatch3d
- **Photo-sourced composition**: Edge-detected portrait or landscape as 2D background layer behind 3D surfaces
- **Edge-guided hatching**: Use detected edges to define regions with different hatch patterns
- **Hybrid rendering**: 3D surfaces with edge-detected image textures projected onto them
- **Multi-scale portrait**: Coarse edges as bold strokes + fine edges as delicate detail

## References
- Canny (1986) — "A Computational Approach to Edge Detection"
- Winnemöller et al. (2012) — XDoG for artistic rendering
- Potrace — Peter Selinger's vectorization tool
- autotrace — open source bitmap-to-vector
