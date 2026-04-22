import { createNoise2D } from "simplex-noise";
import type { Composition2DDefinition } from "../../types";

type Point = { x: number; y: number };
type Vec3 = { x: number; y: number; z: number };

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const isoWoodBlocks: Composition2DDefinition = {
  id: "isoWoodBlocks",
  name: "Iso Wood Blocks",
  description:
    "Isometric wood blocks with per-block grain axis. End-grain faces get concentric SDF ellipse contours (annual rings), long-grain faces get parallel wavy hatches. Shaded faces imply lighting; optional heavy outline pass as a second pen layer.",
  tags: ["2d", "generative", "isometric", "wood-grain", "sdf"],
  category: "2d",
  type: "2d",

  macros: {
    density: {
      label: "Density",
      default: 0.5,
      targets: [
        { param: "grainContourSpacing", fn: "linear", strength: -0.8 },
        { param: "shadingContrast", fn: "exp", strength: 0.5 },
      ],
    },
    organic: {
      label: "Organic",
      default: 0.4,
      targets: [
        { param: "grainWaviness", fn: "exp", strength: 0.9 },
        { param: "grainAxisRandomness", fn: "linear", strength: 0.6 },
      ],
    },
    scale: {
      label: "Scale",
      default: 0.5,
      targets: [
        { param: "blockCount", fn: "linear", strength: -0.7 },
        { param: "sizeVariance", fn: "linear", strength: 0.5 },
        { param: "smallAccentProportion", fn: "linear", strength: 0.4 },
        { param: "packingMargin", fn: "linear", strength: -0.3 },
      ],
    },
  },

  controls: {
    blockCount: {
      type: "slider",
      label: "Block Count",
      default: 18,
      min: 4,
      max: 64,
      step: 1,
      group: "Layout",
    },
    sizeVariance: {
      type: "slider",
      label: "Size Variance",
      default: 0.55,
      min: 0,
      max: 1,
      step: 0.01,
      group: "Layout",
    },
    smallAccentProportion: {
      type: "slider",
      label: "Small Accent Proportion",
      default: 0.2,
      min: 0,
      max: 0.5,
      step: 0.01,
      group: "Layout",
    },
    packingMargin: {
      type: "slider",
      label: "Packing Margin",
      default: 0.04,
      min: 0,
      max: 0.15,
      step: 0.005,
      group: "Layout",
    },
    isoAngle: {
      type: "slider",
      label: "Isometric Angle °",
      default: 30,
      min: 20,
      max: 45,
      step: 0.5,
      group: "Layout",
    },
    grainContourSpacing: {
      type: "slider",
      label: "Grain Contour Spacing",
      default: 0.06,
      min: 0.02,
      max: 0.18,
      step: 0.005,
      group: "Grain",
    },
    shadingContrast: {
      type: "slider",
      label: "Face Shading Contrast",
      default: 0.6,
      min: 0,
      max: 1,
      step: 0.01,
      group: "Grain",
    },
    grainWaviness: {
      type: "slider",
      label: "Grain Line Waviness",
      default: 0.3,
      min: 0,
      max: 1,
      step: 0.01,
      group: "Grain",
    },
    grainAxisRandomness: {
      type: "slider",
      label: "Grain Axis Randomness",
      default: 0.7,
      min: 0,
      max: 1,
      step: 0.01,
      group: "Grain",
    },
    outlineWeight: {
      type: "toggle",
      label: "Heavy Outline Pass",
      default: true,
      group: "Pens",
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
    const blockCount = Math.max(1, Math.floor((values.blockCount as number) ?? 18));
    const sizeVar = Math.max(0, Math.min(1, (values.sizeVariance as number) ?? 0.55));
    const smallAccentProportion = Math.max(
      0,
      Math.min(0.5, (values.smallAccentProportion as number) ?? 0.2),
    );
    const margin = Math.max(0, Math.min(0.3, (values.packingMargin as number) ?? 0.04));
    const isoAngle = ((values.isoAngle as number) ?? 30) * Math.PI / 180;
    const grainSpacing = Math.max(
      0.01,
      Math.min(0.3, (values.grainContourSpacing as number) ?? 0.06),
    );
    const shadingContrast = Math.max(
      0,
      Math.min(1, (values.shadingContrast as number) ?? 0.6),
    );
    const waviness = Math.max(0, Math.min(1, (values.grainWaviness as number) ?? 0.3));
    const axisRandom = Math.max(
      0,
      Math.min(1, (values.grainAxisRandomness as number) ?? 0.7),
    );
    const outlineOn = (values.outlineWeight as boolean) ?? true;
    const seed = Math.floor((values.seed as number) ?? 42);

    const rng = mulberry32(seed);
    const noise = createNoise2D(rng);

    // ── LAYOUT — greedy rejection-sampled organic packing ──
    // Draw all block sizes first, then place largest-first to maximise the
    // chance each one finds a spot. Candidate positions are sampled with a
    // radial bias toward canvas centre (density concentrates in the middle,
    // scatters at edges). Collision rejection uses a circle approximation
    // of each block's isometric hex footprint (~edge in circumradius).
    // Isometric basis in 2D screen space — for a unit cube of edge length
    // `u`, the three isometric axes project as:
    //   X → (+u cos(iso), -u sin(iso))
    //   Y → (0, -u)
    //   Z → (-u cos(iso), -u sin(iso))
    const cosI = Math.cos(isoAngle);
    const sinI = Math.sin(isoAngle);
    const canvasCx = width / 2;
    const canvasCy = height / 2;
    const usableR = Math.min(width, height) * (0.5 - margin);
    const cellScale = usableR / Math.max(3, Math.sqrt(blockCount));

    // Two-bucket size draw: a small-accent bucket (≈0.15–0.3) chosen with
    // `smallAccentProportion` probability, otherwise a wide log-uniform
    // draw (0.25–1.0, 4× range). Reference (watagua Blocks IV) reads as a
    // population of regular blocks with scattered tiny accents, not a
    // smooth distribution — the explicit bucket enforces that visual.
    const sizes: number[] = [];
    for (let k = 0; k < blockCount; k++) {
      const accentRoll = rng();
      const t = rng();
      const sizeNorm =
        accentRoll < smallAccentProportion
          ? Math.exp(Math.log(0.15) * (1 - t) + Math.log(0.3) * t)
          : Math.exp(Math.log(0.25) * (1 - t) + Math.log(1.0) * t);
      sizes.push(cellScale * 0.35 * (1 - sizeVar + sizeVar * sizeNorm));
    }

    // Largest-first greedy packing. Centre-biased radial sampling (u^1.5)
    // concentrates density near the middle. Rejection tests a circle of
    // radius ≈ edge against previously placed footprints.
    const sizeOrder = sizes.map((_, i) => i).sort((a, b) => sizes[b] - sizes[a]);
    const placed: { x: number; y: number; r: number }[] = [];
    const placedOrder: { edge: number; anchor: Point }[] = [];
    const centreBias = 1.5;
    const hexFootprintFactor = 0.95;
    const MAX_TRIES = 200;
    for (const idx of sizeOrder) {
      const edge = sizes[idx];
      const r = edge * hexFootprintFactor * (1 + margin * 2);
      let found = false;
      for (let tri = 0; tri < MAX_TRIES; tri++) {
        const u = Math.pow(rng(), centreBias);
        const rr = u * usableR;
        const theta = rng() * Math.PI * 2;
        const cx = canvasCx + Math.cos(theta) * rr;
        const cy = canvasCy + Math.sin(theta) * rr;
        let overlap = false;
        for (const pl of placed) {
          const dx = pl.x - cx;
          const dy = pl.y - cy;
          const minD = pl.r + r;
          if (dx * dx + dy * dy < minD * minD) {
            overlap = true;
            break;
          }
        }
        if (!overlap) {
          placed.push({ x: cx, y: cy, r });
          placedOrder.push({ edge, anchor: { x: cx, y: cy } });
          found = true;
          break;
        }
      }
      // If dart-throwing fails after MAX_TRIES, drop this block — effective
      // blockCount becomes "target, not guarantee". Better than forcing
      // overlaps when packing gets tight.
      if (!found) continue;
    }

    const blocks: Block[] = [];
    for (const { edge, anchor } of placedOrder) {
      // Per-block 3D grain axis — blend between world-Y (vertical grain) and
      // a random direction. Higher axisRandom → more varied per-block.
      const theta = rng() * Math.PI * 2;
      const phi = (rng() - 0.5) * Math.PI;
      const randAxis: Vec3 = {
        x: Math.cos(phi) * Math.cos(theta),
        y: Math.sin(phi),
        z: Math.cos(phi) * Math.sin(theta),
      };
      const defaultAxis: Vec3 = { x: 0, y: 1, z: 0 };
      const grainAxis = normalize({
        x: defaultAxis.x * (1 - axisRandom) + randAxis.x * axisRandom,
        y: defaultAxis.y * (1 - axisRandom) + randAxis.y * axisRandom,
        z: defaultAxis.z * (1 - axisRandom) + randAxis.z * axisRandom,
      });
      blocks.push({ anchor, edge, grainAxis, seed: Math.floor(rng() * 1e6) });
    }

    // Project a 3D point (X,Y,Z) relative to block anchor + edge length to 2D.
    const project = (origin: Point, edge: number, p: Vec3): Point => ({
      x: origin.x + edge * (p.x * cosI - p.z * cosI),
      y: origin.y - edge * (p.y - p.x * sinI - p.z * sinI),
    });

    // ── PER-BLOCK RENDER ──
    const hatchLines: Point[][] = [];
    const outlines: Point[][] = [];
    for (const block of blocks) {
      const { anchor, edge, grainAxis } = block;
      const faces = blockFaces(anchor, edge, project);
      // Classify each face as end-grain (|normal · grainAxis| high) or
      // long-grain (low). Pass shading multipliers so darker faces get
      // denser hatching.
      const faceNormals: Vec3[] = [
        { x: 0, y: 1, z: 0 },  // top
        { x: -1, y: 0, z: 0 }, // left
        { x: 0, y: 0, z: 1 },  // right (front)
      ];
      // Lighting direction — from upper-left in world space so the top reads
      // lit and the right face reads shaded.
      const light = normalize({ x: -0.5, y: 0.8, z: -0.3 });
      const topMul = 0.7;
      const leftMul = 1.0;
      const rightMul = 1.0 + shadingContrast * 0.5;
      const shadingMul = [topMul, leftMul, rightMul];

      for (let fi = 0; fi < 3; fi++) {
        const face = faces[fi];
        const normal = faceNormals[fi];
        const alignment = Math.abs(dot(normal, grainAxis));
        const isEndGrain = alignment > 0.55;
        const lum = Math.max(0, dot(normal, light));
        const densityBoost = 1 + shadingContrast * (0.7 - lum);
        const spacing = Math.max(
          2,
          grainSpacing * edge * shadingMul[fi] / Math.max(0.6, densityBoost),
        );
        if (isEndGrain) {
          const lines = endGrainContours(face, spacing, waviness, block.seed, noise);
          hatchLines.push(...lines);
        } else {
          // Long-grain direction in screen space — project the grain axis
          // onto the face's 2D projection.
          const dir = projectGrainDirection(grainAxis, fi, cosI, sinI);
          const lines = longGrainHatches(face, dir, spacing, waviness, block.seed, noise);
          hatchLines.push(...lines);
        }
      }

      if (outlineOn) {
        outlines.push(blockSilhouette(faces));
      }
    }

    return [...hatchLines, ...outlines];
  },
};

// ── Types and helpers ──

interface Block {
  anchor: Point;
  edge: number;
  grainAxis: Vec3;
  seed: number;
}

function blockFaces(
  anchor: Point,
  edge: number,
  project: (origin: Point, edge: number, p: Vec3) => Point,
): Point[][] {
  const p = (v: Vec3) => project(anchor, edge, v);
  // The three visible faces of a unit cube anchored at origin (0,0,0) with
  // near-corner at (+1, 0, +1), in CCW order as viewed from outside.
  const top = [
    p({ x: 0, y: 1, z: 0 }),
    p({ x: 1, y: 1, z: 0 }),
    p({ x: 1, y: 1, z: 1 }),
    p({ x: 0, y: 1, z: 1 }),
  ];
  const left = [
    p({ x: 0, y: 0, z: 0 }),
    p({ x: 0, y: 0, z: 1 }),
    p({ x: 0, y: 1, z: 1 }),
    p({ x: 0, y: 1, z: 0 }),
  ];
  const right = [
    p({ x: 0, y: 0, z: 1 }),
    p({ x: 1, y: 0, z: 1 }),
    p({ x: 1, y: 1, z: 1 }),
    p({ x: 0, y: 1, z: 1 }),
  ];
  return [top, left, right];
}

function blockSilhouette(faces: Point[][]): Point[] {
  // The outer hex silhouette is the union boundary of the three face
  // quads. For a perfect unit cube in isometric projection, this is 6
  // corner points: the top centre, the two upper-flanking points, the
  // two lower-flanking points, and the bottom centre. We compute it by
  // taking the extreme points from each face.
  const pts = faces.flat();
  // Find centroid.
  const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
  // Deduplicate by quantised coord.
  const seen = new Set<string>();
  const unique: Point[] = [];
  for (const p of pts) {
    const k = `${Math.round(p.x * 100)},${Math.round(p.y * 100)}`;
    if (!seen.has(k)) {
      seen.add(k);
      unique.push(p);
    }
  }
  // Sort around the centroid.
  unique.sort(
    (a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx),
  );
  return [...unique, unique[0]];
}

function endGrainContours(
  face: Point[],
  spacing: number,
  waviness: number,
  seed: number,
  noise: (x: number, y: number) => number,
): Point[][] {
  // One ellipse centre per face, placed near the centre with small jitter.
  // Rings grow outward from that centre at `spacing` px intervals, clipped
  // to the face polygon.
  const cx = face.reduce((s, p) => s + p.x, 0) / face.length;
  const cy = face.reduce((s, p) => s + p.y, 0) / face.length;
  // Ellipse aspect from the face's bbox (in-plane anisotropy).
  const xs = face.map((p) => p.x);
  const ys = face.map((p) => p.y);
  const halfW = (Math.max(...xs) - Math.min(...xs)) / 2;
  const halfH = (Math.max(...ys) - Math.min(...ys)) / 2;
  const aspectX = halfW / Math.max(1e-6, Math.min(halfW, halfH));
  const aspectY = halfH / Math.max(1e-6, Math.min(halfW, halfH));
  const maxR = Math.hypot(halfW, halfH) * 1.5;
  const samples = 48;
  const lines: Point[][] = [];
  for (let r = spacing * 0.5; r <= maxR; r += spacing) {
    const ring: Point[] = [];
    for (let k = 0; k <= samples; k++) {
      const th = (k / samples) * Math.PI * 2;
      const nx = Math.cos(th);
      const ny = Math.sin(th);
      const wobble =
        waviness * spacing * 0.4 * noise(
          seed * 0.001 + r * 0.3 + Math.cos(th) * 2,
          seed * 0.001 + Math.sin(th) * 2,
        );
      const rr = r + wobble;
      ring.push({
        x: cx + nx * rr * aspectX,
        y: cy + ny * rr * aspectY,
      });
    }
    const clipped = clipPolygonPolyline(face, ring, true);
    for (const c of clipped) {
      if (c.length >= 2) lines.push(c);
    }
  }
  return lines;
}

function longGrainHatches(
  face: Point[],
  dir: Point,
  spacing: number,
  waviness: number,
  seed: number,
  noise: (x: number, y: number) => number,
): Point[][] {
  const perp = { x: -dir.y, y: dir.x };
  const projs = face.map((p) => p.x * perp.x + p.y * perp.y);
  const lo = Math.min(...projs);
  const hi = Math.max(...projs);
  const span = hi - lo;
  if (span < 1) return [];
  const lines: Point[][] = [];
  for (let t = lo + spacing / 2; t < hi; t += spacing) {
    const seg = clipLineToPolygon(face, dir, perp, t);
    if (!seg) continue;
    // Densify + wave-perturb along the direction.
    const [a, b] = seg;
    const steps = Math.max(2, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 6));
    const pl: Point[] = [];
    for (let k = 0; k <= steps; k++) {
      const u = k / steps;
      const x = a.x + (b.x - a.x) * u;
      const y = a.y + (b.y - a.y) * u;
      const n = noise(seed * 0.0007 + t * 0.02 + u * 3, seed * 0.0003 + t * 0.01);
      pl.push({ x: x + perp.x * n * waviness * spacing * 0.4, y: y + perp.y * n * waviness * spacing * 0.4 });
    }
    lines.push(pl);
  }
  return lines;
}

