// Terminal palette.
//
// The TUI has no idea whether it is on a dark terminal or a light one —
// RStudio's Terminal pane, where this app spends much of its life, is
// white-backed, and the palette that shipped first (`fg: "white"`,
// `mute: "gray"`) painted white-on-white there: the composer draft and the
// output pane were unreadable. Two rules now govern every entry:
//
//   1. Primary reading text is the terminal's DEFAULT foreground
//      (`undefined` — black on light themes, white on dark). The terminal
//      already solved this problem; don't overrule it.
//   2. Everything that does carry a colour is a hand-picked truecolor
//      mid-tone that clears ~4:1 contrast against BOTH white and black, so
//      no theme choice can wash it out. Named ANSI colours are out — what
//      "gray" or "yellow" renders as is the emulator's mood.
//
// (Terminals without truecolor quantise these to the nearest 256-colour
// cell, which keeps the mid-tone property.)

export const theme: {
  fg: string | undefined;
  mute: string;
  chrome: string;
  soft: string;
  tools: string;
  hard: string;
  ok: string;
  warn: string;
  err: string;
  you: string;
  bot: string | undefined;
  /** The brand mark's warm orange — also the welcome box's border. */
  mascot: string;
} = {
  /** Primary reading text — the terminal's own default foreground. */
  fg: undefined,
  /** Secondary — labels, units, counts. ~4.5:1 on white AND black. */
  mute: "#767676",
  /** Structural chrome: borders, rules. Decorative, may sit lighter. */
  chrome: "#8a8a8a",

  /** Stage accents, one per pane, so a glance tells you where you are. */
  soft: "#0891b2",
  tools: "#c026d3",
  hard: "#059669",

  ok: "#059669",
  warn: "#b45309",
  err: "#dc2626",
  /** Whoever is speaking in a chat pane. */
  you: "#0891b2",
  bot: undefined,

  mascot: "#d97757",
};

// Two layouts, and each runs out of a different thing.
//
// Side by side is the default and the better one: three full-height panes,
// each with its own composer and room for a table under a diagram. It needs
// width, and below ~45 columns a pane cannot hold a results table.
//
// Stacked — soft above tools above hard — is what a PORTRAIT window gets,
// where there is no width to divide but plenty of height. It reads the way
// the pipeline runs, and it is the reason an 87x51 terminal shows a
// workstation instead of "terminal too small".
/** Side by side: three panes of ~45 columns, and the rows for a chat block. */
export const WIDE_MIN_WIDTH = 140;
export const WIDE_MIN_HEIGHT = 24;
/** Stacked: enough width for a table row, and enough rows for three panes
 *  to each draw a border, a title, a line of transcript and a composer. */
export const STACK_MIN_WIDTH = 56;
export const STACK_MIN_HEIGHT = 32;

/** The narrowest window that draws anything at all — the stack's, since it
 *  is the layout a narrow window gets. */
export const MIN_WIDTH = STACK_MIN_WIDTH;
