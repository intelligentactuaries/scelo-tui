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

**Status: working prototype.** Drop a file in, the agent profiles, cleans,
reads and analyses it; steer it in chat; export the session to Python,
Jupyter, R, Excel and the Scelo IDE in one command.

## Install

**Prerequisite: the `scelo` repo checked out as a sibling.** `@scelo/core`
is consumed over a `file:` path (`../scelo/packages/scelo-core`), so
`bun install` fails here without it. That is deliberate — see *Shared core,
not vendored* below — but it means the two repos are cloned together:

```bash
git clone git@github.com:intelligentactuaries/scelo.git
git clone git@github.com:intelligentactuaries/scelo-tui.git
cd scelo-tui
```

Then:

```bash
bun install
bun link            # puts `scelo` on your PATH via ~/.bun/bin
```

`bun link` symlinks the live source, so edits take effect on the next run —
there is no build step and nothing to reinstall.

If your `scelo` checkout lives somewhere else, point the `file:` path in
`package.json` at it.

## Run

```bash
scelo                       # start bare, then drag a file in or paste a path
scelo data.csv              # relative paths resolve against YOUR cwd
scelo ~/work/policies.csv
scelo data.csv --no-intro   # skip the picker, use the saved model
```

It opens on the model picker, which probes every provider and shows you what
it can actually reach. `⏎` starts with the highlighted model — the cursor
begins on the one you used last, so returning is a single keypress. `ctrl-o`
reopens the picker later.

Needs a terminal at least 140 columns wide. Below that it refuses to draw the
three-pane layout and tells you, instead of rendering an unreadable mess.

## Chat is the steering wheel

The pipeline runs itself; the bots exist to **change what it decided**, and
the deterministic parts of that work with or without a model:

```
/example              opens a pick-list of the IDE's bundled samples
/example dirty        load one directly — "load example data" also works
/list                 the analyses that apply to this data (numbered)
/run gini             switch the analysis — the HARD pane re-renders
/run 3                same, by menu number
/show premium         one column's profile as a card
/export               everything, into ./<name>.scelo-export/
/export excel r       just those formats
/help                 all of the above
```

Slash commands never reach the model — they are actions, not conversation,
and they keep working when the model is down. Anything else you type goes to
the pane's bot as before.

Typing `/` opens a menu of the commands: `↑↓` moves, `⏎` picks, `esc`
closes, `tab` completes. A command that does something on its own (`/help`,
`/list`, `/export`) runs on `⏎`; one that needs an argument (`/run`,
`/show`) completes the line to `/run ` and hands it back to you rather than
submitting something that could only come back as a usage error.

Commands that pick from a set open a **sub-list in the same widget**:
`/example` lists the bundled samples, `/list` the analyses that apply. The
arrows keep working across the hand-off — that is the point of sharing one
widget — and typing filters the list. `esc` clears a filter first, then
backs out a level. Command
output is also kept out of the model's replayed history — it is the app
speaking, and replaying it as the model's own words is how a bare "2" once
produced a confident description of a dataset nothing had loaded.

## The analysis menu

Eight analyses, chosen by the agent from whichever apply to the data's
shape, switchable by you with `/run`:

| | asks |
|---|---|
| Descriptive summary | what do the numbers look like? |
| Value by segment | how does the money split across the book? |
| Frequency / exposure profile | where is the exposure? |
| Time profile | how do records (and value) run over time — any gaps? |
| Concentration / Gini | do a few risks carry the total? |
| Correlation screen | which numeric pairs move together? |
| Outlier audit | which columns have values outside 1.5·IQR? |
| Missingness audit | where are the holes? |

Everything here profiles and screens; model *fits* (chain-ladder, GLMs,
Lee-Carter) stay in the IDE, where there is room to show diagnostics. A
terminal pane pretending to fit a GLM would produce a number nobody should
trust.

## Export

One command — `/export`, `ctrl-e`, or clicking the header's `⇩ export` tag —
writes everything the session produced:

```
policies.scelo-export/
  data.csv          the cleaned dataset (what every script reads)
  analysis.py       pandas — the pane's analysis, restated
  analysis.ipynb    Jupyter notebook, with a plot cell
  analysis.R        base R — runs in RStudio with no packages
  policies.xlsx     Excel: summary · results · columns dictionary · data
  policies.sce      Scelo IDE project — File → Open picks up where you left
```

The scripts carry the full provenance as comments — what was loaded, every
auto-clean step, the agent's reading, which analysis ran and why — and
recompute the analysis from `data.csv` on the SAME columns the pane used.
Verified by running the generated R under real Rscript: it reproduces the
pane's numbers exactly.

