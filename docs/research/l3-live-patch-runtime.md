---
title: "L3 live patch runtime — survey, reproducibility proposal, recommendation"
created: 2026-07-08
task: vault-176t
status: complete
---

## Purpose

The L2 static patch (`src/patch/`) is a DAG of pure functions over Geometry/
Field signals: it compiles once, deterministically, to SVG, and every
intermediate node is inspectable and measurable by `stats`/`variability`.
L3 is the deferred next tier — a *live*, clocked, stateful runtime in the
TouchDesigner/Max/vvvv mold, where a composition runs continuously and you
can reach in and change it while it's running. The problem L3 must solve
before it's worth building: live execution is inherently non-deterministic
(wall-clock time, external input, continuous mutation), which breaks the
property that makes the whole L2 loop work — a scene doc that renders
byte-identically and that `stats` can measure. This doc surveys existing
live signal-flow tools, proposes a concrete reproducibility answer, assesses
react-reconciler as a substrate, and recommends whether to build L3 now.

---

## Survey — live signal-flow runtimes

| Tool | Clocking | Feedback | State | Hot-patching |
|---|---|---|---|---|
| **TouchDesigner** | Global cook rate (e.g. 60fps); cook-on-demand — a node only re-evaluates when an upstream input is dirty, not brute-force every frame | Explicit `Feedback TOP`/`Feedback CHOP` node holds one frame of delayed output; required to break a cook-graph cycle (an un-broken cycle is a network error, not silently allowed) | Lives in the feedback node's held buffer; most operators are otherwise pure per-cook | Edits apply live; cook graph re-evaluates incrementally, no recompile step |
| **Max/MSP** | `metro` (message-rate) or the audio-vector clock (signal-rate, MSP); message and signal domains have separate scheduling | Signal-rate cycles need an explicit delay (`history~`, or any object with vector latency) to avoid a zero-delay loop error; message-rate cycles use `send`/`receive` to defer by one event | Held inside stateful objects (`counter`, `history~`, custom externals) — object *instances* persist across bangs, not the patch as a whole | Patch keeps running while you add/remove/rewire objects; can click/glitch but never stops |
| **Pure Data** | Same model as Max (`metro`, signal vector clock) | Same `delay`/history-object requirement as Max | Same per-object instance state | Same live-edit model as Max |
| **vvvv** | Frame-based; VL (VVVV Lang) is compiled, and the runtime **hot-reloads recompiled assemblies while node state survives**, via a diff of the object graph across reloads | Explicit feedback nodes (delay-by-one-frame primitives), same "break the cycle explicitly" rule as TD/Max | Per-node instance state, preserved across hot-reload by the runtime's own diffing pass | Live, type-checked hot-reload — the most advanced precedent here: it's *diffing-based* state-preserving hot-patching of compiled code, not just interpreted-patch rewiring |
| **Cables.gl** | Browser rAF loop; WebGL-targeted | Feedback via explicit "loop" ops (e.g. render-to-texture ping-pong) | Per-op instance state (JS objects under the hood) | Live in-browser editing; can export/"compile out" to a standalone JS+GLSL bundle |
| **Notch** | Timeline + keyframes layered *on top of* the node graph, distinct from the graph's own per-frame cook | Explicit feedback/history blocks, same pattern as TD | Per-node/per-block state; blocks are reusable stateful subgraphs | Live editing during playback, broadcast/VFX-grade |
| **react-reconciler / react-three-fiber** | No intrinsic clock — `useFrame` taps `requestAnimationFrame` per commit; a fixed-step/manual-advance mode exists but isn't the default | No built-in feedback primitive — modeled by hand with `useRef` holding last-frame values | `useRef`/`useState`/custom hooks give per-instance persistent state, scoped to the component, cleanly | Reconciler diffing is exactly hot-patching: declarative "what should exist" → minimal imperative host mutations, proven at scale (this *is* what React Fast Refresh relies on) |

**What a plotter-oriented live patch would borrow:**

- **Clocking** — every tool bar react-three-fiber uses an explicit, global,
  steppable tick, not raw wall time. For hatch3d this generalizes L2's
  `repeat N` (a fixed unroll count) into a `tick()` primitive driven by an
  explicit counter rather than a fixed `N` — same "time as a bounded,
  explicit axis" idea, just resumable/steppable instead of run-to-completion.
- **Feedback** — TD, Max, Pd, vvvv, and Cables.gl all agree: cyclic graphs
  are *not* allowed implicitly. A dedicated `FeedbackNode` (holds one
  step of delayed state) is required to turn a cycle into a DAG-per-tick.
  This maps directly onto L2's existing `repeat`+`thread` pattern
  (`RepeatNode.thread` already threads one variable output→input across
  bounded iterations) — L3's feedback primitive is the same idea generalized
  from "N known iterations" to "one step per tick, indefinitely."
