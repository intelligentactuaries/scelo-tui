// A sub-cell drawing surface — the thing that makes a terminal chart stop
// looking like a terminal chart.
//
// A cell is the smallest rectangle a TUI can colour, so one-value-per-cell
// plotting quantises every shape to a ~8×17-pixel grid: that staircase is
// what people mean by a "low-poly" terminal plot. Unicode gives three glyph
// families that address points INSIDE a cell, and each one buys resolution
// back along a different axis:
//
//   braille  ⠿  2 × 4 dots   → 8 addressable points per cell, both axes
//   left eighths ▏▎▍▌▋▊▉█    → 8 steps across, drawn SOLID
//   lower eighths ▁▂▃▄▅▆▇█   → 8 steps up, drawn SOLID
//
// Braille is the only family with precision in both directions, so it draws
// curves and scatter. It is also visibly dotty in most fonts, which is
// exactly wrong for anything that should read as a solid mass — so bars,
// columns and area fills use the block eighths instead. That split is the
// whole design: pick the family whose FAILURE mode matches the shape.
//
// Pure geometry — no Ink, no React, and no knowledge of what is being
// plotted. charts.ts owns the axes and the labels; this owns the ink.

import type { DiagramLine, Span } from "./diagram";

// ── braille ───────────────────────────────────────────────────────────────
//
// U+2800 + a bitmask. The bit order is the historical 6-dot layout with the
// 8-dot extension bolted underneath, which is why the bottom row is 0x40/0x80
// rather than continuing the doubling — hard-coded rather than computed
// because deriving it is more code than stating it.
//
//     (0,0) 0x01   (1,0) 0x08
//     (0,1) 0x02   (1,1) 0x10
//     (0,2) 0x04   (1,2) 0x20
//     (0,3) 0x40   (1,3) 0x80
const DOT_BITS = [
  [0x01, 0x02, 0x04, 0x40],
  [0x08, 0x10, 0x20, 0x80],
];

/** Dots per cell. Everything in dot coordinates divides by these. */
export const DOT_W = 2;
export const DOT_H = 4;

export type Canvas = {
  /** Size in cells — what the caller budgeted on screen. */
  cols: number;
  rows: number;
  /** Size in dots: `cols * 2` by `rows * 4`. The coordinate space of every
   *  drawing call, with (0,0) at the TOP-LEFT — screen order, not maths
   *  order. charts.ts flips the y axis once, at the point where a data value
   *  becomes a dot, rather than every draw call second-guessing it. */
  w: number;
  h: number;
  /** Braille bitmask per cell, row-major. */
  bits: Uint8Array;
  /** Colour per cell, row-major. */
  colors: Array<string | undefined>;
};

export function createCanvas(cols: number, rows: number): Canvas {
  const c = Math.max(1, Math.floor(cols));
  const r = Math.max(1, Math.floor(rows));
  return {
    cols: c,
    rows: r,
    w: c * DOT_W,
    h: r * DOT_H,
    bits: new Uint8Array(c * r),
    colors: new Array<string | undefined>(c * r).fill(undefined),
  };
}

/**
 * Set one dot.
 *
 * A cell has one colour and eight dots, so two series crossing inside one
 * cell have to agree on something: the rule is LAST WINS. Callers draw
 * furniture (baselines, gridlines, reference diagonals) before data for
 * exactly this reason — where they overlap, the data owns the cell.
 *
 * Out-of-range coordinates are dropped rather than clamped. Clamping would
 * smear a point that fell off the axis onto the edge of the plot, which
 * reads as data.
 */
export function dot(canvas: Canvas, x: number, y: number, color?: string): void {
  const xi = Math.round(x);
  const yi = Math.round(y);
  if (xi < 0 || yi < 0 || xi >= canvas.w || yi >= canvas.h) return;
  const cell = (yi >> 2) * canvas.cols + (xi >> 1);
  canvas.bits[cell] |= DOT_BITS[xi & 1][yi & 3];
  if (color !== undefined) canvas.colors[cell] = color;
}

/** A straight run of dots between two points (Bresenham). What turns a list
 *  of samples into a line somebody can read — plotting the points alone
 *  leaves a dotted cloud at anything past a handful of values. */
