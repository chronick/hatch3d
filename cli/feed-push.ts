#!/usr/bin/env node
/**
 * hatch3d → feed content pipeline
 *
 * Renders compositions with curated high-leverage parameter selections
 * and pushes them to the feed app for phone-based curation.
 *
 * Usage:
 *   npx tsx cli/feed-push.ts                    # Generate and push a batch
 *   npx tsx cli/feed-push.ts --count 5          # Push 5 items
 *   npx tsx cli/feed-push.ts --composition inkVortex  # Force specific composition
 *   npx tsx cli/feed-push.ts --dry-run          # Render but don't push
 *   npx tsx cli/feed-push.ts --list-presets     # Show all curated presets
 *
 * Environment:
 *   FEED_API_URL   — Feed API base URL (default: https://feed-api.ndonohue.workers.dev)
 *   FEED_API_TOKEN — Bearer token for feed API (default: reads from feed Secrets.xcconfig)
 */

import { parseArgs } from "node:util";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { loadCompositions } from "./load-compositions.js";
import { compositionRegistry } from "../src/compositions/registry.js";
import { is2DComposition } from "../src/compositions/types.js";
import type { CompositionDefinition } from "../src/compositions/types.js";
import { runPipeline } from "../src/workers/render-pipeline.js";
import type { RenderRequest } from "../src/workers/render-worker.types.js";
import { buildSVGContent, computeExportLayout } from "./svg-export.js";

// ── Curated parameter presets for feed-worthy output ──

interface FeedPreset {
  composition: string;
  name: string;
  description: string;
  values: Record<string, unknown>;
  camera?: { theta?: number; phi?: number; dist?: number };
  tags: string[];
}

