// Ingest: pasted-path normalisation and the multi-part sibling loader.
// Chunked exports (`<stem>_part1_of_3.csv`) are one dataset split for
// transport — handing the TUI any one part loads all of them, in order.

import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import {
  MAX_ROWS,
  dropInsertText,
  extractDataPath,
  loadDataset,
  looksLikeFileContents,
  normaliseDroppedPath,
} from "./ingest";

function partDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "scelo-ingest-"));
  const rows = (from: number, n: number) =>
    Array.from({ length: n }, (_, i) => `P${from + i},${(from + i) * 10}`).join("\n");
  writeFileSync(join(dir, "book_part1_of_3.csv"), `id,amount\n${rows(0, 5)}\n`);
  writeFileSync(join(dir, "book_part2_of_3.csv"), `id,amount\n${rows(5, 5)}\n`);
  writeFileSync(join(dir, "book_part3_of_3.csv"), `id,amount\n${rows(10, 5)}\n`);
  return dir;
}

describe("loadDataset · part files", () => {
  test("any one part loads ALL siblings, in part order", async () => {
    const dir = partDir();
    // Hand it the MIDDLE part — order must still be 1, 2, 3.
    const r = await loadDataset(join(dir, "book_part2_of_3.csv"));
    if (!r.ok) throw new Error(r.error);
    expect(r.dataset.rows).toHaveLength(15);
    expect(r.dataset.rows[0].id).toBe("P0");
    expect(r.dataset.rows[14].id).toBe("P14");
    expect(r.dataset.name).toBe("book_3_parts.csv");
    expect(r.dataset.sampled).toBeUndefined();
  });

  test("an incomplete set loads only the named file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "scelo-ingest-"));
    writeFileSync(join(dir, "book_part1_of_3.csv"), "id,amount\nP0,0\n");
    // parts 2 and 3 are missing
    const r = await loadDataset(join(dir, "book_part1_of_3.csv"));
    if (!r.ok) throw new Error(r.error);
    expect(r.dataset.rows).toHaveLength(1);
    expect(r.dataset.name).toBe("book_part1_of_3.csv");
  });

  test("parts with disagreeing headers refuse loudly instead of mis-joining", async () => {
    const dir = mkdtempSync(join(tmpdir(), "scelo-ingest-"));
    writeFileSync(join(dir, "book_part1_of_2.csv"), "id,amount\nP0,0\n");
    writeFileSync(join(dir, "book_part2_of_2.csv"), "id,value\nP1,1\n");
    const r = await loadDataset(join(dir, "book_part1_of_2.csv"));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("different columns");
  });

  test("a plain csv is untouched by part detection", async () => {
    const dir = mkdtempSync(join(tmpdir(), "scelo-ingest-"));
    writeFileSync(join(dir, "claims.csv"), "id,amount\nP0,0\nP1,10\n");
    const r = await loadDataset(join(dir, "claims.csv"));
    if (!r.ok) throw new Error(r.error);
    expect(r.dataset.name).toBe("claims.csv");
    expect(r.dataset.rows).toHaveLength(2);
  });

  test("the row ceiling applies to the COMBINED set, with honest provenance", async () => {
    const dir = mkdtempSync(join(tmpdir(), "scelo-ingest-"));
    const half = Math.ceil(MAX_ROWS / 2) + 1000; // two parts jointly exceed the cap
    const rows = (n: number) => Array.from({ length: n }, (_, i) => `P${i},1`).join("\n");
    writeFileSync(join(dir, "big_part1_of_2.csv"), `id,amount\n${rows(half)}\n`);
    writeFileSync(join(dir, "big_part2_of_2.csv"), `id,amount\n${rows(half)}\n`);
    const r = await loadDataset(join(dir, "big_part1_of_2.csv"));
    if (!r.ok) throw new Error(r.error);
    expect(r.dataset.rows).toHaveLength(MAX_ROWS);
    expect(r.dataset.sampled).toBe(true);
    expect(r.dataset.sourceTotalRows).toBe(half * 2);
  });
});

describe("normaliseDroppedPath", () => {
  test("unquotes, decodes file:// and unescapes spaces", () => {
    expect(normaliseDroppedPath("'/tmp/a b.csv'")).toBe("/tmp/a b.csv");
    expect(normaliseDroppedPath('"/tmp/a.csv"')).toBe("/tmp/a.csv");
    expect(normaliseDroppedPath("file:///tmp/a%20b.csv")).toBe("/tmp/a b.csv");
    expect(normaliseDroppedPath("/tmp/a\\ b.csv")).toBe("/tmp/a b.csv");
  });

  test("~ expands to the home directory — readFile('~/…') is always ENOENT", () => {
    expect(normaliseDroppedPath("~/data/a.csv")).toBe(join(homedir(), "data/a.csv"));
    expect(normaliseDroppedPath("'~/a b.csv'")).toBe(join(homedir(), "a b.csv"));
  });
});

