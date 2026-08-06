// The live mirror, verified the way the export engine is: by the consumers
// it targets. R parses every phase of the .R file (a partial session that
// does not parse would blow up mid-source in someone's RStudio console);
// Python loads every phase of the notebook JSON. Both are the point of the
// feature — "valid at every moment" is the contract, so it is the test.

import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Dataset, summariseDataset } from "@scelo/core";
import { openCommand } from "./handoff";
import { type LiveSnapshot, buildLiveIpynb, buildLiveR, createLiveMirror } from "./live";

const NOW = new Date("2026-08-06T12:00:00Z");

const HAVE_R = (() => {
  try {
    return Bun.spawnSync({ cmd: ["Rscript", "--version"] }).exitCode === 0;
  } catch {
    return false;
  }
})();

const HAVE_PYTHON = (() => {
  try {
    return Bun.spawnSync({ cmd: ["python3", "--version"] }).exitCode === 0;
  } catch {
    return false;
  }
})();

/** Syntax-check R source with R's own parser — no evaluation. */
function rParses(source: string): true | string {
  const dir = mkdtempSync(join(tmpdir(), "scelo-live-"));
  writeFileSync(join(dir, "s.R"), source);
  const proc = Bun.spawnSync({
    cmd: ["Rscript", "-e", 'invisible(parse(file="s.R")); cat("ok")'],
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });
  return proc.exitCode === 0 ? true : proc.stderr.toString();
}

/** Load the notebook with python's json — the same first gate Jupyter runs. */
function pyLoadsJson(source: string): true | string {
  const dir = mkdtempSync(join(tmpdir(), "scelo-live-"));
  writeFileSync(join(dir, "n.ipynb"), source);
  const proc = Bun.spawnSync({
    cmd: [
      "python3",
      "-c",
      'import json; nb=json.load(open("n.ipynb")); assert nb["nbformat"]==4; assert len(nb["cells"])>0; print("ok")',
    ],
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });
  return proc.exitCode === 0 ? true : proc.stderr.toString();
}

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
      region: regions[i % 4],
      start_date: `2023-${String((i % 6) + 1).padStart(2, "0")}-15`,
    });
  }
  return {
    name: "book.csv",
    columns: ["policy_id", "premium", "claims", "age", "region", "start_date"],
    rows,
  };
}

const ds = fixture();
const metas = summariseDataset(ds);

/** The three moments the mirror publishes: post-clean (no analysis yet,
 *  LLM still thinking), first analysis landed, a second /run added. */
function phases(): Array<[string, LiveSnapshot]> {
  const base = { dataset: ds, metas, clean: null, reading: "" };
  return [
    ["mid-pipeline, no analysis yet", { ...base, runs: [], inProgress: true }],
    [
      "first analysis landed",
      {
        ...base,
        reading: "one row per policy; premium and claims carry the weight",
        runs: [{ id: "numeric-summary", label: "Descriptive summary", rationale: "numeric columns present" }],
        inProgress: false,
      },
    ],
    [
      "second analysis added by /run",
      {
        ...base,
        runs: [
          { id: "numeric-summary", label: "Descriptive summary", rationale: "numeric columns present" },
          { id: "group-metric", label: "Value by segment", rationale: "switched by you in chat" },
        ],
        inProgress: false,
      },
    ],
  ];
}

describe("buildLiveR", () => {
  test.skipIf(!HAVE_R)("every phase parses in R itself", () => {
    for (const [label, snap] of phases()) {
      expect(rParses(buildLiveR(snap, NOW)), label).toBe(true);
    }
  });

  test("says in-progress vs complete, and grows section by section", () => {
    const [midRun, first, second] = phases().map(([, s]) => buildLiveR(s, NOW));
    expect(midRun).toContain("still in progress");
    expect(midRun).toContain("str(df)"); // profile stand-in before any analysis
    expect(first).toContain("session complete — 1 analysis section");
    expect(first).toContain("analysis 1: Descriptive summary");
    expect(second).toContain("analysis 2: Value by segment");
    // Sections accumulate — the first one must survive the second's arrival.
    expect(second).toContain("analysis 1: Descriptive summary");
  });
});