const FEED_PRESETS: FeedPreset[] = [
  // ── 2D Top Tier ──
  {
    composition: "inkVortex",
    name: "Galaxy Swirl",
    description: "Galaxy vortex arrangement with dense streamlines",
    values: { arrangement: "galaxy", separation: 5, maxSteps: 500, circulationRange: 2 },
    tags: ["fluid", "dense", "organic"],
  },
  {
    composition: "inkVortex",
    name: "Kármán Street",
    description: "Von Kármán vortex street — turbulent wake pattern",
    values: { arrangement: "karman", separation: 6, maxSteps: 400, vortexCount: 8 },
    tags: ["fluid", "turbulence", "scientific"],
  },
  {
    composition: "inkVortex",
    name: "Dipole Flow",
    description: "Clean dipole vortex with tight streamlines",
    values: { arrangement: "dipole", separation: 4, maxSteps: 600, circulationRange: 3 },
    tags: ["fluid", "minimal", "elegant"],
  },
  {
    composition: "inkVortex",
    name: "Turbulent Vortex",
    description: "Random vortices with curl noise turbulence",
    values: { arrangement: "random", separation: 5, maxSteps: 400, curlNoise: 0.5, noiseScale: 0.008, vortexCount: 10 },
    tags: ["fluid", "chaotic", "dense"],
  },
  {
    composition: "flowField",
    name: "Dense Flow",
    description: "Tight simplex noise streamlines with high octaves",
    values: { noiseScale: 0.004, noiseOctaves: 6, seedSpacing: 8, maxSteps: 800, minDistance: 4 },
    tags: ["generative", "dense", "organic"],
  },
  {
    composition: "flowField",
    name: "Sparse Currents",
    description: "Wide-spaced flowing lines with gentle curves",
    values: { noiseScale: 0.002, noiseOctaves: 3, seedSpacing: 20, maxSteps: 1200, minDistance: 12 },
    tags: ["generative", "minimal", "elegant"],
  },
  {
    composition: "truchetMaze",
    name: "Dense Labyrinth",
    description: "Fine-grid Truchet maze with noise bias",
    values: { gridSize: 60, bias: 0.5, noiseScale: 0.05 },
    tags: ["pattern", "maze", "dense"],
  },
  {
    composition: "truchetMaze",
    name: "Coarse Maze",
    description: "Large-tile maze with uniform bias",
    values: { gridSize: 20, bias: 0.5, noiseScale: 0 },
    tags: ["pattern", "maze", "bold"],
  },
  {
    composition: "hilbertFill",
    name: "Hilbert Level 6",
    description: "Dense space-filling fractal curve",
    values: { level: 6, margin: 30, rotation: 0 },
    tags: ["fractal", "mathematical", "dense"],
  },
  {
    composition: "hilbertFill",
    name: "Hilbert Rotated",
    description: "Space-filling curve at 45° rotation",
    values: { level: 5, margin: 20, rotation: 45 },
    tags: ["fractal", "mathematical", "geometric"],
  },
  {
    composition: "guillocheRosette",
    name: "Dense Rosette",
    description: "High-lobe guilloche with many rings",
    values: { rings: 12, layersPerRing: 20, lobes: 20, amplitude: 80, phaseStep: 0.15 },
    tags: ["pattern", "ornamental", "dense"],
  },
  {
    composition: "guillocheRosette",
    name: "Star Guilloche",
    description: "Few lobes, wide amplitude — star-like",
    values: { rings: 8, layersPerRing: 15, lobes: 5, amplitude: 150, phaseStep: 0.1 },
    tags: ["pattern", "ornamental", "bold"],
  },
  {
    composition: "moireCircles",
    name: "Tight Moire",
    description: "Dense concentric circles with slight offset",
    values: { rings: 150, centerOffsetX: 30, centerOffsetY: 20, showSecond: true },
    tags: ["optical", "moire", "hypnotic"],
  },
  {
    composition: "opArtSphere",
    name: "Large Sphere",
    description: "Prominent sphere with strong bulge",
    values: { lineCount: 80, bulgeStrength: 1.2, sphereRadius: 0.4, smoothness: 400, orientation: "h" },
    tags: ["optical", "illusion", "bold"],
  },
  {
    composition: "spirograph",
    name: "Classic Spirograph",
    description: "Dense hypotrochoid with fine detail",
    values: { outerR: 300, innerR: 180, penOffset: 150, revolutions: 100, samples: 8000, layers: 1, mode: "hypo" },
    tags: ["mathematical", "curves", "classic"],
  },
  {
    composition: "spirograph",
    name: "Layered Epitrochoid",
    description: "Multiple epitrochoid layers with offset",
    values: { outerR: 250, innerR: 90, penOffset: 200, revolutions: 60, samples: 5000, layers: 8, layerOffset: 20, mode: "epi" },
    tags: ["mathematical", "curves", "layered"],
  },
  {
    composition: "strangeAttractor",
    name: "Lorenz Butterfly",
    description: "Classic Lorenz attractor — butterfly wings",
    values: { system: "lorenz", iterations: 200000, dt: 0.005, rotationAngle: 0.3, scale: 5, trailCount: 5 },
    tags: ["chaotic", "scientific", "iconic"],
  },
  {
    composition: "strangeAttractor",
    name: "Thomas Attractor",
    description: "Thomas attractor — smooth, cyclonic form",
    values: { system: "thomas", iterations: 300000, dt: 0.01, rotationAngle: 1.2, scale: 8, trailCount: 3 },
    tags: ["chaotic", "scientific", "organic"],
  },
  {
    composition: "voronoiTexture",
    name: "Relaxed Voronoi",
    description: "Lloyd-relaxed Voronoi with organic cells",
    values: { pointCount: 200, distribution: "jitter", relaxIterations: 10, fillCells: false },
    tags: ["tessellation", "organic", "geometric"],
  },
  {
    composition: "photoHalftone",
    name: "Circle Halftone",
    description: "Halftone rendering of circular brightness gradient",
    values: { pattern: "circle", lineCount: 100, frequency: 30, maxAmplitude: 2 },
    tags: ["halftone", "tonal", "classic"],
  },

  // ── 3D Compositions ──
  {
    composition: "crystalSpire",
    name: "Tight Spire",
    description: "Crystal spire with high twist",
    values: { primaryTwist: 4, secondaryTwist: 3, width: 0.8, height: 4, bulge: 0.3 },
    camera: { theta: 0.8, phi: 0.3, dist: 7 },
    tags: ["3d", "organic", "elegant"],
  },
  {
    composition: "dnaHelix",
    name: "Dense DNA",
    description: "Detailed double helix with many rungs",
    values: { strandTwist: 8, rungs: 30, strandWidth: 0.4, rungRadius: 0.6 },
    camera: { theta: 0.5, phi: 0.25, dist: 7 },
    tags: ["3d", "scientific", "dense"],
  },
  {
    composition: "doubleRing",
    name: "Interlocked Rings",
    description: "Classic interlocked torus rings",
    values: { ringRadius: 2, ringSpacing: 1.5, thickness: 0.4 },
    camera: { theta: 0.7, phi: 0.4, dist: 8 },
    tags: ["3d", "geometric", "classic"],
  },
  {
    composition: "vortexTunnel",
    name: "Deep Tunnel",
    description: "Spiraling tunnel of rings",
    values: { rings: 20, baseRadius: 1.5, amplitude: 0.8, spineTwist: 3 },
    camera: { theta: 0.4, phi: 0.2, dist: 9 },
    tags: ["3d", "geometric", "dramatic"],
  },
  {
    composition: "totemStack",
    name: "Mixed Totem",
    description: "Alternating hyperboloid/torus tower",
    values: { tiers: 6, tierShape: "mixed", baseSize: 1.5, taper: 0.15 },
    camera: { theta: 0.6, phi: 0.3, dist: 10 },
    tags: ["3d", "architectural", "stacked"],
  },
  {
    composition: "towerAndBase",
    name: "Tower with Ring",
    description: "Hyperboloid tower with canopies and torus ring",
    values: { towerHeight: 3, towerTwist: 2, canopyRadius: 2, ringSize: 1.5, showRing: true, showTower: true },
    camera: { theta: 0.6, phi: 0.35, dist: 8 },
    tags: ["3d", "architectural", "composed"],
  },
  {
    composition: "ribbonCage",
    name: "Twisted Cage",
    description: "Dense ribbon cage with varied twist",
    values: { ribbons: 12, baseTwist: 3, twistVariation: 2, width: 0.5, height: 4 },
    camera: { theta: 0.7, phi: 0.3, dist: 7 },
    tags: ["3d", "organic", "dense"],
  },
  {
    composition: "nestedShells",
    name: "Concentric Shells",
    description: "Nested hyperboloid shells with caps",
    values: { shells: 5, outerRadius: 2.5, height: 3 },
    camera: { theta: 0.5, phi: 0.3, dist: 9 },
    tags: ["3d", "geometric", "layered"],
  },
  {
    composition: "explodedView",
    name: "Exploded Assembly",
    description: "Technical drawing style — scaled tiers",
    values: { tiers: 5, tierSpacing: 1.5, scaleDecay: 0.7 },
    camera: { theta: 0.5, phi: 0.3, dist: 10 },
    tags: ["3d", "technical", "architectural"],
  },
];

