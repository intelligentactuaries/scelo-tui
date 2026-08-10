# Install

Scelo TUI installs from source. There is no release binary yet, and no build
step either: `bun link` symlinks the live source, so edits take effect on the
next run.

## Prerequisites

- **[Bun](https://bun.sh)** 1.3 or newer.
- **A terminal at least 140 columns wide.** Below that it refuses to draw the
  three panes and says so, rather than rendering an unreadable mess. A portrait
  window can go narrower, since the panes stack: see
  [The three panes](../guide/panes.md#when-the-window-is-too-small).
- **The `scelo` repo checked out as a sibling.** This is the part that catches
  people out, so it has its own section below.

## The sibling checkout

`@scelo/core` is consumed over a `file:` path, `../scelo/packages/scelo-core`,
so `bun install` fails here without it. That is deliberate rather than an
oversight: profiling, typing, coercion and filtering have exactly one
definition, shared with the Scelo IDE, so the two projects cannot drift apart.

Clone them together:

```bash
git clone git@github.com:intelligentactuaries/scelo.git
git clone git@github.com:intelligentactuaries/scelo-tui.git
cd scelo-tui
```

If your `scelo` checkout lives somewhere else, point the `file:` path in
`package.json` at it instead of moving the directory.

## Install

```bash
bun install
bun link            # puts `scelo` on your PATH via ~/.bun/bin
```

`bun link` is what makes `scelo` runnable from any directory. Without it you can
still run the app with `bun run src/main.tsx`, but relative paths will resolve
against the repo rather than against wherever your data is.

## Check it worked

```bash
scelo --help        # or just: scelo
```

You should land on the model picker. If instead you get

```text
Terminal too small for the three panes.
100x30 — needs 140x24 side by side, or 56x32 stacked. Make it taller.
```

then the window is the problem, not the install. Widen it past 140 columns, or
make it tall and narrow so the panes stack.

## Optional, and worth having

| | why |
|---|---|
| **[Ollama](https://ollama.com)** | the default model runs locally with no key and no cloud round-trip. `ollama pull qwen2.5:7b-instruct-q4_K_M` gets you the default. |
| **R** | so the exported `analysis.R` runs where you land. The generated script needs no packages, only base R. |
| **Python with pandas** | same, for `analysis.py`. |
| **A Jupyter frontend** | `/open notebook` looks for `jupyter-lab`, then `jupyter-notebook`, then bare `jupyter`. |

None of these are required to start. Without a model the pipeline still ingests,
profiles and cleans; the narrative and the bots go inert and say so. Without R,
Python or Jupyter the export still writes every file, you just open them
elsewhere.

## Uninstall

```bash
bun unlink          # from inside the repo
```

Then delete the two checkouts. The only thing outside them is the config file at
`~/.config/scelo-tui/config.json`, which holds your model choice and any API
keys. See [Configuration](../reference/configuration.md).
