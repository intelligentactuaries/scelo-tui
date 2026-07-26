import { describe, expect, test } from "bun:test";
import { isMouseReport, parseReports } from "./mouse";

// A click in a terminal is a string on stdin, and it arrives on the same
// stream as typing. Everything here guards one of two failure modes: focus
// moving when it should not, or escape-sequence bytes ending up in the chat
// draft as literal text.

const press = (button: number, col: number, row: number) => `\x1b[<${button};${col};${row}M`;
const release = (button: number, col: number, row: number) => `\x1b[<${button};${col};${row}m`;

describe("parseReports", () => {
  test("reads a left-button press", () => {
    expect(parseReports(press(0, 74, 12))).toEqual([{ column: 74, row: 12 }]);
  });

  test("ignores the release half of a click", () => {
    // Otherwise every click fires focus twice — invisible here, but it makes
    // any future click-to-toggle behaviour flicker.
    expect(parseReports(release(0, 74, 12))).toEqual([]);
  });

  test("ignores middle and right buttons", () => {
    expect(parseReports(press(1, 10, 2))).toEqual([]);
    expect(parseReports(press(2, 10, 2))).toEqual([]);
  });

  test("ignores the scroll wheel", () => {
    // Wheel-up is button 64: its low two bits are 0, so a naive
    // `button === 0` test reads it as a left click and scrolling over a pane
    // silently steals focus.
    expect(parseReports(press(64, 30, 8))).toEqual([]);
    expect(parseReports(press(65, 30, 8))).toEqual([]);
  });

  test("reads several reports out of one chunk", () => {
    const chunk = press(0, 5, 1) + release(0, 5, 1) + press(0, 90, 20);
    expect(parseReports(chunk)).toEqual([
      { column: 5, row: 1 },
      { column: 90, row: 20 },
    ]);
  });

  test("handles the three-digit columns that SGR mode exists for", () => {
    // The legacy encoding capped at 223; a wide terminal is the whole reason
    // mode 1006 is enabled alongside 1000.
    expect(parseReports(press(0, 240, 40))).toEqual([{ column: 240, row: 40 }]);
  });

  test("finds a report embedded in other bytes", () => {
    expect(parseReports(`x${press(0, 3, 4)}y`)).toEqual([{ column: 3, row: 4 }]);
  });

  test("ignores anything that is not a report", () => {
    expect(parseReports("hello")).toEqual([]);
    expect(parseReports("\x1b[A")).toEqual([]); // up arrow
  });
});

describe("isMouseReport", () => {
  test("recognises a full report", () => {
    expect(isMouseReport(press(0, 74, 12))).toBe(true);
  });

  test("recognises one whose ESC Ink has stripped", () => {
    // Ink hands unrecognised escape sequences on with the ESC removed, so the
    // guard cannot require it.
    expect(isMouseReport("[<0;74;12M")).toBe(true);
  });

  test("does not swallow ordinary typing", () => {
    // `[<` in particular: a loose pattern matches it, and then anyone writing
    // a generic in the chat loses the keystroke with no indication why.
    for (const s of ["a", "<", "hello", "3;4", "[", "[<", "why < that?", "Array[<T>]"]) {
      expect(isMouseReport(s)).toBe(false);
    }
  });
});
