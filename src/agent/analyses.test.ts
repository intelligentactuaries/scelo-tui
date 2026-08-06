import { describe, expect, test } from "bun:test";
import { type Dataset, summariseDataset } from "@scelo/core";
import {
  MODELS,
  MODEL_BY_ID,
  dateColumn,
  groupColumn,
  resolveChoice,
  valueColumn,
} from "./analyses";

// A small book with everything the pickers look for: a money column, two
// categoricals of different richness, a date column, gaps, and a numeric
// pair with a designed-in correlation.
function fixture(): Dataset {
  const rows = [];
  const regions = ["North", "South", "East", "West"];
  for (let i = 0; i < 40; i++) {
    const premium = 1000 + i * 100;
    rows.push({
      policy_id: `P${i}`,
      premium,
      // claims tracks premium exactly → the correlation screen must find it.
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

const ds = fixture();
const metas = summariseDataset(ds);
const run = (id: string) => {
  const m = MODEL_BY_ID.get(id);
  if (!m) throw new Error(`no such analysis: ${id}`);
  if (!m.applies(metas)) throw new Error(`${id} does not apply to the fixture`);
  return m.run(ds, metas);
};

describe("column heuristics", () => {
  test("valueColumn prefers money-named columns over larger totals", () => {
    // `age` totals less than premium anyway, but the name test must win even
    // when it wouldn't: a column called premium IS the value column.
    expect(valueColumn(metas)?.name).toBe("premium");
  });

  test("groupColumn takes the richest small split", () => {
    // region (4 levels) over sex (2): mean premium by region says more.
    expect(groupColumn(metas)?.name).toBe("region");
  });

  test("dateColumn finds the date-typed column", () => {
    expect(dateColumn(metas)?.name).toBe("start_date");
  });
});

describe("group-metric", () => {
  test("segments sum back to the whole book", () => {
    const r = run("group-metric");
    expect(r.columns).toEqual(["segment", "n", "mean", "total", "share"]);
    expect(r.rows).toHaveLength(4);
    const n = r.rows.reduce((s, row) => s + Number(row[1]), 0);
    expect(n).toBe(40);
    // Shares are percentages of the total — they must add to 100.
    const shares = r.rows.map((row) => Number.parseFloat(String(row[4])));
    expect(shares.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 0);
  });

  test("segments arrive largest first", () => {
    const r = run("group-metric");
    const totals = r.series?.values ?? [];
    expect([...totals].sort((a, b) => b - a)).toEqual(totals);
  });
});

describe("time-profile", () => {
  test("bins by month over a six-month span and keeps every record", () => {
    const r = run("time-profile");
    expect(r.headline).toContain("month");
    // 40 rows spread over months 01..06.
    expect(r.rows.map((row) => row[0])).toEqual([
      "2023-01",
      "2023-02",
      "2023-03",
      "2023-04",
      "2023-05",
      "2023-06",
    ]);
    expect(r.rows.reduce((s, row) => s + Number(row[1]), 0)).toBe(40);
  });

  test("carries the value column alongside counts", () => {
    const r = run("time-profile");
    expect(r.columns).toEqual(["period", "records", "premium total"]);
  });
});

describe("numeric-summary", () => {
  test("speaks the IDE's descriptive vocabulary, CV-ranked", () => {
    const r = run("numeric-summary");
    // The IDE result card's columns minus min/max (pane-width budget) —
    // same names, same order, same @scelo/core numbers underneath.
    expect(r.columns).toEqual(["column", "n", "miss %", "mean", "sd", "cv", "median"]);
    // The fixture's numerics: premium, claims, age. All fully populated.
    expect(r.rows.map((row) => row[0]).sort()).toEqual(["age", "claims", "premium"]);
    for (const row of r.rows) expect(row[2]).toBe("0%");
    // CV ordering is scale-free: premium (CV ≈ 0.40) leads age (≈ 0.32)
    // despite both being "spready"; claims = 0.4 × premium is proportional,
    // so it TIES premium's CV exactly and the sd tie-break keeps premium
    // (the larger-scale column) first: premium, claims, age.
    expect(r.rows.map((row) => row[0])).toEqual(["premium", "claims", "age"]);
    const cvs = r.rows.map((row) => Number.parseFloat(String(row[5])));
    expect(cvs[0]).toBeCloseTo(cvs[1], 5);
    for (let i = 1; i < cvs.length; i++) expect(cvs[i]).toBeLessThanOrEqual(cvs[i - 1]);
    // The histogram series follows the top-CV column, not column order.
    expect(r.series?.label).toBe("premium distribution");
  });
});

describe("correlation", () => {
  test("finds the designed-in premium↔claims relationship first", () => {
    const r = run("correlation");
    const [a, b, rv] = r.rows[0];
    expect([a, b].sort()).toEqual(["claims", "premium"]);
    expect(rv).toBe("+1.00");
  });
});

describe("concentration", () => {
  test("reports Gini and monotone top-shares", () => {
    const r = run("concentration");
    expect(r.headline).toContain("Gini");
    const shares = r.rows.map((row) => Number.parseFloat(String(row[1])));
    // top 1% ≤ top 5% ≤ top 10% ≤ top 20% — anything else is a math bug.
    for (let i = 1; i < shares.length; i++) {
      expect(shares[i]).toBeGreaterThanOrEqual(shares[i - 1]);
    }
  });
});

describe("outliers", () => {
  test("a clean linear column shows no outliers; a spiked one shows exactly one", () => {
    const spiked: Dataset = {
      ...ds,
      rows: [...ds.rows, { ...ds.rows[0], policy_id: "SPIKE", premium: 1_000_000 }],
    };
    const m = summariseDataset(spiked);
    const model = MODEL_BY_ID.get("outliers");
    if (!model) throw new Error("unreachable");
    const r = model.run(spiked, m);
    const premiumRow = r.rows.find((row) => row[0] === "premium");
    expect(premiumRow?.[1]).toBe(1);
  });
});

describe("menu integrity", () => {
  test("all eight analyses apply to the fixture", () => {
    // The fixture is built to trip every applies() — a menu entry that can't
    // fire on it either has a broken guard or an unreasonable one.
    const eligible = MODELS.filter((m) => m.applies(metas));
    expect(eligible.map((m) => m.id).sort()).toEqual(
      [
        "concentration",
        "correlation",
        "frequency",
        "group-metric",
        "missingness",
        "numeric-summary",
        "outliers",
        "time-profile",
      ].sort(),
    );
  });

  test("every analysis runs on the fixture without throwing", () => {
    for (const m of MODELS.filter((x) => x.applies(metas))) {
      const r = m.run(ds, metas);
      expect(r.headline.length).toBeGreaterThan(0);
      expect(r.columns.length).toBeGreaterThan(0);
      // Every row must be exactly as wide as the header.
      for (const row of r.rows) expect(row).toHaveLength(r.columns.length);
    }
  });

  test("ids are unique", () => {
    expect(new Set(MODELS.map((m) => m.id)).size).toBe(MODELS.length);
  });
});

describe("resolveChoice", () => {
  const eligible = MODELS.filter((m) => m.applies(metas));

  test("by menu number", () => {
    const r = resolveChoice("2", eligible);
    expect(r.ok && r.model.id).toBe(eligible[1].id);
  });

  test("by label fragment, case-insensitive", () => {
    const r = resolveChoice("gini", eligible);
    expect(r.ok && r.model.id).toBe("concentration");
  });

  test("ambiguity is reported, not guessed", () => {
    // "profile" hits both the frequency and time profiles.
    const r = resolveChoice("profile", eligible);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.matches.length).toBeGreaterThan(1);
  });

  test("no match returns an empty candidate list", () => {
    const r = resolveChoice("chain ladder", eligible);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.matches).toHaveLength(0);
  });
});
