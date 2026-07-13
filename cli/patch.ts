#!/usr/bin/env node
/**
 * hatch3d patch CLI — evaluate a patch (DSL or JSON graph) to SVG/PNG.
 *
 * A patch is the L2 signal-flow extension of the Scene IR: generators + fields
 * (the CV bus) + field-modulated operators + bounded `repeat`. It evaluates
 * deterministically to polylines, so the output renders reproducibly and the
 * stats CLI measures it — the patch stays inside the deterministic loop.
 *
 * Usage:
 *   npx tsx cli/patch.ts --dsl patch.patch -o out.svg
 *   npx tsx cli/patch.ts --graph patch.json -o out.png -f png
 *   npx tsx cli/patch.ts --dsl patch.patch --print-graph   # show compiled JSON
 */

import { parseArgs } from "node:util";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadCompositions } from "./load-compositions.js";
import { compileDSL } from "../src/patch/dsl.js";
import { evalPatch, patchLayersToGroups } from "../src/patch/graph.js";
import { buildLayeredSVGContent, computeExportLayout } from "./svg-export.js";

const { values: args } = parseArgs({
  options: {
    dsl: { type: "string" },
    graph: { type: "string" },
    output: { type: "string", short: "o" },
    format: { type: "string", short: "f", default: "svg" },
    scale: { type: "string", default: "4" },
    "print-graph": { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
  allowPositionals: true,
  strict: false,
});

if (args.help || (!args.dsl && !args.graph)) {
  console.log(`
hatch3d patch CLI — evaluate a signal-flow patch to SVG/PNG

Usage:
  npx tsx cli/patch.ts --dsl FILE   [-o out.svg]
  npx tsx cli/patch.ts --graph FILE [-o out.png -f png]

Options:
  --dsl FILE        Patch DSL source (compiles to the JSON graph)
  --graph FILE      Patch JSON graph directly
  -o, --output PATH Output file (default: stdout for SVG)
  -f, --format FMT  svg (default) or png
  --scale N         PNG scale (default 4)
  --print-graph     Print the compiled JSON graph and exit
  -h, --help        Show this help
`);
  process.exit(args.help ? 0 : 1);
}

loadCompositions();

async function main(): Promise<void> {
  const doc = args.dsl
    ? compileDSL(readFileSync(resolve(args.dsl), "utf-8"), { id: args.dsl })
    : JSON.parse(readFileSync(resolve(args.graph!), "utf-8"));

  if (args["print-graph"]) {
    process.stdout.write(JSON.stringify(doc, null, 2) + "\n");
    return;
  }

  const { layers, page } = evalPatch(doc);
  const layout = computeExportLayout(page.size, page.orientation, page.marginMm, page.widthPx, page.heightPx);
  const groups = patchLayersToGroups(layers, page);
  const svg = buildLayeredSVGContent(groups, layout, page.marginMm, page.strokeWidthMm);
  const totalPaths = groups.reduce((s, g) => s + g.svgPaths.length, 0);

  if (args.format === "png") {
    if (!args.output) { console.error("PNG output requires --output"); process.exit(1); }
    const withBg = svg.replace(/(viewBox="[^"]*">)/, (m) => {
      const vb = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
      return `${m}\n  <rect width="${vb?.[1] ?? 420}" height="${vb?.[2] ?? 297}" fill="white"/>`;
    });
    const { Resvg } = await import("@resvg/resvg-js");
    const png = new Resvg(withBg, { fitTo: { mode: "zoom" as const, value: Number(args.scale) || 4 } }).render();
    writeFileSync(resolve(args.output), Buffer.from(png.asPng()));
    console.error(`Patch → ${args.output} (PNG, ${layers.length} layers, ${totalPaths} paths)`);
  } else if (args.output) {
    writeFileSync(resolve(args.output), svg);
    console.error(`Patch → ${args.output} (SVG, ${layers.length} layers, ${totalPaths} paths)`);
  } else {
    process.stdout.write(svg);
  }
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
