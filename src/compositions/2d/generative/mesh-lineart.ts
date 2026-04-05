import type { Composition2DDefinition } from "../../types";

// ── Types ──

type Vec3 = [number, number, number];

interface Mesh {
  vertices: Vec3[];
  faces: [number, number, number][];
}

// ── Mesh Generators ──

function generateTorus(res: number): Mesh {
  const R = 1;
  const r = 0.4;
  const vertices: Vec3[] = [];
  const faces: [number, number, number][] = [];

  for (let i = 0; i < res; i++) {
    const u = (i / res) * Math.PI * 2;
    for (let j = 0; j < res; j++) {
      const v = (j / res) * Math.PI * 2;
      const x = (R + r * Math.cos(v)) * Math.cos(u);
      const y = (R + r * Math.cos(v)) * Math.sin(u);
      const z = r * Math.sin(v);
      vertices.push([x, y, z]);
    }
  }

  for (let i = 0; i < res; i++) {
    const ni = (i + 1) % res;
    for (let j = 0; j < res; j++) {
      const nj = (j + 1) % res;
      const a = i * res + j;
      const b = ni * res + j;
      const c = ni * res + nj;
      const d = i * res + nj;
      faces.push([a, b, c]);
      faces.push([a, c, d]);
    }
  }

  return { vertices, faces };
}

function generateSphere(res: number): Mesh {
  const vertices: Vec3[] = [];
  const faces: [number, number, number][] = [];

  // Poles
  vertices.push([0, 0, 1]);
  vertices.push([0, 0, -1]);

  // Interior rings
  const rings = res;
  const segs = res * 2;
  for (let i = 1; i < rings; i++) {
    const theta = (i / rings) * Math.PI;
    const sinT = Math.sin(theta);
    const cosT = Math.cos(theta);
    for (let j = 0; j < segs; j++) {
      const phi = (j / segs) * Math.PI * 2;
      vertices.push([sinT * Math.cos(phi), sinT * Math.sin(phi), cosT]);
    }
  }

  // Top cap
  for (let j = 0; j < segs; j++) {
    const nj = (j + 1) % segs;
    faces.push([0, 2 + j, 2 + nj]);
  }

  // Body quads
  for (let i = 0; i < rings - 2; i++) {
    for (let j = 0; j < segs; j++) {
      const nj = (j + 1) % segs;
      const a = 2 + i * segs + j;
      const b = 2 + i * segs + nj;
      const c = 2 + (i + 1) * segs + nj;
      const d = 2 + (i + 1) * segs + j;
      faces.push([a, d, c]);
      faces.push([a, c, b]);
    }
  }

  // Bottom cap
  const lastRingStart = 2 + (rings - 2) * segs;
  for (let j = 0; j < segs; j++) {
    const nj = (j + 1) % segs;
    faces.push([1, lastRingStart + nj, lastRingStart + j]);
  }

  return { vertices, faces };
}

