import { describe, it, expect, beforeEach } from "vitest";
import { CompositionRegistry } from "../compositions/registry";
import type { Composition3DDefinition, Composition2DDefinition } from "../compositions/types";

function make3D(id: string, name: string): Composition3DDefinition {
  return {
    id,
    name,
    category: "3d",
    layers: (p) => [{ surface: p.surface, params: p.surfaceParams, hatch: p.hatchParams }],
  };
}

function make2D(id: string, name: string): Composition2DDefinition {
  return {
    id,
    name,
    type: "2d",
    category: "2d",
    generate: () => [],
  };
}

describe("CompositionRegistry", () => {
  let registry: CompositionRegistry;

  beforeEach(() => {
    registry = new CompositionRegistry();
  });

  it("starts empty", () => {
    expect(registry.size).toBe(0);
    expect(registry.has("foo")).toBe(false);
  });

  it("registers and retrieves a composition", () => {
    const comp = make3D("test", "Test");
    registry.register(comp);
    expect(registry.size).toBe(1);
    expect(registry.has("test")).toBe(true);
    expect(registry.get("test")).toBe(comp);
  });

  it("registers multiple compositions", () => {
    registry.registerAll([make3D("a", "A"), make3D("b", "B"), make2D("c", "C")]);
    expect(registry.size).toBe(3);
    expect(registry.has("a")).toBe(true);
    expect(registry.has("b")).toBe(true);
    expect(registry.has("c")).toBe(true);
  });

  it("overwrites on duplicate id", () => {
    registry.register(make3D("dup", "First"));
    registry.register(make3D("dup", "Second"));
    expect(registry.size).toBe(1);
    expect(registry.get("dup")!.name).toBe("Second");
  });

  it("getAll returns a Map preserving insertion order", () => {
    registry.register(make3D("z", "Z"));
    registry.register(make3D("a", "A"));
    const keys = [...registry.getAll().keys()];
    expect(keys).toEqual(["z", "a"]);
  });

  it("getAllMetadata extracts metadata correctly", () => {
    registry.register({
      ...make3D("test", "Test Comp"),
      description: "A test composition",
      tags: ["test", "example"],
    });
    const meta = registry.getAllMetadata();
    expect(meta).toHaveLength(1);
    expect(meta[0].id).toBe("test");
    expect(meta[0].name).toBe("Test Comp");
    expect(meta[0].description).toBe("A test composition");
    expect(meta[0].tags).toEqual(["test", "example"]);
    expect(meta[0].type).toBe("3d");
  });

  it("distinguishes 2D and 3D in metadata", () => {
    registry.register(make3D("three", "3D Comp"));
    registry.register(make2D("two", "2D Comp"));
    const meta = registry.getAllMetadata();
    expect(meta.find((m) => m.id === "three")!.type).toBe("3d");
    expect(meta.find((m) => m.id === "two")!.type).toBe("2d");
  });

  it("subscribe notifies on register", () => {
    let callCount = 0;
    const unsub = registry.subscribe(() => callCount++);
    registry.register(make3D("a", "A"));
    expect(callCount).toBe(1);
    registry.registerAll([make3D("b", "B"), make3D("c", "C")]);
    expect(callCount).toBe(2);
    unsub();
    registry.register(make3D("d", "D"));
    expect(callCount).toBe(2); // no more calls after unsub
  });

  it("get returns undefined for missing id", () => {
    expect(registry.get("nonexistent")).toBeUndefined();
  });
});
