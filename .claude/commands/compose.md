---
description: Design and implement a new composition using research-create-critique pipeline
argument-hint: "<theme-or-concept> [--skip-research] [--2d|--3d]"
---

## Composition Workshop

This is the full creative pipeline for designing and implementing a new hatch3d composition. It orchestrates three phases: Research, Create, and Critique.

---

### Phase 1: Research (Researcher Agent)

1. **Parse the user's concept**: Extract the theme, technique references, constraints, and desired output type (2d/3d).

2. **Quick research pass** (skip with `--skip-research` if the topic is well-covered in `docs/techniques/`):
   - Read relevant technique docs from `docs/techniques/`
   - Check `docs/research/logs/` for existing research
   - If the topic is novel or under-researched, do a focused web search:
     - The concept + "plotter art" / "generative art"
     - Mathematical foundations if applicable
     - Artist references and existing implementations
   - Write a brief research log to `docs/research/logs/YYYY-MM-DD-<topic>.md`

3. **Inventory available building blocks**:
   - Read `src/surfaces.ts` — available surfaces and their parameters
   - Read `src/hatch.ts` (the HatchParams type) — available families and post-processing
   - Scan `src/compositions/` for related compositions to learn from (don't duplicate)
   - Read `src/compositions/types.ts` for the type system
   - Read `src/compositions/helpers.ts` and `src/compositions/helpers-density.ts` for available helper functions

---

### Phase 2: Create (Creator Agent)

4. **Adopt the creator persona**: Bold, experimental, thinks in layers and textures. Favors what will look striking on paper.

5. **Design the composition** — produce a complete design document:

   ```markdown
   ## Composition Design: <Name>

   **ID**: camelCase identifier
   **Type**: 2d | 3d
   **Category path**: compositions/[2d|3d]/<category>/
   **Description**: <one-line for metadata>

   ### Artistic Intent
   <What should this look and feel like? What's the vibe?>

   ### Technical Approach
   - **Surfaces used**: <list with param ranges>
   - **Layers**: <count, roles, how they interact>
   - **Hatch families**: <which families, why>
   - **Key algorithms**: <any math beyond standard pipeline>

   ### Controls
   | Name | Type | Default | Range | Group | Purpose |
   |------|------|---------|-------|-------|---------|
   | ... | slider/toggle/select/xy | ... | ... | ... | ... |

   ### Macros
   | Name | Default | Targets | Purpose |
   |------|---------|---------|---------|
   | ... | ... | ... | ... |

   ### Layer Generation Logic
   <Pseudocode or description of the layers() or generate() function>
   ```

6. **Check feasibility**: Can this be built with existing surfaces and hatch families? If not, note what's missing.

---

### Phase 3: Critique (Critic Agent)

7. **Adopt the critic persona**: Discerning, constructive, thinks about the viewer's experience and plotter realities.

8. **Evaluate the design** on the 6 axes:
   - Visual Composition, Line Quality, Parameter Space, Technical Soundness, Novelty, Plotter Feasibility
   - Score each 1-10 with reasoning

9. **Suggest improvements**: Be specific and actionable. The creator should be able to incorporate these directly.

---

### Phase 4: Refine & Implement

10. **Incorporate critique**: Revise the design based on the critic's feedback. Note what changed and why.

11. **Implement the composition**:
    - Create the file at `src/compositions/[2d|3d]/<category>/<name>.ts`
    - Follow the exact patterns from existing compositions (import types, export default)
    - Ensure all controls have proper type annotations and ranges
    - Add meaningful tags for the composition browser

12. **Verify the implementation**:
    - Run `npx vitest run src/__tests__/compositions-meta.test.ts` to check metadata validity
    - Run `npx vitest run src/__tests__/registry.test.ts` to verify registry loads it
    - Run `npm run build` to verify no type errors

13. **Update docs**:
    - Add the new composition to `docs/techniques/COMPOSITION-IDEAS.md` if it represents a new technique combination
    - If a new technique was researched, ensure `docs/techniques/` has coverage

14. **Present the result**:
    - Show the composition design summary
    - Show critic scores (before and after refinement)
    - Note any follow-up ideas that emerged during the process
    - Suggest 2-3 parameter settings worth trying first