function generateCube(_res: number): Mesh {
  const vertices: Vec3[] = [
    [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
    [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1],
  ];

  // 6 faces, each split into 2 triangles
  const faces: [number, number, number][] = [
    // Front
    [4, 5, 6], [4, 6, 7],
    // Back
    [1, 0, 3], [1, 3, 2],
    // Top
    [7, 6, 2], [7, 2, 3],
    // Bottom
    [0, 1, 5], [0, 5, 4],
    // Right
    [5, 1, 2], [5, 2, 6],
    // Left
    [0, 4, 7], [0, 7, 3],
  ];

  return { vertices, faces };
}

function generateCylinder(res: number): Mesh {
  const vertices: Vec3[] = [];
  const faces: [number, number, number][] = [];
  const h = 1.2;

  // Top center and bottom center
  vertices.push([0, 0, h]);   // 0 = top center
  vertices.push([0, 0, -h]);  // 1 = bottom center

  // Top ring: indices 2..2+res-1
  for (let i = 0; i < res; i++) {
    const angle = (i / res) * Math.PI * 2;
    vertices.push([Math.cos(angle), Math.sin(angle), h]);
  }

  // Bottom ring: indices 2+res..2+2*res-1
  for (let i = 0; i < res; i++) {
    const angle = (i / res) * Math.PI * 2;
    vertices.push([Math.cos(angle), Math.sin(angle), -h]);
  }

  const topStart = 2;
  const botStart = 2 + res;

  // Top cap
  for (let i = 0; i < res; i++) {
    const ni = (i + 1) % res;
    faces.push([0, topStart + i, topStart + ni]);
  }

  // Bottom cap
  for (let i = 0; i < res; i++) {
    const ni = (i + 1) % res;
    faces.push([1, botStart + ni, botStart + i]);
  }

  // Side quads
  for (let i = 0; i < res; i++) {
    const ni = (i + 1) % res;
    const a = topStart + i;
    const b = topStart + ni;
    const c = botStart + ni;
    const d = botStart + i;
    faces.push([a, d, c]);
    faces.push([a, c, b]);
  }

  return { vertices, faces };
}

function generateKlein(res: number): Mesh {
  const vertices: Vec3[] = [];
  const faces: [number, number, number][] = [];
  const a = 2;

  for (let i = 0; i < res; i++) {
    const u = (i / res) * Math.PI * 2;
    const sinU = Math.sin(u);
    const sin2U = Math.sin(2 * u);
    for (let j = 0; j < res; j++) {
      const v = (j / res) * Math.PI * 2;
      const sinV = Math.sin(v);
      const cosV = Math.cos(v);
      const cosHalfV = Math.cos(v / 2);
      const sinHalfV = Math.sin(v / 2);
      const x = (a + cosHalfV * sinU - sinHalfV * sin2U) * cosV;
      const y = (a + cosHalfV * sinU - sinHalfV * sin2U) * sinV;
      const z = sinHalfV * sinU + cosHalfV * sin2U;
      vertices.push([x, y, z]);
    }
  }

  for (let i = 0; i < res; i++) {
    const ni = (i + 1) % res;
    for (let j = 0; j < res; j++) {
      const nj = (j + 1) % res;
      const ia = i * res + j;
      const ib = ni * res + j;
      const ic = ni * res + nj;
      const id = i * res + nj;
      faces.push([ia, ib, ic]);
      faces.push([ia, ic, id]);
    }
  }

  return { vertices, faces };
}

function generateMobius(res: number): Mesh {
  const vertices: Vec3[] = [];
  const faces: [number, number, number][] = [];
  const halfWidth = 0.4;
  const widthSteps = Math.max(4, Math.floor(res / 4));

  for (let i = 0; i < res; i++) {
    const u = (i / res) * Math.PI * 2;
    const cosU = Math.cos(u);
    const sinU = Math.sin(u);
    const cosHalfU = Math.cos(u / 2);
    const sinHalfU = Math.sin(u / 2);
    for (let j = 0; j <= widthSteps; j++) {
      const t = -halfWidth + (2 * halfWidth * j) / widthSteps;
      const x = (1 + t * cosHalfU) * cosU;
      const y = (1 + t * cosHalfU) * sinU;
      const z = t * sinHalfU;
      vertices.push([x, y, z]);
    }
  }

  const cols = widthSteps + 1;
  for (let i = 0; i < res; i++) {
    const ni = (i + 1) % res;
    for (let j = 0; j < widthSteps; j++) {
      const a = i * cols + j;
      const b = ni * cols + j;
      // Möbius has a twist: when wrapping, the strip flips.
      // At i = res-1, ni = 0, the opposite edge connects to the reversed side.
      let c: number, d: number;
      if (ni === 0) {
        // Twisted connection: vertex j on the next ring maps to (widthSteps - j)
        c = 0 * cols + (widthSteps - (j + 1));
        d = 0 * cols + (widthSteps - j);
        // We need to also remap b
        const bTwisted = 0 * cols + (widthSteps - j);
        const cTwisted = 0 * cols + (widthSteps - (j + 1));
        faces.push([a, bTwisted, cTwisted]);
        faces.push([a, cTwisted, a + 1]);
        continue;
      } else {
        c = ni * cols + j + 1;
        d = i * cols + j + 1;
      }
      faces.push([a, b, c]);
      faces.push([a, c, d]);
    }
  }

  return { vertices, faces };
}

const GENERATORS: Record<string, (res: number) => Mesh> = {
  torus: generateTorus,
  sphere: generateSphere,
  cube: generateCube,
  cylinder: generateCylinder,
  klein: generateKlein,
  mobius: generateMobius,
};

// ── Math Utilities ──

function rotateVertices(
  verts: Vec3[],
  rx: number,
  ry: number,
  rz: number,
): Vec3[] {
  const cx = Math.cos(rx), sx = Math.sin(rx);
  const cy = Math.cos(ry), sy = Math.sin(ry);
  const cz = Math.cos(rz), sz = Math.sin(rz);

  return verts.map(([x, y, z]) => {
    // Rx
    let y1 = y * cx - z * sx;
    let z1 = y * sx + z * cx;
    // Ry
    let x2 = x * cy + z1 * sy;
    let z2 = -x * sy + z1 * cy;
    // Rz
    let x3 = x2 * cz - y1 * sz;
    let y3 = x2 * sz + y1 * cz;
    return [x3, y3, z2] as Vec3;
  });
}

function projectVertex(
  v: Vec3,
  perspective: number,
): [number, number] {
  const fov = 3 + (1 - perspective) * 20;
  const scale = fov / (v[2] + fov);
  return [v[0] * scale, v[1] * scale];
}

// ── Edge Key Helpers ──

function edgeKey(a: number, b: number): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

// ── Composition ──

const meshLineart: Composition2DDefinition = {
  id: "meshLineart",
  name: "Mesh Lineart",
  description: "3D mesh wireframe rendering with hidden-line removal",
  tags: ["generative", "mesh", "wireframe", "3d", "technical"],
  category: "2d",
  type: "2d",
  renderMode: "debounced",

  controls: {
    shape: {
      type: "select",
      label: "Shape",
      default: "torus",
      options: [
        { label: "Torus", value: "torus" },
        { label: "Sphere", value: "sphere" },
        { label: "Cube", value: "cube" },
        { label: "Cylinder", value: "cylinder" },
        { label: "Klein Bottle", value: "klein" },
        { label: "Möbius Strip", value: "mobius" },
      ],
      group: "Mesh",
    },
    resolution: {
      type: "slider",
      label: "Resolution",
      default: 24,
      min: 6,
      max: 60,
      step: 2,
      group: "Mesh",
    },
    rotationX: {
      type: "slider",
      label: "Rotation X",
      default: 30,
      min: -180,
      max: 180,
      step: 1,
      group: "View",
    },
    rotationY: {
      type: "slider",
      label: "Rotation Y",
      default: 45,
      min: -180,
      max: 180,
      step: 1,
      group: "View",
    },
    rotationZ: {
      type: "slider",
      label: "Rotation Z",
      default: 0,
      min: -180,
      max: 180,
      step: 1,
      group: "View",
    },
    perspective: {
      type: "slider",
      label: "Perspective",
      default: 0.3,
      min: 0,
      max: 1,
      step: 0.05,
      group: "View",
    },
    scale: {
      type: "slider",
      label: "Scale",
      default: 1,
      min: 0.3,
      max: 3,
      step: 0.05,
      group: "View",
    },
    showHidden: {
      type: "toggle",
      label: "Show Hidden Lines",
      default: false,
      group: "Display",
    },
  },

  generate({ width, height, values }) {
    const shape = values.shape as string;
    const resolution = Math.round(values.resolution as number);
    const rotXDeg = values.rotationX as number;
    const rotYDeg = values.rotationY as number;
    const rotZDeg = values.rotationZ as number;
    const perspectiveAmount = values.perspective as number;
    const scaleMul = values.scale as number;
    const showHidden = values.showHidden as boolean;

    const deg2rad = Math.PI / 180;
    const rx = rotXDeg * deg2rad;
    const ry = rotYDeg * deg2rad;
    const rz = rotZDeg * deg2rad;

    // 1. Generate mesh
    const gen = GENERATORS[shape] ?? GENERATORS.torus;
    const mesh = gen(resolution);

    // 2. Transform vertices
    const rotated = rotateVertices(mesh.vertices, rx, ry, rz);

    // 3. Project to 2D
    const projected: [number, number][] = rotated.map((v) =>
      projectVertex(v, perspectiveAmount),
    );

    // 4. Back-face culling
    // For each face, compute the z-component of the cross product of two
    // projected edges. Positive = front-facing (CCW in screen space).
    const faceFront = new Uint8Array(mesh.faces.length);
    for (let fi = 0; fi < mesh.faces.length; fi++) {
      const [ia, ib, ic] = mesh.faces[fi];
      const ax = projected[ia][0], ay = projected[ia][1];
      const bx = projected[ib][0], by = projected[ib][1];
      const cx = projected[ic][0], cy = projected[ic][1];
      const e1x = bx - ax, e1y = by - ay;
      const e2x = cx - ax, e2y = cy - ay;
      const cross = e1x * e2y - e1y * e2x;
      faceFront[fi] = cross > 0 ? 1 : 0;
    }

    // 5. Build edge → face adjacency
    const edgeFaces = new Map<string, number[]>();
    for (let fi = 0; fi < mesh.faces.length; fi++) {
      const [ia, ib, ic] = mesh.faces[fi];
      const edges = [
        edgeKey(ia, ib),
        edgeKey(ib, ic),
        edgeKey(ic, ia),
      ];
      for (const ek of edges) {
        let arr = edgeFaces.get(ek);
        if (!arr) {
          arr = [];
          edgeFaces.set(ek, arr);
        }
        arr.push(fi);
      }
    }

    // 6. Determine edge visibility
    const visibleEdges: [number, number][] = [];
    const hiddenEdges: [number, number][] = [];

    for (const [ek, faceIndices] of edgeFaces) {
      const parts = ek.split(":");
      const a = parseInt(parts[0], 10);
      const b = parseInt(parts[1], 10);

      let anyFront = false;
      for (const fi of faceIndices) {
        if (faceFront[fi]) {
          anyFront = true;
          break;
        }
      }

      if (anyFront) {
        visibleEdges.push([a, b]);
      } else {
        hiddenEdges.push([a, b]);
      }
    }

    // 7. Auto-fit: compute bounding box of projected points and scale to canvas
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [px, py] of projected) {
      if (px < minX) minX = px;
      if (px > maxX) maxX = px;
      if (py < minY) minY = py;
      if (py > maxY) maxY = py;
    }

    const margin = 40;
    const availW = width - margin * 2;
    const availH = height - margin * 2;
    const bboxW = maxX - minX || 1;
    const bboxH = maxY - minY || 1;
    const autoScale = Math.min(availW / bboxW, availH / bboxH) * scaleMul;
    const bboxCx = (minX + maxX) / 2;
    const bboxCy = (minY + maxY) / 2;
    const canvasCx = width / 2;
    const canvasCy = height / 2;

    function toCanvas(p: [number, number]): { x: number; y: number } {
      return {
        x: canvasCx + (p[0] - bboxCx) * autoScale,
        y: canvasCy + (p[1] - bboxCy) * autoScale,
      };
    }

    // 8. Build polylines
    const polylines: { x: number; y: number }[][] = [];

    for (const [a, b] of visibleEdges) {
      polylines.push([toCanvas(projected[a]), toCanvas(projected[b])]);
    }

    if (showHidden) {
      for (const [a, b] of hiddenEdges) {
        polylines.push([toCanvas(projected[a]), toCanvas(projected[b])]);
      }
    }

    return polylines;
  },
};

export default meshLineart;
