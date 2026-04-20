/**
 * Load all compositions into the registry without import.meta.glob (Vite-specific).
 * This file explicitly imports every composition for Node.js CLI usage.
 */

import { compositionRegistry } from "../src/compositions/registry.js";
import type { CompositionDefinition } from "../src/compositions/types.js";

// 3D compositions
import single from "../src/compositions/3d/basic/single.js";
import crystalLattice from "../src/compositions/3d/geometric/crystal-lattice.js";
import doubleRing from "../src/compositions/3d/geometric/double-ring.js";
import nestedShells from "../src/compositions/3d/geometric/nested-shells.js";
import starburst from "../src/compositions/3d/geometric/starburst.js";
import vortexTunnel from "../src/compositions/3d/geometric/vortex-tunnel.js";
import totemStack from "../src/compositions/3d/architectural/totem-stack.js";
import towerAndBase from "../src/compositions/3d/architectural/tower-and-base.js";
import crystalSpire from "../src/compositions/3d/organic/crystal-spire.js";
import phyllotaxisGarden from "../src/compositions/3d/organic/phyllotaxis-garden.js";
import ribbonCage from "../src/compositions/3d/organic/ribbon-cage.js";
import dnaHelix from "../src/compositions/3d/scientific/dna-helix.js";
import atmosphericDepth from "../src/compositions/3d/studies/atmospheric-depth.js";
import engravingStudy from "../src/compositions/3d/studies/engraving-study.js";
import explodedView from "../src/compositions/3d/studies/exploded-view.js";
import multiTechnique from "../src/compositions/3d/studies/multi-technique.js";

// 2D compositions
import differentialGrowth from "../src/compositions/2d/generative/differential-growth.js";
import flowField from "../src/compositions/2d/generative/flow-field.js";
import growthOnSurface from "../src/compositions/2d/generative/growth-on-surface.js";
import kmeansHullCity from "../src/compositions/2d/generative/kmeans-hull-city.js";
import inkVortex from "../src/compositions/2d/generative/ink-vortex.js";
import photoHalftone from "../src/compositions/2d/generative/photo-halftone.js";
import reactionDiffusion from "../src/compositions/2d/generative/reaction-diffusion.js";
import strangeAttractor from "../src/compositions/2d/generative/strange-attractor.js";
import tspArt from "../src/compositions/2d/generative/tsp-art.js";
import voronoiTexture from "../src/compositions/2d/generative/voronoi-texture.js";
import waterArcos from "../src/compositions/2d/generative/water-arcos.js";
import opArtSphere from "../src/compositions/2d/optical/op-art-sphere.js";
import guillocheRosette from "../src/compositions/2d/patterns/guilloche-rosette.js";
import hilbertFill from "../src/compositions/2d/patterns/hilbert-fill.js";
import moireCircles from "../src/compositions/2d/patterns/moire-circles.js";
import spirograph from "../src/compositions/2d/patterns/spirograph.js";
import truchetMaze from "../src/compositions/2d/patterns/truchet-maze.js";

const allCompositions: CompositionDefinition[] = [
  // 3D
  single, crystalLattice, doubleRing, nestedShells, starburst, vortexTunnel,
  totemStack, towerAndBase, crystalSpire, phyllotaxisGarden, ribbonCage,
  dnaHelix, atmosphericDepth, engravingStudy, explodedView, multiTechnique,
  // 2D
  differentialGrowth, flowField, growthOnSurface, inkVortex, kmeansHullCity,
  photoHalftone, reactionDiffusion, strangeAttractor, tspArt, voronoiTexture, waterArcos,
  opArtSphere, guillocheRosette, hilbertFill, moireCircles, spirograph, truchetMaze,
];

export function loadCompositions(): void {
  for (const comp of allCompositions) {
    if (comp?.id) {
      compositionRegistry.register(comp);
    }
  }
}