// Infinite line `{p: dot(p, perp) = t}`, parameterised along `dir`, clipped to polygon.
function clipLineToPolygon(
  poly: Point[],
  dir: Point,
  perp: Point,
  t: number,
): [Point, Point] | null {
  const hits: Point[] = [];
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % n];
    const da = a.x * perp.x + a.y * perp.y - t;
    const db = b.x * perp.x + b.y * perp.y - t;
    if (Math.abs(da - db) < 1e-9) continue;
    if (da * db > 0 && Math.abs(da) > 1e-9 && Math.abs(db) > 1e-9) continue;
    const u = da / (da - db);
    hits.push({ x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u });
  }
  if (hits.length < 2) return null;
  hits.sort(
    (a, b) => (a.x * dir.x + a.y * dir.y) - (b.x * dir.x + b.y * dir.y),
  );
  return [hits[0], hits[hits.length - 1]];
}

// Clip a polyline (or closed ring) to a convex polygon. Returns 0+ subsegments.
function clipPolygonPolyline(
  poly: Point[],
  line: Point[],
  closed: boolean,
): Point[][] {
  const out: Point[][] = [];
  let current: Point[] = [];
  const total = closed ? line.length : line.length;
  for (let i = 0; i < total - (closed ? 0 : 1); i++) {
    const a = line[i];
    const b = line[(i + 1) % line.length];
    const seg = clipSegmentToPolygon(poly, a, b);
    if (!seg) {
      if (current.length >= 2) out.push(current);
      current = [];
      continue;
    }
    const [ca, cb] = seg;
    // Chain consecutive segments that share endpoints.
    if (current.length === 0) {
      current.push(ca, cb);
    } else {
      const last = current[current.length - 1];
      if (Math.hypot(last.x - ca.x, last.y - ca.y) < 0.5) {
        current.push(cb);
      } else {
        if (current.length >= 2) out.push(current);
        current = [ca, cb];
      }
    }
  }
  if (current.length >= 2) out.push(current);
  return out;
}

