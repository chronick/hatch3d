/**
 * silhouette-knockout — mask a polyline field by a closed silhouette.
 *
 * The classic screen-print/plotter move: fill the whole page with one
 * texture (concentric circles, hatch, rays) and *knock out* a shape from
 * it, so the subject reads as negative space. Optionally the interior gets
 * a second, sparser texture so the shape is legible rather than blank.
 *
 * A silhouette is one or more **closed rings**. Multiple rings compose by
 * the even-odd rule, so a ring nested inside another punches a hole (an
 * eye, a gap in a leaf). Ring winding direction is irrelevant.
 *
 * Clipping genuinely *splits* polylines at boundary crossings — each input
 * segment is cut at every ring intersection and only the sub-spans on the
 * kept side survive. Nothing is decided per-polyline by a midpoint test, so
 * a single long circle may come back as several arcs.
 *
 * Dependency-free, pure and deterministic: same input, same output. No rng.
 */

export type Point = { x: number; y: number };
export type Polyline = Point[];

/** Points closer than this (in px) are treated as the same location. */
const EPS = 1e-9;

/**
 * How far a marching-squares crossing is kept away from either end of the grid
 * edge it sits on, as a fraction of that edge. See `ringsFromThreshold`.
 *
 * **Why a contour crossing may never land on a lattice point.** The classifier
 * is `dark = brightness < threshold` — strict — so a sample sitting *exactly* on
 * the threshold is bright. Interpolating a crossing on the edge between it and a
 * dark neighbour gives `t = (threshold - a)/(b - a) = 1` (or 0 the other way
 * round): the crossing lands on the lattice point itself. Every crossing on
 * every edge incident to that sample collapses to the same point, so up to four
 * strands meet there and the tracer has to *pair* them — and a wrong pairing
 * welds two lobes into one ring that passes through the point twice, a
 * figure-eight rather than a contour.
 *
 * There is no local rule that pairs them correctly. Two 3×3 fields (both in the
 * tests) present the *identical* local picture at the junction — dark wedges
 * left and right, bright wedges above and below — and want opposite pairings:
 * one wants the walks to hug the dark wedges, the other wants them to hug the
 * bright ones. Which is right depends on how the lobes connect elsewhere in the
 * image, so a turn rule measured at the junction — sharpest right, sharpest
 * left, straight through — is right on one and wrong on the other.
 *
 * The fix is therefore not a better pairing rule but removing the tie, and the
 * classifier already says which way to break it: `threshold` counts as *bright*,
 * so the crossing belongs strictly on the dark side of a threshold-valued
 * corner, not on top of it. Clamping `t` into `[CROSSING_EPS, 1-CROSSING_EPS]`
 * states exactly that, and it buys the invariant the chaining pass rests on:
 *
 *  - every crossing is strictly interior to its edge, so crossings on different
 *    edges are distinct points (edge interiors are disjoint) and each edge holds
 *    at most one crossing;
 *  - a strand runs between crossings on two *different* edges of its cell, so no
 *    strand is degenerate;
 *  - an edge is shared by exactly two cells and the table orients both with dark
 *    on the right, so of the two strands touching a crossing exactly one leaves
 *    it. The successor is unique — there is nothing left to choose.
 *
 * Rings are therefore simple by construction. The cost is that a pinch comes
 * back open by a couple of `CROSSING_EPS` of one grid cell instead of exactly
 * closed, which is invisible in the fill: even-odd classification of a
 * self-touching walk and of the same walk opened by a hair agree everywhere
 * except on that hair. The value is bounded below by the need to keep the two
 * sides of a pinch distinct as doubles once mapped into the target box, and
 * above by the area it perturbs; a billionth of a cell clears both by orders of
 * magnitude.
 */
const CROSSING_EPS = 1e-9;

// ── Point-in-silhouette ──────────────────────────────────────────────

