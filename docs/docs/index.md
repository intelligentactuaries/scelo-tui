# Scelo TUI { .sr-only }

<figure class="tui-banner" markdown="0">
  <img src="assets/tui-banner.png"
       alt="scelo tui: soft data to tools to hard data, in your terminal">
</figure>

**The three-pane Scelo workstation in a terminal.** Drop a file in and the agent
profiles it, cleans it to a fixed point, reads it, picks an analysis and runs
it. You steer what it decided from chat. The whole session exports to Python,
Jupyter, R, Excel and the Scelo IDE in one command.

!!! warning "Open beta"
    Scelo TUI is a working prototype under active development. It installs from
    source rather than from a release, the analysis menu is eight entries
    against the IDE's thirty, and there is no session persistence. See
    [Limits](reference/limits.md) for the honest list.

## What you are looking at

The whole product is one screen. Left is the data, middle is what the agent
decided, right is the result. Each pane has its own chat box at the bottom.

```text
╭─────────────────────────────────────────────╮┌─────────────────────────────────────────────┐┌──────────────────────────────────────────────┐
│ SOFT · data ◂ focus                         ││ TOOLS · models                              ││ HARD · output                                │
│                                             ││                                             ││                                              │
│ file(s)                                     ││ pipeline                                    ││ table                                        │
│ └ book.csv                                  ││ ✓ read file · 900 rows x 8 cols             ││ `sum_insured` across `line` (5 segments)     │
│   900 rows × 7 cols                         ││ ✓ auto-clean · 1 step over 1 pass           ││                                              │
│                                             ││ ✓ understand                                ││ segment     n   mean    total  share         │
│ summary                                     ││ ✓ choose analysis · Value by segment        ││ Motor       185 470,270 87.00M 21.7%         │
│ cleaned: 1 steps / 1 passes                 ││ ✓ run · `sum_insured` across `line` (5      ││ Marine      184 455,146 83.75M 20.9%         │
│ dropped: notes                              ││ segments)                                   ││ Liability   190 434,773 82.61M 20.6%         │
│                                             ││                                             ││ Property    178 419,112 74.60M 18.6%         │
│ Rows represent one policy.                  ││ analyses                                    ││ Engineering 163 443,220 72.24M 18.1%         │
│ Key analytical columns:                     ││ ╔═════════════════════════╗                 ││                                              │
│ - `inception`: Policy start date.           ││ ║ ▓ book.csv              ║                 ││ plot                                         │
│ - `sum_insured` and `premium`: Financial    ││ ║ 900 × 7 · 1 clean steps ║                 ││ sum_insured total by line · /charts          │
│ details of policies.                        ││ ╚═════════════════════════╝                 ││ Motor       ███████████████████████ 87.0M    │
│ Potential issues:                           ││    │                                        ││ Marine      ██████████████████████ 83.7M     │
│ - `claims_paid` has many missing values,    ││    │  ┌────────────────────────────────┐    ││ Liability   ██████████████████████ 82.6M     │
│ which may limit analysis.                   ││    ├─▶│ ● Value by segment             │    ││ Property    ████████████████████ 74.6M       │
│                                             ││    │  └────────────────────────────────┘    ││ Engineering ███████████████████ 72.2M        │
│ ─────────────────────────────────────────── ││    │  ┌────────────────────────────────┐    ││                                              │
│ ask to change what the agent decided…       ││    ├┄▶│ · Descriptive summary          │    ││ flow                                         │
│                                             ││    │  └────────────────────────────────┘    ││ ┌────────────────────┐                       │
│                                             ││    └┄▶ +5 more · /list                      ││ │ ● Value by segment │─┐                     │
│                                             ││ To understand the distribution of premiums  ││ └────────────────────┘ │                     │
│                                             ││ and claims paid by policy line and region.  ││   ┌────────────────────┘                     │
│                                             ││ /run to change · /list for the menu         ││   ▼                                          │
│ ╭─────────────────────────────────────────╮ ││ ╭─────────────────────────────────────────╮ ││ ╭──────────────────────────────────────────╮ │
│ │ › ▌                                     │ ││ │ › …                                     │ ││ │ › …                                      │ │
│ ╰─────────────────────────────────────────╯ ││ ╰─────────────────────────────────────────╯ ││ ╰──────────────────────────────────────────╯ │
╰─────────────────────────────────────────────╯└─────────────────────────────────────────────┘└──────────────────────────────────────────────┘
tab pane · drag to select+copy · ⏎ send (or paste a path) · ↑↓ history · /copy values · /help commands · ctrl-e export · ctrl-o model · ctrl-c quit
```

Every screen on this site is a real capture of the running program, not a
mock-up.

## The idea

**Chat does not start work. Dropping a file does.** The agent ingests, cleans,
reads, picks and runs without being asked, and fills the panes as each stage
lands. The bots exist to *change what it decided*, which is why every pane
states what was done and why it was done.

That inverts the usual chat tool, where nothing happens until you compose a
good enough prompt. Here the useful default has already run by the time you
have finished reading the file name.

## Sixty seconds

```bash
scelo policies.csv
```

Pick a model, press ++enter++, and the panes fill. Then:

| you type | what happens |
|---|---|
| `/list` | the analyses that apply to this data, numbered |
| `/run 5` | switch to that one, the HARD pane re-renders |
| `/charts` | every plot this data makes, full screen |
| `/export` | six files: cleaned CSV, pandas, Jupyter, R, Excel, `.sce` |
| `/live` | mirror the session into RStudio and Jupyter as it runs |

Nothing above needs a model. [Slash commands](reference/commands.md) are
actions rather than conversation, and they keep working when the model is
unreachable.

## Where to go next

<div class="grid cards" markdown>

-   :material-download: **[Install](getting-started/install.md)**

    Two repos side by side, `bun install`, `bun link`. No build step.

-   :material-play: **[First run](getting-started/first-run.md)**

    The model picker, then dropping a file in.

-   :material-view-column: **[The three panes](guide/panes.md)**

    What each one shows and why it says what it says.

-   :material-export: **[Export](guide/export.md)**

    Six artifacts, and how they are verified against the pane.

</div>
