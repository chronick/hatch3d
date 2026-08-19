import type { Composition2DDefinition } from "../../types";

type Point = { x: number; y: number };

// ── Seeded PRNG (mulberry32) ──
// Duplicated from perlin-worms.ts / grains-glitch-ca.ts rather than hoisted —
// compositions in this tree keep their PRNG file-local so a composition file
// is self-contained.

function mulberry32(a: number) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Turmite rule tables ──
//
// A turmite (generalized Langton's ant) is a state machine walking a grid of
// coloured cells. Each step it reads (agentState, cellState) and the rule
// table yields (writeCellState, turn, nextAgentState); the agent writes,
// turns, then moves forward one cell.
//
// Turn codes: 0 = straight, 1 = right (90° cw), 2 = U-turn, 3 = left (90° ccw).
// Direction codes: 0 = +x, 1 = +y, 2 = -x, 3 = -y — so "right" is dir + 1.
//
// The table is flat: entry (state, colour) lives at (state * nColors + colour),
// three Int8 slots each — [write, turn, next].

interface RuleTable {
  nColors: number;
  nStates: number;
  /** 3 entries per (state, colour) pair: write, turn, next. */
  table: Int8Array;
}

function makeTable(nColors: number, nStates: number, entries: number[][]): RuleTable {
  const table = new Int8Array(nColors * nStates * 3);
  for (let i = 0; i < entries.length; i++) {
    table[i * 3] = entries[i][0];
    table[i * 3 + 1] = entries[i][1];
    table[i * 3 + 2] = entries[i][2];
  }
  return { nColors, nStates, table };
}

// Curated rule tables. These were picked by exhaustively enumerating every
// 2-state × 2-colour turmite (65 536 tables), running each for 20k steps and
// scoring visited-cell count, bounding box, fill ratio, 180°/mirror symmetry
// and centroid displacement — then eyeballing the finalists at 120k steps.
// Each of the four below sits in a different corner of that metric space.
const PRESETS: Record<string, RuleTable> = {
  // Classic Langton's ant: one agent state, two colours. Chaos for ~10k steps,
  // then locks into the diagonal "highway" that runs off across the grid.
  langtonHighway: makeTable(2, 1, [
    [1, 1, 0],
    [0, 3, 0],
  ]),
  // Never settles: a slowly expanding, grainy hexagon-ish blob at ~12% ink.
  chaoticGrain: makeTable(2, 2, [
    [1, 1, 0],
    [0, 0, 1],
    [0, 3, 0],
    [0, 2, 1],
  ]),
  // Dense (~73% ink) woven basket lattice — reads as a textile / moiré weave.
  wovenLattice: makeTable(2, 2, [
    [1, 1, 0],
    [0, 3, 1],
    [0, 3, 0],
    [1, 1, 1],
  ]),
  // Perfectly 4-fold symmetric striped diamond that grows without erasing
  // (every rule writes colour 1), so ink is monotonic in the step budget.
  symmetricDiamond: makeTable(2, 2, [
    [1, 0, 1],
    [1, 0, 0],
    [1, 1, 0],
    [1, 3, 0],
  ]),
};

/**
 * Draw a random rule table, rejecting the two degenerate families a naive
 * draw is full of: tight cycles that only ever touch a few cells, and
 * write-everything tables that leave a solid saturated block behind. Both
 * are caught by a cheap 20k-step probe on a scratch grid.
 * Deterministic: driven entirely by the passed rng.
 */
function randomTable(rng: () => number, nColors: number, nStates: number): RuleTable {
  const n = nColors * nStates;
  let best: RuleTable | null = null;
  let bestScore = -1;
  for (let attempt = 0; attempt < 40; attempt++) {
    const entries: number[][] = [];
    for (let i = 0; i < n; i++) {
      entries.push([
        Math.floor(rng() * nColors),
        Math.floor(rng() * 4),
        Math.floor(rng() * nStates),
      ]);
    }
    const candidate = makeTable(nColors, nStates, entries);
    const { explored, density } = probeTable(candidate);
    const usableDensity = density >= 0.08 && density <= 0.8;
    const score = explored * (usableDensity ? 1 : 0.15);
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
    if (explored >= 6000 && usableDensity) return candidate;
  }
  return best!;
}

