/**
 * Variability metrics across a set of composition variants.
 *
 * The improve-mode routine renders N variants of a composition at different
 * parameter values and needs a fast, deterministic signal for "these variants
 * are barely different" — i.e. the parameter space is thin and warrants a new
 * slider. This implements the two metrics selected in the design research
 * (vault active/3d-plotter-surfaces/design/research/variability-metrics.md):
 *
 *   Metric A — path-count CoV: coefficient of variation of the SVG path count
 *     across variants. Catches parameters with no architectural effect (a seed
 *     that only jiggles positions without adding/removing strokes).
 *   Metric B — normalized arc-length CoV: CoV of (total arc length / drawable
 *     area) across variants. Catches density changes topology misses (same path
 *     count, but one variant tightly coiled and another sparse).
 *
 * Both reuse the deterministic measurement in analyze.ts. Thresholds are named
 * constants because the research explicitly deferred empirical calibration.
 */

import { analyzeSvg } from "./analyze.js";

/**
 * Threshold bands (from the research doc — qualitative, pending calibration).
 * A variant set is "low" variability only when BOTH metrics are in their low
 * band; the combined classifier keys off the max of the two CoVs.
 */
export const VARIABILITY_THRESHOLDS = {
  /** max(pathCoV, arcCoV) below this → low variability (propose a new param). */
  LOW: 0.05,
  /** below this → medium (monitor); at/above → high (already varied, skip). */
  HIGH: 0.2,
} as const;

export type VariabilityBand = "low" | "medium" | "high";

export interface VariabilityResult {
  variants: number;
  pathCounts: number[];
  /** total arc length (mm) / drawable area (mm²) per variant. */
  normalizedArcLengths: number[];
  pathCountCoV: number;
  arcLengthCoV: number;
  band: VariabilityBand;
  /** Human-readable action for the improve-mode routine. */
  action: string;
}

/** Coefficient of variation (σ/μ) using population variance, per the research. */
export function coefficientOfVariation(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  if (mean === 0) return 0;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance) / mean;
}

export function classifyVariability(pathCoV: number, arcCoV: number): VariabilityBand {
  const maxCoV = Math.max(pathCoV, arcCoV);
  if (maxCoV < VARIABILITY_THRESHOLDS.LOW) return "low";
  if (maxCoV < VARIABILITY_THRESHOLDS.HIGH) return "medium";
  return "high";
}

const BAND_ACTION: Record<VariabilityBand, string> = {
  low: "Propose a new parameter — variants barely differ.",
  medium: "Monitor — some variation, no action yet.",
  high: "Skip — variants are already well-differentiated.",
};

/**
 * Compute variability across a set of SVG strings (each a rendered variant).
 * Needs at least 2 variants to be meaningful.
 */
export function computeVariability(svgs: string[], penWidthMm?: number): VariabilityResult {
  if (svgs.length < 2) {
    throw new Error(`Variability needs at least 2 variants (got ${svgs.length}).`);
  }
  const reports = svgs.map((svg) => analyzeSvg(svg, { penWidthMm, grid: 1 }));
  const pathCounts = reports.map((r) => r.totals.paths);
  const normalizedArcLengths = reports.map((r) => r.totals.arcLengthMm / r.drawable.areaMm2);

  const pathCountCoV = round(coefficientOfVariation(pathCounts));
  const arcLengthCoV = round(coefficientOfVariation(normalizedArcLengths));
  const band = classifyVariability(pathCountCoV, arcLengthCoV);

  return {
    variants: svgs.length,
    pathCounts,
    normalizedArcLengths: normalizedArcLengths.map((v) => round(v, 6)),
    pathCountCoV,
    arcLengthCoV,
    band,
    action: BAND_ACTION[band],
  };
}

function round(n: number, dp = 4): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}
