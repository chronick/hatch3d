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
        { param: "knotProbability", fn: "linear", strength: 0.7 },
        { param: "knotsPerFace", fn: "linear", strength: 0.5 },
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
      max: 576,
      step: 1,
      group: "Layout",
    },
    baseSize: {
      type: "slider",
      label: "Base Size",
      default: 1,
      min: 0.5,
      max: 3,
      step: 0.05,
      group: "Layout",
    },
    zoom: {
      type: "slider",
      label: "Zoom",
      default: 1,
      min: 0.3,
      max: 3,
      step: 0.05,
      group: "Layout",
    },
    panX: {
      type: "slider",
      label: "Pan X",
      default: 0,
      min: -0.5,
      max: 0.5,
      step: 0.01,
      group: "Layout",
    },
    panY: {
      type: "slider",
      label: "Pan Y",
      default: 0,
      min: -0.5,
      max: 0.5,
      step: 0.01,
      group: "Layout",
    },
    cubeRotation: {
      type: "slider",
      label: "Cube Rotation °",
      default: 0,
      min: -45,
      max: 45,
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
    gridRegularity: {
      type: "slider",
      label: "Grid ↔ Random",
      default: 1.0,
      min: 0,
      max: 1,
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
    knotProbability: {
      type: "slider",
      label: "Knot Probability",
      default: 0.5,
      min: 0,
      max: 1,
      step: 0.01,
      group: "Grain",
    },
    knotsPerFace: {
      type: "slider",
      label: "Max Extra Knots Per Face",
      default: 2,
      min: 0,
      max: 4,
      step: 1,
      group: "Grain",
    },
    knotSmoothness: {
      type: "slider",
      label: "Knot Blend Smoothness",
      default: 0.4,
      min: 0.05,
      max: 1,
      step: 0.01,
      group: "Grain",
    },
    flameLoops: {
      type: "toggle",
      label: "Flame Loops on Long Grain",
      default: true,
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
    const gridRegularity = Math.max(
      0,
      Math.min(1, (values.gridRegularity as number) ?? 1.0),
    );
    const baseSize = Math.max(0.5, Math.min(3, (values.baseSize as number) ?? 1));
    const zoom = Math.max(0.3, Math.min(3, (values.zoom as number) ?? 1));
    const panX = Math.max(-0.5, Math.min(0.5, (values.panX as number) ?? 0));
    const panY = Math.max(-0.5, Math.min(0.5, (values.panY as number) ?? 0));
    const cubeRotation = ((values.cubeRotation as number) ?? 0) * Math.PI / 180;
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
    const knotProb = Math.max(0, Math.min(1, (values.knotProbability as number) ?? 0.5));
    const maxExtraKnots = Math.max(
      0,
      Math.min(4, Math.floor((values.knotsPerFace as number) ?? 2)),
    );
    const knotSmoothness = Math.max(
      0.05,
      Math.min(1, (values.knotSmoothness as number) ?? 0.4),
    );
    const flameLoopsOn = (values.flameLoops as boolean) ?? true;
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
    // Pan shifts the canvas centre used for both layout (centre-biased
    // sampling) and the zoom pivot, so the two couple — zooming in on a
    // panned point keeps that point visible.
    const canvasCx = width / 2 + panX * width;
    const canvasCy = height / 2 + panY * height;
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
      sizes.push(cellScale * 0.35 * baseSize * (1 - sizeVar + sizeVar * sizeNorm));
    }

    // Grid anchors — one per block, used at gridRegularity=0 and blended
    // with the rejection-sampled position otherwise. Row-major fill so
    // blocks[0] is top-left and blocks[blockCount-1] is bottom-right.
    const cols = Math.ceil(Math.sqrt(blockCount));
    const rows = Math.ceil(blockCount / cols);
    const gridCellW = (width * (1 - 2 * margin)) / cols;
    const gridCellH = (height * (1 - 2 * margin)) / rows;
    const gridOx = width * margin + gridCellW / 2 + panX * width;
    const gridOy = height * margin + gridCellH / 2 + panY * height;
    const gridAnchor = (k: number): Point => ({
      x: gridOx + (k % cols) * gridCellW,
      y: gridOy + Math.floor(k / cols) * gridCellH,
    });

    // Largest-first greedy packing for the random component. Centre-biased
    // radial sampling (u^1.5) concentrates density near the middle.
    // Rejection tests a circle of radius ≈ edge against previously placed
    // footprints. Final position per block is lerp(grid, random, reg). At
    // reg=0 no rejection happens — grid only. If rejection fails for a
    // block at reg>0 we fall back to the grid anchor so we never drop it.
    const sizeOrder = sizes.map((_, i) => i).sort((a, b) => sizes[b] - sizes[a]);
    const placed: { x: number; y: number; r: number }[] = [];
    const randomAnchors: (Point | null)[] = new Array(blockCount).fill(null);
    const centreBias = 1.5;
    const hexFootprintFactor = 0.95;
    const MAX_TRIES = 200;
    if (gridRegularity > 0) {
      for (const idx of sizeOrder) {
        const edge = sizes[idx];
        const r = edge * hexFootprintFactor * (1 + margin * 2);
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
            randomAnchors[idx] = { x: cx, y: cy };
            break;
          }
        }
        // If dart-throwing fails, we fall through to grid anchor below.
      }
    }

    // Build final placements in original block order so grid reads top-left
    // to bottom-right when regularity is low. Lerp between the grid anchor
    // and the (successful) random anchor; fall back to grid on rejection
    // failure or when regularity is 0.
    const placedOrder: { edge: number; anchor: Point }[] = [];
    for (let k = 0; k < blockCount; k++) {
      const g = gridAnchor(k);
      const r = randomAnchors[k];
      const anchor: Point = r
        ? {
            x: g.x * (1 - gridRegularity) + r.x * gridRegularity,
            y: g.y * (1 - gridRegularity) + r.y * gridRegularity,
          }
        : g;
      placedOrder.push({ edge: sizes[k], anchor });
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
      const faces = blockFaces(anchor, edge, project, cubeRotation);
      // Classify each face as end-grain (|normal · grainAxis| high) or
      // long-grain (low). Pass shading multipliers so darker faces get
      // denser hatching. Face normals rotate with cubeRotation so the
      // alignment test still works when the cube is yawed.
      const cyRot = Math.cos(cubeRotation);
      const syRot = Math.sin(cubeRotation);
      const rotN = (n: Vec3): Vec3 => ({
        x: n.x * cyRot - n.z * syRot,
        y: n.y,
        z: n.x * syRot + n.z * cyRot,
      });
      const faceNormals: Vec3[] = [
        rotN({ x: 0, y: 1, z: 0 }),  // top
        rotN({ x: -1, y: 0, z: 0 }), // left
        rotN({ x: 0, y: 0, z: 1 }),  // right (front)
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
          const lines = endGrainContours(
            face,
            spacing,
            waviness,
            knotProb,
            maxExtraKnots,
            knotSmoothness,
            block.seed,
            fi,
            noise,
          );
          hatchLines.push(...lines);
        } else {
          // Long-grain direction in screen space — project the grain axis
          // onto the face's 2D projection.
          const dir = projectGrainDirection(grainAxis, fi, cosI, sinI);
          const faceKnots = flameLoopsOn
            ? makeFaceKnots(face, block.seed, fi, knotProb, maxExtraKnots)
            : [];
          const lines = longGrainHatches(
            face,
            dir,
            spacing,
            waviness,
            faceKnots,
            block.seed,
            noise,
          );
          hatchLines.push(...lines);
          if (flameLoopsOn) {
            for (const kn of faceKnots) {
              const loop = flameLoop(kn, dir, waviness, block.seed, fi, noise);
              const clipped = clipPolygonPolyline(face, loop, true);
              for (const c of clipped) {
                if (c.length >= 2) hatchLines.push(c);
              }
            }
          }
        }
      }

      if (outlineOn) {
        outlines.push(blockSilhouette(faces));
      }
    }

    // Zoom — uniform scale of all output polylines around canvas centre.
    // Distinct from `baseSize` (which scales per-block edge during layout);
    // zoom transforms the final rendered composition as a whole.
    const all = [...hatchLines, ...outlines];
    if (zoom === 1) return all;
    return all.map((line) =>
      line.map((p) => ({
        x: canvasCx + (p.x - canvasCx) * zoom,
        y: canvasCy + (p.y - canvasCy) * zoom,
      })),
    );
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
  yaw = 0,
): Point[][] {
  // Rotate cube corners around its own vertical axis (centred at 0.5,0.5,0.5)
  // before projecting. At yaw=0 the unit cube is axis-aligned with corners
  // at (0,0,0)–(1,1,1); at nonzero yaw each vertical slice spins in place.
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const rot = (v: Vec3): Vec3 => {
    const dx = v.x - 0.5;
    const dz = v.z - 0.5;
    return { x: 0.5 + dx * cy - dz * sy, y: v.y, z: 0.5 + dx * sy + dz * cy };
  };
  const p = (v: Vec3) => project(anchor, edge, rot(v));
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
  knotProb: number,
  maxExtraKnots: number,
  smoothness: number,
  seed: number,
  faceIdx: number,
  noise: (x: number, y: number) => number,
): Point[][] {
  // Multi-knot annual rings via a smooth union of ellipse SDFs.
  // The union field is sampled on a grid and iso-contours are extracted
  // via marching squares, stitched into polylines, wobble-perturbed, and
  // clipped to the face. With multiple knots the rings bulge around each
  // centre and blend smoothly between them — the multi-ring clustered
  // pattern the reference shows.
  const xs = face.map((p) => p.x);
  const ys = face.map((p) => p.y);
  const xmin = Math.min(...xs);
  const xmax = Math.max(...xs);
  const ymin = Math.min(...ys);
  const ymax = Math.max(...ys);
  const halfW = (xmax - xmin) / 2;
  const halfH = (ymax - ymin) / 2;

  const knots = makeFaceKnots(face, seed, faceIdx, knotProb, maxExtraKnots);

  // Normalised ellipse distance (d=0 at centre, d=1 at boundary).
  // Rings at d = 1, 1.5, 2, ... equate to concentric ellipses scaled by
  // integer/half multiples of each knot's radii. Smooth-min with k fuses
  // nearby knots into shared outer rings.
  const kSmin = smoothness;
  const field = (px: number, py: number): number => {
    let d = Infinity;
    for (const k of knots) {
      const dx = (px - k.cx) / k.rx;
      const dy = (py - k.cy) / k.ry;
      const di = Math.sqrt(dx * dx + dy * dy);
      d = smoothMin(d, di, kSmin);
    }
    return d;
  };

  // Grid resolution proportional to spacing — 2-3 samples per ring width
  // in the tightest-radius direction keeps the iso-contour sharp enough
  // that marching-squares linear interpolation reads cleanly.
  const minR = Math.min(...knots.map((k) => Math.min(k.rx, k.ry)));
  const gridStep = Math.max(2, Math.min(spacing * 0.5, minR * 0.3));
  const pad = Math.max(halfW, halfH) * 0.1;
  const gx0 = xmin - pad;
  const gy0 = ymin - pad;
  const gx1 = xmax + pad;
  const gy1 = ymax + pad;
  const gridW = Math.max(3, Math.ceil((gx1 - gx0) / gridStep) + 1);
  const gridH = Math.max(3, Math.ceil((gy1 - gy0) / gridStep) + 1);
  const vals = new Float64Array(gridW * gridH);
  for (let j = 0; j < gridH; j++) {
    for (let i = 0; i < gridW; i++) {
      vals[j * gridW + i] = field(gx0 + i * gridStep, gy0 + j * gridStep);
    }
  }

  // Ring iso-values. Start at d=1 (outermost ellipse boundary of smallest
  // knot) and march outward. Spacing in normalised units derived from
  // average knot radius so px spacing is honoured.
  const avgR = knots.reduce((s, k) => s + (k.rx + k.ry) / 2, 0) / knots.length;
  const ringStepNorm = Math.max(0.05, spacing / Math.max(1, avgR));
  const maxIso = 4.0;
  const lines: Point[][] = [];
  for (let iso = 1.0; iso <= maxIso; iso += ringStepNorm) {
    const segs = marchingSquares(vals, gridW, gridH, gx0, gy0, gridStep, iso);
    if (segs.length === 0) continue;
    const stitched = stitchSegments(segs);
    for (const pl of stitched) {
      // Wobble along the contour — sample noise scaled to world space.
      const perturbed = pl.map((p) => {
        const n = noise(
          seed * 0.001 + p.x * 0.02 + iso * 0.7,
          seed * 0.001 + p.y * 0.02,
        );
        return {
          x: p.x + n * waviness * spacing * 0.4,
          y: p.y + n * waviness * spacing * 0.4,
        };
      });
      const clipped = clipPolygonPolyline(face, perturbed, false);
      for (const c of clipped) {
        if (c.length >= 2) lines.push(c);
      }
    }
  }
  return lines;
}

