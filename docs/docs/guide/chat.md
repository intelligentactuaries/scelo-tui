# Steering it in chat

The pipeline runs itself. The bots exist to **change what it decided**.

Three chat boxes, one per pane, each scoped to that pane's job: the SOFT bot
argues about the reading, the TOOLS bot about the choice, the HARD bot about the
result. `tab` moves between them.

## Two kinds of input

**Slash commands are actions.** They never reach the model, so they keep working
when it is down, slow or unconfigured. Every one of them is deterministic.

**Anything else is conversation** and goes to the focused pane's bot.

That split is why `/list`, `/run`, `/charts`, `/export` and `/live`, which is
most of the product, work with no model at all.

## The command menu

Typing `/` opens a menu of the commands, filtered as you type:

```text
▸ /files   pick a data file to load — no dragging needed
  /example load a bundled sample dataset
  /export  write artifacts for every tool
  /live    mirror the session into RStudio/Jupyter…
  /open    open an exported artifact
  /list    the analyses that apply to this data
  /charts  every plot this data makes, full screen
  … 6 more
  ↑↓ move · ⏎ pick · esc close
```

| key | does |
|---|---|
| ++up++ ++down++ | move |
| ++enter++ | pick |
| ++tab++ | complete |
| ++esc++ | close |

++enter++ behaves differently depending on the command, on purpose. One that
does something on its own, `/help`, `/list`, `/export`, **runs**. One that needs
an argument, `/run`, `/show`, **completes the line to `/run ` and hands it back
to you** rather than submitting something that could only come back as a usage
error.

## Sub-lists

Commands that pick from a set open a sub-list **in the same widget**:
`/example` lists the bundled samples, `/list` the analyses that apply, `/files`
the data files under the current directory.

The arrows keep working across the hand-off, which is the point of sharing one
widget. Typing filters the list. ++esc++ clears a filter first, then backs out a
level.

!!! warning "A sub-list is modal"
    While one is open it owns the keyboard. A command typed into it lands in the
    filter, so `/list` followed by `/show premium` gives you
    `nothing matches "/show premium"` rather than a column profile. Press
    ++esc++ first.

## Answering a menu

After a numbered menu has printed, **a bare number answers it**. `/list` then
`3` runs the third analysis. This works because command output is the app
speaking rather than the model, and is tracked separately.

## Command output is kept out of the model's history

Replaying the app's own output back to the model as if the model had said it is
how a bare `2` once produced a confident description of a dataset nothing had
loaded. So it does not happen: what the app prints stays the app's.

## Editing the line

Standard readline chords, because a chat box that loses a long line to a typo is
worse than no chat box.

| key | does |
|---|---|
| ++left++ ++right++ | move one column |
| ++ctrl+left++ ++ctrl+right++, ++alt+b++ ++alt+f++ | move one word |
| ++home++ ++end++, ++ctrl+a++ | start and end of line |
| ++ctrl+u++ ++ctrl+k++ | kill to start, kill to end |
| ++ctrl+w++ | kill a word |
| ++ctrl+d++ | delete forward |
| ++up++ ++down++ | prompt history |
| ++esc++ | clear the line |

`ctrl-e` is **export** here rather than readline's end-of-line. ++end++ and
++ctrl+a++ still cover both edges of the line.

## Copying

Clicks are off by default precisely so that dragging to select works the way it
does in any other terminal window. Drag, copy, done.

`/copy` is the alternative when you want the **values** rather than the picture
of them, with no box-drawing characters or column padding caught in the
selection:

```text
/copy              whatever the focused pane is showing
/copy table        the result, tab separated, pastes into Excel as columns
/copy reading      the agent's reading of the data
/copy reply        the last thing the bot said
```

`/mouse on` adds click-to-focus, at the cost of needing ++shift++ held to
select. See [Keys and mouse](../reference/keys.md#mouse).
