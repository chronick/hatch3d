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
import { generateBiasedPresets, logGeneration, collectFromFeedAPI, collectFromPrintQueue, loadAllObservations, computeModel } from "../src/preferences/index.js";
import type { PreferenceModel, GeneratedPreset } from "../src/preferences/index.js";

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

  // ── 2D Generative (new) ──
  {
    composition: "reactionDiffusion",
    name: "Mitosis Spots",
    description: "Gray-Scott spots pattern — cell-division aesthetic",
    values: { gridResolution: 200, iterations: 8000, feedRate: 0.037, killRate: 0.06, diffusionA: 1.0, diffusionB: 0.5, contourThreshold: 0.25, contourLevels: 2, seedPattern: "center" },
    tags: ["simulation", "biological", "dense"],
  },
  {
    composition: "reactionDiffusion",
    name: "Labyrinth Stripes",
    description: "Gray-Scott labyrinth mode — winding stripe patterns",
    values: { gridResolution: 180, iterations: 10000, feedRate: 0.029, killRate: 0.057, diffusionA: 1.0, diffusionB: 0.5, contourThreshold: 0.3, contourLevels: 1, seedPattern: "random" },
    tags: ["simulation", "biological", "maze-like"],
  },
  {
    composition: "reactionDiffusion",
    name: "Ring Reaction",
    description: "Ring-seeded reaction diffusion — radial symmetry",
    values: { gridResolution: 200, iterations: 6000, feedRate: 0.04, killRate: 0.062, diffusionA: 1.0, diffusionB: 0.5, contourThreshold: 0.2, contourLevels: 3, seedPattern: "ring" },
    tags: ["simulation", "biological", "symmetric"],
  },
  {
    composition: "tspArt",
    name: "Torus Path",
    description: "Travelling salesman path on a torus — single continuous line",
    values: { surfaceType: "torus", pointCount: 1200, distribution: "poisson", rotationX: 0.4, rotationY: 0.3, scale: 140, optimizationPasses: 5 },
    tags: ["generative", "single-line", "3d-mapped"],
  },
  {
    composition: "tspArt",
    name: "Dense Hyperboloid Path",
    description: "High point-count TSP on hyperboloid — intricate single stroke",
    values: { surfaceType: "hyperboloid", pointCount: 2500, distribution: "uniform", rotationX: 0.6, rotationY: 1.0, scale: 120, optimizationPasses: 3 },
    tags: ["generative", "single-line", "dense"],
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

  // ── 3D New ──
  {
    composition: "crystalLattice",
    name: "Small Lattice",
    description: "Compact 2×2×2 crystal lattice with torus nodes",
    values: { gridSize: 2, spacing: 2.5, nodeSize: 0.5, nodeShape: "torus", connectorWidth: 0.05, hatchCount: 25, showConnectors: true },
    camera: { theta: 0.7, phi: 0.35, dist: 10 },
    tags: ["3d", "geometric", "architectural"],
  },
  {
    composition: "crystalLattice",
    name: "Dense Lattice",
    description: "Large 4×4×4 crystal grid — dense molecular structure",
    values: { gridSize: 4, spacing: 1.8, nodeSize: 0.3, nodeShape: "hyperboloid", connectorWidth: 0.03, hatchCount: 15, showConnectors: true },
    camera: { theta: 0.5, phi: 0.25, dist: 14 },
    tags: ["3d", "geometric", "dense"],
  },
  {
    composition: "starburst",
    name: "Sea Urchin",
    description: "Many arms radiating from small hub — spiny organic form",
    values: { arms: 24, reach: 2.5, hubSize: 0.3, armHeight: 0.2, heightVariation: 0.5, spreadVariation: 0.8, baseFanAngle: 0.3, fanAngleVariation: 0.1, hubThickness: 0.1 },
    camera: { theta: 0.6, phi: 0.4, dist: 8 },
    tags: ["3d", "organic", "radial"],
  },
  {
    composition: "starburst",
    name: "Abstract Star",
    description: "Few bold arms with height variation — sculptural",
    values: { arms: 6, reach: 3.5, hubSize: 0.8, armHeight: 1.5, heightVariation: 1.0, spreadVariation: 1.5, baseFanAngle: 0.8, fanAngleVariation: 0.4, hubThickness: 0.2 },
    camera: { theta: 0.8, phi: 0.3, dist: 9 },
    tags: ["3d", "geometric", "bold"],
  },
  {
    composition: "phyllotaxisGarden",
    name: "Fibonacci Garden",
    description: "13 mushroom-like forms in golden-angle spiral arrangement",
    values: { count: 13, spread: 0.55, sizeVariation: 0.6, capSize: 0.9, capSharpness: 5, capSag: 0.45, stemHeight: 1.8, stemWaist: 0.5, showStems: true },
    camera: { theta: 0.5, phi: 0.45, dist: 8 },
    tags: ["3d", "organic", "botanical"],
  },
  {
    composition: "phyllotaxisGarden",
    name: "Dense Canopy",
    description: "Many overlapping caps, no stems — forest canopy from above",
    values: { count: 55, spread: 0.35, sizeVariation: 0.8, capSize: 1.5, capSharpness: 3, capSag: 0.8, stemHeight: 0.5, stemWaist: 0.3, showStems: false },
    camera: { theta: 0.2, phi: 0.8, dist: 7 },
    tags: ["3d", "organic", "dense"],
  },
  {
    composition: "atmosphericDepth",
    name: "Fading Planes",
    description: "Forms receding into fog — hatch density decreases with depth",
    values: { planes: 6, depthSpacing: 3.0, densityFalloff: 0.5, surfaceType: "hyperboloid", radius: 2.0, height: 3.0, frontCount: 50, lateralSpread: 0 },
    camera: { theta: 0.5, phi: 0.3, dist: 12 },
    tags: ["3d", "atmospheric", "layered"],
  },
  {
    composition: "atmosphericDepth",
    name: "Wide Scatter",
    description: "Laterally spread forms at multiple depths — panoramic depth study",
    values: { planes: 8, depthSpacing: 2.0, densityFalloff: 0.6, surfaceType: "torus", radius: 1.5, height: 2.0, frontCount: 35, lateralSpread: 5.0 },
    camera: { theta: 0.4, phi: 0.25, dist: 15 },
    tags: ["3d", "atmospheric", "panoramic"],
  },
  {
    composition: "engravingStudy",
    name: "Classic Engraving",
    description: "Multi-layer crosshatch on hyperboloid — copper-plate aesthetic",
    values: { surfaceType: "hyperboloid", radius: 2.5, height: 4.0, twist: 1.5, waist: 0.4, primaryCount: 45, primaryAngle: 0.78, cross1Count: 30, cross2Count: 20, cross3Count: 0, samples: 100 },
    camera: { theta: 0.6, phi: 0.3, dist: 8 },
    tags: ["3d", "engraving", "dense"],
  },
  {
    composition: "engravingStudy",
    name: "Four-Layer Torus",
    description: "All four hatch layers on torus — maximum density engraving",
    values: { surfaceType: "torus", radius: 2.0, height: 3.0, twist: 0, waist: 0.5, primaryCount: 40, primaryAngle: 0.5, cross1Count: 35, cross2Count: 25, cross3Count: 15, samples: 80 },
    camera: { theta: 0.7, phi: 0.35, dist: 7 },
    tags: ["3d", "engraving", "maximum"],
  },
  {
    composition: "multiTechnique",
    name: "Quadrant Sampler",
    description: "Four hatch techniques in quadrants — u, crosshatch, diagonal, wave",
    values: { surfaceType: "hyperboloid", radius: 2.5, height: 4.0, layout: "quadrants", boundary: 0.5, familyA: "u", familyB: "crosshatch", familyC: "diagonal", familyD: "wave", countA: 30, countB: 25, countC: 35, countD: 20, samples: 80 },
    camera: { theta: 0.6, phi: 0.3, dist: 9 },
    tags: ["3d", "study", "comparison"],
  },
  {
    composition: "multiTechnique",
    name: "Striped Techniques",
    description: "Horizontal strips comparing ring vs crosshatch vs wave",
    values: { surfaceType: "canopy", radius: 2.0, height: 3.5, layout: "hstrips", boundary: 0.5, familyA: "rings", familyB: "crosshatch", familyC: "wave", familyD: "v", countA: 20, countB: 30, countC: 25, countD: 20, samples: 70 },
    camera: { theta: 0.5, phi: 0.35, dist: 8 },
    tags: ["3d", "study", "techniques"],
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
    "no-preferences": { type: "boolean", default: false },
    exploration: { type: "string", default: "0.2" },
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
  --no-preferences       Disable preference model, use only curated presets
  --exploration N        Exploration rate 0-1 (default: 0.2)
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

async function uploadFile(config: { url: string; token: string }, key: string, body: Buffer | string, contentType: string): Promise<void> {
  const resp = await fetch(`${config.url}/image/${key}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": contentType,
    },
    body,
  });
  if (!resp.ok) {
    throw new Error(`Upload failed (${key}): ${resp.status} ${await resp.text()}`);
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

  const noPreferences = args["no-preferences"] ?? false;
  const explorationRate = parseFloat(args.exploration || "0.2");

  const config = dryRun ? { url: "", token: "" } : getFeedConfig();
  const batch = new Date().toISOString().slice(0, 10);
  const modelPath = resolve(import.meta.dirname ?? __dirname, "../data/preferences/model.json");
  const dataDir = resolve(import.meta.dirname ?? __dirname, "../data/preferences");

  let selected: FeedPreset[];
  let generatedPresets: GeneratedPreset[] | null = null;

  // Auto-sync preferences before generation (unless --no-preferences)
  if (!noPreferences && !dryRun) {
    mkdirSync(dataDir, { recursive: true });
    try {
      console.log("Syncing preferences...");
      const feedCount = config.token ? await collectFromFeedAPI(config) : 0;
      const pqCount = collectFromPrintQueue(resolve(process.env.HOME || "~", "git/vault"));
      if (feedCount + pqCount > 0) {
        console.log(`  ${feedCount + pqCount} new observations`);
      }
      const observations = loadAllObservations();
      if (observations.length > 0) {
        const model = computeModel(observations);
        writeFileSync(modelPath, JSON.stringify(model, null, 2));
        console.log(`  Model updated (${observations.length} observations)\n`);
      }
    } catch (e) {
      console.log(`  Preference sync failed (${e instanceof Error ? e.message : e}), continuing without\n`);
    }
  }

  // Use preference model if available, fall back to curated presets
  if (!noPreferences && existsSync(modelPath)) {
    const model: PreferenceModel = JSON.parse(readFileSync(modelPath, "utf-8"));

    const curatedAsGenerated: GeneratedPreset[] = FEED_PRESETS.map((p) => ({
      ...p,
      source: "preset" as const,
      confidence: 0.5,
    }));

    generatedPresets = generateBiasedPresets(model, compositionRegistry, {
      count,
      explorationRate,
      forceComposition,
      curatedPresets: curatedAsGenerated,
    });

    selected = generatedPresets.map((gp) => ({
      composition: gp.composition,
      name: gp.name,
      description: gp.description,
      values: gp.values,
      camera: gp.camera ?? undefined,
      tags: gp.tags,
    }));

    console.log(`Generating ${selected.length} feed items via preference model (exploration: ${(explorationRate * 100).toFixed(0)}%, batch: ${batch})${dryRun ? " [DRY RUN]" : ""}\n`);
  } else {
    selected = selectPresets(count, forceComposition);
    console.log(`Generating ${selected.length} feed items from curated presets (batch: ${batch})${dryRun ? " [DRY RUN]" : ""}\n`);
  }

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

    // Log observation for preference learning
    try {
      logGeneration(
        itemId,
        preset.composition,
        preset.name,
        preset.values,
        preset.camera ?? null,
        preset.tags,
        stats as { lines: number; verts: number; paths: number },
        generatedPresets?.[i]?.source,
        generatedPresets?.[i]?.parentId,
      );
    } catch { /* non-critical */ }

    // Save locally if requested
    if (saveLocal) {
      const localPath = join(resolve(saveLocal), `${itemId}.png`);
      writeFileSync(localPath, pngBuffer);
      console.log(`    Saved: ${localPath}`);
    }

    if (!dryRun) {
      // Upload PNG and SVG to R2
      const imageKey = `plotter/${itemId}.png`;
      const svgKey = `plotter/${itemId}.svg`;
      await uploadFile(config, imageKey, pngBuffer, "image/png");
      await uploadFile(config, svgKey, Buffer.from(svgContent, "utf-8"), "image/svg+xml");

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
          camera: preset.camera ?? null,
          svg_key: svgKey,
          stats,
          tags: preset.tags,
        },
        available_actions: ["accept", "reject", "evolve", "defer"],
      });
      console.log(`    Pushed: ${feedItemId} (png + svg)`);
    }
  }

  console.log(`\nDone.${dryRun ? " (dry run — nothing pushed)" : ""}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
