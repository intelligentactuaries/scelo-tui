// The slash-command registry — one list, three consumers: the `/` menu, the
// `/help` text, and the intent handler's notion of what a known verb is.
//
// Kept apart from App.tsx because the filtering is the whole interaction and
// is worth testing directly: a completion menu that offers a command the app
// cannot run, or hides one it can, is worse than no menu at all.

export type Command = {
  /** Without the leading slash. */
  name: string;
  /** Argument hint shown in the menu, e.g. "<number|name>". */
  args?: string;
  /** One line, present tense, no trailing period — it sits in a 40-column
   *  pane next to the name. */
  hint: string;
  /**
   * True when running it bare already does something useful, so ⏎ on the
   * menu runs it immediately. False means the command needs an argument, so
   * ⏎ completes the draft to "/name " and hands the line back to you rather
   * than submitting something that can only fail.
   */
  standalone: boolean;
};

export const COMMANDS: Command[] = [
  { name: "files", args: "[folder]", hint: "pick a data file to load — no dragging needed", standalone: true },
  { name: "example", args: "[number|name]", hint: "load a bundled sample dataset", standalone: true },
  { name: "export", args: "[format…]", hint: "write artifacts for every tool", standalone: true },
  { name: "live", args: "[off]", hint: "mirror the session into RStudio/Jupyter files as it runs", standalone: true },
  { name: "open", args: "[format]", hint: "open an exported artifact", standalone: true },
  { name: "list", hint: "the analyses that apply to this data", standalone: true },
  { name: "charts", args: "[number]", hint: "every plot this data makes, full screen", standalone: true },
  { name: "run", args: "<analysis|number>", hint: "switch the analysis", standalone: false },
  { name: "show", args: "<column>", hint: "one column's profile", standalone: false },
  { name: "graph", args: "[on|off]", hint: "the node/edge diagrams in tools and output", standalone: true },
  { name: "mouse", args: "[on|off]", hint: "click-to-focus vs. selecting text to copy", standalone: true },
  { name: "help", hint: "everything you can type", standalone: true },
];

export const COMMAND_NAMES: string[] = COMMANDS.map((c) => c.name);

/**
 * Which commands the current draft is reaching for, or null when the draft
 * is not a command at all.
 *
 * Null (rather than an empty list) for three distinct cases, because they
 * are the same to the user — no menu:
 *   - the draft is ordinary prose,
 *   - the draft already has an argument (`/run gini`), so the choice is made
 *     and a menu would only cover the line being typed,
 *   - nothing matches what was typed (`/zzz`), where an empty box is noise.
 */
export function commandMenu(draft: string): Command[] | null {
  if (!draft.startsWith("/")) return null;
  const rest = draft.slice(1);
  // A space means an argument is being typed — the command is settled.
  if (/\s/.test(rest)) return null;
  const q = rest.toLowerCase();
  const hits = COMMANDS.filter((c) => c.name.startsWith(q));
  return hits.length > 0 ? hits : null;
}

/** `/help`'s body, built from the same registry so it cannot drift from the
 *  menu. */
export function helpText(): string {
  const width = Math.max(...COMMANDS.map((c) => `/${c.name} ${c.args ?? ""}`.trimEnd().length));
  return [
    ...COMMANDS.map((c) => {
      const sig = `/${c.name} ${c.args ?? ""}`.trimEnd();
      return `${sig.padEnd(width)}  ${c.hint}`;
    }),
    "",
    "type / for the menu · ⏎ send · ctrl-e export · ctrl-o model",
    "↑↓ prompt history · ←→ move in the line · esc clear it",
    "ctrl-a start · ctrl-k/u kill to end/start · ctrl-w kill a word",
    "copying: shift-drag selects while the mouse is on — or /mouse off",
    "a bare number answers whichever menu was just printed",
    "anything else goes to the model",
  ].join("\n");
}
