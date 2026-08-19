import type { Composition2DDefinition } from "../../types";

/**
 * Gear Mesh Truchet — "Implausible Machine"
 *
 * A Truchet-family tiling whose tiles are filled with gears instead of arcs.
 * The grid is packed with 1x1, 2x1, 1x2 and 2x2 tiles; a randomised spanning
 * tree over the tile adjacency graph decides which neighbouring gears form a
 * real gear train, and the surviving contacts are solved so the two pitch
 * circles are genuinely tangent with integer tooth counts on a shared module.
 *
 * ── Exit-point scheme ──────────────────────────────────────────────────────
 * Every tile exposes one exit point per *unit half-edge* of its perimeter:
 * walking the boundary, each cell-length piece of edge carries exactly one
 * exit point at its midpoint. A tile spanning w x h cells therefore has
 * 2 * (w + h) exit points:
 *
 *     1x1 -> 4      2x1 / 1x2 -> 6      2x2 -> 8
 *
 * Two adjacent tiles share exactly the exit points that lie on their common
 * boundary (a 2x2 beside another 2x2 shares two; a 2x2 beside a 1x1 shares
 * one). Each shared exit point is a "contact" in the adjacency graph, so a
 * pair of tiles may be joined by more than one contact.
 *
 * ── Meshing ────────────────────────────────────────────────────────────────
 * A gear has a single pitch radius, so it cannot be tangent to every one of
 * its neighbours simultaneously — the radii are an over-constrained system on
 * the full adjacency graph. The spanning tree is what makes it solvable: each
 * gear takes its radius from exactly one constraint (its tree parent), so
 * radii propagate as r_child = d(parent, child) - r_parent with no conflicts.
 * Non-tree contacts are always NO-MESH (their radii are already fixed).
 *
 * Tooth counts stay integral on a single global module m (tooth pitch, given
 * as a fraction of the cell size). A meshing pair uses
 *
 *     N_total = round(2 * d / m),  N_child = N_total - N_parent,
 *     r = N * m / 2
 *
 * so N is proportional to r and the centre distance matches the sum of the
 * pitch radii to within m/2. A tree contact whose solved child radius would
 * not fit its tile, need too few teeth, or jam into an adjacent gear falls
 * back to NO-MESH; the "mesh probability" control decides how many of the
 * eligible tree contacts are meshed at all — at 0 every gear spins free, at 1
 * the sheet is as connected as the tiling allows. Because a tile's gear can
 * only reach a neighbour whose centre sits about (rA + rB) away, mixed tile
 * sizes cap the achievable mesh count; the tree walk is biased toward the
 * contacts that can be solved so the machine gets the constraints that count.
 *
 * The pair is tangent on the line joining the two centres, which coincides
 * with the shared exit point whenever the two tiles are flush (equal sizes,
 * the common case) and sits slightly off it otherwise — a single circle per
 * tile cannot pass through every exit point of a non-square tile.
 */

// Mulberry32 seeded PRNG — deterministic, fast, good distribution.
// Duplicated locally (as in the other 2D compositions) rather than shared.
function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Point = { x: number; y: number };

/** A packed tile: cell-space origin/size plus its canvas-space centre. */
export interface GearTile {
  /** Cell-space column/row of the tile's top-left cell. */
  col: number;
  row: number;
  /** Tile extent in cells (1 or 2 on each axis). */
  w: number;
  h: number;
  /** Canvas-space centre of the tile. */
  cx: number;
  cy: number;
  /** Largest pitch radius that sits inside the tile: min(w, h) * cell / 2. */
  fittedRadius: number;
}

/** A gear, one per tile. */
export interface Gear {
  tile: number;
  cx: number;
  cy: number;
  /** Pitch radius in canvas units. Always teeth * module / 2. */
  pitchRadius: number;
  teeth: number;
  /** Angle of tooth 0, radians. */
  phase: number;
  /** True when this gear took its radius from a meshing tree contact. */
  driven: boolean;
}

/** A shared exit point between two tiles. */
export interface GearContact {
  a: number;
  b: number;
  /** Canvas-space position of the shared exit point. */
  x: number;
  y: number;
  /** Part of the spanning tree. */
  tree: boolean;
  /** Solved as a real gear mesh (implies `tree`). */
  mesh: boolean;
}

export interface GearMeshLayout {
  cols: number;
  rows: number;
  cell: number;
  /** Global module (tooth pitch) in canvas units. */
  module: number;
  originX: number;
  originY: number;
  tiles: GearTile[];
  gears: Gear[];
  contacts: GearContact[];
  /** Indices into `contacts` for the contacts that actually mesh. */
  meshLinks: number[];
}

