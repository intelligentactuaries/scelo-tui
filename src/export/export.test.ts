// The export engine, verified by the consumers it targets rather than by
// its own mirror image:
//   - the zip and workbook are read back by PYTHON's zipfile + ElementTree —
//     an independent implementation that checks CRCs on extraction, so a
//     malformed container fails here and not in Excel;
//   - the .sce is fed to THE IDE'S OWN parseSce (imported from the scelo
//     repo the TUI already depends on) — the artifact is accepted by the
//     code that will actually open it, not by our copy of its rules.

import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Dataset, summariseDataset } from "@scelo/core";
import { MODELS, MODEL_BY_ID } from "../agent/analyses";
import type { PipelineResult } from "../agent/pipeline";
import { toCsv } from "./csv";
import { ALL_TARGETS, exportArtifacts, parseTarget, parseTargets } from "./index";
import { buildNotebook } from "./notebook";
import { buildSce, sceFilename } from "./sce";
import { buildPython, buildR, coveredAnalyses } from "./scripts";
import { DATA_SHEET_CAP } from "./workbook";
import { buildZip, crc32 } from "./zip";

const NOW = new Date("2026-07-26T12:00:00Z");

const HAVE_PYTHON = (() => {
  try {
    return Bun.spawnSync({ cmd: ["python3", "--version"] }).exitCode === 0;
  } catch {
    return false;
  }
})();

function py(script: string, stdinBytes?: Uint8Array): string {
  const dir = mkdtempSync(join(tmpdir(), "scelo-exp-"));
  if (stdinBytes) writeFileSync(join(dir, "input.bin"), stdinBytes);
  const proc = Bun.spawnSync({ cmd: ["python3", "-c", script], cwd: dir, stdout: "pipe", stderr: "pipe" });
  if (proc.exitCode !== 0) throw new Error(`python failed: ${proc.stderr.toString()}`);
  return proc.stdout.toString().trim();
}

// The same book the analyses tests use — every analysis applies to it.
function fixture(): Dataset {
  const rows = [];
  const regions = ["North", "South", "East", "West"];
  for (let i = 0; i < 40; i++) {
    const premium = 1000 + i * 100;
    rows.push({
      policy_id: `P${i}`,
      premium,
      claims: premium * 0.4,
      age: 20 + ((i * 7) % 50),
      sex: i % 2 === 0 ? "M" : "F",
      region: regions[i % 4],
      start_date: `2023-${String((i % 6) + 1).padStart(2, "0")}-15`,
      notes: i % 5 === 0 ? "review" : null,
    });
  }
  return {
    name: "book.csv",
    columns: ["policy_id", "premium", "claims", "age", "sex", "region", "start_date", "notes"],
    rows,
  };
}

function pipeFor(analysisId: string): PipelineResult {
  const dataset = fixture();
  const metas = summariseDataset(dataset);
  const chosen = MODEL_BY_ID.get(analysisId);
  if (!chosen) throw new Error(`no analysis ${analysisId}`);
  return {
    dataset,
    metas,
    clean: {
      dataset,
      passes: [{ opLabels: ["trim whitespace in `notes`", "drop empty column `memo`"] }] as never,
      outcome: "clean",
      rowsBefore: 41,
      rowsAfter: 40,
      columnsBefore: 9,
      columnsAfter: 8,
      droppedColumns: ["memo"],
      remaining: [],
    },
    reading: "One row per policy.\nPremium and claims carry the weight.",
    chosen,
    rationale: "premium and region make a natural segmentation",
    result: chosen.run(dataset, summariseDataset(dataset)),
    degraded: null,
  };
}

describe("csv", () => {
  test("quotes only what needs quoting and round-trips through python's csv", () => {
    const ds: Dataset = {
      name: "t.csv",
      columns: ["a", "b"],
      rows: [
        { a: 'say "hi"', b: 1.5 },
        { a: "one,two", b: null },
        { a: "line\nbreak", b: -2 },
      ],
    };
    const text = toCsv(ds);
    expect(text).toContain('"say ""hi""",1.5');
    if (!HAVE_PYTHON) return;
    const out = py(
      `
import csv
rows = list(csv.reader(open("input.bin", newline="")))
assert rows[0] == ["a", "b"], rows[0]
assert rows[1] == ['say "hi"', "1.5"], rows[1]
assert rows[2] == ["one,two", ""], rows[2]
assert rows[3] == ["line\\nbreak", "-2"], rows[3]
print("ok")
`,
      new TextEncoder().encode(text),
    );
    expect(out).toBe("ok");
  });
});