/**
 * Even-odd (crossing-count) point-in-polygon over every edge of every ring.
 *
 * Rings need not be explicitly closed — the segment from last point back to
 * first is always considered. Points exactly on a boundary are undefined
 * (they may land either way); callers that care should test an interior
 * sample instead.
 */
export function pointInSilhouette(p: Point, rings: Polyline[]): boolean {
  let inside = false;
  for (const ring of rings) {
    const n = ring.length;
    if (n < 3) continue;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const a = ring[i];
      const b = ring[j];
      // Half-open rule on y avoids double-counting shared vertices.
      if ((a.y > p.y) !== (b.y > p.y)) {
        const t = (p.y - a.y) / (b.y - a.y);
        const xCross = a.x + t * (b.x - a.x);
        if (p.x < xCross) inside = !inside;
      }
    }
  }
  return inside;
}

// ── Segment / ring intersection ──────────────────────────────────────

/**
 * Parameters t along segment a→b where it crosses any ring edge, sorted
 * ascending, strictly inside (0,1). Collinear overlaps are skipped (the
 * midpoint classification of the neighbouring spans still resolves them).
 */
function crossingParams(a: Point, b: Point, rings: Polyline[]): number[] {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const ts: number[] = [];

  for (const ring of rings) {
    const n = ring.length;
    if (n < 2) continue;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const c = ring[j];
      const d = ring[i];
      const cdx = d.x - c.x;
      const cdy = d.y - c.y;
      const denom = abx * cdy - aby * cdx;
      if (Math.abs(denom) < 1e-12) continue; // parallel or degenerate
      const acx = c.x - a.x;
      const acy = c.y - a.y;
      const t = (acx * cdy - acy * cdx) / denom;
      const u = (acx * aby - acy * abx) / denom;
      if (t > EPS && t < 1 - EPS && u >= -EPS && u <= 1 + EPS) ts.push(t);
    }
  }

  ts.sort((x, y) => x - y);

  // Dedupe near-identical crossings (a ring vertex sitting on the segment
  // is found once per adjacent edge).
  const out: number[] = [];
  for (const t of ts) {
    if (out.length === 0 || t - out[out.length - 1] > 1e-9) out.push(t);
  }
  return out;
}

