# The pipeline

Dropping a file starts everything. Five stages, each reporting into the TOOLS
pane as it lands.

```text
read file  →  auto-clean  →  understand  →  choose analysis  →  run
```

The first two and the last are deterministic. Only **understand** and **choose
analysis** need a model, which is why the app is still useful when there is no
model to be had: see [Degraded mode](#when-the-model-is-unreachable) below.

## Read file

Delimiter sniffing and parsing, then a profile of every column: type, cardinality,
missingness, range. Path normalisation happens here too, which is what makes
dragging a file onto the terminal work.

The stage line reports the raw shape, `read file · 900 rows x 8 cols`, before
anything has been dropped.

## Auto-clean

A multi-pass engine that runs to a **fixed point**: it profiles, applies what it
can justify, then profiles the result and goes again, up to six passes. It stops
early when a pass changes nothing. The summary reports both numbers, so
`1 step over 1 pass` and `12 steps over 3 passes` are both normal.

The operations it can apply:

| operation | does |
|---|---|
| `fix-encoding` | repairs mojibake from a mis-decoded upstream file |
| `trim` | strips leading and trailing whitespace |
| `collapse-whitespace` | squeezes runs of internal spaces |
| `rename-snake-case` | normalises column names |
| `missing-tokens` | recognises `NA`, `N/A`, `-`, `unknown`, `empty` and friends as missing |
| `replace-numeric-sentinels` | turns `-999` style placeholders into missing |
| `parse-numeric` / `coerce-numeric` | text that is really numbers becomes numbers |
| `parse-dates` | text that is really dates becomes dates, UTC-safe |
| `null-future-years` | dates implausibly far in the future become missing |
| `standardise-booleans` | `Y`/`yes`/`TRUE`/`1` collapse to one representation |
| `lowercase-categoricals` | case-only duplicates in a category stop being separate levels |
| `recode-value` | near-duplicate labels merge, e.g. two spellings of one region |
| `drop-empty-cols` | columns with nothing in them |
| `drop-constant-cols` | columns with exactly one value, which cannot inform anything |
| `drop-duplicates` | exact duplicate rows |

Every step is recorded, named in the SOFT pane's summary, and **carried into the
export as comments**, so the Python and R scripts say what was done before they
recompute anything.

!!! tip "Watch it work"
    `/example dirty` loads the bundled messy intake dataset, which is built to
    trigger most of the list above, duplicate rows included.

## Understand

The model reads the profile and writes the SOFT pane's prose: what a row
represents, which columns carry the analytical weight, and what might block
analysis. This is interpretation rather than measurement, and it is the stage
most worth disagreeing with.

## Choose analysis

The model picks from the [analyses](analyses.md) that apply to this data's shape,
and states why in the TOOLS pane. Column heuristics decide which column is the
money and which categorical is worth splitting by.

Those same heuristics are shared with the export generators, so the script's
`groupby` lands on the columns you actually saw on screen.

## Run

Deterministic. The chosen analysis computes against the cleaned dataset and
fills the HARD pane's table and plot.

`/run` re-runs a different analysis against the same data at any time, and the
HARD pane re-renders. The pipeline does not restart.

## While it is working

The header carries a glyph that grows, peaks and shrinks, next to the live stage
name and how long it has been going:

```text
scelo tui · claude-opus-5 · ✽ understanding the data… 12s
│ ✓ read file · 120,000 rows x 32 cols
│ ✽ understand
│ · choose analysis
```

It pulses rather than rotating on purpose. A rotating bar reads as steady
progress, and nothing here has any idea how far along it is. Naming the live
stage means a run parked on "understanding the data" for 40 seconds is visibly
the model being slow rather than a stuck pipeline, which is what the elapsed
counter is for.

!!! note "The synchronous stages cannot animate"
    Parsing 25MB and cleaning 120,000 rows hold the thread, so the glyph freezes
    wherever it was. What is guaranteed is that the *label* stays correct while
    that happens. `·` is deliberately not one of the animation frames: it is the
    stage list's mark for "not started", so freezing on it would say the
    opposite of what is true.

## When the model is unreachable

If the selected provider cannot be reached, the pipeline **still ingests,
profiles, cleans and runs an analysis**. What you lose is the narrative and the
bots, and both say so rather than showing empty boxes that look like a bug.

Every [slash command](../reference/commands.md) keeps working, because none of
them reach the model. That includes `/list`, `/run`, `/charts`, `/export` and
`/live`, which is most of the product.
