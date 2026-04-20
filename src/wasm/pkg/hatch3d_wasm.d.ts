/* tslint:disable */
/* eslint-disable */

/**
 * Main entry point: generate all layers in a single WASM call.
 *
 * Input: flat f64 slice following the input protocol above.
 * Output: flat f64 slice following the output protocol above.
 */
export function generate_all_layers(input: Float64Array): Float64Array;

/**
 * WASM entry point for flow field.
 */
export function generate_flow_field(input: Float64Array): Float64Array;

export function generate_grains_glitch_ca(input: Float64Array): Float64Array;

/**
 * WASM entry point for ink vortex.
 */
export function generate_ink_vortex(input: Float64Array): Float64Array;

/**
 * WASM entry point for reaction-diffusion.
 *
 * Input: `[width, height, N, iterations, f, k, dA, dB, threshold, levels, seedPatternId]`
 * Output: 2D polyline protocol
 */
export function generate_reaction_diffusion(input: Float64Array): Float64Array;

/**
 * WASM entry point for voronoi texture.
 */
export function generate_voronoi(input: Float64Array): Float64Array;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly generate_voronoi: (a: number, b: number) => [number, number];
    readonly generate_all_layers: (a: number, b: number) => [number, number];
    readonly generate_flow_field: (a: number, b: number) => [number, number];
    readonly generate_ink_vortex: (a: number, b: number) => [number, number];
    readonly generate_reaction_diffusion: (a: number, b: number) => [number, number];
    readonly generate_grains_glitch_ca: (a: number, b: number) => [number, number];
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
