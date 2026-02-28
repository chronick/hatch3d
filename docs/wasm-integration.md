# Rust/WASM Composition Integration

How to add high-performance Rust compositions to hatch3d via WebAssembly.

## Architecture

```
┌─────────────────────┐     ┌──────────────────────┐
│  Rust Crate          │     │  TypeScript Wrapper   │
│  src/wasm/src/       │────▶│  src/compositions/    │
│  - Surface functions │     │    3d/my-comp.ts      │
│  - Layer generators  │     │  (imports .wasm,      │
│  - Pure math only    │     │   adapts to           │
│                      │     │   CompositionDef)     │
└─────────────────────┘     └──────────────────────┘
        │ wasm-pack build              │
        ▼                              ▼
   pkg/*.wasm + *.d.ts         compositionRegistry
```

The plugin architecture already supports WASM. A Rust composition is just a `.ts` wrapper file in `src/compositions/3d/` that imports a `.wasm` module and exports a standard `CompositionDefinition`. The registry's `import.meta.glob` auto-discovers it like any other composition.

## Two Integration Modes

### Mode 1: WASM Surface Functions (simpler)

Rust provides `evaluate_surface(u, v, params) → [x, y, z]`. The existing TS pipeline handles hatch generation, projection, and occlusion as normal. Good for complex surfaces where JS is slow (ray-marched implicits, high-order polynomials).

```rust
#[wasm_bindgen]
pub fn evaluate_surface(
    surface_id: &str,
    u: f64, v: f64,
    params: &[f64],       // flat array: [param0, param1, ...]
) -> Box<[f64]> {         // returns [x, y, z]
    match surface_id {
        "vortex" => vortex_surface(u, v, params),
        _ => Box::new([0.0, 0.0, 0.0]),
    }
}
```

### Mode 2: WASM Full Layer Generation (faster)

Rust generates all hatch polylines in one batch call and returns pre-computed 3D points. The TS pipeline only does projection + occlusion. Good for compositions with thousands of polylines or custom hatch patterns.

```rust
#[wasm_bindgen]
pub fn my_composition_layers(
    controls: &[f64],     // flattened control values
    hatch_family: u8,     // 0=u, 1=v, 2=diagonal, etc.
    hatch_count: u32,
    hatch_samples: u32,
) -> Box<[f64]> {
    // pure Rust math — no JS interop during computation
    let mut output = Vec::new();
    // ... generate hatch lines ...
    output.into_boxed_slice()
}
```

## TypeScript Wrapper Pattern

Each Rust composition gets a thin TS wrapper:

```typescript
// src/compositions/3d/my-rust-comp.ts
import type { Composition3DDefinition } from "../types";
import init, { my_composition_layers } from "../../wasm/pkg/hatch3d_wasm";

let wasmReady: Promise<void> | null = null;
function ensureWasm() {
  if (!wasmReady) wasmReady = init();
  return wasmReady;
}

const myRustComp: Composition3DDefinition = {
  id: "myRustComp",
  name: "My Rust Comp",
  description: "High-performance composition (Rust/WASM)",
  tags: ["wasm", "geometric"],
  category: "3D/Geometric",
  controls: {
    // Controls defined in TS (plain data, no WASM needed)
    depth: { type: "slider", label: "Depth", default: 5, min: 1, max: 20, group: "Structure" },
  },
  layers: (input) => {
    // Return standard LayerConfig[] — the WASM call happens
    // during surface evaluation or as a pre-compute step
    return [{ surface: "hyperboloid", hatch: input.hatchParams }];
  },
};
export default myRustComp;
```

## Data Serialization Protocol

All data crosses the JS↔WASM boundary as flat typed arrays:

**Input** (TS → WASM):
```
Float64Array: [control_0, control_1, ..., control_n]
```

**Output** (WASM → TS):
```
Float64Array: [
  num_layers,
  // per layer:
  num_polylines,
  // per polyline:
  num_points,
  x0, y0, z0, x1, y1, z1, ..., xN, yN, zN,
]
```

## Rust Crate Structure

```
src/wasm/
  Cargo.toml
  src/
    lib.rs              # wasm-bindgen entry point
    surfaces.rs         # parametric surface functions
    compositions/
      mod.rs
      my_comp.rs
  pkg/                  # wasm-pack output (gitignored)
```

### Cargo.toml

```toml
[package]
name = "hatch3d-wasm"
version = "0.1.0"
edition = "2021"

[lib]
crate-type = ["cdylib", "rlib"]

[dependencies]
wasm-bindgen = "0.2"

[profile.release]
opt-level = "s"
lto = true
```

## Build Integration

Add to `package.json`:

```json
{
  "scripts": {
    "wasm:build": "cd src/wasm && wasm-pack build --target web --out-dir pkg",
    "wasm:dev": "cd src/wasm && wasm-pack build --target web --out-dir pkg --dev"
  }
}
```

Add to `vite.config.ts`:

```typescript
export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    exclude: ["hatch3d-wasm"],
  },
  build: {
    target: "esnext",
  },
});
```

## Existing TypeScript Interface

`CompositionWasmAdapter` in `src/compositions/types.ts` defines the contract:

```typescript
export interface CompositionWasmAdapter {
  computeLayers(inputBuffer: Float64Array): Float64Array;
  inputLayout: { name: string; offset: number; type: "f64" | "i32" }[];
  outputLayout: { name: string; offset: number; type: "f64" | "i32" }[];
}
```

## Performance Expectations

| Operation | JS | Rust/WASM |
|---|---|---|
| Surface eval (per point) | ~0.001ms | ~0.0001ms (10x) |
| Hatch gen (1000 lines x 64 samples) | ~50ms | ~5ms (10x) |
| Full composition render | ~100-200ms | ~20-40ms (5-10x) |

The biggest win is batch processing — Rust evaluates thousands of points without crossing the FFI boundary per-point.

## Implementation Checklist

When ready to add WASM compositions:

1. [ ] Create `src/wasm/` Rust crate with wasm-pack
2. [ ] Add `wasm:build` / `wasm:dev` scripts to package.json
3. [ ] Configure Vite for WASM imports (`optimizeDeps.exclude`, `build.target`)
4. [ ] Implement one example composition in Rust as proof of concept
5. [ ] Write TS wrapper in `src/compositions/3d/`
6. [ ] Add deserialize helper for the flat f64 output format
7. [ ] Add WASM-specific tests
8. [ ] Profile and optimize the serialization boundary
