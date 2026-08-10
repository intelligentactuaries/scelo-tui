# Keys and mouse

The footer carries the short version at all times:

```text
tab pane · drag to select+copy · ⏎ send (or paste a path) · ↑↓ history · /copy values · /help commands · ctrl-e export · ctrl-o model · ctrl-c quit
```

## Everywhere

| key | does |
|---|---|
| ++tab++ | next pane |
| ++enter++ | send the line, or load a path you pasted |
| ++ctrl+e++ | export |
| ++ctrl+o++ | reopen the model picker (this re-runs the pipeline) |
| ++ctrl+t++ | expand or shut the HARD pane's result table |
| ++ctrl+c++ | quit |

`ctrl-t` is a keystroke rather than only a click because clicks are off unless
asked for, and a result you cannot see all of is the wrong thing to gate behind
a mode.

## Editing the line

| key | does |
|---|---|
| ++left++ ++right++ | one column |
| ++ctrl+left++ ++ctrl+right++ | one word |
| ++alt+b++ ++alt+f++ | one word, the emacs spelling |
| ++home++, ++ctrl+a++ | start of line |
| ++end++ | end of line |
| ++ctrl+u++ | kill to start |
| ++ctrl+k++ | kill to end |
| ++ctrl+w++ | kill a word |
| ++ctrl+d++ | delete forward |
| ++up++ ++down++ | prompt history |
| ++esc++ | clear the line |

!!! note "ctrl-e is export, not end-of-line"
    Readline would put end-of-line on `ctrl-e`. Export won it here because it is
    the thing you reach for repeatedly. ++end++ and ++ctrl+a++ still cover both
    edges.

## In a menu or sub-list

| key | does |
|---|---|
| ++up++ ++down++ | move |
| ++enter++ | pick, or complete the line for a command that needs an argument |
| ++tab++ | complete |
| any character | filter |
| ++esc++ | clear the filter first, then back out a level |

A sub-list is **modal**: it owns the keyboard while open, so a command typed
into it lands in the filter.

## In the charts gallery

| key | does |
|---|---|
| ++up++ ++down++ ++left++ ++right++ | previous and next plot, wrapping |
| ++q++ ++esc++ ++enter++ | back to the panes |
| ++ctrl+c++ | quit |

The gallery is the whole screen, so it takes the whole keyboard. A key it does
not claim does nothing, rather than landing invisibly in a pane you cannot see.

## In the model picker

| key | does |
|---|---|
| ++up++ ++down++ | move |
| ++enter++ | start with the highlighted model |
| ++k++ | store an API key |
| ++x++ | forget the stored key |
| ++m++ | type a model id by hand |
| ++r++ | re-probe every provider |
| ++q++ | quit |

## Mouse

**Clicks are off by default, on purpose.** Terminals only send mouse events when
asked, and asking costs you native click-drag text selection. Since copying a
value out of the screen is the more common need, plain drag-select wins the
default.

```text
/mouse on      click any column to focus it; selecting now needs shift held
/mouse off     back to plain drag-select (the default)
```

`SCELO_TUI_MOUSE=0` turns the whole subsystem off for a session regardless.

When mouse reporting is on, only press and release are requested, mode 1000, not
motion. Motion tracking would cost native selection entirely rather than merely
putting it behind ++shift++.

!!! note "Two things worth knowing"
    Events arrive on stdin mixed in with the keyboard, so the app both parses
    them and stops the raw sequence, `[<0;74;12M`, being pasted into your draft.

    Clicking picks a pane **by column**, not by the pane's exact rectangle, so a
    click below the panes still moves focus.

## Copying without the mouse

`/copy` puts the real values on the clipboard, with no borders or padding. See
[`/copy`](commands.md#copy).
