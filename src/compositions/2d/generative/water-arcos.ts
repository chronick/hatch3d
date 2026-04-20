import { createNoise2D } from "simplex-noise";
import type { Composition2DDefinition } from "../../types";

type Point = { x: number; y: number };

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

const waterArcos: Composition2DDefinition = {
  id: "waterArcos",
  name: "Water Arcos",
  description:
    "Phase-coupled sine columns evoking rippling water — dense vertical lines whose lateral wiggle shares noise with neighbors, producing coherent channels of exposed paper where column families diverge.",
  tags: ["2d", "generative", "flow-field", "water", "sine-columns"],
  category: "2d",
  type: "2d",

  macros: {
    density: {
      label: "Density",
      default: 0.5,
      targets: [
        { param: "columnCount", fn: "linear", strength: 0.8 },
        { param: "lineSpacing", fn: "linear", strength: -0.6 },
      ],
    },
    chaos: {
      label: "Chaos",
      default: 0.4,
      targets: [
        { param: "phaseNoiseStrength", fn: "exp", strength: 0.9 },
        { param: "lateralCoupling", fn: "linear", strength: -0.5 },
      ],
    },
    flow: {
      label: "Flow",
      default: 0.5,
      targets: [
        { param: "baseAmplitude", fn: "exp", strength: 0.8 },
        { param: "lateralCoupling", fn: "linear", strength: 0.6 },
      ],
    },
  },

  controls: {
    columnCount: {
      type: "slider",
      label: "Column Count",
      default: 50,
      min: 20,
      max: 200,
      step: 1,
      group: "Structure",
    },
    lineSpacing: {
      type: "slider",
      label: "Sample Spacing (px)",
      default: 4,
      min: 1,
      max: 12,
      step: 0.5,
      group: "Structure",
    },
    baseAmplitude: {
      type: "slider",
      label: "Wave Amplitude",
      default: 7,
      min: 1,
      max: 40,
      step: 0.5,
      group: "Wave",
    },
    baseFrequency: {
      type: "slider",
      label: "Wave Frequency",
      default: 0.012,
      min: 0.002,
      max: 0.06,
      step: 0.001,
      group: "Wave",
    },
    phaseNoiseScale: {
      type: "slider",
      label: "Phase Noise Scale",
      default: 0.04,
      min: 0.005,
      max: 0.5,
      step: 0.005,
      group: "Wave",
    },
    phaseNoiseStrength: {
      type: "slider",
      label: "Phase Noise Strength",
      default: 1.6,
      min: 0.0,
      max: 8.0,
      step: 0.1,
      group: "Wave",
    },
    lateralCoupling: {
      type: "slider",
      label: "Lateral Coupling",
      default: 0.85,
      min: 0.0,
      max: 1.0,
      step: 0.01,
      group: "Wave",
    },
    amplitudeMaskScale: {
      type: "slider",
      label: "Channel Mask Scale",
      default: 0.035,
      min: 0.005,
      max: 0.2,
      step: 0.005,
      group: "Wave",
    },
    amplitudeMaskStrength: {
      type: "slider",
      label: "Channel Mask Strength",
      default: 0.55,
      min: 0.0,
      max: 1.2,
      step: 0.05,
      group: "Wave",
    },
    gapThreshold: {
      type: "slider",
      label: "Channel Gap Threshold",
      default: 3.0,
      min: 0.0,
      max: 3.0,
      step: 0.05,
      group: "Structure",
    },
    edgeRagged: {
      type: "slider",
      label: "Ragged Edge Amount",
      default: 0.035,
      min: 0.0,
      max: 0.15,
      step: 0.005,
      group: "Structure",
    },
    edgeTaper: {
      type: "slider",
      label: "Margin Inset",
      default: 0.04,
      min: 0.0,
      max: 0.3,
      step: 0.005,
      group: "Structure",
    },
    seed: {
      type: "slider",
      label: "Seed",
      default: 42,
      min: 0,
      max: 999,
      step: 1,
      group: "Structure",
    },
  },

  generate({ width, height, values }) {
    const columnCount = Math.max(2, Math.floor((values.columnCount as number) ?? 80));
    const sampleSpacing = Math.max(0.5, (values.lineSpacing as number) ?? 4);
    const amplitude = (values.baseAmplitude as number) ?? 12;
    const frequency = (values.baseFrequency as number) ?? 0.018;
    const noiseScale = (values.phaseNoiseScale as number) ?? 0.12;
    const noiseStrength = (values.phaseNoiseStrength as number) ?? 2.8;
    const coupling = Math.min(1, Math.max(0, (values.lateralCoupling as number) ?? 0.55));
    const ampMaskScale = (values.amplitudeMaskScale as number) ?? 0.035;
    const ampMaskStrength = (values.amplitudeMaskStrength as number) ?? 0.9;
    const gapThreshold = (values.gapThreshold as number) ?? 0.55;
    const edgeRagged = (values.edgeRagged as number) ?? 0.035;
    const edgeTaper = (values.edgeTaper as number) ?? 0.04;
    const seed = Math.floor((values.seed as number) ?? 42);

    const rng = mulberry32(seed);
    const noise = createNoise2D(rng);

    const stripWidth = width / columnCount;
    const sampleCount = Math.max(2, Math.floor(height / sampleSpacing));
    const dy = height / (sampleCount - 1);

    // Pre-compute per-(column, sample) raw phase, then couple with neighbors.
    const rawPhase: number[][] = [];
    for (let i = 0; i < columnCount; i++) {
      const row: number[] = new Array(sampleCount);
      for (let j = 0; j < sampleCount; j++) {
        const y = j * dy;
        row[j] =
          frequency * y +
          noiseStrength * noise(i * noiseScale, y * noiseScale * 0.3);
      }
      rawPhase.push(row);
    }

    // Lateral coupling: blend each column's phase toward its two neighbors.
    const phase: number[][] = [];
    for (let i = 0; i < columnCount; i++) {
      const row: number[] = new Array(sampleCount);
      const left = rawPhase[Math.max(0, i - 1)];
      const right = rawPhase[Math.min(columnCount - 1, i + 1)];
      const self = rawPhase[i];
      for (let j = 0; j < sampleCount; j++) {
        const neighborAvg = 0.5 * (left[j] + right[j]);
        row[j] = self[j] * (1 - coupling) + neighborAvg * coupling;
      }
      phase.push(row);
    }

    // Slow amplitude mask: a low-frequency 2D noise that modulates each
    // column's local wiggle amplitude. Where the mask is high, neighboring
    // columns diverge widely and create river channels of exposed paper;
    // where the mask is low, columns stay close and hatch tightly.
    const maskAt = (i: number, y: number) => {
      const xNorm = (i / columnCount) * width;
      const n = noise(xNorm * ampMaskScale, y * ampMaskScale * 0.5);
      // Remap [-1, 1] -> [1 - strength, 1 + strength] so strength 0 = uniform.
      return 1 + n * ampMaskStrength;
    };

    // Per-sample x positions per column.
    const cols: number[][] = [];
    for (let i = 0; i < columnCount; i++) {
      const xBase = stripWidth * (i + 0.5);
      const row: number[] = new Array(sampleCount);
      for (let j = 0; j < sampleCount; j++) {
        const y = j * dy;
        const mask = Math.max(0, maskAt(i, y));
        row[j] = xBase + amplitude * mask * Math.sin(phase[i][j]);
      }
      cols.push(row);
    }

    // Emit each column as one or more polylines; break at the top/bottom
    // edge tapers and at spots where a column pulls far enough away from
    // its neighbors to create a visible paper channel.
    const lines: Point[][] = [];
    const gapAbs = gapThreshold * stripWidth;
    const marginTop = edgeTaper * height;
    const marginBottom = height - edgeTaper * height;
    const raggedRange = edgeRagged * height;

    // Per-column start/end offsets so the field's silhouette is organic,
    // not a flat rectangular crop.
    const topOffsets = new Array(columnCount);
    const bottomOffsets = new Array(columnCount);
    for (let i = 0; i < columnCount; i++) {
      topOffsets[i] = marginTop + raggedRange * (0.5 + 0.5 * noise(i * 0.07, 11.1));
      bottomOffsets[i] =
        marginBottom - raggedRange * (0.5 + 0.5 * noise(i * 0.07, 23.4));
    }

    for (let i = 0; i < columnCount; i++) {
      let current: Point[] = [];
      const topY = topOffsets[i];
      const bottomY = bottomOffsets[i];
      for (let j = 0; j < sampleCount; j++) {
        const y = j * dy;
        if (y < topY || y > bottomY) {
          if (current.length >= 2) lines.push(current);
          current = [];
          continue;
        }
        const x = cols[i][j];
        const leftGap =
          i > 0 ? Math.abs(x - cols[i - 1][j]) - stripWidth : 0;
        const rightGap =
          i < columnCount - 1
            ? Math.abs(cols[i + 1][j] - x) - stripWidth
            : 0;
        const widest = Math.max(leftGap, rightGap);
        if (widest > gapAbs) {
          if (current.length >= 2) lines.push(current);
          current = [];
          continue;
        }
        current.push({ x, y });
      }
      if (current.length >= 2) lines.push(current);
    }

    return lines;
  },
};

export default waterArcos;
