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
import { evalPatch, evalPatchIterations, patchLayersToGroups } from "../src/patch/graph.js";
import type { EvalResult } from "../src/patch/graph.js";
import { pngImageResolver } from "./load-image.js";
import { buildLayeredSVGContent, computeExportLayout } from "./svg-export.js";

const { values: args } = parseArgs({
  options: {
    dsl: { type: "string" },
    graph: { type: "string" },
    output: { type: "string", short: "o" },
    format: { type: "string", short: "f", default: "svg" },
    scale: { type: "string", default: "4" },
    "print-graph": { type: "boolean", default: false },
    "emit-each-iteration": { type: "boolean", default: false },
    stride: { type: "string", default: "1" },
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
  npx tsx cli/patch.ts --graph FILE -o out.svg --emit-each-iteration

Options:
  --dsl FILE            Patch DSL source (compiles to the JSON graph)
  --graph FILE          Patch JSON graph directly
  -o, --output PATH     Output file (default: stdout for SVG)
  -f, --format FMT      svg (default) or png
  --scale N             PNG scale (default 4)
  --print-graph         Print the compiled JSON graph and exit
  --emit-each-iteration Scrub the first top-level 'repeat': write one file per
                        iteration (out.iter01.svg, out.iter02.svg, …) so you can
                        pick the count where it looks right. Requires --output.
  --stride N            With --emit-each-iteration, keep every Nth frame (the
                        final full-count frame is always kept). Default 1.
  -h, --help            Show this help
`);
  process.exit(args.help ? 0 : 1);
}

loadCompositions();

/** Render one evaluated patch result to an SVG string (+ counts for logging). */
function resultToSVG(result: EvalResult): { svg: string; layers: number; totalPaths: number } {
  const { layers, page } = result;
  const layout = computeExportLayout(page.size, page.orientation, page.marginMm, page.widthPx, page.heightPx);
  const groups = patchLayersToGroups(layers, page);
  const svg = buildLayeredSVGContent(groups, layout, page.marginMm, page.strokeWidthMm);
  const totalPaths = groups.reduce((s, g) => s + g.svgPaths.length, 0);
  return { svg, layers: layers.length, totalPaths };
}

async function svgToPNG(svg: string, scale: number): Promise<Buffer> {
  const withBg = svg.replace(/(viewBox="[^"]*">)/, (m) => {
    const vb = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
    return `${m}\n  <rect width="${vb?.[1] ?? 420}" height="${vb?.[2] ?? 297}" fill="white"/>`;
  });
  const { Resvg } = await import("@resvg/resvg-js");
  const png = new Resvg(withBg, { fitTo: { mode: "zoom" as const, value: scale } }).render();
  return Buffer.from(png.asPng());
}

/** Insert an `.iterNN` tag before the output path's extension. */
function iterationPath(output: string, iter: number, width: number): string {
  const tag = `iter${String(iter).padStart(width, "0")}`;
  const dot = output.lastIndexOf(".");
  return dot < 0 ? `${output}.${tag}` : `${output.slice(0, dot)}.${tag}${output.slice(dot)}`;
}

async function writeResult(result: EvalResult, output: string, format: string, scale: number, label: string): Promise<void> {
  const { svg, layers, totalPaths } = resultToSVG(result);
  if (format === "png") {
    writeFileSync(resolve(output), await svgToPNG(svg, scale));
    console.error(`${label} → ${output} (PNG, ${layers} layers, ${totalPaths} paths)`);
  } else {
    writeFileSync(resolve(output), svg);
    console.error(`${label} → ${output} (SVG, ${layers} layers, ${totalPaths} paths)`);
  }
}

async function main(): Promise<void> {
  const doc = args.dsl
    ? compileDSL(readFileSync(resolve(args.dsl), "utf-8"), { id: args.dsl })
    : JSON.parse(readFileSync(resolve(args.graph!), "utf-8"));

  if (args["print-graph"]) {
    process.stdout.write(JSON.stringify(doc, null, 2) + "\n");
    return;
  }

  const scale = Number(args.scale) || 4;

  // ── Iteration scrub mode ──
  if (args["emit-each-iteration"]) {
    if (!args.output) { console.error("--emit-each-iteration requires --output (frames are written next to it)"); process.exit(1); }
    const stride = Math.max(1, Math.floor(Number(args.stride) || 1));
    const sweep = evalPatchIterations(doc, { resolveImage: pngImageResolver, stride });
    const width = String(sweep.times).length;
    for (const frame of sweep.frames) {
      await writeResult(frame.result, iterationPath(args.output, frame.iter, width), args.format!, scale, `iter ${frame.iter}/${sweep.times}`);
    }
    const strideNote = stride > 1 ? `, stride ${stride}` : "";
    const otherNote = sweep.otherRepeatIds.length ? `; other repeat(s) held at full count: ${sweep.otherRepeatIds.join(", ")}` : "";
    console.error(`Scrubbed repeat "${sweep.repeatId}": ${sweep.frames.length} frame(s) of ${sweep.times}${strideNote}${otherNote}`);
    return;
  }

  const result = evalPatch(doc, { resolveImage: pngImageResolver });

  if (args.format === "png") {
    if (!args.output) { console.error("PNG output requires --output"); process.exit(1); }
    await writeResult(result, args.output, "png", scale, "Patch");
  } else if (args.output) {
    await writeResult(result, args.output, "svg", scale, "Patch");
  } else {
    process.stdout.write(resultToSVG(result).svg);
  }
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