describe("zip", () => {
  test("crc32 matches the IEEE check value", () => {
    expect(crc32(new TextEncoder().encode("123456789")).toString(16)).toBe("cbf43926");
  });

  test.skipIf(!HAVE_PYTHON)("python's zipfile extracts it byte-for-byte", () => {
    const entries = [
      { name: "a.txt", data: new TextEncoder().encode("hello zip") },
      { name: "dir/b.xml", data: new TextEncoder().encode("<x>ü — em</x>".repeat(200)) },
    ];
    const out = py(
      `
import zipfile
z = zipfile.ZipFile("input.bin")
assert z.testzip() is None, "corrupt entry"
assert z.namelist() == ["a.txt", "dir/b.xml"], z.namelist()
assert z.read("a.txt") == b"hello zip"
assert len(z.read("dir/b.xml")) == ${entries[1].data.length}
print("ok")
`,
      buildZip(entries, NOW),
    );
    expect(out).toBe("ok");
  });
});

describe("workbook (.xlsx)", () => {
  test.skipIf(!HAVE_PYTHON)("opens as a valid sheet set with the right content", () => {
    const pipe = pipeFor("group-metric");
    const dir = mkdtempSync(join(tmpdir(), "scelo-xlsx-"));
    const { dir: outDir, files } = exportArtifacts(pipe, { targets: ["xlsx"], cwd: dir, now: NOW });
    const xlsx = files.find((f) => f.name.endsWith(".xlsx"));
    expect(xlsx).toBeDefined();
    const out = py(
      `
import zipfile, xml.etree.ElementTree as ET
NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
z = zipfile.ZipFile(${JSON.stringify(join(outDir, xlsx?.name ?? ""))})
assert z.testzip() is None
wb = ET.fromstring(z.read("xl/workbook.xml"))
names = [s.get("name") for s in wb.findall(".//m:sheet", NS)]
assert names == ["summary", "results", "columns", "data"], names

def texts(part):
    sheet = ET.fromstring(z.read(part))
    return [t.text or "" for t in sheet.findall(".//m:is/m:t", NS)]

summary = texts("xl/worksheets/sheet1.xml")
assert "book.csv" in summary, summary[:10]
assert any("trim whitespace" in t for t in summary)
results = texts("xl/worksheets/sheet2.xml")
assert any("premium" in t and "region" in t for t in results)
data = ET.fromstring(z.read("xl/worksheets/sheet4.xml"))
rows = data.findall(".//m:row", NS)
assert len(rows) == 41, len(rows)   # header + 40
# numbers must be numeric cells, not strings
first_data_row = rows[1]
vals = first_data_row.findall("m:c/m:v", NS)
assert len(vals) >= 3, "premium/claims/age should be <v> number cells"
print("ok")
`,
    );
    expect(out).toBe("ok");
  });

  test("caps the data sheet and says so in the summary", () => {
    const dataset = fixture();
    const bigRows = [];
    for (let i = 0; i < DATA_SHEET_CAP + 500; i++) bigRows.push(dataset.rows[i % 40]);
    const big: Dataset = { ...dataset, rows: bigRows };
    const metas = summariseDataset(big);
    const pipe: PipelineResult = { ...pipeFor("numeric-summary"), dataset: big, metas };
    const dir = mkdtempSync(join(tmpdir(), "scelo-cap-"));
    const { dir: outDir, files } = exportArtifacts(pipe, { targets: ["xlsx"], cwd: dir, now: NOW });
    if (!HAVE_PYTHON) return;
    const name = files.find((f) => f.name.endsWith(".xlsx"))?.name ?? "";
    const out = py(
      `
import zipfile, xml.etree.ElementTree as ET
NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
z = zipfile.ZipFile(${JSON.stringify(join(outDir, name))})
data = ET.fromstring(z.read("xl/worksheets/sheet4.xml"))
print(len(data.findall(".//m:row", NS)))
summary = " | ".join(t.text or "" for t in ET.fromstring(z.read("xl/worksheets/sheet1.xml")).findall(".//m:is/m:t", NS))
assert "full data in data.csv" in summary
`,
    );
    expect(Number(out)).toBe(DATA_SHEET_CAP + 1); // header + cap
  });
});