function lerp(a: Point, b: Point, t: number): Point {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function samePoint(a: Point, b: Point): boolean {
  return Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9;
}

// ── Clipping ─────────────────────────────────────────────────────────

/**
 * Clip polylines to the inside (or outside) of a silhouette.
 *
 * Each segment is split at every crossing with a ring edge; the midpoint of
 * each resulting span decides whether it is kept. Consecutive kept spans are
 * welded back into one polyline; a gap starts a new one. Sub-polylines with
 * fewer than 2 points are dropped.
 */
export function clipPolylinesToSilhouette(
  lines: Polyline[],
  rings: Polyline[],
  mode: "inside" | "outside",
): Polyline[] {
  const wantInside = mode === "inside";
  const usableRings = rings.filter((r) => r.length >= 3);

  // No silhouette: everything is "outside".
  if (usableRings.length === 0) {
    if (wantInside) return [];
    return lines.filter((l) => l.length >= 2).map((l) => l.map((p) => ({ ...p })));
  }

  const out: Polyline[] = [];

  for (const line of lines) {
    if (line.length < 2) continue;

    let current: Polyline = [];

    const flush = () => {
      if (current.length >= 2) out.push(current);
      current = [];
    };

    for (let i = 0; i < line.length - 1; i++) {
      const a = line[i];
      const b = line[i + 1];
      if (samePoint(a, b)) continue;

      const ts = crossingParams(a, b, usableRings);
      const bounds = [0, ...ts, 1];

      for (let k = 0; k < bounds.length - 1; k++) {
        const t0 = bounds[k];
        const t1 = bounds[k + 1];
        if (t1 - t0 < 1e-12) continue;

        const mid = lerp(a, b, (t0 + t1) / 2);
        const keep = pointInSilhouette(mid, usableRings) === wantInside;

        if (!keep) {
          flush();
          continue;
        }

        const p0 = t0 === 0 ? a : lerp(a, b, t0);
        const p1 = t1 === 1 ? b : lerp(a, b, t1);

        if (current.length === 0) {
          current.push({ x: p0.x, y: p0.y });
        } else if (!samePoint(current[current.length - 1], p0)) {
          flush();
          current.push({ x: p0.x, y: p0.y });
        }
        current.push({ x: p1.x, y: p1.y });
      }
    }

    flush();
  }

  return out;
}

/**
 * Convenience composition of the two clips: the background `field` survives
 * only outside the silhouette, and an optional `insideTexture` only inside
 * it. The result is field-first, so pen ordering follows the visual layers.
 */
export function knockout(
  field: Polyline[],
  rings: Polyline[],
  opts: { insideTexture?: Polyline[] } = {},
): Polyline[] {
  const outer = clipPolylinesToSilhouette(field, rings, "outside");
  const inner = opts.insideTexture?.length
    ? clipPolylinesToSilhouette(opts.insideTexture, rings, "inside")
    : [];
  return [...outer, ...inner];
}

// ── Silhouette source: SVG path ──────────────────────────────────────

const NUMBER_RE = /-?\d*\.?\d+(?:[eE][-+]?\d+)?/g;
const COMMAND_RE = /([MmLlHhVvCcQqZz])([^MmLlHhVvCcQqZz]*)/g;

function cubicAt(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  const mt = 1 - t;
  const a = mt * mt * mt;
  const b = 3 * mt * mt * t;
  const c = 3 * mt * t * t;
  const d = t * t * t;
  return {
    x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
    y: a * p0.y + b * p1.y + c * p2.y + d * p3.y,
  };
}

function quadAt(p0: Point, p1: Point, p2: Point, t: number): Point {
  const mt = 1 - t;
  return {
    x: mt * mt * p0.x + 2 * mt * t * p1.x + t * t * p2.x,
    y: mt * mt * p0.y + 2 * mt * t * p1.y + t * t * p2.y,
  };
}

/**
 * Parse an SVG path d-string into closed rings, sampling curves to line
 * segments.
 *
 * Supports M/L/H/V/C/Q/Z in both absolute and relative form (including the
 * implicit-lineto repetition after M/m). Arcs and the smooth shorthands
 * (S/T/A) are not supported — author silhouettes with C/Q instead.
 *
 * `src/utils/clip.ts` already has `parseDString`, but it is deliberately
 * M/L-only and absolute-only, which cannot express the curved shapes this
 * operator exists for; that file is left untouched.
 *
 * Every subpath is emitted as a closed ring (first point repeated at the
 * end) whether or not it carried an explicit Z — an unclosed silhouette is
 * meaningless to the even-odd test.
 */
export function ringsFromSVGPath(d: string, samplesPerCurve = 16): Polyline[] {
  const samples = Math.max(1, Math.floor(samplesPerCurve));
  const rings: Polyline[] = [];

  let current: Polyline = [];
  let cursor: Point = { x: 0, y: 0 };
  let subpathStart: Point = { x: 0, y: 0 };

  const push = (p: Point) => {
    const last = current[current.length - 1];
    if (!last || !samePoint(last, p)) current.push({ x: p.x, y: p.y });
  };

  const finish = () => {
    if (current.length >= 3) {
      const first = current[0];
      const last = current[current.length - 1];
      if (!samePoint(first, last)) current.push({ x: first.x, y: first.y });
      rings.push(current);
    }
    current = [];
  };

  COMMAND_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = COMMAND_RE.exec(d)) !== null) {
    const cmd = m[1];
    const nums = (m[2].match(NUMBER_RE) ?? []).map(Number);
    const rel = cmd === cmd.toLowerCase() && cmd !== "Z";
    const upper = cmd.toUpperCase();

    if (upper === "Z") {
      finish();
      cursor = { x: subpathStart.x, y: subpathStart.y };
      continue;
    }

    if (upper === "M") {
      for (let i = 0; i + 1 < nums.length; i += 2) {
        const p = rel
          ? { x: cursor.x + nums[i], y: cursor.y + nums[i + 1] }
          : { x: nums[i], y: nums[i + 1] };
        if (i === 0) {
          finish();
          subpathStart = { x: p.x, y: p.y };
        }
        cursor = p;
        push(p);
      }
      continue;
    }

    if (upper === "L") {
      for (let i = 0; i + 1 < nums.length; i += 2) {
        cursor = rel
          ? { x: cursor.x + nums[i], y: cursor.y + nums[i + 1] }
          : { x: nums[i], y: nums[i + 1] };
        push(cursor);
      }
      continue;
    }

    if (upper === "H") {
      for (const n of nums) {
        cursor = { x: rel ? cursor.x + n : n, y: cursor.y };
        push(cursor);
      }
      continue;
    }

    if (upper === "V") {
      for (const n of nums) {
        cursor = { x: cursor.x, y: rel ? cursor.y + n : n };
        push(cursor);
      }
      continue;
    }

    if (upper === "C") {
      for (let i = 0; i + 5 < nums.length; i += 6) {
        const bx = rel ? cursor.x : 0;
        const by = rel ? cursor.y : 0;
        const p0 = cursor;
        const p1 = { x: bx + nums[i], y: by + nums[i + 1] };
        const p2 = { x: bx + nums[i + 2], y: by + nums[i + 3] };
        const p3 = { x: bx + nums[i + 4], y: by + nums[i + 5] };
        for (let s = 1; s <= samples; s++) push(cubicAt(p0, p1, p2, p3, s / samples));
        cursor = p3;
      }
      continue;
    }

    if (upper === "Q") {
      for (let i = 0; i + 3 < nums.length; i += 4) {
        const bx = rel ? cursor.x : 0;
        const by = rel ? cursor.y : 0;
        const p0 = cursor;
        const p1 = { x: bx + nums[i], y: by + nums[i + 1] };
        const p2 = { x: bx + nums[i + 2], y: by + nums[i + 3] };
        for (let s = 1; s <= samples; s++) push(quadAt(p0, p1, p2, s / samples));
        cursor = p2;
      }
      continue;
    }

    // Unsupported command (S/T/A): ignore rather than corrupt the ring.
  }

  finish();
  return rings;
}