function smoothMin(a: number, b: number, k: number): number {
  // Polynomial smooth-min (Inigo Quilez). Equivalent to `min(a,b)` when
  // |a-b| >= k, blends smoothly inside that band.
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - (h * h * h * k) / 6;
}

function marchingSquares(
  vals: Float64Array,
  w: number,
  h: number,
  x0: number,
  y0: number,
  step: number,
  iso: number,
): [Point, Point][] {
  const segs: [Point, Point][] = [];
  for (let j = 0; j < h - 1; j++) {
    for (let i = 0; i < w - 1; i++) {
      const v00 = vals[j * w + i];
      const v10 = vals[j * w + i + 1];
      const v11 = vals[(j + 1) * w + i + 1];
      const v01 = vals[(j + 1) * w + i];
      let idx = 0;
      if (v00 < iso) idx |= 1;
      if (v10 < iso) idx |= 2;
      if (v11 < iso) idx |= 4;
      if (v01 < iso) idx |= 8;
      if (idx === 0 || idx === 15) continue;
      const xa = x0 + i * step;
      const xb = x0 + (i + 1) * step;
      const ya = y0 + j * step;
      const yb = y0 + (j + 1) * step;
      const lerp = (va: number, vb: number): number => {
        const d = vb - va;
        return Math.abs(d) < 1e-12 ? 0.5 : (iso - va) / d;
      };
      const eTop: Point = { x: xa + (xb - xa) * lerp(v00, v10), y: ya };
      const eRight: Point = { x: xb, y: ya + (yb - ya) * lerp(v10, v11) };
      const eBottom: Point = { x: xa + (xb - xa) * lerp(v01, v11), y: yb };
      const eLeft: Point = { x: xa, y: ya + (yb - ya) * lerp(v00, v01) };
      switch (idx) {
        case 1: case 14: segs.push([eLeft, eTop]); break;
        case 2: case 13: segs.push([eTop, eRight]); break;
        case 3: case 12: segs.push([eLeft, eRight]); break;
        case 4: case 11: segs.push([eRight, eBottom]); break;
        case 5: segs.push([eLeft, eTop]); segs.push([eRight, eBottom]); break;
        case 6: case 9: segs.push([eTop, eBottom]); break;
        case 7: case 8: segs.push([eLeft, eBottom]); break;
        case 10: segs.push([eTop, eRight]); segs.push([eLeft, eBottom]); break;
      }
    }
  }
  return segs;
}