describe("scripts", () => {
  const metas = summariseDataset(fixture());

  test("the registry covers every analysis on the menu", () => {
    // A ninth analysis without an export story fails HERE, not in the field.
    const ids = MODELS.map((m) => m.id);
    expect(coveredAnalyses(metas, ids).sort()).toEqual([...ids].sort());
  });

  test("python restates the pane's group-metric on the same columns", () => {
    const src = buildPython(pipeFor("group-metric"), NOW);
    expect(src).toContain('df = pd.read_csv("data.csv")');
    expect(src).toContain('df.groupby("region")["premium"]');
    expect(src).toContain("trim whitespace in `notes`"); // provenance
    expect(src).toContain("premium and region make a natural segmentation");
    expect(src).not.toContain("undefined");
  });

  test("R restates the same analysis in base R", () => {
    const src = buildR(pipeFor("group-metric"), NOW);
    expect(src).toContain('read.csv("data.csv"');
    expect(src).toContain('tapply(df[["premium"]], df[["region"]]');
    expect(src.split("\n").every((l) => !l.includes("undefined"))).toBe(true);
  });

  test("read.csv is told not to rename columns or invent empty strings", () => {
    // R's defaults break the script two ways: make.names() rewrites any
    // non-syntactic header (`loss_ratio_%` → `loss_ratio_.`) so every
    // df[["…"]] returns NULL and the file halts; and an empty field stays
    // the literal "" in a character column, so missingness reads as zero
    // and frequency shares gain a phantom blank level.
    const src = buildR(pipeFor("group-metric"), NOW);
    expect(src).toContain("check.names = FALSE");
    expect(src).toContain('na.strings = c("NA", "")');
  });

  test("the time-profile script buckets by the pane's own bin, gap-filled", () => {
    // Six months of data → month bin → pandas "M" period.
    const src = buildPython(pipeFor("time-profile"), NOW);
    expect(src).toContain('d.dt.to_period("M")');
    const r = buildR(pipeFor("time-profile"), NOW);
    expect(r).toContain('format(x, "%Y-%m")');
    // Levels come from walking the calendar, so an empty period prints a
    // zero row the way the pane's binPoints does.
    expect(r).toContain('by = "month"');
    expect(r).toContain("levels = unique(scelo_period(span))");
  });

  test("the quarter binner guards NA instead of fabricating an NA-QNA bucket", () => {
    // paste0 stringifies NA into the literal "NA-QNA", which table() then
    // reports as a real quarter alongside the genuine ones. Needs a span
    // wide enough that the pane picks quarter rather than month.
    const dataset = fixture();
    const spread: Dataset = {
      ...dataset,
      rows: dataset.rows.map((r, i) => ({
        ...r,
        start_date: `20${20 + (i % 5)}-${String((i % 12) + 1).padStart(2, "0")}-15`,
      })),
    };
    const metas = summariseDataset(spread);
    const pipe: PipelineResult = {
      ...pipeFor("time-profile"),
      dataset: spread,
      metas,
      chosen: MODEL_BY_ID.get("time-profile") ?? null,
    };
    const r = buildR(pipe, NOW);
    expect(r).toContain("-Q");
    expect(r).toContain("ifelse(is.na(x), NA_character_,");
    expect(r).toContain('by = "3 months"');
  });

  test("every generated python parses; every script names its data file", () => {
    for (const m of MODELS) {
      const src = buildPython(pipeFor(m.id), NOW);
      expect(src).toContain("data.csv");
      if (!HAVE_PYTHON) continue;
      const dir = mkdtempSync(join(tmpdir(), "scelo-ast-"));
      writeFileSync(join(dir, "s.py"), src);
      const proc = Bun.spawnSync({
        cmd: ["python3", "-c", 'import ast; ast.parse(open("s.py").read()); print("ok")'],
        cwd: dir,
        stdout: "pipe",
        stderr: "pipe",
      });
      expect([m.id, proc.stdout.toString().trim()]).toEqual([m.id, "ok"]);
    }
  });
});

