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
  /** The mascot's warm orange — also the welcome box's border. */
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

/** Below this the three-pane layout stops being usable — each pane gets
 *  under ~45 columns, which cannot hold a results table. The app says so
 *  rather than rendering an unreadable mess. */
export const MIN_WIDTH = 140;
export const MIN_HEIGHT = 24;
