# Export

One command writes everything the session produced, for every tool you might
open it in next.

```text
/export                 everything
/export excel r         just those formats
ctrl-e                  same as bare /export
```

Or click the `⇩ export` tag in the header.

## What lands

```text
policies.scelo-export/
  data.csv          the cleaned dataset (what every script reads)
  analysis.py       pandas — the pane's analysis, restated
  analysis.ipynb    Jupyter notebook, with a plot cell
  analysis.R        base R — runs in RStudio with no packages
  policies.xlsx     Excel: summary · results · columns · data
  policies.sce      Scelo IDE project — File → Open picks up where you left
```

Where that directory goes depends on which terminal you are in. See
[Whose terminal it is in](hosts.md).

## The scripts carry their provenance

Every generated script opens with the full account as comments: what was loaded,
every auto-clean step, the agent's reading, which analysis ran and why. Then it
**recomputes the analysis from `data.csv`, on the same columns the pane used**,
because the [column heuristics](analyses.md#column-heuristics) are shared
between the pane and the generators.

So the script is not a transcript of the result. It is a program that produces
the result, and you can change it.

Running the generated R against the same session:

```console
$ Rscript analysis.R
scelo: 900 rows x 7 cols loaded
scelo → profile
...
scelo → Value by segment
              n     mean    total     share
Motor       185 470270.2 86999993 0.2173910
Marine      184 455145.7 83746811 0.2092621
Liability   190 434773.0 82606872 0.2064137
Property    178 419111.7 74601881 0.1864113
Engineering 163 443220.4 72244920 0.1805218
```

Against what the pane showed:

```text
segment     n   mean    total  share
Motor       185 470,270 87.00M 21.7%
Marine      184 455,146 83.75M 20.9%
Liability   190 434,773 82.61M 20.6%
Property    178 419,112 74.60M 18.6%
Engineering 163 443,220 72.24M 18.1%
```

Same numbers. `analysis.py` produces them too.

## The Excel workbook

Four sheets, in the order a reviewer wants them:

| sheet | holds |
|---|---|
| `summary` | the session: file, shape, clean steps, which analysis ran |
| `results` | the analysis output, the same table the HARD pane showed |
| `columns` | a data dictionary, one row per column, with its profile |
| `data` | the cleaned dataset |

The `data` sheet **caps at 10,000 rows** and says so on the summary sheet. A
120,000-row sheet of inline-string XML is a ~150MB file that helps nobody, and
`data.csv` always has everything.

## The `.sce` project

This is the Scelo IDE's actual project format, magic `scelo-project` v1, the same
`@scelo/core` dataset shape, tested against the IDE's own parser rather than a
lookalike. Its activity log carries the load, clean, pick and run steps, so the
IDE's own export screens can replay them.

!!! note "One deliberate gap"
    TUI runs map to the catalog's `descriptive` model and the `runs` record
    stays empty. The IDE wants a numeric KPI headline for a result card, and
    inventing one to fill the slot would put a fake number on it.

## Opening what you exported

```text
/open                 the export folder
/open excel           the workbook, in Excel or LibreOffice
/open python          analysis.py
/open notebook        analysis.ipynb, in a Jupyter frontend
/open r               analysis.R
/open sce             the Scelo IDE project
/open csv             the cleaned data
```

Each target goes to whatever should handle it rather than to the OS default in
every case: `code -r` for code files inside VS Code, a Jupyter frontend for
notebooks, because the OS opener would hand a `.ipynb` to a text editor, the OS
opener otherwise. On a plain terminal a `.sce` prefers the packaged IDE binary,
`scelo-ide` on PATH or `SCELO_IDE_BIN`, over whatever the OS associates with the
extension.

`/open` also works after [`/live`](live.md) with nothing exported yet, since the
live mirror's files stand in. `/live` then `/open notebook` is the whole Jupyter
flow.
