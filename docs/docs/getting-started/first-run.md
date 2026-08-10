# First run

```bash
scelo                       # start bare, then drag a file in or paste a path
scelo data.csv              # relative paths resolve against YOUR cwd
scelo ~/work/policies.csv
scelo data.csv --no-intro   # skip the picker, use the saved model
```

## The model picker

It opens here, and it **probes every provider rather than guessing**, so what
you see is what it can actually reach right now.

```text
 scelo · choose a model

 OLLAMA http://localhost:11434 · ready
   gemma3:27b
 ▸ qwen2.5:7b-instruct-q4_K_M · in use

 ANTHROPIC claude api · no key
   claude-opus-5 · most capable · the default
   claude-fable-5 · highest capability tier · 2× opus price, longer turns
   claude-sonnet-5 · near-opus, faster and cheaper
   claude-haiku-4-5 · fastest, cheapest
   claude-opus-4-8 · previous opus
   no api key — press k · console.anthropic.com → api keys (or run `ant auth login`)

 OPENAI api.openai.com · no key
   no api key — press k · platform.openai.com → api keys

 GOOGLE gemini · no key
   no api key — press k · aistudio.google.com → get api key

 OPENROUTER everything else · no key
   no api key — press k · openrouter.ai → keys

 ↑↓ move · ⏎ start · k api key · x forget key · m type an id · r recheck · q quit
```

The cursor starts on the model you used last, so **returning is a single
keypress**. `ctrl-o` reopens the picker later.

| key | does |
|---|---|
| ++up++ ++down++ | move |
| ++enter++ | start with the highlighted model |
| ++k++ | store an API key for this provider |
| ++x++ | forget the stored key |
| ++m++ | type a model id by hand |
| ++r++ | re-probe every provider |
| ++q++ | quit |

Keys are masked as you type and never printed back. See
[Models](../guide/models.md) for where they are stored and which environment
variables are read.

!!! note "Reopening the picker re-runs the pipeline"
    `ctrl-o` mid-session remounts the app, so the loaded dataset is read again
    from the start. A new model reading the data itself is defensible, but be
    aware it is what happens.

## Getting data in

Four ways, all equivalent once the file lands:

**On the command line.** `scelo policies.csv`. Relative paths resolve against
your working directory, not the repo's.

**Drag the file onto the terminal.** Terminals have no drag-and-drop of their
own: what actually happens is that the emulator pastes the path. The TUI handles
the three shapes emulators produce, quoted, `file://` and backslash-escaped, so
the gesture works anyway.

**Paste a path** into any pane's chat box and press ++enter++.

**`/files`** opens a picker of the data files under the current directory, no
dragging needed. Typing filters it.

**`/example`** loads one of the IDE's bundled sample datasets, which is the
fastest way to see the thing work with no data of your own:

```text
the IDE's bundled samples
▸ 1. Synthetic claims
  2. Climate reanalysis ensemble
  3. Messy intake (dirty demo)
  4. WMTR · forecast scenarios
  5. Lifelib · model points
  6. Workspace demo
  79×10 · P&C reserving / pricing demo
  ↑↓ move · ⏎ pick · esc cancel
```

`/example dirty` loads the messy one directly, which is the one to reach for if
you want to watch [auto-clean](../guide/pipeline.md#auto-clean) actually do
something.

## What happens next

You do not have to ask. The moment a file lands the
[pipeline](../guide/pipeline.md) runs: read, auto-clean, understand, choose an
analysis, run it. Each stage fills its part of the screen as it lands, and the
header names the stage currently working along with how long it has been at it.

From there, everything is [steering](../guide/chat.md).
