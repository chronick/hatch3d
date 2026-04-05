/**
 * Composition exploration scoring system.
 *
 * Tracks which compositions have been explored (viewed/exported/favorited)
 * and suggests underexplored ones using a UCB1-variant scoring algorithm.
 *
 * All data is persisted to localStorage under the key "hatch3d-exploration".
 * No external dependencies — pure reads/writes to localStorage.
 */

// ── Types ──

export interface CompositionStats {
  views: number;
  exports: number;
  favorites: number;
  lastViewed: number;   // timestamp (ms)
  lastExported: number; // timestamp (ms)
}

export interface ExplorationSuggestion {
  id: string;
  score: number;
  reason: "new" | "underexplored" | "high-potential" | "time-to-revisit";
}

interface StorageData {
  stats: Record<string, CompositionStats>;
  totalViews: number;
}

// ── Constants ──

const STORAGE_KEY = "hatch3d-exploration";
const UCB_C = 1.5;
const RECENCY_PENALTY = 0.1;
const REVISIT_THRESHOLD_DAYS = 7;
const MS_PER_DAY = 86_400_000;

// ── Storage helpers ──

function load(): StorageData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { stats: {}, totalViews: 0 };
    const parsed = JSON.parse(raw) as StorageData;
    if (!parsed || typeof parsed.totalViews !== "number" || !parsed.stats) {
      return { stats: {}, totalViews: 0 };
    }
    return parsed;
  } catch {
    return { stats: {}, totalViews: 0 };
  }
}

function save(data: StorageData): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // localStorage full or unavailable — silently fail
  }
}

function ensureStats(data: StorageData, id: string): CompositionStats {
  if (!data.stats[id]) {
    data.stats[id] = { views: 0, exports: 0, favorites: 0, lastViewed: 0, lastExported: 0 };
  }
  return data.stats[id];
}

// ── Public API ──

/** Record that a composition was viewed. */
export function recordView(compositionId: string): void {
  const data = load();
  const stats = ensureStats(data, compositionId);
  stats.views++;
  stats.lastViewed = Date.now();
  data.totalViews++;
  save(data);
}

/** Record that a composition was exported (stronger signal than view). */
export function recordExport(compositionId: string): void {
  const data = load();
  const stats = ensureStats(data, compositionId);
  stats.exports++;
  stats.lastExported = Date.now();
  save(data);
}

/** Record that a composition was favorited (strongest signal). */
export function recordFavorite(compositionId: string): void {
  const data = load();
  const stats = ensureStats(data, compositionId);
  stats.favorites++;
  save(data);
}

/** Get exploration scores for all compositions. Higher = more worth exploring. */
export function getExplorationScores(allCompositionIds: string[]): Map<string, number> {
  const data = load();
  const scores = new Map<string, number>();
  const totalViews = Math.max(data.totalViews, 1);
  const now = Date.now();

  for (const id of allCompositionIds) {
    const stats = data.stats[id];

    // Never-viewed compositions get infinite score — always suggest first
    if (!stats || stats.views === 0) {
      scores.set(id, Infinity);
      continue;
    }

    const views = stats.views;

    // Exploitation: how much the user engages with this composition
    const exploitation = (stats.exports * 3 + stats.favorites * 5) / views;

    // Exploration bonus: UCB1 upper confidence bound
    const explorationBonus = UCB_C * Math.sqrt(Math.log(totalViews) / views);

    // Recency bonus: penalize recently-viewed, encourage unseen
    const daysSinceLastView = (now - stats.lastViewed) / MS_PER_DAY;
    const recencyBonus = -RECENCY_PENALTY * daysSinceLastView;

    const score = exploitation + explorationBonus + recencyBonus;
    scores.set(id, score);
  }

  return scores;
}

/** Get a ranked list of compositions to explore, with scores and reasons. */
export function getSuggestions(allCompositionIds: string[], count = 5): ExplorationSuggestion[] {
  const data = load();
  const scores = getExplorationScores(allCompositionIds);
  const now = Date.now();

  // Compute median views for "underexplored" classification
  const viewCounts = allCompositionIds
    .map((id) => data.stats[id]?.views ?? 0)
    .filter((v) => v > 0)
    .sort((a, b) => a - b);
  const medianViews = viewCounts.length > 0
    ? viewCounts[Math.floor(viewCounts.length / 2)]
    : 0;

  const suggestions: ExplorationSuggestion[] = [];

  for (const id of allCompositionIds) {
    const score = scores.get(id) ?? 0;
    const stats = data.stats[id];
    const reason = classifyReason(stats, medianViews, now);
    suggestions.push({ id, score, reason });
  }

  // Sort descending by score (Infinity sorts to top)
  suggestions.sort((a, b) => {
    if (a.score === Infinity && b.score === Infinity) return 0;
    if (a.score === Infinity) return -1;
    if (b.score === Infinity) return 1;
    return b.score - a.score;
  });

  return suggestions.slice(0, count);
}

/** Get raw stats for a composition. */
export function getStats(compositionId: string): CompositionStats {
  const data = load();
  return data.stats[compositionId] ?? {
    views: 0,
    exports: 0,
    favorites: 0,
    lastViewed: 0,
    lastExported: 0,
  };
}

/** Reset all exploration data. */
export function resetExploration(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // localStorage unavailable — silently fail
  }
}

// ── Internal helpers ──

function classifyReason(
  stats: CompositionStats | undefined,
  medianViews: number,
  now: number,
): ExplorationSuggestion["reason"] {
  // No stats or zero views → new
  if (!stats || stats.views === 0) {
    return "new";
  }

  const exploitation = (stats.exports * 3 + stats.favorites * 5) / stats.views;
  const daysSinceLastView = (now - stats.lastViewed) / MS_PER_DAY;

  // Time to revisit: last viewed > 7 days ago AND has been exported before
  if (daysSinceLastView > REVISIT_THRESHOLD_DAYS && stats.exports > 0) {
    return "time-to-revisit";
  }

  // High potential: user tends to export/favorite this one
  if (exploitation >= 1) {
    return "high-potential";
  }

  // Underexplored: below median views AND has positive exploitation
  if (stats.views < medianViews && exploitation > 0) {
    return "underexplored";
  }

  // Default: underexplored (below median) or high-potential (fallback)
  if (stats.views <= medianViews) {
    return "underexplored";
  }

  return "high-potential";
}
