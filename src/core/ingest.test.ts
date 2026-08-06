// Ingest: pasted-path normalisation and the multi-part sibling loader.
// Chunked exports (`<stem>_part1_of_3.csv`) are one dataset split for
// transport — handing the TUI any one part loads all of them, in order.

import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MAX_ROWS, extractDataPath, loadDataset, normaliseDroppedPath } from "./ingest";

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

  test("junk without any path is not a drop", () => {
    expect(extractDataPath("0;95;34M0;95;34m")).toBeNull();
    expect(extractDataPath("")).toBeNull();
  });
});