- **State** — object/node-instance persistence (Max/Pd/vvvv/TD) is the
  precedent for L3 nodes needing a lifecycle (create-once, mutate-per-tick)
  that L2 nodes don't have (L2 nodes are pure functions re-evaluated fresh
  on every compile).
- **Hot-patching** — vvvv's diff-based hot-reload is the strongest existing
  proof that *reconciler-style diffing* is a legitimate, shipped mechanism
  for state-preserving live patching — directly relevant to the
  react-reconciler question below.
- **What none of them solve** — none of these tools treat determinism/replay
  as a goal; they're built for live performance, where nondeterminism is a
  feature, not a bug. That constraint is specific to hatch3d's L3 and has no
  off-the-shelf answer in this survey — it has to be designed, which the
  next section does.

---

## Reproducibility proposal — freezing a live session back to L2

The core move: **L3 doesn't need its own persistence format.** L2 nodes are
pure functions of *values*, not of *time* — so freezing a live session is a
constant-folding pass over the live graph's current output values, re-emitted
as literal L2 nodes. Concretely:

1. **Virtual clock, not wall time.** An L3 session runs on an explicit tick
   counter. All randomness is seeded (as L2 already requires — `mulberry32`
   seeds every noise field). All external input (mouse, MIDI, a live
   parameter drag) is appended to an **event log** keyed by tick number
   instead of applied directly.
2. **Session = seed + event log + tick count.** Replaying the event log
   against the same seed from tick 0 reproduces the same run bit-for-bit.
   This is the same determinism guarantee L2 already has, generalized: L2 is
   the degenerate case of an L3 session with an empty event log.
3. **Freeze = evaluate once, re-emit as L2.** At any tick `T`, walk the live
   node graph and read each node's *current* output (its last computed
   Geometry/Field value). A `FeedbackNode` at tick `T` freezes to a literal
   constant carrying its accumulated state; a live-driven `generator` node
   freezes to an ordinary L2 `generator` node with params resolved at `T`.
   The output is a normal `PatchDocSchema` document — no new schema needed.
4. **Provenance, not new machinery.** Extend `PatchDocSchema` with an
   optional `provenance` field: `{ seed, tickAtFreeze, eventLogHash }`. A
   frozen doc is then traceable back to the live session that produced it,
   matching the same diffable/provenance-tracked property L2 already
   provides for AI-authored docs — L3 sessions become another *source* of
   L2 docs, not a parallel rendering path.

This means the freeze operation is small and reuses everything L2 already
has (schema, evaluator, stats/variability tooling) — the new work is
entirely in the live side (clock, event log, feedback primitive), not in
how a session becomes a plottable document.

---

## react-reconciler as the L3 substrate

**What it would save:** the tree-diff → minimal-host-mutation machinery is
exactly hot-patching, for free and proven at scale, instead of hand-rolled
incremental graph diffing. Hooks (`useRef`/`useState`, or a custom
`useFeedback()` wrapping the feedback primitive above) are a clean idiom for
per-node persistent state — the "state" requirement the survey surfaced
across every tool. `useFrame`-style clock tapping is also close to free,
though it needs to be re-pointed at the virtual/steppable clock from the
reproducibility proposal rather than raw `requestAnimationFrame`.

**What it would cost:**

- **New dependency, and a deliberate one to cross.** `react`/`react-dom` are
  already deps, but only for UI chrome — hatch3d's CLAUDE.md is explicit
  that "the art pipeline is kept out of React" (pure functions → SVG). Pulling
  `react-reconciler` in to drive patch *evaluation* crosses that line; this
  doc surfaces it rather than deciding it silently, per the vault's
  no-new-dependencies-without-a-note convention.
- **A custom host config is real engineering, not a wrapper.** A patch is a
  graph with arbitrary named references (a node consumed by two other
  nodes), not a parent-child tree — the same problem react-three-fiber
  solves by faking non-tree relationships through props (e.g.
  `<primitive object={sharedGeometry}/>`) rather than host-tree parenting.
  An L3 host config would need the same workaround: cables resolve by id
  through props/a side-registry, not through `appendChild`.
- **Determinism is not included.** The reconciler diffs trees; it has no
  opinion on time or replay. The virtual clock + event log from the
  reproducibility proposal is still fully bespoke work regardless of
  substrate — react-reconciler buys nothing here.
