// Putting text on the system clipboard from inside a TUI.
//
// Two routes, tried in that order, because they fail in opposite ways.
//
// A HELPER (wl-copy, xclip, xsel, pbcopy, clip.exe) is a real process: it
// exits zero or it does not, so success is a fact rather than a hope. It is
// also the route that does not exist on a fresh machine, and never exists
// over ssh into a box with no display.
//
// OSC 52 is an escape sequence that asks the TERMINAL to do the copying, so
// it needs nothing installed and works through ssh and tmux. Its weakness is
// that it is fire-and-forget: a terminal that ignores it (some builds
// deliberately do, since a sequence that writes your clipboard is a sequence
// a hostile `cat` can write your clipboard with) says nothing, and there is
// no reply to read. So this reports which route ran and whether the result
// was CONFIRMED, and the caller tells the truth about that rather than
// claiming a copy it cannot know happened.
//
// Deliberately not a fallback chain that gives up quietly: "copied" when
// nothing was copied is the one outcome worth engineering against.

import { spawnSync } from "node:child_process";

export type CopyRoute = "wl-copy" | "xclip" | "xsel" | "pbcopy" | "clip.exe" | "osc52";

export type CopyResult =
  | { ok: true; via: CopyRoute; confirmed: boolean; bytes: number }
  | { ok: false; reason: string };

/** Helpers in preference order, with the arguments that make them read stdin
 *  and write the CLIPBOARD selection (not the X11 primary, which is the
 *  middle-click one and not what "copy" means to anybody). */
const HELPERS: Array<{ route: CopyRoute; cmd: string; args: string[] }> = [
  { route: "wl-copy", cmd: "wl-copy", args: [] },
  { route: "xclip", cmd: "xclip", args: ["-selection", "clipboard"] },
  { route: "xsel", cmd: "xsel", args: ["--clipboard", "--input"] },
  { route: "pbcopy", cmd: "pbcopy", args: [] },
  { route: "clip.exe", cmd: "clip.exe", args: [] },
];

/**
 * Past this the escape sequence is the problem rather than the solution.
 *
 * Terminals cap what they will accept in one OSC and they differ on where;
 * xterm's default is around 100k of payload and several are lower. A refusal
 * naming `/export` is worth more than a clipboard holding the first 60% of a
 * table, which is the failure nobody notices until they paste it.
 */
const OSC52_MAX_BASE64 = 64 * 1024;

export function copyText(text: string, write?: (s: string) => void): CopyResult {
  if (text === "") return { ok: false, reason: "nothing to copy" };
  const bytes = Buffer.byteLength(text, "utf8");

  for (const h of HELPERS) {
    const r = spawnSync(h.cmd, h.args, { input: text, stdio: ["pipe", "ignore", "ignore"] });
    // ENOENT surfaces as `error`, not as a non-zero status — a missing helper
    // must move on to the next route rather than count as a failed copy.
    if (r.error || r.status !== 0) continue;
    return { ok: true, via: h.route, confirmed: true, bytes };
  }

  const b64 = Buffer.from(text, "utf8").toString("base64");
  if (b64.length > OSC52_MAX_BASE64) {
    return {
      ok: false,
      reason: `${(bytes / 1024).toFixed(0)} kB is too much for a clipboard escape — /export writes it to a file instead`,
    };
  }
  const out = write ?? ((s: string) => process.stdout.write(s));
  try {
    // `c` is the clipboard selection. BEL rather than ST terminates it: both
    // are legal and BEL is the form every terminal that implements this
    // accepts.
    out(`\x1b]52;c;${b64}\x07`);
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
  return { ok: true, via: "osc52", confirmed: false, bytes };
}

/** What to say about a copy, including the part that is not knowable. */
export function describeCopy(r: CopyResult, what: string): string {
  if (!r.ok) return `could not copy — ${r.reason}`;
  if (r.confirmed) return `${what} → clipboard (${r.via})`;
  // Said in one line, because it appears in a pane forty columns wide. The
  // hedge is the point: a terminal may drop OSC 52 on purpose and there is
  // no reply to tell us it did.
  return `${what} → clipboard (OSC 52). If nothing pastes, install xclip or wl-clipboard — /export always works.`;
}

/** A result table as tab-separated text: what pastes into Excel, Sheets or
 *  a data frame as COLUMNS rather than as one long string. */
export function toTsv(columns: string[], rows: Array<Array<string | number>>): string {
  const cell = (v: string | number) => String(v ?? "").replace(/[\t\r\n]+/g, " ");
  return [columns.map(cell).join("\t"), ...rows.map((r) => r.map(cell).join("\t"))].join("\n");
}