describe("extractDataPath", () => {
  test("a clean pasted path comes back as itself", () => {
    expect(extractDataPath("/home/x/claims.csv")).toBe("/home/x/claims.csv");
    expect(extractDataPath("  '/home/x/a b.csv'  ")).toBe("/home/x/a b.csv");
    expect(extractDataPath("~/data/book.tsv")).toBe("~/data/book.tsv");
  });

  test("a drag bracketed by mouse-report junk yields ONLY the path", () => {
    expect(extractDataPath("0;95;34M'/home/x/a b.csv'0;95;34m")).toBe("/home/x/a b.csv");
    expect(extractDataPath("0;140;37M/home/x/claims.csv0;140;37m")).toBe("/home/x/claims.csv");
    expect(extractDataPath("[<0;95;34Mfile:///tmp/a.csv")).toBe("file:///tmp/a.csv");
  });

  test("a multi-file drag takes the first path (siblings load themselves)", () => {
    const line = "'/d/book_part1_of_3.csv' '/d/book_part2_of_3.csv' '/d/book_part3_of_3.csv'";
    expect(extractDataPath(line)).toBe("/d/book_part1_of_3.csv");
  });

  test("prose that mentions a file stays prose", () => {
    expect(extractDataPath("what is in /home/x/claims.csv")).toBeNull();
    expect(extractDataPath("compare claims.csv to last year")).toBeNull();
    expect(extractDataPath("summarise the data")).toBeNull();
  });

  test("relative and bare paths are drops too — typing a path must load it", () => {
    expect(extractDataPath("./claims.csv")).toBe("./claims.csv");
    expect(extractDataPath("data/claims.csv")).toBe("data/claims.csv");
    expect(extractDataPath("claims.csv")).toBe("claims.csv");
    expect(extractDataPath("'data dir/claims 2026.csv'")).toBe("data dir/claims 2026.csv");
  });

  test("a load instruction around a path is a drop, not a sentence", () => {
    expect(extractDataPath("load ./claims.csv")).toBe("./claims.csv");
    expect(extractDataPath("please load ~/book.csv")).toBe("~/book.csv");
    // …but command verbs keep their lines: /run belongs to the intent
    // handler even when its argument ends in .csv.
    expect(extractDataPath("/run claims.csv")).toBeNull();
  });

  test("a line naming an existing file loads whatever shape it is", () => {
    const dir = mkdtempSync(join(tmpdir(), "scelo-ingest-"));
    writeFileSync(join(dir, "my claims.csv"), "id,amount\nP0,0\n");
    // Unquoted with a space — pure shape-guessing calls this prose; the
    // filesystem knows better.
    expect(extractDataPath(join(dir, "my claims.csv"))).toBe(join(dir, "my claims.csv"));
  });

  test("junk without any path is not a drop", () => {
    expect(extractDataPath("0;95;34M0;95;34m")).toBeNull();
    expect(extractDataPath("")).toBeNull();
  });
});

describe("dropInsertText", () => {
  test("every emulator dialect lands in the composer as one quoted path", () => {
    expect(dropInsertText("file:///tmp/claims.csv")).toBe("'/tmp/claims.csv'");
    expect(dropInsertText("'/tmp/claims.csv'")).toBe("'/tmp/claims.csv'");
    expect(dropInsertText('"/tmp/claims.csv"')).toBe("'/tmp/claims.csv'");
    expect(dropInsertText("/tmp/claims.csv")).toBe("'/tmp/claims.csv'");
  });

  test("a relative drop is quoted too — the quotes mark where the path ends", () => {
    expect(dropInsertText("folder/data.csv")).toBe("'folder/data.csv'");
    expect(dropInsertText("data.csv")).toBe("'data.csv'");
  });

  test("spaces come back single-quoted so ⏎ can re-extract the path", () => {
    expect(dropInsertText("/tmp/a\\ b.csv")).toBe("'/tmp/a b.csv'");
    expect(dropInsertText("file:///tmp/a%20b.csv")).toBe("'/tmp/a b.csv'");
    expect(dropInsertText("'/tmp/a b.csv'")).toBe("'/tmp/a b.csv'");
  });

  test("~ expands at paste time — the composer shows the real path", () => {
    expect(dropInsertText("~/claims.csv")).toBe(`'${join(homedir(), "claims.csv")}'`);
  });

  test("a multi-file drop inserts the first path (siblings load themselves)", () => {
    expect(dropInsertText("'/d/a.csv' '/d/b.csv'")).toBe("'/d/a.csv'");
  });

  test("mouse-report junk around a drop is not part of the path", () => {
    expect(dropInsertText("0;95;34M'/data/book.csv'0;95;34m")).toBe("'/data/book.csv'");
  });

  test("prose and non-drops insert nothing", () => {
    expect(dropInsertText("what is in /home/x/claims.csv")).toBeNull();
    expect(dropInsertText("hello world")).toBeNull();
    expect(dropInsertText("")).toBeNull();
  });

  test("prose in any script vetoes the drop, not just Latin", () => {
    // `[a-z]` erased these words to nothing, so the sentence read as a bare
    // path and the user's question was replaced by it.
    expect(dropInsertText("проанализируй данные в /tmp/claims.csv")).toBeNull();
    expect(dropInsertText("分析 データ.csv")).toBeNull();
    expect(dropInsertText("σύγκρινε /tmp/a.csv")).toBeNull();
    // Two letters is the bar, so a shell verb counts as prose…
    expect(dropInsertText("rm data.csv")).toBeNull();
    // …while a lone letter from a split mouse report still does not.
    expect(dropInsertText("4M'/data/book.csv'")).toBe("'/data/book.csv'");
  });

  test("GNOME's shell-quoted apostrophe survives the round trip", () => {
    const dir = mkdtempSync(join(tmpdir(), "scelo-ingest-"));
    const real = join(dir, "John's data.csv");
    writeFileSync(real, "id,amount\nP0,1\n");
    // g_shell_quote closes, escapes, reopens: '…John'\''s data.csv'
    const dropped = `'${real.replace(/'/g, "'\\''")}'`;
    expect(normaliseDroppedPath(dropped)).toBe(real);
    const inserted = dropInsertText(dropped);
    expect(inserted).toBe(`"${real}"`);
    // …and what lands in the composer must re-extract on ⏎.
    expect(normaliseDroppedPath(extractDataPath(inserted as string) as string)).toBe(real);
  });
});

