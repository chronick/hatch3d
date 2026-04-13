/**
 * Brief-to-intent mapping.
 *
 * Parses a creative brief (free-text string) into an IntentVector
 * that biases composition selection and parameter generation.
 *
 * Pure keyword matching against composition metadata — no LLM calls.
 * The LLM call (if any) happens upstream (e.g. Lemon Chan crafts the brief).
 * This module just interprets it against the composition library.
 */

import type { CompositionDefinition } from "../compositions/types.js";
import type { CompositionRegistry } from "../compositions/registry.js";
import type { IntentVector } from "./types.js";

/** Words that signal high exploration / novelty injection */
const NOVELTY_WORDS = new Set([
  "surprise", "unexpected", "wild", "weird", "chaotic", "random",
  "bold", "experimental", "new", "different", "unfamiliar", "push",
]);

/** Words that signal tight exploitation / refinement */
const REFINE_WORDS = new Set([
  "more", "similar", "like", "refine", "polish", "subtle",
  "gentle", "careful", "tuned", "precise",
]);

/**
 * Parse a creative brief into an IntentVector.
 *
 * Scores each composition by keyword overlap between the brief
 * and the composition's id, name, description, tags, and control names.
 * Also extracts tag affinities from brief words that match known tags.
 */
export function briefToIntent(
  brief: string,
  registry: CompositionRegistry,
): IntentVector {
  const words = tokenize(brief);
  const wordSet = new Set(words);

  // Collect all tags across compositions for affinity scoring
  const allTags = new Set<string>();
  for (const [, comp] of registry.getAll()) {
    for (const tag of comp.tags ?? []) allTags.add(tag.toLowerCase());
  }

  // Tag affinities: brief words that match known tags get +1
  const tagAffinities: Record<string, number> = {};
  for (const tag of allTags) {
    if (wordSet.has(tag)) {
      tagAffinities[tag] = 1.0;
    }
    // Check if any brief word is a substring of the tag or vice versa
    for (const word of words) {
      if (word.length >= 3 && tag.includes(word) && !tagAffinities[tag]) {
        tagAffinities[tag] = 0.5;
      }
      if (word.length >= 3 && word.includes(tag) && !tagAffinities[tag]) {
        tagAffinities[tag] = 0.5;
      }
    }
  }

  // Score each composition
  const compositionWeights: Record<string, number> = {};
  for (const [id, comp] of registry.getAll()) {
    compositionWeights[id] = scoreComposition(comp, words, wordSet, tagAffinities);
  }

  // Determine exploration override from novelty/refine signals
  let explorationOverride: number | undefined;
  const noveltyCount = words.filter((w) => NOVELTY_WORDS.has(w)).length;
  const refineCount = words.filter((w) => REFINE_WORDS.has(w)).length;
  if (noveltyCount > 0 && refineCount === 0) {
    explorationOverride = Math.min(0.8, 0.3 + noveltyCount * 0.15);
  } else if (refineCount > 0 && noveltyCount === 0) {
    explorationOverride = Math.max(0.05, 0.15 - refineCount * 0.03);
  }

  return { brief, compositionWeights, tagAffinities, explorationOverride };
}

/**
 * Score how well a composition matches the brief.
 * Returns a weight multiplier (1.0 = neutral, >1 = boosted, <1 = suppressed).
 */
function scoreComposition(
  comp: CompositionDefinition,
  words: string[],
  wordSet: Set<string>,
  tagAffinities: Record<string, number>,
): number {
  let score = 0;

  // Match against composition name and id
  const nameTokens = tokenize(comp.name);
  const idTokens = tokenize(comp.id);
  const descTokens = tokenize(comp.description ?? "");

  for (const word of words) {
    if (nameTokens.includes(word)) score += 3;
    if (idTokens.includes(word)) score += 3;
    if (descTokens.includes(word)) score += 1;

    // Partial matches for longer words
    if (word.length >= 4) {
      for (const nt of nameTokens) {
        if (nt.includes(word) || word.includes(nt)) score += 1;
      }
    }
  }

  // Match against tags
  for (const tag of comp.tags ?? []) {
    const affinity = tagAffinities[tag.toLowerCase()];
    if (affinity) score += affinity * 2;
  }

  // Match against control names (e.g. "chaos" matches a chaos slider)
  if (comp.controls) {
    for (const controlName of Object.keys(comp.controls)) {
      const controlTokens = tokenize(controlName);
      for (const word of words) {
        if (controlTokens.includes(word)) score += 0.5;
      }
    }
  }

  // Convert score to weight multiplier
  // 0 matches = 0.3 (suppressed), 1+ = boosted proportionally
  if (score <= 0) return 0.3;
  return 1.0 + score * 0.5;
}

/** Tokenize text into lowercase words, splitting on non-alphanumeric */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 2);
}
