# The three panes

One screen, three columns, the same shape as the Scelo IDE's pipeline: soft data
becomes tools becomes hard data, one way only.

Each pane has a **chat box** at the bottom. `tab` moves between them, and the
focused pane is marked `◂ focus` in its title and given extra rows at the
expense of the other two.

## SOFT · data

What was loaded, what was done to it, and what the agent made of it.

| section | shows |
|---|---|
| `file(s)` | the file name, and the shape **after** cleaning |
| `summary` | how many clean steps over how many passes, and which columns were dropped |
| the reading | the agent's prose account of what the rows represent, which columns carry the analytical weight, and what might block analysis |

The reading is the part worth arguing with. It is the model's interpretation
rather than a measurement, and the chat box under it is how you correct it.

!!! note "Row counts differ on purpose"
    The TOOLS pane says `read file · 900 rows x 8 cols` and SOFT says
    `900 rows × 7 cols`. The first is what came off disk, the second is what
    survived cleaning: here an empty `notes` column was dropped, which the
    `dropped: notes` line records.

## TOOLS · models

What the agent decided, and why.

The **pipeline** list is the run itself, one line per stage, each carrying its
own result:

```text
pipeline
✓ read file · 900 rows x 8 cols
✓ auto-clean · 1 step over 1 pass
✓ understand
✓ choose analysis · Value by segment
✓ run · `sum_insured` across `line` (5 segments)
```

Below it, **analyses** shows the menu as a node diagram: the dataset at the top,
the chosen analysis marked `●` and connected with a solid arrow, the runners-up
marked `·` on dotted ones, and `+5 more · /list` for the tail.

Under that is the agent's stated rationale, in its own words. If you disagree
with the choice, this is the pane whose chat box changes it, or use
[`/run`](../reference/commands.md#run).

## HARD · output

The result, three ways.

**table** is the analysis output. `ctrl-t` expands it when there are more rows
than fit; press it again to shut it.

**plot** is the same numbers as a bar chart, sized to the pane. The header line
names the plot and points at `/charts` for the full-screen
[gallery](charts.md).

**flow** is a small node diagram of the provenance: which analysis produced this
result, how many runs have happened, and the reminder that `ctrl-e` exports.

`/graph off` turns both diagrams off and gives the rows back to the tables and
the chat. `/graph on` brings them back.

## The chat boxes

Three bots, one per pane, each scoped to that pane's job. They exist to
**change what the agent decided**, not to start work.

Anything you type goes to the pane's bot, except [slash
commands](../reference/commands.md), which never reach the model.

## When the window is too small

Below the minimum the app refuses rather than rendering something unreadable:

```text
Terminal too small for the three panes.
100x30 — needs 140x24 side by side, or 56x32 stacked. Make it taller.
```

There are two viable layouts:

| layout | needs | when |
|---|---|---|
| side by side | 140 × 24 | the default |
| stacked, soft above tools above hard | 56 × 32 | when the window is **portrait**, meaning narrower than twice its height in character cells |

The portrait rule uses a cell aspect of 2, since terminal cells are about twice
as tall as they are wide. A tall narrow window therefore gets a usable stacked
layout instead of a refusal.
