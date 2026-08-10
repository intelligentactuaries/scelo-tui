# Limits

Scelo TUI is an open beta. This is the honest list of what it does not do, kept
here rather than left for you to discover.

## Scope

- **Eight analyses.** Scelo's real catalog is around thirty. The
  [reasoning](../guide/analyses.md#why-only-eight) is that model fits belong
  where their diagnostics fit, which is the IDE.
- **No swarm.** The council and population simulation are IDE features.
- **One dataset at a time.**

## Session

- **No session persistence.** The model choice and API keys survive; the loaded
  dataset, the chat history and the analysis you switched to do not. Exporting
  the `.sce` at the end is the workaround, and arguably the feature.
- **Chat history is per-pane and per-session**, and is not written anywhere.
- **Reopening the picker re-runs the pipeline** rather than keeping the loaded
  state. A new model reading the data itself is defensible, but this is what
  falls out of remounting rather than a decision that was taken.

## Round trips

- **The `.sce` export carries the session one way.** The TUI does not open
  `.sce` files.
- **Inside the Scelo IDE the export lands in the workspace, but the session does
  not auto-load.** That needs an IDE-side terminal listener: read the escape
  sequence, parse the `.sce`, restore. The detection contract, `SCELO_IDE` and
  `SCELO_IDE_WORKSPACE`, already ships in the IDE, which is the first half.
- **RStudio cannot be told to open a file in its editor.** No CLI exists for it
  ([rstudio#1850](https://github.com/rstudio/rstudio/issues/1850),
  [#14226](https://github.com/rstudio/rstudio/issues/14226)), so files in your
  open project plus a ready `source()` line is the whole of what can be
  automated there.

## Display

- **No scrollback in the panes.** You see the tail.
- **Needs 140 columns**, or a portrait window at least 56 × 32 for the stacked
  layout. Below both it refuses rather than rendering something unreadable.
- **Clicking picks a pane by column**, not by the pane's exact rectangle, so a
  click below the panes still moves focus.
- **The header's `⇩ export` click target assumes the app is drawn from the
  terminal's top row.** That holds everywhere tested, but it is the layout
  falling our way rather than a guarantee.

## Export

- **The Excel `data` sheet caps at 10,000 rows** and says so on the summary
  sheet. `data.csv` always has everything.
- **TUI runs map to the catalog's `descriptive` model and the `runs` record in
  the `.sce` stays empty.** The IDE wants a numeric KPI headline for a result
  card, and inventing one to fill the slot would put a fake number on it.

## Install

- **No release binary.** It installs from source, and needs the `scelo` repo
  checked out as a sibling because `@scelo/core` is consumed over a `file:`
  path. That is deliberate: profiling, typing, coercion and filtering have one
  definition shared with the IDE, so the two cannot drift.

## Reporting something

Issues and pull requests:
[github.com/intelligentactuaries/scelo-tui](https://github.com/intelligentactuaries/scelo-tui).
