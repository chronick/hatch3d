import type { Composition2DDefinition, ImageSource } from "../../types";
import { SURFACES } from "../../../surfaces";

const photoHalftone: Composition2DDefinition = {
  id: "photoHalftone",
  name: "Photo-Halftone",
  description:
    "Horizontal lines with sine-wave amplitude modulation driven by an uploaded image or a built-in test pattern, producing halftone-style plotter art",
  tags: ["generative", "halftone", "amplitude", "modulation", "image"],
  category: "2d",
  type: "2d",

  macros: {
    density: {
      label: "Density",
      default: 0.5,
      targets: [
        { param: "lineCount", fn: "linear", strength: 0.8 },
        { param: "samplesPerLine", fn: "linear", strength: 0.5 },
      ],
    },
  },

  controls: {
    pattern: {
      type: "select",
      label: "Pattern",
      default: "gradient",
      options: [
        { label: "Image", value: "image" },
        { label: "Gradient", value: "gradient" },
        { label: "Circle", value: "circle" },
        { label: "Checkerboard", value: "checkerboard" },
        { label: "Noise", value: "noise" },
        { label: "Rings", value: "rings" },
      ],
      group: "Pattern",
    },
    image: {
      type: "image",
      label: "Image",
      sampleSize: 512,
      group: "Pattern",
    },
    invertImage: {
      type: "toggle",
      label: "Invert Image",
      default: false,
      group: "Pattern",
    },
    lineCount: {
      type: "slider",
      label: "Lines",
      default: 80,
      min: 20,
      max: 200,
      step: 1,
      group: "Hatching",
    },
    frequency: {
      type: "slider",
      label: "Wave Frequency",
      default: 30,
      min: 5,
      max: 100,
      step: 1,
      group: "Hatching",
    },
    maxAmplitude: {
      type: "slider",
      label: "Max Amplitude",
      default: 1.0,
      min: 0.2,
      max: 3.0,
      step: 0.1,
      group: "Hatching",
    },
    samplesPerLine: {
      type: "slider",
      label: "Samples",
      default: 200,
      min: 50,
      max: 500,
      step: 10,
      group: "Quality",
    },
    mapToSurface: {
      type: "toggle",
      label: "Map to Surface",
      default: false,
      group: "Surface",
    },
    surfaceType: {
      type: "select",
      label: "Surface",
      default: "torus",
      options: [
        { label: "Torus", value: "torus" },
        { label: "Hyperboloid", value: "hyperboloid" },
        { label: "Canopy", value: "canopy" },
        { label: "Conoid", value: "conoid" },
      ],
      group: "Surface",
    },
    rotationX: {
      type: "slider",
      label: "Rotation X",
      default: 0.4,
      min: 0,
      max: 3.14,
      step: 0.01,
      group: "Surface",
    },
    rotationY: {
      type: "slider",
      label: "Rotation Y",
      default: 0.3,
      min: 0,
      max: 6.28,
      step: 0.01,
      group: "Surface",
    },
  },

  generate({ width, height, values }) {
    const patternName = values.pattern as string;
    const lineCount = Math.round(values.lineCount as number);
    const frequency = values.frequency as number;
    const maxAmp = values.maxAmplitude as number;
    const samples = Math.round(values.samplesPerLine as number);
    const mapToSurface = values.mapToSurface as boolean;
    const surfaceKey = values.surfaceType as string;
    const rotX = values.rotationX as number;
    const rotY = values.rotationY as number;
    const image = values.image as ImageSource | null;
    const invertImage = (values.invertImage as boolean) ?? false;

    const margin = width * 0.05;
    const innerW = width - margin * 2;
    const innerH = height - margin * 2;

    // Test pattern brightness function: returns 0 (black) to 1 (white)
    function patternBrightness(nx: number, ny: number): number {
      if (patternName === "image") {
        if (!image) return 0.5; // flat grey when no image is loaded yet
        // Bilinear sample of the image's brightness grid at (nx, ny).
        // nx, ny are in [0, 1]; the grid is row-major with width*height
        // brightness floats in [0, 1]. Inverting maps white→dark so pale
        // skin photos still produce visible hatches.
        const fx = nx * (image.width - 1);
        const fy = ny * (image.height - 1);
        const x0 = Math.floor(fx);
        const y0 = Math.floor(fy);
        const x1 = Math.min(image.width - 1, x0 + 1);
        const y1 = Math.min(image.height - 1, y0 + 1);
        const tx = fx - x0;
        const ty = fy - y0;
        const b00 = image.brightness[y0 * image.width + x0];
        const b10 = image.brightness[y0 * image.width + x1];
        const b01 = image.brightness[y1 * image.width + x0];
        const b11 = image.brightness[y1 * image.width + x1];
        const b0 = b00 * (1 - tx) + b10 * tx;
        const b1 = b01 * (1 - tx) + b11 * tx;
        const b = b0 * (1 - ty) + b1 * ty;
        return invertImage ? 1 - b : b;
      } else if (patternName === "gradient") {
        return nx;
      } else if (patternName === "circle") {
        const dx = nx - 0.5;
        const dy = ny - 0.5;
        const d = Math.sqrt(dx * dx + dy * dy) * 2;
        return Math.min(1, d);
      } else if (patternName === "checkerboard") {
        const cx = Math.floor(nx * 6);
        const cy = Math.floor(ny * 6);
        return (cx + cy) % 2 === 0 ? 0.1 : 0.9;
      } else if (patternName === "noise") {
        // Simple value noise via sine hashing
        const h = Math.sin(nx * 127.1 + ny * 311.7) * 43758.5453;
        return (h - Math.floor(h));
      } else if (patternName === "rings") {
        const dx = nx - 0.5;
        const dy = ny - 0.5;
        const d = Math.sqrt(dx * dx + dy * dy) * 8;
        return (Math.sin(d * Math.PI * 2) + 1) * 0.5;
      }
      return 0.5;
    }

    // Optional surface mapping
    let surfaceFn: ((u: number, v: number) => { x: number; y: number }) | null = null;

    if (mapToSurface) {
      const surfaceDef = SURFACES[surfaceKey];
      if (surfaceDef) {
        const fn = surfaceDef.fn;
        const params = surfaceDef.defaults;
        const cosX = Math.cos(rotX), sinX = Math.sin(rotX);
        const cosY = Math.cos(rotY), sinY = Math.sin(rotY);
        const surfaceScale = innerW * 0.2;

        surfaceFn = (u: number, v: number) => {
          const p = fn(u, v, params);
          // Rotate and project
          const x1 = p.x * cosY + p.z * sinY;
          const y1 = p.y;
          const z1 = -p.x * sinY + p.z * cosY;
          const x2 = x1;
          const y2 = y1 * cosX - z1 * sinX;
          return {
            x: width / 2 + x2 * surfaceScale,
            y: height / 2 - y2 * surfaceScale,
          };
        };
      }
    }

    const polylines: { x: number; y: number }[][] = [];
    const lineSpacing = innerH / (lineCount - 1);

    for (let li = 0; li < lineCount; li++) {
      const ny = li / (lineCount - 1); // Normalized y: 0..1
      const baseY = margin + ny * innerH;
      const halfSpacing = lineSpacing * 0.45 * maxAmp;

      const pts: { x: number; y: number }[] = [];

      for (let si = 0; si <= samples; si++) {
        const nx = si / samples; // Normalized x: 0..1
        const brightness = patternBrightness(nx, ny);

        // Darkness drives amplitude: dark = large waves, bright = flat
        const darkness = 1 - brightness;
        const amplitude = darkness * halfSpacing;

        const phase = nx * frequency * Math.PI * 2;
        const waveOffset = amplitude * Math.sin(phase);

        if (surfaceFn) {
          // Map through surface: use nx as u, ny + wave offset in v
          const vOffset = waveOffset / innerH;
          const mapped = surfaceFn(nx, Math.max(0, Math.min(1, ny + vOffset)));
          pts.push(mapped);
        } else {
          pts.push({
            x: margin + nx * innerW,
            y: baseY + waveOffset,
          });
        }
      }

      polylines.push(pts);
    }

    return polylines;
  },
};

export default photoHalftone;
