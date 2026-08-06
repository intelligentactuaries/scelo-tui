// .ipynb — the same script, shaped for Jupyter.
//
// A notebook is JSON with a strict-ish schema (nbformat 4, minor 5: cells
// carry ids). Two things bite generators here and both are handled: `source`
// is a list of lines each ending "\n" except the last, and code cells must
// carry `outputs` and `execution_count` even when empty — validators reject
// their absence, not just their wrongness.

import type { PipelineResult } from "../agent/pipeline";
import { notebookParts } from "./scripts";

export type Cell =
  | { cell_type: "markdown"; id: string; metadata: Record<string, never>; source: string[] }
  | {
      cell_type: "code";
      id: string;
      metadata: Record<string, never>;
      execution_count: null;
      outputs: never[];
      source: string[];
    };

function src(lines: string[]): string[] {
  return lines.map((l, i) => (i < lines.length - 1 ? `${l}\n` : l));
}

/** Cell constructors with their own id counter — a factory (not module
 *  state) so every builder that assembles a notebook starts from cell-0 and
 *  regenerating the same content yields the same ids. The live mirror
 *  depends on that: it rewrites its notebook many times per session, and
 *  stable ids keep Jupyter's "file changed on disk — reload?" diff sane. */
export function cellMaker(): { md: (lines: string[]) => Cell; code: (lines: string[]) => Cell } {
  let seq = 0;
  return {
    md: (lines) => ({
      cell_type: "markdown",
      id: `cell-${seq++}`,
      metadata: {},
      source: src(lines),
    }),
    code: (lines) => ({
      cell_type: "code",
      id: `cell-${seq++}`,
      metadata: {},
      execution_count: null,
      outputs: [],
      source: src(lines),
    }),
  };
}

/** The nbformat-4.5 envelope every notebook here ships in. */
export function wrapNotebook(cells: Cell[]): string {
  const nb = {
    nbformat: 4,
    nbformat_minor: 5,
    metadata: {
      kernelspec: { display_name: "Python 3", language: "python", name: "python3" },
      language_info: { name: "python" },
    },
    cells,
  };
  return `${JSON.stringify(nb, null, 1)}\n`;
}

export function buildNotebook(pipe: PipelineResult, now: Date, dataFile = "data.csv"): string {
  const { md, code } = cellMaker();
  const parts = notebookParts(pipe, now, dataFile);
  const cells: Cell[] = [
    md([
      `# ${pipe.dataset.name}`,
      "",
      ...parts.provenance.map((l) => (l === "" ? "" : `> ${l}`)),
    ]),
    code(parts.imports),
    md([`## ${pipe.chosen?.label ?? "Profile"}`, "", pipe.rationale ? `*${pipe.rationale}*` : ""]),
    code(parts.body),
  ];
  if (parts.plot) cells.push(code(parts.plot));
  return wrapNotebook(cells);
}
