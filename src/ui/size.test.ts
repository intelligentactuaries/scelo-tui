import { describe, expect, test } from "bun:test";
import { paneWidths } from "./size";

describe("paneWidths", () => {
  test("the three panes sum to EXACTLY the terminal width", () => {
    // Every width from the minimum layout up to an ultrawide: no dead strip,
    // no overflow — the borders reach the screen edge.
    for (let cols = 60; cols <= 400; cols++) {
      const { paneW, lastW } = paneWidths(cols);
      expect(paneW + paneW + lastW, `cols=${cols}`).toBe(cols);
    }
  });

  test("the remainder lands on the last pane, never more than 2 columns", () => {
    for (let cols = 60; cols <= 400; cols++) {
      const { paneW, lastW } = paneWidths(cols);
      expect(lastW - paneW, `cols=${cols}`).toBeGreaterThanOrEqual(0);
      expect(lastW - paneW, `cols=${cols}`).toBeLessThanOrEqual(2);
    }
  });

  test("panes never collapse below the readable floor", () => {
    const { paneW, lastW } = paneWidths(10);
    expect(paneW).toBeGreaterThanOrEqual(20);
    expect(lastW).toBeGreaterThanOrEqual(20);
  });
});
