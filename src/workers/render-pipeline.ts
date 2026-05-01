/**
 * Pure render pipeline function extracted from App.tsx useMemo.
 *
 * Receives a RenderRequest, runs the full hatch → project → occlude → SVG pipeline,
 * and returns a RenderResult. Importable directly for testing (no worker needed).
 */

import * as THREE from "three";
import { SURFACES } from "../surfaces";
import { generateUVHatchLines, type HatchParams } from "../hatch";
import {
  projectPolylines,
  polylinesToSVGPaths,
  buildSurfaceMesh,
} from "../projection";
import { renderDepthBufferOffscreen, clipPolylineByDepth } from "../occlusion";
import { filterByProjectedDensity } from "../density";
import { compositionRegistry } from "../compositions/registry";
import {
  type Composition3DDefinition,
  type LayerConfig,
  type LayeredCompositionDefinition,
  is2DComposition,
  isLayeredComposition,
} from "../compositions/types";
import { resolveLayerInnerValues } from "../compositions/helpers";
import {
  isWasmReady,
  generateLayersWasm,
  isLayerWasmCompatible,
} from "../wasm-pipeline";
import { parseDString, clipPolylineToRect, type Rect } from "../utils/clip";
import type {
  RenderRequest,
  RenderResult,
  CameraParams,
  LayerGroupResult,
} from "./render-worker.types";

/**
 * Reconstruct a Three.js camera from serialized params.
 */
function buildCamera(cam: CameraParams): THREE.Camera {
  const pos = new THREE.Vector3(
    cam.dist * Math.sin(cam.theta) * Math.cos(cam.phi),
    cam.dist * Math.sin(cam.phi),
    cam.dist * Math.cos(cam.theta) * Math.cos(cam.phi)
  );

  let camera: THREE.Camera;
  if (cam.ortho) {
    const aspect = cam.width / cam.height;
    const halfH = cam.dist * 0.35;
    const halfW = halfH * aspect;
    const oc = new THREE.OrthographicCamera(-halfW, halfW, halfH, -halfH, 0.1, 100);
    oc.position.copy(pos);
    camera = oc;
  } else {
    const pc = new THREE.PerspectiveCamera(45, cam.width / cam.height, 0.1, 100);
    pc.position.copy(pos);
    camera = pc;
  }
  camera.lookAt(cam.panX, cam.panY, 0);
  camera.updateMatrixWorld();
  (camera as THREE.PerspectiveCamera | THREE.OrthographicCamera).updateProjectionMatrix();
  return camera;
}

/**
 * Bounding box over a list of polylines. Returns null when empty.
 */
function polylinesBBox(
  polylines: { x: number; y: number }[][],
): Rect | null {
  let xMin = Infinity;
  let yMin = Infinity;
  let xMax = -Infinity;
  let yMax = -Infinity;
  let any = false;
  for (const pl of polylines) {
    for (const p of pl) {
      if (p.x < xMin) xMin = p.x;
      if (p.y < yMin) yMin = p.y;
      if (p.x > xMax) xMax = p.x;
      if (p.y > yMax) yMax = p.y;
      any = true;
    }
  }
  return any ? { xMin, yMin, xMax, yMax } : null;
}

/**
 * Layered pipeline: render each inner composition independently,
 * then composite their SVG paths into per-layer groups.
 *
 * Blend modes:
 *   - "over"   — additive stacking (paths emitted as-is)
 *   - "masked" — paths clipped to the bounding box of the `maskBy` layer
 *
 * Cross-layer occlusion is intentionally out of scope for v1.
 */
