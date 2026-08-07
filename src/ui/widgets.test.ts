// The HARD table's footer line — the one row in the panes that is a button.

import { describe, expect, test } from "bun:test";
import { tableFooterRow } from "../App";
import { tableFooter } from "./widgets";

describe("tableFooter wording", () => {
  test("collapsed and truncated, it counts what is hidden and offers the click", () => {
    expect(tableFooter(3, false, true)).toBe("… 3 more · click to expand");
  });

  test("with the mouse off it points at the fix instead of lying", () => {
    // `/mouse off` is a setting /help recommends for copying text out, and
    // an affordance that does nothing is worse than none.
    expect(tableFooter(3, false, false)).toBe("… 3 more · /mouse on to expand");
  });

  test("expanded, the way back is on the same line", () => {
    expect(tableFooter(0, true, true)).toBe("▴ click to collapse");
  });

  test("expanded and STILL truncated says both", () => {
    // A pane 20 rows tall cannot hold a 40-row result even wide open.
    expect(tableFooter(12, true, true)).toBe("… 12 more · ▴ click to collapse");
  });
});

describe("tableFooterRow", () => {
  // The arithmetic itself is verified by clicking the row in a real
  // terminal; what a unit test can pin is that it MOVES the way the layout
  // does — one row per result row, one for the error banner.
  test("each result row shown pushes the footer down by one", () => {
    expect(tableFooterRow(6, false) - tableFooterRow(5, false)).toBe(1);
  });

  test("the error banner pushes the whole pane down by one", () => {
    expect(tableFooterRow(5, true) - tableFooterRow(5, false)).toBe(1);
  });

  test("the five-row default lands where the panes actually draw it", () => {
    // Header, pane border, title, the "table" head and its blank, the
    // headline, the blank above the table, its column header, five rows.
    expect(tableFooterRow(5, false)).toBe(14);
  });
});
