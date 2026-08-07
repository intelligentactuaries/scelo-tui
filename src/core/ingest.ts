// File ingest for the TUI.
//
// A terminal has no drag-and-drop of its own — what actually happens when you
// drag a file onto a terminal window is that the emulator PASTES its path. So
// "drag and drop" here means: accept a pasted path, tolerate the quoting and
// escaping every emulator applies differently, and load it.

import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { homedir } from "node:os";
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
  // The filesystem outranks any shape-guessing: when the whole line names a
  // data file that exists — relative, spaces, whatever — it is a drop. This
  // is what makes a hand-typed `claims.csv` load instead of becoming a chat
  // message about a file the model cannot open.
  const direct = normaliseDroppedPath(cleaned);
  if (/\.(?:csv|tsv|txt)$/i.test(direct) && existsSync(direct)) return cleaned;
  // Every span that could be a path, in one pattern — used twice: globally
  // for the prose test, then non-globally for the extraction. Relative
  // spans count: `data/book.csv` pasted at a prompt is a path, and whether
  // the line is a drop is the residue test's decision, not the regex's.
  const anyPath =
    /'([^']+\.(?:csv|tsv|txt))'|"([^"]+\.(?:csv|tsv|txt))"|(file:\/\/[^\s'"]+\.(?:csv|tsv|txt))|((?:\\ |[^'"\s])+\.(?:csv|tsv|txt)(?=[\s'"]|$))/gi;
  // Residue test: strip the path spans and see which words survive. Load
  // verbs and courtesy words are not prose — "load ./claims.csv" asks for
  // exactly what the bare path does — but any other surviving word means a
  // sentence ABOUT a file, which belongs to the chat. (M/m are excluded so
  // a mouse-report fragment never counts as a word.)
  // Letters in ANY script: `[a-z]` erased Cyrillic and CJK words to nothing,
  // so "проанализируй данные в /tmp/claims.csv" read as a bare drop and the
  // question was replaced by the path. Two letters is the bar — a lone `M`
  // left over from a split mouse report is not a word, but `rm` is.
  const residue = cleaned
    .replace(anyPath, " ")
    .split(/['"\s]+/)
    .map((w) => (w.match(/\p{L}/gu) ?? []).join("").toLowerCase())
    .filter((w) => w !== "" && !LOAD_FILLER.has(w));
  if (residue.some((w) => [...w].length >= 2)) return null;
  anyPath.lastIndex = 0;
  const m = anyPath.exec(cleaned);
  if (!m) return null;
  // First span wins: a multi-file drag pastes several paths, and for
  // part-file sets the sibling loader brings the rest anyway.
  return m[1] ?? m[2] ?? m[3] ?? m[4] ?? null;
}

/** Words allowed to surround a path without making the line prose. Command
 *  verbs (`run`, `show`, `open`…) are deliberately absent — those lines
 *  belong to the intent handler, not the drop path. */
const LOAD_FILLER = new Set([
  "load", "ingest", "import", "read", "analyse", "analyze",
  "please", "the", "my", "this", "that", "file", "data", "dataset",
]);

export function normaliseDroppedPath(raw: string): string {
  let p = raw.trim();
  let quoted = false;
  if (p.length >= 2 && p.startsWith("'") && p.endsWith("'")) {
    p = p.slice(1, -1);
    quoted = true;
    // Shell single-quoting has no escape INSIDE the quotes, so an apostrophe
    // is written by closing, escaping, and reopening: GNOME's g_shell_quote
    // turns /tmp/John's data.csv into '/tmp/John'\''s data.csv'. Undo that
    // before the generic unescape below, which would otherwise leave '''.
    p = p.replace(/'\\''/g, "'").replace(/'"'"'/g, "'");
  } else if (p.length >= 2 && p.startsWith('"') && p.endsWith('"')) {
    p = p.slice(1, -1);
    quoted = true;
    // Inside double quotes only these four are escapable.
    p = p.replace(/\\([\\"$`])/g, "$1");
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
  if (!quoted) p = p.replace(/\\(.)/g, "$1");
  p = p.trim();
  // `~` belongs to the shell, not the kernel: readFile("~/x.csv") is an
  // ENOENT with a perfectly correct-looking path in the error message.
  if (p === "~") p = homedir();
  else if (p.startsWith("~/")) p = join(homedir(), p.slice(2));
  return p;
}

/**
 * The composer-ready form of a pasted drop, or null when the paste is not a
 * drop at all.
 *
 * extractDataPath decides at ⏎ time; this decides at PASTE time, so what
 * lands in the composer is the clean path — never the file:// URI, quote
 * soup, or escaped spaces the emulator actually sent. It goes back in
 * single quotes: `'folder/data.csv'` reads as one unit in the composer,
 * shows exactly where the path starts and ends when it sits next to typed
 * text, and survives re-extraction on ⏎ whatever the name contains.
 */
export function dropInsertText(text: string): string | null {
  const span = extractDataPath(text);
  if (span === null) return null;
  const p = normaliseDroppedPath(span);
  if (p === "") return null;
  // An apostrophe in the name is the one case single quotes cannot hold —
  // the quoted-span pattern stops at the first `'` — so it takes doubles.
  if (p.includes("'")) return `"${p}"`;
  return `'${p}'`;
}

/** Separators that actually divide fields — the ones inside `"…"` belong to
 *  the value (`"Smith, John"`), and counting them is what made a perfectly
 *  ordinary CSV's lines disagree about their own width. */
function countOutsideQuotes(line: string, d: string): number {
  let n = 0;
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      // "" inside a quoted field is one escaped quote, not a close+open.
      if (inQuotes && line[i + 1] === '"') i++;
      else inQuotes = !inQuotes;
    } else if (ch === d && !inQuotes) n++;
  }
  return n;
}

/** Lines a paste needs before it can be called a data file. A real
 *  copy-the-whole-file paste is hundreds of lines; three is a salutation. */
const CONTENTS_MIN_LINES = 5;
/** Separators per line. One comma per line is prose ("Dear team,"), R
 *  (`c(1, 2)`) or C (`int a = 1;`); two-plus, on line after line, is a
 *  table. */
const CONTENTS_MIN_DELIMS = 2;

/**
 * True when a paste is the CONTENTS of a data file rather than its path —
 * the one drop-gone-wrong this TUI can name: the file was opened, its text
 * copied, and the whole thing pasted.
 *
 * Deliberately biased AGAINST firing. A false positive throws the user's
 * paste away and explains it wrongly, which is worse than a flooded composer
 * they can clear with Esc — so the signature demands a real table's worth of
 * evidence: five-plus lines, two-plus separators each, and agreement across
 * most of them. Agreement is by majority rather than by unanimity because
 * quoted fields legitimately carry the separator (`"Smith, John"`), which
 * makes a genuine CSV's counts disagree line to line.
 */
export function looksLikeFileContents(text: string): boolean {
  const lines = text
    .split(/\r\n?|\n/)
    .map((l) => l.trim())
    .filter((l) => l !== "");
  if (lines.length < CONTENTS_MIN_LINES) return false;
  const sample = lines.slice(0, 12);
  // Aligned code clears the delimiter bar too — `premium <- c(1, 2, 3)` five
  // times over is two commas a line, consistently. A data file's rows do not
  // carry assignment arrows, call parens or braces, so a sample that mostly
  // does is a snippet somebody wants to ASK about, and throwing it away with
  // "that looks like a file's contents" is both wrong and lossy.
  const codey = sample.filter((l) => /<-|=>|[(){}]|;\s*$|^\s*(#|\/\/)/.test(l)).length;
  if (codey >= Math.ceil(sample.length * 0.5)) return false;
  for (const d of [",", ";", "\t", "|"]) {
    const counts = sample.map((l) => countOutsideQuotes(l, d));
    // The modal count carries the table's shape; quoted separators show up
    // as a minority of lines sitting above it.
    const tally = new Map<number, number>();
    for (const c of counts) tally.set(c, (tally.get(c) ?? 0) + 1);
    let mode = 0;
    let hits = 0;
    for (const [c, n] of tally) {
      if (n > hits || (n === hits && c > mode)) {
        mode = c;
        hits = n;
      }
    }
    if (mode >= CONTENTS_MIN_DELIMS && hits >= Math.ceil(sample.length * 0.7)) return true;
  }
  return false;
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
 *  ingest looks for the rest. Exported for the /files picker, which shows a
 *  complete set as one entry rather than three. */
export const PART_RE = /^(.*part)(\d+)(_of_)(\d+)(.*\.csv)$/i;

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
