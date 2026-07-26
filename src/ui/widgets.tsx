// Small presentational pieces shared by the three panes.

import { Box, Text } from "ink";
import type { ReactNode } from "react";
import { theme } from "./theme";

/** One column of the three-pane layout. Focus is shown on the border rather
 *  than with a background wash — a terminal cannot repaint a large fill
 *  cheaply, and a coloured frame reads faster anyway. */
export function Pane({
  title,
  accent,
  focused,
  width,
  children,
}: {
  title: string;
  accent: string;
  focused: boolean;
  width: number;
  children: ReactNode;
}) {
  return (
    <Box
      flexDirection="column"
      width={width}
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

/** Horizontal bar chart. Braille and block glyphs are the only plotting a
 *  terminal has; blocks are used because they degrade to a solid rectangle
 *  in fonts without fine braille coverage, where braille degrades to boxes. */
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
            <Text color={theme.mute}> {fmtCompact(v)}</Text>
          </Box>
        );
      })}
    </Box>
  );
}

/** Fixed-width text table, truncated to the pane. */
export function Table({
  columns,
  rows,
  width,
  maxRows = 6,
}: {
  columns: string[];
  rows: Array<Array<string | number>>;
  width: number;
  maxRows?: number;
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
      {rows.length > shown.length && (
        <Text color={theme.mute}>… {rows.length - shown.length} more</Text>
      )}
    </Box>
  );
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

export function fmtCompact(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const a = Math.abs(n);
  if (a >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return String(Math.round(n * 10) / 10);
}
