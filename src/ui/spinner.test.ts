import { describe, expect, test } from "bun:test";
import { FRAMES, formatElapsed, frameAt } from "./spinner";

describe("frameAt", () => {
  test("cycles through every frame", () => {
    const seen = new Set<string>();
    for (let i = 0; i < FRAMES.length; i++) seen.add(frameAt(i));
    expect(seen.size).toBe(new Set(FRAMES).size);
  });

  test("wraps rather than running off the end", () => {
    expect(frameAt(FRAMES.length)).toBe(frameAt(0));
    expect(frameAt(FRAMES.length * 1000 + 3)).toBe(frameAt(3));
  });

  test("survives a negative tick", () => {
    // The tick only counts up today, but a modulo that returns undefined for
    // negatives would render the string "undefined" into the pane rather than
    // throwing, which is the kind of bug nobody looks for.
    expect(FRAMES).toContain(frameAt(-1) as (typeof FRAMES)[number]);
    expect(FRAMES).toContain(frameAt(-7) as (typeof FRAMES)[number]);
  });

  test("pulses — it grows and shrinks rather than repeating a direction", () => {
    // A palindrome cycle is the whole visual idea: without it the glyph snaps
    // from largest back to smallest once per revolution, which reads as a
    // stutter rather than a pulse.
    const half = FRAMES.length / 2;
    expect(FRAMES.slice(1, half)).toEqual(FRAMES.slice(half + 1).reverse());
  });
});

describe("frame vocabulary", () => {
  test("never uses the glyph that means 'not started'", () => {
    // The synchronous pipeline stages hold the thread and freeze the
    // animation wherever it lands. `·` is the stage list's pending mark, so
    // freezing on it would state the opposite of what is happening.
    expect(FRAMES).not.toContain("·" as (typeof FRAMES)[number]);
  });

  test("every frame is one column wide", () => {
    // A frame wider than the others shifts the label beside it on every tick.
    for (const f of FRAMES) expect([...f]).toHaveLength(1);
  });
});

describe("formatElapsed", () => {
  test("counts seconds under a minute", () => {
    expect(formatElapsed(0)).toBe("0s");
    expect(formatElapsed(8_400)).toBe("8s");
    expect(formatElapsed(59_900)).toBe("59s");
  });

  test("switches to minutes, with seconds padded so the width is stable", () => {
    // Unpadded, the label changes width every second and shoves whatever
    // follows it sideways.
    expect(formatElapsed(60_000)).toBe("1m 00s");
    expect(formatElapsed(64_000)).toBe("1m 04s");
    expect(formatElapsed(3_599_000)).toBe("59m 59s");
  });

  test("clamps a clock that went backwards", () => {
    expect(formatElapsed(-5_000)).toBe("0s");
  });
});
