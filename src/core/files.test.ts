// The /files scan: what counts as a data file, how far the walk reaches, and
// the promise that a complete part set shows as ONE entry — because that is
// what ingest will load when it is picked.

import { describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fmtBytes, fmtWhen, listDataFiles } from "./files";

describe("listDataFiles", () => {
  test("finds csv/tsv/txt near the root, newest first, and nothing else", () => {
    const root = mkdtempSync(join(tmpdir(), "scelo-files-"));
    const put = (rel: string, at: number) => {
      const full = join(root, rel);
      mkdirSync(join(full, ".."), { recursive: true });
      writeFileSync(full, "id,amount\nP0,1\n");
      utimesSync(full, at / 1000, at / 1000);
    };
    put("old.csv", 1_000_000);
    put("new.tsv", 3_000_000);
    put("mid.txt", 2_000_000);
    writeFileSync(join(root, "notes.md"), "not data");
    writeFileSync(join(root, "img.png"), "not data");
    const got = listDataFiles(root).files;
    expect(got.map((e) => e.rel)).toEqual(["new.tsv", "mid.txt", "old.csv"]);
  });

  test("descends three levels but not four, and skips hidden/node_modules", () => {
    const root = mkdtempSync(join(tmpdir(), "scelo-files-"));
    const put = (rel: string) => {
      const full = join(root, rel);
      mkdirSync(join(full, ".."), { recursive: true });
      writeFileSync(full, "a,b\n1,2\n");
    };
    put("d1/a.csv");
    put("d1/d2/b.csv");
    put("d1/d2/d3/c.csv");
    put("d1/d2/d3/d4/too-deep.csv");
    put("node_modules/x.csv");
    put(".cache/y.csv");
    const rels = listDataFiles(root).files.map((e) => e.rel);
    expect(rels).toContain("d1/a.csv");
    expect(rels).toContain(join("d1/d2/b.csv"));
    expect(rels).toContain(join("d1/d2/d3/c.csv"));
    expect(rels).not.toContain(join("d1/d2/d3/d4/too-deep.csv"));
    expect(rels.some((r) => r.includes("node_modules"))).toBe(false);
    expect(rels.some((r) => r.includes(".cache"))).toBe(false);
  });

  test("a COMPLETE part set collapses to one entry with summed size", () => {
    const root = mkdtempSync(join(tmpdir(), "scelo-files-"));
    writeFileSync(join(root, "book_part1_of_2.csv"), "a,b\n1,2\n");
    writeFileSync(join(root, "book_part2_of_2.csv"), "a,b\n3,4\n5,6\n");
    const got = listDataFiles(root).files;
    expect(got.length).toBe(1);
    expect(got[0].rel).toBe("book_part1_of_2.csv");
    expect(got[0].parts).toBe(2);
    expect(got[0].bytes).toBe(
      "a,b\n1,2\n".length + "a,b\n3,4\n5,6\n".length,
    );
  });

  test("zero-padded parts stay separate — ingest would load only one of them", () => {
    // partPaths reconstructs `book_part2_of_02.csv`, which does not exist, so
    // picking a collapsed entry here would silently analyse half the data.
    const root = mkdtempSync(join(tmpdir(), "scelo-files-"));
    writeFileSync(join(root, "book_part01_of_02.csv"), "a,b\n1,2\n");
    writeFileSync(join(root, "book_part02_of_02.csv"), "a,b\n3,4\n");
    const got = listDataFiles(root).files;
    expect(got.length).toBe(2);
    expect(got.every((e) => e.parts === undefined)).toBe(true);
  });

  test("a set of more than 99 parts is not collapsed — ingest's own bound", () => {
    const root = mkdtempSync(join(tmpdir(), "scelo-files-"));
    for (let k = 1; k <= 100; k++) {
      writeFileSync(join(root, `big_part${k}_of_100.csv`), "a,b\n1,2\n");
    }
    const got = listDataFiles(root).files;
    expect(got.length).toBe(100);
    expect(got.every((e) => e.parts === undefined)).toBe(true);
  });

  test("an INCOMPLETE part set stays as the files that exist", () => {
    const root = mkdtempSync(join(tmpdir(), "scelo-files-"));
    writeFileSync(join(root, "book_part1_of_3.csv"), "a,b\n1,2\n");
    writeFileSync(join(root, "book_part3_of_3.csv"), "a,b\n3,4\n");
    const got = listDataFiles(root).files;
    expect(got.length).toBe(2);
    expect(got.every((e) => e.parts === undefined)).toBe(true);
  });

  test("a stray part beyond the total keeps its own row and its own bytes", () => {
    // partPaths loads 1..total; a `part3_of_2` is not in that set, so its
    // bytes must not be counted into the collapsed entry, and it must not
    // silently disappear from a list of files that exist.
    const root = mkdtempSync(join(tmpdir(), "scelo-files-"));
    writeFileSync(join(root, "book_part1_of_2.csv"), "a,b\n1,2\n");
    writeFileSync(join(root, "book_part2_of_2.csv"), "a,b\n3,4\n");
    writeFileSync(join(root, "book_part3_of_2.csv"), "a,b\n5,6\nlonger\n");
    const got = listDataFiles(root).files;
    const set = got.find((e) => e.parts === 2);
    expect(set).toBeDefined();
    expect(set?.bytes).toBe("a,b\n1,2\n".length + "a,b\n3,4\n".length);
    expect(got.map((e) => e.rel)).toContain("book_part3_of_2.csv");
  });

  test("a symlink cycle does not multiply entries", () => {
    const root = mkdtempSync(join(tmpdir(), "scelo-files-"));
    writeFileSync(join(root, "a.csv"), "a,b\n1,2\n");
    symlinkSync(root, join(root, "self"));
    const got = listDataFiles(root).files;
    expect(got.filter((e) => e.rel.endsWith("a.csv")).length).toBe(1);
  });

  test("the cap keeps the NEWEST files and reports what it dropped", () => {
    const root = mkdtempSync(join(tmpdir(), "scelo-files-"));
    // 420 files whose mtimes run opposite to their names, so readdir order
    // and recency disagree — the old code kept whatever came back first.
    for (let i = 0; i < 420; i++) {
      const f = join(root, `f${String(i).padStart(3, "0")}.csv`);
      writeFileSync(f, "a,b\n1,2\n");
      utimesSync(f, 1_000_000 + i, 1_000_000 + i);
    }
    const { files, found } = listDataFiles(root);
    expect(found).toBe(420);
    expect(files.length).toBe(400);
    // The newest file must be present, and the oldest must be the ones cut.
    expect(files[0].rel).toBe("f419.csv");
    expect(files.map((e) => e.rel)).not.toContain("f000.csv");
  });

  test("an unreadable root throws rather than reporting 'no data files'", () => {
    const root = mkdtempSync(join(tmpdir(), "scelo-files-"));
    const locked = join(root, "locked");
    mkdirSync(locked);
    writeFileSync(join(locked, "secret.csv"), "a,b\n1,2\n");
    chmodSync(locked, 0o000);
    try {
      // A wrong "nothing here" sends the user hunting for a file that exists.
      expect(() => listDataFiles(locked)).toThrow();
    } finally {
      chmodSync(locked, 0o700);
    }
  });

  test("a file for a root is an error, not an empty list", () => {
    const root = mkdtempSync(join(tmpdir(), "scelo-files-"));
    writeFileSync(join(root, "a.csv"), "a,b\n");
    expect(() => listDataFiles(join(root, "a.csv"))).toThrow();
  });
});

describe("fmtBytes / fmtWhen", () => {
  test("sizes read like a file manager", () => {
    expect(fmtBytes(512)).toBe("512 B");
    expect(fmtBytes(1536)).toBe("1.5 KB");
    expect(fmtBytes(Math.round(20.2 * 1024 * 1024))).toBe("20.2 MB");
  });

  test("timestamps shrink with distance", () => {
    const now = new Date(2026, 7, 6, 20, 0).getTime();
    expect(fmtWhen(new Date(2026, 7, 6, 19, 28).getTime(), now)).toBe("19:28");
    expect(fmtWhen(new Date(2026, 3, 2).getTime(), now)).toBe("Apr 2");
    expect(fmtWhen(new Date(2025, 10, 5).getTime(), now)).toBe("Nov 2025");
  });
});