describe("notebook", () => {
  test("is valid nbformat-4.5 with the analysis and a plot cell", () => {
    const nb = JSON.parse(buildNotebook(pipeFor("concentration"), NOW));
    expect(nb.nbformat).toBe(4);
    expect(nb.nbformat_minor).toBe(5);
    const ids = nb.cells.map((c: { id: string }) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of nb.cells) {
      if (c.cell_type === "code") {
        expect(c.outputs).toEqual([]);
        expect(c.execution_count).toBeNull();
      }
      // nbformat: every source line but the last ends with \n
      const src = c.source as string[];
      for (let i = 0; i < src.length - 1; i++) expect(src[i].endsWith("\n")).toBe(true);
    }
    const all = nb.cells.flatMap((c: { source: string[] }) => c.source).join("");
    expect(all).toContain("read_csv");
    expect(all).toContain("gini");
    expect(all).toContain("Lorenz");
  });
});

describe(".sce project file", () => {
  test("is accepted by the IDE's own parser", async () => {
    // Not a copy of the IDE's rules — the IDE's actual module, imported from
    // the repo the TUI already tracks via file: dependency.
    const idePath = "../../../scelo/apps/web/src/components/Scelo/projectFile.ts";
    const ide = (await import(idePath)) as {
      parseSce: (text: string) => { session: { dataset: { name: string; rows: unknown[] } | null } };
    };
    const text = buildSce(pipeFor("group-metric"), NOW);
    const parsed = ide.parseSce(text);
    expect(parsed.session.dataset?.name).toBe("book.csv");
    expect(parsed.session.dataset?.rows).toHaveLength(40);
  });

  test("carries the honest catalog mapping and the activity log", () => {
    const sce = JSON.parse(buildSce(pipeFor("group-metric"), NOW));
    expect(sce.format).toBe("scelo-project");
    expect(sce.version).toBe(1);
    expect(sce.session.selectedModels).toEqual([
      {
        id: "descriptive",
        enabled: true,
        source: "ai",
        rationale: "premium and region make a natural segmentation",
      },
    ]);
    // Runs stay empty — a prose headline must not become a fake numeric KPI.
    expect(sce.session.runs).toEqual({});
    const kinds = sce.session.events.map((e: { kind: string }) => e.kind);
    expect(kinds).toEqual(["dataset.load", "cleaning.auto", "models.aiPick", "runs.execute"]);
  });

  test("filename matches the IDE's suggestion rules", () => {
    expect(sceFilename("My Book (2026).csv")).toBe("my-book-2026.sce");
    expect(sceFilename("weird///.csv")).toBe("weird.sce");
  });
});

