// The one-command export: everything the session produced, in every format
// the user's next tool wants.
//
//   <stem>.scelo-export/
//     data.csv        the cleaned dataset (what every script reads)
//     analysis.py     pandas
//     analysis.ipynb  Jupyter notebook
//     analysis.R      base R — runs in RStudio with no packages
//     <stem>.xlsx     Excel workbook (summary · results · columns · data)
//     <stem>.sce      Scelo IDE project — File → Open in the IDE
//
// The directory is the unit: exporting again overwrites the directory's own
// artifacts and nothing else. Individual formats are for when you know what
// you want; the default is all of them, because "which format will I need"
// is exactly the question the user should not have to answer up front.

import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { PipelineResult } from "../agent/pipeline";
import { toCsv } from "./csv";
import { buildNotebook } from "./notebook";
import { buildSce, sceFilename, slugify } from "./sce";
import { buildPython, buildR } from "./scripts";
import { buildWorkbook } from "./workbook";

export type ExportTarget = "csv" | "py" | "ipynb" | "r" | "xlsx" | "sce";
export const ALL_TARGETS: ExportTarget[] = ["csv", "py", "ipynb", "r", "xlsx", "sce"];

/** `/export xls`, `/export notebook`, `/export excel` — people name formats
 *  by their tool, not by our identifiers. */
export function parseTarget(word: string): ExportTarget | null {
  const w = word.trim().toLowerCase();
  if (["csv", "data"].includes(w)) return "csv";
  if (["py", "python", "pandas"].includes(w)) return "py";
  if (["ipynb", "notebook", "jupyter"].includes(w)) return "ipynb";
  if (["r", ".r", "rstudio"].includes(w)) return "r";
  if (["xlsx", "xls", "excel", "spreadsheet", "workbook"].includes(w)) return "xlsx";
  if (["sce", "scelo", "project", "ide", ".sce"].includes(w)) return "sce";
  return null;
}

export type ExportOutcome = {
  dir: string;
  files: Array<{ name: string; bytes: number }>;
  layout: "dir" | "flat";
  stem: string;
};

export function exportArtifacts(
  pipe: PipelineResult,
  opts: {
    targets?: ExportTarget[];
    cwd?: string;
    now?: Date;
    /**
     * "dir" (default): everything into ./<stem>.scelo-export/, generic
     * filenames. "flat": straight into `dir` — an already-open RStudio
     * project or Scelo IDE workspace — with stem-prefixed names, because
     * dropping a file called `data.csv` into somebody's project root is a
     * collision waiting to happen where `book_data.csv` is not.
     */
    layout?: "dir" | "flat";
    /** Flat layout's destination. Ignored for "dir". */
    dir?: string;
  } = {},
): ExportOutcome {
  const now = opts.now ?? new Date();
  const targets = opts.targets && opts.targets.length > 0 ? opts.targets : ALL_TARGETS;
  const stem = slugify(pipe.dataset.name.replace(/\.(csv|tsv|txt|parquet)$/i, ""));
  const layout = opts.layout ?? "dir";
  const dir =
    layout === "flat"
      ? resolve(opts.dir ?? opts.cwd ?? ".")
      : resolve(opts.cwd ?? ".", `${stem}.scelo-export`);
  mkdirSync(dir, { recursive: true });

  const name = (generic: string) => (layout === "flat" ? `${stem}_${generic}` : generic);
  // The scripts read this by RELATIVE name, so it must match the layout.
  const dataFile = name("data.csv");

  const files: ExportOutcome["files"] = [];
  const write = (n: string, content: string | Uint8Array) => {
    writeFileSync(join(dir, n), content);
    files.push({ name: n, bytes: typeof content === "string" ? Buffer.byteLength(content) : content.length });
  };

  // The data rides along with any script target — a script that reads a
  // file we did not write is a broken export, not a lean one.
  const wantsScript = targets.some((t) => t === "py" || t === "ipynb" || t === "r");
  if (targets.includes("csv") || wantsScript) write(dataFile, toCsv(pipe.dataset));
  if (targets.includes("py")) write(name("analysis.py"), buildPython(pipe, now, dataFile));
  if (targets.includes("ipynb")) write(name("analysis.ipynb"), buildNotebook(pipe, now, dataFile));
  if (targets.includes("r")) write(name("analysis.R"), buildR(pipe, now, dataFile));
  if (targets.includes("xlsx")) write(`${stem}.xlsx`, buildWorkbook(pipe, now));
  if (targets.includes("sce")) write(sceFilename(pipe.dataset.name), buildSce(pipe, now));

  return { dir, files, layout, stem };
}
