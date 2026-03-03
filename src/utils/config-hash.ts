/**
 * Deterministic config hash for filenames.
 * FNV-1a hash of JSON-serialized config → 6-char base36 string.
 */

function fnv1a(str: string): number {
  let hash = 0x811c9dc5; // FNV offset basis (32-bit)
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193); // FNV prime
  }
  return hash >>> 0; // unsigned
}

function sortedStringify(obj: unknown): string {
  return JSON.stringify(obj, (_, value) => {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return Object.keys(value)
        .sort()
        .reduce<Record<string, unknown>>((sorted, key) => {
          sorted[key] = (value as Record<string, unknown>)[key];
          return sorted;
        }, {});
    }
    return value;
  });
}

/** Returns a 6-char base36 hash of the given config object. */
export function configHash(config: Record<string, unknown>): string {
  const json = sortedStringify(config);
  const hash = fnv1a(json);
  return hash.toString(36).padStart(6, "0").slice(-6);
}