- **Freezing still needs a custom walk.** Hook state isn't serializable
  outside a running tree. `freeze()` would still need each host instance to
  register its current output into a side-registry on mount/update (fiber
  internals aren't a stable public API to walk), then read that registry —
  same snapshot mechanism as the non-reconciler design, just triggered by
  React's commit phase instead of a bespoke evaluator loop.
- **JSX turns docs into code.** Exactly the tradeoff `patch-model.md`
  already ruled out for L2 (loses constrained-decoding generation, schema
  validation, diffability) resurfaces for L3's authoring layer — it matters
  less here since a live session is human-driven interactively rather than
  LLM-authored turn-by-turn, but it's the same cost, not a new one.

**How a live JSX patch would snapshot to canonical JSON:** a `<PatchRoot
seed={9} tick={liveTick}>` renders `<Generator/>`, `<Distort/>`,
`<Feedback/>` components; each host-config instance computes its output via
the *same* pure functions L2 already has (`signals.ts`/`operators.ts`),
called once per tick instead of once total, and registers `{id,
currentOutput}` into a side-registry on commit. `freeze()` reads that
registry and re-emits it as `PatchDoc.nodes` — non-tree cable references
resolve by registry id, not by walking reconciler parent pointers.

---

## What L3 adds over L2 — concrete use cases, and the recommendation

**Where L2 genuinely falls short today:**

1. **Live-tweak-while-simulating.** L2's `repeat N` needs `N` fixed upfront
   — you guess an iteration count, render, and re-render until it looks
   right. This is a real, present cost for exactly the kind of generator
   already on the backlog (`patch-model.md`'s deferred field sources
   mention reaction-diffusion): a hard-to-pre-guess "how many steps until
   it looks good" process is the strongest concrete case for interactivity.
2. **Live external CV.** A MIDI knob or audio input driving `amp`/`scale` in
   real time would make the eurorack metaphor literal, not just structural.
3. **Open-ended feedback exploration.** Feeding `density()` back into
   `distort()` every tick and watching a composition self-organize, then
   freezing at a stable-looking point, instead of L2's `repeat`+`thread`
   requiring the iteration count to already be known.

**Recommendation: stay L2 + snapshot. Do not build L3 yet.**

- Use case 1 (the only one with a concrete, already-identified consumer) is
  cheaper to solve without a live runtime at all: add a **step-emit mode**
  to `evalPatch`'s existing `repeat` handling — capture the env's node
  outputs after each pass (the loop already computes them; they're just
  discarded today) and emit them as a scrubbable sequence of ordinary L2
  docs. That gets the "reach in and pick the good frame" value with zero new
  dependencies, zero new determinism problems (it's still one pure compile),
  and it's directly measurable by the existing `stats` tooling. This is the
  concrete, scoped follow-up this research recommends filing.
- Use case 2 (live CV) doesn't need a clocked/stateful *runtime* either — it
  needs a live *input source*, which fits the existing Field model as-is:
  sample the input once at render time into a scalar/vector field constant.
  A thin bridge, not an engine.
- Use case 3 (open-ended feedback) is the one case that would genuinely
  need L3's unbounded/interactive loop — but it's speculative today (no
  composition in the current registry needs it) and should wait for a
  concrete consumer (e.g. when reaction-diffusion actually lands) rather
  than building the runtime ahead of a use case.
- If/when a concrete case for full L3 does arrive, react-reconciler is the
  right starting substrate to prototype against — proven diffing, a clean
  hooks idiom for per-node state, and vvvv's hot-reload is real-world proof
  the pattern works for stateful live graphs. But budget for a genuine
  custom host config (non-tree references) and do not expect
  determinism/freeze "for free" from the reconciler — that work is the same
  size regardless of which substrate is chosen.

---

## Out of scope for v1 (this research pass)

- Implementing the step-emit mode, the virtual clock, the event log, or any
  runtime code — this is a research write-up, not a build.
- Picking concrete tick rates, feedback-node buffer depths, or event-log
  serialization formats.
- A decision on whether L3's authoring layer (if ever built) is JSX, the
  existing DSL extended with live keywords, or something else — deferred to
  whenever a concrete L3 build is scoped.
- Prototyping react-reconciler's custom host config — recommended only as
  the starting point *if* L3 is later greenlit.

## Source references

- `active/plotter-art-workflow/design/patch-model.md` — L2 design rationale,
  the JSX/React consideration section, and the tier definitions this doc
  extends
- `src/patch/graph.ts` — `RepeatNode`/`evalNode` — the bounded-iteration and
  thread-variable pattern L3's feedback/tick model generalizes
- `src/patch/signals.ts` — Field/Geometry signal types and seeded
  determinism (`mulberry32`) — the reproducibility baseline L3 must preserve
- `docs/research/variability-metrics.md` — prior research doc format/style
  precedent in this repo
