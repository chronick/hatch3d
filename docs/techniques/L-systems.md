# L-Systems (Lindenmayer Systems)

String-rewriting systems that produce fractal and plant-like structures. Each generation applies substitution rules to a string, which is then interpreted as drawing commands.

## Basic Structure
```
Alphabet: F, +, -, [, ]
Axiom: F         (starting string)
Rule: F -> F+F-F-F+F  (Koch curve)
```

### Turtle Interpretation
- `F` — move forward and draw
- `f` — move forward without drawing
- `+` — turn right by angle
- `-` — turn left by angle
- `[` — push state (position + angle) to stack
- `]` — pop state from stack (creates branching)

## Classic Examples

### Koch Snowflake
```
Axiom: F--F--F
Rule: F -> F+F--F+F
Angle: 60deg
```

### Sierpinski Triangle
```
Axiom: F-G-G
Rules: F -> F-G+F+G-F, G -> GG
Angle: 120deg
```

### Dragon Curve
```
Axiom: FX
Rules: X -> X+YF+, Y -> -FX-Y
Angle: 90deg
```

### Plant/Tree
```
Axiom: X
Rules: X -> F+[[X]-X]-F[-FX]+X, F -> FF
Angle: 25deg
```
The `[` and `]` create branching — each branch saves/restores position.

## Stochastic L-Systems
Multiple rules for the same symbol with probabilities:
```
F -> F+F  (60% chance)
F -> F-F  (40% chance)
```
Produces natural variation in repeated structures. Same axiom generates different outputs.

## Parametric L-Systems
Symbols carry numeric parameters:
```
A(s) : s > 1 -> F(s) [ +A(s*0.7) ] [ -A(s*0.7) ]
A(s) : s <= 1 -> F(s)
```
Branch length decreases with depth — realistic tree proportions.

## Context-Sensitive L-Systems
Rules consider neighbors:
```
a < B > c -> D   (B becomes D only when preceded by 'a' and followed by 'c')
```
Enables signal propagation along structures.

## Key Parameters
| Parameter | Effect |
|-----------|--------|
| `iterations` | Recursion depth (exponential growth in complexity) |
| `angle` | Turn angle (determines curve character) |
| `lengthRatio` | Branch shortening per generation |
| `randomness` | Stochastic variation factor |
| `axiom` | Starting configuration |
| `rules` | The substitution rules |

## Plotter Considerations
- Branching L-systems produce many pen lifts (at each `]`)
- Optimize by sorting branches to minimize pen travel
- Fractal L-systems without branching (Koch, Dragon) produce single continuous paths
- Iteration count must be limited — string length grows exponentially

## Applications Beyond Plants
- **Architecture**: Recursive structural patterns
- **Tiles**: L-systems that produce tiling patterns
- **Music**: Interpret string as musical notes
- **3D**: Extend turtle to 3D with pitch/roll/yaw commands

## Composition Ideas for Hatch3d
- **L-system forest**: Tree L-systems growing from base surface
- **Fractal surface hatching**: Koch or Sierpinski curves mapped onto UV space
- **Branching frame**: L-system tree structure as decorative frame around 3D composition
- **Growth composition**: Series of prints showing same L-system at increasing generations
- **Hybrid surface**: L-system paths projected onto parametric surface

## References
- Aristid Lindenmayer (1968) — original paper on biological modeling
- Prusinkiewicz & Lindenmayer, "The Algorithmic Beauty of Plants" (1990) — the definitive reference
- Daniel Shiffman, "The Nature of Code" — accessible L-system tutorial
