import { useState, useRef, useCallback, useMemo, useEffect } from "react";
import { useHistory } from "./hooks/useHistory";
import { useRenderWorker } from "./hooks/useRenderWorker";
import type { CameraParams } from "./workers/render-worker.types";
import { SURFACES } from "./surfaces";
import {
  compositionRegistry,
  type Composition3DDefinition,
  getControlDefaults,
  getMacroDefaults,
  resolveValues,
  is2DComposition,
} from "./compositions";
import { btnStyle, tagStyle } from "./components/styles";
import { Section } from "./components/Section";
import { Slider } from "./components/Slider";
import { Toggle } from "./components/Toggle";
import { CompositionControls } from "./components/CompositionControls";
import { ThreeDControls } from "./components/ThreeDControls";
import { CompositionBrowser } from "./components/CompositionBrowser";
import { ExportModal } from "./components/ExportModal";
import { PresetMenu } from "./components/PresetMenu";
import { RenderButton } from "./components/RenderButton";
import type { HatchGroupConfig } from "./components/HatchGroupControls";
import { configHash } from "./utils/config-hash";
import { exportPng, PNG_THEMES } from "./utils/export-png";
import { sendToQueue, isPrintQueueEnabled } from "./utils/print-queue-client";
import { clipSVGPath, type Rect } from "./utils/clip";
import { useHashRoute } from "./hooks/useHashRoute";
import {
  getPresetsForComposition,
  saveUserPreset,
  deleteUserPreset,
} from "./compositions/presets";
import type { CompositionPreset } from "./compositions/types";

const PAGE_SIZES: Record<string, { label: string; w: number; h: number }> = {
  a3: { label: "A3", w: 420, h: 297 },
  a4: { label: "A4", w: 297, h: 210 },
  a5: { label: "A5", w: 210, h: 148 },
  letter: { label: '8.5\u00d711"', w: 279.4, h: 215.9 },
  tabloid: { label: '11\u00d717"', w: 431.8, h: 279.4 },
};

const BORDER_STYLES: Record<string, string> = {
  simple: "Simple",
  double: "Double",
  ticked: "Ticked",
  cropmarks: "Crop marks",
};

const DOUBLE_BORDER_INSET = 2;

const THEME_KEY = "hatch3d-theme";
const STORAGE_KEY = "hatch3d-state";
const COMP_VALUES_KEY = "hatch3d-comp-values";
const MACRO_VALUES_KEY = "hatch3d-macro-values";
const HATCH_GROUPS_KEY = "hatch3d-hatch-groups";

type HatchFamily = "u" | "v" | "diagonal" | "rings" | "hex" | "crosshatch" | "spiral";