function clipSegmentToPolygon(poly: Point[], a: Point, b: Point): [Point, Point] | null {
  // Sutherland-Hodgman-style against each edge treated as a half-plane.
  let pa = a;
  let pb = b;
  const n = poly.length;
  // Assume CCW polygon — interior is left of each edge.
  for (let i = 0; i < n; i++) {
    const e0 = poly[i];
    const e1 = poly[(i + 1) % n];
    const ex = e1.x - e0.x;
    const ey = e1.y - e0.y;
    const sa = (pa.x - e0.x) * ey - (pa.y - e0.y) * ex;
    const sb = (pb.x - e0.x) * ey - (pb.y - e0.y) * ex;
    const aIn = sa <= 1e-6;
    const bIn = sb <= 1e-6;
    if (!aIn && !bIn) return null;
    if (aIn && bIn) continue;
    // One endpoint in, one out — compute intersection.
    const u = sa / (sa - sb);
    const ix = pa.x + (pb.x - pa.x) * u;
    const iy = pa.y + (pb.y - pa.y) * u;
    if (aIn) pb = { x: ix, y: iy };
    else pa = { x: ix, y: iy };
  }
  return [pa, pb];
}

// Return a screen-space 2D unit direction that the projected grain axis
// takes on the chosen face class (top/left/right). For long-grain faces
// this gives the visual hatch direction.
function projectGrainDirection(
  axis: Vec3,
  faceIdx: number,
  cosI: number,
  sinI: number,
): Point {
  // Approximate: project the 3D grain axis with the iso projection and
  // ignore normal-aligned component.
  const proj = {
    x: axis.x * cosI - axis.z * cosI,
    y: -(axis.y - axis.x * sinI - axis.z * sinI),
  };
  const len = Math.hypot(proj.x, proj.y);
  if (len < 1e-4) {
    // Fall back to a face-specific default.
    if (faceIdx === 0) return { x: 1, y: 0 };
    if (faceIdx === 1) return { x: 0, y: 1 };
    return { x: 0, y: 1 };
  }
  return { x: proj.x / len, y: proj.y / len };
}

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}
function normalize(v: Vec3): Vec3 {
  const l = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / l, y: v.y / l, z: v.z / l };
}

export default isoWoodBlocks;
