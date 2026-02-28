import { useState, useRef, useCallback, useMemo, useEffect } from "react";
import * as THREE from "three";
import { SURFACES } from "./surfaces";
import { generateUVHatchLines, type HatchParams } from "./hatch";
import { projectPolylines, polylinesToSVGPaths, buildSurfaceMesh } from "./projection";
import { renderDepthBuffer, clipPolylineByDepth } from "./occlusion";
import { COMPOSITIONS, type LayerConfig } from "./compositions";

const PAGE_SIZES: Record<string, { label: string; w: number; h: number }> = {
  a3: { label: "A3", w: 420, h: 297 },
  a4: { label: "A4", w: 297, h: 210 },
  a5: { label: "A5", w: 210, h: 148 },
  letter: { label: '8.5\u00d711"', w: 279.4, h: 215.9 },
};

const BORDER_STYLES: Record<string, string> = {
  simple: "Simple",
  double: "Double",
  ticked: "Ticked",
  cropmarks: "Crop marks",
};

const STORAGE_KEY = "hatch3d-state";

const DEFAULTS = {
  surfaceKey: "hyperboloid",
  compositionKey: "single",
  paramA: 0.5,
  paramB: 0.5,
  paramC: 0.5,
  paramD: 0.5,
  hatchFamily: "u" as "u" | "v" | "diagonal",
  hatchCount: 30,
  hatchSamples: 50,
  hatchAngle: 0.7,
  useOcclusion: false,
  depthRes: 512,
  depthBias: 0.01,
  camTheta: 0.6,
  camPhi: 0.35,
  camDist: 8,
  camOrtho: false,
  panX: 0,
  panY: 0,
  strokeWidth: 0.5,
  showMesh: false,
  pageSize: "a3",
  orientation: "landscape" as "landscape" | "portrait",
  margin: 15,
  borderEnabled: false,
  borderStyle: "simple" as "simple" | "double" | "ticked" | "cropmarks",
};

/** Load saved state, keeping only keys that exist in DEFAULTS with matching type. */
function loadState(): typeof DEFAULTS {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const saved = JSON.parse(raw);
    if (typeof saved !== "object" || saved === null) throw 0;
    const out = { ...DEFAULTS };
    for (const k of Object.keys(DEFAULTS) as (keyof typeof DEFAULTS)[]) {
      if (k in saved && typeof saved[k] === typeof DEFAULTS[k]) {
        (out as Record<string, unknown>)[k] = saved[k];
      }
    }
    return out;
  } catch {
    localStorage.removeItem(STORAGE_KEY);
    return DEFAULTS;
  }
}