function stitchSegments(segs: [Point, Point][]): Point[][] {
  if (segs.length === 0) return [];
  const eps = 1e-3;
  const used = new Array(segs.length).fill(false);
  const near = (a: Point, b: Point) =>
    Math.abs(a.x - b.x) < eps && Math.abs(a.y - b.y) < eps;
  const lines: Point[][] = [];
  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue;
    used[i] = true;
    const line: Point[] = [segs[i][0], segs[i][1]];
    let grew = true;
    while (grew) {
      grew = false;
      const tail = line[line.length - 1];
      for (let j = 0; j < segs.length; j++) {
        if (used[j]) continue;
        if (near(segs[j][0], tail)) { line.push(segs[j][1]); used[j] = true; grew = true; break; }
        if (near(segs[j][1], tail)) { line.push(segs[j][0]); used[j] = true; grew = true; break; }
      }
    }
    grew = true;
    while (grew) {
      grew = false;
      const head = line[0];
      for (let j = 0; j < segs.length; j++) {
        if (used[j]) continue;
        if (near(segs[j][1], head)) { line.unshift(segs[j][0]); used[j] = true; grew = true; break; }
        if (near(segs[j][0], head)) { line.unshift(segs[j][1]); used[j] = true; grew = true; break; }
      }
    }
    lines.push(line);
  }
  return lines;
}

