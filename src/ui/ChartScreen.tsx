// `/charts` — the gallery, on its own screen.
//
// The three panes give a plot about five rows and forty columns, which is a
// sparkline's budget. Everything the analyses can draw deserves better than
// that at least once, so this takes the whole terminal: a list of every plot
// the session produces down the left, the selected one drawn at full size on
// the right, and under it the line of R and of Python that draws the same
// picture in the exported artifacts.
//
// The drawing is charts.ts and the catalogue is gallery.ts. This is the
// layout and the arithmetic that keeps it inside one screen — a gallery that
// scrolls has lost the argument for existing.

import { Box, Text } from "ink";
import { drawChart } from "./charts";
import { Diagram, Pane } from "./widgets";
import type { ChartCard, ChartEntry } from "./gallery";
import { theme } from "./theme";

/** Terminal row (1-based) of the first entry in the list: the header, the
 *  pane's top border, and its title. Exported because clicks are mapped in
 *  App.tsx, which has the mouse handler but not this layout. */
export const CHART_LIST_TOP = 4;

/** How wide the list gets. Wide enough for "Missingness / data-quality
 *  audit" to be recognisable, never more than a quarter of the screen. */
export function chartListWidth(cols: number): number {
  return Math.max(22, Math.min(38, Math.floor(cols * 0.26)));
}

export function ChartScreen({
  entries,
  index,
  card,
  datasetName,
  cols,
  rows,
}: {
  entries: ChartEntry[];
  index: number;
  /** The built chart for `index`, or null when the analysis turned out to
   *  have nothing to plot. */
  card: ChartCard | null;
  datasetName: string;
  cols: number;
  rows: number;
}) {
  const listW = chartListWidth(cols);
  const plotW = cols - listW;
  const bodyH = Math.max(8, rows - 2);
  const inner = plotW - 4;

  // Chrome (3) + the caption, the blank under it, the rule, the headline and
  // the two export lines, with a row left spare — the same honest accounting
  // the panes do, for the same reason: Ink clips an overflowing box silently
  // and the symptom is a missing border, not an error.
  const FURNITURE = 3 + 1 + 1 + 1 + 1 + 2 + 1;
  const plotH = Math.max(3, bodyH - FURNITURE);

  const lines = card
    ? drawChart({
        kind: card.kind,
        values: card.values,
        labels: card.labels,
        width: inner,
        height: plotH,
        color: theme.hard,
        unit: card.unit,
      })
    : [];

  return (
    <Box flexDirection="column">
      <Box>
        <Text color={theme.hard} bold>
          charts
        </Text>
        <Text color={theme.mute}>
          {" "}
          · {datasetName} · {entries.length === 0 ? "none" : `${index + 1} of ${entries.length}`}
        </Text>
      </Box>

      <Box height={bodyH}>
        <Pane title="plots" accent={theme.hard} focused={false} width={listW}>
          {entries.map((e, i) => (
            <Text key={e.key} wrap="truncate">
              <Text color={i === index ? theme.hard : theme.mute}>
                {i === index ? "▸" : " "}
                {String(i + 1).padStart(2)}{" "}
              </Text>
              {/* Ran vs merely eligible is the one status worth a glyph: it
                  is the difference between "this is your result" and "this
                  is what you would get if you ran it". */}
              <Text color={e.ran ? theme.ok : theme.mute}>{e.ran ? "●" : "·"} </Text>
              <Text color={i === index ? theme.fg : theme.mute} bold={i === index}>
                {e.subtitle || e.title}
              </Text>
            </Text>
          ))}
          {entries.length === 0 && <Text color={theme.mute}>no analyses apply to this data</Text>}
        </Pane>

        <Pane
          title={card ? card.title : "plot"}
          accent={theme.hard}
          focused={false}
          width={plotW}
        >
          <Text color={theme.mute} wrap="truncate">
            {card?.subtitle || card?.headline || "—"}
          </Text>
          <Box marginTop={1} flexDirection="column">
            {lines.length > 0 ? (
              <Diagram lines={lines} />
            ) : (
              <Text color={theme.mute}>
                {entries.length === 0
                  ? "load a dataset first"
                  : "this analysis has no series to plot"}
              </Text>
            )}
          </Box>
          <Box flexGrow={1} />
          <Text color={theme.chrome}>{"─".repeat(Math.max(0, inner))}</Text>
          {card && (
            <Text color={theme.hard} wrap="truncate">
              {card.headline}
            </Text>
          )}
          {/* What the exported artifacts draw. The gallery's other job: the
              plots the session WILL generate, not only the ones on screen. */}
          <Text color={theme.mute} wrap="truncate">
            {card?.draws.r ? `analysis.R      ${card.draws.r}` : "analysis.R      (no plot)"}
          </Text>
          <Text color={theme.mute} wrap="truncate">
            {card?.draws.py
              ? `analysis.ipynb  ${card.draws.py}`
              : "analysis.ipynb  (no plot)"}
          </Text>
        </Pane>
      </Box>

      <Box>
        <Text color={theme.mute}>
          ↑↓ or ←→ pick · 1-9 jump · click a plot in the list · esc/q back to the panes ·
          ctrl-e exports them
        </Text>
      </Box>
    </Box>
  );
}
