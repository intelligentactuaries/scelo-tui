// The catalogue behind `/charts`: which plots this session has, and what
// the exported scripts draw for each of them.

import { describe, expect, test } from "bun:test";
import type { CellValue, Dataset, Row } from "@scelo/core";
import { summariseDataset } from "@scelo/core";
import { MODELS } from "../agent/analyses";
import { buildChart, chartMenu, lorenzFrom } from "./gallery";

function book(): { dataset: Dataset; metas: ReturnType<typeof summariseDataset> } {
  const regions = ["north", "south", "east", "west"];
  const rows: Row[] = Array.from({ length: 240 }, (_, i) => {
    const r: Record<string, CellValue> = {
      policy_id: `P${i}`,
      region: regions[i % regions.length],
      age: 20 + (i % 50),
      premium_zar: 100 + ((i * 37) % 900),
      inception_date: `2021-${String(1 + (i % 12)).padStart(2, "0")}-05`,
    };
    return r as Row;
  });
  const dataset: Dataset = {
    name: "book.csv",
    columns: ["policy_id", "region", "age", "premium_zar", "inception_date"],
    rows,
  } as Dataset;
  return { dataset, metas: summariseDataset(dataset) };
}

const pipeFor = (d: ReturnType<typeof book>) =>
  ({ dataset: d.dataset, metas: d.metas }) as never;

describe("chartMenu", () => {
  test("the analyses this session ran come first, in the order they ran", () => {
    const { metas } = book();
    const menu = chartMenu(metas, ["correlation", "frequency"]);
    expect(menu[0].analysisId).toBe("correlation");
    expect(menu[1].analysisId).toBe("frequency");
    expect(menu.slice(0, 2).every((e) => e.ran)).toBe(true);
    expect(menu.slice(2).some((e) => e.ran)).toBe(false);
  });

  test("analyses that merely APPLY are listed too, marked as not run", () => {
    // "What could this data show me" is the reason to open a gallery.
    const { metas } = book();
    const menu = chartMenu(metas, []);
    expect(menu.length).toBeGreaterThan(1);
    expect(menu.every((e) => !e.ran)).toBe(true);
  });

  test("nothing the data cannot support is offered", () => {
    const dataset = { name: "t.csv", columns: ["note"], rows: [{ note: "a" }] } as unknown as Dataset;
    const menu = chartMenu(summariseDataset(dataset), []);
    for (const e of menu) {
      const model = MODELS.find((m) => m.id === e.analysisId);
      expect([e.analysisId, model?.applies(summariseDataset(dataset))]).toEqual([
        e.analysisId,
        true,
      ]);
    }
  });

  test("the Lorenz curve is listed even though no pane ever draws it", () => {
    // It is the one picture only the exported script produces, which is
    // exactly the question `/charts` answers.
    const { metas } = book();
    const menu = chartMenu(metas, []);
    const lorenz = menu.find((e) => e.key === "concentration:lorenz");
    expect(lorenz?.subtitle).toBe("Lorenz curve");
  });
});

describe("buildChart", () => {
  test("a card carries the series AND the call the export draws it with", () => {
    const d = book();
    const entry = chartMenu(d.metas, []).find((e) => e.analysisId === "group-metric");
    const card = entry ? buildChart(entry, pipeFor(d)) : null;
    expect(card?.kind).toBe("bars");
    expect(card?.values.length).toBe(4);
    expect(card?.labels).toContain("north");
    expect(card?.draws.r).toContain("barplot(");
    expect(card?.draws.py).toContain("kind=\"bar\"");
  });

  test("a multi-line call comes back whole, not cut at its first comma", () => {
    // `barplot(top$total, names.arg = rownames(top), las = 2,` shown alone
    // reads as a bug in the export rather than a wrap in the display.
    const d = book();
    const entry = chartMenu(d.metas, []).find((e) => e.analysisId === "group-metric");
    const card = entry ? buildChart(entry, pipeFor(d)) : null;
    const call = card?.draws.r ?? "";
    expect(call.split("(").length).toBe(call.split(")").length);
  });

  test("the setup line before the drawing call is not mistaken for it", () => {
    // `op <- par(mfrow = ...)` is a layout call, not a picture.
    const d = book();
    const entry = chartMenu(d.metas, []).find((e) => e.analysisId === "numeric-summary");
    const card = entry ? buildChart(entry, pipeFor(d)) : null;
    expect(card?.draws.r).toContain("hist(");
    expect(card?.draws.r).not.toStartWith("op <-");
  });

  test("the Lorenz card is the curve, from the origin, ending at the whole", () => {
    const d = book();
    const entry = chartMenu(d.metas, []).find((e) => e.key === "concentration:lorenz");
    const card = entry ? buildChart(entry, pipeFor(d)) : null;
    expect(card?.kind).toBe("lorenz");
    expect(card?.values[0]).toBe(0);
    expect(card?.values[card.values.length - 1]).toBeCloseTo(1, 6);
  });
});

describe("lorenzFrom", () => {
  test("walks the shares backwards — they arrive largest first", () => {
    // Forwards would draw the curve above the diagonal, which is the
    // opposite claim about the same data.
    const curve = lorenzFrom([0.7, 0.2, 0.1]);
    expect(curve).toHaveLength(4);
    expect(curve[0]).toBe(0);
    expect(curve[1]).toBeCloseTo(0.1, 9);
    expect(curve[2]).toBeCloseTo(0.3, 9);
    expect(curve[3]).toBeCloseTo(1, 9);
    // Below the diagonal at every interior point — that is what "unequal"
    // looks like, and drawing it forwards would claim the opposite.
    expect(curve[1]).toBeLessThan(1 / 3);
  });

  test("perfect equality is the diagonal", () => {
    const curve = lorenzFrom([0.25, 0.25, 0.25, 0.25]);
    expect(curve).toEqual([0, 0.25, 0.5, 0.75, 1]);
  });

  test("no shares is no curve", () => {
    expect(lorenzFrom([])).toEqual([]);
  });
});