describe("buildLiveIpynb", () => {
  test.skipIf(!HAVE_PYTHON)("every phase loads as nbformat-4 JSON", () => {
    for (const [label, snap] of phases()) {
      expect(pyLoadsJson(buildLiveIpynb(snap, NOW)), label).toBe(true);
    }
  });

  test("cell ids are stable across rewrites of the same content", () => {
    const [, snap] = phases()[1];
    const a = JSON.parse(buildLiveIpynb(snap, NOW));
    const b = JSON.parse(buildLiveIpynb(snap, NOW));
    expect(a.cells.map((c: { id: string }) => c.id)).toEqual(b.cells.map((c: { id: string }) => c.id));
  });

  test("code cells carry the fields validators demand", () => {
    const nb = JSON.parse(buildLiveIpynb(phases()[2][1], NOW));
    for (const cell of nb.cells) {
      expect(typeof cell.id).toBe("string");
      if (cell.cell_type === "code") {
        expect(cell.execution_count).toBeNull();
        expect(cell.outputs).toEqual([]);
      }
    }
    const last = nb.cells[nb.cells.length - 1];
    expect(last.cell_type).toBe("markdown");
    expect(last.source.join("")).toContain("complete");
  });
});

describe("createLiveMirror", () => {
  test("writes atomically, rewrites scripts, writes the csv once per dataset", () => {
    const dir = mkdtempSync(join(tmpdir(), "scelo-live-"));
    const mirror = createLiveMirror({ stem: "book", layout: "flat", dir });
    const [p0, p1] = phases().map(([, s]) => s);

    const first = mirror.update(p0, NOW);
    expect(first.wrote.sort()).toEqual(["book_data.csv", "book_live.R", "book_live.ipynb"].sort());

    const second = mirror.update(p1, NOW);
    // Same dataset object → the csv is NOT rewritten; the scripts are.
    expect(second.wrote.sort()).toEqual(["book_live.R", "book_live.ipynb"].sort());

    // No half-written temp files left behind — atomicity's visible residue.
    expect(readdirSync(dir).filter((f) => f.endsWith(".tmp"))).toEqual([]);
    expect(readFileSync(join(dir, "book_live.R"), "utf8")).toContain("Descriptive summary");
    expect(existsSync(join(dir, "book_data.csv"))).toBe(true);
  });

  test("dir layout uses generic names inside <stem>.scelo-export/", () => {
    const cwd = mkdtempSync(join(tmpdir(), "scelo-live-"));
    const mirror = createLiveMirror({ stem: "book", layout: "dir", cwd });
    mirror.update(phases()[0][1], NOW);
    const f = mirror.files();
    expect(f.r).toBe("live.R");
    expect(f.ipynb).toBe("live.ipynb");
    expect(f.csv).toBe("data.csv");
    expect(existsSync(join(cwd, "book.scelo-export", "live.R"))).toBe(true);
  });
});

describe("openCommand routes notebooks to Jupyter", () => {
  const noEnv = {};
  test("prefers jupyter-lab, then jupyter-notebook, then bare jupyter", () => {
    const probeWith = (have: string[]) => (bin: string) => (have.includes(bin) ? `/usr/bin/${bin}` : null);
    expect(openCommand("x.ipynb", { kind: "plain" }, noEnv, probeWith(["jupyter-lab", "jupyter"]))).toEqual([
      "/usr/bin/jupyter-lab",
      ["x.ipynb"],
    ]);
    expect(openCommand("x.ipynb", { kind: "plain" }, noEnv, probeWith(["jupyter-notebook"]))).toEqual([
      "/usr/bin/jupyter-notebook",
      ["x.ipynb"],
    ]);
    expect(openCommand("x.ipynb", { kind: "plain" }, noEnv, probeWith(["jupyter"]))).toEqual([
      "/usr/bin/jupyter",
      ["notebook", "x.ipynb"],
    ]);
  });

  test("falls back to the system opener when no Jupyter exists", () => {
    const cmd = openCommand("x.ipynb", { kind: "plain" }, noEnv, () => null);
    expect(cmd?.[0]).not.toContain("jupyter");
  });

  test("VS Code still claims notebooks inside its own terminal", () => {
    const cmd = openCommand("x.ipynb", { kind: "vscode", bin: "/usr/bin/code" }, noEnv, () => "/usr/bin/jupyter-lab");
    expect(cmd).toEqual(["/usr/bin/code", ["-r", "x.ipynb"]]);
  });
});