// ── CLI args ──

const { values: args } = parseArgs({
  options: {
    count: { type: "string", short: "n", default: "3" },
    composition: { type: "string", short: "c" },
    "dry-run": { type: "boolean", default: false },
    "list-presets": { type: "boolean", default: false },
    "save-local": { type: "string" },
    scale: { type: "string", default: "4" },
    help: { type: "boolean", short: "h", default: false },
  },
  strict: false,
});

loadCompositions();

if (args.help) {
  console.log(`
hatch3d feed-push — render and push plotter art to feed app

Options:
  -n, --count N          Number of items to generate (default: 3)
  -c, --composition ID   Force specific composition
  --dry-run              Render locally but don't push to feed
  --save-local DIR       Also save renders to local directory
  --list-presets         Show all curated presets
  --scale N              PNG scale factor (default: 4)
  -h, --help             Show this help
  `);
  process.exit(0);
}

if (args["list-presets"]) {
  console.log(`\n${FEED_PRESETS.length} curated presets:\n`);
  for (const p of FEED_PRESETS) {
    console.log(`  ${p.composition.padEnd(20)} "${p.name}" — ${p.description}`);
    console.log(`  ${"".padEnd(20)} tags: ${p.tags.join(", ")}`);
  }
  process.exit(0);
}

