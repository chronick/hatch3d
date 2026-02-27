import * as THREE from "three";
import { ProjectedPoint } from "./projection";

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
  renderer.setSize(width, height);
  renderer.setPixelRatio(1);

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

  const colorTarget = new THREE.WebGLRenderTarget(width, height);
  renderer.setRenderTarget(colorTarget);
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
  if (px < 0 || px >= width || py < 0 || py >= height) return 1.0;
  const idx = (py * width + px) * 4;
  return depthData[idx + 2] / 255.0;
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
