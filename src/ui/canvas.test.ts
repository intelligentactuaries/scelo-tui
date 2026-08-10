// The sub-cell surface. Every assertion here is about resolution: the whole
// point of the module is that a value lands on one of eight positions inside
// a cell rather than being rounded to the cell.

import { describe, expect, test } from "bun:test";
import { createCanvas, dot, hBar, renderCanvas, stroke, strokeV, vBar } from "./canvas";

const text = (canvas: ReturnType<typeof createCanvas>): string[] =>
  renderCanvas(canvas).map((line) => line.map((s) => s.text).join(""));

describe("braille canvas", () => {
  test("a cell holds eight independently addressable dots", () => {
    const c = createCanvas(1, 1);
    expect(c.w).toBe(2);
    expect(c.h).toBe(4);
    // All eight on is the full pattern; one on is a single dot.
    for (let x = 0; x < 2; x++) for (let y = 0; y < 4; y++) dot(c, x, y);
    expect(text(c)).toEqual(["⣿"]);
    const one = createCanvas(1, 1);
    dot(one, 0, 0);
    expect(text(one)).toEqual(["⠁"]);
  });

  test("an empty cell is a space, not blank braille", () => {
    // U+2800 is a real glyph, and fonts that box it turn an empty plot into
    // a grey slab.
    expect(text(createCanvas(3, 1))).toEqual(["   "]);
  });

  test("dots off the canvas are dropped, never clamped to the edge", () => {
    // Clamping smears a point that fell outside the axis onto the frame,
    // where it reads as data.
    const c = createCanvas(2, 1);
    dot(c, -1, 0);
    dot(c, 99, 0);
    dot(c, 0, -3);
    dot(c, 0, 99);
    expect(text(c)).toEqual(["  "]);
  });

  test("a stroke connects its ends — a plot of samples alone is a cloud", () => {
    const c = createCanvas(8, 2);
    stroke(c, 0, 7, 15, 0);
    const rows = text(c);
    // Every cell column carries ink somewhere down the line's descent.
    for (let i = 0; i < 8; i++) {
      expect([i, rows[0][i] !== " " || rows[1][i] !== " "]).toEqual([i, true]);
    }
  });

  test("a NaN coordinate cannot wedge the render", () => {
    const c = createCanvas(4, 1);
    stroke(c, 0, 0, Number.NaN, Number.NaN);
    strokeV(c, Number.NaN, 0, 3);
    expect(text(c)).toHaveLength(1);
  });

  test("adjacent cells of one colour coalesce into a single span", () => {
    // 100 spans per row is what a naive renderer hands Ink for a full-width
    // chart; the coalescing is what keeps it to a handful.
    const c = createCanvas(10, 1);
    for (let x = 0; x < 20; x++) dot(c, x, 0, "#059669");
    expect(renderCanvas(c)[0]).toEqual([{ text: "⠉".repeat(10), color: "#059669" }]);
  });

  test("where two series share a cell the later one owns it", () => {
    // Callers draw furniture first so that data wins the overlap.
    const c = createCanvas(1, 1);
    dot(c, 0, 0, "grey");
    dot(c, 1, 3, "green");
    expect(renderCanvas(c)[0][0].color).toBe("green");
  });
});

describe("solid block bars", () => {
  test("a bar's end is a partial block, so near-equal values differ", () => {
    // The failure this replaces: two segments 3% apart rounding to the same
    // number of whole blocks and drawing identically.
    expect(hBar(0.5, 8)).toBe("████");
    expect(hBar(0.53, 8)).toBe("████▎");
    expect(hBar(1, 8)).toBe("████████");
  });

  test("a value that exists never draws as nothing", () => {
    expect(hBar(0.0001, 8)).toBe("▏");
    expect(hBar(0, 8)).toBe("");
  });

  test("columns fill from the bottom and top out in eighths", () => {
    expect(vBar(1, 3)).toEqual(["█", "█", "█"]);
    expect(vBar(0.5, 2)).toEqual([" ", "█"]);
    // 10/16 of two cells is one full cell plus two eighths of the next.
    expect(vBar(0.625, 2)).toEqual(["▂", "█"]);
  });

  test("a zero-width track draws nothing rather than throwing", () => {
    expect(hBar(0.5, 0)).toBe("");
    expect(vBar(0.5, 0)).toEqual([]);
  });
});
