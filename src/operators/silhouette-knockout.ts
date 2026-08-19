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
 */
const MS_TABLE: number[][][] = [
  [],                     // 0
  [[3, 2]],               // 1  BL
  [[2, 1]],               // 2  BR
  [[3, 1]],               // 3  BL BR
  [[1, 0]],               // 4  TR
  [[1, 0], [3, 2]],       // 5  TR BL (saddle)
  [[2, 0]],               // 6  TR BR
  [[3, 0]],               // 7  all but TL
  [[0, 3]],               // 8  TL
  [[0, 2]],               // 9  TL BL
  [[0, 3], [2, 1]],       // 10 TL BR (saddle)
  [[0, 1]],               // 11 all but TR
  [[1, 3]],               // 12 TL TR
  [[1, 2]],               // 13 all but BR
  [[2, 3]],               // 14 all but BL
  [],                     // 15
];

/**
 * Extract closed contour rings around the dark (`brightness < threshold`)
 * regions of an image, mapped into a `targetW` x `targetH` box.
 *
 * The grid is padded with a one-sample bright border so regions touching the
 * image edge still close into rings. Crossing points are linearly
 * interpolated on brightness, so contours are smoother than pure cell
 * midpoints. Holes come out as their own rings, which is exactly what the
 * even-odd `pointInSilhouette` wants.
 */
export function ringsFromThreshold(
  image: ThresholdImage,
  threshold: number,
  targetW: number,
  targetH: number,
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

  /** Interpolated crossing on the grid edge from corner (x0,y0) to (x1,y1). */
  const cross = (x0: number, y0: number, x1: number, y1: number): Point => {
    const a = at(x0, y0);
    const b = at(x1, y1);
    let t = 0.5;
    if (b !== a) t = (threshold - a) / (b - a);
    t = Math.min(1, Math.max(0, t));
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

  const key = (p: Point) => `${p.x.toFixed(6)},${p.y.toFixed(6)}`;

  type Seg = { a: Point; b: Point };
  const segs: Seg[] = [];
  const startIndex = new Map<string, number>();

  for (let cy = -1; cy < h; cy++) {
    for (let cx = -1; cx < w; cx++) {
      const idx =
        (dark(cx, cy) ? 8 : 0) +
        (dark(cx + 1, cy) ? 4 : 0) +
        (dark(cx + 1, cy + 1) ? 2 : 0) +
        (dark(cx, cy + 1) ? 1 : 0);
      const entries = MS_TABLE[idx];
      if (entries.length === 0) continue;
      for (const [from, to] of entries) {
        const a = edgePoint(cx, cy, from);
        const b = edgePoint(cx, cy, to);
        const k = key(a);
        if (!startIndex.has(k)) startIndex.set(k, segs.length);
        segs.push({ a, b });
      }
    }
  }

  // Map grid coordinates into the target box. Sample i sits at its pixel
  // center, so the real image spans grid [-0.5, w-0.5].
  const mapX = (gx: number) => Math.min(targetW, Math.max(0, ((gx + 0.5) / w) * targetW));
  const mapY = (gy: number) => Math.min(targetH, Math.max(0, ((gy + 0.5) / h) * targetH));

  const used = new Array<boolean>(segs.length).fill(false);
  const rings: Polyline[] = [];

  for (let s = 0; s < segs.length; s++) {
    if (used[s]) continue;
    const ring: Polyline = [];
    let i = s;
    for (let guard = 0; guard <= segs.length; guard++) {
      used[i] = true;
      const seg = segs[i];
      ring.push({ x: mapX(seg.a.x), y: mapY(seg.a.y) });
      const next = startIndex.get(key(seg.b));
      if (next === undefined || used[next]) {
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
