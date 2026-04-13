import { describe, it, expect } from "vitest";
import { briefToIntent } from "./intent.js";
import { CompositionRegistry } from "../compositions/registry.js";
import type { Composition2DDefinition, Composition3DDefinition } from "../compositions/types.js";

/** Build a minimal registry for testing */
function makeRegistry(...comps: Array<{ id: string; name: string; tags?: string[]; controls?: Record<string, any>; description?: string }>): CompositionRegistry {
  const reg = new CompositionRegistry();
  for (const c of comps) {
    reg.register({
      id: c.id,
      name: c.name,
      type: "2d",
      category: "2d",
      tags: c.tags ?? [],
      controls: c.controls ?? {},
      description: c.description,
      generate: () => [],
    } as Composition2DDefinition);
  }
  return reg;
}

describe("briefToIntent", () => {
  const registry = makeRegistry(
    { id: "flowField", name: "Flow Field", tags: ["generative", "organic", "fluid"], description: "Simplex noise streamlines" },
    { id: "crystalLattice", name: "Crystal Lattice", tags: ["geometric", "crystalline", "dense"], description: "Repeating crystal structures" },
    { id: "truchetMaze", name: "Truchet Maze", tags: ["pattern", "maze", "dense"] },
    { id: "strangeAttractor", name: "Strange Attractor", tags: ["chaotic", "mathematical", "generative"], controls: { chaos: { type: "slider", min: 0, max: 1, default: 0.5 } } },
  );

  it("boosts compositions matching brief keywords", () => {
    const intent = briefToIntent("crystal geometric dense", registry);

    expect(intent.compositionWeights["crystalLattice"]).toBeGreaterThan(1.0);
    expect(intent.compositionWeights["flowField"]).toBeLessThan(1.0);
  });

  it("suppresses non-matching compositions", () => {
    const intent = briefToIntent("organic flowing fluid", registry);

    expect(intent.compositionWeights["flowField"]).toBeGreaterThan(1.0);
    expect(intent.compositionWeights["truchetMaze"]).toBeLessThan(1.0);
  });

  it("extracts tag affinities from brief words", () => {
    const intent = briefToIntent("dense organic", registry);

    expect(intent.tagAffinities["dense"]).toBe(1.0);
    expect(intent.tagAffinities["organic"]).toBe(1.0);
    expect(intent.tagAffinities["maze"]).toBeUndefined();
  });

  it("detects novelty words and sets high exploration", () => {
    const intent = briefToIntent("surprise me with something wild", registry);

    expect(intent.explorationOverride).toBeDefined();
    expect(intent.explorationOverride!).toBeGreaterThan(0.4);
  });

  it("detects refine words and sets low exploration", () => {
    const intent = briefToIntent("more similar subtle variations", registry);

    expect(intent.explorationOverride).toBeDefined();
    expect(intent.explorationOverride!).toBeLessThan(0.15);
  });

  it("leaves exploration undefined when no signal words present", () => {
    const intent = briefToIntent("dense geometric patterns", registry);

    expect(intent.explorationOverride).toBeUndefined();
  });

  it("matches control names in brief", () => {
    const intent = briefToIntent("chaos", registry);

    // strangeAttractor has a "chaos" control
    expect(intent.compositionWeights["strangeAttractor"]).toBeGreaterThan(
      intent.compositionWeights["truchetMaze"],
    );
  });

  it("preserves the original brief text", () => {
    const intent = briefToIntent("sparse organic flowing", registry);
    expect(intent.brief).toBe("sparse organic flowing");
  });

  it("handles empty brief gracefully", () => {
    const intent = briefToIntent("", registry);

    // All compositions should be suppressed (no matches)
    for (const w of Object.values(intent.compositionWeights)) {
      expect(w).toBeLessThanOrEqual(1.0);
    }
    expect(intent.explorationOverride).toBeUndefined();
  });
});
