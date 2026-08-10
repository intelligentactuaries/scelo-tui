// Charts, drawn at sub-cell resolution.
//
// The three panes plot with `BarPlot` — one row per value, one full block per
// step — because a 45-column column has room for a sparkline and nothing
// else. `/charts` has the whole screen, so it draws the picture properly:
// nice-numbered axes, ticks that land on round values, bars whose ends are
// partial blocks rather than rounded-off whole ones, and curves on a braille
// canvas at 2×4 the cell resolution.
//
// The point of the exercise is stated in canvas.ts: pick the glyph family
// whose failure mode matches the shape. Everything here is the layout on top
// of that — where the axis goes, which ticks survive, how many labels fit.
//
// Pure layout, like diagram.ts: no Ink, no React, spans out. That is what
// lets the tests assert the picture as text.

import { createCanvas, dot, hBar, renderCanvas, stroke, vBar } from "./canvas";
import type { DiagramLine, Span } from "./diagram";
import { theme } from "./theme";

export type ChartKind =
  /** One horizontal bar per value — categories with long names. */
  | "bars"
  /** Vertical bars with a gap: ordered categories, few of them. */
  | "columns"
  /** Vertical bars, no gap: a distribution, where the gaps would lie. */
  | "histogram"
  /** A polyline: a series with a real x order (time, deciles). */
  | "line"
  /** A cumulative curve against the equality diagonal. */
  | "lorenz";

export type ChartInput = {
  kind: ChartKind;
  values: number[];
  /** One per value. Placed where they fit and dropped where they do not —
   *  a chart with half its x labels is readable, one with them overlapping
   *  is not. */
  labels?: string[];
  /** Whole-chart budget in cells, axes and labels included. */
  width: number;
  height: number;
  color: string;
  /** Appended to every value and tick label ("%", "×"). */
  unit?: string;
};

/** Compact magnitude for a value shown next to a bar. Lives here rather than
 *  in widgets.tsx so the pure modules can format without importing Ink. */
export function fmtCompact(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const a = Math.abs(n);
  if (a >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return String(Math.round(n * 10) / 10);
}

/**
 * Tick positions a person would have chosen: steps of 1, 2, 2.5 or 5 times a
 * power of ten.
 *
 * Dividing the range into n equal parts is the obvious implementation and it
 * is what makes a plot look computer-generated — axis labels of 0, 23.7,
 * 47.4 carry no more information than 0, 25, 50 and are harder to read
 * against. The returned ticks always span [lo, hi] inclusive of the rounded
 * ends, so the caller can use the first and last as the plotted domain.
 */
export function niceTicks(lo: number, hi: number, count = 4): number[] {
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [0, 1];
  if (hi === lo) {
    // A flat series still needs a scale, or every bar is full height and the
    // axis says nothing. Give it one unit of room around the value.
    const pad = Math.abs(hi) > 0 ? Math.abs(hi) / 2 : 1;
    return niceTicks(lo - pad, hi + pad, count);
  }
  const raw = (hi - lo) / Math.max(1, count);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
  const start = Math.floor(lo / step) * step;
  const end = Math.ceil(hi / step) * step;
  const out: number[] = [];
  // Accumulating by index rather than by `v += step` — repeated addition of
  // 0.1 walks off the round numbers this whole function exists to produce.
  const n = Math.round((end - start) / step);
  for (let i = 0; i <= n; i++) out.push(round12(start + i * step));
  return out;
}

/** Kill the float noise a multiply leaves behind (0.30000000000000004), so a
 *  tick label reads "0.3" without every caller choosing a precision. */
function round12(v: number): number {
  return Number(v.toPrecision(12));
}

/**
 * One formatter for a whole series, never per value — the alternative is an
 * axis reading 1000 / 1.2k / 1.5k, which looks like two different scales.
 * Trailing zeros stay, so 0.50 lines up under 0.75.
 *
 * Ticks take their precision from the STEP: whole counts stepping by 5 want
 * "45", not "45.0", and the only thing that knows the difference is the gap
 * between one tick and the next.
 */
function tickFormat(ticks: number[], unit: string): (v: number) => string {
  const step = Math.abs((ticks[1] ?? 1) - (ticks[0] ?? 0)) || 1;
  const span = Math.abs((ticks[ticks.length - 1] ?? 1) - (ticks[0] ?? 0)) || 1;
  if (span >= 10_000) return (v) => fmtCompact(v) + unit;
  const decimals = Math.min(4, Math.max(0, -Math.floor(Math.log10(step) + 1e-9)));
  return (v) => v.toFixed(decimals) + unit;
}

/**
 * The same job for the numbers beside a set of bars, where there are no
 * ticks to take a step from — so the precision comes from the span, at the
 * count that keeps neighbours distinguishable: correlations (span ~1) need
 * two, percentages (span ~50) need one, and past ten thousand the magnitude
 * suffix carries more than the digits do.
 *
 * Exported because the panes' `BarPlot` has the same problem in forty
 * columns: `fmtCompact` alone labelled a correlation screen 0.9 / 0 / 0 / 0,
 * where three different pairs printed the same number.
 */
export function seriesFormat(values: number[], unit = ""): (v: number) => string {
  const finite = values.filter((v) => Number.isFinite(v));
  const span = finite.length === 0 ? 1 : Math.max(...finite.map(Math.abs));
  return valueFormat(span, unit);
}

function valueFormat(span: number, unit: string): (v: number) => string {
  const s = Math.abs(span) || 1;
  if (s >= 10_000) return (v) => fmtCompact(v) + unit;
  const decimals = s >= 100 ? 0 : s >= 10 ? 1 : 2;
  return (v) => v.toFixed(decimals) + unit;
}

function padLeft(s: string, n: number): string {
  return s.length >= n ? s.slice(0, n) : " ".repeat(n - s.length) + s;
}

function padRight(s: string, n: number): string {
  return s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length);
}

