// Click-to-focus.
//
// Terminals do not deliver mouse events unless you ask, and then they deliver
// them as escape sequences on stdin — the same stream the keyboard arrives
// on. Two consequences drive everything in this file:
//
//   1. Ink's `useInput` sees those bytes too, and has no idea they are not
//      typing. Left alone, a click appends `[<0;74;12M` to whatever pane you
//      were typing in. The listener here is registered with
//      `prependListener`, so it runs BEFORE Ink's on every chunk and can set
//      a flag that `useInput` checks — which works no matter how Ink chooses
//      to split the sequence up.
//
//   2. The mode is a property of the terminal, not of this process. Exiting
//      without turning it off leaves the user's shell printing garbage on
//      every click, so teardown is wired to unmount, to the signals, and to
//      `exit` — the one case that cannot be covered is SIGKILL.
//
// Mode 1000 is press/release only, deliberately: motion tracking (1002/1003)
// would also capture drags and cost the terminal's own text selection, which
// is how people copy things out of a terminal.

import { useEffect, useRef } from "react";

const ENABLE = "\x1b[?1000h\x1b[?1006h";
const DISABLE = "\x1b[?1006l\x1b[?1000l";

/** SGR report: `ESC [ < button ; col ; row (M|m)`. `M` is press, `m` release. */
const REPORT = /\x1b\[<(\d+);(\d+);(\d+)([Mm])/g;
/** Enough of a report to know a chunk is not typing, even if truncated. */
const PARTIAL = /\x1b\[</;

export type Click = { column: number; row: number };

/**
 * Left-button presses in a chunk of stdin, as 1-based terminal coordinates.
 *
 * Two categories are filtered out and both matter: releases (`m`), which
 * would otherwise fire focus twice per click, and wheel events, which set bit
 * 6 and carry a button number whose low bits look exactly like a left click —
 * scrolling over a pane would steal focus.
 */
export function parseReports(chunk: string): Click[] {
  const out: Click[] = [];
  REPORT.lastIndex = 0;
  let m = REPORT.exec(chunk);
  while (m !== null) {
    const button = Number(m[1]);
    const column = Number(m[2]);
    const row = Number(m[3]);
    const press = m[4] === "M";
    const isLeft = (button & 0b11) === 0 && (button & 64) === 0;
    if (press && isLeft && Number.isFinite(column) && Number.isFinite(row)) {
      out.push({ column, row });
    }
    m = REPORT.exec(chunk);
  }
  return out;
}

/** True while the bytes currently being dispatched are a mouse report.
 *  Cleared in a microtask, which lands after the whole synchronous listener
 *  chain for that chunk has run — including Ink's. */
let swallow = false;

export function swallowingMouseBytes(): boolean {
  return swallow;
}

/** Does this look like a mouse report rather than typing? The leading ESC is
 *  optional because Ink strips it from sequences it does not recognise.
 *
 *  Deliberately demands the complete form: a truncated report is already
 *  covered by the swallow flag, whereas a loose pattern here would eat a
 *  literal `[<` someone typed. */
export function isMouseReport(input: string): boolean {
  return /(?:\x1b)?\[<\d+;\d+;\d+[Mm]/.test(input);
}

/** Opt out for terminals where mouse reporting fights something else, or for
 *  anyone who would rather keep native click-drag selection. */
export function mouseEnabled(): boolean {
  return process.env.SCELO_TUI_MOUSE !== "0";
}

let mouseOn = false;

function disableOnce(): void {
  if (!mouseOn) return;
  mouseOn = false;
  try {
    process.stdout.write(DISABLE);
  } catch {
    // stdout already closed — nothing useful left to do
  }
}

/**
 * Enable mouse reporting and call `onClick` with 1-based terminal
 * coordinates on every left-button press.
 */
export function useMouse(onClick: (c: Click) => void, enabled = true): void {
  // Through a ref so the effect runs exactly once. Depending on `onClick`
  // directly would tear the mode down and bring it back up every time the
  // handler changed identity — which it does on every terminal resize, since
  // it closes over the pane width.
  const handler = useRef(onClick);
  handler.current = onClick;

  useEffect(() => {
    if (!enabled || !mouseEnabled()) return;
    const stdin = process.stdin;
    if (!stdin.isTTY) return;

    process.stdout.write(ENABLE);
    mouseOn = true;

    const onData = (data: Buffer | string) => {
      const s = typeof data === "string" ? data : data.toString("utf8");
      if (!PARTIAL.test(s)) return;
      // Set before Ink's listener runs; cleared once this chunk is fully
      // dispatched.
      swallow = true;
      queueMicrotask(() => {
        swallow = false;
      });
      for (const click of parseReports(s)) handler.current(click);
    };

    // Ahead of Ink's handler, so the flag is already set when it reads.
    stdin.prependListener("data", onData);

    // Turn the mode off, then let the signal do what it was going to do.
    // Re-raising rather than calling `process.exit` keeps every other
    // handler's cleanup — Ink's raw-mode restore in particular — intact.
    const onSignal = (sig: NodeJS.Signals) => {
      disableOnce();
      process.off(sig, onSignal);
      process.kill(process.pid, sig);
    };
    process.on("exit", disableOnce);
    process.on("SIGINT", onSignal);
    process.on("SIGTERM", onSignal);

    return () => {
      stdin.removeListener("data", onData);
      process.off("exit", disableOnce);
      process.off("SIGINT", onSignal);
      process.off("SIGTERM", onSignal);
      disableOnce();
    };
  }, [enabled]);
}