// ── Silhouette source: image threshold ───────────────────────────────

export interface ThresholdImage {
  /** Row-major brightness grid, values in [0,1]. */
  brightness: Float32Array;
  width: number;
  height: number;
}

/**
 * Marching-squares table, indexed by `TL*8 + TR*4 + BR*2 + BL*1` where a set
 * bit means "dark" (brightness < threshold). Each entry lists directed
 * segments as edge-pairs, oriented so the dark region is consistently on one
 * side — that consistency is what lets segments chain head-to-tail into rings.
 *
 * Edges: 0 = top, 1 = right, 2 = bottom, 3 = left.
 *
 * Cases 5 and 10 (the two dark corners are diagonally opposite) are genuinely
 * ambiguous: the cell can be read as two dark corners that touch through the
 * middle, or as two that pinch apart. The table holds the *separated* reading;
 * `MS_SADDLE_JOINED` holds the joined one, and `ringsFromThreshold` picks
 * between them per cell (see the asymptotic decider there).
 */
const MS_TABLE: number[][][] = [
  [],                     // 0
  [[3, 2]],               // 1  BL
  [[2, 1]],               // 2  BR
  [[3, 1]],               // 3  BL BR
  [[1, 0]],               // 4  TR
  [[1, 0], [3, 2]],       // 5  TR BL (saddle, dark separated)
  [[2, 0]],               // 6  TR BR
  [[3, 0]],               // 7  all but TL
  [[0, 3]],               // 8  TL
  [[0, 2]],               // 9  TL BL
  [[0, 3], [2, 1]],       // 10 TL BR (saddle, dark separated)
  [[0, 1]],               // 11 all but TR
  [[1, 3]],               // 12 TL TR
  [[1, 2]],               // 13 all but BR
  [[2, 3]],               // 14 all but BL
  [],                     // 15
];

