import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { isControlVisible } from "../compositions/helpers";
import type { ControlDef } from "../compositions/types";

const gateToggle: ControlDef = {
  type: "toggle",
  label: "Gate",
  default: false,
  group: "g",
};

const gatedSlider: ControlDef = {
  type: "slider",
  label: "Gated",
  default: 1,
  min: 0,
  max: 10,
  group: "g",
  showWhen: { control: "gate", equals: true },
};

const ungatedSlider: ControlDef = {
  type: "slider",
  label: "Free",
  default: 1,
  min: 0,
  max: 10,
  group: "g",
};

describe("isControlVisible", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("returns true when control has no showWhen", () => {
    expect(isControlVisible(ungatedSlider, {}, { free: ungatedSlider })).toBe(true);
  });

  it("returns false when currentValues[gateKey] !== equals", () => {
    const controls = { gate: gateToggle, gated: gatedSlider };
    expect(isControlVisible(gatedSlider, { gate: false }, controls)).toBe(false);
  });

  it("returns true when currentValues[gateKey] === equals", () => {
    const controls = { gate: gateToggle, gated: gatedSlider };
    expect(isControlVisible(gatedSlider, { gate: true }, controls)).toBe(true);
  });

  it("falls back to gating control's default when currentValues lacks the key", () => {
    const controls = { gate: gateToggle, gated: gatedSlider };
    // gate.default === false; gatedSlider requires gate=true; so hidden
    expect(isControlVisible(gatedSlider, {}, controls)).toBe(false);

    const onByDefault: ControlDef = { ...gateToggle, default: true };
    const controlsOn = { gate: onByDefault, gated: gatedSlider };
    expect(isControlVisible(gatedSlider, {}, controlsOn)).toBe(true);
  });

  it("returns true and warns when showWhen.control is not a key in controls", () => {
    const orphan: ControlDef = {
      type: "slider",
      label: "Orphan",
      default: 1,
      min: 0,
      max: 10,
      group: "g",
      showWhen: { control: "nonexistentKey_unique", equals: true },
    };
    const controls = { orphan };
    expect(isControlVisible(orphan, {}, controls)).toBe(true);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]?.[0]).toContain("nonexistentKey_unique");
  });
});
