// Live terminal geometry.
//
// Ink's `useStdout` hands over the stream but does NOT re-render when the
// terminal is resized — `stdout.columns` read during render is whatever the
// size happened to be at mount. Inside a resizable host pane (RStudio's
// Terminal tab, VS Code's panel, a tiling WM) that freezes the layout at
// launch width: widen the pane and the TUI keeps hugging the left edge with
// a dead column of nothing on the right. This hook subscribes to the
// stream's 'resize' event (SIGWINCH under the hood) so the layout tracks
// the real size for the whole session.

import { useStdout } from "ink";
import { useEffect, useState } from "react";

export function useTerminalSize(): { cols: number; rows: number } {
  const { stdout } = useStdout();
  const [size, setSize] = useState(() => ({
    cols: stdout?.columns ?? 80,
    rows: stdout?.rows ?? 24,
  }));
  useEffect(() => {
    if (!stdout) return;
    const update = () =>
      setSize((prev) => {
        const cols = stdout.columns ?? 80;
        const rows = stdout.rows ?? 24;
        // Same-value writes still schedule renders; bail so a no-op
        // SIGWINCH (some emulators fire it on focus) repaints nothing.
        return prev.cols === cols && prev.rows === rows ? prev : { cols, rows };
      });
    // The stream can report a different size by the time effects run than
    // it did at first render — sync once on mount, then follow events.
    update();
    stdout.on("resize", update);
    return () => {
      stdout.off("resize", update);
    };
  }, [stdout]);
  return size;
}

/**
 * Is this window taller than it is wide — as it LOOKS, not as it counts?
 *
 * A terminal cell is about twice as tall as it is wide, so 87x51 is a
 * portrait window even though 87 > 51. Getting that backwards would put the
 * stack on landscape terminals, which is the layout it exists to avoid.
 */
export function isPortrait(cols: number, rows: number): boolean {
  return cols < rows * CELL_ASPECT;
}

/** Height-to-width of a terminal cell in the fonts this runs in. Close
 *  enough at 2: the decision only has to be right near the diagonal, and
 *  nothing on either side of it is a near-square window anyone works in. */
const CELL_ASPECT = 2;

/** The three pane widths, summing to EXACTLY `cols` so the borders span the
 *  full terminal. Equal thirds, with the 0–2 leftover columns absorbed by
 *  the last pane — invisible at that scale, and it keeps one shared content
 *  width for the first two panes. */
export function paneWidths(cols: number): { paneW: number; lastW: number } {
  const paneW = Math.max(20, Math.floor(cols / 3));
  const lastW = Math.max(20, cols - 2 * paneW);
  return { paneW, lastW };
}

/**
 * The three pane heights, summing to EXACTLY `bodyH` so the stack fills the
 * terminal with no dead strip at the bottom.
 *
 * Not equal thirds. The focused pane is the one being read and typed into,
 * and three equal shares of a 46-row terminal leave each pane about four
 * rows of content once its chrome and chat block are paid for — which is
 * nowhere to put a table. So the focused pane takes a share from the other
 * two, capped so an unfocused pane never drops below what its own furniture
 * needs. The remainder lands on the focused pane, where an extra row is
 * worth the most.
 */
export function paneHeights(bodyH: number, focusIndex: number): [number, number, number] {
  const base = Math.floor(bodyH / 3);
  const give = Math.max(0, Math.min(base - MIN_PANE_ROWS, Math.round(base / 6)));
  const quiet = base - give;
  const out: [number, number, number] = [quiet, quiet, quiet];
  out[Math.min(2, Math.max(0, focusIndex))] = bodyH - 2 * quiet;
  return out;
}

/** What an unfocused pane cannot go below: its two borders and title, the
 *  rule above the chat, one line of transcript, and the composer's frame. */
export const MIN_PANE_ROWS = 3 + 1 + 1 + 3;

/**
 * Rows the chat block should give its transcript in a pane this tall.
 *
 * Fixed at six it was fine in a full-height column and impossible in a
 * stacked third: `minHeight` on the transcript does not shrink, so the pane
 * overflows its row and Ink squashes its other children instead — the
 * symptom being section headings that silently vanish, not an error. Capped
 * at four rather than six for the same reason: in a stack those two rows are
 * worth more to the pane's own content than to a fourth-oldest reply.
 */
export function chatLines(paneRows: number): number {
  return Math.max(1, Math.min(4, paneRows - 11));
}

/**
 * Rows the chat block costs a pane.
 *
 * A collapsed pane keeps its rule and one line of the last reply and drops
 * the composer — only the focused pane can be typed into, so the other two
 * spend those rows on their own content instead. Without this the stack does
 * not fit: three full chat blocks at six transcript lines each is 33 rows
 * before a single pane has drawn anything of its own.
 */
export function chatRows(paneRows: number, focused: boolean): number {
  return focused ? 1 + 1 + chatLines(paneRows) + 3 : 1 + 1;
}
