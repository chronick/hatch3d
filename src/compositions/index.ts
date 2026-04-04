import { compositionRegistry } from "./registry";
import type { CompositionDefinition } from "./types";

export * from "./types";
export * from "./helpers";
export * from "./presets";
export { compositionRegistry } from "./registry";

// Auto-discover all composition files via Vite's import.meta.glob (compile-time transform).
// Node.js CLI loads explicitly via cli/load-compositions.ts instead.
const modules3d = import.meta.glob("./3d/**/*.ts", { eager: true });
const modules2d = import.meta.glob("./2d/**/*.ts", { eager: true });

for (const [path, mod] of [...Object.entries(modules3d), ...Object.entries(modules2d)]) {
  const comp = (mod as { default: CompositionDefinition }).default;
  if (comp?.id) {
    const dirPath = path.replace(/^\.\//, "").replace(/\/[^/]+$/, "");
    compositionRegistry.registerWithPath(comp, dirPath);
  }
}
