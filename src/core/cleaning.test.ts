// The near-duplicate label recode — the one auto-clean op that REWRITES a
// categorical value rather than reformatting it.
//
// It runs unprompted and unreviewed (autoCleanDataset enables everything the
// analyser proposes, safe and unsafe alike), so a false positive is silent
// data corruption: rows change category, every downstream segment total is
// wrong, and nothing on screen says so. The asymmetry is the whole design —
// a missed typo leaves the data as the user supplied it, and that is the
// cheaper failure by a long way. Every "must not merge" case below is
// therefore worth more than every "must merge" one.

import { describe, expect, test } from "bun:test";
import type { CellValue, ColumnMeta, Dataset, Row } from "@scelo/core";
import { summariseDataset } from "@scelo/core";
import { autoCleanDataset, findNearDuplicateLabel } from "./cleaning";

/** Top-values in the shape the profiler hands over: counts descending, and
 *  deliberately never equal — a tie has no canonical side and is skipped. */
function tops(...pairs: Array<[string, number]>): Array<{ value: string; count: number }> {
  return pairs.map(([value, count]) => ({ value, count }));
}

const total = (t: Array<{ count: number }>) => t.reduce((n, x) => n + x.count, 0);

const found = (...pairs: Array<[string, number]>) => {
  const t = tops(...pairs);
  return findNearDuplicateLabel(t, total(t));
};

describe("labels that must never merge", () => {
  test("two provinces sharing a word are not each other's typo", () => {
    // The bug this file exists for. "Eastern Cape"/"Western Cape" is 2 edits
    // over 12 characters, which cleared the length-scaled budget — so the
    // auto-clean recoded ~240 rows into the wrong province, and the segment
    // analysis reported four regions for a five-region book.
    expect(found(["Western Cape", 475], ["Eastern Cape", 240])).toBeNull();
  });

  test("the same trap one token further along", () => {
    expect(found(["North West", 300], ["North East", 180])).toBeNull();
    expect(found(["Cape Town Metro", 300], ["Cape Town Rural", 180])).toBeNull();
  });

  test("compass words on their own stay apart", () => {
    // The case the original budget already handled, kept honest.
    expect(found(["WEST", 300], ["EAST", 180])).toBeNull();
    expect(found(["north", 300], ["south", 180])).toBeNull();
  });

  test("enumerated codes are categories, not spellings", () => {
    expect(found(["Sector B", 300], ["Sector D", 180])).toBeNull();
    expect(found(["Zone 1", 300], ["Zone 2", 180])).toBeNull();
    expect(found(["Class A1", 300], ["Class A2", 180])).toBeNull();
  });

  test("case-only pairs belong to lowercase-categoricals, not here", () => {
    expect(found(["Gauteng", 300], ["gauteng", 180])).toBeNull();
  });

  test("a rare spelling is not evidence — it is a rare spelling", () => {
    // Below the floor (max(4, 0.2%)) there is no reason to believe either
    // side is canonical.
    expect(found(["Separated", 5000], ["Seperated", 2])).toBeNull();
  });

  test("a tie has no canonical side", () => {
    expect(found(["Separated", 200], ["Seperated", 200])).toBeNull();
  });
});

describe("typos that must still merge", () => {
  test("the classic in-data misspelling", () => {
    expect(found(["Separated", 500], ["Seperated", 40])).toEqual({
      from: "Seperated",
      to: "Separated",
      count: 40,
    });
  });

  test("a typo inside one word of a multi-word label", () => {
    // The shared "Western" is context here too — but the differing token is
    // 4 characters and 1 edit apart, which is a typo by any reading.
    expect(found(["Western Cape", 500], ["Western Capr", 40])?.from).toBe("Western Capr");
  });

  test("a spacing variant is a spelling, not a category", () => {
    // Different token counts, so the whole label sets the budget: 11
    // characters, 1 edit.
    expect(found(["Western Cape", 500], ["WesternCape", 40])?.from).toBe("WesternCape");
  });

  test("two typos in a long word are still one word", () => {
    expect(found(["Johannesburg", 500], ["Johannesbrug", 40])?.from).toBe("Johannesbrug");
  });

  test("the rarer spelling recodes into the commoner one, never the reverse", () => {
    const pair = found(["Seperated", 40], ["Separated", 500]);
    expect(pair).toEqual({ from: "Seperated", to: "Separated", count: 40 });
  });

  test("the pair affecting the most cells wins the single slot", () => {
    const pair = found(
      ["Separated", 900],
      ["Divorced", 800],
      ["Seperated", 30],
      ["Divorcede", 120],
    );
    expect(pair?.from).toBe("Divorcede");
  });
});

describe("through the whole auto-clean", () => {
  function book(region: (i: number) => string): Dataset {
    const rows: Row[] = Array.from({ length: 500 }, (_, i) => {
      const r: Record<string, CellValue> = {
        policy_id: `P${i}`,
        region: region(i),
        premium_zar: 100 + ((i * 37) % 900),
      };
      return r as Row;
    });
    return { name: "book.csv", columns: ["policy_id", "region", "premium_zar"], rows } as Dataset;
  }

  const levels = (d: Dataset): Set<string> =>
    new Set(d.rows.map((r) => String(r.region)));

  const profile = (d: Dataset): ColumnMeta[] => summariseDataset(d);

  test("five real provinces come out as five", () => {
    const names = ["Western Cape", "Eastern Cape", "Gauteng", "Limpopo", "KwaZulu-Natal"];
    // Uneven so no pair ties, which would have masked the bug.
    const cleaned = autoCleanDataset(book((i) => names[i % 5 === 0 ? 0 : i % names.length]), profile);
    expect(levels(cleaned.dataset).size).toBe(5);
    expect(levels(cleaned.dataset).has("Eastern Cape")).toBe(true);
    expect(cleaned.passes.flatMap((p) => p.opLabels)).not.toContain(
      "recode near-duplicate label",
    );
  });

  test("a real typo among them still gets recoded", () => {
    const names = ["Western Cape", "Gauteng", "Limpopo", "KwaZulu-Natal"];
    const cleaned = autoCleanDataset(
      book((i) => (i % 11 === 0 ? "Gautemg" : names[i % names.length])),
      profile,
    );
    expect(levels(cleaned.dataset).has("Gautemg")).toBe(false);
    expect(levels(cleaned.dataset).has("Gauteng")).toBe(true);
  });
});
