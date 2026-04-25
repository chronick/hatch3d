---
title: "Variability metrics for SVG output"
created: 2026-04-25
task: vault-enwu
status: complete
---

## Purpose

The improve-mode routine renders N variants of a composition at different
parameter values and needs a fast, deterministic signal to decide whether
variability is low enough to warrant proposing a new parameter slider.
This document selects two SVG-math metrics and defines qualitative
threshold bands. Empirical calibration is deferred.

---

## Selected metrics

### Metric A — Path count CoV

**What it measures**: structural topology. Counts the number of SVG path
elements (`<path>`) across variants and computes the coefficient of
variation (CoV = σ/μ). Low CoV means every variant produces roughly the
same number of hatch lines; parameter changes aren't unlocking new
strokes.

**Why this one**: path count is O(N) to read (no coordinate parsing),
fully deterministic, and directly reflects the plotter's job complexity.
It catches the most common form of thin composition: a parameter with no
architectural effect (e.g., a noise seed that only jiggles positions
without adding or removing strokes).

**Why not KL divergence of line-length distribution**: richer but
requires histogram binning and is sensitive to bin-width choice. Adds
implementation complexity with no meaningful benefit at the binary
gate level.

**Why not centroid / bounding-box spread**: hatch3d compositions fill
the full SVG viewport by design. Spatial spread is nearly constant
across variants, making this metric low-discriminatory for this codebase.

**Pseudocode (TypeScript)**:

```typescript
/**
 * Returns CoV of path counts across N variants.
 * svgPathSets[i] = the array of SVG path `d` strings for variant i.
 */
function pathCountCoV(svgPathSets: string[][]): number {
  const counts = svgPathSets.map(paths => paths.length);
  const mean = counts.reduce((a, b) => a + b, 0) / counts.length;
  if (mean === 0) return 0;
  const variance =
    counts.reduce((s, c) => s + (c - mean) ** 2, 0) / counts.length;
  return Math.sqrt(variance) / mean;
}
```

---

### Metric B — Normalized arc-length CoV

**What it measures**: ink density. Sums the total Euclidean length of all
path segments in each variant, normalizes by canvas area, then computes
CoV across variants. This is a pure-math proxy for "filled-pixel ratio"
(coverage): for uniform stroke width, coverage ∝ total arc length / area.

**Why this one**: path count CoV misses the case where every variant has
the same number of paths but one is tightly coiled while another is
sparse. Arc length captures density changes that topology doesn't.
hatch3d paths are piecewise-linear (`M x,y L x,y ...`), so length is
just a sum of Euclidean segment distances — no curve approximation needed.

**Why not coverage rasterization**: true pixel coverage requires a render
pass. Arc length / area is a lossless proxy when stroke width is constant,
which it is in hatch3d (controlled globally, not per-path).

**Why not per-region density variance**: partitioning the canvas into cells
and intersecting paths with cell boundaries adds O(P × C) complexity and
a free parameter (grid resolution). The normalized arc length already
encodes aggregate density; per-region analysis belongs in v2 if the
routine needs spatial sensitivity.

**Pseudocode (TypeScript)**:

```typescript
/**
 * Returns CoV of normalized arc-length across N variants.
 * svgPathSets[i] = the array of SVG path `d` strings for variant i.
 * canvasArea       = width × height in SVG user units.
 */
function arcLengthCoV(svgPathSets: string[][], canvasArea: number): number {
  const densities = svgPathSets.map(paths => {
    const totalLength = paths.reduce(
      (sum, d) => sum + pathArcLength(d),
      0
    );
    return totalLength / canvasArea;
  });
  const mean = densities.reduce((a, b) => a + b, 0) / densities.length;
  if (mean === 0) return 0;
  const variance =
    densities.reduce((s, d) => s + (d - mean) ** 2, 0) / densities.length;
  return Math.sqrt(variance) / mean;
}

/**
 * Approximate arc length of an SVG path composed of M and L commands.
 * Handles the output format of polylinesToSVGPaths() in projection.ts.
 */
function pathArcLength(d: string): number {
  // Split on M/L; each token is "x,y"
  const tokens = d.replace(/[ML]/g, " ").trim().split(/\s+/);
  const points = tokens.map(t => {
    const [x, y] = t.split(",").map(Number);
    return { x, y };
  });
  let length = 0;
  for (let i = 1; i < points.length; i++) {
    const dx = points[i].x - points[i - 1].x;
    const dy = points[i].y - points[i - 1].y;
    length += Math.sqrt(dx * dx + dy * dy);
  }
  return length;
}
```

---

## Combined variability score

The routine evaluates both metrics together. A variant set is **low
variability** when both CoVs fall below their respective thresholds.

```typescript
interface VariabilityResult {
  pathCountCoV: number;
  arcLengthCoV: number;
  band: "low" | "medium" | "high";
}

function classifyVariability(
  pathCoV: number,
  lengthCoV: number
): VariabilityResult["band"] {
  const maxCoV = Math.max(pathCoV, lengthCoV);
  if (maxCoV < LOW_THRESHOLD) return "low";
  if (maxCoV < HIGH_THRESHOLD) return "medium";
  return "high";
}
```

---

## Threshold bands (qualitative)

Empirical calibration is deferred to the follow-up task. The bands below
are informed by intuition about plotter art parameter sensitivity; they
should be validated against real composition sweeps before the improve
routine ships.

| Band | Path count CoV | Arc-length CoV | Routine action |
|------|----------------|----------------|----------------|
| **Low** | < 0.05 | < 0.08 | Propose a new parameter slider |
| **Medium** | 0.05 – 0.20 | 0.08 – 0.25 | Monitor; no action yet |
| **High** | > 0.20 | > 0.25 | Variants already varied; skip |

**Rationale for asymmetry**: arc length is expected to vary more smoothly
than path count (which is integer-valued and can jump by ±1 across many
variants without the distribution changing shape), so the arc-length
threshold is slightly wider.

**Low-variability trigger logic**: both metrics must be in the "low" band
to fire. A composition with stable path count but widely varying arc
length is not "thin" — the density parameter space is already exercised.

---

## Out of scope for v1

- Running either metric on real compositions to validate the thresholds.
- CI integration or automated threshold checking.
- Picking final numeric thresholds (that's the calibration follow-up).
- Metrics beyond path count and arc length (KL divergence, per-region
  density, centroid spread).
- Handling cubic Bézier or arc commands in SVG paths (hatch3d outputs
  only `M`/`L` commands from `polylinesToSVGPaths`).
- Cross-composition normalization (thresholds may need per-composition
  tuning — deferred).

---

## Source references

- `src/projection.ts` → `polylinesToSVGPaths()` — SVG path format
- `cli/render.ts` → `renderOne()` — headless render entry point
- `active/3d-plotter-surfaces/design/spec.md` — improve-mode loop design
- `docs/research/webgl-occlusion-jsdom.md` — prior research on headless
  render constraints
