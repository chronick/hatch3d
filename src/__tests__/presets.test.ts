import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  loadUserPresets,
  saveUserPreset,
  deleteUserPreset,
  getPresetsForComposition,
  buildLayeredPresetValues,
} from "../compositions/presets";
import type { LayeredLayer } from "../compositions/types";

// Mock localStorage
const store: Record<string, string> = {};
const mockLocalStorage = {
  getItem: vi.fn((key: string) => store[key] ?? null),
  setItem: vi.fn((key: string, value: string) => { store[key] = value; }),
  removeItem: vi.fn((key: string) => { delete store[key]; }),
};

Object.defineProperty(globalThis, "localStorage", {
  value: mockLocalStorage,
  writable: true,
});

describe("Preset storage", () => {
  beforeEach(() => {
    for (const key of Object.keys(store)) delete store[key];
    vi.clearAllMocks();
  });

  it("loadUserPresets returns empty object when no data", () => {
    expect(loadUserPresets()).toEqual({});
  });

  it("saveUserPreset stores a preset", () => {
    saveUserPreset("testComp", "myPreset", {
      name: "My Preset",
      values: { controls: { height: 5 } },
    });
    const loaded = loadUserPresets();
    expect(loaded.testComp).toBeDefined();
    expect(loaded.testComp.myPreset.name).toBe("My Preset");
    expect(loaded.testComp.myPreset.values.controls).toEqual({ height: 5 });
  });

  it("saveUserPreset adds multiple presets for same composition", () => {
    saveUserPreset("comp1", "a", { name: "A", values: {} });
    saveUserPreset("comp1", "b", { name: "B", values: {} });
    const loaded = loadUserPresets();
    expect(Object.keys(loaded.comp1)).toEqual(["a", "b"]);
  });

  it("deleteUserPreset removes a preset", () => {
    saveUserPreset("comp1", "a", { name: "A", values: {} });
    saveUserPreset("comp1", "b", { name: "B", values: {} });
    deleteUserPreset("comp1", "a");
    const loaded = loadUserPresets();
    expect(loaded.comp1.a).toBeUndefined();
    expect(loaded.comp1.b).toBeDefined();
  });

  it("deleteUserPreset removes composition key when last preset is deleted", () => {
    saveUserPreset("comp1", "a", { name: "A", values: {} });
    deleteUserPreset("comp1", "a");
    const loaded = loadUserPresets();
    expect(loaded.comp1).toBeUndefined();
  });

  it("getPresetsForComposition combines suggested and user presets", () => {
    saveUserPreset("comp1", "userPreset", { name: "User", values: {} });
    const result = getPresetsForComposition("comp1", {
      suggested: { name: "Suggested", values: {} },
    });
    expect(result.suggested.suggested.name).toBe("Suggested");
    expect(result.user.userPreset.name).toBe("User");
  });

  it("getPresetsForComposition handles missing data gracefully", () => {
    const result = getPresetsForComposition("nonexistent");
    expect(result.suggested).toEqual({});
    expect(result.user).toEqual({});
  });

  it("handles corrupted localStorage gracefully", () => {
    store["hatch3d-user-presets"] = "not valid json!!!";
    expect(loadUserPresets()).toEqual({});
  });
});

describe("buildLayeredPresetValues", () => {
  it("strips __id from each entry and does not mutate input", () => {
    const layers: LayeredLayer[] = [
      { __id: "a", composition: "x", color: "red" },
      { composition: "y" },
    ];
    const out = buildLayeredPresetValues(layers);

    expect(out).toHaveLength(2);
    expect(out[0]).not.toHaveProperty("__id");
    expect(out[1]).not.toHaveProperty("__id");
    expect(out[0]).toEqual({ composition: "x", color: "red" });
    expect(out[1]).toEqual({ composition: "y" });

    // Mutation safety: input untouched.
    expect(layers[0].__id).toBe("a");
  });
});

describe("Layered preset round-trip", () => {
  beforeEach(() => {
    for (const key of Object.keys(store)) delete store[key];
    vi.clearAllMocks();
  });

  it("preserves layer payload through localStorage round-trip", () => {
    const layers: LayeredLayer[] = [
      {
        __id: "id-1",
        composition: "phyllotaxisIsoblocks",
        color: "red",
        paramOverrides: { count: 200, spacing: 1.5 },
        name: "front",
        visible: true,
      },
      {
        __id: "id-2",
        composition: "phyllotaxisIsoblocks",
        color: "blue",
        blendMode: "over",
        visible: false,
      },
    ];

    const stripped = buildLayeredPresetValues(layers);
    saveUserPreset("phyllotaxisIsoblocks", "test-rt", {
      name: "test-rt",
      values: { layers: stripped },
    });

    const result = getPresetsForComposition("phyllotaxisIsoblocks");
    const reloaded = result.user["test-rt"];
    expect(reloaded).toBeDefined();
    expect(reloaded.values.layers).toEqual(stripped);

    for (const entry of reloaded.values.layers ?? []) {
      expect(entry).not.toHaveProperty("__id");
    }
  });
});
