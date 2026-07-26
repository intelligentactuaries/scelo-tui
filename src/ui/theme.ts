// Terminal palette.
//
// Carries over the contrast lesson from the GUI: the failure there was a
// "dim" tier that sat too close to the background to read. Terminals have the
// same trap — `gray` on a dark background is frequently unreadable, and on a
// light background it is worse. So there are only three text weights here and
// the dimmest is still a named colour the emulator renders solidly, never a
// hand-picked 256-colour grey.

export const theme = {
  /** Primary reading text. */
  fg: "white",
  /** Secondary — labels, units, counts. */
  mute: "gray",
  /** Structural chrome: borders, rules. */
  chrome: "gray",

  /** Stage accents, one per pane, so a glance tells you where you are. */
  soft: "cyan",
  tools: "magenta",
  hard: "green",

  ok: "green",
  warn: "yellow",
  err: "red",
  /** Whoever is speaking in a chat pane. */
  you: "cyan",
  bot: "white",
} as const;

/** Below this the three-pane layout stops being usable — each pane gets
 *  under ~45 columns, which cannot hold a results table. The app says so
 *  rather than rendering an unreadable mess. */
export const MIN_WIDTH = 140;
export const MIN_HEIGHT = 24;