const INITIAL = loadState();

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [width] = useState(800);
  const [height] = useState(800);

  // Shape
  const [surfaceKey, setSurfaceKey] = useState(INITIAL.surfaceKey);
  const [compositionKey, setCompositionKey] = useState(INITIAL.compositionKey);

  // Surface params (generic sliders mapped to surface)
  const [paramA, setParamA] = useState(INITIAL.paramA);
  const [paramB, setParamB] = useState(INITIAL.paramB);
  const [paramC, setParamC] = useState(INITIAL.paramC);
  const [paramD, setParamD] = useState(INITIAL.paramD);

  // Hatch
  const [hatchFamily, setHatchFamily] = useState(INITIAL.hatchFamily);
  const [hatchCount, setHatchCount] = useState(INITIAL.hatchCount);
  const [hatchSamples, setHatchSamples] = useState(INITIAL.hatchSamples);
  const [hatchAngle, setHatchAngle] = useState(INITIAL.hatchAngle);

  // Occlusion
  const [useOcclusion, setUseOcclusion] = useState(INITIAL.useOcclusion);
  const [depthRes, setDepthRes] = useState(INITIAL.depthRes);
  const [depthBias, setDepthBias] = useState(INITIAL.depthBias);

  // Camera
  const [camTheta, setCamTheta] = useState(INITIAL.camTheta);
  const [camPhi, setCamPhi] = useState(INITIAL.camPhi);
  const [camDist, setCamDist] = useState(INITIAL.camDist);
  const [camOrtho, setCamOrtho] = useState(INITIAL.camOrtho);
  const [panX, setPanX] = useState(INITIAL.panX);
  const [panY, setPanY] = useState(INITIAL.panY);

  // Display
  const [strokeWidth, setStrokeWidth] = useState(INITIAL.strokeWidth);
  const [showMesh, setShowMesh] = useState(INITIAL.showMesh);

  // Export settings
  const [pageSize, setPageSize] = useState(INITIAL.pageSize);
  const [orientation, setOrientation] = useState(INITIAL.orientation);
  const [margin, setMargin] = useState(INITIAL.margin);
  const [borderEnabled, setBorderEnabled] = useState(INITIAL.borderEnabled);
  const [borderStyle, setBorderStyle] = useState(INITIAL.borderStyle);

  // Persist all controls to localStorage on change
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      surfaceKey, compositionKey,
      paramA, paramB, paramC, paramD,
      hatchFamily, hatchCount, hatchSamples, hatchAngle,
      useOcclusion, depthRes, depthBias,
      camTheta, camPhi, camDist, camOrtho, panX, panY,
      strokeWidth, showMesh,
      pageSize, orientation, margin, borderEnabled, borderStyle,
    }));
  }, [
    surfaceKey, compositionKey,
    paramA, paramB, paramC, paramD,
    hatchFamily, hatchCount, hatchSamples, hatchAngle,
    useOcclusion, depthRes, depthBias,
    camTheta, camPhi, camDist, panX, panY,
    strokeWidth, showMesh,
    pageSize, orientation, margin, borderEnabled, borderStyle,
  ]);

  // Preview pan/zoom (ephemeral, not persisted)
  const [viewZoom, setViewZoom] = useState(1);
  const [viewPanX, setViewPanX] = useState(0);
  const [viewPanY, setViewPanY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const viewDragRef = useRef({ x: 0, y: 0, panX: 0, panY: 0 });

  // Build Three.js camera
  const threeCamera = useMemo(() => {
    const pos = new THREE.Vector3(
      camDist * Math.sin(camTheta) * Math.cos(camPhi),
      camDist * Math.sin(camPhi),
      camDist * Math.cos(camTheta) * Math.cos(camPhi)
    );
    let cam: THREE.Camera;
    if (camOrtho) {
      const aspect = width / height;
      const halfH = camDist * 0.35;
      const halfW = halfH * aspect;
      const oc = new THREE.OrthographicCamera(-halfW, halfW, halfH, -halfH, 0.1, 100);
      oc.position.copy(pos);
      cam = oc;
    } else {
      const pc = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
      pc.position.copy(pos);
      cam = pc;
    }
    cam.lookAt(panX, panY, 0);
    cam.updateMatrixWorld();
    (cam as THREE.PerspectiveCamera | THREE.OrthographicCamera).updateProjectionMatrix();
    return cam;
  }, [camTheta, camPhi, camDist, camOrtho, panX, panY, width, height]);

  // Export layout geometry (shared by preview and export)
  const exportLayout = useMemo(() => {
    const page = PAGE_SIZES[pageSize];
    const pageW = orientation === "portrait" ? page.h : page.w;
    const pageH = orientation === "portrait" ? page.w : page.h;
    const contentW = pageW - margin * 2;
    const contentH = pageH - margin * 2;
    const scale = Math.min(contentW / width, contentH / height);
    const cx = margin + (contentW - width * scale) / 2;
    const cy = margin + (contentH - height * scale) / 2;
    return { pageW, pageH, contentW, contentH, scale, cx, cy };
  }, [pageSize, orientation, margin, width, height]);

  // Live border preview paths
  const previewBorderPaths = useMemo(() => {
    if (!borderEnabled) return [];
    return generateBorderPaths(borderStyle, exportLayout.pageW, exportLayout.pageH, margin, strokeWidth);
  }, [borderEnabled, borderStyle, exportLayout, margin, strokeWidth]);

  // Map generic sliders to surface-specific params
  const surfaceParams = useMemo(() => {
    const s = SURFACES[surfaceKey];
    const d = s.defaults;
    const keys = Object.keys(d);
    const sliders = [paramA, paramB, paramC, paramD];
    const result = { ...d };
    keys.forEach((k, i) => {
      if (i < 4) {
        const base = d[k];
        result[k] = base * (0.2 + sliders[i] * 1.6);
      }
    });
    return result;
  }, [surfaceKey, paramA, paramB, paramC, paramD]);

  // Generate everything
  const { svgPaths, meshPaths, stats } = useMemo(() => {
    let layers: LayerConfig[];

    const hatchParams: HatchParams = {
      family: hatchFamily,
      count: hatchCount,
      samples: hatchSamples,
      angle: hatchAngle,
    };

    if (compositionKey !== "single") {
      layers = COMPOSITIONS[compositionKey].layers({
        surface: surfaceKey,
        surfaceParams,
        hatchParams,
      });
    } else {
      layers = [
        {
          surface: surfaceKey,
          params: surfaceParams,
          hatch: hatchParams,
        },
      ];
    }

    let allPaths: string[] = [];
    const allMeshPaths: string[] = [];
    let totalLines = 0;
    let totalVerts = 0;

    const meshGeometries: THREE.BufferGeometry[] = [];

    for (const layer of layers) {
      const sf = SURFACES[layer.surface];
      const lParams = layer.params || surfaceParams;
      const fn = sf.fn;

      const meshGeo = buildSurfaceMesh(fn, lParams, 24, 24);
      if (layer.transform) {
        meshGeo.translate(
          layer.transform.x || 0,
          layer.transform.y || 0,
          layer.transform.z || 0
        );
      }
      meshGeometries.push(meshGeo);

      const polylines3D = generateUVHatchLines(
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

      const projected = projectPolylines(polylines3D, threeCamera, width, height);

      for (const pl of projected) {
        const paths = polylinesToSVGPaths([pl]);
        allPaths.push(...paths);
        totalLines++;
        totalVerts += pl.length;
      }

      if (showMesh) {
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
                x: (p.x * 0.5 + 0.5) * width,
                y: (-p.y * 0.5 + 0.5) * height,
              };
            });
            allMeshPaths.push(
              `M${tri[0].x.toFixed(1)},${tri[0].y.toFixed(1)}L${tri[1].x.toFixed(1)},${tri[1].y.toFixed(1)}L${tri[2].x.toFixed(1)},${tri[2].y.toFixed(1)}Z`
            );
          }
        }
      }
    }

    if (useOcclusion && meshGeometries.length > 0) {
      try {
        const depthBuffer = renderDepthBuffer(
          meshGeometries,
          threeCamera,
          depthRes,
          depthRes
        );
        const occludedPaths: string[] = [];
        for (const layer of layers) {
          const sf = SURFACES[layer.surface];
          const lParams = layer.params || surfaceParams;
          const polylines3D = generateUVHatchLines(
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

          const projected = projectPolylines(
            polylines3D,
            threeCamera,
            depthRes,
            depthRes
          );

          for (const pl of projected) {
            const visibleSegments = clipPolylineByDepth(pl, depthBuffer, depthBias);
            for (const seg of visibleSegments) {
              const scaled = seg.map((p) => ({
                x: p.x * (width / depthRes),
                y: p.y * (height / depthRes),
              }));
              const paths = polylinesToSVGPaths([scaled]);
              occludedPaths.push(...paths);
            }
          }
        }
        allPaths = occludedPaths;
      } catch (e) {
        console.warn("Depth buffer occlusion failed:", (e as Error).message);
      }
    }

    meshGeometries.forEach((g) => g.dispose());

    return {
      svgPaths: allPaths,
      meshPaths: allMeshPaths,
      stats: { lines: totalLines, verts: totalVerts, paths: allPaths.length },
    };
  }, [
    surfaceKey,
    surfaceParams,
    compositionKey,
    hatchFamily,
    hatchCount,
    hatchSamples,
    hatchAngle,
    threeCamera,
    width,
    height,
    useOcclusion,
    depthRes,
    depthBias,
    showMesh,
  ]);

  // Preview viewport controls (pan/zoom the SVG view, not the 3D scene)
  const handleViewMouseDown = useCallback(
    (e: React.MouseEvent) => {
      setIsDragging(true);
      viewDragRef.current = { x: e.clientX, y: e.clientY, panX: viewPanX, panY: viewPanY };
    },
    [viewPanX, viewPanY]
  );

  const handleViewMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!isDragging) return;
      const s = viewDragRef.current;
      setViewPanX(s.panX + (e.clientX - s.x));
      setViewPanY(s.panY + (e.clientY - s.y));
    },
    [isDragging]
  );

  const handleViewMouseUp = useCallback(() => setIsDragging(false), []);

  // Pinch-to-zoom via touch events
  const pinchRef = useRef<{ dist: number; zoom: number } | null>(null);
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      pinchRef.current = { dist: Math.hypot(dx, dy), zoom: viewZoom };
    }
  }, [viewZoom]);
  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2 && pinchRef.current) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.hypot(dx, dy);
      const scale = dist / pinchRef.current.dist;
      setViewZoom(Math.max(0.25, Math.min(10, pinchRef.current.zoom * scale)));
    }
  }, []);
  const handleTouchEnd = useCallback(() => { pinchRef.current = null; }, []);

  const handleViewDoubleClick = useCallback(() => {
    setViewZoom(1);
    setViewPanX(0);
    setViewPanY(0);
  }, []);

  // Export
  const exportSVG = useCallback(() => {
    const { pageW, pageH, contentW, contentH, scale, cx, cy } = exportLayout;

    const content = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${pageW}mm" height="${pageH}mm" viewBox="0 0 ${pageW} ${pageH}">
  <defs>
    <clipPath id="margin-clip">
      <rect x="${margin}" y="${margin}" width="${contentW}" height="${contentH}"/>
    </clipPath>
  </defs>
  <g clip-path="url(#margin-clip)">
    <g transform="translate(${cx},${cy}) scale(${scale})" fill="none" stroke="black" stroke-width="${strokeWidth / scale}" stroke-linecap="round" stroke-linejoin="round">
      ${svgPaths.map((d) => `<path d="${d}"/>`).join("\n      ")}
    </g>
  </g>${previewBorderPaths.length > 0 ? `\n  <g fill="none" stroke="black" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round">\n    ${previewBorderPaths.map((d) => `<path d="${d}"/>`).join("\n    ")}\n  </g>` : ""}
</svg>`;
    const blob = new Blob([content], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `hatch3d_${compositionKey}_${surfaceKey}.svg`;
    a.click();
    URL.revokeObjectURL(url);
  }, [svgPaths, exportLayout, margin, strokeWidth, previewBorderPaths, compositionKey, surfaceKey]);

  const surfaceInfo = SURFACES[surfaceKey];
  const paramKeys = Object.keys(surfaceInfo.defaults);

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "var(--bg)",
        fontFamily: "'IBM Plex Mono', 'SF Mono', monospace",
        color: "var(--fg)",
        display: "flex",
        flexDirection: "column",
        userSelect: "none",
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "14px 22px",
          borderBottom: "1px solid var(--border)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          background: "var(--bg-panel)",
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
          <span style={{ fontSize: 14, fontWeight: 700, letterSpacing: "0.06em" }}>
            HATCH3D
          </span>
          <span style={{ fontSize: 10, color: "var(--fg-hint)", letterSpacing: "0.08em" }}>
            UV-SPACE PARAMETRIC HATCHING → SVG
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10 }}>
            <button
              onClick={() => { setViewZoom(1); setViewPanX(0); setViewPanY(0); }}
              style={{ ...tagStyle, fontSize: 9, padding: "2px 6px" }}
            >
              Fit
            </button>
            <button
              onClick={() => setViewZoom((z) => Math.min(10, z * 1.5))}
              style={{ ...tagStyle, fontSize: 9, padding: "2px 6px", width: 22, textAlign: "center" }}
            >
              +
            </button>
            <span style={{ color: "var(--fg-dim)", width: 36, textAlign: "center" }}>
              {Math.round(viewZoom * 100)}%
            </span>
            <button
              onClick={() => setViewZoom((z) => Math.max(0.25, z / 1.5))}
              style={{ ...tagStyle, fontSize: 9, padding: "2px 6px", width: 22, textAlign: "center" }}
            >
              &minus;
            </button>
          </div>
          <button onClick={exportSVG} style={{ ...btnStyle, background: "var(--fg)", color: "var(--bg-canvas)" }}>
            EXPORT SVG
          </button>
        </div>
      </div>

      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        {/* Controls panel */}
        <div
          style={{
            width: 280,
            padding: "14px 18px",
            overflowY: "auto",
            borderRight: "1px solid var(--border)",
            fontSize: 11,
            display: "flex",
            flexDirection: "column",
            gap: 18,
          }}
        >
          <Section title="COMPOSITION">
            <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
              {Object.entries(COMPOSITIONS).map(([key, val]) => (
                <button
                  key={key}
                  onClick={() => setCompositionKey(key)}
                  style={{
                    ...tagStyle,
                    background: compositionKey === key ? "var(--fg)" : "transparent",
                    color: compositionKey === key ? "var(--bg-canvas)" : "var(--fg)",
                  }}
                >
                  {val.name}
                </button>
              ))}
            </div>
          </Section>

          {compositionKey === "single" && (
            <Section title="SURFACE">
              <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
                {Object.entries(SURFACES).map(([key, val]) => (
                  <button
                    key={key}
                    onClick={() => setSurfaceKey(key)}
                    style={{
                      ...tagStyle,
                      background: surfaceKey === key ? "var(--fg)" : "transparent",
                      color: surfaceKey === key ? "var(--bg-canvas)" : "var(--fg)",
                    }}
                  >
                    {val.name}
                  </button>
                ))}
              </div>
              <Slider label={paramKeys[0] || "A"} value={paramA} onChange={setParamA} min={0} max={1} step={0.01} />
              <Slider label={paramKeys[1] || "B"} value={paramB} onChange={setParamB} min={0} max={1} step={0.01} />
              {paramKeys.length > 2 && (
                <Slider label={paramKeys[2] || "C"} value={paramC} onChange={setParamC} min={0} max={1} step={0.01} />
              )}
              {paramKeys.length > 3 && (
                <Slider label={paramKeys[3] || "D"} value={paramD} onChange={setParamD} min={0} max={1} step={0.01} />
              )}
            </Section>
          )}

          <Section title="HATCHING">
            <div style={{ display: "flex", gap: 3 }}>
              {(["u", "v", "diagonal"] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setHatchFamily(f)}
                  style={{
                    ...tagStyle,
                    background: hatchFamily === f ? "var(--fg)" : "transparent",
                    color: hatchFamily === f ? "var(--bg-canvas)" : "var(--fg)",
                  }}
                >
                  {f === "u" ? "U-const" : f === "v" ? "V-const" : "Diagonal"}
                </button>
              ))}
            </div>
            <Slider label="Count" value={hatchCount} onChange={setHatchCount} min={5} max={80} step={1} />
            <Slider label="Samples" value={hatchSamples} onChange={setHatchSamples} min={10} max={120} step={1} />
            {hatchFamily === "diagonal" && (
              <Slider label="Angle" value={hatchAngle} onChange={setHatchAngle} min={0} max={Math.PI} step={0.01} />
            )}
          </Section>

          <Section title="OCCLUSION">
            <Toggle label="Depth-buffer HLR" value={useOcclusion} onChange={setUseOcclusion} />
            {useOcclusion && (
              <>
                <Slider
                  label="Resolution"
                  value={depthRes}
                  onChange={(v) => setDepthRes(Math.round(v))}
                  min={128}
                  max={1024}
                  step={64}
                />
                <Slider label="Bias" value={depthBias} onChange={setDepthBias} min={0.001} max={0.05} step={0.001} />
              </>
            )}
          </Section>

          <Section title="DISPLAY">
            <Slider label="Stroke W" value={strokeWidth} onChange={setStrokeWidth} min={0.1} max={2} step={0.05} />
            <Toggle label="Show mesh" value={showMesh} onChange={setShowMesh} />
          </Section>

          <Section title="EXPORT">
            <div style={{ display: "flex", gap: 3 }}>
              {(["landscape", "portrait"] as const).map((o) => (
                <button
                  key={o}
                  onClick={() => setOrientation(o)}
                  style={{
                    ...tagStyle,
                    background: orientation === o ? "var(--fg)" : "transparent",
                    color: orientation === o ? "var(--bg-canvas)" : "var(--fg)",
                  }}
                >
                  {o === "landscape" ? "Landscape" : "Portrait"}
                </button>
              ))}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
              {Object.entries(PAGE_SIZES).map(([key, val]) => (
                <button
                  key={key}
                  onClick={() => setPageSize(key)}
                  style={{
                    ...tagStyle,
                    background: pageSize === key ? "var(--fg)" : "transparent",
                    color: pageSize === key ? "var(--bg-canvas)" : "var(--fg)",
                  }}
                >
                  {val.label}
                </button>
              ))}
            </div>
            <Slider label="Margin" value={margin} onChange={(v) => setMargin(Math.round(v))} min={5} max={40} step={1} />
            <Toggle label="Border" value={borderEnabled} onChange={setBorderEnabled} />
            {borderEnabled && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
                {Object.entries(BORDER_STYLES).map(([key, label]) => (
                  <button
                    key={key}
                    onClick={() => setBorderStyle(key as typeof borderStyle)}
                    style={{
                      ...tagStyle,
                      background: borderStyle === key ? "var(--fg)" : "transparent",
                      color: borderStyle === key ? "var(--bg-canvas)" : "var(--fg)",
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
          </Section>

          <Section title="CAMERA">
            <div style={{ display: "flex", gap: 3 }}>
              {(["perspective", "orthographic"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setCamOrtho(m === "orthographic")}
                  style={{
                    ...tagStyle,
                    background: (m === "orthographic") === camOrtho ? "var(--fg)" : "transparent",
                    color: (m === "orthographic") === camOrtho ? "var(--bg-canvas)" : "var(--fg)",
                  }}
                >
                  {m === "perspective" ? "Perspective" : "Ortho"}
                </button>
              ))}
            </div>
            <Slider label="Distance" value={camDist} onChange={setCamDist} min={1} max={25} step={0.1} />
            <div style={{ display: "flex", gap: 8, marginTop: 4, marginBottom: 4 }}>
              <XYPad valueX={panX} valueY={panY} onChangeX={setPanX} onChangeY={setPanY} size={100} />
              <OrbitCube theta={camTheta} phi={camPhi} onChangeTheta={setCamTheta} onChangePhi={setCamPhi} size={100} />
            </div>
            <div style={{ display: "flex", gap: 12, fontSize: 10, color: "var(--fg-muted)" }}>
              <HoverReset label="Pan" onReset={() => { setPanX(0); setPanY(0); }}>
                X {panX.toFixed(2)} Y {panY.toFixed(2)}
              </HoverReset>
              <HoverReset label="Orbit" onReset={() => { setCamTheta(0.6); setCamPhi(0.35); }}>
                &theta; {camTheta.toFixed(2)} &phi; {camPhi.toFixed(2)}
              </HoverReset>
            </div>
            <Slider label="Orbit θ" value={camTheta} onChange={setCamTheta} min={-Math.PI} max={Math.PI} step={0.01} />
            <Slider label="Orbit φ" value={camPhi} onChange={setCamPhi} min={-1.4} max={1.4} step={0.01} />
            <div style={{ color: "var(--fg-faint)", fontSize: 10, marginTop: 2 }}>
              Preview: drag to pan · pinch to zoom · dbl-click fit
            </div>
          </Section>

          <div
            style={{
              color: "var(--fg-faint)",
              fontSize: 10,
              marginTop: "auto",
              paddingTop: 12,
              lineHeight: 1.6,
            }}
          >
            {stats.paths} SVG paths · {stats.lines} hatch lines · {stats.verts} vertices
            <br />
            Pipeline: UV hatch → 3D surface → project{useOcclusion ? " → depth clip" : ""} → SVG
          </div>
        </div>

        {/* SVG viewport */}
        <div
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "var(--bg)",
            cursor: isDragging ? "grabbing" : "grab",
            overflow: "hidden",
          }}
          onMouseDown={handleViewMouseDown}
          onMouseMove={handleViewMouseMove}
          onMouseUp={handleViewMouseUp}
          onMouseLeave={handleViewMouseUp}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onDoubleClick={handleViewDoubleClick}
        >
          <svg
            viewBox={`0 0 ${exportLayout.pageW} ${exportLayout.pageH}`}
            style={{
              maxWidth: "calc(100% - 24px)",
              maxHeight: "calc(100vh - 60px)",
              background: "var(--bg-canvas)",
              boxShadow: "0 1px 16px var(--shadow)",
              transform: `translate(${viewPanX}px, ${viewPanY}px) scale(${viewZoom})`,
              transformOrigin: "center center",
            }}
          >
            <defs>
              <clipPath id="preview-margin-clip">
                <rect x={margin} y={margin} width={exportLayout.contentW} height={exportLayout.contentH} />
              </clipPath>
            </defs>
            {/* Margin guide (preview only) */}
            <rect
              x={margin}
              y={margin}
              width={exportLayout.contentW}
              height={exportLayout.contentH}
              fill="none"
              stroke="var(--border-light)"
              strokeWidth={0.5}
              strokeDasharray="2 2"
            />
            <g clipPath="url(#preview-margin-clip)">
              <g transform={`translate(${exportLayout.cx},${exportLayout.cy}) scale(${exportLayout.scale})`}>
                {showMesh && (
                  <g fill="none" stroke="var(--mesh-stroke)" strokeWidth={0.3 / exportLayout.scale}>
                    {meshPaths.map((d, i) => (
                      <path key={`m${i}`} d={d} />
                    ))}
                  </g>
                )}
                <g
                  fill="none"
                  stroke="var(--fg)"
                  strokeWidth={strokeWidth / exportLayout.scale}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  {svgPaths.map((d, i) => (
                    <path key={i} d={d} />
                  ))}
                </g>
              </g>
            </g>
            {previewBorderPaths.length > 0 && (
              <g fill="none" stroke="var(--fg)" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
                {previewBorderPaths.map((d, i) => (
                  <path key={`b${i}`} d={d} />
                ))}
              </g>
            )}
          </svg>
        </div>
      </div>

      <canvas ref={canvasRef} style={{ display: "none" }} />
    </div>
  );
}

// ── UI primitives ──

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div
        style={{
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: "0.1em",
          color: "var(--fg-dim)",
          marginBottom: 7,
          borderBottom: "1px solid var(--border-light)",
          paddingBottom: 4,
        }}
      >
        {title}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>{children}</div>
    </div>
  );
}

function Slider({
  label,
  value,
  onChange,
  min,
  max,
  step,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step: number;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span style={{ width: 70, color: "var(--fg-muted)", flexShrink: 0, fontSize: 11 }}>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        style={{ flex: 1, accentColor: "var(--accent-color)", height: 2 }}
      />
      <span style={{ width: 44, textAlign: "right", color: "var(--fg-dim)", fontSize: 10 }}>
        {typeof value === "number" && value % 1 !== 0 ? value.toFixed(2) : value}
      </span>
    </div>
  );
}

function Toggle({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div
      onClick={() => onChange(!value)}
      style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}
    >
      <div
        style={{
          width: 28,
          height: 14,
          borderRadius: 7,
          background: value ? "var(--fg)" : "var(--toggle-off)",
          position: "relative",
          transition: "background 0.15s",
          flexShrink: 0,
        }}
      >
        <div
          style={{
            width: 10,
            height: 10,
            borderRadius: 5,
            background: "var(--bg-canvas)",
            position: "absolute",
            top: 2,
            left: value ? 16 : 2,
            transition: "left 0.15s",
          }}
        />
      </div>
      <span style={{ color: "var(--fg-muted)" }}>{label}</span>
    </div>
  );
}

function HoverReset({
  label,
  onReset,
  children,
}: {
  label: string;
  onReset: () => void;
  children: React.ReactNode;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ display: "inline-flex", alignItems: "baseline", gap: 4 }}
    >
      {hovered ? (
        <span
          onClick={onReset}
          style={{
            color: "var(--fg-dim)",
            fontWeight: 600,
            cursor: "pointer",
            textDecoration: "underline",
            textDecorationStyle: "dotted",
            textUnderlineOffset: 2,
          }}
        >
          reset
        </span>
      ) : (
        <span style={{ color: "var(--fg-dim)", fontWeight: 600 }}>{label}</span>
      )}
      {" "}{children}
    </div>
  );
}

function OrbitCube({
  theta,
  phi,
  onChangeTheta,
  onChangePhi,
  size = 120,
}: {
  theta: number;
  phi: number;
  onChangeTheta: (v: number) => void;
  onChangePhi: (v: number) => void;
  size?: number;
}) {
  const draggingRef = useRef(false);
  const startRef = useRef({ x: 0, y: 0, theta: 0, phi: 0 });

  // 8 cube vertices at ±1
  const verts: [number, number, number][] = [
    [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
    [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1],
  ];
  // 12 edges
  const edges: [number, number][] = [
    [0, 1], [1, 2], [2, 3], [3, 0],
    [4, 5], [5, 6], [6, 7], [7, 4],
    [0, 4], [1, 5], [2, 6], [3, 7],
  ];
  // Axis tips and labels
  const axisTips: { label: string; pos: [number, number, number] }[] = [
    { label: "X", pos: [1.4, 0, 0] },
    { label: "Y", pos: [0, 1.4, 0] },
    { label: "Z", pos: [0, 0, 1.4] },
  ];

  // Rotate point: phi around X, then theta around Y
  const rotatePoint = (x: number, y: number, z: number): [number, number, number] => {
    // Rotate around X by phi
    const cosP = Math.cos(phi);
    const sinP = Math.sin(phi);
    const y1 = y * cosP - z * sinP;
    const z1 = y * sinP + z * cosP;
    // Rotate around Y by theta
    const cosT = Math.cos(theta);
    const sinT = Math.sin(theta);
    const x2 = x * cosT + z1 * sinT;
    const z2 = -x * sinT + z1 * cosT;
    return [x2, y1, z2];
  };

  const half = size / 2;
  const scale = size * 0.28;

  // Project vertices
  const projected = verts.map(([x, y, z]) => {
    const [rx, ry, rz] = rotatePoint(x, y, z);
    return { x: half + rx * scale, y: half - ry * scale, z: rz };
  });

  // Project axis tips
  const projectedAxes = axisTips.map(({ label, pos: [x, y, z] }) => {
    const [rx, ry, rz] = rotatePoint(x, y, z);
    return { label, x: half + rx * scale, y: half - ry * scale, z: rz };
  });

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      draggingRef.current = true;
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      startRef.current = { x: e.clientX, y: e.clientY, theta, phi };
    },
    [theta, phi],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!draggingRef.current) return;
      e.preventDefault();
      e.stopPropagation();
      const dx = e.clientX - startRef.current.x;
      const dy = e.clientY - startRef.current.y;
      onChangeTheta(startRef.current.theta + dx * 0.008);
      onChangePhi(Math.max(-1.4, Math.min(1.4, startRef.current.phi + dy * 0.008)));
    },
    [onChangeTheta, onChangePhi],
  );

  const handlePointerUp = useCallback(() => {
    draggingRef.current = false;
  }, []);

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onChangeTheta(0.6);
      onChangePhi(0.35);
    },
    [onChangeTheta, onChangePhi],
  );

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onDoubleClick={handleDoubleClick}
      style={{
        border: "1px solid var(--fg)",
        cursor: "grab",
        touchAction: "none",
        flexShrink: 0,
      }}
    >
      {edges.map(([a, b], i) => {
        const avgZ = (projected[a].z + projected[b].z) / 2;
        const opacity = 0.25 + 0.75 * Math.max(0, Math.min(1, (avgZ + 1.5) / 3));
        return (
          <line
            key={i}
            x1={projected[a].x}
            y1={projected[a].y}
            x2={projected[b].x}
            y2={projected[b].y}
            stroke="var(--fg)"
            strokeWidth={1}
            opacity={opacity}
          />
        );
      })}
      {projectedAxes.map((ax) => (
        <text
          key={ax.label}
          x={ax.x}
          y={ax.y}
          fill="var(--fg)"
          fontSize={9}
          fontFamily="inherit"
          fontWeight={600}
          textAnchor="middle"
          dominantBaseline="central"
          opacity={0.3 + 0.7 * Math.max(0, Math.min(1, (ax.z + 1.5) / 3))}
          style={{ pointerEvents: "none" }}
        >
          {ax.label}
        </text>
      ))}
    </svg>
  );
}

function XYPad({
  valueX,
  valueY,
  onChangeX,
  onChangeY,
  min = -3,
  max = 3,
  size = 120,
}: {
  valueX: number;
  valueY: number;
  onChangeX: (v: number) => void;
  onChangeY: (v: number) => void;
  min?: number;
  max?: number;
  size?: number;
}) {
  const padRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);

  const range = max - min;
  const normX = (valueX - min) / range;
  const normY = 1 - (valueY - min) / range; // invert Y so up = positive

  const updateFromEvent = useCallback(
    (clientX: number, clientY: number) => {
      const el = padRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const nx = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      const ny = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
      onChangeX(+(min + nx * range).toFixed(2));
      onChangeY(+(max - ny * range).toFixed(2)); // invert Y
    },
    [min, max, range, onChangeX, onChangeY],
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      draggingRef.current = true;
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      updateFromEvent(e.clientX, e.clientY);
    },
    [updateFromEvent],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!draggingRef.current) return;
      e.preventDefault();
      updateFromEvent(e.clientX, e.clientY);
    },
    [updateFromEvent],
  );

  const handlePointerUp = useCallback(() => {
    draggingRef.current = false;
  }, []);

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onChangeX(0);
      onChangeY(0);
    },
    [onChangeX, onChangeY],
  );

  return (
    <div
      ref={padRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onDoubleClick={handleDoubleClick}
      style={{
        width: size,
        height: size,
        border: "1px solid var(--fg)",
        position: "relative",
        cursor: "crosshair",
        touchAction: "none",
        flexShrink: 0,
      }}
    >
      {/* Crosshair lines */}
      <div
        style={{
          position: "absolute",
          left: `${normX * 100}%`,
          top: 0,
          bottom: 0,
          width: 1,
          background: "var(--border-light)",
          pointerEvents: "none",
        }}
      />
      <div
        style={{
          position: "absolute",
          top: `${normY * 100}%`,
          left: 0,
          right: 0,
          height: 1,
          background: "var(--border-light)",
          pointerEvents: "none",
        }}
      />
      {/* Center crosshair (origin) */}
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: 0,
          bottom: 0,
          width: 1,
          background: "var(--border-light)",
          opacity: 0.3,
          pointerEvents: "none",
        }}
      />
      <div
        style={{
          position: "absolute",
          top: "50%",
          left: 0,
          right: 0,
          height: 1,
          background: "var(--border-light)",
          opacity: 0.3,
          pointerEvents: "none",
        }}
      />
      {/* Position dot */}
      <div
        style={{
          position: "absolute",
          left: `${normX * 100}%`,
          top: `${normY * 100}%`,
          width: 8,
          height: 8,
          borderRadius: 4,
          background: "var(--fg)",
          transform: "translate(-50%, -50%)",
          pointerEvents: "none",
        }}
      />
    </div>
  );
}

function generateBorderPaths(
  style: string,
  pageW: number,
  pageH: number,
  margin: number,
  _strokeWidth: number,
): string[] {
  const x = margin;
  const y = margin;
  const w = pageW - margin * 2;
  const h = pageH - margin * 2;

  const rect = (rx: number, ry: number, rw: number, rh: number) =>
    `M${rx},${ry}H${rx + rw}V${ry + rh}H${rx}Z`;

  switch (style) {
    case "simple":
      return [rect(x, y, w, h)];

    case "double": {
      const inset = 2;
      return [
        rect(x, y, w, h),
        rect(x + inset, y + inset, w - inset * 2, h - inset * 2),
      ];
    }

    case "ticked": {
      const paths = [rect(x, y, w, h)];
      const tickLen = 2;
      const spacing = 10;
      // Top and bottom ticks
      for (let tx = x + spacing; tx < x + w; tx += spacing) {
        paths.push(`M${tx},${y}V${y - tickLen}`);
        paths.push(`M${tx},${y + h}V${y + h + tickLen}`);
      }
      // Left and right ticks
      for (let ty = y + spacing; ty < y + h; ty += spacing) {
        paths.push(`M${x},${ty}H${x - tickLen}`);
        paths.push(`M${x + w},${ty}H${x + w + tickLen}`);
      }
      return paths;
    }

    case "cropmarks": {
      const markLen = 8;
      const gap = 2;
      const corners = [
        // Top-left
        [`M${x - gap},${y}H${x - gap - markLen}`, `M${x},${y - gap}V${y - gap - markLen}`],
        // Top-right
        [`M${x + w + gap},${y}H${x + w + gap + markLen}`, `M${x + w},${y - gap}V${y - gap - markLen}`],
        // Bottom-left
        [`M${x - gap},${y + h}H${x - gap - markLen}`, `M${x},${y + h + gap}V${y + h + gap + markLen}`],
        // Bottom-right
        [`M${x + w + gap},${y + h}H${x + w + gap + markLen}`, `M${x + w},${y + h + gap}V${y + h + gap + markLen}`],
      ];
      return corners.flat();
    }

    default:
      return [];
  }
}

const btnStyle: React.CSSProperties = {
  padding: "6px 14px",
  fontSize: 11,
  fontFamily: "inherit",
  fontWeight: 600,
  letterSpacing: "0.05em",
  border: "1px solid var(--fg)",
  background: "transparent",
  color: "var(--fg)",
  cursor: "pointer",
  borderRadius: 0,
};

const tagStyle: React.CSSProperties = {
  padding: "3px 7px",
  fontSize: 10,
  fontFamily: "inherit",
  fontWeight: 600,
  letterSpacing: "0.02em",
  border: "1px solid var(--fg)",
  cursor: "pointer",
  borderRadius: 0,
};
