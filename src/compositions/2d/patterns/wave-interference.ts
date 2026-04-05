import type { Composition2DDefinition } from "../../types";

const waveInterference: Composition2DDefinition = {
  id: "waveInterference",
  name: "Wave Interference",
  description:
    "Concentric wave sources with interference patterns rendered as iso-contours",
  tags: ["pattern", "waves", "interference", "physics", "contour"],
  category: "2d",
  type: "2d",

  controls: {
    sources: {
      type: "slider",
      label: "Sources",
      default: 2,
      min: 1,
      max: 6,
      step: 1,
      group: "Waves",
    },
    wavelength: {
      type: "slider",
      label: "Wavelength",
      default: 40,
      min: 10,
      max: 150,
      step: 1,
      group: "Waves",
    },
    amplitude: {
      type: "slider",
      label: "Amplitude",
      default: 1,
      min: 0.1,
      max: 3,
      step: 0.1,
      group: "Waves",
    },
    sourceSpread: {
      type: "slider",
      label: "Source Spread",
      default: 0.3,
      min: 0.05,
      max: 0.8,
      step: 0.01,
      group: "Waves",
    },
    contourLevels: {
      type: "slider",
      label: "Contour Levels",
      default: 8,
      min: 2,
      max: 30,
      step: 1,
      group: "Contours",
    },
    gridResolution: {
      type: "slider",
      label: "Resolution",
      default: 2,
      min: 0.5,
      max: 5,
      step: 0.25,
      group: "Contours",
    },
    decay: {
      type: "slider",
      label: "Distance Decay",
      default: 0,
      min: 0,
      max: 0.02,
      step: 0.001,
      group: "Waves",
    },
    phaseOffset: {
      type: "slider",
      label: "Phase Offset",
      default: 0,
      min: 0,
      max: 360,
      step: 1,
      group: "Waves",
    },
  },

  generate({ width, height, values }) {
    const numSources = Math.round(values.sources as number);
    const wavelength = values.wavelength as number;
    const amplitude = values.amplitude as number;
    const sourceSpread = values.sourceSpread as number;
    const contourLevels = Math.round(values.contourLevels as number);
    const res = values.gridResolution as number;
    const decay = values.decay as number;
    const phaseOffsetDeg = values.phaseOffset as number;
    const phaseOffsetRad = (phaseOffsetDeg * Math.PI) / 180;

    const cx = width / 2;
    const cy = height / 2;
    const k = (2 * Math.PI) / wavelength;

    // Place sources on a circle
    const spreadRadius = sourceSpread * Math.min(width, height) / 2;
    const srcs: { x: number; y: number; phase: number }[] = [];
    for (let i = 0; i < numSources; i++) {
      const angle = (i / numSources) * Math.PI * 2;
      srcs.push({
        x: cx + Math.cos(angle) * spreadRadius,
        y: cy + Math.sin(angle) * spreadRadius,
        phase: phaseOffsetRad * i,
      });
    }

    // Build scalar field
    const cols = Math.ceil(width / res) + 1;
    const rows = Math.ceil(height / res) + 1;
    const field = new Float64Array(cols * rows);
    let fMin = Infinity;
    let fMax = -Infinity;

    for (let iy = 0; iy < rows; iy++) {
      const py = iy * res;
      for (let ix = 0; ix < cols; ix++) {
        const px = ix * res;
        let v = 0;
        for (let s = 0; s < srcs.length; s++) {
          const dx = px - srcs[s].x;
          const dy = py - srcs[s].y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          let contrib = amplitude * Math.sin(k * dist + srcs[s].phase);
          if (decay > 0) contrib /= 1 + decay * dist;
          v += contrib;
        }
        const idx = iy * cols + ix;
        field[idx] = v;
        if (v < fMin) fMin = v;
        if (v > fMax) fMax = v;
      }
    }

    // Avoid degenerate case where field is flat
    if (fMax - fMin < 1e-10) return [];

    // Compute contour thresholds (evenly spaced, excluding extremes)
    const thresholds: number[] = [];
    for (let i = 1; i <= contourLevels; i++) {
      thresholds.push(fMin + (i / (contourLevels + 1)) * (fMax - fMin));
    }

    // Marching squares — extract segments for each threshold, then chain
    const polylines: { x: number; y: number }[][] = [];

    for (let t = 0; t < thresholds.length; t++) {
      const threshold = thresholds[t];
      const segments: [number, number, number, number][] = [];

      for (let iy = 0; iy < rows - 1; iy++) {
        for (let ix = 0; ix < cols - 1; ix++) {
          const i00 = iy * cols + ix;
          const i10 = i00 + 1;
          const i01 = i00 + cols;
          const i11 = i01 + 1;

          const v00 = field[i00];
          const v10 = field[i10];
          const v01 = field[i01];
          const v11 = field[i11];

          // Cell corners: top-left=00, top-right=10, bottom-left=01, bottom-right=11
          const b00 = v00 >= threshold ? 1 : 0;
          const b10 = v10 >= threshold ? 1 : 0;
          const b01 = v01 >= threshold ? 1 : 0;
          const b11 = v11 >= threshold ? 1 : 0;
          const caseIndex = b00 | (b10 << 1) | (b11 << 2) | (b01 << 3);

          if (caseIndex === 0 || caseIndex === 15) continue;

          const x0 = ix * res;
          const y0 = iy * res;
          const x1 = x0 + res;
          const y1 = y0 + res;

          // Interpolation helpers — returns position along edge
          const lerpT = (va: number, vb: number) =>
            (threshold - va) / (vb - va);

          // Edge midpoints with linear interpolation
          // Top edge (00 → 10): y=y0, x varies
          const top = (): [number, number] => {
            const f = lerpT(v00, v10);
            return [x0 + f * res, y0];
          };
          // Bottom edge (01 → 11): y=y1, x varies
          const bottom = (): [number, number] => {
            const f = lerpT(v01, v11);
            return [x0 + f * res, y1];
          };
          // Left edge (00 → 01): x=x0, y varies
          const left = (): [number, number] => {
            const f = lerpT(v00, v01);
            return [x0, y0 + f * res];
          };
          // Right edge (10 → 11): x=x1, y varies
          const right = (): [number, number] => {
            const f = lerpT(v10, v11);
            return [x1, y0 + f * res];
          };

          // Emit segments based on the 16 marching squares cases
          const addSeg = (
            a: [number, number],
            b: [number, number],
          ) => {
            segments.push([a[0], a[1], b[0], b[1]]);
          };

          switch (caseIndex) {
            case 1:  addSeg(top(), left()); break;
            case 2:  addSeg(top(), right()); break;
            case 3:  addSeg(left(), right()); break;
            case 4:  addSeg(right(), bottom()); break;
            case 5: {
              // Saddle — use center value to disambiguate
              const center = (v00 + v10 + v01 + v11) / 4;
              if (center >= threshold) {
                addSeg(top(), right());
                addSeg(left(), bottom());
              } else {
                addSeg(top(), left());
                addSeg(right(), bottom());
              }
              break;
            }
            case 6:  addSeg(top(), bottom()); break;
            case 7:  addSeg(left(), bottom()); break;
            case 8:  addSeg(left(), bottom()); break;
            case 9:  addSeg(top(), bottom()); break;
            case 10: {
              // Saddle
              const center = (v00 + v10 + v01 + v11) / 4;
              if (center >= threshold) {
                addSeg(top(), left());
                addSeg(right(), bottom());
              } else {
                addSeg(top(), right());
                addSeg(left(), bottom());
              }
              break;
            }
            case 11: addSeg(right(), bottom()); break;
            case 12: addSeg(left(), right()); break;
            case 13: addSeg(top(), right()); break;
            case 14: addSeg(top(), left()); break;
          }
        }
      }

      // Chain segments into polylines
      if (segments.length === 0) continue;

      // Build adjacency: map from quantized endpoint → list of segment indices
      const eps = 0.01;
      const quantize = (v: number) => Math.round(v / eps);
      const keyOf = (x: number, y: number) =>
        `${quantize(x)},${quantize(y)}`;

      const adj = new Map<string, number[]>();
      const addAdj = (key: string, idx: number) => {
        let list = adj.get(key);
        if (!list) {
          list = [];
          adj.set(key, list);
        }
        list.push(idx);
      };

      for (let i = 0; i < segments.length; i++) {
        const s = segments[i];
        addAdj(keyOf(s[0], s[1]), i);
        addAdj(keyOf(s[2], s[3]), i);
      }

      const used = new Uint8Array(segments.length);

      for (let i = 0; i < segments.length; i++) {
        if (used[i]) continue;
        used[i] = 1;

        const s = segments[i];
        const chain: { x: number; y: number }[] = [
          { x: s[0], y: s[1] },
          { x: s[2], y: s[3] },
        ];

        // Extend forward from the last point
        let extended = true;
        while (extended) {
          extended = false;
          const last = chain[chain.length - 1];
          const key = keyOf(last.x, last.y);
          const neighbors = adj.get(key);
          if (neighbors) {
            for (let n = 0; n < neighbors.length; n++) {
              const ni = neighbors[n];
              if (used[ni]) continue;
              used[ni] = 1;
              const ns = segments[ni];
              const k0 = keyOf(ns[0], ns[1]);
              if (k0 === key) {
                chain.push({ x: ns[2], y: ns[3] });
              } else {
                chain.push({ x: ns[0], y: ns[1] });
              }
              extended = true;
              break;
            }
          }
        }

        // Extend backward from the first point
        extended = true;
        while (extended) {
          extended = false;
          const first = chain[0];
          const key = keyOf(first.x, first.y);
          const neighbors = adj.get(key);
          if (neighbors) {
            for (let n = 0; n < neighbors.length; n++) {
              const ni = neighbors[n];
              if (used[ni]) continue;
              used[ni] = 1;
              const ns = segments[ni];
              const k0 = keyOf(ns[0], ns[1]);
              if (k0 === key) {
                chain.unshift({ x: ns[2], y: ns[3] });
              } else {
                chain.unshift({ x: ns[0], y: ns[1] });
              }
              extended = true;
              break;
            }
          }
        }

        if (chain.length >= 2) {
          polylines.push(chain);
        }
      }
    }

    return polylines;
  },
};

export default waveInterference;