/**
 * The other reading of the two saddle cases: the dark diagonal is *connected*
 * through the cell centre, so it is the two bright corners that get pinched
 * off. Each entry is just the complementary single-corner case for each bright
 * corner (5 → the TL-bright and BR-bright corners of cases 7 and 13; 10 → the
 * TR-bright and BL-bright corners of cases 11 and 14), which keeps the
 * dark-on-one-side orientation the chaining depends on.
 */
const MS_SADDLE_JOINED: Record<number, number[][]> = {
  5: [[3, 0], [1, 2]],    // TR BL dark, joined through the centre
  10: [[0, 1], [2, 3]],   // TL BR dark, joined through the centre
};

/**
 * Extract closed contour rings around the dark (`brightness < threshold`)
 * regions of an image, mapped into a `targetW` x `targetH` box.
 *
 * The grid is padded with a one-sample bright border so regions touching the
 * image edge still close into rings. Crossing points are linearly
 * interpolated on brightness, so contours are smoother than pure cell
 * midpoints. Holes come out as their own rings, which is exactly what the
 * even-odd `pointInSilhouette` wants.
 *
 * **Saddles.** A cell whose two dark corners are diagonally opposite (cases 5
 * and 10) has two valid contourings, and picking one blindly is a real
 * topology bug: a one-sample-wide diagonal feature either comes apart into a
 * chain of disjoint diamonds or welds shut across a gap, depending which way the
 * guess falls. It is disambiguated by the
 * standard **asymptotic decider**: the bilinear interpolant's own saddle value,
 * `(a·d - b·c) / (a - b - c + d)` over threshold-shifted corners, decides which
 * diagonal is connected (derivation on `cellSegments` below). Both readings emit
 * two segments, so a saddle cell contributes two strands to the chaining pass
 * rather than one.
 *
 * **Samples exactly on the threshold.** The other degenerate case — a saddle
 * that sits on a *lattice point* rather than inside a cell — is removed at the
 * source instead of resolved: crossings are kept strictly inside their edge, so
 * no two of them ever coincide, every strand has exactly one possible successor,
 * and every ring returned is simple. See {@link CROSSING_EPS}.
 *
 * `box` places the result somewhere other than the origin — the grid maps onto
 * `[box.x0, box.x1] x [box.y0, box.y1]` instead of `[0, targetW] x [0,
 * targetH]`. That is what lets an occupancy raster covering an arbitrary patch
 * of canvas (`operators/region-shapes.ts`) reuse this marching-squares pass
 * unchanged; omit it and the behaviour is exactly as before.
 */