const MIN_TEETH = 6;
const ABS_MIN_TEETH = 3;

function readNumber(values: Record<string, unknown>, key: string, fallback: number): number {
  const v = values[key];
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

/**
 * Solve the tiling, spanning tree and gear radii for a set of control values.
 * Pure and deterministic — exported so tests can assert the mesh geometry
 * without rendering polylines.
 */
export function buildGearMeshLayout(
  width: number,
  height: number,
  values: Record<string, unknown>,
): GearMeshLayout {
  const cols = Math.max(2, Math.round(readNumber(values, "cols", 9)));
  const sizeMix = Math.min(1, Math.max(0, readNumber(values, "sizeMix", 0.45)));
  const meshProbability = Math.min(1, Math.max(0, readNumber(values, "meshProbability", 0.75)));
  const modFrac = Math.min(0.18, Math.max(0.05, readNumber(values, "module", 0.09)));
  const margin = Math.max(0, readNumber(values, "margin", 40));
  const seed = Math.round(readNumber(values, "seed", 42));

  const rand = mulberry32(seed);

  // Gear tips overhang their tile by at most `over * cell`; reserve that band
  // around the grid so every stroke stays inside the margin box.
  const over = 0.09 + 1.5 * modFrac;

  const availW = Math.max(1, width - 2 * margin);
  const availH = Math.max(1, height - 2 * margin);
  const cell = availW / (cols + 2 * over);
  const rows = Math.max(1, Math.floor((availH - 2 * over * cell) / cell));

  const gridW = cols * cell;
  const gridH = rows * cell;
  const originX = (width - gridW) / 2;
  const originY = (height - gridH) / 2;
  const module = modFrac * cell;

  // ── 1. Pack the grid with 1x1 / 2x1 / 1x2 / 2x2 tiles ──
  const owner = new Int32Array(cols * rows).fill(-1);
  const tiles: GearTile[] = [];

  const free = (c: number, r: number, w: number, h: number): boolean => {
    if (c + w > cols || r + h > rows) return false;
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        if (owner[(r + j) * cols + (c + i)] !== -1) return false;
      }
    }
    return true;
  };

  const place = (c: number, r: number, w: number, h: number): void => {
    const index = tiles.length;
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) owner[(r + j) * cols + (c + i)] = index;
    }
    tiles.push({
      col: c,
      row: r,
      w,
      h,
      cx: originX + (c + w / 2) * cell,
      cy: originY + (r + h / 2) * cell,
      fittedRadius: (Math.min(w, h) * cell) / 2,
    });
  };

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (owner[r * cols + c] !== -1) continue;
      // One draw per cell keeps the stream position independent of which
      // shapes happened to fit.
      const roll = rand();
      if (sizeMix > 0 && roll < sizeMix * 0.45 && free(c, r, 2, 2)) place(c, r, 2, 2);
      else if (sizeMix > 0 && roll < sizeMix * 0.72 && free(c, r, 2, 1)) place(c, r, 2, 1);
      else if (sizeMix > 0 && roll < sizeMix && free(c, r, 1, 2)) place(c, r, 1, 2);
      else place(c, r, 1, 1);
    }
  }

  // ── 2. Contacts: shared exit points on common tile boundaries ──
  const contacts: GearContact[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const here = owner[r * cols + c];
      if (c + 1 < cols) {
        const east = owner[r * cols + c + 1];
        if (east !== here) {
          contacts.push({
            a: here,
            b: east,
            x: originX + (c + 1) * cell,
            y: originY + (r + 0.5) * cell,
            tree: false,
            mesh: false,
          });
        }
      }
      if (r + 1 < rows) {
        const south = owner[(r + 1) * cols + c];
        if (south !== here) {
          contacts.push({
            a: here,
            b: south,
            x: originX + (c + 0.5) * cell,
            y: originY + (r + 1) * cell,
            tree: false,
            mesh: false,
          });
        }
      }
    }
  }

  const incident: number[][] = tiles.map(() => []);
  for (let i = 0; i < contacts.length; i++) {
    incident[contacts[i].a].push(i);
    incident[contacts[i].b].push(i);
  }

  // ── 3. Randomised spanning tree over the tile adjacency graph ──

  /** How far a contact is from being solvable as a mesh, in canvas units. */
  const meshError = (contactIndex: number): number => {
    const ct = contacts[contactIndex];
    const ta = tiles[ct.a];
    const tb = tiles[ct.b];
    const d = Math.hypot(ta.cx - tb.cx, ta.cy - tb.cy);
    return Math.abs(d - (ta.fittedRadius + tb.fittedRadius));
  };

  const visited = new Uint8Array(tiles.length);
  const parentContact = new Int32Array(tiles.length).fill(-1);
  /** Tiles in discovery order — a valid topological order for radius flow. */
  const order: number[] = [];

  for (let root = 0; root < tiles.length; root++) {
    if (visited[root]) continue;
    visited[root] = 1;
    order.push(root);
    const stack = [root];
    while (stack.length > 0) {
      const node = stack.pop()!;
      // Fisher-Yates on a copy so the walk is seeded but the graph is intact.
      const edges = incident[node].slice();
      for (let i = edges.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        const tmp = edges[i];
        edges[i] = edges[j];
        edges[j] = tmp;
      }
      // Then bias the walk toward contacts that can actually be solved as a
      // mesh (centre distance already close to the two fitted radii). The
      // tree stays a spanning tree either way; this just spends its single
      // constraint per gear on the contacts where a real gear train exists.
      edges.sort((x, y) => meshError(x) - meshError(y));
      for (const ei of edges) {
        const ct = contacts[ei];
        const next = ct.a === node ? ct.b : ct.a;
        if (visited[next]) continue;
        visited[next] = 1;
        ct.tree = true;
        parentContact[next] = ei;
        order.push(next);
        stack.push(next);
      }
    }
  }

  // ── 4. Solve radii / tooth counts along the tree ──
  const gears: Gear[] = tiles.map((t, i) => ({
    tile: i,
    cx: t.cx,
    cy: t.cy,
    pitchRadius: 0,
    teeth: 0,
    phase: 0,
    driven: false,
  }));

  const maxRadius = (t: GearTile): number => t.fittedRadius + 0.09 * cell + 0.5 * module;

  /** Snap a target radius to an integer tooth count that still fits the tile. */
  const snap = (target: number, t: GearTile): { teeth: number; radius: number } => {
    const cap = maxRadius(t);
    let teeth = Math.max(MIN_TEETH, Math.round((2 * target) / module));
    while (teeth > ABS_MIN_TEETH && (teeth * module) / 2 > cap) teeth--;
    return { teeth, radius: (teeth * module) / 2 };
  };

  /** The radius a tile's gear takes when it is not driven by a mesh. */
  const freeRadius = (t: GearTile): number =>
    (Math.max(ABS_MIN_TEETH, snap(t.fittedRadius, t).teeth - 1) * module) / 2;

  /**
   * Would giving tile `ti` radius `radius` jam it into a neighbour?
   * Solved neighbours are checked against their real radius; unsolved ones
   * against the smallest radius they can end up with, so every adjacent pair
   * is validated exactly once — when the second of the two is solved.
   */
  const jams = (ti: number, radius: number, exceptContact: number): boolean => {
    const slack = 0.5 * module;
    for (const ei of incident[ti]) {
      if (ei === exceptContact) continue;
      const ct = contacts[ei];
      const oi = ct.a === ti ? ct.b : ct.a;
      const other = gears[oi];
      const otherRadius = other.teeth > 0 ? other.pitchRadius : freeRadius(tiles[oi]);
      const d = Math.hypot(other.cx - tiles[ti].cx, other.cy - tiles[ti].cy);
      if (radius + otherRadius > d + slack) return true;
    }
    return false;
  };

  const meshLinks: number[] = [];

  for (const ti of order) {
    const tile = tiles[ti];
    const gear = gears[ti];
    const pc = parentContact[ti];

    if (pc === -1) {
      const s = snap(tile.fittedRadius, tile);
      gear.teeth = s.teeth;
      gear.pitchRadius = s.radius;
      gear.phase = 0;
      continue;
    }

    const contact = contacts[pc];
    const parentIndex = contact.a === ti ? contact.b : contact.a;
    const parent = gears[parentIndex];
    const d = Math.hypot(parent.cx - gear.cx, parent.cy - gear.cy);

    let meshed = false;
    if (rand() < meshProbability) {
      const totalTeeth = Math.round((2 * d) / module);
      const childTeeth = totalTeeth - parent.teeth;
      const childRadius = (childTeeth * module) / 2;
      if (
        childTeeth >= MIN_TEETH &&
        childRadius > 0 &&
        childRadius <= maxRadius(tile) &&
        !jams(ti, childRadius, pc)
      ) {
        gear.teeth = childTeeth;
        gear.pitchRadius = childRadius;
        gear.driven = true;
        meshed = true;

        // Phase the child so a tooth gap faces the parent's nearest tooth.
        const toChild = Math.atan2(gear.cy - parent.cy, gear.cx - parent.cx);
        const step = (2 * Math.PI) / parent.teeth;
        const k = Math.round((toChild - parent.phase) / step);
        const parentTooth = parent.phase + k * step;
        gear.phase = parentTooth + Math.PI - Math.PI / childTeeth;

        contact.mesh = true;
        meshLinks.push(pc);
      }
    }

    if (!meshed) {
      // Free-spinning gear: one tooth under the tile's nominal count, so it
      // visibly clears its neighbours without drifting far enough from the
      // fitted radius to poison the rest of the chain (a large deviation
      // here forces every descendant out of range and kills the machine).
      const teeth = Math.max(ABS_MIN_TEETH, snap(tile.fittedRadius, tile).teeth - 1);
      gear.teeth = teeth;
      gear.pitchRadius = freeRadius(tile);
      gear.phase = (rand() * 2 * Math.PI) / teeth;
    }
  }

  return {
    cols,
    rows,
    cell,
    module,
    originX,
    originY,
    tiles,
    gears,
    contacts,
    meshLinks,
  };
}

