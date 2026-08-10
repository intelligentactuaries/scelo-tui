// The diagrams are asserted as TEXT: a node/edge picture whose lines are
// wider than the pane wraps, and a wrapped box is not a box. Shape first,
// then the semantics the IDE canvas carries — hub vs leaf, live vs inactive,
// and which way the arrows point.

import { describe, expect, test } from "bun:test";
import { type DiagramNode, fanIn, fanOut, render } from "./diagram";

const ACCENT = "#c026d3";
const hub: DiagramNode = { label: "book.csv", detail: "400 rows × 7 cols", status: "live" };
const leaves: DiagramNode[] = [
  { label: "Missingness", status: "live" },
  { label: "Correlation", status: "idle" },
  { label: "Outliers", status: "idle" },
];

/** Every line must fit — this is the whole reason the layout exists. */
function widths(lines: string[]): number[] {
  return lines.map((l) => [...l].length);
}

describe("fanOut (TOOLS: dataset hub → candidate analyses)", () => {
  test("no line exceeds the pane, at any width the pane can be", () => {
    for (let w = 24; w <= 90; w++) {
      const out = render(fanOut(hub, leaves, { width: w, accent: ACCENT }));
      const over = widths(out).filter((n) => n > w);
      expect(over).toEqual([]);
    }
  });

  test("the hub is double-ruled and the leaves are not — the IDE's 2px hub", () => {
    const out = render(fanOut(hub, leaves, { width: 48, accent: ACCENT }));
    expect(out[0]).toMatch(/^╔═+╗$/);
    expect(out.some((l) => l.includes("┌─") && l.includes("┐"))) .toBe(true);
    expect(out.join("\n")).toContain("book.csv");
  });

  test("arrows point AT the leaves, one branch each, last one closing", () => {
    const out = render(fanOut(hub, leaves, { width: 48, accent: ACCENT })).join("\n");
    expect(out.match(/[├└][─┄]▶/g) ?? []).toHaveLength(3);
    expect(out).toContain("└");
  });

  test("a live branch is solid, an inactive one dashed", () => {
    const out = render(fanOut(hub, leaves, { width: 48, accent: ACCENT }));
    const live = out.find((l) => l.includes("Missingness")) ?? "";
    const idle = out.find((l) => l.includes("Correlation")) ?? "";
    expect(live).toContain("─▶");
    expect(live).toContain("●");
    expect(idle).toContain("┄▶");
    expect(idle).toContain("·");
  });

  test("the row budget truncates and SAYS it truncated", () => {
    const many = Array.from({ length: 9 }, (_, i) => ({
      label: `analysis ${i}`,
      status: "idle" as const,
    }));
    const out = render(fanOut(hub, many, { width: 48, accent: ACCENT, maxLeaves: 3 }));
    expect(out.join("\n")).toContain("+6 more");
    // 4 hub lines + 1 spine + 3 leaves × 3 + 1 truncation note
    expect(out).toHaveLength(15);
  });

  test("too narrow to draw a box draws nothing rather than a mess", () => {
    expect(fanOut(hub, leaves, { width: 12, accent: ACCENT })).toEqual([]);
  });

  test("a hub with no leaves is still a hub", () => {
    const out = render(fanOut(hub, [], { width: 48, accent: ACCENT }));
    expect(out).toHaveLength(4);
    expect(out[0]).toMatch(/^╔/);
  });
});

describe("fanIn (HARD: results → output hub)", () => {
  const runs: DiagramNode[] = [
    { label: "Missingness", status: "live" },
    { label: "Correlation", status: "live" },
  ];
  const out = { label: "output", detail: "2 runs", status: "live" as const };

  test("no line exceeds the pane, at any width the pane can be", () => {
    for (let w = 24; w <= 90; w++) {
      const lines = render(fanIn(runs, out, { width: w, accent: ACCENT }));
      expect(widths(lines).filter((n) => n > w)).toEqual([]);
    }
  });

  test("the spine gathers every result and turns down into the hub", () => {
    const lines = render(fanIn(runs, out, { width: 48, accent: ACCENT }));
    const text = lines.join("\n");
    // First result opens the spine, later ones join it.
    expect(text).toContain("─┐");
    expect(text).toContain("─┤");
    // …and it turns left and drops.
    expect(text).toMatch(/┌─+┘/);
    expect(text).toContain("▼");
    // The hub is last and double-ruled.
    expect(lines[lines.length - 1]).toMatch(/^\s+╚═+╝$/);
  });

  test("the spine is unbroken between boxes", () => {
    const lines = render(fanIn(runs, out, { width: 48, accent: ACCENT }));
    // Every line from the first join to the turn carries the spine column.
    // (The join is on the LABEL line — a box's own top-right corner is also
    // a `─┐`, which is not where the spine starts.)
    const start = lines.findIndex((l) => l.includes("│─┐"));
    const turn = lines.findIndex((l) => /┌─+┘/.test(l));
    for (let i = start + 1; i < turn; i++) {
      expect(lines[i].endsWith("│") || lines[i].endsWith("┤")).toBe(true);
    }
  });

  test("status glyphs distinguish done, running and failed", () => {
    const mixed = render(
      fanIn(
        [
          { label: "done one", status: "live" },
          { label: "in flight", status: "running" },
          { label: "broke", status: "failed" },
        ],
        out,
        { width: 48, accent: ACCENT },
      ),
    ).join("\n");
    expect(mixed).toContain("● done one");
    expect(mixed).toContain("◐ in flight");
    expect(mixed).toContain("✕ broke");
  });
});