const DEFAULTS = {
  surfaceKey: "hyperboloid",
  compositionKey: "single",
  controlsPanel: "inline" as "inline" | "side",
  paramA: 0.5,
  paramB: 0.5,
  paramC: 0.5,
  paramD: 0.5,
  hatchFamily: "u" as HatchFamily,
  hatchCount: 30,
  hatchSamples: 50,
  hatchAngle: 0.7,
  useOcclusion: false,
  depthRes: 512,
  depthBias: 0.001,
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
  densityFilterEnabled: true,
  densityMax: 20,
  densityCellSize: 40,
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
  const [compositionKey, setCompositionKey] = useState(
    compositionRegistry.has(INITIAL.compositionKey) ? INITIAL.compositionKey : DEFAULTS.compositionKey,
  );

  // Hash-based routing: sync compositionKey with URL hash
  useHashRoute(
    compositionKey,
    setCompositionKey,
    (key: string) => compositionRegistry.has(key),
    DEFAULTS.compositionKey,
  );

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

  // Density filter
  const [densityFilterEnabled, setDensityFilterEnabled] = useState(INITIAL.densityFilterEnabled);
  const [densityMax, setDensityMax] = useState(INITIAL.densityMax);
  const [densityCellSize, setDensityCellSize] = useState(INITIAL.densityCellSize);

  // Layout: controls panel mode
  const [controlsPanel, setControlsPanel] = useState(INITIAL.controlsPanel);

  // Per-composition control values
  const [compValues, setCompValues] = useState<Record<string, Record<string, unknown>>>(() => {
    try {
      const raw = localStorage.getItem(COMP_VALUES_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
  });
  const [macroValues, setMacroValues] = useState<Record<string, Record<string, number>>>(() => {
    try {
      const raw = localStorage.getItem(MACRO_VALUES_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
  });

  // Per-composition hatch group overrides: { compositionKey: { groupName: HatchGroupConfig } }
  const [hatchGroupValues, setHatchGroupValues] = useState<Record<string, Record<string, HatchGroupConfig>>>(() => {
    try {
      const raw = localStorage.getItem(HATCH_GROUPS_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
  });

  // Responsive: detect narrow viewport (debounced)
  const [isNarrow, setIsNarrow] = useState(typeof window !== "undefined" && window.innerWidth < 1200);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const handler = () => {
      clearTimeout(timer);
      timer = setTimeout(() => setIsNarrow(window.innerWidth < 1200), 150);
    };
    window.addEventListener("resize", handler);
    return () => { window.removeEventListener("resize", handler); clearTimeout(timer); };
  }, []);

  // WASM is now initialized inside the render worker

  // Theme toggle (auto / light / dark)
  const [theme, setTheme] = useState<"auto" | "light" | "dark">(() => {
    const saved = localStorage.getItem(THEME_KEY);
    return saved === "light" || saved === "dark" ? saved : "auto";
  });
  useEffect(() => {
    if (theme === "auto") {
      document.documentElement.removeAttribute("data-theme");
    } else {
      document.documentElement.setAttribute("data-theme", theme);
    }
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  const cycleTheme = useCallback(() => {
    setTheme(prev => prev === "auto" ? "light" : prev === "light" ? "dark" : "auto");
  }, []);

  // Current composition helpers — use registry (fall back if stale localStorage/hash)
  const comp = compositionRegistry.get(compositionKey)
    ?? compositionRegistry.get(DEFAULTS.compositionKey)!;
  const is2d = is2DComposition(comp);
  const controlDefaults = useMemo(() => getControlDefaults(comp.controls), [comp.controls]);
  const macroDefaults = useMemo(() => getMacroDefaults(comp.macros), [comp.macros]);

  const compSlice = compValues[compositionKey];
  const macroSlice = macroValues[compositionKey];
  const currentValues = useMemo(
    () => ({ ...controlDefaults, ...compSlice }),
    [controlDefaults, compSlice],
  );
  const currentMacros = useMemo(
    () => ({ ...macroDefaults, ...macroSlice }),
    [macroDefaults, macroSlice],
  );

  const setCompValue = useCallback((key: string, val: unknown) => {
    setCompValues(prev => {
      const existing = prev[compositionKey];
      if (existing && existing[key] === val) return prev;
      return { ...prev, [compositionKey]: { ...existing, [key]: val } };
    });
  }, [compositionKey]);

  const setMacroValue = useCallback((key: string, val: number) => {
    setMacroValues(prev => {
      const existing = prev[compositionKey];
      if (existing && existing[key] === val) return prev;
      return { ...prev, [compositionKey]: { ...existing, [key]: val } };
    });
  }, [compositionKey]);

  const setHatchGroupValue = useCallback((groupName: string, config: HatchGroupConfig) => {
    setHatchGroupValues(prev => {
      const existing = prev[compositionKey] ?? {};
      return { ...prev, [compositionKey]: { ...existing, [groupName]: config } };
    });
  }, [compositionKey]);

  const currentHatchGroups = useMemo(
    () => hatchGroupValues[compositionKey] ?? {},
    [hatchGroupValues, compositionKey],
  );

  // Reset all macros to their defaults (0.5 center)
  const resetMacros = useCallback(() => {
    setMacroValues(prev => {
      const { [compositionKey]: _, ...rest } = prev;
      return rest;
    });
  }, [compositionKey]);

  // Reset a specific control group to defaults
  const resetControlGroup = useCallback((group: string) => {
    if (!comp.controls) return;
    setCompValues(prev => {
      const existing = { ...prev[compositionKey] };
      for (const [key, ctrl] of Object.entries(comp.controls!)) {
        if (ctrl.group === group) delete existing[key];
      }
      return { ...prev, [compositionKey]: existing };
    });
  }, [compositionKey, comp.controls]);

  // Reset all controls + macros + hatch groups for current composition
  const resetAllControls = useCallback(() => {
    setCompValues(prev => {
      const { [compositionKey]: _, ...rest } = prev;
      return rest;
    });
    setMacroValues(prev => {
      const { [compositionKey]: _, ...rest } = prev;
      return rest;
    });
    setHatchGroupValues(prev => {
      const { [compositionKey]: _, ...rest } = prev;
      return rest;
    });
  }, [compositionKey]);

  // Macro resolver
  const resolvedValues = useMemo(
    () => resolveValues(comp.controls, comp.macros, currentValues, currentMacros),
    [comp.controls, comp.macros, currentValues, currentMacros],
  );

  // Persist all controls to localStorage (debounced to avoid thrashing during slider drags)
  const persistTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const stateSnapshot = useMemo(() => ({
    surfaceKey, compositionKey, controlsPanel,
    paramA, paramB, paramC, paramD,
    hatchFamily, hatchCount, hatchSamples, hatchAngle,
    useOcclusion, depthRes, depthBias,
    camTheta, camPhi, camDist, camOrtho, panX, panY,
    strokeWidth, showMesh,
    pageSize, orientation, margin, borderEnabled, borderStyle,
    densityFilterEnabled, densityMax, densityCellSize,
  }), [
    surfaceKey, compositionKey, controlsPanel,
    paramA, paramB, paramC, paramD,
    hatchFamily, hatchCount, hatchSamples, hatchAngle,
    useOcclusion, depthRes, depthBias,
    camTheta, camPhi, camDist, camOrtho, panX, panY,
    strokeWidth, showMesh,
    pageSize, orientation, margin, borderEnabled, borderStyle,
    densityFilterEnabled, densityMax, densityCellSize,
  ]);
  useEffect(() => {
    clearTimeout(persistTimer.current);
    persistTimer.current = setTimeout(() => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(stateSnapshot));
      localStorage.setItem(COMP_VALUES_KEY, JSON.stringify(compValues));
      localStorage.setItem(MACRO_VALUES_KEY, JSON.stringify(macroValues));
      localStorage.setItem(HATCH_GROUPS_KEY, JSON.stringify(hatchGroupValues));
    }, 300);
    return () => clearTimeout(persistTimer.current);
  }, [stateSnapshot, compValues, macroValues, hatchGroupValues]);

  // ── Undo / Redo ──
  const undoableSnapshot = useMemo(() => ({
    surfaceKey, compositionKey,
    paramA, paramB, paramC, paramD,
    hatchFamily, hatchCount, hatchSamples, hatchAngle,
    useOcclusion, depthRes, depthBias,
    camTheta, camPhi, camDist, camOrtho, panX, panY,
    strokeWidth, showMesh,
    pageSize, orientation, margin, borderEnabled, borderStyle,
    densityFilterEnabled, densityMax, densityCellSize,
    compValues, macroValues, hatchGroupValues,
  }), [
    surfaceKey, compositionKey,
    paramA, paramB, paramC, paramD,
    hatchFamily, hatchCount, hatchSamples, hatchAngle,
    useOcclusion, depthRes, depthBias,
    camTheta, camPhi, camDist, camOrtho, panX, panY,
    strokeWidth, showMesh,
    pageSize, orientation, margin, borderEnabled, borderStyle,
    densityFilterEnabled, densityMax, densityCellSize,
    compValues, macroValues, hatchGroupValues,
  ]);

  const restoreSnapshot = useCallback((snap: typeof undoableSnapshot) => {
    setSurfaceKey(snap.surfaceKey);
    setCompositionKey(snap.compositionKey);
    setParamA(snap.paramA);
    setParamB(snap.paramB);
    setParamC(snap.paramC);
    setParamD(snap.paramD);
    setHatchFamily(snap.hatchFamily);
    setHatchCount(snap.hatchCount);
    setHatchSamples(snap.hatchSamples);
    setHatchAngle(snap.hatchAngle);
    setUseOcclusion(snap.useOcclusion);
    setDepthRes(snap.depthRes);
    setDepthBias(snap.depthBias);
    setCamTheta(snap.camTheta);
    setCamPhi(snap.camPhi);
    setCamDist(snap.camDist);
    setCamOrtho(snap.camOrtho);
    setPanX(snap.panX);
    setPanY(snap.panY);
    setStrokeWidth(snap.strokeWidth);
    setShowMesh(snap.showMesh);
    setPageSize(snap.pageSize);
    setOrientation(snap.orientation);
    setMargin(snap.margin);
    setBorderEnabled(snap.borderEnabled);
    setBorderStyle(snap.borderStyle);
    setDensityFilterEnabled(snap.densityFilterEnabled);
    setDensityMax(snap.densityMax);
    setDensityCellSize(snap.densityCellSize);
    setCompValues(snap.compValues);
    setMacroValues(snap.macroValues);
    setHatchGroupValues(snap.hatchGroupValues);
  }, []);

  const { undo, redo, canUndo, canRedo } = useHistory(undoableSnapshot, restoreSnapshot);

  // Keyboard shortcuts for undo/redo
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      if (e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if ((e.key === "z" && e.shiftKey) || e.key === "y") {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [undo, redo]);

  // Preview pan/zoom (ephemeral, not persisted)
  const [viewZoom, setViewZoom] = useState(1);
  const [viewPanX, setViewPanX] = useState(0);
  const [viewPanY, setViewPanY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const viewDragRef = useRef({ x: 0, y: 0, panX: 0, panY: 0 });

  // Serializable camera params (camera is reconstructed inside the worker)
  const cameraParams: CameraParams = useMemo(
    () => ({
      theta: camTheta,
      phi: camPhi,
      dist: camDist,
      ortho: camOrtho,
      panX,
      panY,
      width,
      height,
    }),
    [camTheta, camPhi, camDist, camOrtho, panX, panY, width, height]
  );

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

  // Inset clip rect for double border so hatch lines clip at the inner edge
  const clipInset = borderEnabled && borderStyle === "double" ? DOUBLE_BORDER_INSET : 0;

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

  // Hatch params memo (serializable for worker)
  const hatchParams = useMemo(
    () => ({
      family: hatchFamily,
      count: hatchCount,
      samples: hatchSamples,
      angle: hatchAngle,
    }),
    [hatchFamily, hatchCount, hatchSamples, hatchAngle]
  );

  // Stable reference for the subset of exportLayout the worker needs
  const workerExportLayout = useMemo(
    () => ({ contentW: exportLayout.contentW, contentH: exportLayout.contentH, scale: exportLayout.scale }),
    [exportLayout]
  );

  // Generate everything via Web Worker
  const { svgPaths, meshPaths, stats, isRendering, isStale, renderTimeMs, triggerRender } =
    useRenderWorker({
      compositionKey,
      is2d,
      width,
      height,
      resolvedValues,
      surfaceKey,
      surfaceParams,
      hatchParams,
      currentHatchGroups,
      camera: cameraParams,
      useOcclusion,
      depthRes,
      depthBias,
      exportLayout: workerExportLayout,
      showMesh,
      densityFilterEnabled,
      densityMax,
      densityCellSize,
      renderMode: comp.renderMode ?? "immediate",
    });

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

  // Deterministic config hash for filenames
  const fileHash = useMemo(() => configHash({
    compositionKey,
    resolvedValues,
    currentMacros,
    hatchGroupValues: currentHatchGroups,
    ...(is2d ? {} : { surfaceKey, camTheta, camPhi, camDist, hatchFamily, hatchCount, hatchSamples }),
  }), [compositionKey, resolvedValues, currentMacros, currentHatchGroups, is2d, surfaceKey, camTheta, camPhi, camDist, hatchFamily, hatchCount, hatchSamples]);

  const fileBasename = useMemo(() => {
    const prefix = is2d ? "hatch2d" : "hatch3d";
    return `${prefix}_${compositionKey}_${fileHash}`;
  }, [is2d, compositionKey, fileHash]);

  // Build SVG content string (shared between SVG and PNG export)
  const buildSVGContent = useCallback(() => {
    const { pageW, pageH, contentW, contentH, scale, cx, cy } = exportLayout;

    // Clip paths to the margin boundary so plotters don't draw off-paper
    const clipRect: Rect = {
      xMin: margin + clipInset,
      yMin: margin + clipInset,
      xMax: margin + contentW - clipInset,
      yMax: margin + contentH - clipInset,
    };
    const transform = { cx, cy, scale };
    const clippedPaths = svgPaths.flatMap((d) => clipSVGPath(d, transform, clipRect));

    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${pageW}mm" height="${pageH}mm" viewBox="0 0 ${pageW} ${pageH}">
  <g fill="none" stroke="black" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round">
    ${clippedPaths.map((d) => `<path d="${d}"/>`).join("\n    ")}
  </g>${previewBorderPaths.length > 0 ? `\n  <g fill="none" stroke="black" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round">\n    ${previewBorderPaths.map((d) => `<path d="${d}"/>`).join("\n    ")}\n  </g>` : ""}
</svg>`;
  }, [svgPaths, exportLayout, margin, clipInset, strokeWidth, previewBorderPaths]);

  // Export SVG
  const handleExportSVG = useCallback(() => {
    const content = buildSVGContent();
    const blob = new Blob([content], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${fileBasename}.svg`;
    a.click();
    URL.revokeObjectURL(url);
  }, [buildSVGContent, fileBasename]);

  // Export PNG
  const handleExportPNG = useCallback(async (pngTheme: "light" | "dark", scale: number) => {
    const content = buildSVGContent();
    try {
      const blob = await exportPng(content, PNG_THEMES[pngTheme], scale);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${fileBasename}.png`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.warn("PNG export failed:", (e as Error).message);
    }
  }, [buildSVGContent, fileBasename]);

  // Send to print queue
  const handleSendToQueue = useCallback(async () => {
    const svgContent = buildSVGContent();
    let pngBlob: Blob | undefined;
    try {
      pngBlob = await exportPng(svgContent, PNG_THEMES.dark, 2);
    } catch {
      // PNG preview is optional
    }
    const result = await sendToQueue({
      compositionKey,
      presetName: fileBasename,
      svgContent,
      pngBlob,
      values: { ...compSlice, ...macroSlice },
      camera: is2d ? null : { theta: camTheta, phi: camPhi, dist: camDist },
    });
    if (!result.ok) {
      throw new Error(result.error || "Failed to send to queue");
    }
  }, [buildSVGContent, compositionKey, fileBasename, compSlice, macroSlice, is2d, camTheta, camPhi, camDist]);

  // Export modal state
  const [exportModalOpen, setExportModalOpen] = useState(false);

  // Preset management
  const [presetVersion, setPresetVersion] = useState(0);

  const presets = useMemo(
    () => getPresetsForComposition(compositionKey, comp.suggestedPresets),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [compositionKey, comp.suggestedPresets, presetVersion],
  );

  const handleSavePreset = useCallback((name: string) => {
    const key = name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
    const preset: CompositionPreset = {
      name,
      values: {
        controls: compValues[compositionKey],
        macros: macroValues[compositionKey],
        hatchGroups: hatchGroupValues[compositionKey],
      },
    };
    saveUserPreset(compositionKey, key, preset);
    setPresetVersion((v) => v + 1);
  }, [compositionKey, compValues, macroValues, hatchGroupValues]);

  const handleLoadPreset = useCallback((preset: CompositionPreset) => {
    if (preset.values.controls) {
      setCompValues((prev) => ({ ...prev, [compositionKey]: preset.values.controls as Record<string, unknown> }));
    }
    if (preset.values.macros) {
      setMacroValues((prev) => ({ ...prev, [compositionKey]: preset.values.macros as Record<string, number> }));
    }
    if (preset.values.hatchGroups) {
      setHatchGroupValues((prev) => ({ ...prev, [compositionKey]: preset.values.hatchGroups as Record<string, HatchGroupConfig> }));
    }
  }, [compositionKey]);

  const handleDeletePreset = useCallback((key: string) => {
    deleteUserPreset(compositionKey, key);
    setPresetVersion((v) => v + 1);
  }, [compositionKey]);

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
          <button
            onClick={cycleTheme}
            title={`Theme: ${theme}`}
            style={{ ...tagStyle, fontSize: 12, padding: "2px 8px", lineHeight: 1 }}
          >
            {theme === "auto" ? "\u25D1" : theme === "light" ? "\u2600" : "\u263E"}
          </button>
          <button
            onClick={() => setExportModalOpen(true)}
            style={{ ...btnStyle, background: "var(--fg)", color: "var(--bg-canvas)" }}
          >
            EXPORT
          </button>
        </div>
      </div>

      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        {/* Main controls sidebar */}
        <div
          style={{
            width: 280,
            minWidth: 280,
            padding: "14px 18px",
            overflowY: "auto",
            overflowX: "hidden",
            borderRight: "1px solid var(--border)",
            fontSize: 11,
            display: "flex",
            flexDirection: "column",
            gap: 18,
            flexShrink: 0,
          }}
        >
          {/* Undo / Redo */}
          <div style={{ display: "flex", gap: 4 }}>
            <button
              onClick={undo}
              disabled={!canUndo}
              style={{
                ...btnStyle,
                flex: 1,
                opacity: canUndo ? 1 : 0.3,
                cursor: canUndo ? "pointer" : "default",
              }}
              title="Undo (Cmd+Z)"
            >
              Undo
            </button>
            <button
              onClick={redo}
              disabled={!canRedo}
              style={{
                ...btnStyle,
                flex: 1,
                opacity: canRedo ? 1 : 0.3,
                cursor: canRedo ? "pointer" : "default",
              }}
              title="Redo (Cmd+Shift+Z)"
            >
              Redo
            </button>
          </div>

          <Section title="COMPOSITION" preview={comp.name}>
            <CompositionBrowser
              currentKey={compositionKey}
              onSelect={setCompositionKey}
            />
            {!isNarrow && controlsPanel === "inline" && (comp.controls || !is2d) && (
              <button
                onClick={() => setControlsPanel("side")}
                title="Undock controls to side panel"
                style={{ ...tagStyle, fontSize: 9, padding: "2px 6px", alignSelf: "flex-start" }}
              >
                Undock controls &rarr;
              </button>
            )}
          </Section>

          {compositionKey === "single" && (
            <Section title="SURFACE" preview={surfaceInfo.name}>
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

          {/* Inline composition controls + 3D controls (when not using side panel) */}
          {(isNarrow || controlsPanel === "inline") && (
            <>
              {compositionKey !== "single" && comp.controls && (
                <CompositionControls
                  controls={comp.controls}
                  macros={comp.macros}
                  hatchGroups={"hatchGroups" in comp ? (comp as Composition3DDefinition).hatchGroups : undefined}
                  currentValues={currentValues}
                  currentMacros={currentMacros}
                  resolvedValues={resolvedValues}
                  currentHatchGroups={currentHatchGroups}
                  onControlChange={setCompValue}
                  onMacroChange={setMacroValue}
                  onHatchGroupChange={setHatchGroupValue}
                  onResetMacros={resetMacros}
                  onResetGroup={resetControlGroup}
                  onResetAll={resetAllControls}
                />
              )}
              {!is2d && (
                <ThreeDControls
                  hatchFamily={hatchFamily}
                  setHatchFamily={(f) => setHatchFamily(f as HatchFamily)}
                  hatchCount={hatchCount}
                  setHatchCount={setHatchCount}
                  hatchSamples={hatchSamples}
                  setHatchSamples={setHatchSamples}
                  hatchAngle={hatchAngle}
                  setHatchAngle={setHatchAngle}
                  useOcclusion={useOcclusion}
                  setUseOcclusion={setUseOcclusion}
                  depthRes={depthRes}
                  setDepthRes={setDepthRes}
                  depthBias={depthBias}
                  setDepthBias={setDepthBias}
                  showMesh={showMesh}
                  setShowMesh={setShowMesh}
                  camOrtho={camOrtho}
                  setCamOrtho={setCamOrtho}
                  camDist={camDist}
                  setCamDist={setCamDist}
                  camTheta={camTheta}
                  setCamTheta={setCamTheta}
                  camPhi={camPhi}
                  setCamPhi={setCamPhi}
                  panX={panX}
                  setPanX={setPanX}
                  panY={panY}
                  setPanY={setPanY}
                />
              )}
            </>
          )}

          {comp.renderMode === "manual" && (
            <RenderButton
              isStale={isStale}
              isRendering={isRendering}
              onRender={triggerRender}
            />
          )}

          {compositionKey !== "single" && (
            <PresetMenu
              compositionKey={compositionKey}
              suggested={presets.suggested}
              user={presets.user}
              onSave={handleSavePreset}
              onLoad={handleLoadPreset}
              onDelete={handleDeletePreset}
            />
          )}

          <Section title="DISPLAY" preview={`sw ${strokeWidth.toFixed(1)}`}>
            <Slider label="Stroke W" value={strokeWidth} onChange={setStrokeWidth} min={0.1} max={2} step={0.05} />
          </Section>

          <Section title="DENSITY" preview={densityFilterEnabled ? `max ${densityMax}` : "off"}>
            <Toggle label="Density filter" value={densityFilterEnabled} onChange={setDensityFilterEnabled} />
            {densityFilterEnabled && (
              <>
                <Slider label="Max" value={densityMax} onChange={(v) => setDensityMax(Math.round(v))} min={1} max={60} step={1} />
                <Slider label="Cell size" value={densityCellSize} onChange={(v) => setDensityCellSize(Math.round(v))} min={10} max={100} step={5} />
              </>
            )}
          </Section>

          <Section title="EXPORT" preview={`${PAGE_SIZES[pageSize].label} ${orientation}`}>
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

          <div
            style={{
              color: "var(--fg-faint)",
              fontSize: 10,
              marginTop: "auto",
              paddingTop: 12,
              lineHeight: 1.6,
            }}
          >
            {stats.paths} SVG paths · {stats.lines} {is2d ? "polylines" : "hatch lines"} · {stats.verts} vertices
            {renderTimeMs > 0 && <> · {renderTimeMs < 1000 ? `${Math.round(renderTimeMs)}ms` : `${(renderTimeMs / 1000).toFixed(1)}s`}</>}
            {isRendering && <> · <span style={{ color: "var(--fg-dim)" }}>rendering...</span></>}
            <br />
            Pipeline: {is2d
              ? "generate 2D \u2192 SVG"
              : <>UV hatch &rarr; 3D surface &rarr; project{useOcclusion ? " \u2192 depth clip" : ""}{densityFilterEnabled ? " \u2192 density" : ""} &rarr; SVG</>
            }
          </div>
        </div>

        {/* Side panel for composition + 3D controls (wide viewports, opt-in) */}
        {!isNarrow && controlsPanel === "side" && (comp.controls || !is2d) && (
          <div
            style={{
              width: 280,
              minWidth: 280,
              padding: "14px 18px",
              overflowY: "auto",
              overflowX: "hidden",
              borderRight: "1px solid var(--border)",
              fontSize: 11,
              display: "flex",
              flexDirection: "column",
              gap: 18,
              flexShrink: 0,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", color: "var(--fg-dim)" }}>
                {comp.name.toUpperCase()}
              </span>
              <div style={{ display: "flex", gap: 4 }}>
                <button
                  onClick={resetAllControls}
                  title="Reset all controls and macros to defaults"
                  style={{ ...tagStyle, fontSize: 9, padding: "2px 6px" }}
                >
                  Reset all
                </button>
                <button
                  onClick={() => setControlsPanel("inline")}
                  title="Dock controls back to main sidebar"
                  style={{ ...tagStyle, fontSize: 9, padding: "2px 6px" }}
                >
                  &larr; Dock
                </button>
              </div>
            </div>
            {comp.controls && (
              <CompositionControls
                controls={comp.controls}
                macros={comp.macros}
                hatchGroups={"hatchGroups" in comp ? (comp as Composition3DDefinition).hatchGroups : undefined}
                currentValues={currentValues}
                currentMacros={currentMacros}
                resolvedValues={resolvedValues}
                currentHatchGroups={currentHatchGroups}
                onControlChange={setCompValue}
                onMacroChange={setMacroValue}
                onHatchGroupChange={setHatchGroupValue}
                onResetMacros={resetMacros}
                onResetGroup={resetControlGroup}
                onResetAll={resetAllControls}
              />
            )}
            {!is2d && (
              <ThreeDControls
                hatchFamily={hatchFamily}
                setHatchFamily={(f) => setHatchFamily(f as HatchFamily)}
                hatchCount={hatchCount}
                setHatchCount={setHatchCount}
                hatchSamples={hatchSamples}
                setHatchSamples={setHatchSamples}
                hatchAngle={hatchAngle}
                setHatchAngle={setHatchAngle}
                useOcclusion={useOcclusion}
                setUseOcclusion={setUseOcclusion}
                depthRes={depthRes}
                setDepthRes={setDepthRes}
                depthBias={depthBias}
                setDepthBias={setDepthBias}
                showMesh={showMesh}
                setShowMesh={setShowMesh}
                camOrtho={camOrtho}
                setCamOrtho={setCamOrtho}
                camDist={camDist}
                setCamDist={setCamDist}
                camTheta={camTheta}
                setCamTheta={setCamTheta}
                camPhi={camPhi}
                setCamPhi={setCamPhi}
                panX={panX}
                setPanX={setPanX}
                panY={panY}
                setPanY={setPanY}
              />
            )}
          </div>
        )}

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
            position: "relative",
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
          {isRendering && (
            <div
              style={{
                position: "absolute",
                top: 12,
                right: 12,
                zIndex: 10,
                background: "var(--bg-panel)",
                border: "1px solid var(--border)",
                borderRadius: 4,
                padding: "4px 10px",
                fontSize: 10,
                fontWeight: 600,
                letterSpacing: "0.06em",
                color: "var(--fg-dim)",
              }}
            >
              Rendering...
            </div>
          )}
          <svg
            viewBox={`0 0 ${exportLayout.pageW} ${exportLayout.pageH}`}
            style={{
              maxWidth: "calc(100% - 24px)",
              maxHeight: "calc(100vh - 60px)",
              background: "var(--bg-canvas)",
              boxShadow: "0 1px 16px var(--shadow)",
              transform: `translate(${viewPanX}px, ${viewPanY}px) scale(${viewZoom})`,
              transformOrigin: "center center",
              opacity: isStale ? 0.6 : 1,
              transition: "opacity 0.15s ease",
            }}
          >
            <defs>
              <clipPath id="preview-margin-clip">
                <rect x={margin + clipInset} y={margin + clipInset} width={exportLayout.contentW - clipInset * 2} height={exportLayout.contentH - clipInset * 2} />
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

      <ExportModal
        open={exportModalOpen}
        onClose={() => setExportModalOpen(false)}
        onExportSVG={handleExportSVG}
        onExportPNG={handleExportPNG}
        onSendToQueue={isPrintQueueEnabled ? handleSendToQueue : undefined}
        currentTheme={theme}
      />
    </div>
  );
}

// ── Border path generation ──

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
      for (let tx = x + spacing; tx < x + w; tx += spacing) {
        paths.push(`M${tx},${y}V${y - tickLen}`);
        paths.push(`M${tx},${y + h}V${y + h + tickLen}`);
      }
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
        [`M${x - gap},${y}H${x - gap - markLen}`, `M${x},${y - gap}V${y - gap - markLen}`],
        [`M${x + w + gap},${y}H${x + w + gap + markLen}`, `M${x + w},${y - gap}V${y - gap - markLen}`],
        [`M${x - gap},${y + h}H${x - gap - markLen}`, `M${x},${y + h + gap}V${y + h + gap + markLen}`],
        [`M${x + w + gap},${y + h}H${x + w + gap + markLen}`, `M${x + w},${y + h + gap}V${y + h + gap + markLen}`],
      ];
      return corners.flat();
    }

    default:
      return [];
  }
}