export function stroke(
  canvas: Canvas,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  color?: string,
): void {
  let x = Math.round(x0);
  let y = Math.round(y0);
  const xe = Math.round(x1);
  const ye = Math.round(y1);
  const dx = Math.abs(xe - x);
  const dy = -Math.abs(ye - y);
  const sx = x < xe ? 1 : -1;
  const sy = y < ye ? 1 : -1;
  let err = dx + dy;
  // Bounded by the canvas diagonal — a guard against a NaN coordinate
  // turning a draw call into an infinite loop, which in a TUI is a hang with
  // no error to show for it.
  const limit = canvas.w + canvas.h + 4;
  for (let i = 0; i < limit; i++) {
    dot(canvas, x, y, color);
    if (x === xe && y === ye) return;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
}

/** A vertical run — the common case, kept off the general path because a
 *  chart draws one per sample and Bresenham's setup is pure overhead. */
export function strokeV(
  canvas: Canvas,
  x: number,
  y0: number,
  y1: number,
  color?: string,
): void {
  const lo = Math.round(Math.min(y0, y1));
  const hi = Math.round(Math.max(y0, y1));
  for (let y = lo; y <= hi; y++) dot(canvas, x, y, color);
}

/**
 * The canvas as coloured spans, one array per cell row.
 *
 * Cells with no dots become spaces rather than U+2800: the blank braille
 * pattern is a real glyph, and fonts that give it a background box turn an
 * empty plot area into a grey slab. Adjacent cells of one colour coalesce
 * into a single span so a 100-column chart hands Ink ~4 nodes per row
 * instead of 100.
 */
export function renderCanvas(canvas: Canvas): DiagramLine[] {
  const out: DiagramLine[] = [];
  for (let r = 0; r < canvas.rows; r++) {
    const line: Span[] = [];
    let text = "";
    let color: string | undefined;
    let open = false;
    for (let c = 0; c < canvas.cols; c++) {
      const i = r * canvas.cols + c;
      const bits = canvas.bits[i];
      const ch = bits === 0 ? " " : String.fromCodePoint(0x2800 + bits);
      const col = bits === 0 ? undefined : canvas.colors[i];
      if (open && col === color) {
        text += ch;
      } else {
        if (open) line.push({ text, color });
        text = ch;
        color = col;
        open = true;
      }
    }
    if (open && text !== "") line.push({ text, color });
    out.push(line);
  }
  return out;
}

// ── solid blocks ──────────────────────────────────────────────────────────

/** Left-filling eighths: index 0 is empty, 8 is a full cell. */
const LEFT_EIGHTHS = ["", "▏", "▎", "▍", "▌", "▋", "▊", "▉", "█"];
/** Bottom-filling eighths, same convention. */
const LOWER_EIGHTHS = ["", "▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];

/** Eighths of a cell, clamped to the track — the shared rounding step, so a
 *  bar and a column of the same value never disagree about their length. */
function eighths(fraction: number, cells: number): number {
  if (!Number.isFinite(fraction) || fraction <= 0) return 0;
  return Math.min(cells * 8, Math.round(Math.min(1, fraction) * cells * 8));
}

/**
 * A horizontal bar `cells` wide, filled to `fraction` of its track.
 *
 * The tail is a partial block rather than a rounded-off whole one, so two
 * segments differing by 3% differ visibly instead of landing on the same
 * glyph count. A non-zero value always draws at least one eighth: a segment
 * that exists and a segment that does not must not look identical.
 */
export function hBar(fraction: number, cells: number): string {
  const track = Math.max(0, Math.floor(cells));
  if (track === 0) return "";
  const units = eighths(fraction, track);
  if (units === 0) return fraction > 0 ? LEFT_EIGHTHS[1] : "";
  return "█".repeat(Math.floor(units / 8)) + LEFT_EIGHTHS[units % 8];
}

/**
 * One column of a vertical bar chart, top row first.
 *
 * Returned as a column rather than drawn into a grid because the caller
 * assembles rows across every column at once — a chart is transposed
 * relative to how a terminal writes.
 */
export function vBar(fraction: number, cells: number): string[] {
  const track = Math.max(0, Math.floor(cells));
  const col = new Array<string>(track).fill(" ");
  if (track === 0) return col;
  let units = eighths(fraction, track);
  if (units === 0 && fraction > 0) units = 1;
  const full = Math.floor(units / 8);
  const rem = units % 8;
  for (let i = 0; i < full; i++) col[track - 1 - i] = "█";
  if (rem > 0 && full < track) col[track - 1 - full] = LOWER_EIGHTHS[rem];
  return col;
}
