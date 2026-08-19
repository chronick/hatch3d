#!/usr/bin/env node
/**
 * hatch3d stats:diff CLI — variability across composition variants.
 *
 * Given N rendered SVG variants of a composition, computes the two variability
 * metrics (path-count CoV + normalized arc-length CoV) and classifies the set
 * as low / medium / high variability. The improve-mode routine uses this to
 * decide whether a composition's parameter space is too thin.
 *
 * Usage:
 *   npx tsx cli/stats-diff.ts a.svg b.svg c.svg
 *   npx tsx cli/stats-diff.ts --pen-width 0.3 v1.svg v2.svg
 */

import { parseArgs } from "node:util";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { computeVariability } from "../src/stats/variability.js";

const { values: args, positionals } = parseArgs({
  options: {
    "pen-width": { type: "string" },
    compact: { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
  allowPositionals: true,
  strict: false,
});

if (args.help || positionals.length === 0) {
  console.log(`
hatch3d stats:diff — variability across composition variants

Usage:
  npx tsx cli/stats-diff.ts <svg> <svg> [<svg> ...]

Computes path-count CoV and normalized arc-length CoV across the given SVG
variants and classifies the set (low/medium/high). Emits JSON on stdout.

Options:
  --pen-width MM   Override pen width for all variants (default: per-file)
  --compact        Single-line JSON
  -h, --help       Show this help
`);
  process.exit(args.help ? 0 : 1);
}

function main(): void {
  const penWidthMm = args["pen-width"] != null ? Number(args["pen-width"]) : undefined;
  if (penWidthMm != null && (Number.isNaN(penWidthMm) || penWidthMm <= 0)) {
    console.error(`Invalid --pen-width: ${args["pen-width"]}`);
    process.exit(1);
  }

  const svgs = positionals.map((p) => readFileSync(resolve(p), "utf-8"));
  let result;
  try {
    result = computeVariability(svgs, penWidthMm);
  } catch (e) {
    console.error(`stats:diff: ${(e as Error).message}`);
    process.exit(1);
  }

  const withFiles = { files: positionals, ...result };
  const json = args.compact ? JSON.stringify(withFiles) : JSON.stringify(withFiles, null, 2);
  process.stdout.write(json + "\n");
}

main();
