// Charts as text. The spans carry colour, but every claim worth pinning is
// about the picture, so the helper flattens them and the assertions read the
// way the terminal does.

import { describe, expect, test } from "bun:test";
import { type ChartInput, drawChart, niceTicks } from "./charts";

const render = (input: ChartInput): string[] =>
  drawChart(input).map((line) => line.map((s) => s.text).join("").trimEnd());

const base = { width: 60, height: 12, color: "#059669" } as const;

describe("niceTicks", () => {
  test("steps a person would have chosen, not the range divided by n", () => {
    // 0, 23.7, 47.4 carries no more than 0, 25, 50 and is harder to read.
    expect(niceTicks(0, 94.8, 4)).toEqual([0, 25, 50, 75, 100]);
    expect(niceTicks(0, 1, 4)).toEqual([0, 0.25, 0.5, 0.75, 1]);
    expect(niceTicks(120, 299, 4)).toEqual([100, 150, 200, 250, 300]);
  });

  test("the returned ends enclose the data, so they can BE the domain", () => {
    const t = niceTicks(3, 97, 4);
    expect(t[0]).toBeLessThanOrEqual(3);
    expect(t[t.length - 1]).toBeGreaterThanOrEqual(97);
  });

  test("float noise never reaches a label", () => {
    // 0.1 + 0.1 + 0.1 is the reason this function accumulates by index.
    for (const v of niceTicks(0, 0.5, 5)) expect(String(v).length).toBeLessThan(6);
  });

  test("a flat series still gets a scale", () => {
    // Without one every bar is full height and the axis says nothing.
    const t = niceTicks(7, 7, 4);
    expect(t.length).toBeGreaterThan(1);
    expect(t[0]).toBeLessThan(7);
  });
});

describe("bars", () => {
  const bars: ChartInput = {
    ...base,
    kind: "bars",
    values: [0.86, 0.83, 0.38],
    labels: ["a × b", "c × d", "e × f"],
  };

  test("label, bar and value on one row, values right-aligned", () => {
    const out = render(bars);
    expect(out).toHaveLength(3);
    expect(out[0]).toStartWith("a × b");
    expect(out.every((l) => l.length <= base.width)).toBe(true);
    for (const l of out) expect(l).toMatch(/(0\.86|0\.83|0\.38)$/);
  });

  test("precision follows the series, so |r| keeps two decimals", () => {
    // The compact formatter alone rounds 0.86 and 0.83 both to "0.9", which
    // prints the same number beside two different bars.
    const out = render(bars);
    expect(out[0]).toContain("0.86");
    expect(out[1]).toContain("0.83");
  });

  test("bars too many for the budget say so rather than stopping silently", () => {
    const out = render({ ...bars, height: 3, values: [5, 4, 3, 2, 1], labels: undefined });
    expect(out).toHaveLength(3);
    expect(out[2]).toBe("… 3 more");
  });
});

describe("columns and histograms", () => {
  const values = [41.2, 18.7, 11.9, 8.3, 6.1, 4.7, 3.4, 2.6, 1.8, 1.3];

  test("every bar is the same width — unequal ones read as a fault", () => {
    const out = render({
      ...base,
      kind: "columns",
      values,
      labels: values.map((_, i) => `d${i + 1}`),
      unit: "%",
    });
    const baseline = out[out.length - 3];
    const widths = [...baseline.matchAll(/█+/g)].map((m) => m[0].length);
    expect(new Set(widths).size).toBe(1);
  });

  test("bars baseline at zero even when the data does not go near it", () => {
    // A column chart cropped to [min, max] multiplies every difference
    // between the bars.
    // No x labels here, so the last row is the rule and the one above it is
    // the plot's floor — which carries the bottom tick.
    const out = render({ ...base, kind: "columns", values: [98, 99, 100] });
    expect(out[out.length - 2]).toStartWith("  0 ┤");
  });

  test("a curve gets the data's own range instead, and fills the plot", () => {
    const out = render({ ...base, kind: "line", values: [120, 180, 299] });
    expect(out[out.length - 2]).toStartWith("100 ┤");
  });

  test("whole counts get whole tick labels", () => {
    // Precision comes from the STEP: stepping by 5 wants "45", not "45.0".
    const out = render({ ...base, kind: "line", values: [22, 31, 48] });
    expect(out.join("\n")).not.toContain(".0 ┤");
  });

  test("more bars than columns is a curve drawn badly, so it draws a curve", () => {
    const many = Array.from({ length: 200 }, (_, i) => Math.sin(i / 9) + 1);
    const out = render({ ...base, kind: "histogram", values: many });
    expect(out.join("")).toMatch(/[⠀-⣿]/);
  });
});

describe("axis furniture", () => {
  const out = render({
    ...base,
    kind: "line",
    values: [120, 138, 151, 166, 182, 203, 221, 240, 266, 299],
    labels: ["2019-01", "", "", "", "", "", "", "", "", "2019-10"],
  });

  test("ticks sit on the labelled rows and nowhere else", () => {
    for (const line of out.slice(0, -2)) {
      expect(/^\s*[\d.]+ ┤/.test(line) || /^\s*│/.test(line)).toBe(true);
    }
  });

  test("the last x label survives — it is the one a time series is read for", () => {
    // Plain left-to-right greed always drops it.
    const xs = out[out.length - 1];
    expect(xs).toContain("2019-01");
    expect(xs).toContain("2019-10");
  });

  test("nothing overflows the width it was given", () => {
    for (const line of out) expect(line.length).toBeLessThanOrEqual(base.width);
  });
});

describe("refusals", () => {
  test("a budget too small for a chart gets no chart, not a bad one", () => {
    expect(drawChart({ ...base, kind: "columns", values: [1, 2], height: 2 })).toEqual([]);
    expect(drawChart({ ...base, kind: "bars", values: [1, 2], width: 8 })).toEqual([]);
  });

  test("no finite values is no chart", () => {
    expect(drawChart({ ...base, kind: "line", values: [Number.NaN, Number.POSITIVE_INFINITY] })).toEqual([]);
  });
});
