// .ipynb — the same script, shaped for Jupyter.
//
// A notebook is JSON with a strict-ish schema (nbformat 4, minor 5: cells
// carry ids). Two things bite generators here and both are handled: `source`
// is a list of lines each ending "\n" except the last, and code cells must
// carry `outputs` and `execution_count` even when empty — validators reject
// their absence, not just their wrongness.

import type { PipelineResult } from "../agent/pipeline";
import { notebookParts } from "./scripts";

type Cell =
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

let cellSeq = 0;
const md = (lines: string[]): Cell => ({
  cell_type: "markdown",
  id: `cell-${cellSeq++}`,
  metadata: {},
  source: src(lines),
});
const code = (lines: string[]): Cell => ({
  cell_type: "code",
  id: `cell-${cellSeq++}`,
  metadata: {},
  execution_count: null,
  outputs: [],
  source: src(lines),
});

export function buildNotebook(pipe: PipelineResult, now: Date, dataFile = "data.csv"): string {
  cellSeq = 0;
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
