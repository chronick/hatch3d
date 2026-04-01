#!/usr/bin/env node
/**
 * Preference sync CLI — collect curation signals and compute preference model.
 *
 * Usage:
 *   npx tsx cli/preference-sync.ts              # Collect + recompute model
 *   npx tsx cli/preference-sync.ts --collect    # Only collect new observations
 *   npx tsx cli/preference-sync.ts --learn      # Only recompute model from existing observations
 *   npx tsx cli/preference-sync.ts --stats      # Print current model summary
 *   npx tsx cli/preference-sync.ts --export     # Export model as JSON to stdout
 */

import { parseArgs } from "node:util";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { loadCompositions } from "./load-compositions.js";
import {
  collectFromFeedAPI,
  collectFromPrintQueue,
  loadAllObservations,
  computeModel,
  summarizeModel,
} from "../src/preferences/index.js";
import type { PreferenceModel } from "../src/preferences/index.js";

const DATA_DIR = resolve(import.meta.dirname ?? __dirname, "../data/preferences");
const MODEL_PATH = join(DATA_DIR, "model.json");
const VAULT_DIR = resolve(process.env.HOME || "~", "git/vault");

const { values: args } = parseArgs({
  options: {
    collect: { type: "boolean", default: false },
    learn: { type: "boolean", default: false },
    stats: { type: "boolean", default: false },
    export: { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
  strict: false,
});

loadCompositions();

if (args.help) {
  console.log(`
preference-sync — collect curation signals and compute preference model

Options:
  --collect    Only collect new observations from feed API + print queue
  --learn      Only recompute model from existing observations
  --stats      Print current model summary
  --export     Export model as JSON to stdout
  -h, --help   Show this help

With no flags: runs collect + learn (full sync).
  `);
  process.exit(0);
}

function getFeedConfig(): { url: string; token: string } {
  const url = process.env.FEED_API_URL || "https://feed-api.ndonohue.workers.dev";
  let token = process.env.FEED_API_TOKEN || "";

  if (!token) {
    const secretsPath = resolve(process.env.HOME || "~", "git/feed/Feed/Resources/Secrets.xcconfig");
    if (existsSync(secretsPath)) {
      const content = readFileSync(secretsPath, "utf-8");
      const match = content.match(/API_TOKEN\s*=\s*(.+)/);
      if (match) token = match[1].trim();
    }
  }

  return { url, token };
}

function loadModel(): PreferenceModel | null {
  if (existsSync(MODEL_PATH)) {
    return JSON.parse(readFileSync(MODEL_PATH, "utf-8"));
  }
  return null;
}

function saveModel(model: PreferenceModel): void {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(MODEL_PATH, JSON.stringify(model, null, 2));
}

async function runCollect(): Promise<number> {
  const config = getFeedConfig();
  let total = 0;

  if (config.token) {
    console.log("Collecting from feed API...");
    const feedCount = await collectFromFeedAPI(config);
    console.log(`  ${feedCount} new observations from feed API`);
    total += feedCount;
  } else {
    console.log("  Skipping feed API (no token)");
  }

  console.log("Scanning print queue...");
  const pqCount = collectFromPrintQueue(VAULT_DIR);
  console.log(`  ${pqCount} new observations from print queue`);
  total += pqCount;

  return total;
}

function runLearn(): PreferenceModel {
  const observations = loadAllObservations();
  console.log(`Computing model from ${observations.length} observations...`);
  const model = computeModel(observations);
  saveModel(model);
  console.log(`Model saved to ${MODEL_PATH}`);
  return model;
}

async function main(): Promise<void> {
  mkdirSync(DATA_DIR, { recursive: true });

  const doCollect = args.collect || (!args.learn && !args.stats && !args.export);
  const doLearn = args.learn || (!args.collect && !args.stats && !args.export);
  const doStats = args.stats;
  const doExport = args.export;

  if (doCollect) {
    const count = await runCollect();
    console.log(`Total new observations: ${count}`);
    console.log("");
  }

  if (doLearn) {
    const model = runLearn();
    console.log("");
    console.log(summarizeModel(model));
  }

  if (doStats) {
    const model = loadModel();
    if (!model) {
      console.log("No model found. Run without flags to collect + learn first.");
      process.exit(1);
    }
    console.log(summarizeModel(model));
  }

  if (doExport) {
    const model = loadModel();
    if (!model) {
      console.log("No model found. Run without flags to collect + learn first.");
      process.exit(1);
    }
    console.log(JSON.stringify(model, null, 2));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