/**
 * Run a table for 20k steps on a 160×160 wrapped grid and report how many
 * distinct cells it reached and what fraction of those it left inked.
 */
function probeTable(rules: RuleTable): { explored: number; density: number } {
  const N = 160;
  const grid = new Int8Array(N * N);
  const seen = new Uint8Array(N * N);
  const touched: number[] = [];
  let x = N >> 1;
  let y = N >> 1;
  let dir = 0;
  let st = 0;
  for (let s = 0; s < 20000; s++) {
    const i = y * N + x;
    if (seen[i] === 0) {
      seen[i] = 1;
      touched.push(i);
    }
    const e = (st * rules.nColors + grid[i]) * 3;
    grid[i] = rules.table[e];
    const turn = rules.table[e + 1];
    if (turn !== 0) dir = (dir + turn) & 3;
    st = rules.table[e + 2];
    if (dir === 0) x++;
    else if (dir === 1) y++;
    else if (dir === 2) x--;
    else y--;
    if (x < 0) x += N;
    else if (x >= N) x -= N;
    if (y < 0) y += N;
    else if (y >= N) y -= N;
  }
  let ink = 0;
  for (const i of touched) if (grid[i] !== 0) ink++;
  return { explored: touched.length, density: touched.length ? ink / touched.length : 0 };
}

/**
 * Copy a rule table and scramble the turn + next-state of one or two entries.
 * Used when shared-rules is off: each agent keeps the family's ink character
 * (the write column is untouched) but walks a different machine.
 */
function mutateTable(base: RuleTable, rng: () => number): RuleTable {
  const table = new Int8Array(base.table);
  const n = base.nColors * base.nStates;
  const mutations = 1 + Math.floor(rng() * 2);
  for (let m = 0; m < mutations; m++) {
    const e = Math.floor(rng() * n) * 3;
    table[e + 1] = Math.floor(rng() * 4);
    table[e + 2] = Math.floor(rng() * base.nStates);
  }
  return { nColors: base.nColors, nStates: base.nStates, table };
}

// ── Geometry budget ──
// Hard ceilings so a maxed-out control set can never emit plotter-hostile
// (or browser-hostile) geometry. Dots are subsampled with an integer stride;
// trails get their sampling stride widened until they fit.
const MAX_DOTS = 60_000;
const MAX_TRAIL_POINTS = 40_000;
const MAX_TOTAL_STEPS = 1_500_000;

