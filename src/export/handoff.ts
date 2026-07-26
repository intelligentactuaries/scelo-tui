// Where is scelo running, and how does the export reach that place?
//
// The TUI is a guest in somebody's terminal, and the terminal's owner is
// knowable: RStudio marks its terminals with RSTUDIO=1, VS Code with
// TERM_PROGRAM=vscode, and the Scelo IDE (as of this change) with
// SCELO_IDE=1 + SCELO_IDE_WORKSPACE. Detection changes what "export" means:
//
//   RStudio    the user is already in an open project, so the artifacts are
//              written INTO it (flat, stem-prefixed) — they appear in the
//              Files pane instantly and `source("<stem>_analysis.R")` runs
//              with no file-opening ceremony. RStudio has no CLI to open a
//              file in its editor (requested for years — rstudio/rstudio
//              #1850, #14226), so "the project is already there" is the
//              whole of what can be automated, and it is the part that
//              matters.
//
//   VS Code    the `code` CLI is on PATH inside its terminals and `-r`
//              reuses the current window. The script, notebook and R file
//              are opened directly; whatever extensions the user has
//              (Python, Jupyter, R) claim them by file type — that is VS
//              Code's own routing, not ours.
//
//   Scelo IDE  the export lands flat in the OPEN WORKSPACE (from the env
//              marker), so the IDE's file browser shows it immediately and
//              the .sce is one drag away from the Scelo screen. Deeper
//              hand-off (auto-restoring the session) needs an IDE-side
//              listener that does not exist yet — see the README.
//
//   plain      today's behavior: a tidy export directory, nothing opened.
//
// Precedence is most-specific-first: a Scelo IDE terminal could plausibly
// inherit VS Code's variables (launched from it), never the reverse.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import type { ExportOutcome } from "./index";

export type Host =
  | { kind: "rstudio" }
  | { kind: "vscode"; bin: string | null }
  | { kind: "scelo-ide"; workspace: string | null }
  | { kind: "plain" };

export type Env = Record<string, string | undefined>;
export type Probe = (bin: string) => string | null;

const defaultProbe: Probe = (bin) => Bun.which(bin);

/** VS Code and its forks keep TERM_PROGRAM=vscode but ship their own CLI —
 *  probe in popularity order and take the first that exists. */
const VSCODE_BINS = ["code", "cursor", "windsurf", "codium", "code-insiders"];

export function detectHost(env: Env = process.env, probe: Probe = defaultProbe): Host {
  if (env.SCELO_IDE === "1") {
    const ws = env.SCELO_IDE_WORKSPACE?.trim();
    return { kind: "scelo-ide", workspace: ws ? ws : null };
  }
  if (env.RSTUDIO) return { kind: "rstudio" };
  if (env.TERM_PROGRAM === "vscode" || env.VSCODE_PID || env.VSCODE_CWD) {
    let bin: string | null = null;
    for (const b of VSCODE_BINS) {
      bin = probe(b);
      if (bin) break;
    }
    return { kind: "vscode", bin };
  }
  return { kind: "plain" };
}

export function hostLabel(host: Host): string {
  switch (host.kind) {
    case "rstudio":
      return "RStudio";
    case "vscode":
      return "VS Code";
    case "scelo-ide":
      return "Scelo IDE";
    case "plain":
      return "terminal";
  }
}

// ── where the export goes ─────────────────────────────────────────────────

export type ExportPlan = { layout: "dir" | "flat"; dir?: string };

/** Flat-into-the-open-project for hosts whose whole point is "you are
 *  already somewhere"; the tidy subdirectory everywhere else. */
export function planFor(host: Host, cwd: string = process.cwd()): ExportPlan {
  if (host.kind === "rstudio") return { layout: "flat", dir: cwd };
  if (host.kind === "scelo-ide") {
    const ws = host.workspace && existsSync(host.workspace) ? host.workspace : cwd;
    return { layout: "flat", dir: ws };
  }
  return { layout: "dir" };
}

// ── after the files exist ─────────────────────────────────────────────────

