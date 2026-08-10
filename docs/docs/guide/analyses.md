# Analyses

Eight of them. The agent picks whichever applies to the data's shape; you
override with [`/run`](../reference/commands.md#run).

| | asks |
|---|---|
| **Descriptive summary** | what do the numbers look like? |
| **Value by segment** | how does the money split across the book? |
| **Frequency / exposure profile** | where is the exposure? |
| **Time profile** | how do records, and value, run over time, and are there gaps? |
| **Concentration / Gini** | do a few risks carry the total? |
| **Correlation screen** | which numeric pairs move together? |
| **Outlier audit** | which columns have values outside 1.5·IQR? |
| **Missingness / data-quality audit** | where are the holes? |

## Seeing which apply

`/list` shows only the ones that make sense for the data in front of you,
numbered:

```text
analyses that apply to this data
▸ 1. Descriptive summary
  2. Value by segment
  3. Frequency / exposure profile
  4. Time profile
  5. Concentration / Gini
  6. Correlation screen
  7. Outlier audit
  … 1 more
  ↑↓ move · ⏎ pick · esc cancel
```

The list is a **modal sub-list**: while it is open, arrows move, ++enter++
picks, typing filters, and ++esc++ clears a filter first and then backs out. It
owns the keyboard until you leave it, so a command typed while it is open lands
in the filter instead of running.

## Switching

```text
/run gini             by name
/run 3                by the number /list just printed
3                     a bare number answers whichever menu was just printed
```

The HARD pane re-renders. The pipeline does not restart, and the dataset is not
re-read.

## Why only eight

Everything here **profiles and screens**. Model fits, chain-ladder, GLMs,
Lee-Carter, stay in the Scelo IDE, where there is room to show diagnostics
alongside the answer.

A terminal pane pretending to fit a GLM would produce a number nobody should
trust, because the thing that makes a fit trustworthy is the residual plots and
the convergence detail sitting next to it. Scelo's real catalog is around thirty
entries; these eight are the ones that survive being read in a column.

## Column heuristics

Which column is the money, and which categorical is worth splitting by, is
decided by shared heuristics rather than by the model. That matters for two
reasons:

- it is **stable**, so the same data gives the same grouping every run
- the **export generators use the same code**, so the `groupby` in the generated
  Python and R lands on the columns you actually saw on screen

A test walks the entire menu and fails if any analysis lacks an export story, so
every one of the eight can be handed to pandas and base R.

## One column at a time

`/show <column>` prints a single column's profile as a card: type, cardinality,
missingness, range and the distribution. It is the quickest way to check the
agent's reading against the actual data.
