import { selectStyle } from "./styles";

type HatchFamily = "u" | "v" | "diagonal" | "rings" | "hex" | "crosshatch" | "spiral";

const HATCH_FAMILIES: { value: HatchFamily; label: string }[] = [
  { value: "u", label: "U-const" },
  { value: "v", label: "V-const" },
  { value: "diagonal", label: "Diagonal" },
  { value: "rings", label: "Rings" },
  { value: "hex", label: "Hex" },
  { value: "crosshatch", label: "Cross" },
  { value: "spiral", label: "Spiral" },
];

export { HATCH_FAMILIES };

export function HatchFamilySelect({
  value,
  onChange,
  includeInherit = false,
}: {
  value: string;
  onChange: (v: string) => void;
  includeInherit?: boolean;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={selectStyle}
    >
      {includeInherit && <option value="inherit">Global (inherit)</option>}
      {HATCH_FAMILIES.map((f) => (
        <option key={f.value} value={f.value}>{f.label}</option>
      ))}
    </select>
  );
}