export type Handoff = {
  /** Files handed to the host's own opener, by name. */
  opened: string[];
  /** The one line that tells the user what to do next — or that nothing is
   *  left to do. Null when the plain export message already covers it. */
  hint: string | null;
};

function spawnDetached(bin: string, args: string[]): boolean {
  try {
    const child = spawn(bin, args, { detached: true, stdio: "ignore" });
    child.on("error", () => {
      // Detached and fire-and-forget: a launch failure after spawn returns
      // has nowhere useful to land. The synchronous failures (ENOENT on a
      // probed-and-found binary is not one of them) throw above.
    });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

const CODE_OPENABLE = /\.(py|ipynb|R|r|csv)$/;

export function performHandoff(
  host: Host,
  outcome: ExportOutcome,
  spawner: typeof spawnDetached = spawnDetached,
): Handoff {
  switch (host.kind) {
    case "vscode": {
      if (!host.bin) {
        return {
          opened: [],
          hint: "VS Code detected but its CLI is not on PATH — Command Palette → 'Shell Command: Install code command'",
        };
      }
      const files = outcome.files.filter((f) => CODE_OPENABLE.test(f.name) && f.name !== dataName(outcome));
      const paths = files.map((f) => `${outcome.dir}/${f.name}`);
      if (paths.length === 0) return { opened: [], hint: null };
      const ok = spawner(host.bin, ["-r", ...paths]);
      return ok
        ? {
            opened: files.map((f) => f.name),
            hint: "opened in VS Code — its Python / Jupyter / R extensions take it from here",
          }
        : { opened: [], hint: `could not launch ${host.bin}` };
    }
    case "rstudio": {
      const r = outcome.files.find((f) => f.name.endsWith(".R"));
      return {
        opened: [],
        hint: r
          ? `already in your open RStudio project — run  source("${r.name}")  in the R console`
          : "already in your open RStudio project",
      };
    }
    case "scelo-ide": {
      const sce = outcome.files.find((f) => f.name.endsWith(".sce"));
      return {
        opened: [],
        hint: sce
          ? `in the IDE's file browser now — drop ${sce.name} onto the Scelo screen to load the session`
          : "in the IDE's file browser now",
      };
    }
    case "plain":
      return { opened: [], hint: null };
  }
}

/** The data file's name differs by layout (data.csv vs <stem>_data.csv);
 *  resolve it from the outcome rather than guessing. */
function dataName(outcome: ExportOutcome): string {
  return outcome.files.find((f) => f.name.endsWith("data.csv"))?.name ?? "data.csv";
}

// ── /open — hand one artifact to whatever should open it ─────────────────

export function systemOpener(): [string, string[]] | null {
  if (process.platform === "darwin") return ["open", []];
  if (process.platform === "win32") return ["cmd", ["/c", "start", ""]];
  return ["xdg-open", []];
}

/**
 * The command that opens `file` for this host — pure, so tests can assert
 * on it without launching anything.
 *
 * The .sce gets special handling on a plain host: if the packaged IDE
 * binary is findable (SCELO_IDE_BIN, or `scelo-ide` on PATH — the
 * electron-builder executableName), prefer launching Scelo itself over
 * whatever the OS associates with .sce (usually a text editor, which is
 * nobody's idea of opening a project).
 */
export function openCommand(
  file: string,
  host: Host,
  env: Env = process.env,
  probe: Probe = defaultProbe,
): [string, string[]] | null {
  if (host.kind === "vscode" && host.bin && CODE_OPENABLE.test(file)) {
    return [host.bin, ["-r", file]];
  }
  if (file.endsWith(".sce") && host.kind !== "scelo-ide") {
    const ide = env.SCELO_IDE_BIN?.trim() || probe("scelo-ide");
    if (ide) return [ide, [file]];
  }
  const sys = systemOpener();
  return sys ? [sys[0], [...sys[1], file]] : null;
}

export function performOpen(
  file: string,
  host: Host,
  spawner: typeof spawnDetached = spawnDetached,
): string | null {
  const cmd = openCommand(file, host);
  if (!cmd) return "no system opener available";
  return spawner(cmd[0], cmd[1]) ? null : `could not launch ${cmd[0]}`;
}
