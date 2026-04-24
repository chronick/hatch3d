type HatchFamily = "u" | "v" | "diagonal" | "rings" | "hex" | "crosshatch" | "spiral";

export interface HatchGroupConfig {
  family: "inherit" | HatchFamily;
  count: number;
  samples: number;
  angle: number;
}

export const HATCH_GROUP_DEFAULT: HatchGroupConfig = {
  family: "inherit",
  count: 30,
  samples: 50,
  angle: 0.7,
};