The `.sce` is the IDE's actual project format (magic `scelo-project` v1, the
same `@scelo/core` dataset shape), tested against the IDE's own parser — not
a lookalike. Its activity log carries the load / clean / pick / run steps, so
the IDE's own export screens can replay them. The one deliberate gap: TUI
runs map to the catalog's `descriptive` model and the `runs` record stays
empty, because the IDE wants numeric KPI headlines and inventing one to fill
the slot would put a fake number on a result card.

The Excel `data` sheet caps at 10,000 rows (a 120k-row sheet of XML helps
nobody) and says so in the summary sheet; `data.csv` always has everything.

## It knows whose terminal it is in

The TUI is a guest in somebody's terminal, and the host changes what
"export" means:

| host | detected by | what /export does |
|---|---|---|
| **RStudio** | `RSTUDIO=1` | writes **flat into the open project** (your cwd) as `<stem>_analysis.R`, `<stem>_data.csv`, … — they appear in the Files pane instantly, and the chat hands you the exact `source("<stem>_analysis.R")` line. Nothing to open: the project you are in IS the export. |
| **VS Code** | `TERM_PROGRAM=vscode` | exports to the usual directory, then runs `code -r` on the script, notebook and R file — they open in the window you are already in, and whatever extensions you have (Python, Jupyter, R) claim them by file type. Forks are covered: `cursor`, `windsurf`, `codium` are probed when `code` is absent. |
| **Scelo IDE** | `SCELO_IDE=1` | writes flat into the **open workspace** (`SCELO_IDE_WORKSPACE`, exported by the IDE's terminal as of this change) — visible in the file browser immediately, with the `.sce` one drag away from the Scelo screen. |
| plain | — | today's tidy `<stem>.scelo-export/` directory. |

Flat mode prefixes every generic name with the dataset stem —
`book_data.csv`, not `data.csv` — because dropping a file called `data.csv`
into somebody's project root is a collision waiting to happen. The scripts
are generated to read the prefixed name, so `source()` and `Run All` work
unmodified.

`/open [excel|python|notebook|r|sce|csv]` hands one artifact to whatever
should open it: `code -r` for code files inside VS Code, the OS opener
otherwise — which for the workbook means Excel/LibreOffice, i.e. "open the
spreadsheet normally". A bare `/open` opens the export folder. `.sce` on a
plain terminal prefers the packaged IDE binary (`scelo-ide` on PATH, or
`SCELO_IDE_BIN`) over whatever the OS associates with the extension.

Two honest boundaries. RStudio has no CLI to open a file in its editor —
requested for years ([rstudio/rstudio#1850](https://github.com/rstudio/rstudio/issues/1850),
[#14226](https://github.com/rstudio/rstudio/issues/14226)) — so
"files already in your open project + a ready source() line" is the whole
of what can be automated there, and it is the part that matters. And the
Scelo IDE does not yet auto-load the .sce when the export lands: that needs
an IDE-side terminal listener (the env contract this feature added is the
first half of it; the OSC bridge is the natural second).

## Models

| | |
|---|---|
| **Ollama** | local, no key. Discovered from what you have pulled. |
| **Anthropic** | Claude, via the official SDK. Curated list, Opus 5 first. |
| **OpenAI** / **Google** / **OpenRouter** | discovered from each provider's `/models`. |

`k` on any provider stores an API key in `~/.config/scelo-tui/config.json`
(directory `0700`, file `0600`, re-applied on every write). It is masked as
you type, never printed back, and `x` forgets it. Environment variables
(`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`,
`OPENROUTER_API_KEY`) are used when nothing is stored; a stored key wins.
Anthropic additionally picks up an `ant auth login` profile, so "no key
stored" does not mean "no access" — the picker probes rather than guessing.

The default is `qwen2.5:7b-instruct-q4_K_M`, because three chat panes on one
screen make latency matter more than prose. That is also why the Claude path
runs at `effort: "low"` with thinking left on: it is the latency dial, and
these are terse summarising tasks. Latency, not cost, is the reason — pick
Opus 5 and it will use Opus 5.

Whichever provider is selected, if it cannot be reached the pipeline still
ingests, profiles and cleans; the narrative and the bots go inert and say so,
rather than showing empty boxes that look like a bug.

## Mouse

Click any column to type in it, alongside `tab`. Terminals only send mouse
events when asked, and then they arrive on stdin mixed in with the keyboard,
so `src/ui/mouse.ts` both parses them and stops Ink pasting `[<0;74;12M` into
your draft.

Only press/release is requested (mode 1000), not motion — motion tracking
would cost you native click-drag text selection. `SCELO_TUI_MOUSE=0` turns
the whole thing off.

## While it is working

A glyph that grows, peaks and shrinks — `✢ ✳ ∗ ✻ ✽ ✻ ∗ ✳` — next to what is
happening and how long it has taken:

```
scelo tui · claude-opus-5 · ✽ understanding the data… 12s
│ ✓ read file · 120,000 rows x 32 cols
│ ✽ understand
│ · choose analysis
```

It pulses rather than rotating because a rotating bar reads as steady
progress, and nothing here has any idea how far along it is. The label names
the live stage, so a run parked on "understanding the data" for 40s is
visibly the model being slow rather than a stuck pipeline — which is also
what the elapsed counter is for.

One interval drives every spinner on screen, subscribed through
`useSyncExternalStore`. Ink recomputes and repaints the whole frame on any
state change, so five independently ticking components would mean five full
repaints per round. It is created on the first spinner and cleared after the
last: idle, the app writes nothing at all.

**The synchronous stages cannot animate.** Parsing 25MB and cleaning 120k
rows hold the thread, so the glyph freezes wherever it was. What the yields
in `runPipeline` buy is that the *label* is correct while that happens —
without them a run two seconds into cleaning still says "waiting for data",
because `onStage` never reached the screen. `·` is deliberately not one of
the frames: it is the stage list's mark for "not started", and freezing on it
would say the opposite of what is true.

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
@scelo/core                    profiling, typing, coercion, filtering, and
                               the bundled sample datasets (shared)
src/core/     cleaning.ts      the multi-pass auto-clean engine
              csvParse.ts      delimiter sniffing + parsing
              ingest.ts        path normalisation, file -> Dataset
              stats.ts         pearson, gini, concentration shares
              dates.ts         UTC-safe parse + month/quarter/year binning
src/agent/    llm.ts           which model answers; complete + stream
              providers.ts     the provider catalog
              config.ts        persisted selection and keys (0600)
              types.ts         the shape every adapter implements
              ollama.ts        local models
              anthropic.ts     Claude, official SDK
              openaiCompat.ts  OpenAI, Gemini, OpenRouter — one wire shape
              analyses.ts      the 8-entry menu + column heuristics
              pipeline.ts      the automatic run
src/export/   index.ts         the one-command export (dir and flat layouts)
              handoff.ts       host detection + delivery into RStudio/VS Code/IDE
              scripts.ts       pandas + base-R generators, per analysis
              notebook.ts      .ipynb (nbformat 4.5)
              sce.ts           the IDE's .sce project file
              workbook.ts      the 4-sheet Excel deliverable
              xlsx.ts          minimal OOXML writer
              zip.ts           the container (hand-rolled, python-verified)
              csv.ts           RFC-4180 writer
src/ui/       widgets.tsx      Pane, Table, BarPlot, Prose
              Chat.tsx         one bot, instantiated per pane
              Intro.tsx        the model picker
              mouse.ts         click-to-focus, and keeping it out of the draft
              spinner.tsx      one ticker, every "working" indicator
src/App.tsx                    the three-pane shell + the /intents
src/main.tsx                   picker -> panes
```

The column heuristics in `analyses.ts` (which column is the money, which
categorical is worth splitting by) are shared between the pane and the
export generators, so the script's `groupby` lands on the columns you
actually saw. A test walks the whole menu and fails if any analysis lacks
an export story.

Everything above `src/agent/llm.ts` imports `complete` and `stream` and has
never known which provider is behind them. Adding Claude did not change that;
it changed the answer from a constant to a runtime selection.

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

- Eight analyses; Scelo's real catalog is ~30, and the fits stay in the IDE.
- No swarm.
- The `.sce` export carries the session one way; the TUI does not OPEN .sce
  files yet.
- Inside the Scelo IDE, the export lands in the workspace but the session
  does not auto-load — the IDE-side terminal listener (read the OSC, parse
  the .sce, restore) is the designed next step; its detection contract
  (`SCELO_IDE`, `SCELO_IDE_WORKSPACE`) already ships in the IDE.
- No session persistence — the model choice and keys survive, nothing else
  does. (Exporting the .sce at the end of a session is the workaround, and
  arguably the feature.)
- Chat history is per-pane and per-session; it is not persisted.
- Reopening the picker re-runs the pipeline rather than keeping the loaded
  state, which is defensible (a new model should read the data itself) but
  is not a decision, it is what falls out of remounting.
- No scrollback in the panes; you see the tail.
- One dataset at a time, despite the `D₁…Dₙ` in the sketch.
- Clicking picks a pane by column, not by the pane's exact rectangle — a
  click below the panes still moves focus.
- The header's `⇩ export` click target assumes the app is drawn from the
  terminal's top row, which holds everywhere tested but is Ink's layout
  falling our way rather than a guarantee.
