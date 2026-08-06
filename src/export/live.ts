// The live mirror — the session restated for RStudio and Jupyter WHILE it
// happens, not after.
//
// `/live` arms it. From then on the TUI rewrites two files as the pipeline
// advances — after cleaning (before the slow LLM stages), after the first
// analysis lands, and after every `/run` switch:
//
//   <stem>_live.R       source() it in the RStudio console at any moment.
//                       Each analysis is a section that announces itself
//                       with message() and prints its result; re-sourcing
//                       mid-session replays what exists so far and says the
//                       session is still in progress.
//   <stem>_live.ipynb   open it in Jupyter; when scelo adds sections,
//                       Jupyter offers "file changed on disk — reload".
//   <stem>_data.csv     the cleaned dataset both of them read — the same
//                       name the final /export writes, so live and final
//                       scripts are interchangeable.
//
// Two invariants make "live" safe rather than flaky:
//   • every write is ATOMIC (tmp + rename) — a source() racing a rewrite
//     sees the old file or the new file, never half of one;
//   • every intermediate file is VALID — partial sessions parse (R) and
//     load (nbformat JSON), because "the user runs it whenever they feel
//     like it" is the whole contract.
//
// Cell ids in the notebook are stable across rewrites (cellMaker starts at
// cell-0 every build), which keeps Jupyter's reload diff sane.

import { existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { ColumnMeta, Dataset } from "@scelo/core";
import type { PipelineResult } from "../agent/pipeline";
import type { AutoCleanResult } from "../core/cleaning";
import { toCsv } from "./csv";
import { type Cell, cellMaker, wrapNotebook } from "./notebook";
import { provenance, snippetFor } from "./scripts";

/** One analysis the session has run, in the order it ran. */
export type LiveRun = { id: string; label: string; rationale: string };

export type LiveSnapshot = {
  dataset: Dataset;
  metas: ColumnMeta[];
  clean: AutoCleanResult | null;
  reading: string;
  runs: LiveRun[];
  /** True while the pipeline is still working — the footers say so. */
  inProgress: boolean;
};

const q = (s: string) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

/** The shared provenance block, minus the single-analysis lines — the live
 *  files carry their analyses as SECTIONS, one per run. */
function liveProvenance(snap: LiveSnapshot, now: Date, dataFile: string): string[] {
  const pseudo: PipelineResult = {
    dataset: snap.dataset,
    metas: snap.metas,
    clean: snap.clean,
    reading: snap.reading,
    chosen: null,
    rationale: "",
    result: null,
    degraded: null,
  };
  return provenance(pseudo, now, dataFile);
}

const RULE = "─".repeat(68);

export function buildLiveR(snap: LiveSnapshot, now: Date, dataFile = "data.csv"): string {
  const out: string[] = [
    `# ── scelo live mirror ${RULE.slice(21)}`,
    "# This file is REWRITTEN by scelo-tui as the session advances. source()",
    "# it again at any moment: a partial session is still a valid script, and",
    "# new analyses appear as new sections at the bottom.",
    "#",
    ...liveProvenance(snap, now, dataFile).map((l) => `# ${l}`.trimEnd()),
    "",
    `df <- read.csv(${q(dataFile)}, stringsAsFactors = FALSE)`,
    'message(sprintf("scelo: %d rows x %d cols loaded", nrow(df), ncol(df)))',
    "# Browse the data with RStudio's viewer:  View(df)",
    "# (Don't open the csv itself as a file — RStudio's source editor caps",
    "#  out at 5 MB; the viewer handles any size.)",
    "",
  ];
  if (snap.runs.length === 0) {
    out.push(
      `# ── profile ${RULE.slice(11)}`,
      "# No analysis has landed yet — the shape of the data while you wait:",
      "str(df)",
      "",
    );
  }
  snap.runs.forEach((run, i) => {
    const snip = snippetFor(run.id, snap.metas);
    out.push(
      `# ── analysis ${i + 1}: ${run.label} ${RULE.slice(16 + run.label.length)}`,
      `# why: ${run.rationale}`,
      `message(${q(`scelo → ${run.label}`)})`,
      ...(snip ? snip.r : ["print(summary(df))  # no scripted form for this analysis"]),
      "",
    );
  });
  out.push(
    snap.inProgress
      ? 'message("scelo: session still in progress — re-source this file for new sections")'
      : `message("scelo: session complete — ${snap.runs.length} analysis section${snap.runs.length === 1 ? "" : "s"} above")`,
  );
  return `${out.join("\n")}\n`;
}

export function buildLiveIpynb(snap: LiveSnapshot, now: Date, dataFile = "data.csv"): string {
  const { md, code } = cellMaker();
  const needsNumpy = snap.runs.some((r) => snippetFor(r.id, snap.metas)?.needsNumpy);
  const imports = ["import pandas as pd"];
  if (needsNumpy) imports.push("import numpy as np");
  imports.push("", `df = pd.read_csv(${q(dataFile)})`, "df.head()");

  const cells: Cell[] = [
    md([
      `# ${snap.dataset.name} — live`,
      "",
      "> **Live mirror** — scelo-tui rewrites this notebook as the session",
      "> advances. When Jupyter offers *\"file changed on disk — reload\"*,",
      "> reload: new sections arrive at the bottom.",
      "",
      ...liveProvenance(snap, now, dataFile).map((l) => (l === "" ? "" : `> ${l}`)),
    ]),
    code(imports),
  ];
  if (snap.runs.length === 0) {
    cells.push(
      md(["## Profile", "", "*No analysis has landed yet — the shape of the data while you wait.*"]),
      code(["df.describe(include='all').T"]),
    );
  }
  snap.runs.forEach((run, i) => {
    const snip = snippetFor(run.id, snap.metas);
    cells.push(
      md([`## ${i + 1}. ${run.label}`, "", run.rationale ? `*${run.rationale}*` : ""]),
      code(snip ? snip.py : ["df.describe(include='all').T"]),
    );
    if (snip?.pyPlot) cells.push(code(snip.pyPlot));
  });
  cells.push(
    md([
      snap.inProgress
        ? "⏳ *Session still in progress — scelo will add sections here; reload when Jupyter offers.*"
        : `✓ *Session complete — ${snap.runs.length} analysis section${snap.runs.length === 1 ? "" : "s"}.*`,
    ]),
  );
  return wrapNotebook(cells);
}

// ── the RStudio watcher ───────────────────────────────────────────────────
//
// The piece that turns the mirror from "re-source when you remember" into
// automation: a tiny script the user sources ONCE in the RStudio console.
// It polls the live script's mtime (1s) via `later` timers — which RStudio's
// console event loop pumps while idle — and re-source()s on every change, so
// each TUI advance prints its new sections in the console by itself.
//
// Design constraints, in order:
//   • sourcing it twice must not double-run anything — a generation flag in
//     the global env retires the previous watcher first;
//   • no hard dependency: without `later` it degrades to a one-keystroke
//     scelo_refresh() instead of failing;
//   • the target path is baked ABSOLUTE. This file is session-local glue,
//     not a portable export — absolute is what makes source() work no
//     matter where the RStudio project's working directory points.
export function buildLiveWatchR(targetAbsPath: string): string {
  return [
    "# scelo live watch — source this ONCE in the RStudio console.",
    "#",
    "# From then on, every time scelo advances the session, the live script",
    "# re-runs here automatically: new analysis sections print in this",
    "# console as the TUI produces them. Stop with  scelo_watch_stop()",
    "#",
    '# Auto-refresh needs the `later` package (install.packages("later")).',
    "# Without it, this defines  scelo_refresh()  for manual refreshes.",
    "",
    "local({",
    `  target <- ${q(targetAbsPath)}`,
    "  run <- function() {",
    "    tryCatch(source(target), error = function(e) {",
    '      message("scelo: live script failed - ", conditionMessage(e))',
    "    })",
    "  }",
    "  # Re-sourcing this file replaces any previous watcher instead of",
    "  # stacking a second timer loop on top of it.",
    '  if (exists(".scelo_watch_state", envir = globalenv(), inherits = FALSE)) {',
    '    get(".scelo_watch_state", envir = globalenv())$on <- FALSE',
    "  }",
    '  if (!requireNamespace("later", quietly = TRUE)) {',
    '    assign("scelo_refresh", run, envir = globalenv())',
    "    message(",
    '      "scelo: `later` is not installed, so no auto-refresh. ",',
    '      "Run scelo_refresh() after each TUI step, or install.packages(\\"later\\") ",',
    '      "and source this file again."',
    "    )",
    "    run()",
    "    return(invisible())",
    "  }",
    "  state <- new.env(parent = emptyenv())",
    "  state$on <- TRUE",
    "  state$mtime <- -1",
    '  assign(".scelo_watch_state", state, envir = globalenv())',
    '  assign("scelo_watch_stop", function() {',
    "    state$on <- FALSE",
    '    message("scelo: live watch stopped")',
    '  }, envir = globalenv())',
    "  tick <- function() {",
    "    if (!isTRUE(state$on)) return(invisible())",
    "    mt <- suppressWarnings(as.numeric(file.info(target)$mtime))",
    "    if (!is.na(mt) && mt > state$mtime) {",
    "      state$mtime <- mt",
    '      message("scelo: update at ", format(Sys.time(), "%H:%M:%S"), " - running the live script")',
    "      run()",
    "    }",
    "    later::later(tick, 1)",
    "  }",
    '  message("scelo: watching ", basename(target), " - updates run here automatically (scelo_watch_stop() to stop)")',
    "  tick()",
    "})",
    "",
  ].join("\n");
}

// ── the writer ────────────────────────────────────────────────────────────

export type LiveMirror = {
  /** Rewrite the live files from this snapshot. Returns what was written. */
  update(snap: LiveSnapshot, now?: Date): { dir: string; wrote: string[] };
  /** The mirror's fixed paths, for hints and /open. */
  files(): { dir: string; r: string; ipynb: string; csv: string; watch: string };
};

/** Same layout contract as exportArtifacts: "flat" writes stem-prefixed
 *  names into an existing project (RStudio, Scelo IDE), "dir" writes generic
 *  names into ./<stem>.scelo-export/. The data file NAME matches the final
 *  export's, so the live scripts and the exported ones read the same csv. */
export function createLiveMirror(opts: {
  stem: string;
  layout: "dir" | "flat";
  dir?: string;
  cwd?: string;
}): LiveMirror {
  const dir =
    opts.layout === "flat"
      ? resolve(opts.dir ?? opts.cwd ?? ".")
      : resolve(opts.cwd ?? ".", `${opts.stem}.scelo-export`);
  const name = (generic: string) => (opts.layout === "flat" ? `${opts.stem}_${generic}` : generic);
  const rName = name("live.R");
  const nbName = name("live.ipynb");
  const csvName = name("data.csv");
  const watchName = name("live_watch.R");

  // The dataset is written once per identity, not once per update — the
  // pipeline hands the SAME object through every post-clean snapshot, and
  // rewriting a large csv on every analysis switch would be pure churn.
  let lastDataset: Dataset | null = null;

  const writeAtomic = (file: string, content: string) => {
    const p = join(dir, file);
    const tmp = `${p}.tmp`;
    writeFileSync(tmp, content);
    renameSync(tmp, p);
  };

  return {
    update(snap, now = new Date()) {
      mkdirSync(dir, { recursive: true });
      const wrote: string[] = [];
      if (snap.dataset !== lastDataset) {
        writeAtomic(csvName, toCsv(snap.dataset));
        lastDataset = snap.dataset;
        wrote.push(csvName);
      }
      // The watcher's content never changes (it carries only the target
      // path), so it is written once — rewriting it would bump its mtime
      // for no reason and confuse anyone watching the directory.
      if (!existsSync(join(dir, watchName))) {
        writeAtomic(watchName, buildLiveWatchR(join(dir, rName)));
        wrote.push(watchName);
      }
      writeAtomic(rName, buildLiveR(snap, now, csvName));
      writeAtomic(nbName, buildLiveIpynb(snap, now, csvName));
      wrote.push(rName, nbName);
      return { dir, wrote };
    },
    files: () => ({ dir, r: rName, ipynb: nbName, csv: csvName, watch: watchName }),
  };
}