function runLayeredPipeline(
  req: RenderRequest,
  comp: LayeredCompositionDefinition,
): RenderResult {
  const t0 = performance.now();

  // Honor user-edited override (visibility, order, colors, etc) when present.
  // `visible: false` layers are filtered before rendering.
  const layers = (req.layeredLayersOverride ?? comp.layers).filter(
    (l) => l.visible !== false,
  );

  const layerPolylines: { x: number; y: number }[][][] = [];

  // Pass 1: render each inner composition into raw polylines.
  for (const layer of layers) {
    const inner = compositionRegistry.get(layer.composition);
    if (!inner || isLayeredComposition(inner)) {
      // Unknown id, or nested layered (not supported in v1).
      layerPolylines.push([]);
      continue;
    }

    const innerReq: RenderRequest = {
      ...req,
      compositionKey: layer.composition,
      is2d: is2DComposition(inner),
      resolvedValues: resolveLayerInnerValues(inner, layer),
      currentHatchGroups: layer.hatchGroupOverrides ?? {},
      densityFilterEnabled: false,
      showMesh: false,
    };

    const innerResult = runPipeline(innerReq);
    const polys = innerResult.svgPaths
      .map(parseDString)
      .filter((p) => p.length >= 2);
    layerPolylines.push(polys);
  }

  // Pass 2: apply blend modes and emit per-layer SVG paths.
  const layerGroups: LayerGroupResult[] = [];
  let totalLines = 0;
  let totalVerts = 0;

  for (let i = 0; i < layers.length; i++) {
    const layer = layers[i];
    let polys = layerPolylines[i];

    if (layer.blendMode === "masked") {
      const maskIdx = layer.maskBy ?? Math.max(0, i - 1);
      if (maskIdx !== i && layerPolylines[maskIdx]?.length) {
        const bbox = polylinesBBox(layerPolylines[maskIdx]);
        if (bbox) {
          const clipped: { x: number; y: number }[][] = [];
          for (const pl of polys) clipped.push(...clipPolylineToRect(pl, bbox));
          polys = clipped;
        }
      }
    }

    const paths = polylinesToSVGPaths(polys);
    totalLines += polys.length;
    totalVerts += polys.reduce((s, p) => s + p.length, 0);
    layerGroups.push({
      id: layer.composition,
      name: layer.name,
      color: layer.color,
      svgPaths: paths,
    });
  }

  const allPaths = layerGroups.flatMap((g) => g.svgPaths);

  return {
    type: "render-result",
    id: req.id,
    svgPaths: allPaths,
    meshPaths: [],
    layerGroups,
    stats: { lines: totalLines, verts: totalVerts, paths: allPaths.length },
    durationMs: performance.now() - t0,
  };
}

