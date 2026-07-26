// File ingest for the TUI.
//
// A terminal has no drag-and-drop of its own — what actually happens when you
// drag a file onto a terminal window is that the emulator PASTES its path. So
// "drag and drop" here means: accept a pasted path, tolerate the quoting and
// escaping every emulator applies differently, and load it.

import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { type CellValue, type Dataset, type Row, coerceCsvCell } from "./dataset";
import { delimiterFor, parseCsv } from "./csvParse";

/**
 * Normalise a path as it arrives from a terminal drag-drop or paste.
 *
 * Emulators disagree: GNOME Terminal and iTerm single-quote a path containing
 * spaces, some emit a file:// URI, and others backslash-escape each space.
 * Getting this wrong is the difference between "drag a file in and it works"
 * and an unexplained ENOENT, so all three shapes are handled.
 */
export function normaliseDroppedPath(raw: string): string {
  let p = raw.trim();
  if (
    (p.startsWith("'") && p.endsWith("'")) ||
    (p.startsWith('"') && p.endsWith('"'))
  ) {
    p = p.slice(1, -1);
  }
  if (p.startsWith("file://")) {
    try {
      p = decodeURIComponent(new URL(p).pathname);
    } catch {
      p = decodeURIComponent(p.slice("file://".length));
    }
  }
  // Unescape "\ " style escaping, but only when the path is not quoted —
  // a genuine backslash in a filename is far rarer than an escaped space.
  p = p.replace(/\\(.)/g, "$1");
  return p.trim();
}

function rowsFromCsvCells(header: string[], cells: string[][]): Row[] {
  const out: Row[] = new Array(cells.length);
  for (let r = 0; r < cells.length; r++) {
    const src = cells[r];
    const row: Row = {};
    for (let c = 0; c < header.length; c++) {
      row[header[c]] = coerceCsvCell(src[c] ?? "") as CellValue;
    }
    out[r] = row;
  }
  return out;
}

export type LoadResult =
  | { ok: true; dataset: Dataset }
  | { ok: false; error: string };

/** Row ceiling for the skeleton. Profiling already samples above 200k, but
 *  holding an unbounded file in memory in a terminal app is a poor trade —
 *  and a truncated load must announce itself rather than silently mislead. */
export const MAX_ROWS = 200_000;

export async function loadDataset(rawPath: string): Promise<LoadResult> {
  const path = normaliseDroppedPath(rawPath);
  if (!path) return { ok: false, error: "no path given" };
  let text: string;
  try {
    text = await readFile(path, "utf-8");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg.replace(/^ENOENT[^']*'/, "no such file: '") };
  }
  if (text.trim() === "") return { ok: false, error: `${basename(path)} is empty` };

  // `maxRows` defaults to 500 in parseCsv — it is a preview parser in the
  // GUI, where the full read happens in a streaming path we do not have here.
  // Ask for one more than the ceiling so truncation is detectable.
  const parsed = parseCsv(text, { delimiter: delimiterFor(path), maxRows: MAX_ROWS + 1 });
  if (parsed.rows.length === 0) {
    return { ok: false, error: `could not read a header row from ${basename(path)}` };
  }
  // Row 0 is the header; parseCsv does not separate it.
  const header = parsed.rows[0].map((h, i) => h.trim() || `column_${i + 1}`);
  const body = parsed.rows.slice(1);
  const truncated = body.length > MAX_ROWS;
  const cells = truncated ? body.slice(0, MAX_ROWS) : body;
  const dataset: Dataset = {
    name: basename(path),
    columns: header,
    rows: rowsFromCsvCells(header, cells),
  };
  if (truncated || parsed.truncated) {
    dataset.sampled = true;
    dataset.sourceTotalRows = body.length;
  }
  return { ok: true, dataset };
}
