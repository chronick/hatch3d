import { compositionRegistry } from "./registry";
import type { CompositionDefinition } from "./types";

export * from "./types";
export * from "./helpers";
export * from "./presets";
export { compositionRegistry } from "./registry";

// Auto-discover all composition files (Vite only — Node.js CLI loads explicitly)
if (typeof import.meta.glob === "function") {
  const modules3d = import.meta.glob("./3d/**/*.ts", { eager: true });
  const modules2d = import.meta.glob("./2d/**/*.ts", { eager: true });

  for (const [path, mod] of [...Object.entries(modules3d), ...Object.entries(modules2d)]) {
    const comp = (mod as { default: CompositionDefinition }).default;
    if (comp?.id) {
      // Extract directory path: "./3d/geometric/double-ring.ts" → "3d/geometric"
      const dirPath = path.replace(/^\.\//, "").replace(/\/[^/]+$/, "");
      compositionRegistry.registerWithPath(comp, dirPath);
    }
  }
}