describe("looksLikeFileContents", () => {
  const csv = (rows: number, sep = ",") =>
    [`id${sep}amount${sep}region`, ...Array.from({ length: rows }, (_, i) => `P${i}${sep}${i * 10}${sep}north`)].join(
      "\n",
    );

  test("a pasted CSV body is contents, not a path", () => {
    expect(looksLikeFileContents(csv(8))).toBe(true);
    expect(looksLikeFileContents(csv(8, "\t"))).toBe(true);
    expect(looksLikeFileContents(csv(8, ";"))).toBe(true);
    expect(looksLikeFileContents(csv(8, "|"))).toBe(true);
  });

  test("quoted fields carrying the separator still read as a table", () => {
    // The counts DISAGREE line to line here — a unanimity test misses this,
    // which is the commonest real CSV shape there is.
    const quoted = [
      "name,notes,region",
      '"Smith, John",good,north',
      '"Doe, Jane",bad,south',
      '"Roe, R",ok,east',
      "Plain,fine,west",
      '"Ng, A",good,north',
    ].join("\n");
    expect(looksLikeFileContents(quoted)).toBe(true);
  });

  test("prose, code and short pastes are NOT discarded", () => {
    // A false positive throws the user's paste away; these all used to.
    expect(
      looksLikeFileContents("Dear team, please review\nthe numbers, then confirm\nby Friday, thanks"),
    ).toBe(false);
    expect(looksLikeFileContents("x <- c(1, 2)\ny <- c(3, 4)\nz <- c(5, 6)")).toBe(false);
    expect(looksLikeFileContents("int a = 1;\nint b = 2;\nint c = 3;")).toBe(false);
    expect(looksLikeFileContents("color: red;\nfont-size: 12px;\nmargin: 0;")).toBe(false);
    expect(looksLikeFileContents("just one line, with a comma")).toBe(false);
    expect(looksLikeFileContents("")).toBe(false);
  });

  test("a table needs real length — three rows is a salutation, not a file", () => {
    expect(looksLikeFileContents("a,b,c\n1,2,3\n4,5,6")).toBe(false);
  });
});

describe("looksLikeFileContents vs. code", () => {
  test("aligned R/JS call lines are a snippet, not a file", () => {
    // Five lines, two commas each, 70% agreement — it clears every
    // structural bar, and used to be discarded with a wrong explanation.
    expect(
      looksLikeFileContents(
        [
          "premium <- c(1, 2, 3)",
          "claims  <- c(4, 5, 6)",
          'region  <- c("N", "S", "E")',
          "age     <- c(30, 40, 50)",
          'sex     <- c("M", "F", "M")',
        ].join("\n"),
      ),
    ).toBe(false);
    expect(
      looksLikeFileContents(
        [
          "const a = f(1, 2, 3);",
          "const b = f(4, 5, 6);",
          "const c = f(7, 8, 9);",
          "const d = f(1, 2, 3);",
          "const e = f(4, 5, 6);",
        ].join("\n"),
      ),
    ).toBe(false);
  });

  test("…but a real CSV body is still caught", () => {
    const csv = ["id,amount,region", ...Array.from({ length: 9 }, (_, i) => `P${i},${i * 10},north`)];
    expect(looksLikeFileContents(csv.join("\n"))).toBe(true);
  });
});
