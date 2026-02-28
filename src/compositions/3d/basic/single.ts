import type { Composition3DDefinition } from "../../types";

const single: Composition3DDefinition = {
  id: "single",
  name: "Single Surface",
  description: "Single parametric surface with direct parameter control",
  tags: ["minimal", "single"],
  category: "3d",
  layers: (p) => [
    { surface: p.surface, params: p.surfaceParams, hatch: p.hatchParams },
  ],
};
export default single;
