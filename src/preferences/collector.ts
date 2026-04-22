/**
 * Preference data collector.
 *
 * Gathers accept/reject signals from two sources:
 *   1. Feed API actions (primary — phone-based curation)
 *   2. Vault print-queue configs (cross-validation — definitively accepted)
 *
 * Writes observations to data/preferences/observations.jsonl (append-only).
 */

import { readFileSync, writeFileSync, appendFileSync, existsSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { compositionRegistry } from "../compositions/registry.js";
import { extractFeatures } from "./features.js";
import { loadCorrelationStore, saveCorrelationStore } from "./correlation-store.js";
import { recordObservationCorrelations } from "./correlation-recorder.js";
import type { Observation, Outcome, SyncState, NormalizedFeatures } from "./types.js";

const DATA_DIR = resolve(import.meta.dirname ?? __dirname, "../../data/preferences");
const OBSERVATIONS_PATH = join(DATA_DIR, "observations.jsonl");
const SYNC_STATE_PATH = join(DATA_DIR, "sync-state.json");
const CORRELATIONS_PATH = join(DATA_DIR, "correlations.json");

// ── Feed API types ──

interface FeedAction {
  id: string;
  item_id: string;
  action: string;
  acted_at: string;
  source?: string;
  metadata?: string;
  // Joined from items table
  image_key?: string;
  content?: string;
  content_type?: string;
  batch?: string;
}

// ── Helpers ──

function loadSyncState(): SyncState {
  if (existsSync(SYNC_STATE_PATH)) {
    return JSON.parse(readFileSync(SYNC_STATE_PATH, "utf-8"));
  }
  return { lastActionSync: null, lastPrintQueueScan: null };
}

function saveSyncState(state: SyncState): void {
  writeFileSync(SYNC_STATE_PATH, JSON.stringify(state, null, 2));
}

function loadExistingIds(): Set<string> {
  const ids = new Set<string>();
  if (existsSync(OBSERVATIONS_PATH)) {
    const lines = readFileSync(OBSERVATIONS_PATH, "utf-8").split("\n").filter(Boolean);
    for (const line of lines) {
      try {
        const obs = JSON.parse(line) as Observation;
        ids.add(obs.id);
      } catch { /* skip malformed */ }
    }
  }
  return ids;
}

function appendObservation(obs: Observation): void {
  appendFileSync(OBSERVATIONS_PATH, JSON.stringify(obs) + "\n");
}

export function loadAllObservations(): Observation[] {
  if (!existsSync(OBSERVATIONS_PATH)) return [];
  return readFileSync(OBSERVATIONS_PATH, "utf-8")
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try { return JSON.parse(line) as Observation; }
      catch { return null; }
    })
    .filter((o): o is Observation => o !== null);
}

function mapActionToOutcome(action: string): Outcome {
  switch (action) {
    case "accept": return "accepted";
    case "reject": return "rejected";
    case "evolve": return "evolved";
    case "defer": return "deferred";
    default: return "unseen";
  }
}

function buildObservation(
  id: string,
  composition: string,
  presetName: string | null,
  values: Record<string, unknown>,
  camera: { theta?: number; phi?: number; dist?: number } | null,
  tags: string[],
  stats: { lines: number; verts: number; paths: number },
  outcome: Outcome,
  timestamp: string,
): Observation | null {
  const comp = compositionRegistry.get(composition);
  if (!comp) return null;

  const features = extractFeatures(comp, values, stats);

  return {
    id,
    timestamp,
    composition,
    presetName,
    values,
    camera,
    tags,
    stats,
    outcome,
    features,
  };
}

// ── Collection from Feed API ──

