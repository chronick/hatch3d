#!/usr/bin/env node
/**
 * hatch3d headless render CLI
 *
 * Renders any composition to SVG or PNG without a browser.
 *
 * Usage:
 *   npx tsx cli/render.ts --composition flow-field --output render.svg
 *   npx tsx cli/render.ts --config presets/dense-flow.json --output render.png --format png
 *   npx tsx cli/render.ts --list
 *   npx tsx cli/render.ts --batch configs/ --output renders/
 */

import { parseArgs } from "node:util";
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from "node:fs";
import { resolve, join, basename } from "node:path";
import { loadCompositions } from "./load-compositions.js";
import { compositionRegistry } from "../src/compositions/registry.js";
import { is2DComposition, isLayeredComposition } from "../src/compositions/types.js";
import type { CompositionDefinition } from "../src/compositions/types.js";
import { runPipeline } from "../src/workers/render-pipeline.js";
import type { RenderRequest } from "../src/workers/render-worker.types.js";
import { buildSVGContent, buildLayeredSVGContent, computeExportLayout } from "./svg-export.js";

// ── Parse CLI arguments ──

const { values: args, positionals } = parseArgs({
  options: {
    composition: { type: "string", short: "c" },
    param: { type: "string", short: "p", multiple: true },
    config: { type: "string" },
    output: { type: "string", short: "o" },
    format: { type: "string", short: "f", default: "svg" },
    scale: { type: "string", default: "4" },
    width: { type: "string", default: "800" },
    height: { type: "string", default: "800" },
    "page-size": { type: "string", default: "a3" },
    orientation: { type: "string", default: "landscape" },
    margin: { type: "string", default: "15" },
    "stroke-width": { type: "string", default: "0.5" },
    surface: { type: "string", default: "hyperboloid" },
    "hatch-family": { type: "string", default: "u" },
    "hatch-count": { type: "string", default: "30" },
    "cam-theta": { type: "string", default: "0.6" },
    "cam-phi": { type: "string", default: "0.35" },
    "cam-dist": { type: "string", default: "8" },
    "cam-ortho": { type: "boolean", default: false },
    list: { type: "boolean", default: false },
    batch: { type: "string" },
    "info": { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
  allowPositionals: true,
  strict: false,
});

// ── Load compositions ──

loadCompositions();

// ── Help ──

if (args.help) {
  console.log(`
hatch3d render CLI — headless composition rendering

Usage:
  npx tsx cli/render.ts [options]

Options:
  -c, --composition ID   Composition to render (use --list to see all)
  -p, --param KEY=VAL    Set a parameter (repeatable)
  --config FILE          Load parameters from JSON config file
  -o, --output PATH      Output file path (default: stdout for SVG)
  -f, --format FMT       Output format: svg (default) or png
  --scale N              PNG scale factor (default: 4)
  --width N              Canvas width in px (default: 800)
  --height N             Canvas height in px (default: 800)
  --page-size SIZE       Page size: a3, a4, a5, letter (default: a3)
  --orientation DIR      landscape or portrait (default: landscape)
  --margin N             Margin in mm (default: 15)
  --stroke-width N       Stroke width (default: 0.5)
  --surface TYPE         Surface for 3D single composition (default: hyperboloid)
  --hatch-family FAM     Hatch family: u, v, diagonal, rings, etc. (default: u)
  --hatch-count N        Number of hatch lines (default: 30)
  --cam-theta N          Camera theta angle (default: 0.6)
  --cam-phi N            Camera phi angle (default: 0.35)
  --cam-dist N           Camera distance (default: 8)
  --cam-ortho            Use orthographic camera
  --list                 List all available compositions
  --info ID              Show composition details (controls, defaults)
  --batch DIR            Batch render all JSON configs in directory
  -h, --help             Show this help

Examples:
  npx tsx cli/render.ts --list
  npx tsx cli/render.ts -c flow-field -o flow.svg
  npx tsx cli/render.ts -c flow-field -p noiseScale=0.005 -p maxSteps=400 -o flow.svg
  npx tsx cli/render.ts --config preset.json -o render.png -f png --scale 6
  npx tsx cli/render.ts --batch configs/ -o renders/
  `);
  process.exit(0);
}

// ── List compositions ──

if (args.list) {
  const all = compositionRegistry.getAllMetadata();
  const grouped: Record<string, typeof all> = {};
  for (const comp of all) {
    const key = `${comp.category.toUpperCase()} / ${comp.type}`;
    (grouped[key] ??= []).push(comp);
  }
  for (const [group, comps] of Object.entries(grouped).sort()) {
    console.log(`\n${group}:`);
    for (const c of comps.sort((a, b) => a.id.localeCompare(b.id))) {
      console.log(`  ${c.id.padEnd(24)} ${c.name}${c.description ? ` — ${c.description}` : ""}`);
    }
  }
  console.log(`\nTotal: ${all.length} compositions`);
  process.exit(0);
}

// ── Info ──

if (args.info) {
  const compId = typeof args.info === "string" ? args.info : positionals[0];
  if (!compId) {
    console.error("Usage: --info <composition-id>");
    process.exit(1);
  }
  const comp = compositionRegistry.get(compId);
  if (!comp) {
    console.error(`Unknown composition: ${compId}`);
    process.exit(1);
  }
  console.log(`\n${comp.name} (${comp.id})`);
  console.log(`  Category: ${comp.category}`);
  console.log(`  Type: ${comp.type ?? "3d"}`);
  if (comp.description) console.log(`  Description: ${comp.description}`);
  if (comp.tags?.length) console.log(`  Tags: ${comp.tags.join(", ")}`);
  if (comp.renderMode) console.log(`  Render mode: ${comp.renderMode}`);
  if (comp.controls) {
    console.log(`\n  Controls:`);
    for (const [key, ctrl] of Object.entries(comp.controls)) {
      if (ctrl.type === "slider") {
        console.log(`    ${key.padEnd(20)} slider  [${ctrl.min} - ${ctrl.max}]  default=${ctrl.default}  step=${ctrl.step ?? "auto"}`);
      } else if (ctrl.type === "toggle") {
        console.log(`    ${key.padEnd(20)} toggle  default=${ctrl.default}`);
      } else if (ctrl.type === "select") {
        console.log(`    ${key.padEnd(20)} select  options=[${ctrl.options.map((o) => o.value).join(", ")}]  default=${ctrl.default}`);
      } else if (ctrl.type === "xy") {
        console.log(`    ${key.padEnd(20)} xy      [${ctrl.min} - ${ctrl.max}]  default=[${ctrl.default.join(", ")}]`);
      }
    }
  }
  if (comp.macros) {
    console.log(`\n  Macros:`);
    for (const [key, macro] of Object.entries(comp.macros)) {
      console.log(`    ${key.padEnd(20)} "${macro.label}"  default=${macro.default}  targets=${macro.targets.map((t) => t.param).join(", ")}`);
    }
  }
  if (isLayeredComposition(comp)) {
    console.log(`\n  Layers:`);
    comp.layers.forEach((layer, i) => {
      const blend = layer.blendMode ?? "over";
      const color = layer.color ?? "(default)";
      const name = layer.name ?? "(unnamed)";
      const mask = layer.blendMode === "masked" ? `  maskBy=${layer.maskBy ?? i - 1}` : "";
      console.log(`    [${i}] ${name.padEnd(20)} composition=${layer.composition}  blend=${blend}  color=${color}${mask}`);
    });
  }
  process.exit(0);
}

// ── Resolve composition and parameters ──

interface RenderConfig {
  composition: string;
  values: Record<string, unknown>;
  format: "svg" | "png";
  scale: number;
  width: number;
  height: number;
  pageSize: string;
  orientation: "landscape" | "portrait";
  margin: number;
  strokeWidth: number;
  surface: string;
  hatchFamily: string;
  hatchCount: number;
  camTheta: number;
  camPhi: number;
  camDist: number;
  camOrtho: boolean;
  output?: string;
}

function resolveConfig(): RenderConfig {
  let config: Partial<RenderConfig> = {};

  // Load from config file if specified
  if (args.config) {
    const configPath = resolve(args.config);
    const raw = JSON.parse(readFileSync(configPath, "utf-8"));
    config = { ...raw };
  }

  // CLI args override config file
  const composition = args.composition ?? config.composition;
  if (!composition) {
    console.error("Error: --composition or --config with composition field required");
    console.error("Use --list to see available compositions, --help for usage");
    process.exit(1);
  }

  // Parse --param flags into values
  const values: Record<string, unknown> = { ...(config.values ?? {}) };
  if (args.param) {
    for (const p of args.param) {
      const eqIdx = p.indexOf("=");
      if (eqIdx === -1) {
        console.error(`Invalid param format: ${p} (expected key=value)`);
        process.exit(1);
      }
      const key = p.slice(0, eqIdx);
      const rawVal = p.slice(eqIdx + 1);
      // Auto-detect type
      if (rawVal === "true") values[key] = true;
      else if (rawVal === "false") values[key] = false;
      else if (!isNaN(Number(rawVal))) values[key] = Number(rawVal);
      else values[key] = rawVal;
    }
  }

  return {
    composition,
    values,
    format: (args.format as "svg" | "png") ?? config.format ?? "svg",
    scale: Number(args.scale) || config.scale || 4,
    width: Number(args.width) || config.width || 800,
    height: Number(args.height) || config.height || 800,
    pageSize: args["page-size"] ?? config.pageSize ?? "a3",
    orientation: (args.orientation as "landscape" | "portrait") ?? config.orientation ?? "landscape",
    margin: Number(args.margin) || config.margin || 15,
    strokeWidth: Number(args["stroke-width"]) || config.strokeWidth || 0.5,
    surface: args.surface ?? config.surface ?? "hyperboloid",
    hatchFamily: args["hatch-family"] ?? config.hatchFamily ?? "u",
    hatchCount: Number(args["hatch-count"]) || config.hatchCount || 30,
    camTheta: Number(args["cam-theta"]) || config.camTheta || 0.6,
    camPhi: Number(args["cam-phi"]) || config.camPhi || 0.35,
    camDist: Number(args["cam-dist"]) || config.camDist || 8,
    camOrtho: args["cam-ortho"] ?? config.camOrtho ?? false,
    output: args.output ?? config.output,
  };
}

function resolveDefaults(comp: CompositionDefinition, values: Record<string, unknown>): Record<string, unknown> {
  const resolved: Record<string, unknown> = {};
  if (comp.controls) {
    for (const [key, ctrl] of Object.entries(comp.controls)) {
      if (ctrl.type === "xy") {
        // XY controls store as array
        resolved[key] = ctrl.default;
      } else {
        resolved[key] = ctrl.default;
      }
    }
  }
  // Override with provided values
  Object.assign(resolved, values);
  return resolved;
}

function renderOne(config: RenderConfig): { svgContent: string; stats: { lines: number; verts: number; paths: number }; durationMs: number } {
  const comp = compositionRegistry.get(config.composition);
  if (!comp) {
    console.error(`Unknown composition: ${config.composition}`);
    console.error(`Use --list to see available compositions`);
    process.exit(1);
  }

  const isLayered = isLayeredComposition(comp);
  const is2d = !isLayered && is2DComposition(comp);
  const resolvedValues = resolveDefaults(comp, config.values);

  const layout = computeExportLayout(
    config.pageSize,
    config.orientation,
    config.margin,
    config.width,
    config.height,
  );

  // Build default surface params
  const surfaceParams: Record<string, number> = {};

  const req: RenderRequest = {
    type: "render",
    id: 1,
    compositionKey: config.composition,
    is2d,
    width: config.width,
    height: config.height,
    resolvedValues,
    surfaceKey: config.surface,
    surfaceParams,
    hatchParams: {
      family: config.hatchFamily,
      count: config.hatchCount,
      samples: 50,
      angle: 0.7,
    },
    currentHatchGroups: {},
    camera: {
      theta: config.camTheta,
      phi: config.camPhi,
      dist: config.camDist,
      ortho: config.camOrtho,
      panX: 0,
      panY: 0,
      width: config.width,
      height: config.height,
    },
    useOcclusion: false, // Skip in headless mode (requires WebGL)
    depthRes: 512,
    depthBias: 0.01,
    exportLayout: {
      contentW: layout.contentW,
      contentH: layout.contentH,
      scale: layout.scale,
    },
    showMesh: false,
    densityFilterEnabled: false,
    densityMax: 8,
    densityCellSize: 10,
  };

  const result = runPipeline(req);

  const svgContent =
    result.layerGroups && result.layerGroups.length > 0
      ? buildLayeredSVGContent(result.layerGroups, layout, config.margin, config.strokeWidth)
      : buildSVGContent(result.svgPaths, layout, config.margin, config.strokeWidth);

  return {
    svgContent,
    stats: result.stats,
    durationMs: result.durationMs,
  };
}

async function renderToPng(svgContent: string, scale: number): Promise<Buffer> {
  // Add white background for PNG output (SVG has transparent bg by default)
  const withBg = svgContent.replace(
    /(viewBox="[^"]*">)/,
    (match) => {
      const vbMatch = svgContent.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
      const w = vbMatch ? vbMatch[1] : "420";
      const h = vbMatch ? vbMatch[2] : "297";
      return `${match}\n  <rect width="${w}" height="${h}" fill="white"/>`;
    }
  );

  // Dynamic import — only loaded when PNG output is needed
  const { Resvg } = await import("@resvg/resvg-js");
  const resvg = new Resvg(withBg, {
    fitTo: { mode: "zoom" as const, value: scale },
  });
  const pngData = resvg.render();
  return Buffer.from(pngData.asPng());
}

// ── Batch mode ──

async function runBatch(batchDir: string, outputDir: string): Promise<void> {
  const dir = resolve(batchDir);
  if (!existsSync(dir)) {
    console.error(`Batch directory not found: ${dir}`);
    process.exit(1);
  }

  const outDir = resolve(outputDir);
  mkdirSync(outDir, { recursive: true });

  const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  if (files.length === 0) {
    console.error(`No .json config files found in ${dir}`);
    process.exit(1);
  }

  console.log(`Batch rendering ${files.length} configs from ${dir}`);

  for (const file of files) {
    const configPath = join(dir, file);
    const raw = JSON.parse(readFileSync(configPath, "utf-8"));
    const config: RenderConfig = {
      composition: raw.composition,
      values: raw.values ?? {},
      format: raw.format ?? "svg",
      scale: raw.scale ?? 4,
      width: raw.width ?? 800,
      height: raw.height ?? 800,
      pageSize: raw.pageSize ?? "a3",
      orientation: raw.orientation ?? "landscape",
      margin: raw.margin ?? 15,
      strokeWidth: raw.strokeWidth ?? 0.5,
      surface: raw.surface ?? "hyperboloid",
      hatchFamily: raw.hatchFamily ?? "u",
      hatchCount: raw.hatchCount ?? 30,
      camTheta: raw.camTheta ?? 0.6,
      camPhi: raw.camPhi ?? 0.35,
      camDist: raw.camDist ?? 8,
      camOrtho: raw.camOrtho ?? false,
    };

    const outputName = basename(file, ".json");
    const ext = config.format === "png" ? ".png" : ".svg";
    const outputPath = join(outDir, `${outputName}${ext}`);

    try {
      const { svgContent, stats, durationMs } = renderOne(config);

      if (config.format === "png") {
        const pngBuf = await renderToPng(svgContent, config.scale);
        writeFileSync(outputPath, pngBuf);
      } else {
        writeFileSync(outputPath, svgContent);
      }

      console.log(`  ${outputName}${ext}  ${stats.paths} paths, ${stats.lines} lines  (${durationMs.toFixed(0)}ms)`);
    } catch (e) {
      console.error(`  FAILED ${file}: ${(e as Error).message}`);
    }
  }
}

// ── Main ──

async function main(): Promise<void> {
  if (args.batch) {
    const outputDir = args.output ?? "renders";
    await runBatch(args.batch, outputDir);
    return;
  }

  const config = resolveConfig();
  const { svgContent, stats, durationMs } = renderOne(config);

  if (config.format === "png") {
    if (!config.output) {
      console.error("PNG output requires --output path");
      process.exit(1);
    }
    const pngBuf = await renderToPng(svgContent, config.scale);
    writeFileSync(resolve(config.output), pngBuf);
    console.error(`Rendered ${config.composition} → ${config.output} (PNG ${config.scale}x, ${stats.paths} paths, ${stats.lines} lines, ${durationMs.toFixed(0)}ms)`);
  } else if (config.output) {
    writeFileSync(resolve(config.output), svgContent);
    console.error(`Rendered ${config.composition} → ${config.output} (SVG, ${stats.paths} paths, ${stats.lines} lines, ${durationMs.toFixed(0)}ms)`);
  } else {
    // Write SVG to stdout
    process.stdout.write(svgContent);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
