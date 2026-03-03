# Research: Fluid Dynamics for Plotter Art
**Date**: 2026-03-02
**Depth**: deep

## Summary
Surveyed six families of fluid dynamics techniques beyond Perlin noise flow fields: Stable Fluids (Jos Stam), Lattice Boltzmann, SPH, point vortices (Biot-Savart), evenly-spaced streamlines (Jobard-Lefer), and mathematical marbling (Suminagashi). Point vortices combined with Jobard-Lefer seeding emerged as the optimal approach for plotter art — physically grounded, computationally cheap, and producing excellent line quality.

## Sources
- [Stam, "Real-Time Fluid Dynamics for Games" (GDC 2003)](http://graphics.cs.cmu.edu/nsp/course/15-464/Fall09/papers/StamFluidforGames.pdf)
- [Jobard & Lefer, "Creating Evenly-Spaced Streamlines of Arbitrary Density" (1997)](https://link.springer.com/chapter/10.1007/978-3-7091-6876-9_5)
- [Lu et al., "Mathematical Marbling" (IEEE CG&A, 2012)](https://people.csail.mit.edu/jaffer/Marbling/Mathematics)
- [Tyler Hobbs, "Flow Fields"](https://www.tylerxhobbs.com/words/flow-fields)
- [Karl Sims, "Fluid Flow Tutorial"](https://www.karlsims.com/fluid-flow.html)
- [Mike Ash, "Fluid Simulation for Dummies"](https://www.mikeash.com/pyblog/fluid-simulation-for-dummies.html)
- [Bridson et al., "Curl-Noise for Procedural Fluid Flow" (SIGGRAPH 2007)](https://dl.acm.org/doi/10.1145/1275808.1276435)
- [Amanda Ghassaei, FluidSimulation](https://github.com/amandaghassaei/FluidSimulation) — SVG/G-Code export
- [nornagon/stam-stable-fluids](https://github.com/nornagon/stam-stable-fluids) — JS port of Stam
- [nickswalker/marblizer](https://github.com/nickswalker/marblizer) — TypeScript mathematical marbling

## Core Concepts

### Point Vortices (Biot-Savart Law)
Place N point vortices with position and circulation strength. Velocity at any point is the superposition:
```
vx += Gamma_i * (-dy) / (2π * (r² + ε))
vy += Gamma_i * (dx) / (2π * (r² + ε))
```
Field is divergence-free by construction. 5-20 vortices create rich topology with spirals, saddle points, and separatrices.

### Evenly-Spaced Streamlines (Jobard-Lefer)
1. Seed initial streamline, trace forward+backward
2. Generate candidate seeds at perpendicular distance d_sep along the streamline
3. Validate candidates against all existing streamlines via spatial hash
4. Queue valid candidates for future streamline computation
5. Repeat until queue is empty
Produces even, engraving-like line coverage with single d_sep parameter.

### Curl Noise Combination
Curl noise is divergence-free, so it combines cleanly with point vortices:
`v_total = v_vortices + v_curl_noise`
This adds organic turbulence while preserving physical flow characteristics.

## Plotter Art Applications
- **Vortex fields**: Elegant spiraling patterns around discrete centers, mathematical purity
- **Jobard-Lefer seeding**: Eliminates gap/clutter problems of grid seeding, engraving aesthetic
- **Mathematical marbling**: Concentric ring transforms with tine combing for Suminagashi patterns
- **Stable Fluids**: Interactive sculpting of flow fields, freeze-and-trace for final output

## Hatch3d Integration Assessment
- **Difficulty**: moderate (new 2D composition, ~150 lines)
- **Type**: new-2d-composition
- **Prerequisites**: none — all algorithms are pure math, no new dependencies
- **Approach**: Implement `Composition2DDefinition` with vortex velocity field + Jobard-Lefer streamline seeding. Follow existing `flow-field.ts` pattern.

## Artist References
- **Tyler Hobbs** — Fidenza series, flow field mastery with density variation
- **Anders Hoff (Inconvergent)** — Sand Spline, differential flow systems
- **Amanda Ghassaei** — Physics-based fluid sim with SVG/plotter export
- **Licia He** — Plotter-first flow work emphasizing ink/paper materiality

## Open Questions
- Should vortex positions be user-controllable (XY pads) or algorithmically placed?
- Could dynamic vortex simulation (vortices moving in each other's fields) produce better frozen states?
- Future: combine with 3D surfaces for flow-hatched geometry?
