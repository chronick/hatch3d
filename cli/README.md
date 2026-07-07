# hatch3d CLIs

Headless Node CLIs (run via `tsx`). No browser required.

| Script | Command | Purpose |
| ------ | ------- | ------- |
| `render` | `npm run render -- -c <id> -o out.svg` | Render a composition to SVG/PNG |
| `stats` | `npm run stats -- -i out.svg` | Deterministic SVG measurement (report below) |
| `feed` | `npm run feed` | Render curated/biased presets and push to the feed app |
| `pref:sync` | `npm run pref:sync` | Collect curation signals, recompute the preference model |

## `stats` — deterministic SVG measurement

Emits a structured JSON report for a hatch3d-emitted SVG: path/vertex counts,
physical arc length, per-layer breakdown, an ink-density grid, a pen-travel
estimate, and plottability warnings. No rendering, no model calls — this is the
measurement half of the agent loop (see the vault design pod
`active/plotter-art-workflow`). The core lives in `src/stats/analyze.ts` and is
importable directly (the InkSight browser tool consumes the same functions).

```bash
npm run stats -- --input render.svg
npm run stats -- --input render.svg --pen-width 0.3 --grid 12
npm run render -- -c flowField | npm run stats          # SVG from stdin
```

### Options

| Flag | Default | Meaning |
| ---- | ------- | ------- |
| `-i, --input FILE` | stdin | SVG file to analyze |
| `--pen-width MM` | recovered from SVG | Override pen width (mm) |
| `--grid N` | 8 | Density grid resolution (N×N) |
| `--saturation-threshold C` | 1.0 | Coverage at/above which a cell counts as saturated |
| `--compact` | off | Single-line JSON instead of pretty-printed |

### Scope

Targets SVG produced by hatch3d's exporter: absolute `M`/`L` polyline paths
inside a `translate(cx,cy) scale(S)` group, with an mm-unit `viewBox` and a
margin clip rect. Curves (`C`/`Q`/`A`/…), relative commands, and closepath are
**rejected with a clear error** rather than silently mis-measured. Both
single-group and layered (per-pen `<g>`) exports are supported.

### Report schema

All lengths and areas are in millimetres (recovered from the `viewBox` mm units
and the group `scale`). Ink density is a coverage proxy: `arcLength × penWidth /
area` — for a constant pen width this approximates the filled-pixel ratio, so a
cell at `1.0` is effectively solid ink (line spacing has dropped below the pen
width).

```jsonc
{
  "input": "render.svg",                 // file label, or null for stdin
  "page":     { "widthMm", "heightMm" }, // page size from viewBox
  "drawable": { "xMm", "yMm", "widthMm", "heightMm", "areaMm2" }, // inside margins
  "penWidthMm": 0.5,
  "penWidthSource": "flag" | "svg" | "default",
  "scale": 0.33375,                       // path-space → mm factor
  "totals": {
    "layers", "paths", "vertices", "segments",
    "arcLengthMm",                        // total drawn line length
    "penUpTravelMm",                      // travel between paths in file order (no reorder)
    "boundingBox": { "xMm", "yMm", "widthMm", "heightMm" },
    "bboxCoverageRatio",                  // bbox area / drawable area
    "inkDensity"                          // global coverage proxy
  },
  "layers": [
    { "id", "stroke", "paths", "vertices", "segments", "arcLengthMm", "inkDensity" }
  ],
  "densityGrid": {
    "cols", "rows",
    "cells",                              // rows×cols coverage matrix
    "max", "mean",
    "cv"                                  // coefficient of variation — spatial balance
  },
  "warnings": {
    "marginViolationPaths",               // paths with a vertex outside the margins
    "saturatedCells",                     // cells with coverage ≥ threshold
    "saturationThreshold"
  }
}
```

### Reading the numbers

- **`densityGrid.cv`** — spatial balance. Low (< ~0.5) means ink is spread
  evenly; high (> ~1.5) means it clumps (e.g. centered geometry with empty
  margins). This is the fast signal for "unbalanced composition."
- **`warnings.saturatedCells`** — regions that will plot as solid black with the
  declared pen; usually a sign to widen hatch pitch or drop a layer.
- **`warnings.marginViolationPaths`** — geometry that the margin clip will cut
  off; the composition is overflowing the page.
- **`penUpTravelMm`** — a rough plot-efficiency signal. High pen-up travel
  relative to `arcLengthMm` means `vpype linesort` will help a lot at prep time.
