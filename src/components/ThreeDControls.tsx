import { memo } from "react";
import { tagStyle } from "./styles";
import { Section } from "./Section";
import { Slider } from "./Slider";
import { Toggle } from "./Toggle";
import { HatchFamilySelect } from "./HatchFamilySelect";
import { HoverReset } from "./HoverReset";
import { OrbitCube } from "./OrbitCube";
import { XYPad } from "./XYPad";

type HatchFamily = "u" | "v" | "diagonal" | "rings" | "hex" | "crosshatch" | "spiral";

export interface ThreeDControlsProps {
  // Hatching
  hatchFamily: HatchFamily;
  setHatchFamily: (f: HatchFamily) => void;
  hatchCount: number;
  setHatchCount: (v: number) => void;
  hatchSamples: number;
  setHatchSamples: (v: number) => void;
  hatchAngle: number;
  setHatchAngle: (v: number) => void;
  // Occlusion
  useOcclusion: boolean;
  setUseOcclusion: (v: boolean) => void;
  depthRes: number;
  setDepthRes: (v: number) => void;
  depthBias: number;
  setDepthBias: (v: number) => void;
  // Show mesh
  showMesh: boolean;
  setShowMesh: (v: boolean) => void;
  // Camera
  camOrtho: boolean;
  setCamOrtho: (v: boolean) => void;
  camDist: number;
  setCamDist: (v: number) => void;
  camTheta: number;
  setCamTheta: (v: number) => void;
  camPhi: number;
  setCamPhi: (v: number) => void;
  panX: number;
  setPanX: (v: number) => void;
  panY: number;
  setPanY: (v: number) => void;
}

export const ThreeDControls = memo(function ThreeDControls(props: ThreeDControlsProps) {
  const {
    hatchFamily, setHatchFamily,
    hatchCount, setHatchCount,
    hatchSamples, setHatchSamples,
    hatchAngle, setHatchAngle,
    useOcclusion, setUseOcclusion,
    depthRes, setDepthRes,
    depthBias, setDepthBias,
    showMesh, setShowMesh,
    camOrtho, setCamOrtho,
    camDist, setCamDist,
    camTheta, setCamTheta,
    camPhi, setCamPhi,
    panX, setPanX,
    panY, setPanY,
  } = props;

  return (
    <>
      <Section title="HATCHING" preview={`${hatchFamily} \u00b7 ${hatchCount} lines`}>
        <HatchFamilySelect
          value={hatchFamily}
          onChange={(f) => setHatchFamily(f as HatchFamily)}
        />
        <Slider label="Count" value={hatchCount} onChange={setHatchCount} min={5} max={80} step={1} />
        <Slider label="Samples" value={hatchSamples} onChange={setHatchSamples} min={10} max={120} step={1} />
        {(hatchFamily === "diagonal" || hatchFamily === "crosshatch") && (
          <Slider label="Angle" value={hatchAngle} onChange={setHatchAngle} min={0} max={Math.PI} step={0.01} />
        )}
      </Section>

      <Section title="OCCLUSION" preview={useOcclusion ? `${depthRes}px` : "off"}>
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
            <Slider label="Bias" value={depthBias} onChange={setDepthBias} min={0.0001} max={0.005} step={0.0001} />
          </>
        )}
      </Section>

      <Section title="DISPLAY" preview={`mesh ${showMesh ? "on" : "off"}`}>
        <Toggle label="Show mesh" value={showMesh} onChange={setShowMesh} />
      </Section>

      <Section title="CAMERA" preview={`\u03B8${camTheta.toFixed(2)} \u03C6${camPhi.toFixed(2)} d${camDist.toFixed(0)}`}>
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
        <Slider label="Orbit \u03B8" value={camTheta} onChange={setCamTheta} min={-Math.PI} max={Math.PI} step={0.01} />
        <Slider label="Orbit \u03C6" value={camPhi} onChange={setCamPhi} min={-1.4} max={1.4} step={0.01} />
        <div style={{ color: "var(--fg-faint)", fontSize: 10, marginTop: 2 }}>
          Preview: drag to pan · pinch to zoom · dbl-click fit
        </div>
      </Section>
    </>
  );
});
