import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  loadUserPresets,
  saveUserPreset,
  deleteUserPreset,
  getPresetsForComposition,
} from "../compositions/presets";

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
