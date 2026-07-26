// The Excel deliverable: four sheets an actuary can hand to a reviewer.
//
//   summary  — provenance: what was loaded, what cleaning did, what ran, why
//   results  — the pane's result table, as computing cells
//   columns  — a data dictionary (per-column profile), the sheet reviewers
//              ask for first and nobody enjoys writing by hand
//   data     — the cleaned rows, capped; the full set is data.csv next door
//
// The cap exists because a 120k×32 sheet of inline strings is a ~150MB XML
// part that helps nobody — the workbook is for reading and checking, the CSV
// is for computing.

import type { ColumnMeta } from "@scelo/core";
import type { PipelineResult } from "../agent/pipeline";
import { type Sheet, type SheetCell, buildXlsx } from "./xlsx";

export const DATA_SHEET_CAP = 10_000;

function summarySheet(pipe: PipelineResult, now: Date): Sheet {
  const d = pipe.dataset;
  const steps = pipe.clean?.passes.flatMap((p) => p.opLabels) ?? [];
  const rows: SheetCell[][] = [
    ["Scelo TUI export", null],
    ["generated", now.toISOString()],
    [null, null],
    ["dataset", d.name],
    ["rows", d.rows.length],
    ["columns", d.columns.length],
  ];
  if (d.sampled) {
    rows.push(["note", "sampled — the source file held more rows than the import cap"]);
  }
  rows.push([null, null], ["auto-clean", steps.length === 0 ? "nothing to do" : pipe.clean?.outcome ?? "—"]);
  steps.forEach((s, i) => rows.push([`step ${i + 1}`, s]));
  if (pipe.clean && pipe.clean.droppedColumns.length > 0) {
    rows.push(["dropped columns", pipe.clean.droppedColumns.join(", ")]);
  }
  if (pipe.reading) {
    rows.push([null, null], ["agent's reading", null]);
    for (const line of pipe.reading.split("\n")) rows.push([null, line]);
  }
  rows.push(
    [null, null],
    ["analysis", pipe.chosen?.label ?? "none chosen"],
    ["why", pipe.rationale || "—"],
  );
  if (d.rows.length > DATA_SHEET_CAP) {
    rows.push(
      [null, null],
      ["data sheet", `first ${DATA_SHEET_CAP.toLocaleString()} of ${d.rows.length.toLocaleString()} rows — full data in data.csv`],
    );
  }
  return { name: "summary", rows };
}

function resultsSheet(pipe: PipelineResult): Sheet {
  if (!pipe.result) {
    return { name: "results", rows: [["no analysis was run on this dataset"]] };
  }
  return {
    name: "results",
    rows: [
      [pipe.result.headline],
      [],
      pipe.result.columns,
      // Result rows mix computed numbers with formatted strings; both are
      // fine — numbers stay numbers, labels stay labels.
      ...pipe.result.rows.map((r) => r.map((c): SheetCell => c)),
    ],
  };
}

function columnsSheet(metas: ColumnMeta[]): Sheet {
  const rows: SheetCell[][] = [
    ["column", "type", "non-missing", "missing", "unique", "min", "max", "mean", "median", "top values"],
  ];
  for (const m of metas) {
    rows.push([
      m.name,
      m.type,
      m.count - m.missing,
      m.missing,
      m.unique,
      m.min ?? (m.dateMin ?? null),
      m.max ?? (m.dateMax ?? null),
      m.mean ?? null,
      m.median ?? null,
      m.topValues?.slice(0, 5).map((t) => `${t.value} (${t.count})`).join(", ") ?? null,
    ]);
  }
  return { name: "columns", rows };
}

function dataSheet(pipe: PipelineResult): Sheet {
  const d = pipe.dataset;
  const rows: SheetCell[][] = [d.columns.map((c): SheetCell => c)];
  const cap = Math.min(d.rows.length, DATA_SHEET_CAP);
  for (let i = 0; i < cap; i++) {
    const row = d.rows[i];
    rows.push(d.columns.map((c): SheetCell => row[c] ?? null));
  }
  return { name: "data", rows };
}

export function buildWorkbook(pipe: PipelineResult, now: Date): Uint8Array {
  return buildXlsx(
    [summarySheet(pipe, now), resultsSheet(pipe), columnsSheet(pipe.metas), dataSheet(pipe)],
    now,
  );
}
