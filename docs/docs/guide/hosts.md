# Whose terminal it is in

The TUI is a guest in somebody's terminal, and the host changes what "export"
means. It detects where it is running and delivers accordingly.

The header tells you which one it decided on, so you never have to guess:

```text
scelo tui · qwen2.5:7b-instruct-q4_K_M · ready · ⇩ export → RStudio (click here or ctrl-e)
```

## The four hosts

| host | detected by | what `/export` does |
|---|---|---|
| **RStudio** | `RSTUDIO=1` | writes **flat into the open project**, your working directory, as `<stem>_analysis.R`, `<stem>_data.csv` and the rest. They appear in the Files pane instantly, and the chat hands you the exact `source("<stem>_analysis.R")` line. Nothing to open: the project you are in **is** the export. |
| **VS Code** | `TERM_PROGRAM=vscode`, or `VSCODE_PID` / `VSCODE_CWD` | exports to the usual directory, then runs `code -r` on the script, notebook and R file, so they open in the window you are already in and whatever extensions you have claim them by file type. Forks are covered: `cursor`, `windsurf`, `codium` and `code-insiders` are probed when `code` is absent. |
| **Scelo IDE** | `SCELO_IDE=1` | writes flat into the **open workspace**, `SCELO_IDE_WORKSPACE`, visible in the file browser immediately, with the `.sce` one drag away from the Scelo screen. |
| plain terminal | none of the above | today's tidy `<stem>.scelo-export/` directory. |

## Flat mode prefixes everything

In RStudio and the Scelo IDE the files land directly in a directory you are
already working in, so every generic name gets the dataset stem in front of it:
`book_data.csv`, not `data.csv`. Dropping a file called `data.csv` into
somebody's project root is a collision waiting to happen.

The scripts are **generated to read the prefixed name**, so `source()` and
`Run All` work unmodified. Compare:

=== "Plain terminal"

    ```text
    book.scelo-export/
      data.csv
      analysis.py
      analysis.ipynb
      analysis.R
      book.xlsx
      book.sce
    ```

=== "RStudio or Scelo IDE"

    ```text
    ./                       ← your open project
      book_data.csv
      book_analysis.py
      book_analysis.ipynb
      book_analysis.R
      book.xlsx
      book.sce
    ```

The `.xlsx` and `.sce` already carry the dataset name, so they are not prefixed
twice.

## Testing a host locally

Setting the variable is enough, which is also how you check what a colleague
will get:

```bash
RSTUDIO=1 scelo book.csv          # pretend to be RStudio
TERM_PROGRAM=vscode scelo book.csv
SCELO_IDE=1 SCELO_IDE_WORKSPACE=$PWD scelo book.csv
```

## Why detect at all

Because the right answer genuinely differs. In RStudio, a tidy sub-directory is
an obstacle: you would have to leave the project to reach it. On a plain
terminal, writing six files into whatever directory somebody happened to be
standing in is rude. The same command should do the locally correct thing, and
the only way to do that is to know where it is.