function longGrainHatches(
  face: Point[],
  dir: Point,
  spacing: number,
  waviness: number,
  knots: Knot[],
  seed: number,
  noise: (x: number, y: number) => number,
): Point[][] {
  const perp = { x: -dir.y, y: dir.x };
  const projs = face.map((p) => p.x * perp.x + p.y * perp.y);
  const lo = Math.min(...projs);
  const hi = Math.max(...projs);
  const span = hi - lo;
  if (span < 1) return [];
  // Pre-compute per-knot along/perp projections + Gaussian sigma.
  const knotInfo = knots.map((k) => ({
    kd: k.cx * dir.x + k.cy * dir.y,
    kp: k.cx * perp.x + k.cy * perp.y,
    sigma: Math.max(k.rx, k.ry) * 1.5,
  }));
  const lines: Point[][] = [];
  for (let t = lo + spacing / 2; t < hi; t += spacing) {
    const seg = clipLineToPolygon(face, dir, perp, t);
    if (!seg) continue;
    // Densify + wave-perturb along the direction. Near each knot, add a
    // Gaussian-falloff perp deflection so the scan-line band bulges
    // outward around the knot site.
    const [a, b] = seg;
    const steps = Math.max(2, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 6));
    const pl: Point[] = [];
    for (let k = 0; k <= steps; k++) {
      const u = k / steps;
      const x0 = a.x + (b.x - a.x) * u;
      const y0 = a.y + (b.y - a.y) * u;
      const n = noise(seed * 0.0007 + t * 0.02 + u * 3, seed * 0.0003 + t * 0.01);
      let offPerp = n * waviness * spacing * 0.4;
      // Gaussian knot deflection: push this point's perp-coord `t` away
      // from the knot's perp-coord `kp` with strength fading in `kd - cd`.
      const cd = x0 * dir.x + y0 * dir.y;
      for (const kn of knotInfo) {
        const dAlong = cd - kn.kd;
        const dPerp = t - kn.kp;
        const r2 = dAlong * dAlong + dPerp * dPerp;
        const g = Math.exp(-r2 / (2 * kn.sigma * kn.sigma));
        const side = dPerp >= 0 ? 1 : -1;
        offPerp += g * kn.sigma * 0.45 * side;
      }
      pl.push({ x: x0 + perp.x * offPerp, y: y0 + perp.y * offPerp });
    }
    lines.push(pl);
  }
  return lines;
}

