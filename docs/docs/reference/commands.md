# Commands

Thirteen of them. **None reach the model**: they are actions rather than
conversation, so they keep working when the model is down, slow or
unconfigured.

Typing `/` opens a filtered menu of the lot. `/help` prints the same list in the
pane.

| command | does |
|---|---|
| [`/files [folder]`](#files) | pick a data file to load, no dragging needed |
| [<code>/example [number&#124;name]</code>](#example) | load a bundled sample dataset |
| [`/export [format…]`](#export) | write artifacts for every tool |
| [`/live [off]`](#live) | mirror the session into RStudio and Jupyter files as it runs |
| [`/open [format]`](#open) | open an exported artifact |
| [`/list`](#list) | the analyses that apply to this data |
| [`/charts [number]`](#charts) | every plot this data makes, full screen |
| [<code>/run &lt;analysis&#124;number&gt;</code>](#run) | switch the analysis |
| [`/show <column>`](#show) | one column's profile |
| [<code>/graph [on&#124;off]</code>](#graph) | the node and edge diagrams in TOOLS and HARD |
| [<code>/copy [table&#124;reading&#124;reply]</code>](#copy) | put values on the clipboard, no dragging |
| [<code>/mouse [on&#124;off]</code>](#mouse) | click-to-focus, at the cost of plain drag-select |
| [`/help`](#help) | everything you can type |

---

## Loading data

### `/files`

`/files [folder]` opens a picker of the data files under the current directory,
or under `folder` if given. Typing filters it; each entry shows its size and
modification time.

```text
data files under . — type to filter
▸ book.csv
  claims_2024.csv
  … 9 more
  11.5 KB · 15:20
  ↑↓ move · ⏎ pick · esc cancel
```

### `/example`

`/example` opens a pick-list of the Scelo IDE's bundled samples.
`/example dirty` loads one directly by name, and "load example data" as plain
prose works too.

Reach for `/example dirty` to watch [auto-clean](../guide/pipeline.md#auto-clean)
do real work.

---

## Choosing what runs

### `/list`

The analyses that apply to this data, numbered. Opens as a modal sub-list:
arrows move, ++enter++ picks, typing filters, ++esc++ backs out.

After it has printed, **a bare number answers it**.

### `/run`

`/run gini` by name, `/run 3` by the number `/list` printed. The HARD pane
re-renders. The pipeline does not restart and the dataset is not re-read.

Needs an argument, so picking it from the `/` menu completes the line to
`/run ` and hands it back rather than submitting a usage error.

### `/show`

`/show premium` prints that column's profile as a card: type, cardinality,
missingness, range, distribution. The quickest check of the agent's reading
against the actual data. Needs an argument.

---

## Seeing it

### `/charts`

`/charts` opens the full-screen [gallery](../guide/charts.md), `/charts 3` opens
it on plot 3. Arrows move, ++q++ ++esc++ or ++enter++ returns to the panes.

### `/graph`

`/graph off` turns off the node and edge diagrams in the TOOLS and HARD panes
and gives those rows back to the tables and the chat. `/graph on` restores them.
Bare `/graph` toggles.

### `/copy`

Puts the **values** on the clipboard rather than a picture of them, with no
box-drawing characters or column padding caught in the selection.

| | copies |
|---|---|
| `/copy` | whatever the focused pane is showing |
| `/copy table` | the result, tab separated, so it pastes into Excel as columns |
| `/copy reading` | the agent's reading of the data |
| `/copy reply` | the last thing the bot said |

`result` and `data` are accepted as synonyms for `table`.

### `/mouse`

`/mouse on` enables click-to-focus. `/mouse off` restores plain drag-select,
which is the default. See [Keys and mouse](keys.md#mouse) for the trade-off.

---

## Getting it out

### `/export`

`/export` writes everything; `/export excel r` writes just those formats.
`ctrl-e` is the same as bare `/export`, as is clicking the header's `⇩ export`
tag. Where the files land depends on
[the host](../guide/hosts.md). Full detail in [Export](../guide/export.md).

### `/live`

`/live` arms the [live mirror](../guide/live.md), rewriting R, notebook and CSV
files at every milestone so RStudio or Jupyter can follow the session as it
runs. `/live off` stops it, leaving the files in place.

### `/open`

`/open` opens the export folder. `/open [excel|python|notebook|r|sce|csv]`
opens one artifact, handing it to whatever should open that type rather than to
the OS default in every case.

Works after `/live` with nothing exported yet, since the mirror's files stand
in.

---

## `/help`

Prints every command with its hint, plus the key bindings, built from the same
registry the `/` menu reads so the two cannot drift apart.