// ── Drawing ──

/** Closed outline of one gear: trapezoid teeth joined by root-circle arcs. */
function gearOutline(gear: Gear, module: number): Point[] {
  const n = gear.teeth;
  const r = gear.pitchRadius;
  const rTip = r + module;
  const rRoot = Math.max(r * 0.62, r - 1.25 * module);
  const rFlank = r + 0.45 * module;

  // Tooth half-widths are specified as *linear* distances scaled by the module
  // (a tooth is ~pi*m/2 thick at the pitch circle) and converted to angles per
  // radius, so the trapezoid keeps its taper instead of flaring outwards on
  // low tooth counts. wRoot is capped so the root arcs between teeth survive.
  const halfPitch = Math.PI / n; // half of the angular pitch
  const wRoot = Math.min((0.95 * module) / rRoot, halfPitch * 0.8);
  const wFlank = Math.min((0.68 * module) / rFlank, wRoot * 0.85);
  const wTip = Math.min((0.5 * module) / rTip, wFlank * 0.85);

  const polar = (radius: number, angle: number): Point => ({
    x: gear.cx + radius * Math.cos(angle),
    y: gear.cy + radius * Math.sin(angle),
  });

  const pts: Point[] = [];
  for (let k = 0; k < n; k++) {
    const a = gear.phase + (2 * Math.PI * k) / n;
    const aNext = gear.phase + (2 * Math.PI * (k + 1)) / n;
    pts.push(polar(rRoot, a - wRoot));
    pts.push(polar(rFlank, a - wFlank));
    pts.push(polar(rTip, a - wTip));
    pts.push(polar(rTip, a + wTip));
    pts.push(polar(rFlank, a + wFlank));
    pts.push(polar(rRoot, a + wRoot));
    // Root arc across to the next tooth (angle strictly increasing).
    const from = a + wRoot;
    const to = aNext - wRoot;
    for (let s = 1; s < 3; s++) pts.push(polar(rRoot, from + ((to - from) * s) / 3));
  }
  pts.push(pts[0]);
  return pts;
}

