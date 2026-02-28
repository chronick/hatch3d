# Random Walkers & Agent-Based Drawing

Drawing with autonomous agents that follow simple rules to create complex emergent patterns.

## Basic Random Walk
```
pos = startPoint
path = [pos]
for step in 0..maxSteps:
  direction = randomAngle()  // or grid-aligned: up/down/left/right
  pos = pos + step(direction, stepLength)
  path.append(pos)
```

## Walk Types

### Lattice Walk (Grid-Aligned)
Movement restricted to grid directions (4-connected or 8-connected). Creates pixelated, digital aesthetic.

### Continuous Walk
Any angle allowed. Produces smoother paths.

### Levy Flight
Mostly short steps with occasional very long jumps (power-law step distribution). Creates clustered patterns with connecting bridges — models animal foraging.

### Self-Avoiding Walk
Cannot revisit previously occupied positions. Creates space-filling paths that never cross themselves. Harder to compute but produces clean, non-overlapping art.

### Biased Walk
Direction biased by external field:
- Perlin noise → flow-field-like output
- Image gradient → walks toward edges
- Gravity → downward bias
- Attraction/repulsion to other walkers

## Multi-Agent Systems

### Flocking (Boids)
Three rules per agent:
1. **Separation**: Steer away from neighbors that are too close
2. **Alignment**: Match velocity of nearby neighbors
3. **Cohesion**: Steer toward average position of neighbors

Produces organic swarm/school patterns. Each agent trail becomes a drawn path.

### Ant Colony
Agents deposit "pheromone" trails that attract other agents. Creates branching network patterns reminiscent of actual ant paths.

### DLA (Diffusion-Limited Aggregation)
Random walkers that "stick" when touching existing structure:
1. Start with a seed point
2. Release random walker from far away
3. Walker moves randomly until it touches existing cluster
4. It sticks in place, becomes part of cluster
5. Repeat

Produces branching, frost/lightning-like structures.

## Parameters
| Parameter | Effect |
|-----------|--------|
| `numAgents` | Number of simultaneous walkers |
| `stepLength` | Distance per step |
| `maxSteps` | Path length limit |
| `turnAngle` | Maximum turn per step (constrains path smoothness) |
| `bias` | Directional preference |
| `interactionRadius` | Range of agent-to-agent forces |

## Plotter Considerations
- Each agent produces one path — multiple agents = multiple pen strokes
- Self-avoiding walks produce cleaner output (no line overlap)
- DLA produces very organic branching — single connected structure
- Agent count and step count directly control plot density and time

## Composition Ideas for Hatch3d
- **Walker-hatched surfaces**: Agent paths on UV surface replace structured hatching
- **DLA growing from surface**: Branch structure grows outward from surface boundary
- **Flock composition**: Boid trails flowing around/between 3D surfaces
- **Self-avoiding fill**: Self-avoiding walk fills projected surface silhouettes
- **Biased walk texture**: Walkers biased by surface normal create form-following organic texture

## References
- Craig Reynolds, "Flocks, Herds, and Schools" (1987) — boids
- Witten & Sander (1981) — DLA
- Mandelbrot — random walks and fractal paths
