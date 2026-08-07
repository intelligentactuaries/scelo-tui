// Small presentational pieces shared by the three panes.

import { Box, Text } from "ink";
import type { ReactNode } from "react";
import { fmtCompact, seriesFormat } from "./charts";
import type { DiagramLine } from "./diagram";
import { mouseActive } from "./mouse";
import { theme } from "./theme";

/** One column of the three-pane layout. Focus is shown on the border rather
 *  than with a background wash — a terminal cannot repaint a large fill
 *  cheaply, and a coloured frame reads faster anyway. */
export function Pane({
  title,
  accent,
  focused,
  width,
  height,
  children,
}: {
  title: string;
  accent: string;
  focused: boolean;
  width: number;
  /** Fixed rows. The stacked layout hands each pane its share so the three
   *  together fill the terminal exactly; Ink clips anything that overflows,
   *  which is why the panes budget their contents in rows rather than
   *  trusting flex to sort it out. */
  height?: number;
  children: ReactNode;
}) {
  return (
    <Box
      flexDirection="column"
      width={width}
      height={height}
      borderStyle={focused ? "round" : "single"}
      borderColor={focused ? accent : theme.chrome}
      paddingX={1}
    >
      <Box>
        <Text color={accent} bold>
          {title}
        </Text>
        {focused && <Text color={theme.mute}> ◂ focus</Text>}
      </Box>
      {children}
    </Box>
  );
}

/** Section heading inside a pane. */
export function Head({ children }: { children: ReactNode }) {
  return (
    <Box marginTop={1}>
      <Text color={theme.mute} bold>
        {children}
      </Text>
    </Box>
  );
}

/**
 * The pane's sparkline: a horizontal bar chart in forty columns and five
 * rows, which is all a third of the screen has to spare once the table, the
 * rationale and the chat have taken theirs. `/charts` draws the same series
 * properly — with axes, nice ticks and sub-cell resolution — so this one
 * only has to say which bar is the big one.
 *
 * Blocks rather than braille for the same reason charts.ts uses them for
 * bars: they degrade to a solid rectangle in fonts without fine braille
 * coverage, where braille degrades to boxes.
 */
export function BarPlot({
  values,
  labels,
  width,
  color,
  max = 6,
}: {
  values: number[];
  labels?: string[];
  width: number;
  color: string;
  max?: number;
}) {
  const shown = values.slice(0, max);
  if (shown.length === 0) return null;
  const peak = Math.max(...shown, 1);
  // Series-wide precision, not per value: `fmtCompact` alone labelled a
  // correlation screen 0.9 / 0 / 0 / 0, printing the same number beside
  // three different pairs.
  const fmt = seriesFormat(shown);
  const labelW = labels ? Math.min(14, Math.max(...labels.slice(0, max).map((l) => l.length))) : 0;
  const barW = Math.max(4, width - labelW - 10);
  return (
    <Box flexDirection="column">
      {shown.map((v, i) => {
        const filled = Math.max(v > 0 ? 1 : 0, Math.round((v / peak) * barW));
        const label = labels?.[i] ?? "";
        return (
          <Box key={i}>
            {labels && (
              <Text color={theme.mute}>
                {label.length > labelW ? `${label.slice(0, labelW - 1)}…` : label.padEnd(labelW)}{" "}
              </Text>
            )}
            <Text color={color}>{"█".repeat(filled)}</Text>
            <Text color={theme.mute}> {fmt(v)}</Text>
          </Box>
        );
      })}
    </Box>
  );
}

/** A laid-out node/edge diagram. All the thinking happened in diagram.ts —
 *  this is the loop that hands its spans to Ink. */
export function Diagram({ lines }: { lines: DiagramLine[] }) {
  if (lines.length === 0) return null;
  return (
    <Box flexDirection="column">
      {lines.map((line, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: positional by nature
        <Text key={i} wrap="truncate">
          {line.map((s, j) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: positional by nature
            <Text key={j} color={s.color} bold={s.bold}>
              {s.text}
            </Text>
          ))}
        </Text>
      ))}
    </Box>
  );
}

/**
 * Fixed-width text table, truncated to the pane.
 *
 * The footer line is a button: clicking "… 3 more" expands the table (the
 * mapping lives in App.tsx, which owns the mouse and can count the row). So
 * it says so — an affordance nobody can see is not one — but only while
 * mouse reporting is actually on, because `/mouse off` is a setting /help
 * recommends and a hint that lies is worse than none.
 */
export function Table({
  columns,
  rows,
  width,
  maxRows = 6,
  expanded = false,
}: {
  columns: string[];
  rows: Array<Array<string | number>>;
  width: number;
  maxRows?: number;
  /** Drawn open, so the footer offers the way back rather than more rows. */
  expanded?: boolean;
}) {
  if (columns.length === 0) return null;
  const shown = rows.slice(0, maxRows);
  // Size each column to its widest cell, then shrink proportionally if the
  // total overflows the pane — a table that wraps is unreadable.
  const raw = columns.map((c, i) =>
    Math.max(c.length, ...shown.map((r) => String(r[i] ?? "").length)),
  );
  const total = raw.reduce((a, b) => a + b + 1, 0);
  const scale = total > width ? (width - columns.length) / (total - columns.length) : 1;
  const w = raw.map((n) => Math.max(3, Math.floor(n * scale)));
  const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s.padEnd(n));
  return (
    <Box flexDirection="column">
      <Text color={theme.mute}>{columns.map((c, i) => cut(c, w[i])).join(" ")}</Text>
      {shown.map((r, ri) => (
        <Text key={ri}>{r.map((c, i) => cut(String(c ?? ""), w[i])).join(" ")}</Text>
      ))}
      {(expanded || rows.length > shown.length) && (
        <Text color={theme.mute} wrap="truncate">
          {tableFooter(rows.length - shown.length, expanded, mouseActive())}
        </Text>
      )}
    </Box>
  );
}

/** The footer's wording, kept out of the JSX so the four states are legible
 *  as four states. Exported for the test that pins them. */
export function tableFooter(hidden: number, expanded: boolean, clickable: boolean): string {
  const more = hidden > 0 ? `… ${hidden} more` : "";
  if (!expanded) {
    return clickable ? `${more} · click to expand` : `${more} · /mouse on to expand`;
  }
  return more === "" ? "▴ click to collapse" : `${more} · ▴ click to collapse`;
}

/** Wrap text to a width without splitting words. Ink wraps for us, but the
 *  panes need a hard line budget so one long LLM reply cannot push the chat
 *  off the bottom of the screen. */
export function Prose({
  text,
  width,
  maxLines,
  color = theme.fg,
}: {
  text: string;
  width: number;
  maxLines: number;
  color?: string;
}) {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    if (para.trim() === "") {
      out.push("");
      continue;
    }
    let line = "";
    for (const word of para.split(/\s+/)) {
      if (line === "") line = word;
      else if (line.length + 1 + word.length <= width) line += ` ${word}`;
      else {
        out.push(line);
        line = word;
      }
    }
    if (line) out.push(line);
  }
  const clipped = out.slice(0, maxLines);
  return (
    <Box flexDirection="column">
      {clipped.map((l, i) => (
        <Text key={i} color={color}>
          {l}
        </Text>
      ))}
      {out.length > clipped.length && <Text color={theme.mute}>…</Text>}
    </Box>
  );
}

export { fmtCompact };