function circle(cx: number, cy: number, radius: number, samples = 28): Point[] {
  const pts: Point[] = [];
  for (let i = 0; i <= samples; i++) {
    const a = (i / samples) * Math.PI * 2;
    pts.push({ x: cx + radius * Math.cos(a), y: cy + radius * Math.sin(a) });
  }
  return pts;
}

/** Merge the unit boundary edges of every tile into deduplicated grid lines. */
function gridOutlines(layout: GearMeshLayout): Point[][] {
  const { cell, originX, originY, tiles } = layout;
  const horizontal = new Map<number, Set<number>>(); // gridY -> set of gridX
  const vertical = new Map<number, Set<number>>(); // gridX -> set of gridY

  const add = (map: Map<number, Set<number>>, key: number, value: number): void => {
    let set = map.get(key);
    if (!set) {
      set = new Set<number>();
      map.set(key, set);
    }
    set.add(value);
  };

  for (const t of tiles) {
    for (let i = 0; i < t.w; i++) {
      add(horizontal, t.row, t.col + i);
      add(horizontal, t.row + t.h, t.col + i);
    }
    for (let j = 0; j < t.h; j++) {
      add(vertical, t.col, t.row + j);
      add(vertical, t.col + t.w, t.row + j);
    }
  }

  const lines: Point[][] = [];

  const runs = (set: Set<number>): [number, number][] => {
    const sorted = [...set].sort((a, b) => a - b);
    const out: [number, number][] = [];
    let start = sorted[0];
    let prev = sorted[0];
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i] === prev + 1) {
        prev = sorted[i];
        continue;
      }
      out.push([start, prev]);
      start = sorted[i];
      prev = sorted[i];
    }
    out.push([start, prev]);
    return out;
  };

  for (const [gy, set] of [...horizontal.entries()].sort((a, b) => a[0] - b[0])) {
    for (const [from, to] of runs(set)) {
      const y = originY + gy * cell;
      lines.push([
        { x: originX + from * cell, y },
        { x: originX + (to + 1) * cell, y },
      ]);
    }
  }
  for (const [gx, set] of [...vertical.entries()].sort((a, b) => a[0] - b[0])) {
    for (const [from, to] of runs(set)) {
      const x = originX + gx * cell;
      lines.push([
        { x, y: originY + from * cell },
        { x, y: originY + (to + 1) * cell },
      ]);
    }
  }

  return lines;
}

