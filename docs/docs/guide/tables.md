# Actuarial tables

Life tables, commutation columns, annuity and assurance factors, net premium
grids, run-off triangles, discount curves, A/E studies and model points, built
from your data or from a stated basis, and shown in the HARD pane.

This is the table vocabulary the Scelo IDE gave every stage chat in 0.2. The
engine is not a copy: it is `@scelo/core`'s `actuarialTables`, the same code the
IDE runs, so the same request gives the same numbers in both.

## Three ways in

**Ask what fits.** `/tables`, or just "suggest tables", reads the loaded data and
lists what follows from it. ++enter++ builds one:

```text
tables this data suggests — ⏎ builds one
▸ 1. ▦ triangle — Cumulative run-off triangle
  Origin (`origin_year`), development lag (`dev_period`…
  ↑↓ move · ⏎ pick · esc cancel
```

After a file loads, SOFT tells you when there are any, in one line under the
summary: `▦ tables: model points · premium table — /tables`. Nothing
actuarial in the file, no line.

**Type the request.** Anything that reads as a request to build a table is
parsed and built **locally, with no model in the loop**, so it works offline and
gives the same answer every time:

```text
build a life table at 4 % from age 20 to 100
built Life table · Gompertz–Makeham (illustrative) — 81 rows × 8 cols
in HARD now · /copy table · /export writes it as csv
```

```text
build a cumulative run-off triangle of `paid` by `origin_year` and `dev_period`
build a commutation table at 3.5 %
build a net premium table for term assurance
build discount factors at a flat 5 % out to 40 years
build model points in 5-year age bands
```

Lead with the verb ("build", "make", "create"). A question such as "what is a
life table?" is left to the model, which can explain it.

**Ask the model.** For anything the parser does not recognise, the chat model
knows the same protocol the IDE teaches its chats: it answers with a ` ```table `
block naming a *spec*, and Scelo builds the table from that spec. The model
never types the numbers. The reply in the pane shows what was built first and
the model's sentence of context after it.

## Where your data comes in

| the data has | you get |
|---|---|
| age + qx, lx, or deaths and exposure | life table, commutation, annuity factors, A/E (deaths/exposure) |
| origin + development (or payment) period + an amount | run-off triangle |
| age + sum assured + policy term | model points, net premium grid |
| tenor + rate | discount curve |

With none of those, tables still build on **Scelo's illustrative
Gompertz–Makeham basis** (A = 0.00022, B = 2.7e-6, c = 1.124), and the title
says *illustrative* every time it is used. It is a stated assumption, never a
silent one.

## In the HARD pane

A built table takes the table's place, headed *actuarial table · /run returns*.
Large values are shown without their decimals so eight columns fit a third of
the screen; small ones (qx, px) are shown as the engine rounded them.
`/copy table` and the export keep **full precision**.

`/run` anything puts the analysis back, as does `/tables off`. Tables you have
built stay on the session's shelf (up to twelve, as in the IDE), and `/tables`
lists them under the suggestions for showing again.

## Export

`/export` writes each table as `table-<title>.csv` beside `data.csv`, and puts
them in the `.sce` in the IDE's own `WorkspaceTable` shape, with a `table.build`
event for each. The table ids use the IDE's scheme, so the same spec built in
either app is the same table.
