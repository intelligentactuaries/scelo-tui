# scelo-tui

Experimental three-pane terminal workstation for Scelo. Drop data in; the
agent does the rest.

```
┌─ SOFT · data ──────┬─ TOOLS · models ───┬─ HARD · output ────┐
│ file(s)            │ pipeline           │ table              │
│  └ policies.csv    │  ✓ read file       │  level count share │
│  900 rows × 6 cols │  ✓ auto-clean      │  …                 │
│                    │  ✓ understand      │                    │
│ summary            │  ✓ choose analysis │ plot               │
│  cleaned: 5 steps  │  ✓ run             │  ███████████ 449   │
│  dropped: Notes    │                    │  █████ 236         │
│                    │ chosen             │                    │
│ <agent's reading>  │  <rationale>       │                    │
├────────────────────┼────────────────────┼────────────────────┤
│ Bot(S)             │ Bot(T)             │ Bot(H)             │
└────────────────────┴────────────────────┴────────────────────┘
```

**Status: walking skeleton.** It runs end to end and is worth using to judge
the idea, not to do work with.

## Run

```bash
bun install
bun run src/main.tsx path/to/data.csv     # or start bare and paste a path
```

Needs a local model on `:11434`. Defaults to `qwen2.5:7b-instruct-q4_K_M`
because three chat panes on one screen make latency matter more than prose;
`SCELO_TUI_MODEL=gemma3:27b` for better writing at ~4x the wait.

Without a model the pipeline still ingests, profiles and cleans — the
narrative and the bots go inert and say so, rather than showing empty boxes
that look like a bug.

Needs a terminal at least 140 columns wide. Below that it refuses to draw the
three-pane layout and tells you, instead of rendering an unreadable mess.

## The idea

Chat does not start work. Dropping a file does. The agent ingests, cleans to a
fixed point, reads the data, picks an analysis, runs it, and fills the three
panes as each stage lands. The bots are for **changing what it decided** —
which is why every pane states what was done and why.

Terminals have no drag-and-drop of their own: what happens when you drag a
file onto one is that the emulator pastes its path. `normaliseDroppedPath`
handles the three shapes emulators produce (quoted, `file://`, backslash
escaped), so the gesture works.

## Layout

```
@scelo/core                profiling, typing, coercion, filtering (shared)
src/core/     cleaning.ts  the multi-pass auto-clean engine
              csvParse.ts  delimiter sniffing + parsing
              ingest.ts    path normalisation, file -> Dataset
src/agent/    llm.ts       direct-to-Ollama, one-shot + streaming
              pipeline.ts  the automatic run, and the model menu
src/ui/       widgets.tsx  Pane, Table, BarPlot, Prose
              Chat.tsx     one bot, instantiated per pane
src/App.tsx                the three-pane shell
```

## Shared core, not vendored

`@scelo/core` is a workspace package in the Scelo repo
(`packages/scelo-core`), consumed here over a `file:` dependency. Profiling,
typing, coercion and filtering have exactly one definition, so the two
projects cannot drift.

It used to live inside a 5,000-line React component, which meant 25 modules
imported from a `.tsx` just to get a type and nothing outside the browser
build could use any of it. The boundary is now "does it touch React, the DOM
or ECharts" — `usePalette`, `tooltipFrame` and `sniffDelimitedText` (needs
`Blob`) stayed behind; everything else runs under Bun unchanged.

If you move the Scelo checkout, update the `file:` path in `package.json`.

## Not built yet

- Only three analyses in the menu; Scelo's real catalog is ~30.
- No swarm.
- No session persistence — state dies with the process.
- Chat history is per-pane and per-session; it is not persisted.
- No scrollback in the panes; you see the tail.
- One dataset at a time, despite the `D₁…Dₙ` in the sketch.
