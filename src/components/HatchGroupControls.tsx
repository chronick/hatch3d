import { Slider } from "./Slider";
import { HatchFamilySelect } from "./HatchFamilySelect";
import type { HatchGroupConfig } from "./HatchGroupControls.types";

export function HatchGroupControls({
  groupName,
  config,
  onChange,
}: {
  groupName: string;
  config: HatchGroupConfig;
  onChange: (groupName: string, config: HatchGroupConfig) => void;
}) {
  const isOverride = config.family !== "inherit";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      <HatchFamilySelect
        value={config.family}
        onChange={(f) => onChange(groupName, { ...config, family: f as HatchGroupConfig["family"] })}
        includeInherit
      />
      {isOverride && (
        <>
          <Slider label="Count" value={config.count} onChange={(v) => onChange(groupName, { ...config, count: Math.round(v) })} min={5} max={80} step={1} />
          <Slider label="Samples" value={config.samples} onChange={(v) => onChange(groupName, { ...config, samples: Math.round(v) })} min={10} max={120} step={1} />
          {(config.family === "diagonal" || config.family === "crosshatch") && (
            <Slider label="Angle" value={config.angle} onChange={(v) => onChange(groupName, { ...config, angle: v })} min={0} max={Math.PI} step={0.01} />
          )}
        </>
      )}
    </div>
  );
}