describe("exportArtifacts", () => {
  test("one command writes the full set", () => {
    const dir = mkdtempSync(join(tmpdir(), "scelo-all-"));
    const { dir: outDir, files } = exportArtifacts(pipeFor("group-metric"), { cwd: dir, now: NOW });
    expect(files.map((f) => f.name).sort()).toEqual(
      ["analysis.R", "analysis.ipynb", "analysis.py", "book.sce", "book.xlsx", "data.csv"].sort(),
    );
    expect(new Set(readdirSync(outDir))).toEqual(new Set(files.map((f) => f.name)));
    for (const f of files) expect(f.bytes).toBeGreaterThan(0);
  });

  test("a script target always brings data.csv with it", () => {
    const dir = mkdtempSync(join(tmpdir(), "scelo-one-"));
    const { files } = exportArtifacts(pipeFor("group-metric"), {
      targets: ["r"],
      cwd: dir,
      now: NOW,
    });
    expect(files.map((f) => f.name).sort()).toEqual(["analysis.R", "data.csv"]);
  });

  test("format words people actually use resolve to targets", () => {
    expect(parseTarget("excel")).toBe("xlsx");
    expect(parseTarget("notebook")).toBe("ipynb");
    expect(parseTarget("RStudio")).toBe("r");
    expect(parseTarget("scelo")).toBe("sce");
    expect(parseTarget("pdf")).toBeNull();
    expect(ALL_TARGETS).toHaveLength(6);
  });

  test("a sentence around the format still names the format", () => {
    // The failure this replaces: every word was read as a format, so
    // "export the whole analysis in r code" died on `the`.
    const t = (s: string) => {
      const r = parseTargets(s.split(/\s+/));
      return r.ok ? r.targets : `error:${r.word}`;
    };
    expect(t("the whole analysis in r code")).toEqual(["r"]);
    expect(t("analysis in r code")).toEqual(["r"]);
    expect(t("my results as an excel file please")).toEqual(["xlsx"]);
    expect(t("excel, r")).toEqual(["xlsx", "r"]);
    // Naming no format at all means everything, same as a bare /export.
    expect(t("the whole analysis")).toEqual([]);
    // A word that IS trying to be a format and isn't one still reports.
    expect(t("as pdf")).toBe("error:pdf");
  });

  test("flat layout prefixes names and the scripts follow", () => {
    // Flat mode drops files into somebody's OPEN PROJECT — generic names
    // like data.csv are a collision waiting to happen there, and a script
    // reading a name we didn't write is a broken export.
    const dir = mkdtempSync(join(tmpdir(), "scelo-flat-"));
    const { dir: outDir, files, layout } = exportArtifacts(pipeFor("group-metric"), {
      layout: "flat",
      dir,
      now: NOW,
    });
    expect(layout).toBe("flat");
    expect(outDir).toBe(dir); // no subdirectory — this IS the project
    expect(files.map((f) => f.name).sort()).toEqual(
      [
        "book_data.csv",
        "book_analysis.py",
        "book_analysis.ipynb",
        "book_analysis.R",
        "book.xlsx",
        "book.sce",
      ].sort(),
    );
    const py = readFileSync(join(dir, "book_analysis.py"), "utf8");
    expect(py).toContain('pd.read_csv("book_data.csv")');
    expect(py).not.toContain('"data.csv"');
    const r = readFileSync(join(dir, "book_analysis.R"), "utf8");
    expect(r).toContain('read.csv("book_data.csv"');
    const nb = readFileSync(join(dir, "book_analysis.ipynb"), "utf8");
    expect(nb).toContain("book_data.csv");
  });
});

describe("the exported R runs the whole session", () => {
  test("every analysis the session ran becomes its own section", () => {
    const pipe = pipeFor("group-metric");
    const r = buildR(pipe, NOW, "data.csv", [
      { id: "missingness", label: "Missingness", rationale: "first look" },
      { id: "group-metric", label: "Value by segment", rationale: "switched by you" },
    ]);
    expect(r).toContain("analysis 1: Missingness");
    expect(r).toContain("analysis 2: Value by segment");
    expect(r).toContain("# why: first look");
    // …and the header's single-analysis lines are gone, since they would
    // name only the first of the two.
    expect(r).not.toContain("\n# analysis: ");
  });

  test("the profile stage is in the script, not just the chosen analysis", () => {
    const r = buildR(pipeFor("group-metric"), NOW, "data.csv");
    expect(r).toContain("str(df)");
    expect(r).toContain("print(summary(df))");
    expect(r).toContain("miss_all <- colSums(is.na(df))");
  });

  test("no analysis at all still yields a runnable profile script", () => {
    const bare = { ...pipeFor("group-metric"), chosen: null, result: null };
    const r = buildR(bare, NOW, "data.csv");
    expect(r).toContain("read.csv(\"data.csv\"");
    expect(r).toContain("str(df)");
  });

  test("base R only — an export that needs install.packages() is not runnable", () => {
    const r = buildR(pipeFor("group-metric"), NOW, "data.csv", [
      { id: "concentration", label: "Concentration", rationale: "" },
      { id: "correlation", label: "Correlation", rationale: "" },
      { id: "numeric-summary", label: "Descriptive summary", rationale: "" },
    ]);
    expect(r).not.toMatch(/library\(|require\(|install\.packages\(/);
    // Each section brought its own base-graphics picture.
    expect(r).toContain("Lorenz curve");
    expect(r).toContain("image(");
    expect(r).toContain("hist(");
  });

  test("every analysis in the menu exports a plot as well as a table", () => {
    // A section that prints numbers but draws nothing is half an export —
    // and the pane the user is reading from always has a picture.
    for (const m of MODELS) {
      const r = buildR(pipeFor(m.id), NOW, "data.csv");
      expect(r).toMatch(/barplot\(|hist\(|image\(|plot\(/);
    }
  });
});
