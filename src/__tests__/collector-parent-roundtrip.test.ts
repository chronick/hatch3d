import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { compositionRegistry } from "../compositions/registry";
import type { Composition2DDefinition } from "../compositions/types";

// Preference collection reads/writes real files by default (observations.jsonl,
// sync-state.json, correlations.json). Mock node:fs so the round-trip test below
// exercises only the parentId plumbing, not the filesystem.
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

import { appendFileSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { collectFromFeedAPI, collectFromPrintQueue, logGeneration } from "../preferences/collector";

function makeTestComposition(): Composition2DDefinition {
  return {
    id: "parentRoundTripComp",
    name: "Parent Round Trip Comp",
    type: "2d",
    category: "2d",
    tags: ["test"],
    generate: () => [],
  };
}

function lastObservation() {
  const appendCall = vi
    .mocked(appendFileSync)
    .mock.calls.filter(([path]) => String(path).endsWith("observations.jsonl"))
    .pop();
  expect(appendCall).toBeDefined();
  return JSON.parse(String(appendCall![1]).trim());
}

describe("collectFromFeedAPI — parentId round trip", () => {
  beforeEach(() => {
    vi.mocked(appendFileSync).mockClear();
    compositionRegistry.register(makeTestComposition());
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        actions: [
          {
            id: "action-1",
            item_id: "hatch3d-2026-08-14-parentRoundTripComp-0",
            action: "accept",
            acted_at: "2026-08-14T00:00:00.000Z",
            metadata: JSON.stringify({
              composition: "parentRoundTripComp",
              presetName: "Parent Test",
              values: {},
              tags: [],
              stats: { lines: 10, verts: 20, paths: 10 },
              source: "mutation",
              // What feed-push.ts pushes into the item's metadata when the
              // generation was mutated from an earlier observation.
              parentId: "hatch3d-2026-08-01-parentRoundTripComp-3",
            }),
          },
        ],
      }),
    }) as unknown as typeof fetch;
  });

  it("forwards a pushed parentId through the accept action into the stored observation", async () => {
    const count = await collectFromFeedAPI({ url: "https://fake.example", token: "tok" });
    expect(count).toBe(1);

    const obs = lastObservation();
    expect(obs.parentId).toBe("hatch3d-2026-08-01-parentRoundTripComp-3");
  });

  it("leaves parentId undefined when none is present (backward compatible)", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        actions: [
          {
            id: "action-2",
            item_id: "hatch3d-2026-08-14-parentRoundTripComp-1",
            action: "reject",
            acted_at: "2026-08-14T00:00:01.000Z",
            metadata: JSON.stringify({
              composition: "parentRoundTripComp",
              presetName: "No Parent",
              values: {},
              tags: [],
              stats: { lines: 5, verts: 10, paths: 5 },
            }),
          },
        ],
      }),
    }) as unknown as typeof fetch;

    await collectFromFeedAPI({ url: "https://fake.example", token: "tok" });

    const obs = lastObservation();
    expect(obs.parentId).toBeUndefined();
  });

  it("survives the full generation → push → collect cycle", async () => {
    const parentId = "hatch3d-2026-08-01-parentRoundTripComp-3";

    // 1. Generation time: logGeneration records the lineage locally.
    logGeneration(
      "hatch3d-2026-08-14-parentRoundTripComp-0",
      "parentRoundTripComp",
      "Parent Test",
      {},
      null,
      [],
      { lines: 10, verts: 20, paths: 10 },
      "mutation",
      parentId,
    );
    expect(lastObservation().parentId).toBe(parentId);

    // 2. Push + collect: the same parentId comes back off the feed action's
    //    metadata (see the mocked fetch payload in beforeEach).
    vi.mocked(appendFileSync).mockClear();
    await collectFromFeedAPI({ url: "https://fake.example", token: "tok" });

    expect(lastObservation().parentId).toBe(parentId);
  });
});

describe("collectFromPrintQueue — parentId round trip", () => {
  const VAULT_DIR = "/fake/vault";
  const QUEUE_ITEM_ID = "hatch3d-2026-08-14-parentRoundTripComp-0";

  // cli/feed-push.ts is a CLI entry point; import it dynamically, behind a fetch
  // spy, so module-load side effects can never reach the feed API.
  let buildPrintQueueConfig: typeof import("../../cli/feed-push").buildPrintQueueConfig;

  beforeAll(async () => {
    vi.stubGlobal("fetch", () => {
      throw new Error("network access is forbidden in this test");
    });
    ({ buildPrintQueueConfig } = await import("../../cli/feed-push"));
  });

  /**
   * Point the mocked fs at a one-entry print queue holding `config`, and nothing
   * else — every other path (observations.jsonl, sync-state.json,
   * correlations.json) stays absent so the collector takes its empty-store path.
   */
  function stubPrintQueue(config: unknown) {
    const configPath = `${VAULT_DIR}/print-queue/${QUEUE_ITEM_ID}/config.json`;
    vi.mocked(existsSync).mockImplementation((p) =>
      String(p) === `${VAULT_DIR}/print-queue` || String(p) === configPath,
    );
    vi.mocked(readdirSync).mockImplementation(
      () => [{ name: QUEUE_ITEM_ID, isDirectory: () => true }] as never,
    );
    vi.mocked(readFileSync).mockImplementation((p) =>
      String(p) === configPath ? JSON.stringify(config) : "",
    );
  }

  beforeEach(() => {
    vi.mocked(appendFileSync).mockClear();
    compositionRegistry.register(makeTestComposition());
  });

  it("reads parentId out of the queued config into the stored observation", () => {
    stubPrintQueue(
      buildPrintQueueConfig(
        { composition: "parentRoundTripComp", name: "Parent Test", values: {}, tags: [] },
        `plotter/${QUEUE_ITEM_ID}.svg`,
        "hatch3d-2026-08-01-parentRoundTripComp-3",
      ),
    );

    expect(collectFromPrintQueue(VAULT_DIR)).toBe(1);
    expect(lastObservation().parentId).toBe("hatch3d-2026-08-01-parentRoundTripComp-3");
  });

  it("leaves parentId undefined when the queued config carries none", () => {
    stubPrintQueue(
      buildPrintQueueConfig(
        { composition: "parentRoundTripComp", name: "No Parent", values: {}, tags: [] },
        `plotter/${QUEUE_ITEM_ID}.svg`,
      ),
    );

    expect(collectFromPrintQueue(VAULT_DIR)).toBe(1);
    expect(lastObservation().parentId).toBeUndefined();
  });
});
