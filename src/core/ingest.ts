// File ingest for the TUI.
//
// A terminal has no drag-and-drop of its own — what actually happens when you
// drag a file onto a terminal window is that the emulator PASTES its path. So
// "drag and drop" here means: accept a pasted path, tolerate the quoting and
// escaping every emulator applies differently, and load it.

import { readFile, readdir } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { type CellValue, type Dataset, type Row, coerceCsvCell } from "@scelo/core";
import { delimiterFor, parseCsv } from "./csvParse";

/**
 * Normalise a path as it arrives from a terminal drag-drop or paste.
 *
 * Emulators disagree: GNOME Terminal and iTerm single-quote a path containing
 * spaces, some emit a file:// URI, and others backslash-escape each space.
 * Getting this wrong is the difference between "drag a file in and it works"
 * and an unexplained ENOENT, so all three shapes are handled.
 */
/**
 * The data-file path buried in a noisy drop line, or null when the line is
 * prose (or holds no path at all).
 *
 * Dragging a file through a terminal can bracket the pasted path with mouse
 * reports and stray bytes — `0;95;34M'/data/book.csv'0;95;34m` — and the
 * user's instruction for that case is exactly right: ignore everything but
 * the path. Candidates are quoted spans, file:// URIs, and absolute/`~`
 * paths ending in a data extension; the FIRST one wins (a multi-file drag
 * pastes several paths, and for part-file sets the sibling loader brings
 * the rest anyway). Prose stays prose: if meaningful text remains after
 * removing the path and the junk, this is a sentence that mentions a file,
 * not a drop — return null and let the chat have it.
 */
export function extractDataPath(text: string): string | null {
  const noise = /(?:\x1b?\[?<?)?\d{1,4};\d{1,4};\d{1,4}[Mm]/g;
  const cleaned = text.replace(noise, "").trim();
  if (cleaned === "") return null;
  // Every span that could be a path, in one pattern — used twice: globally
  // for the prose test, then non-globally for the extraction.
  const anyPath =
    /'((?:~|\/|[A-Za-z]:\\)[^']*\.(?:csv|tsv|txt))'|"((?:~|\/|[A-Za-z]:\\)[^"]*\.(?:csv|tsv|txt))"|(file:\/\/[^\s'"]+\.(?:csv|tsv|txt))|((?:~\/|\/)(?:\\ |[^'"\s])+\.(?:csv|tsv|txt))/gi;
  // Residue test: strip ALL path spans, quotes, and whitespace — if what's
  // left still reads as words, the user wrote a sentence ABOUT a file, not
  // a drop. (A multi-file drag leaves only quotes and spaces behind.)
  const residue = cleaned.replace(anyPath, "").replace(/['"\s]/g, "");
  if (/[A-LN-Za-ln-z]{2,}/.test(residue)) return null;
  anyPath.lastIndex = 0;
  const m = anyPath.exec(cleaned);
  if (!m) return null;
  // First span wins: a multi-file drag pastes several paths, and for
  // part-file sets the sibling loader brings the rest anyway.
  return m[1] ?? m[2] ?? m[3] ?? m[4] ?? null;
}

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

/** Chunked exports arrive as `<stem>_part1_of_3.csv` siblings. Handing the
 *  TUI any ONE of them almost never means "analyse a third of my data", so
 *  ingest looks for the rest. */
const PART_RE = /^(.*part)(\d+)(_of_)(\d+)(.*\.csv)$/i;

/** Every sibling part that actually exists, in part order — or just the
 *  given path when it isn't a part file / the others are missing. */
async function partPaths(path: string): Promise<string[]> {
  const m = PART_RE.exec(basename(path));
  if (!m) return [path];
  const [, pre, , mid, totalS, post] = m;
  const total = Number(totalS);
  if (!Number.isFinite(total) || total < 2 || total > 99) return [path];
  const dir = dirname(path);
  let present: Set<string>;
  try {
    present = new Set(await readdir(dir));
  } catch {
    return [path];
  }
  const parts: string[] = [];
  for (let k = 1; k <= total; k++) {
    const name = `${pre}${k}${mid}${total}${post}`;
    if (present.has(name)) parts.push(join(dir, name));
  }
  // All-or-one: a missing part means the set is incomplete — load only what
  // the user pointed at rather than silently analysing a partial union.
  return parts.length === total ? parts : [path];
}

type ParsedFile = { header: string[]; body: string[][]; truncated: boolean };

async function readCsvFile(path: string): Promise<ParsedFile | { error: string }> {
  let text: string;
  try {
    text = await readFile(path, "utf-8");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { error: msg.replace(/^ENOENT[^']*'/, "no such file: '") };
  }
  if (text.trim() === "") return { error: `${basename(path)} is empty` };

  // `maxRows` defaults to 500 in parseCsv — it is a preview parser in the
  // GUI, where the full read happens in a streaming path we do not have here.
  // Ask for one more than the ceiling so truncation is detectable.
  const parsed = parseCsv(text, { delimiter: delimiterFor(path), maxRows: MAX_ROWS + 1 });
  if (parsed.rows.length === 0) {
    return { error: `could not read a header row from ${basename(path)}` };
  }
  // Row 0 is the header; parseCsv does not separate it.
  return {
    header: parsed.rows[0].map((h, i) => h.trim() || `column_${i + 1}`),
    body: parsed.rows.slice(1),
    truncated: parsed.truncated,
  };
}

export async function loadDataset(rawPath: string): Promise<LoadResult> {
  const path = normaliseDroppedPath(rawPath);
  if (!path) return { ok: false, error: "no path given" };

  const paths = await partPaths(path);
  const files: ParsedFile[] = [];
  for (const p of paths) {
    const f = await readCsvFile(p);
    if ("error" in f) return { ok: false, error: f.error };
    files.push(f);
  }

  const header = files[0].header;
  for (let i = 1; i < files.length; i++) {
    if (files[i].header.join("\u0000") !== header.join("\u0000")) {
      return {
        ok: false,
        error: `${basename(paths[i])} has different columns than ${basename(paths[0])} — part files must share a header`,
      };
    }
  }

  const body = files.flatMap((f) => f.body);
  const truncated = body.length > MAX_ROWS || files.some((f) => f.truncated);
  const cells = body.length > MAX_ROWS ? body.slice(0, MAX_ROWS) : body;
  const name =
    paths.length > 1
      ? basename(path).replace(PART_RE, (_all, pre, _k, _mid, total, post) => {
          // book_part1_of_3.csv → book_3_parts.csv — says what was loaded.
          const stem = String(pre).replace(/_?part$/i, "");
          return `${stem}${stem.endsWith("_") || stem === "" ? "" : "_"}${total}_parts${post}`;
        })
      : basename(path);
  const dataset: Dataset = {
    name,
    columns: header,
    rows: rowsFromCsvCells(header, cells),
  };
  if (truncated) {
    dataset.sampled = true;
    dataset.sourceTotalRows = body.length;
  }
  return { ok: true, dataset };
}
