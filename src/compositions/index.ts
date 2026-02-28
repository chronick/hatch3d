import { compositionRegistry } from "./registry";
import type { CompositionDefinition } from "./types";

export * from "./types";
export * from "./helpers";
export * from "./presets";
export { compositionRegistry } from "./registry";

// Auto-discover all composition files
const modules3d = import.meta.glob("./3d/*.ts", { eager: true });
const modules2d = import.meta.glob("./2d/*.ts", { eager: true });

for (const mod of [...Object.values(modules3d), ...Object.values(modules2d)]) {
  const comp = (mod as { default: CompositionDefinition }).default;
  if (comp?.id) compositionRegistry.register(comp);
}
