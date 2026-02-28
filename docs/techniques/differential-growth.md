# Differential Growth

## What It Is

A simulation where a curve grows by inserting new nodes, with forces keeping nodes separated while preventing self-intersection. Produces organic, coral/brain-like forms. One of the most visually striking plotter techniques.

## Core Algorithm

1. Start with a simple closed curve (circle) as a list of connected nodes
2. Each iteration:
   a. **Attraction**: Each node pulls toward its neighbors (spring force)
   b. **Repulsion**: Nodes push away from ALL nearby non-neighbor nodes (collision avoidance)
   c. **Alignment**: Optionally nudge toward average of neighbors (smoothing)
   d. **Growth**: Insert new node between neighbors where edge length exceeds threshold
   e. **Integration**: Apply forces, update positions
3. Repeat for hundreds/thousands of iterations

## Forces (Pseudocode)

```
for each node:
  // Spring to neighbors
  for each neighbor:
    d = distance(node, neighbor)
    force += (neighbor - node) * (d - restLength) * springK

  // Repulsion from nearby non-neighbors
  for each nearby_node (spatial hash lookup):
    if nearby_node is neighbor: skip
    d = distance(node, nearby_node)
    if d < repulsionRadius:
      force += (node - nearby_node) / d * repulsionStrength

  // Alignment (optional smoothing)
  avg = average(prev_neighbor, next_neighbor)
  force += (avg - node) * alignmentStrength
```

## Key Parameters

| Parameter | Effect |
|-----------|--------|
| `repulsionRadius` | How far nodes push each other (controls fold tightness) |
| `repulsionStrength` | Force magnitude (higher = more dramatic folds) |
| `springK` | Edge stiffness (higher = more rigid edges) |
| `restLength` | Desired edge length |
| `maxEdgeLength` | Threshold for node insertion (controls growth rate) |
| `alignmentStrength` | Smoothing factor (0 = jagged, high = smooth) |
| `maxNodes` | Growth limit |

## Spatial Optimization

Naive O(n^2) repulsion is too slow. Use:
- **Spatial hash grid**: Divide space into cells, only check nearby cells
- **Quadtree/KD-tree**: Hierarchical spatial lookup
- Critical for interactive performance (1000+ nodes)

## Variations

### Open Curve Growth

- Start with a line segment instead of closed loop
- Endpoints can be fixed or free
- Grows outward from edges, creates tendril/root forms

### Multi-Curve Interaction

- Multiple independent curves that repel each other
- Creates intertwining organic networks

### Anisotropic Growth

- Growth rate varies spatially (e.g., faster on one side)
- Produces asymmetric, directional forms

### Constrained Growth

- Confine within a boundary shape
- Grow to fill a specific region (text, silhouette)
- Boundary nodes fixed, interior grows

### 3D Differential Growth

- Same algorithm on 3D mesh surfaces
- Produces ruffled, lettuce-leaf-like forms
- Project to 2D for plotting

## Plotter Considerations

- Output is a single continuous polyline (or small number of polylines) -- ideal for pen plotters
- Very long paths with many points -- may need simplification via RDP
- Line density naturally varies (dense in folded areas, sparse in smooth areas)
- Produces excellent visual texture without additional hatching

## Composition Ideas for Hatch3d

- **Growth-on-surface**: Run differential growth algorithm on the UV space of a parametric surface, then map to 3D -- organic tendrils wrapping a mathematical form
- **Differential fill**: Use growing curves to fill the interior of projected surface silhouettes
- **Coral composition**: Multiple surfaces with differential growth replacing standard hatching -- surfaces look like living coral
- **Growth-bounded-by-surface**: 2D differential growth constrained to the projected outline of 3D surfaces

## Key Artists / References

- Anders Hoff (inconvergent) -- pioneering plotter differential growth work
- Nervous System -- differential growth in 3D printed jewelry
- Jason Webb -- morphogenesis-resources GitHub collection