export function runPipeline(req: RenderRequest): RenderResult {
  const t0 = performance.now();
  const comp = compositionRegistry.get(req.compositionKey)!;
  const wasmReady = isWasmReady();

  // ── Layered pipeline (multi-composition umbrella) ──
  if (isLayeredComposition(comp)) {
    return runLayeredPipeline(req, comp);
  }

  // ── 2D pipeline ──
  if (req.is2d && is2DComposition(comp)) {
    const input2D = { width: req.width, height: req.height, values: req.resolvedValues };
    let polylines2D =
      (comp.wasmGenerate && wasmReady ? comp.wasmGenerate(input2D) : null) ??
      comp.generate(input2D);

    if (req.densityFilterEnabled) {
      polylines2D = filterByProjectedDensity(polylines2D, {
        maxDensity: req.densityMax,
        cellSize: req.densityCellSize,
        width: req.width,
        height: req.height,
      });
    }
    const paths = polylinesToSVGPaths(polylines2D);
    return {
      type: "render-result",
      id: req.id,
      svgPaths: paths,
      meshPaths: [],
      stats: {
        lines: polylines2D.length,
        verts: polylines2D.reduce((s, p) => s + p.length, 0),
        paths: paths.length,
      },
      durationMs: performance.now() - t0,
    };
  }

  // ── 3D pipeline ──
  const threeCamera = buildCamera(req.camera);

  const hatchParams: HatchParams = {
    family: req.hatchParams.family as HatchParams["family"],
    count: req.hatchParams.count,
    samples: req.hatchParams.samples,
    angle: req.hatchParams.angle,
  };

  let layers: LayerConfig[];
  let unifiedDepthMesh: THREE.BufferGeometry | null = null;
  if (req.compositionKey !== "single") {
    const comp3d = comp as Composition3DDefinition;
    const compInput = {
      surface: req.surfaceKey,
      surfaceParams: req.surfaceParams,
      hatchParams,
      values: req.resolvedValues,
    };
    layers = comp3d.layers(compInput);
    if (comp3d.buildDepthMesh) {
      unifiedDepthMesh = comp3d.buildDepthMesh(compInput);
    }
  } else {
    layers = [
      {
        surface: req.surfaceKey,
        params: req.surfaceParams,
        hatch: hatchParams,
      },
    ];
  }

  // Apply per-group hatch overrides
  for (const layer of layers) {
    if (layer.group) {
      const groupConfig = req.currentHatchGroups[layer.group];
      if (groupConfig && groupConfig.family !== "inherit") {
        layer.hatch = {
          family: groupConfig.family as HatchParams["family"],
          count: groupConfig.count,
          samples: groupConfig.samples,
          angle: groupConfig.angle,
        };
      }
    }
  }

  const allMeshPaths: string[] = [];
  let allPolylines2D: { x: number; y: number }[][] = [];
  const meshGeometries: THREE.BufferGeometry[] = [];

  // ── WASM fast path ──
  const allLayersWasmCompatible = wasmReady && layers.every(isLayerWasmCompatible);
  const surfaceDefaults: Record<string, Record<string, number>> = {};
  if (allLayersWasmCompatible) {
    for (const layer of layers) {
      if (!surfaceDefaults[layer.surface]) {
        surfaceDefaults[layer.surface] = SURFACES[layer.surface].defaults;
      }
    }
  }

  const wasmPolylines3D = allLayersWasmCompatible
    ? generateLayersWasm(layers, req.surfaceParams, surfaceDefaults)
    : null;

  // Build mesh geometries + project hatch lines
  for (let li = 0; li < layers.length; li++) {
    const layer = layers[li];
    const sf = SURFACES[layer.surface];
    const lParams = layer.params || req.surfaceParams;
    const fn = sf.fn;

    const [uSegs, vSegs] = sf.meshSegs ?? [24, 24];
    const meshGeo = buildSurfaceMesh(fn, lParams, uSegs, vSegs);
    if (layer.transform) {
      meshGeo.translate(
        layer.transform.x || 0,
        layer.transform.y || 0,
        layer.transform.z || 0
      );
    }
    meshGeometries.push(meshGeo);

    const polylines3D = wasmPolylines3D
      ? wasmPolylines3D[li]
      : generateUVHatchLines(
          (u, v, p) => {
            const pt = fn(u, v, p);
            if (layer.transform) {
              pt.x += layer.transform.x || 0;
              pt.y += layer.transform.y || 0;
              pt.z += layer.transform.z || 0;
            }
            return pt;
          },
          lParams,
          layer.hatch
        );

    const projected = projectPolylines(polylines3D, threeCamera, req.width, req.height);
    allPolylines2D.push(...projected);

    if (req.showMesh) {
      const pos = meshGeo.getAttribute("position");
      const idx = meshGeo.getIndex();
      if (idx) {
        for (let i = 0; i < idx.count; i += 3) {
          const tri = [0, 1, 2].map((j) => {
            const vi = idx.getX(i + j);
            const v3 = new THREE.Vector3(
              pos.getX(vi),
              pos.getY(vi),
              pos.getZ(vi)
            );
            const p = v3.project(threeCamera);
            return {
              x: (p.x * 0.5 + 0.5) * req.width,
              y: (-p.y * 0.5 + 0.5) * req.height,
            };
          });
          allMeshPaths.push(
            `M${tri[0].x.toFixed(1)},${tri[0].y.toFixed(1)}L${tri[1].x.toFixed(1)},${tri[1].y.toFixed(1)}L${tri[2].x.toFixed(1)},${tri[2].y.toFixed(1)}Z`
          );
        }
      }
    }
  }

  // ── Occlusion ──
  // Prefer the composition's unified depth mesh (if provided) over the
  // per-layer meshes. Eliminates inter-face cracks that leak back hatches
  // through HLR on many-layer compositions like sentinelTerrain3D.
  const depthMeshes: THREE.BufferGeometry[] = unifiedDepthMesh
    ? [unifiedDepthMesh]
    : meshGeometries;
  if (req.useOcclusion && depthMeshes.length > 0) {
    try {
      const { contentW, contentH, scale: fitScale } = req.exportLayout;
      const extRatioW = Math.max(1, contentW / (fitScale * req.width));
      const extRatioH = Math.max(1, contentH / (fitScale * req.height));
      const depthW = Math.ceil(req.depthRes * extRatioW);
      const depthH = Math.ceil(req.depthRes * extRatioH);

      // Build extended camera
      let extCamera: THREE.Camera;
      const cpos = threeCamera.position.clone();
      if (req.camera.ortho) {
        const oc = threeCamera as THREE.OrthographicCamera;
        const extOc = new THREE.OrthographicCamera(
          oc.left * extRatioW,
          oc.right * extRatioW,
          oc.top * extRatioH,
          oc.bottom * extRatioH,
          oc.near,
          oc.far
        );
        extOc.position.copy(cpos);
        extCamera = extOc;
      } else {
        const pc = threeCamera as THREE.PerspectiveCamera;
        const origHalfVFOV = ((pc.fov / 2) * Math.PI) / 180;
        const extVFOV =
          ((2 * Math.atan(Math.tan(origHalfVFOV) * extRatioH)) * 180) / Math.PI;
        const extAspect = (req.width * extRatioW) / (req.height * extRatioH);
        const extPc = new THREE.PerspectiveCamera(extVFOV, extAspect, pc.near, pc.far);
        extPc.position.copy(cpos);
        extCamera = extPc;
      }
      extCamera.lookAt(req.camera.panX, req.camera.panY, 0);
      extCamera.updateMatrixWorld();
      (extCamera as THREE.PerspectiveCamera | THREE.OrthographicCamera).updateProjectionMatrix();

      const depthBuffer = renderDepthBufferOffscreen(
        depthMeshes,
        extCamera,
        depthW,
        depthH
      );

      const offsetX = (depthW - req.depthRes) / 2;
      const offsetY = (depthH - req.depthRes) / 2;

      const occludedPolylines: { x: number; y: number }[][] = [];
      for (let li = 0; li < layers.length; li++) {
        const layer = layers[li];
        const sf = SURFACES[layer.surface];
        const lParams = layer.params || req.surfaceParams;

        const polylines3D = wasmPolylines3D
          ? wasmPolylines3D[li]
          : generateUVHatchLines(
              (u, v, p) => {
                const pt = sf.fn(u, v, p);
                if (layer.transform) {
                  pt.x += layer.transform.x || 0;
                  pt.y += layer.transform.y || 0;
                  pt.z += layer.transform.z || 0;
                }
                return pt;
              },
              lParams,
              layer.hatch
            );

        const projected = projectPolylines(polylines3D, extCamera, depthW, depthH);

        for (const pl of projected) {
          const visibleSegments = clipPolylineByDepth(pl, depthBuffer, req.depthBias);
          for (const seg of visibleSegments) {
            const scaled = seg.map((p) => ({
              x: (p.x - offsetX) * (req.width / req.depthRes),
              y: (p.y - offsetY) * (req.height / req.depthRes),
            }));
            occludedPolylines.push(scaled);
          }
        }
      }
      allPolylines2D = occludedPolylines;
    } catch (e) {
      console.warn("Depth buffer occlusion failed:", (e as Error).message);
    }
  }

  // ── Density filter ──
  if (req.densityFilterEnabled) {
    allPolylines2D = filterByProjectedDensity(allPolylines2D, {
      maxDensity: req.densityMax,
      cellSize: req.densityCellSize,
      width: req.width,
      height: req.height,
    });
  }

  meshGeometries.forEach((g) => g.dispose());

  const totalLines = allPolylines2D.length;
  const totalVerts = allPolylines2D.reduce((s, p) => s + p.length, 0);
  const allPaths = polylinesToSVGPaths(allPolylines2D);

  return {
    type: "render-result",
    id: req.id,
    svgPaths: allPaths,
    meshPaths: allMeshPaths,
    stats: { lines: totalLines, verts: totalVerts, paths: allPaths.length },
    durationMs: performance.now() - t0,
  };
}
