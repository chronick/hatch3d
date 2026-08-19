import { describe, it, expect } from "vitest";
import { compositionRegistry } from "../compositions/registry";
import { loadCompositions } from "../../cli/load-compositions";

/**
 * Drift guard for cli/load-compositions.ts.
 *
 * The CLI hand-maintains an explicit import list (Vite's import.meta.glob is
 * unavailable under Node/tsx), so it silently falls out of sync when a
 * composition is added — which is exactly how contourMap + 6 others became
 * unrenderable headlessly (fixed in this branch). This test enumerates every
 * composition module with the glob the browser uses and asserts the CLI loader
 * registers all of them, so the next drift fails loudly instead of silently.
 */

// Eager so we can read each module's default export id at test time.
const modules = import.meta.glob(
  ["../compositions/2d/**/*.ts", "../compositions/3d/**/*.ts", "../compositions/layered/**/*.ts"],
  { eager: true },
);

describe("CLI composition loader coverage", () => {
  it("registers every composition file the browser auto-discovers", () => {
    loadCompositions();
    const registered = new Set(compositionRegistry.getAll().keys());

    const missing: string[] = [];
    let compositionModules = 0;
    for (const [path, mod] of Object.entries(modules)) {
      if (path.endsWith(".test.ts") || path.includes("/index.")) continue;
      const def = (mod as { default?: { id?: unknown } }).default;
      if (!def || typeof def.id !== "string") continue; // not a composition module
      compositionModules++;
      if (!registered.has(def.id)) missing.push(`${def.id} (${path})`);
    }

    // Sanity: the glob actually found compositions (guards against a broken glob
    // silently passing).
    expect(compositionModules).toBeGreaterThan(30);
    expect(missing, `cli/load-compositions.ts is missing: ${missing.join(", ")}`).toEqual([]);
  });
});
