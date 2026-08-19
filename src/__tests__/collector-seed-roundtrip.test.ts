import { describe, it, expect, vi, beforeEach } from "vitest";
import { compositionRegistry } from "../compositions/registry";
import type { Composition2DDefinition } from "../compositions/types";

// Preference collection reads/writes real files by default (observations.jsonl,
// sync-state.json, correlations.json). Mock node:fs so the round-trip test below
// exercises only the seedRef plumbing, not the filesystem.
vi.mock("node:fs", () => {
  const mockFs = {
    existsSync: vi.fn(() => false),
    readFileSync: vi.fn(() => ""),
    writeFileSync: vi.fn(),
    appendFileSync: vi.fn(),
    mkdirSync: vi.fn(),
    readdirSync: vi.fn(() => []),
  };
  return { ...mockFs, default: mockFs };
});

import { appendFileSync } from "node:fs";
import { collectFromFeedAPI } from "../preferences/collector";

function makeTestComposition(): Composition2DDefinition {
  return {
    id: "seedRoundTripComp",
    name: "Seed Round Trip Comp",
    type: "2d",
    category: "2d",
    tags: ["test"],
    generate: () => [],
  };
}

describe("collectFromFeedAPI — seedRef round trip", () => {
  beforeEach(() => {
    vi.mocked(appendFileSync).mockClear();
    compositionRegistry.register(makeTestComposition());
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        actions: [
          {
            id: "action-1",
            item_id: "hatch3d-2026-07-07-seedRoundTripComp-0",
            action: "accept",
            acted_at: "2026-07-07T00:00:00.000Z",
            metadata: JSON.stringify({
              composition: "seedRoundTripComp",
              presetName: "Seed Test",
              values: {},
              tags: [],
              stats: { lines: 10, verts: 20, paths: 10 },
              // What feed-push.ts pushes into the item's metadata when the
              // generation traced back to a vault seed.
              seedRef: "plotterart/1sf8duc",
            }),
          },
        ],
      }),
    }) as unknown as typeof fetch;
  });

  it("forwards a pushed seedRef through the accept action into the stored observation", async () => {
    const count = await collectFromFeedAPI({ url: "https://fake.example", token: "tok" });
    expect(count).toBe(1);

    const appendCall = vi
      .mocked(appendFileSync)
      .mock.calls.find(([path]) => String(path).endsWith("observations.jsonl"));
    expect(appendCall).toBeDefined();
    const obs = JSON.parse(String(appendCall![1]).trim());

    expect(obs.seedRef).toBe("plotterart/1sf8duc");
    expect(obs.features.isSeedDerived).toBe(true);
    expect(obs.features.seedRef).toBe("plotterart/1sf8duc");
  });

  it("leaves isSeedDerived false when no seedRef is present (backward compatible)", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        actions: [
          {
            id: "action-2",
            item_id: "hatch3d-2026-07-07-seedRoundTripComp-1",
            action: "reject",
            acted_at: "2026-07-07T00:00:01.000Z",
            metadata: JSON.stringify({
              composition: "seedRoundTripComp",
              presetName: "No Seed",
              values: {},
              tags: [],
              stats: { lines: 5, verts: 10, paths: 5 },
            }),
          },
        ],
      }),
    }) as unknown as typeof fetch;

    await collectFromFeedAPI({ url: "https://fake.example", token: "tok" });

    const appendCall = vi
      .mocked(appendFileSync)
      .mock.calls.find(([path]) => String(path).endsWith("observations.jsonl"));
    expect(appendCall).toBeDefined();
    const obs = JSON.parse(String(appendCall![1]).trim());

    expect(obs.seedRef).toBeUndefined();
    expect(obs.features.isSeedDerived).toBe(false);
  });
});