// ── Feed API client ──

function getFeedConfig(): { url: string; token: string } {
  const url = process.env.FEED_API_URL || "https://feed-api.ndonohue.workers.dev";
  let token = process.env.FEED_API_TOKEN || "";

  if (!token) {
    // Try reading from feed repo's Secrets.xcconfig
    const secretsPath = resolve(process.env.HOME || "~", "git/feed/Feed/Resources/Secrets.xcconfig");
    if (existsSync(secretsPath)) {
      const content = readFileSync(secretsPath, "utf-8");
      const match = content.match(/API_TOKEN\s*=\s*(.+)/);
      if (match) token = match[1].trim();
    }
  }

  if (!token) {
    console.error("Error: FEED_API_TOKEN not set and not found in Secrets.xcconfig");
    process.exit(1);
  }

  return { url, token };
}

async function uploadImage(config: { url: string; token: string }, key: string, pngBuffer: Buffer): Promise<void> {
  const resp = await fetch(`${config.url}/image/${key}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "image/png",
    },
    body: pngBuffer,
  });
  if (!resp.ok) {
    throw new Error(`Image upload failed: ${resp.status} ${await resp.text()}`);
  }
}

async function pushItem(config: { url: string; token: string }, item: Record<string, unknown>): Promise<string> {
  const resp = await fetch(`${config.url}/items`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(item),
  });
  if (!resp.ok) {
    throw new Error(`Item push failed: ${resp.status} ${await resp.text()}`);
  }
  const data = (await resp.json()) as { items: { id: string }[] };
  return data.items[0].id;
}

// ── Rendering ──

function renderPreset(preset: FeedPreset, scale: number): { svgContent: string; pngBuffer: Buffer | null; stats: Record<string, number>; durationMs: number } {
  const comp = compositionRegistry.get(preset.composition)!;
  const is2d = is2DComposition(comp);

  // Resolve defaults then override with preset values
  const resolvedValues: Record<string, unknown> = {};
  if (comp.controls) {
    for (const [key, ctrl] of Object.entries(comp.controls)) {
      resolvedValues[key] = ctrl.type === "xy" ? ctrl.default : ctrl.default;
    }
  }
  Object.assign(resolvedValues, preset.values);

  const layout = computeExportLayout("a3", "landscape", 15, 800, 800);

  const req: RenderRequest = {
    type: "render",
    id: 1,
    compositionKey: preset.composition,
    is2d,
    width: 800,
    height: 800,
    resolvedValues,
    surfaceKey: "hyperboloid",
    surfaceParams: {},
    hatchParams: { family: "u", count: 30, samples: 50, angle: 0.7 },
    currentHatchGroups: {},
    camera: {
      theta: preset.camera?.theta ?? 0.6,
      phi: preset.camera?.phi ?? 0.35,
      dist: preset.camera?.dist ?? 8,
      ortho: false,
      panX: 0,
      panY: 0,
      width: 800,
      height: 800,
    },
    useOcclusion: false,
    depthRes: 512,
    depthBias: 0.01,
    exportLayout: { contentW: layout.contentW, contentH: layout.contentH, scale: layout.scale },
    showMesh: false,
    densityFilterEnabled: false,
    densityMax: 8,
    densityCellSize: 10,
  };

  const result = runPipeline(req);
  const svgContent = buildSVGContent(result.svgPaths, layout, 15, 0.5);

  return {
    svgContent,
    pngBuffer: null, // Rendered async below
    stats: result.stats,
    durationMs: result.durationMs,
  };
}

async function renderToPng(svgContent: string, scale: number): Promise<Buffer> {
  const withBg = svgContent.replace(
    /(viewBox="[^"]*">)/,
    (match) => {
      const vbMatch = svgContent.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
      const w = vbMatch ? vbMatch[1] : "420";
      const h = vbMatch ? vbMatch[2] : "297";
      return `${match}\n  <rect width="${w}" height="${h}" fill="white"/>`;
    }
  );
  const { Resvg } = await import("@resvg/resvg-js");
  const resvg = new Resvg(withBg, { fitTo: { mode: "zoom" as const, value: scale } });
  const pngData = resvg.render();
  return Buffer.from(pngData.asPng());
}

// ── Selection logic ──

function selectPresets(count: number, forceComposition?: string): FeedPreset[] {
  let pool = FEED_PRESETS;
  if (forceComposition) {
    pool = pool.filter((p) => p.composition === forceComposition);
    if (pool.length === 0) {
      console.error(`No presets for composition: ${forceComposition}`);
      process.exit(1);
    }
  }

  // Shuffle and pick — weighted toward variety (no two of same composition in a batch)
  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  const selected: FeedPreset[] = [];
  const usedCompositions = new Set<string>();

  for (const preset of shuffled) {
    if (selected.length >= count) break;
    // Prefer variety: skip if we already picked this composition (unless we need more)
    if (usedCompositions.has(preset.composition) && shuffled.filter((p) => !usedCompositions.has(p.composition)).length > 0) {
      continue;
    }
    selected.push(preset);
    usedCompositions.add(preset.composition);
  }

  // Fill remaining if variety constraint was too strict
  while (selected.length < count && selected.length < pool.length) {
    const remaining = shuffled.filter((p) => !selected.includes(p));
    if (remaining.length === 0) break;
    selected.push(remaining[0]);
  }

  return selected;
}

// ── Main ──

async function main(): Promise<void> {
  const count = Math.min(parseInt(args.count || "3"), 10);
  const scale = parseInt(args.scale || "4");
  const dryRun = args["dry-run"] ?? false;
  const saveLocal = args["save-local"] as string | undefined;
  const forceComposition = args.composition as string | undefined;

  const config = dryRun ? { url: "", token: "" } : getFeedConfig();
  const batch = new Date().toISOString().slice(0, 10);
  const selected = selectPresets(count, forceComposition);

  console.log(`Generating ${selected.length} feed items (batch: ${batch})${dryRun ? " [DRY RUN]" : ""}\n`);

  if (saveLocal) {
    mkdirSync(resolve(saveLocal), { recursive: true });
  }

  for (let i = 0; i < selected.length; i++) {
    const preset = selected[i];
    const itemId = `hatch3d-${batch}-${preset.composition}-${i}`;

    console.log(`  [${i + 1}/${selected.length}] ${preset.composition} / "${preset.name}"...`);

    // Render
    const { svgContent, stats, durationMs } = renderPreset(preset, scale);

    if (stats.paths === 0) {
      console.log(`    SKIPPED — 0 paths produced`);
      continue;
    }

    const pngBuffer = await renderToPng(svgContent, scale);
    console.log(`    Rendered: ${stats.paths} paths, ${stats.lines} lines (${durationMs.toFixed(0)}ms), PNG ${(pngBuffer.length / 1024).toFixed(0)}KB`);

    // Save locally if requested
    if (saveLocal) {
      const localPath = join(resolve(saveLocal), `${itemId}.png`);
      writeFileSync(localPath, pngBuffer);
      console.log(`    Saved: ${localPath}`);
    }

    if (!dryRun) {
      // Upload image to R2
      const imageKey = `plotter/${itemId}.png`;
      await uploadImage(config, imageKey, pngBuffer);

      // Push item to feed
      const feedItemId = await pushItem(config, {
        id: itemId,
        image_key: imageKey,
        content: `**${preset.name}**\n\n${preset.description}\n\nComposition: \`${preset.composition}\``,
        content_type: "image",
        source: "hatch3d",
        batch,
        metadata: {
          composition: preset.composition,
          presetName: preset.name,
          values: preset.values,
          stats,
          tags: preset.tags,
        },
        available_actions: ["accept", "reject", "evolve", "defer"],
      });
      console.log(`    Pushed: ${feedItemId}`);
    }
  }

  console.log(`\nDone.${dryRun ? " (dry run — nothing pushed)" : ""}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