export function ringsFromThreshold(
  image: ThresholdImage,
  threshold: number,
  targetW: number,
  targetH: number,
  box?: { x0: number; y0: number; x1: number; y1: number },
): Polyline[] {
  const w = image.width;
  const h = image.height;
  if (w < 1 || h < 1) return [];

  // Padded sample accessor: indices run -1 .. w (inclusive). Outside the
  // real image the value is 1 (bright), which closes edge-touching blobs.
  const at = (x: number, y: number): number => {
    if (x < 0 || y < 0 || x >= w || y >= h) return 1;
    return image.brightness[y * w + x];
  };
  const dark = (x: number, y: number) => at(x, y) < threshold;

  /**
   * Interpolated crossing on the grid edge from corner (x0,y0) to (x1,y1),
   * always strictly *inside* that edge — never on a lattice point. That is what
   * makes the successor of a strand unique; see {@link CROSSING_EPS}.
   */
  const cross = (x0: number, y0: number, x1: number, y1: number): Point => {
    const a = at(x0, y0);
    const b = at(x1, y1);
    let t = 0.5;
    if (b !== a) t = (threshold - a) / (b - a);
    t = Math.min(1 - CROSSING_EPS, Math.max(CROSSING_EPS, t));
    return { x: x0 + (x1 - x0) * t, y: y0 + (y1 - y0) * t };
  };

  // Canonical per-edge accessors so the same physical edge yields a
  // bit-identical point from either adjacent cell (chaining relies on it).
  const edgePoint = (cx: number, cy: number, edge: number): Point => {
    if (edge === 0) return cross(cx, cy, cx + 1, cy);          // top
    if (edge === 1) return cross(cx + 1, cy, cx + 1, cy + 1);  // right
    if (edge === 2) return cross(cx, cy + 1, cx + 1, cy + 1);  // bottom
    return cross(cx, cy, cx, cy + 1);                          // left
  };

  /**
   * Canonical id of the grid edge a crossing sits on — the identity strands are
   * chained by. Horizontal edge (cx,cy)→(cx+1,cy) and vertical edge
   * (cx,cy)→(cx,cy+1) are numbered independently; cells start at (-1,-1), so
   * indices are shifted by one and columns run 0..w+1.
   *
   * Chaining on the edge rather than on the crossing's coordinates is both
   * exact (integer identity, no rounded string key, no float comparison) and
   * faster — the old `toFixed(6)` key was two allocations per strand endpoint.
   */
  const stride = w + 2;
  const edgeId = (cx: number, cy: number, edge: number): number => {
    if (edge === 0) return ((cy + 1) * stride + (cx + 1)) * 2; // top:    h(cx,   cy)
    if (edge === 2) return ((cy + 2) * stride + (cx + 1)) * 2; // bottom: h(cx,   cy+1)
    if (edge === 1) return ((cy + 1) * stride + (cx + 2)) * 2 + 1; // right:  v(cx+1, cy)
    return ((cy + 1) * stride + (cx + 1)) * 2 + 1; // left:   v(cx,   cy)
  };

  /**
   * The contouring of one cell, saddles resolved by the **asymptotic decider**.
   *
   * Write the corners shifted by the threshold — `a` = TL, `b` = TR, `c` = BL,
   * `d` = BR, each `sample - threshold`, so "dark" is exactly "negative". Over
   * the unit cell (x right, y down) the bilinear interpolant is
   *
   * ```text
   * f(x,y) = a(1-x)(1-y) + b·x(1-y) + c(1-x)y + d·xy
   *        = a + (b-a)x + (c-a)y + (a-b-c+d)xy
   * ```
   *
   * Its only stationary point is a saddle, at `x = (a-c)/D`, `y = (a-b)/D` with
   * `D = a - b - c + d`; substituting back and collecting terms leaves
   *
   * ```text
   * f_saddle = (a·d - b·c) / D
   * ```
   *
   * The two contour branches meet at that saddle, so the diagonal whose sign
   * matches `f_saddle` is the connected one. Dark is the negative side, so the
   * dark diagonal joins through the centre exactly when `f_saddle < 0` — that
   * is, when `sign(a·d - b·c) !== sign(D)`. Comparing the two signs rather than
   * multiplying keeps the test exact for tiny corner offsets.
   *
   * The old reading — "is the mean of the four corners dark?" — is `f` at the
   * cell *centre*, which is only the saddle when the cell is symmetric. On a
   * lopsided cell the saddle drifts off-centre and the mean gets the topology
   * backwards in both directions: `[0, .7; .7, .49]` (mean 0.4725, joins) is
   * genuinely separated, `[.3, .89; .52, .3]` (mean 0.5025, separates) is
   * genuinely joined. Lopsided cells are the common case anywhere the contrast
   * across a feature is uneven, and each one the mean gets wrong is a ring
   * gained or lost.
   *
   * `f_saddle` is exactly zero (or `D` is, putting the saddle at infinity) only
   * for a degenerate cell — a perfect checkerboard, or a corner sitting exactly
   * on the threshold. Neither reading is more true there, so the tie defaults to
   * *separated*, the table's own entry: two specks that a later pass can weld
   * are cheaper to reason about than a join the field does not support.
   */
  const cellSegments = (cx: number, cy: number, idx: number): number[][] => {
    if (idx !== 5 && idx !== 10) return MS_TABLE[idx];
    const a = at(cx, cy) - threshold;              // TL
    const b = at(cx + 1, cy) - threshold;          // TR
    const c = at(cx, cy + 1) - threshold;          // BL
    const d = at(cx + 1, cy + 1) - threshold;      // BR
    const num = a * d - b * c;                     // f_saddle · D
    const den = a - b - c + d;                     // D
    if (num === 0 || den === 0) return MS_TABLE[idx];   // degenerate tie
    const darkJoined = num < 0 !== den < 0;             // f_saddle < 0
    return darkJoined ? MS_SADDLE_JOINED[idx] : MS_TABLE[idx];
  };

  /** One contour strand: from its entry crossing to its exit crossing. */
  type Seg = { a: Point; b: Point; exit: number };
  const segs: Seg[] = [];
  // Which strand *leaves* by a given edge. At most one can (see CROSSING_EPS),
  // so this is a plain lookup rather than a bucket; should a malformed table
  // ever produce a second, the first wins and the other is simply picked up as
  // its own walk below rather than lost.
  const leavesBy = new Int32Array(2 * stride * (h + 3)).fill(-1);

  for (let cy = -1; cy < h; cy++) {
    for (let cx = -1; cx < w; cx++) {
      const idx =
        (dark(cx, cy) ? 8 : 0) +
        (dark(cx + 1, cy) ? 4 : 0) +
        (dark(cx + 1, cy + 1) ? 2 : 0) +
        (dark(cx, cy + 1) ? 1 : 0);
      const entries = cellSegments(cx, cy, idx);
      if (entries.length === 0) continue;
      for (const [from, to] of entries) {
        const enter = edgeId(cx, cy, from);
        if (leavesBy[enter] < 0) leavesBy[enter] = segs.length;
        segs.push({ a: edgePoint(cx, cy, from), b: edgePoint(cx, cy, to), exit: edgeId(cx, cy, to) });
      }
    }
  }

  // Map grid coordinates into the target box. Sample i sits at its pixel
  // center, so the real image spans grid [-0.5, w-0.5].
  const bx0 = box?.x0 ?? 0;
  const by0 = box?.y0 ?? 0;
  const bx1 = box?.x1 ?? targetW;
  const by1 = box?.y1 ?? targetH;
  const mapX = (gx: number) => Math.min(bx1, Math.max(bx0, bx0 + ((gx + 0.5) / w) * (bx1 - bx0)));
  const mapY = (gy: number) => Math.min(by1, Math.max(by0, by0 + ((gy + 0.5) / h) * (by1 - by0)));

  const used = new Array<boolean>(segs.length).fill(false);
  const rings: Polyline[] = [];

  // Walk each chain head-to-tail. The strand leaving by the edge this one
  // entered on is the *only* continuation there is (see CROSSING_EPS), so
  // there is no pairing choice and every ring comes back simple.
  for (let s = 0; s < segs.length; s++) {
    if (used[s]) continue;
    const ring: Polyline = [];
    let i = s;
    for (let guard = 0; guard <= segs.length; guard++) {
      used[i] = true;
      const seg = segs[i];
      ring.push({ x: mapX(seg.a.x), y: mapY(seg.a.y) });
      const next = leavesBy[seg.exit];
      if (next < 0 || used[next]) {
        // Chain ends: closed loop back to the start, or an unpaired chain.
        ring.push({ x: mapX(seg.b.x), y: mapY(seg.b.y) });
        break;
      }
      i = next;
    }
    if (ring.length >= 3) {
      const first = ring[0];
      const last = ring[ring.length - 1];
      if (!samePoint(first, last)) ring.push({ x: first.x, y: first.y });
      rings.push(ring);
    }
  }

  return rings;
}

export default knockout;
