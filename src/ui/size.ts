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

/** The three pane widths, summing to EXACTLY `cols` so the borders span the
 *  full terminal. Equal thirds, with the 0–2 leftover columns absorbed by
 *  the last pane — invisible at that scale, and it keeps one shared content
 *  width for the first two panes. (The old `floor((cols - 8) / 3)` left up
 *  to ten columns of dead space on the right.) */
export function paneWidths(cols: number): { paneW: number; lastW: number } {
  const paneW = Math.max(20, Math.floor(cols / 3));
  const lastW = Math.max(20, cols - 2 * paneW);
  return { paneW, lastW };
}
