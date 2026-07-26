// RFC-4180 CSV writer.
//
// The exported scripts all begin `read_csv("data.csv")`, so this file is the
// contract between the pane and the artifacts: whatever the analyses saw is
// exactly what pandas and R will see. Quoting is by need, not by habit —
// a file where every field is quoted diffs terribly and doubles in size.

import type { CellValue, Dataset } from "@scelo/core";

function cell(v: CellValue): string {
  if (v === null) return "";
  const s = typeof v === "number" ? String(v) : v;
  // Quotes, commas, newlines: the three things that break naive parsers.
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(dataset: Dataset): string {
  const lines: string[] = [dataset.columns.map((c) => cell(c)).join(",")];
  for (const row of dataset.rows) {
    lines.push(dataset.columns.map((c) => cell(row[c] ?? null)).join(","));
  }
  return `${lines.join("\n")}\n`;
}