export async function collectFromFeedAPI(config: { url: string; token: string }): Promise<number> {
  const state = loadSyncState();
  const existingIds = loadExistingIds();
  let correlationStore = loadCorrelationStore(CORRELATIONS_PATH);

  let url = `${config.url}/actions`;
  if (state.lastActionSync) {
    url += `?since=${encodeURIComponent(state.lastActionSync)}`;
  }

  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${config.token}` },
  });

  if (!resp.ok) {
    throw new Error(`Feed API error: ${resp.status} ${await resp.text()}`);
  }

  const data = (await resp.json()) as { actions: FeedAction[] };
  let count = 0;
  let latestTimestamp = state.lastActionSync;

  for (const action of data.actions) {
    // Only process hatch3d items
    const itemId = action.item_id;
    if (!itemId.startsWith("hatch3d-")) continue;

    // Parse metadata (may be stringified JSON)
    let metadata: Record<string, unknown>;
    try {
      metadata = typeof action.metadata === "string"
        ? JSON.parse(action.metadata)
        : (action.metadata as Record<string, unknown>) ?? {};
    } catch {
      continue;
    }

    const composition = metadata.composition as string;
    if (!composition) continue;

    // Deduplicate — if we already have this observation, update outcome if changed
    const observationId = itemId;
    if (existingIds.has(observationId)) continue;

    const obs = buildObservation(
      observationId,
      composition,
      (metadata.presetName as string) ?? null,
      (metadata.values as Record<string, unknown>) ?? {},
      (metadata.camera as { theta?: number; phi?: number; dist?: number }) ?? null,
      (metadata.tags as string[]) ?? [],
      (metadata.stats as { lines: number; verts: number; paths: number }) ?? { lines: 0, verts: 0, paths: 0 },
      mapActionToOutcome(action.action),
      action.acted_at,
    );

    if (obs) {
      appendObservation(obs);
      correlationStore = recordObservationCorrelations(correlationStore, obs);
      existingIds.add(observationId);
      count++;
    }

    if (!latestTimestamp || action.acted_at > latestTimestamp) {
      latestTimestamp = action.acted_at;
    }
  }

  state.lastActionSync = latestTimestamp;
  saveSyncState(state);
  if (count > 0) {
    saveCorrelationStore(correlationStore, CORRELATIONS_PATH);
  }
  return count;
}

// ── Collection from print queue ──

export function collectFromPrintQueue(vaultDir: string): number {
  const printQueueDir = join(vaultDir, "print-queue");
  if (!existsSync(printQueueDir)) return 0;

  const existingIds = loadExistingIds();
  let correlationStore = loadCorrelationStore(CORRELATIONS_PATH);
  let count = 0;

  const dirs = readdirSync(printQueueDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name.startsWith("hatch3d-"));

  for (const dir of dirs) {
    const configPath = join(printQueueDir, dir.name, "config.json");
    if (!existsSync(configPath)) continue;

    const observationId = dir.name;
    if (existingIds.has(observationId)) continue;

    try {
      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      const obs = buildObservation(
        observationId,
        config.composition,
        config.presetName ?? null,
        config.values ?? {},
        config.camera ?? null,
        config.tags ?? [],
        config.stats ?? { lines: 0, verts: 0, paths: 0 },
        "accepted", // In print queue = definitively accepted
        new Date().toISOString(),
      );

      if (obs) {
        appendObservation(obs);
        correlationStore = recordObservationCorrelations(correlationStore, obs);
        count++;
      }
    } catch { /* skip malformed */ }
  }

  if (count > 0) {
    saveCorrelationStore(correlationStore, CORRELATIONS_PATH);
  }
  return count;
}

// ── Log a generation (called by feed-push before pushing) ──

export function logGeneration(
  id: string,
  composition: string,
  presetName: string | null,
  values: Record<string, unknown>,
  camera: { theta?: number; phi?: number; dist?: number } | null,
  tags: string[],
  stats: { lines: number; verts: number; paths: number },
  source?: string,
  parentId?: string,
): void {
  const existingIds = loadExistingIds();
  if (existingIds.has(id)) return;

  const obs = buildObservation(
    id,
    composition,
    presetName,
    values,
    camera,
    tags,
    stats,
    "unseen",
    new Date().toISOString(),
  );

  if (obs) {
    if (parentId) obs.parentId = parentId;
    appendObservation(obs);
  }
}