function flameLoop(
  knot: Knot,
  dir: Point,
  waviness: number,
  seed: number,
  faceIdx: number,
  noise: (x: number, y: number) => number,
): Point[] {
  // Closed loop around the knot, elongated along the grain direction.
  // Drawn as a separate primitive from the parallel scan-lines — traces
  // the outer envelope of the Gaussian-bulged band.
  const perp = { x: -dir.y, y: dir.x };
  const base = Math.max(knot.rx, knot.ry);
  const ra = base * 1.35;
  const rb = base * 0.85;
  const samples = 48;
  const loop: Point[] = [];
  const s = (seed ^ ((faceIdx + 1) * 0x85ebca6b)) >>> 0;
  for (let k = 0; k <= samples; k++) {
    const th = (k / samples) * Math.PI * 2;
    const ca = Math.cos(th);
    const sa = Math.sin(th);
    const n = noise(s * 0.001 + ca * 2, s * 0.001 + sa * 2);
    const wob = 1 + waviness * 0.3 * n;
    loop.push({
      x: knot.cx + (dir.x * ca * ra + perp.x * sa * rb) * wob,
      y: knot.cy + (dir.y * ca * ra + perp.y * sa * rb) * wob,
    });
  }
  return loop;
}

interface Knot { cx: number; cy: number; rx: number; ry: number }

function makeFaceKnots(
  face: Point[],
  seed: number,
  faceIdx: number,
  knotProb: number,
  maxExtraKnots: number,
): Knot[] {
  const xs = face.map((p) => p.x);
  const ys = face.map((p) => p.y);
  const xmin = Math.min(...xs);
  const xmax = Math.max(...xs);
  const ymin = Math.min(...ys);
  const ymax = Math.max(...ys);
  const halfW = (xmax - xmin) / 2;
  const halfH = (ymax - ymin) / 2;
  const cx0 = (xmin + xmax) / 2;
  const cy0 = (ymin + ymax) / 2;
  const rng = mulberry32((seed ^ ((faceIdx + 1) * 0x9e3779b1)) >>> 0);
  const knots: Knot[] = [];
  knots.push({
    cx: cx0 + (rng() - 0.5) * halfW * 0.2,
    cy: cy0 + (rng() - 0.5) * halfH * 0.2,
    rx: halfW * (0.3 + rng() * 0.2),
    ry: halfH * (0.3 + rng() * 0.2),
  });
  for (let i = 0; i < maxExtraKnots; i++) {
    if (rng() > knotProb) continue;
    knots.push({
      cx: cx0 + (rng() - 0.5) * halfW * 1.4,
      cy: cy0 + (rng() - 0.5) * halfH * 1.4,
      rx: halfW * (0.15 + rng() * 0.25),
      ry: halfH * (0.15 + rng() * 0.25),
    });
  }
  return knots;
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
