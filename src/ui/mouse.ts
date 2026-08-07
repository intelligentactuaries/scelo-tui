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

/** Report payloads that arrive WITHOUT their `ESC[<` prefix. A terminal is
 *  free to split a report across read chunks (RStudio's xterm.js does), and
 *  the continuation half — `0;95;34M` — carries no escape byte for anyone
 *  to recognise, so it walks straight into the composer as "typing". Nobody
 *  types `digits;digits;digitsM`, so stripping the shape wholesale is safe. */
const NOISE = /(?:\x1b?\[?<?)?\d{1,4};\d{1,4};\d{1,4}[Mm]/g;

export function stripMouseNoise(s: string): string {
  NOISE.lastIndex = 0;
  return s.replace(NOISE, "");
}

/**
 * Per-chunk swallow decision for the stdin listener, tracking split reports.
 *
 * The plain `PARTIAL` test catches any chunk carrying `ESC[<` — but when a
 * report is cut mid-sequence, the NEXT chunk is bare digits (`4M\x1b[<…` or
 * just `5;34`) and would pass for typing. The classifier remembers that the
 * previous chunk ended mid-report and swallows continuations too.
 */
export function makeChunkClassifier(): (s: string) => boolean {
  let dangling = false;
  return (s: string): boolean => {
    const continuation = dangling && /^[0-9;Mm]/.test(s);
    const shouldSwallow = PARTIAL.test(s) || continuation;
    dangling =
      /\x1b\[<?[0-9;]*$/.test(s) || (continuation && /^[0-9;]+$/.test(s));
    return shouldSwallow;
  };
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

/**
 * A report that arrived TRUNCATED and was flushed as ordinary input.
 *
 * The swallow flag only covers events Ink dispatches synchronously for the
 * chunk that set it. When a terminal splits an SGR report across two reads
 * (RStudio's xterm.js does), Ink holds the incomplete `\x1b[<0;100;10` as a
 * pending escape and emits it as a plain input event ~20ms later, by which
 * time the flag is long cleared — so `[<0;100;10` gets typed into whatever
 * pane had focus. Neither `isMouseReport` nor `stripMouseNoise` catches it:
 * both demand the complete `digits;digits;digits[Mm]` form.
 *
 * Nobody types `[<` followed by only digits and semicolons, so recognising
 * the prefix is safe. Only consulted while reporting is actually on.
 */
export function isMouseFragment(input: string): boolean {
  return /^(?:\x1b)?\[<[\d;]*[Mm]?$/.test(input);
}

// ── the copy/paste trade, and which side of it we default to ─────────────
//
// While mouse reporting is on, the terminal routes button events to US, and
// dragging stops selecting text. Every emulator offers shift-drag as the
// bypass (VTE, xterm, Konsole, Windows Terminal, iTerm all honour it) — but
// that is a thing you have to KNOW, and the symptom of not knowing it is
// "I cannot copy anything from this window", which is a terrible first hour
// with a tool whose whole job is handing you numbers.
//
// So reporting is OFF unless asked for. Selecting a column and pressing
// ctrl-shift-c is what every other program in the session does, and it keeps
// working here. Clicks are one command away (`/mouse on`), the affordances
// that need them say so where they appear, and tab reaches every pane
// regardless — nothing is only reachable by mouse.
//
// SCELO_TUI_MOUSE=1 starts a session with clicks already on; =0 forbids them
// outright, for a terminal where reporting fights something else.

/** May reporting be turned on at all? `=0` is a hard veto — `/mouse on`
 *  cannot override it — for terminals where the mode breaks something. */
export function mouseAllowed(): boolean {
  return process.env.SCELO_TUI_MOUSE !== "0";
}

/** Should a fresh session start with clicks on? Off unless asked, so that
 *  drag-to-select — the thing every other window does — works out of the
 *  box. */
export function mouseDefault(): boolean {
  return mouseAllowed() && process.env.SCELO_TUI_MOUSE === "1";
}

/** Runtime override from `/mouse`. null means "follow the environment". */
let userWants: boolean | null = null;
/** Set by the hook so the command can re-arm without a re-render. */
let applyMode: ((on: boolean) => void) | null = null;

export function mouseActive(): boolean {
  return userWants ?? mouseDefault();
}

/** Turn reporting on/off now. Returns the state actually reached — a
 *  non-TTY (or SCELO_TUI_MOUSE=0) cannot be turned on. */
export function setMouseActive(on: boolean): boolean {
  const reachable = on && mouseAllowed();
  // Record what was REACHED, not what was wished for: storing an impossible
  // `true` made mouseActive() report "on" for a session where reporting can
  // never be enabled, so the next bare `/mouse` toggled it "off" and
  // announced a change that never happened.
  userWants = reachable;
  applyMode?.(reachable);
  return reachable;
}

// ── the bracketed-paste deadlock hatch ────────────────────────────────────
//
// Ink's input parser buffers everything after `ESC[200~` until the matching
// `ESC[201~` arrives, emitting NO events meanwhile. If the end marker never
// comes — an ssh drop or an emulator crash mid-paste — every later keystroke
// is swallowed forever, and because raw mode means ctrl-c raises no SIGINT,
// even quitting is gone: the app can only be killed from another terminal.
//
// This listener sits AHEAD of Ink's and sees the raw bytes regardless, so it
// can still honour ctrl-c. It is a hatch, not a paste implementation: it only
// notices that a paste opened and never closed, and only acts on \x03.

const PASTE_START = "\x1b[200~";
const PASTE_END = "\x1b[201~";
let pasteOpen = false;

export function watchPasteDeadlock(chunk: string): void {
  const lastStart = chunk.lastIndexOf(PASTE_START);
  const lastEnd = chunk.lastIndexOf(PASTE_END);
  if (lastStart !== -1 || lastEnd !== -1) pasteOpen = lastStart > lastEnd;
  // ctrl-c inside a paste body is legitimate clipboard content; ctrl-c in a
  // chunk of its own, while a paste has been hanging open, is a person
  // trying to leave.
  if (pasteOpen && chunk === "\x03") {
    disableOnce();
    process.stdout.write(`${PASTE_END}\x1b[?2004l`);
    process.exit(130);
  }
}

/** Test seam — the flag is module state that survives between chunks. */
export function resetPasteWatch(): void {
  pasteOpen = false;
}

/**
 * Install the hatch. Its own effect, deliberately: it used to ride on the
 * mouse listener, which meant `SCELO_TUI_MOUSE=0` — the setting /help
 * recommends to anyone whose terminal fights mouse reporting — removed the
 * only way out of a truncated paste. The two have nothing to do with each
 * other.
 */
export function usePasteDeadlockHatch(): void {
  useEffect(() => {
    const stdin = process.stdin;
    if (!stdin.isTTY) return;
    const onData = (data: Buffer | string) => {
      watchPasteDeadlock(typeof data === "string" ? data : data.toString("utf8"));
    };
    stdin.prependListener("data", onData);
    return () => {
      stdin.removeListener("data", onData);
      pasteOpen = false;
    };
  }, []);
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
    if (!enabled || !mouseAllowed()) return;
    const stdin = process.stdin;
    if (!stdin.isTTY) return;

    const enable = () => {
      if (mouseOn) return;
      process.stdout.write(ENABLE);
      mouseOn = true;
    };
    // `mouseActive()`, not an unconditional enable: ctrl-o unmounts the panes
    // for the model picker and mounts them again on the way back, and a
    // remount used to silently undo `/mouse off` — taking click-drag text
    // selection away from someone who had just asked for it.
    if (mouseActive()) enable();
    // `/mouse off` writes DISABLE without tearing this effect down: the
    // listener stays attached (it costs nothing when no reports arrive) so
    // `/mouse on` is a single write rather than a remount.
    applyMode = (on: boolean) => {
      if (on) enable();
      else disableOnce();
    };

    const classify = makeChunkClassifier();
    const onData = (data: Buffer | string) => {
      const s = typeof data === "string" ? data : data.toString("utf8");
      if (!classify(s)) return;
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
    process.on("SIGHUP", onSignal);

    return () => {
      applyMode = null;
      stdin.removeListener("data", onData);
      process.off("exit", disableOnce);
      process.off("SIGINT", onSignal);
      process.off("SIGTERM", onSignal);
      process.off("SIGHUP", onSignal);
      disableOnce();
    };
  }, [enabled]);
}
