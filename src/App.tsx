import { useState, useRef, useCallback, useMemo } from "react";
import * as THREE from "three";
import { SURFACES } from "./surfaces";
import { generateUVHatchLines, HatchParams } from "./hatch";
import { projectPolylines, polylinesToSVGPaths, buildSurfaceMesh } from "./projection";
import { renderDepthBuffer, clipPolylineByDepth } from "./occlusion";
import { COMPOSITIONS, LayerConfig } from "./compositions";

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [width] = useState(800);
  const [height] = useState(800);

  // Shape
  const [surfaceKey, setSurfaceKey] = useState("hyperboloid");
  const [compositionKey, setCompositionKey] = useState("single");

  // Surface params (generic sliders mapped to surface)
  const [paramA, setParamA] = useState(0.5);
  const [paramB, setParamB] = useState(0.5);
  const [paramC, setParamC] = useState(0.5);
  const [paramD, setParamD] = useState(0.5);

  // Hatch
  const [hatchFamily, setHatchFamily] = useState<"u" | "v" | "diagonal">("u");
  const [hatchCount, setHatchCount] = useState(30);
  const [hatchSamples, setHatchSamples] = useState(50);
  const [hatchAngle, setHatchAngle] = useState(0.7);

  // Occlusion
  const [useOcclusion, setUseOcclusion] = useState(false);
  const [depthRes, setDepthRes] = useState(512);
  const [depthBias, setDepthBias] = useState(0.01);

  // Camera
  const [camTheta, setCamTheta] = useState(0.6);
  const [camPhi, setCamPhi] = useState(0.35);
  const [camDist, setCamDist] = useState(8);

  // Display
  const [strokeWidth, setStrokeWidth] = useState(0.5);
  const [showMesh, setShowMesh] = useState(false);

  // Orbit drag
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0, theta: 0, phi: 0 });

  // Build Three.js camera
  const threeCamera = useMemo(() => {
    const cam = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
    cam.position.set(
      camDist * Math.sin(camTheta) * Math.cos(camPhi),
      camDist * Math.sin(camPhi),
      camDist * Math.cos(camTheta) * Math.cos(camPhi)
    );
    cam.lookAt(0, 0, 0);
    cam.updateMatrixWorld();
    cam.updateProjectionMatrix();
    return cam;
  }, [camTheta, camPhi, camDist, width, height]);

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

  // Orbit controls
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      setIsDragging(true);
      setDragStart({ x: e.clientX, y: e.clientY, theta: camTheta, phi: camPhi });
    },
    [camTheta, camPhi]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!isDragging) return;
      setCamTheta(dragStart.theta + (e.clientX - dragStart.x) * 0.008);
      setCamPhi(
        Math.max(
          -1.4,
          Math.min(1.4, dragStart.phi + (e.clientY - dragStart.y) * 0.008)
        )
      );
    },
    [isDragging, dragStart]
  );

  const handleMouseUp = useCallback(() => setIsDragging(false), []);
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    setCamDist((d) => Math.max(3, Math.min(25, d + e.deltaY * 0.01)));
  }, []);

  // Export
  const exportSVG = useCallback(() => {
    const content = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <g fill="none" stroke="black" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round">
    ${svgPaths.map((d) => `<path d="${d}"/>`).join("\n    ")}
  </g>
</svg>`;
    const blob = new Blob([content], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `hatch3d_${compositionKey}_${surfaceKey}.svg`;
    a.click();
    URL.revokeObjectURL(url);
  }, [svgPaths, width, height, strokeWidth, compositionKey, surfaceKey]);

  const surfaceInfo = SURFACES[surfaceKey];
  const paramKeys = Object.keys(surfaceInfo.defaults);

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#f7f5f2",
        fontFamily: "'IBM Plex Mono', 'SF Mono', monospace",
        color: "#1a1a1a",
        display: "flex",
        flexDirection: "column",
        userSelect: "none",
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "14px 22px",
          borderBottom: "1px solid #d4d0ca",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          background: "#edebe7",
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
          <span style={{ fontSize: 14, fontWeight: 700, letterSpacing: "0.06em" }}>
            HATCH3D
          </span>
          <span style={{ fontSize: 10, color: "#888", letterSpacing: "0.08em" }}>
            UV-SPACE PARAMETRIC HATCHING → SVG
          </span>
        </div>
        <button onClick={exportSVG} style={{ ...btnStyle, background: "#1a1a1a", color: "#f5f3f0" }}>
          EXPORT SVG
        </button>
      </div>

      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        {/* Controls panel */}
        <div
          style={{
            width: 280,
            padding: "14px 18px",
            overflowY: "auto",
            borderRight: "1px solid #d4d0ca",
            fontSize: 11,
            display: "flex",
            flexDirection: "column",
            gap: 14,
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
                    background: compositionKey === key ? "#1a1a1a" : "transparent",
                    color: compositionKey === key ? "#f5f3f0" : "#1a1a1a",
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
                      background: surfaceKey === key ? "#1a1a1a" : "transparent",
                      color: surfaceKey === key ? "#f5f3f0" : "#1a1a1a",
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
                    background: hatchFamily === f ? "#1a1a1a" : "transparent",
                    color: hatchFamily === f ? "#f5f3f0" : "#1a1a1a",
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

          <Section title="CAMERA">
            <Slider label="Distance" value={camDist} onChange={setCamDist} min={3} max={25} step={0.1} />
            <Slider label="Orbit θ" value={camTheta} onChange={setCamTheta} min={-Math.PI} max={Math.PI} step={0.01} />
            <Slider label="Orbit φ" value={camPhi} onChange={setCamPhi} min={-1.4} max={1.4} step={0.01} />
            <div style={{ color: "#aaa", fontSize: 10, marginTop: 2 }}>
              Drag to orbit · Scroll to zoom
            </div>
          </Section>

          <div
            style={{
              color: "#aaa",
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
            background: "#f7f5f2",
            cursor: isDragging ? "grabbing" : "grab",
            overflow: "hidden",
          }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onWheel={handleWheel}
        >
          <svg
            width={width}
            height={height}
            viewBox={`0 0 ${width} ${height}`}
            style={{
              maxWidth: "calc(100% - 40px)",
              maxHeight: "calc(100vh - 80px)",
              background: "white",
              boxShadow: "0 1px 16px rgba(0,0,0,0.06)",
            }}
          >
            {showMesh && (
              <g fill="none" stroke="#ddd" strokeWidth={0.3}>
                {meshPaths.map((d, i) => (
                  <path key={`m${i}`} d={d} />
                ))}
              </g>
            )}
            <g
              fill="none"
              stroke="#1a1a1a"
              strokeWidth={strokeWidth}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              {svgPaths.map((d, i) => (
                <path key={i} d={d} />
              ))}
            </g>
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
          color: "#999",
          marginBottom: 7,
          borderBottom: "1px solid #e2dfd9",
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
      <span style={{ width: 70, color: "#666", flexShrink: 0, fontSize: 11 }}>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        style={{ flex: 1, accentColor: "#1a1a1a", height: 2 }}
      />
      <span style={{ width: 44, textAlign: "right", color: "#999", fontSize: 10 }}>
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
          background: value ? "#1a1a1a" : "#ccc",
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
            background: "white",
            position: "absolute",
            top: 2,
            left: value ? 16 : 2,
            transition: "left 0.15s",
          }}
        />
      </div>
      <span style={{ color: "#666" }}>{label}</span>
    </div>
  );
}

const btnStyle: React.CSSProperties = {
  padding: "6px 14px",
  fontSize: 11,
  fontFamily: "inherit",
  fontWeight: 600,
  letterSpacing: "0.05em",
  border: "1px solid #1a1a1a",
  background: "transparent",
  cursor: "pointer",
  borderRadius: 0,
};

const tagStyle: React.CSSProperties = {
  padding: "3px 7px",
  fontSize: 10,
  fontFamily: "inherit",
  fontWeight: 600,
  letterSpacing: "0.02em",
  border: "1px solid #1a1a1a",
  cursor: "pointer",
  borderRadius: 0,
};
