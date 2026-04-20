import * as THREE from "three";
import type { ProjectedPoint } from "./projection";

interface DepthBuffer {
  depthData: Uint8Array;
  width: number;
  height: number;
}

export function renderDepthBuffer(
  meshGeometries: THREE.BufferGeometry[],
  camera: THREE.Camera,
  width: number,
  height: number
): DepthBuffer {
  const renderer = new THREE.WebGLRenderer({ antialias: false });
  renderer.setPixelRatio(1);
  renderer.setSize(width, height);

  // Force linear output so the depth shader values are stored as-is (no sRGB gamma).
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;

  // Clear to transparent — alpha=0 marks "no mesh data" pixels.
  renderer.setClearColor(new THREE.Color(0, 0, 0), 0);

  const depthScene = new THREE.Scene();
  const depthVisMat = new THREE.ShaderMaterial({
    vertexShader: `
      varying float vDepth;
      void main() {
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        vDepth = gl_Position.z / gl_Position.w * 0.5 + 0.5;
      }
    `,
    fragmentShader: `
      varying float vDepth;
      void main() {
        float d = vDepth;
        float r = floor(d * 255.0) / 255.0;
        float g = floor((d * 255.0 - floor(d * 255.0)) * 255.0) / 255.0;
        gl_FragColor = vec4(r, g, d, 1.0);
      }
    `,
    side: THREE.DoubleSide,
  });

  for (const geo of meshGeometries) {
    depthScene.add(new THREE.Mesh(geo, depthVisMat));
  }

  const colorTarget = new THREE.WebGLRenderTarget(width, height, {
    colorSpace: THREE.LinearSRGBColorSpace,
  });
  renderer.setRenderTarget(colorTarget);
  renderer.setViewport(0, 0, width, height);
  renderer.render(depthScene, camera);

  const colorPixels = new Uint8Array(width * height * 4);
  renderer.readRenderTargetPixels(colorTarget, 0, 0, width, height, colorPixels);

  renderer.setRenderTarget(null);
  renderer.dispose();
  colorTarget.dispose();

  return { depthData: colorPixels, width, height };
}

/**
 * Same as renderDepthBuffer but creates an OffscreenCanvas for use in Web Workers
 * where DOM canvas elements are unavailable.
 */
export function renderDepthBufferOffscreen(
  meshGeometries: THREE.BufferGeometry[],
  camera: THREE.Camera,
  width: number,
  height: number
): DepthBuffer {
  const canvas = new OffscreenCanvas(width, height);
  const renderer = new THREE.WebGLRenderer({ canvas: canvas as unknown as HTMLCanvasElement, antialias: false });
  renderer.setPixelRatio(1);
  renderer.setSize(width, height, false);

  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.setClearColor(new THREE.Color(0, 0, 0), 0);

  const depthScene = new THREE.Scene();
  const depthVisMat = new THREE.ShaderMaterial({
    vertexShader: `
      varying float vDepth;
      void main() {
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        vDepth = gl_Position.z / gl_Position.w * 0.5 + 0.5;
      }
    `,
    fragmentShader: `
      varying float vDepth;
      void main() {
        float d = vDepth;
        float r = floor(d * 255.0) / 255.0;
        float g = floor((d * 255.0 - floor(d * 255.0)) * 255.0) / 255.0;
        gl_FragColor = vec4(r, g, d, 1.0);
      }
    `,
    side: THREE.DoubleSide,
  });

  for (const geo of meshGeometries) {
    depthScene.add(new THREE.Mesh(geo, depthVisMat));
  }

  const colorTarget = new THREE.WebGLRenderTarget(width, height, {
    colorSpace: THREE.LinearSRGBColorSpace,
  });
  renderer.setRenderTarget(colorTarget);
  renderer.setViewport(0, 0, width, height);
  renderer.render(depthScene, camera);

  const colorPixels = new Uint8Array(width * height * 4);
  renderer.readRenderTargetPixels(colorTarget, 0, 0, width, height, colorPixels);

  renderer.setRenderTarget(null);
  renderer.dispose();
  colorTarget.dispose();

  return { depthData: colorPixels, width, height };
}

function sampleDepthBuffer(depthBuffer: DepthBuffer, x: number, y: number): number {
  const { depthData, width, height } = depthBuffer;
  const px = Math.round(x);
  const py = Math.round(height - 1 - y);

  // Out-of-bounds → treat as occluded (depth 0 = very close).
  // This hides lines that fall outside the camera frustum, where we
  // have no depth data to produce correct occlusion.
  if (px < 0 || px >= width || py < 0 || py >= height) return 0.0;

  const idx = (py * width + px) * 4;

  // Alpha < 128 means the clear value (no mesh rendered here) → far depth
  if (depthData[idx + 3] < 128) return 1.0;

  // The fragment shader packs depth across two channels for precision:
  //   R = floor(d * 255) / 255                       — high byte
  //   G = floor((d * 255 - floor(d * 255)) * 255)/255 — low byte
  // Reading only B (which round-trips to 8 bits through the RGBA8 target)
  // was wasting the shader's 16-bit encoding. Reconstruct both for ~65k
  // depth levels — crucial for multi-face compositions (e.g. stepped
  // heightfields) where many faces live within a narrow depth range.
  const r = depthData[idx] / 255.0;
  const g = depthData[idx + 1] / (255.0 * 255.0);
  return r + g;
}

export function clipPolylineByDepth(
  polyline2D: ProjectedPoint[],
  depthBuffer: DepthBuffer,
  bias = 0.005
): ProjectedPoint[][] {
  const visible: ProjectedPoint[][] = [];
  let currentSegment: ProjectedPoint[] = [];

  for (const pt of polyline2D) {
    const bufferDepth = sampleDepthBuffer(depthBuffer, pt.x, pt.y);
    const isVisible = pt.depth <= bufferDepth + bias;

    if (isVisible) {
      currentSegment.push(pt);
    } else {
      if (currentSegment.length >= 2) {
        visible.push([...currentSegment]);
      }
      currentSegment = [];
    }
  }
  if (currentSegment.length >= 2) {
    visible.push(currentSegment);
  }

  return visible;
}
