#!/usr/bin/env node
/**
 * hatch3d stats CLI — deterministic SVG measurement.
 *
 * Emits a structured JSON report (see src/stats/analyze.ts) for a hatch3d SVG:
 * path/vertex counts, physical arc length, per-layer breakdown, ink-density
 * grid, pen-travel estimate, and plottability warnings. No rendering, no model
 * calls — this is the measurement half of the agent loop.
 *
 * Usage:
 *   npx tsx cli/stats.ts --input render.svg
 *   npx tsx cli/stats.ts --input render.svg --pen-width 0.3 --grid 12
 *   npm run render -- -c flow-field | npx tsx cli/stats.ts   # read SVG from stdin
 */

import { parseArgs } from "node:util";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { analyzeSvg } from "../src/stats/analyze.js";

const { values: args } = parseArgs({
  options: {
    input: { type: "string", short: "i" },
    "pen-width": { type: "string" },
    grid: { type: "string" },
    "saturation-threshold": { type: "string" },
    pretty: { type: "boolean", default: true },
    compact: { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
  allowPositionals: true,
  strict: false,
});

if (args.help) {
  console.log(`
hatch3d stats CLI — deterministic SVG measurement

Usage:
  npx tsx cli/stats.ts --input FILE [options]
  <svg on stdin> | npx tsx cli/stats.ts

Options:
  -i, --input FILE            SVG file to analyze (default: read stdin)
  --pen-width MM              Override pen width in mm (default: recovered from SVG)
  --grid N                    Density grid resolution N×N (default: 8)
  --saturation-threshold C    Coverage at/above which a cell is "saturated" (default: 1.0)
  --compact                   Emit single-line JSON (default: pretty-printed)
  -h, --help                  Show this help

Output: a JSON report on stdout. See cli/README.md for the schema.
`);
  process.exit(0);
}

function readInput(): { svg: string; label: string | null } {
  const inputPath = args.input ?? (undefined as string | undefined);
  if (inputPath) {
    const p = resolve(inputPath);
    return { svg: readFileSync(p, "utf-8"), label: inputPath };
  }
  // Read from stdin.
  const svg = readFileSync(0, "utf-8");
  if (!svg.trim()) {
    console.error("No input: pass --input FILE or pipe an SVG on stdin. See --help.");
    process.exit(1);
  }
  return { svg, label: null };
}

function main(): void {
  const { svg, label } = readInput();
  const penWidthMm = args["pen-width"] != null ? Number(args["pen-width"]) : undefined;
  const gridArg = args.grid != null ? Number(args.grid) : undefined;
  const satArg =
    args["saturation-threshold"] != null ? Number(args["saturation-threshold"]) : undefined;

  if (penWidthMm != null && (Number.isNaN(penWidthMm) || penWidthMm <= 0)) {
    console.error(`Invalid --pen-width: ${args["pen-width"]}`);
    process.exit(1);
  }
  if (gridArg != null && (Number.isNaN(gridArg) || gridArg < 1)) {
    console.error(`Invalid --grid: ${args.grid}`);
    process.exit(1);
  }

  let report;
  try {
    report = analyzeSvg(svg, {
      penWidthMm,
      grid: gridArg,
      saturationThreshold: satArg,
      input: label,
    });
  } catch (e) {
    console.error(`stats: ${(e as Error).message}`);
    process.exit(1);
  }

  const json = args.compact ? JSON.stringify(report) : JSON.stringify(report, null, 2);
  process.stdout.write(json + "\n");
}

main();
