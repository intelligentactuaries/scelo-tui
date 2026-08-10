import { describe, expect, test } from "bun:test";
import { binKey, binPoints, chooseBin, parseDateUTC, spanDays } from "./dates";

const p = (s: string) => {
  const x = parseDateUTC(s);
  if (!x) throw new Error(`unparseable: ${s}`);
  return x;
};

describe("parseDateUTC", () => {
  test("reads components without going through local time", () => {
    // The trap this guards: new Date("2024-03-01").getMonth() is FEBRUARY for
    // anyone west of UTC. First and last day of a month must stay put.
    expect(p("2024-03-01").m).toBe(3);
    expect(p("2024-03-31").m).toBe(3);
    expect(p("2024-12-31")).toEqual({ y: 2024, m: 12, d: 31 });
  });

  test("accepts slashes and a trailing time part", () => {
    expect(p("2024/05/15").m).toBe(5);
    expect(p("2024-05-15T09:30:00").d).toBe(15);
  });

  test("rejects impossible dates instead of normalising them", () => {
    expect(parseDateUTC("2024-02-31")).toBeNull(); // would roll into March
    expect(parseDateUTC("2023-02-29")).toBeNull(); // not a leap year
    expect(parseDateUTC("2024-13-01")).toBeNull();
    expect(parseDateUTC("junk")).toBeNull();
    expect(parseDateUTC(42)).toBeNull();
  });

  test("leap day parses in a leap year", () => {
    expect(p("2024-02-29").d).toBe(29);
  });
});

describe("chooseBin", () => {
  test("widens with the span", () => {
    expect(chooseBin(400)).toBe("month");
    expect(chooseBin(2000)).toBe("quarter");
    expect(chooseBin(8000)).toBe("year");
  });
});

describe("binKey", () => {
  test("keys each resolution", () => {
    expect(binKey(p("2024-05-15"), "month")).toBe("2024-05");
    expect(binKey(p("2024-05-15"), "quarter")).toBe("2024-Q2");
    expect(binKey(p("2024-05-15"), "year")).toBe("2024");
  });
});

describe("binPoints", () => {
  test("fills calendar gaps with explicit zeros", () => {
    // Jan and Apr only — Feb and Mar are the finding, so they must exist.
    const rows = binPoints([p("2024-01-10"), p("2024-01-20"), p("2024-04-05")], "month");
    expect(rows.map((r) => r.key)).toEqual(["2024-01", "2024-02", "2024-03", "2024-04"]);
    expect(rows.map((r) => r.count)).toEqual([2, 0, 0, 1]);
  });

  test("rolls over year boundaries in every resolution", () => {
    expect(binPoints([p("2023-11-05"), p("2024-02-01")], "month").map((r) => r.key)).toEqual([
      "2023-11",
      "2023-12",
      "2024-01",
      "2024-02",
    ]);
    expect(binPoints([p("2023-10-01"), p("2024-04-01")], "quarter").map((r) => r.key)).toEqual([
      "2023-Q4",
      "2024-Q1",
      "2024-Q2",
    ]);
  });

  test("weights accumulate a value column per bucket", () => {
    const rows = binPoints([p("2024-01-01"), p("2024-01-15"), p("2024-02-01")], "month", [
      100, 50, 25,
    ]);
    expect(rows.map((r) => r.sum)).toEqual([150, 25]);
    expect(rows.map((r) => r.count)).toEqual([2, 1]);
  });

  test("a non-finite weight contributes 0, not 1, to a value total", () => {
    // Once a weight column IS supplied the sum is money, not records. Adding
    // 1 for a null value quietly printed a record count in a column labelled
    // "<value> total" — and disagreed with the exported R, which sums with
    // na.rm = TRUE.
    const rows = binPoints([p("2024-01-01"), p("2024-01-02")], "month", [Number.NaN, 5]);
    expect(rows[0].sum).toBe(5);
    expect(rows[0].count).toBe(2);
  });

  test("with no weights at all, sum still tracks the count", () => {
    const rows = binPoints([p("2024-01-01"), p("2024-01-02")], "month");
    expect(rows[0].sum).toBe(2);
  });

  test("a bucket whose values are all missing totals 0, not its row count", () => {
    const rows = binPoints(
      [p("2024-01-01"), p("2024-01-02"), p("2024-02-01")],
      "month",
      [Number.NaN, Number.NaN, 40],
    );
    expect(rows.map((r) => r.sum)).toEqual([0, 40]);
    expect(rows.map((r) => r.count)).toEqual([2, 1]);
  });

  test("total count is preserved", () => {
    const pts = [p("2022-01-01"), p("2022-06-01"), p("2023-01-01"), p("2023-01-02")];
    const rows = binPoints(pts, "quarter");
    expect(rows.reduce((n, r) => n + r.count, 0)).toBe(pts.length);
  });

  test("empty input yields an empty series", () => {
    expect(binPoints([], "month")).toEqual([]);
  });
});

describe("spanDays", () => {
  test("is inclusive and leap-aware", () => {
    expect(spanDays(p("2024-01-01"), p("2024-01-01"))).toBe(1);
    expect(spanDays(p("2024-02-27"), p("2024-03-02"))).toBe(5); // crosses Feb 29
    expect(spanDays(p("2023-02-27"), p("2023-03-02"))).toBe(4);
  });
});