function cut(s: string, n: number): string {
  if (n <= 0) return "";
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

/**
 * The chart, as coloured rows.
 *
 * Returns an empty array rather than a degraded picture when the budget
 * cannot hold one — a two-row "chart" is a rounding error with a legend, and
 * the caller has better things to put in two rows.
 */
export function drawChart(input: ChartInput): DiagramLine[] {
  const values = input.values.filter((v) => Number.isFinite(v));
  if (values.length === 0 || input.width < 12 || input.height < 3) return [];
  if (input.kind === "bars") return drawBars({ ...input, values });
  // More bars than the plot has columns and each bar is one column wide,
  // which is not a bar chart — it is a curve drawn badly. So draw the curve.
  // (A 200-bin histogram in 70 columns is the case; the analyses that make
  // ten deciles or eight pairs never reach it.)
  const kind = values.length > input.width - 8 ? "line" : input.kind;
  return drawPlot({ ...input, kind, values });
}

// ── horizontal bars ───────────────────────────────────────────────────────

/**
 * One row per category: label, bar, value.
 *
 * Horizontal because the labels are the reason to choose this shape —
 * `spatial_density_sqft_per_resident` under a vertical column is either
 * truncated to nothing or rotated, and a terminal cannot rotate.
 */
function drawBars(input: ChartInput & { values: number[] }): DiagramLine[] {
  const { values, width, height, color, unit = "" } = input;
  // One row goes to the "… N more" note when the budget cannot hold every
  // bar — a chart that silently shows the top five of forty is a chart that
  // lies about how many segments there are.
  const room = Math.max(1, height);
  const rows = values.length > room ? room - 1 : values.length;
  const shown = values.slice(0, Math.max(1, rows));
  const labels = (input.labels ?? []).slice(0, shown.length);
  // Negative bars would need a two-sided axis; nothing on the analysis menu
  // produces one (|r|, counts, totals, shares), so the honest handling is to
  // scale on magnitude and let the value column carry the sign.
  const peak = Math.max(...shown.map(Math.abs), Number.MIN_VALUE);
  const valueText = shown.map(seriesFormat(shown, unit));
  const valueW = Math.max(...valueText.map((t) => t.length));
  const labelW =
    labels.length > 0 ? Math.min(24, Math.max(...labels.map((l) => l.length))) : 0;
  // 2 spaces after the label, 1 before the value.
  const barW = width - labelW - valueW - 3;
  if (barW < 4) return [];
  const out: DiagramLine[] = [];
  for (let i = 0; i < shown.length; i++) {
    const line: Span[] = [];
    if (labelW > 0) {
      line.push({ text: `${padRight(cut(labels[i] ?? "", labelW), labelW)}  `, color: theme.mute });
    }
    const bar = hBar(Math.abs(shown[i]) / peak, barW);
    line.push({ text: bar, color });
    line.push({ text: " ".repeat(Math.max(0, barW - [...bar].length)) });
    line.push({ text: ` ${padLeft(valueText[i], valueW)}`, color: theme.mute });
    out.push(line);
  }
  if (values.length > shown.length) {
    out.push([{ text: `… ${values.length - shown.length} more`, color: theme.mute }]);
  }
  return out;
}

// ── everything with an axis ───────────────────────────────────────────────

/**
 * Columns, histograms and curves share a frame — y ticks down the left, a
 * rule along the bottom, x labels under it — so they share the code that
 * draws it and differ only in what fills the plot area.
 */
function drawPlot(input: ChartInput & { values: number[] }): DiagramLine[] {
  const { values, kind, width, height, color, unit = "" } = input;

  // Bars baseline at zero, always. A bar encodes its value as LENGTH, so
  // cropping the axis to [min, max] multiplies every difference between them
  // — the oldest way to lie with a chart. A curve encodes value as position
  // against a labelled axis, where the same crop is just a zoom, so a line
  // gets the data's own range and fills the plot with it.
  const dataLo = Math.min(...values);
  const dataHi = Math.max(...values);
  const barLike = kind === "columns" || kind === "histogram";
  const lo = barLike ? Math.min(0, dataLo) : dataLo;
  const hi = Math.max(dataHi, lo + Number.MIN_VALUE);
  const ticks = niceTicks(lo, hi, Math.min(5, Math.max(2, Math.floor((height - 2) / 2))));
  const fmt = tickFormat(ticks, unit);
  const domainLo = ticks[0];
  const domainHi = ticks[ticks.length - 1];
  const gutter = Math.max(...ticks.map((t) => fmt(t).length));

  const hasLabels = (input.labels ?? []).some((l) => l !== "");
  const plotH = height - 1 - (hasLabels ? 1 : 0);
  // The gutter, one space between the numbers and the rule (without it they
  // read as part of the plot), and the rule itself.
  const plotW = width - gutter - 2;
  if (plotH < 2 || plotW < 6) return [];

  const area =
    kind === "line" || kind === "lorenz"
      ? curveRows(values, kind, plotW, plotH, domainLo, domainHi, color)
      : columnRows(values, kind, plotW, plotH, domainLo, domainHi, color);

  // Which plot rows carry a tick label. Row 0 is the top of the area, so a
  // tick's row is its distance DOWN from the domain's ceiling.
  const labelled = new Map<number, string>();
  for (const t of ticks) {
    const frac = (domainHi - t) / (domainHi - domainLo || 1);
    const row = Math.round(frac * (plotH - 1));
    if (row >= 0 && row < plotH && !labelled.has(row)) labelled.set(row, fmt(t));
  }

  const out: DiagramLine[] = [];
  for (let r = 0; r < plotH; r++) {
    const label = labelled.get(r);
    out.push([
      { text: `${padLeft(label ?? "", gutter)} `, color: theme.mute },
      { text: label ? "┤" : "│", color: theme.chrome },
      ...(area[r] ?? []),
    ]);
  }
  out.push([
    { text: " ".repeat(gutter + 1) },
    { text: `└${"─".repeat(plotW)}`, color: theme.chrome },
  ]);
  if (hasLabels) {
    out.push([
      { text: " ".repeat(gutter + 2) },
      { text: xLabelRow(input.labels ?? [], values.length, kind, plotW), color: theme.mute },
    ]);
  }
  return out;
}

/**
 * Where a value sits along the x axis, and how wide it is. Shared by the
 * columns and the x labels, so a label lands under the thing it names.
 *
 * Bars occupy a slot: every one the SAME width, with the leftover columns
 * becoming margin rather than the remainder being spread so some bars come
 * out a column wider. Unequal widths are a real error in a histogram — bar
 * area is what the eye reads as frequency — and even on a plain column chart
 * they look like a rendering fault.
 *
 * A curve has no slot. Its points are spread across the full plot with the
 * first ON the axis and the last at the right edge, which is where the
 * labels have to go too: slot centres put "2021-01" three columns to the
 * right of the point it labels.
 */
function slots(n: number, kind: ChartKind, plotW: number): { at: number; w: number }[] {
  if (kind === "line" || kind === "lorenz") {
    return Array.from({ length: n }, (_, i) => ({
      at: n === 1 ? 0 : Math.round((i * (plotW - 1)) / (n - 1)),
      w: 1,
    }));
  }
  const gap = kind === "histogram" || n * 2 - 1 > plotW ? 0 : 1;
  const w = Math.max(1, Math.floor((plotW - gap * (n - 1)) / n));
  const used = n * w + gap * (n - 1);
  const left = Math.max(0, Math.floor((plotW - used) / 2));
  return Array.from({ length: n }, (_, i) => ({ at: left + i * (w + gap), w }));
}

function columnRows(
  values: number[],
  kind: ChartKind,
  plotW: number,
  plotH: number,
  lo: number,
  hi: number,
  color: string,
): Span[][] {
  const span = hi - lo || 1;
  const cells = slots(values.length, kind, plotW);
  // A grid of glyphs, then coalesced into spans per row. Building it
  // column-first is the natural way to draw a bar and the wrong way to write
  // to a terminal, so it is transposed once at the end.
  const grid: string[][] = Array.from({ length: plotH }, () => new Array<string>(plotW).fill(" "));
  for (let i = 0; i < values.length; i++) {
    const { at, w } = cells[i];
    const col = vBar((values[i] - lo) / span, plotH);
    for (let r = 0; r < plotH; r++) {
      for (let c = at; c < Math.min(plotW, at + w); c++) grid[r][c] = col[r];
    }
  }
  return grid.map((row) => {
    const line: Span[] = [];
    let run = "";
    let inked = false;
    for (const ch of row) {
      const on = ch !== " ";
      if (run !== "" && on !== inked) {
        line.push(inked ? { text: run, color } : { text: run });
        run = "";
      }
      inked = on;
      run += ch;
    }
    if (run !== "") line.push(inked ? { text: run, color } : { text: run });
    return line;
  });
}

function curveRows(
  values: number[],
  kind: ChartKind,
  plotW: number,
  plotH: number,
  lo: number,
  hi: number,
  color: string,
): Span[][] {
  const canvas = createCanvas(plotW, plotH);
  const span = hi - lo || 1;
  const xAt = (i: number) =>
    values.length === 1 ? 0 : (i * (canvas.w - 1)) / (values.length - 1);
  const yAt = (v: number) => (1 - (v - lo) / span) * (canvas.h - 1);

  // The equality diagonal FIRST, so where the curve meets it the curve owns
  // the cell — see the last-wins rule in canvas.ts. Dotted rather than solid
  // so it reads as a reference and not as a second measurement.
  if (kind === "lorenz") {
    const yOnDiagonal = (x: number) => (1 - x / (canvas.w - 1)) * (canvas.h - 1);
    // Dashes, not dots: a dot every third column drifts between rows as the
    // diagonal climbs and reads as a second, noisier series.
    for (let x = 0; x < canvas.w; x += 12) {
      const to = Math.min(canvas.w - 1, x + 7);
      stroke(canvas, x, yOnDiagonal(x), to, yOnDiagonal(to), theme.chrome);
    }
  }
  for (let i = 0; i < values.length; i++) {
    const x = xAt(i);
    const y = yAt(values[i]);
    if (i > 0) stroke(canvas, xAt(i - 1), yAt(values[i - 1]), x, y, color);
    else dot(canvas, x, y, color);
  }
  return renderCanvas(canvas);
}

/**
 * X labels, placed under their own slot and dropped where they would collide.
 *
 * The FIRST and LAST are placed before anything else, then the rest fill in
 * greedily. Plain left-to-right greed is what a first attempt does and it
 * always loses the last label — which on a time series is the one the reader
 * came for ("…up to when?"). Showing every k-th label instead has the same
 * bug and adds a rhythm the data does not have.
 */
function xLabelRow(labels: string[], n: number, kind: ChartKind, plotW: number): string {
  const cells = slots(n, kind, plotW);
  const row = new Array<string>(plotW).fill(" ");
  const taken: Array<[number, number]> = [];
  const place = (i: number): void => {
    const raw = labels[i];
    if (!raw) return;
    const text = cut(raw, 12);
    const { at, w } = cells[i];
    // Centred under the slot, then pulled back inside the plot.
    const start = Math.max(0, Math.min(plotW - text.length, at + Math.floor((w - text.length) / 2)));
    const end = start + text.length;
    if (end > plotW) return;
    // One blank column between neighbours, or two labels read as one word.
    if (taken.some(([s, e]) => start < e + 1 && s < end + 1)) return;
    for (let c = 0; c < text.length; c++) row[start + c] = text[c];
    taken.push([start, end]);
  };
  place(0);
  if (n > 1) place(n - 1);
  for (let i = 1; i < n - 1; i++) place(i);
  return row.join("").trimEnd();
}
