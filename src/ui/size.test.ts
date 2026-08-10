import { describe, expect, test } from "bun:test";
import { MIN_PANE_ROWS, chatLines, isPortrait, paneHeights, paneWidths } from "./size";

describe("paneHeights", () => {
  test("the three panes sum to EXACTLY the body height", () => {
    // Every height from the minimum layout up to a very tall window: no dead
    // strip at the bottom, no overflow past it.
    for (let bodyH = 30; bodyH <= 200; bodyH++) {
      for (const focus of [0, 1, 2]) {
        const h = paneHeights(bodyH, focus);
        expect(h[0] + h[1] + h[2], `bodyH=${bodyH} focus=${focus}`).toBe(bodyH);
      }
    }
  });

  test("the focused pane is the tallest — it is the one being read", () => {
    for (let bodyH = 30; bodyH <= 200; bodyH++) {
      for (const focus of [0, 1, 2]) {
        const h = paneHeights(bodyH, focus);
        for (const i of [0, 1, 2]) {
          if (i !== focus) {
            expect(h[focus] >= h[i], `bodyH=${bodyH} focus=${focus} vs ${i}`).toBe(true);
          }
        }
      }
    }
  });

  test("an unfocused pane never shrinks past its own furniture", () => {
    // Below this it cannot draw its border, a line of transcript and the
    // composer — and Ink clips the overflow silently.
    for (let bodyH = 30; bodyH <= 200; bodyH++) {
      const h = paneHeights(bodyH, 0);
      expect(Math.min(...h), `bodyH=${bodyH}`).toBeGreaterThanOrEqual(MIN_PANE_ROWS);
    }
  });

  test("focus moving does not change the total, only the split", () => {
    const a = paneHeights(49, 0);
    const b = paneHeights(49, 2);
    expect(a[0]).toBe(b[2]);
    expect(a[1]).toBe(b[1]);
  });

  test("a focus index outside 0..2 lands inside it rather than throwing", () => {
    expect(paneHeights(49, 7).reduce((x, y) => x + y)).toBe(49);
    expect(paneHeights(49, -3).reduce((x, y) => x + y)).toBe(49);
  });
});

describe("chatLines", () => {
  test("a tall pane caps out — the rows are worth more to its content", () => {
    // Four, not six: in a stack the two extra rows buy a fourth-oldest reply
    // where the pane still has a table to draw.
    expect(chatLines(40)).toBe(4);
    expect(chatLines(200)).toBe(4);
  });

  test("a stacked third gives what it has, never less than one line", () => {
    // minHeight does not shrink: ask for six in a 12-row pane and the pane
    // overflows its row, which Ink clips without saying so.
    expect(chatLines(14)).toBe(3);
    expect(chatLines(9)).toBe(1);
    expect(chatLines(0)).toBe(1);
  });
});

describe("isPortrait", () => {
  test("the shape as it LOOKS, not as it counts", () => {
    // A cell is about twice as tall as it is wide, so 87x51 is a portrait
    // window even though 87 > 51. Backwards, this puts the stacked layout on
    // landscape terminals — the one place it must never appear.
    expect(isPortrait(87, 51)).toBe(true);
    expect(isPortrait(175, 46)).toBe(false);
  });

  test("a wide short terminal is landscape however few rows it has", () => {
    expect(isPortrait(200, 24)).toBe(false);
    expect(isPortrait(140, 40)).toBe(false);
  });

  test("a narrow tall terminal is portrait however many columns it has", () => {
    expect(isPortrait(80, 60)).toBe(true);
    expect(isPortrait(100, 51)).toBe(true);
  });
});

describe("paneWidths", () => {
  test("the three panes sum to EXACTLY the terminal width", () => {
    // No dead strip on the right, no overflow — the borders reach the edge.
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
});
