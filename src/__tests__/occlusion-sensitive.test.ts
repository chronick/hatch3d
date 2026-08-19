import { describe, it, expect } from "vitest";
import { compositionRegistry } from "../compositions";

describe("occlusionSensitive flag", () => {
  const ids = ["sentinelTerrain3D", "totemStack", "towerAndBase", "nestedShells"] as const;

  for (const id of ids) {
    it(`${id} is marked occlusionSensitive`, () => {
      const comp = compositionRegistry.get(id);
      expect(comp, `composition "${id}" not found in registry`).toBeDefined();
      expect((comp as { occlusionSensitive?: boolean }).occlusionSensitive).toBe(true);
    });
  }
});
