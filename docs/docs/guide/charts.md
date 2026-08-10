# Charts

The HARD pane draws one plot, sized to a third of the screen. `/charts` gives
you **every plot the data makes**, one at a time, on the whole screen.

```text
/charts               open the gallery
/charts 3             open it on plot 3
```

## The gallery

Left is the plot list, right is the plot. The `●` marks plots belonging to the
analysis currently running; `·` marks the rest.

```text
charts · book.csv · 1 of 9
┌──────────────────────────────────┐┌────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ plots                            ││ Value by segment                                                                                       │
│ ▸ 1 ● Value by segment           ││ sum_insured total by line                                                                              │
│   2 · Descriptive summary        ││                                                                                                        │
│   3 · Frequency / exposure prof… ││ Motor        ███████████████████████████████████████████████████████████████████████████████████ 87.0M │
│   4 · Time profile               ││ Marine       ███████████████████████████████████████████████████████████████████████████████▉    83.7M │
│   5 · Concentration / Gini       ││ Liability    ██████████████████████████████████████████████████████████████████████████████▊     82.6M │
│   6 · Lorenz curve               ││ Property     ███████████████████████████████████████████████████████████████████████▏            74.6M │
│   7 · Correlation screen         ││ Engineering  ████████████████████████████████████████████████████████████████████▉               72.2M │
│   8 · Outlier audit              ││                                                                                                        │
│   9 · Missingness / data-qualit… ││                                                                                                        │
└──────────────────────────────────┘└────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

Note the bars end in partial blocks, `▉ ▊ ▏`. Bars are drawn to eighth-of-a-cell
resolution rather than rounded to whole characters, so two close values stay
visibly different instead of collapsing onto the same length.

## Line charts

Anything that is a curve rather than a ranking is drawn with braille, which
gives four times the horizontal and twice the vertical resolution of block
characters. The Lorenz curve is the clearest example:

```text
│ plots                            ││ Concentration / Gini                                                                                   │
│   1 ● Value by segment           ││ Lorenz curve                                                                                           │
│   2 · Descriptive summary        ││                                                                                                        │
│   3 · Frequency / exposure prof… ││ 1.3 ┤                                                                                             ⢀  ⠊ │
│   4 · Time profile               ││     │                                                                                          ⡠⠔⠊⠁    │
│   5 · Concentration / Gini       ││     │                                                                                      ⣀⠤          │
│ ▸ 6 · Lorenz curve               ││     │                                                                                    ⠒⠉            │
│   7 · Correlation screen         ││     │                                                                              ⢀⡠⠔⠊                │
│   8 · Outlier audit              ││ 1.0 ┤                                                                          ⢀⡠  ⠁                 ⡔ │
│   9 · Missingness / data-qualit… ││     │                                                                        ⠔⠊⠁                    ⡜  │
│                                  ││     │                                                                   ⢀⡠⠔                        ⡜   │
│                                  ││     │                                                               ⢀  ⠊⠁                         ⡜    │
│                                  ││     │                                                            ⡠⠔⠊⠁                            ⡜     │
│                                  ││ 0.8 ┤                                                        ⣀⠤                                ⢀⠎      │
│                                  ││     │                                                      ⠒⠉                                 ⢀⠎       │
│                                  ││ 0.5 ┤                                     ⢀⡠⠔                                          ⣀⠤⠊⠁            │
│                                  ││     │                                 ⢀  ⠊⠁                                         ⣀⠔⠊                │
│                                  ││ 0.3 ┤                  ⢀⡠⠔⠊                                         ⣀⡠⠔⠒⠉                              │
└──────────────────────────────────┘└────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

## Keys

The gallery is the whole screen, so it takes the whole keyboard. There is no
composer underneath to type into, and a key it does not claim does nothing
rather than landing invisibly in a pane you cannot see.

| key | does |
|---|---|
| ++up++ ++down++ ++left++ ++right++ | previous and next plot, wrapping at both ends |
| ++q++ ++esc++ ++enter++ | back to the panes |
| ++ctrl+c++ | quit |

The plot count sits in the title, `1 of 9`, so you know how much is there
without scrolling the list.

## What gets a plot

Every analysis that applies to the data contributes its plots, not only the one
currently running. That is the point of the gallery: it is the answer to "what
else does this data look like" without switching analyses one at a time and
watching a third of a screen.

Some analyses contribute more than one. Concentration / Gini brings both the
decile shares and the Lorenz curve, which is why nine plots come out of eight
analyses here.