const turmiteTrails: Composition2DDefinition = {
  id: "turmiteTrails",
  name: "Turmite Trails",
  description:
    "Turmites — generalized Langton's ants — walking a wrapped grid. Each agent is a state machine that reads its cell, writes a new cell state, turns and steps; the rule table decides everything. Four curated rule sets (Langton highway, chaotic grain, woven lattice, symmetric diamond) plus seed-driven random tables. Renders as a field of dot marks over visited cells, or as the agents' raw walked paths.",
  tags: ["2d", "generative", "cellular-automaton", "agents", "turmite", "langtons-ant"],
  category: "2d",
  type: "2d",
  renderMode: "debounced",

  controls: {
    agents: {
      type: "slider",
      label: "Turmites",
      default: 4,
      min: 1,
      max: 6,
      step: 1,
      group: "Turmites",
    },
    steps: {
      type: "slider",
      label: "Steps per Turmite",
      default: 40000,
      min: 5000,
      max: 250000,
      step: 5000,
      group: "Turmites",
    },
    gridSize: {
      type: "slider",
      label: "Grid Resolution",
      default: 300,
      min: 60,
      max: 400,
      step: 10,
      group: "Turmites",
    },
    ruleset: {
      type: "select",
      label: "Rule Set",
      default: "chaoticGrain",
      options: [
        { label: "Langton Highway", value: "langtonHighway" },
        { label: "Chaotic Grain", value: "chaoticGrain" },
        { label: "Woven Lattice", value: "wovenLattice" },
        { label: "Symmetric Diamond", value: "symmetricDiamond" },
        { label: "Random (from seed)", value: "random" },
      ],
      group: "Rules",
    },
    sharedRules: {
      type: "toggle",
      label: "Shared Rule Table",
      default: true,
      group: "Rules",
    },
    randomColors: {
      type: "slider",
      label: "Random: Cell States",
      default: 3,
      min: 2,
      max: 4,
      step: 1,
      group: "Rules",
    },
    randomStates: {
      type: "slider",
      label: "Random: Agent States",
      default: 2,
      min: 1,
      max: 3,
      step: 1,
      group: "Rules",
    },
    renderStyle: {
      type: "select",
      label: "Render Style",
      default: "dots",
      options: [
        { label: "Dots (visited cells)", value: "dots" },
        { label: "Trails (agent paths)", value: "trails" },
      ],
      group: "Render",
    },
    dotSize: {
      type: "slider",
      label: "Dot Mark Size",
      default: 1.4,
      min: 0.2,
      max: 4,
      step: 0.1,
      group: "Render",
    },
    crossMarks: {
      type: "toggle",
      label: "Cross Marks",
      default: false,
      group: "Render",
    },
    trailStride: {
      type: "slider",
      label: "Trail Sampling Stride",
      default: 6,
      min: 1,
      max: 40,
      step: 1,
      group: "Render",
    },
    margin: {
      type: "slider",
      label: "Margin",
      default: 40,
      min: 10,
      max: 120,
      step: 5,
      group: "Layout",
    },
    seed: {
      type: "slider",
      label: "Seed",
      default: 42,
      min: 0,
      max: 999,
      step: 1,
      group: "Layout",
    },
  },

  generate({ width, height, values }) {
    const agentCount = clampInt(values.agents, 1, 6, 4);
    const stepsPerAgent = clampInt(values.steps, 1000, 250000, 40000);
    const gridSize = clampInt(values.gridSize, 20, 400, 300);
    const rulesetName = (values.ruleset as string) ?? "chaoticGrain";
    const sharedRules = (values.sharedRules as boolean) ?? true;
    const randomColors = clampInt(values.randomColors, 2, 4, 3);
    const randomStates = clampInt(values.randomStates, 1, 3, 2);
    const renderStyle = ((values.renderStyle as string) ?? "dots") === "trails" ? "trails" : "dots";
    const dotSize = clampNum(values.dotSize, 0.1, 4, 1.4);
    const crossMarks = (values.crossMarks as boolean) ?? false;
    const trailStride = clampInt(values.trailStride, 1, 40, 6);
    const margin = clampNum(values.margin, 0, 200, 40);
    const seed = clampInt(values.seed, 0, 999999, 42);

    const rng = mulberry32(seed * 2654435761 + 12345);

    // Global step ceiling — the sliders top out at 6 × 250k = 1.5M, but keep
    // the guard so widening a slider later can't silently blow up render time.
    const budget = Math.min(stepsPerAgent * agentCount, MAX_TOTAL_STEPS);
    const steps = Math.max(1, Math.floor(budget / agentCount));

    // ── Rule tables ──
    const baseTable =
      rulesetName === "random"
        ? randomTable(rng, randomColors, randomStates)
        : (PRESETS[rulesetName] ?? PRESETS.chaoticGrain);

    const tables: RuleTable[] = [];
    for (let a = 0; a < agentCount; a++) {
      if (sharedRules || a === 0) {
        tables.push(baseTable);
      } else if (rulesetName === "random") {
        tables.push(randomTable(rng, randomColors, randomStates));
      } else {
        // Curated presets get seeded mutants instead of unrelated tables so
        // the piece still reads as one family of marks.
        tables.push(mutateTable(baseTable, rng));
      }
    }

    // ── Grid → canvas mapping (square cells, centered in the margin box) ──
    const boxW = Math.max(1, width - margin * 2);
    const boxH = Math.max(1, height - margin * 2);
    const cell = Math.min(boxW, boxH) / gridSize;
    const originX = (width - cell * gridSize) / 2 + cell / 2;
    const originY = (height - cell * gridSize) / 2 + cell / 2;

    const mapPath = (pts: { gx: number; gy: number }[]): Point[] => {
      const out: Point[] = new Array(pts.length);
      for (let i = 0; i < pts.length; i++) {
        out[i] = { x: originX + pts[i].gx * cell, y: originY + pts[i].gy * cell };
      }
      return out;
    };

    // ── Simulation ──
    // The grid wraps (torus). That keeps every agent inside the frame — a
    // Langton highway that would run off to infinity instead re-enters and
    // starts weaving through its own earlier work.
    const grid = new Int8Array(gridSize * gridSize);

    // Trails sampling stride is widened up-front so the point cap can't be
    // exceeded, rather than truncating a path mid-flight.
    const effStride =
      renderStyle === "trails"
        ? Math.max(trailStride, Math.ceil((steps * agentCount) / MAX_TRAIL_POINTS))
        : trailStride;

    const trails: Point[][] = [];
    // Agent paths are collected in grid coordinates and mapped at the end.
    let path: { gx: number; gy: number }[] = [];

    for (let a = 0; a < agentCount; a++) {
      const rules = tables[a];
      // Seeded start inside the middle half of the grid, seeded heading.
      let x = Math.floor(gridSize * 0.25 + rng() * gridSize * 0.5);
      let y = Math.floor(gridSize * 0.25 + rng() * gridSize * 0.5);
      let dir = Math.floor(rng() * 4);
      let st = 0;

      const nColors = rules.nColors;
      const table = rules.table;

      if (renderStyle === "trails") path = [{ gx: x, gy: y }];

      for (let s = 0; s < steps; s++) {
        const i = y * gridSize + x;
        const e = (st * nColors + grid[i]) * 3;
        grid[i] = table[e];
        const turn = table[e + 1];
        if (turn !== 0) dir = (dir + turn) & 3;
        st = table[e + 2];

        if (dir === 0) x++;
        else if (dir === 1) y++;
        else if (dir === 2) x--;
        else y--;

        let wrapped = false;
        if (x < 0) {
          x += gridSize;
          wrapped = true;
        } else if (x >= gridSize) {
          x -= gridSize;
          wrapped = true;
        }
        if (y < 0) {
          y += gridSize;
          wrapped = true;
        } else if (y >= gridSize) {
          y -= gridSize;
          wrapped = true;
        }

        if (renderStyle === "trails") {
          if (wrapped) {
            // Don't draw the teleport across the canvas — break the polyline.
            if (path.length >= 2) trails.push(mapPath(path));
            path = [{ gx: x, gy: y }];
          } else if (s % effStride === 0) {
            path.push({ gx: x, gy: y });
          }
        }
      }
      if (renderStyle === "trails" && path.length >= 2) trails.push(mapPath(path));
    }

    if (renderStyle === "trails") return trails;

    // ── Dots: one small mark per cell whose final state is nonzero ──
    // Mark orientation encodes the cell state (1 = horizontal, 2 = vertical,
    // 3 = diagonal), which only shows up for multi-colour random rule tables.
    const visited: number[] = [];
    for (let i = 0; i < grid.length; i++) {
      if (grid[i] !== 0) visited.push(i);
    }
    const stride = Math.max(1, Math.ceil(visited.length / MAX_DOTS));

    const half = Math.min(dotSize, cell * 1.5) / 2;
    const lines: Point[][] = [];
    for (let k = 0; k < visited.length; k += stride) {
      const i = visited[k];
      const gx = i % gridSize;
      const gy = (i / gridSize) | 0;
      const cxp = originX + gx * cell;
      const cyp = originY + gy * cell;
      const state = grid[i];
      if (crossMarks) {
        lines.push([
          { x: cxp - half, y: cyp },
          { x: cxp + half, y: cyp },
        ]);
        lines.push([
          { x: cxp, y: cyp - half },
          { x: cxp, y: cyp + half },
        ]);
      } else if (state === 2) {
        lines.push([
          { x: cxp, y: cyp - half },
          { x: cxp, y: cyp + half },
        ]);
      } else if (state >= 3) {
        const d = half * 0.7071;
        lines.push([
          { x: cxp - d, y: cyp - d },
          { x: cxp + d, y: cyp + d },
        ]);
      } else {
        lines.push([
          { x: cxp - half, y: cyp },
          { x: cxp + half, y: cyp },
        ]);
      }
    }

    return lines;
  },
};

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === "number" && Number.isFinite(v) ? Math.round(v) : fallback;
  return Math.max(min, Math.min(max, n));
}

function clampNum(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === "number" && Number.isFinite(v) ? v : fallback;
  return Math.max(min, Math.min(max, n));
}

export default turmiteTrails;
