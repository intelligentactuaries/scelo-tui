// The HARD table's footer line — the one row in the panes that is a button.

import { describe, expect, test } from "bun:test";
import { tableFooterRow } from "../App";
import { tableFooter } from "./widgets";

describe("tableFooter wording", () => {
  test("the keystroke is named whether or not clicks are on", () => {
    // Clicks are off by default so that drag-select keeps working, which
    // makes a click-only affordance no affordance at all.
    expect(tableFooter(3, false, false)).toBe("… 3 more · ctrl-t expands");
    expect(tableFooter(3, false, true)).toBe("… 3 more · ctrl-t or click expands");
  });

  test("expanded, the way back is on the same line", () => {
    expect(tableFooter(0, true, false)).toBe("▴ ctrl-t collapses");
    expect(tableFooter(0, true, true)).toBe("▴ ctrl-t or click collapses");
  });

  test("expanded and STILL truncated says both", () => {
    // A pane 20 rows tall cannot hold a 40-row result even wide open.
    expect(tableFooter(12, true, false)).toBe("… 12 more · ▴ ctrl-t collapses");
  });
});

describe("tableFooterRow", () => {
  // The arithmetic itself is verified by clicking the row in a real
  // terminal; what a unit test can pin is that it MOVES the way the layout
  // does — one row per result row, one per row the HARD pane starts lower.
  test("each result row shown pushes the footer down by one", () => {
    expect(tableFooterRow(6, 20) - tableFooterRow(5, 20)).toBe(1);
  });

  test("it follows the HARD pane down the stack", () => {
    // The pane's top moves whenever focus does, since the focused pane takes
    // a share of the other two.
    expect(tableFooterRow(5, 26) - tableFooterRow(5, 20)).toBe(6);
  });

  test("the five-row default lands where the pane actually draws it", () => {
    // From the pane's first row: its border, title, the "table" head and its
    // blank, the headline, the blank above the table, its column header,
    // then five rows.
    expect(tableFooterRow(5, 20)).toBe(32);
  });
});
