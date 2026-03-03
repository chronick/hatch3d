---
description: Research plotter art techniques, mathematical concepts, and generative art
argument-hint: "<topic> [--depth quick|deep]"
---

## Plotter Art Research

Follow these steps to research a topic and relate findings to hatch3d's capabilities:

1. **Adopt the researcher persona**: You are a methodical researcher with deep knowledge of generative art, computational geometry, and pen-plotter aesthetics. You balance mathematical rigor with artistic intuition. You cite sources and distinguish between established techniques and speculative ideas.

2. **Check existing knowledge base first**:
   - Read `docs/techniques/README.md` for the technique index
   - Search `docs/techniques/` for existing coverage of this topic
   - Search `docs/research/logs/` for previous research sessions on related topics
   - Read `docs/techniques/COMPOSITION-IDEAS.md` for the current composition inventory

3. **Survey the codebase for current implementation status**:
   - Check `src/surfaces.ts` for available parametric surfaces
   - Check `src/compositions/` for existing compositions that touch this topic
   - Check `src/hatch.ts` for available hatch families and parameters

4. **Research the topic via web search** (cast a wide net):
   - Search for the topic + "pen plotter" or "plotter art"
   - Search for the topic + "generative art" or "creative coding"
   - Search for mathematical foundations (papers, Wikipedia, Mathworld)
   - Search for Processing/p5.js/OpenFrameworks implementations
   - Search for artist references (who does this well?)
   - If neural-network related: search for "neural" + topic + "art generation"
   - Search Reddit r/PlotterArt, r/generativeart, r/creativecoding
   - Search for relevant GitHub repos with implementations

5. **Synthesize findings into categories**:
   - **Core Algorithm**: How does this technique work mathematically?
   - **Plotter Feasibility**: Can this produce clean vector paths for a pen plotter?
   - **Hatch3d Integration**: What would need to change or be added?
     - New surface function? New hatch family? New 2D composition generator? Engine change?
   - **Artist References**: Who does this well? Link to examples.
   - **Related Techniques**: What pairs well with this? What's adjacent?

6. **Write the research log** to `docs/research/logs/YYYY-MM-DD-<topic-slug>.md` using this format:

```markdown
# Research: <Topic>
**Date**: YYYY-MM-DD
**Depth**: quick | deep

## Summary
<2-3 sentence overview of findings>

## Sources
- [Source Title](URL) — <one-line note>
- ...

## Core Concepts
<Key algorithmic/mathematical concepts explained>

## Plotter Art Applications
<How this technique maps to pen plotter output>

## Hatch3d Integration Assessment
- **Difficulty**: trivial | moderate | significant | requires-engine-work
- **Type**: new-surface | new-2d-composition | new-hatch-family | engine-enhancement | technique-doc-only
- **Prerequisites**: <what needs to exist first>
- **Approach**: <brief implementation strategy>

## Artist References
- <Artist/Project> — <what they do with this technique>

## Open Questions
- <Things to investigate further>
```

7. **If the topic warrants a new technique doc**, draft it for `docs/techniques/<topic-slug>.md` following the existing format (see any file in that directory for the template).

8. **Summarize findings** for the user with:
   - Key takeaway (1-2 sentences)
   - Integration difficulty rating
   - Recommended next steps (implement? research more? combine with existing technique?)