const gearMeshTruchet: Composition2DDefinition = {
  id: "gearMeshTruchet",
  name: "Gear Mesh Truchet",
  description:
    "Implausible machine — mixed-size Truchet tiles filled with gears whose meshing contacts are solved along a spanning tree",
  tags: ["pattern", "truchet", "gears", "mechanical", "tiling"],
  category: "2d",
  type: "2d",

  controls: {
    cols: {
      type: "slider",
      label: "Grid Columns",
      default: 9,
      min: 3,
      max: 24,
      step: 1,
      group: "Grid",
    },
    sizeMix: {
      type: "slider",
      label: "Tile Size Mix",
      default: 0.3,
      min: 0,
      max: 1,
      step: 0.05,
      group: "Grid",
    },
    showGrid: {
      type: "toggle",
      label: "Show Tile Grid",
      default: true,
      group: "Grid",
    },
    meshProbability: {
      type: "slider",
      label: "Mesh Probability",
      default: 0.85,
      min: 0,
      max: 1,
      step: 0.05,
      group: "Mesh",
    },
    module: {
      type: "slider",
      label: "Tooth Pitch (module)",
      default: 0.09,
      min: 0.05,
      max: 0.18,
      step: 0.005,
      group: "Gear",
    },
    spokes: {
      type: "slider",
      label: "Spoke Count",
      default: 4,
      min: 0,
      max: 8,
      step: 1,
      group: "Gear",
    },
    margin: {
      type: "slider",
      label: "Margin",
      default: 40,
      min: 10,
      max: 100,
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
      group: "Pattern",
    },
  },

  generate({ width, height, values }) {
    const layout = buildGearMeshLayout(width, height, values);
    const showGrid = values.showGrid !== false;
    const spokes = Math.max(0, Math.min(8, Math.round(readNumber(values, "spokes", 4))));

    const polylines: Point[][] = [];

    if (showGrid) polylines.push(...gridOutlines(layout));

    for (const gear of layout.gears) {
      if (gear.teeth < ABS_MIN_TEETH || gear.pitchRadius <= 0) continue;

      polylines.push(gearOutline(gear, layout.module));

      const rRoot = Math.max(gear.pitchRadius * 0.55, gear.pitchRadius - 1.25 * layout.module);
      const hubR = Math.max(layout.module * 0.6, Math.min(rRoot * 0.42, gear.pitchRadius * 0.3));
      polylines.push(circle(gear.cx, gear.cy, hubR));

      if (spokes > 0) {
        const inner = hubR;
        const outer = rRoot * 0.84;
        if (outer > inner) {
          for (let s = 0; s < spokes; s++) {
            const a = gear.phase + (2 * Math.PI * s) / spokes;
            polylines.push([
              { x: gear.cx + inner * Math.cos(a), y: gear.cy + inner * Math.sin(a) },
              { x: gear.cx + outer * Math.cos(a), y: gear.cy + outer * Math.sin(a) },
            ]);
          }
        }
      }
    }

    return polylines;
  },
};

export default gearMeshTruchet;
