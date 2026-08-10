# The live mirror

[`/export`](export.md) is the session after the fact. `/live` is the session
**as it happens**.

```text
/live              arm the mirror
/live off          stop mirroring (the files stay where they are)
```

Armed, the TUI rewrites the live files at every milestone: after auto-clean,
which is before the slow model stages, when the first analysis lands, and on
every `/run` switch.

## What it writes

```text
<stem>_live_watch.R  THE AUTOMATED PATH. source() this ONCE in the RStudio
                     console and every later update runs itself: the watcher
                     polls the live script and re-sources it on change, so
                     new sections print in the console as the TUI produces
                     them. scelo_watch_stop() stops it.
<stem>_live.R        the live script itself, also source()-able by hand at any
                     moment. Each analysis is a section that announces itself
                     and prints its result; a partial session says it is still
                     in progress.
<stem>_live.ipynb    open it in Jupyter (/open notebook). When scelo adds
                     sections, Jupyter offers "file changed on disk, reload",
                     and new analyses appear at the bottom.
<stem>_data.csv      the cleaned dataset they all read, the same name the final
                     /export writes, so live and final scripts are
                     interchangeable.
```

Placement follows the [host rules](hosts.md): flat into an open RStudio project
or Scelo IDE workspace, into `./<stem>.scelo-export/` elsewhere.

## In RStudio

Arming it there hands you the exact line to paste:

```text
live mirror on — updating as the session advances
RStudio: paste source("book_live_watch.R") once — after that, every update
runs itself in the console (scelo_watch_stop() to stop)
```

The watcher uses `later`, which RStudio's idle loop pumps. Without `later`
installed it degrades to a one-keystroke `scelo_refresh()` rather than failing.

## Two guarantees that make it safe to read mid-flight

**Every write is atomic.** Temp file plus rename, so a `source()` racing a
rewrite sees either the old file or the new one, never half of each.

**Every intermediate file is valid.** A partial session parses in R and loads as
nbformat JSON. The test suite has R and Python verify exactly that, rather than
trusting it.

## Opt-in on purpose

The TUI is a guest in your directory and **writes nothing unasked**. `/live` is
the moment you invite it to, which is why it is a command rather than a default.

`/live off` stops the mirroring. The files stay where they are, because deleting
something you might have already sourced would be the wrong call.

## Why it exists

The alternative workflow is: run the session, export, switch windows, open the
file, read it, go back, change something, export again. The mirror removes the
loop. You keep RStudio or Jupyter open beside the TUI and the analysis arrives
there while you are still steering it.

Two honest boundaries:

- **RStudio has no CLI to open a file in its editor.** It has been requested for
  years ([rstudio#1850](https://github.com/rstudio/rstudio/issues/1850),
  [#14226](https://github.com/rstudio/rstudio/issues/14226)). So "files already
  in your open project, plus a ready `source()` line" is the whole of what can
  be automated there, and it is the part that matters.
- **The Scelo IDE does not yet auto-load the `.sce`** when the export lands.
  That needs an IDE-side terminal listener; the environment contract is the
  first half of it.
