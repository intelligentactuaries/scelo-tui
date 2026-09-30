import { describe, expect, test } from "bun:test";
import { SAMPLE_BY_KEY } from "@scelo/core";
import {
  MAX_TABLES,
  buildTable,
  extractTableSpec,
  isSuggestRequest,
  keepTable,
  parseRequest,
  suggestTables,
  tableAsResult,
  tableIdFor,
  tableProtocol,
} from "./tables";

const claims = SAMPLE_BY_KEY.get("claims")?.build() ?? null;
const lifelib = SAMPLE_BY_KEY.get("lifelib-mp")?.build() ?? null;

describe("which sentences are table requests", () => {
  test("asking for ideas is a suggest request; a definition question is not", () => {
    expect(isSuggestRequest("suggest tables")).toBe(true);
    expect(isSuggestRequest("which tables could I build?")).toBe(true);
    expect(isSuggestRequest("table ideas")).toBe(true);
    expect(isSuggestRequest("what is a life table?")).toBe(false);
    expect(isSuggestRequest("how does a commutation table work")).toBe(false);
    expect(isSuggestRequest("what tables fit this data?")).toBe(true);
  });

  test("ordinary chat never parses as a build", () => {
    for (const q of ["make a table of claims by state", "export the table", "give me a pivot table", "what is a life table?"]) {
      expect(parseRequest(q, claims)).toBeNull();
    }
  });
});

describe("suggestions read the data", () => {
  test("a claims file suggests a triangle, a policy file model points", () => {
    expect(suggestTables(claims).map((s) => s.kind)).toContain("runoff-triangle");
    expect(suggestTables(lifelib).map((s) => s.kind)).toContain("model-points");
  });

  test("every suggestion's prompt builds the table it describes", () => {
    for (const d of [claims, lifelib]) {
      for (const s of suggestTables(d)) {
        const spec = parseRequest(s.prompt, d);
        expect(spec?.kind).toBe(s.kind);
        if (spec) expect(buildTable(spec, d, "suggestion").dataset.rows.length).toBeGreaterThan(0);
      }
    }
  });
});

describe("building and keeping", () => {
  const spec = parseRequest("build a life table on the illustrative Gompertz-Makeham basis at 4 % from age 20 to 110", null);

  test("a parametric life table, with no data at all", () => {
    expect(spec?.kind).toBe("life-table");
    if (!spec) return;
    const t = buildTable(spec, null, "chat", 1);
    expect(t.dataset.columns).toEqual(["age", "qx", "px", "lx", "dx", "Lx", "Tx", "ex"]);
    expect(t.dataset.rows).toHaveLength(91);
    expect(t.sourceDataset).toBeNull();
    // Parametric: the id does not depend on what happens to be loaded.
    expect(buildTable(spec, claims, "chat").id).toBe(t.id);
  });

  test("ids follow the IDE's scheme — title ignored, keys order-free", () => {
    const a = tableIdFor({ kind: "discount-curve", flatRate: 0.05, maxTenor: 10 }, null);
    const b = tableIdFor({ maxTenor: 10, flatRate: 0.05, kind: "discount-curve", title: "x" }, null);
    expect(a).toBe(b);
    expect(a).toMatch(/^tbl-discount-curve-[0-9a-z]+$/);
  });

  test("a rebuild replaces; the shelf is capped from the oldest end", () => {
    if (!spec) return;
    const t = buildTable(spec, null, "chat", 1);
    expect(keepTable(keepTable([], t), { ...t, createdAt: 2 })).toHaveLength(1);
    let list = [t];
    for (let i = 0; i < MAX_TABLES + 3; i++) {
      list = keepTable(list, { ...t, id: `x${i}` });
    }
    expect(list).toHaveLength(MAX_TABLES);
    expect(list.at(-1)?.id).toBe(`x${MAX_TABLES + 2}`);
  });

  test("a table renders as a HARD result without repeating its basis", () => {
    if (!spec) return;
    const r = tableAsResult(buildTable(spec, null, "chat"));
    expect(r.columns[0]).toBe("age");
    expect(r.rows[0][0]).toBe(20);
    expect(r.headline.split("Gompertz").length).toBe(2);
  });

  test("compact drops the decimals of big values only; full precision otherwise", () => {
    if (!spec) return;
    const t = buildTable(spec, null, "chat");
    const full = tableAsResult(t);
    const compact = tableAsResult(t, { compact: true });
    const col = (n: string) => full.columns.indexOf(n);
    // Small probabilities survive — qx must never round to 0 on screen,
    // including in a column that reaches 1 at the last age.
    expect(compact.rows[0][col("qx")]).toBe(full.rows[0][col("qx")]);
    expect(compact.rows[0][col("qx")]).toBeGreaterThan(0);
    expect(Number.isInteger(compact.rows[0][col("Tx")])).toBe(true);
    expect(Number.isInteger(full.rows[0][col("Tx")])).toBe(false);
  });
});

describe("the model's ```table block", () => {
  test("parsed, validated, and taken out of the prose", () => {
    const r = extractTableSpec('Here you go.\n```table\n{"kind":"discount-curve","flatRate":0.05,"maxTenor":10}\n```\nBuilt on a flat rate.');
    expect(r && "spec" in r && r.spec.kind).toBe("discount-curve");
    expect(r?.rest).toBe("Here you go.\n\nBuilt on a flat rate.");
  });

  test("a ```json fence counts when it names a table kind — and only then", () => {
    const r = extractTableSpec('Sure:\n```json\n{"kind":"life-table","basis":{"kind":"gompertz-makeham"}}\n```');
    expect(r && "spec" in r && r.spec.kind).toBe("life-table");
    expect(extractTableSpec('Config:\n```json\n{"kind":"deployment","replicas":2}\n```')).toBeNull();
    expect(extractTableSpec("```\nnot json at all\n```")).toBeNull();
  });

  test("a malformed block is an error, not silence; no block is null", () => {
    const bad = extractTableSpec("```table\n{not json}\n```");
    expect(bad && "error" in bad).toBe(true);
    expect(extractTableSpec("no table here")).toBeNull();
  });

  test("the protocol names the data's columns and what was suggested", () => {
    const p = tableProtocol(claims, suggestTables(claims), []);
    expect(p).toContain("fenced block tagged `table`");
    expect(p).toContain("origin_year");
    expect(p).toContain("runoff-triangle");
  });
});
