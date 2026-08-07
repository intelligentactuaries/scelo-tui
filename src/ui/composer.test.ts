// The composer is one line inside a bordered box. Two invariants, both of
// which the first version broke: what it draws must never be wider than the
// columns it has (or the box wraps and every pane's layout jumps), and the
// caret must always be on screen with the line still readable around it.

import { describe, expect, test } from "bun:test";
import { composerRoom, composerWindow } from "./Chat";

const drawn = (w: ReturnType<typeof composerWindow>) =>
  w.lead.length + w.before.length + 1 /* the caret cell */ + w.after.length + w.tail.length;

describe("composerWindow", () => {
  const line = "the quick brown fox jumps over the lazy dog and keeps on running past the end";

  test("never draws wider than the room it was given", () => {
    for (let room = 8; room <= 60; room++) {
      for (let len = 0; len <= line.length; len += 7) {
        const draft = line.slice(0, len);
        for (let cursor = 0; cursor <= len; cursor++) {
          const w = composerWindow(draft, cursor, room);
          expect(drawn(w)).toBeLessThanOrEqual(room);
        }
      }
    }
  });

  test("text after the caret stays visible once the line scrolls", () => {
    // The old window pinned the caret to the right edge, so everything to
    // its right was empty by construction — walking ← blanked the line.
    const room = 40;
    const w = composerWindow(line, 60, room);
    expect(w.after.length).toBeGreaterThan(0);
    expect(w.lead).toBe("…");
    const mid = composerWindow(line, 40, room);
    expect(mid.after.length).toBeGreaterThan(0);
  });

  test("the caret is always the character it sits on, or a bar past the end", () => {
    const room = 30;
    for (let cursor = 0; cursor <= line.length; cursor++) {
      const w = composerWindow(line, cursor, room);
      if (cursor < line.length) expect(w.at).toBe(line[cursor]);
      else expect(w.at).toBeNull();
    }
  });

  test("a short line is shown whole, with no ellipses", () => {
    const w = composerWindow("hello", 5, 40);
    expect(w.lead).toBe("");
    expect(w.tail).toBe("");
    expect(w.before).toBe("hello");
    expect(w.at).toBeNull();
  });

  test("at the end of a long line the tail is visible, not folded away", () => {
    const w = composerWindow(line, line.length, 40);
    expect(w.tail).toBe("");
    expect(w.lead).toBe("…");
    expect(`${w.before}`.endsWith("end")).toBe(true);
  });

  test("at the start of a long line the head is visible", () => {
    const w = composerWindow(line, 0, 40);
    expect(w.lead).toBe("");
    expect(w.tail).toBe("…");
    expect(w.at).toBe("t");
  });
});

describe("composerRoom", () => {
  test("budgets for the border, the padding AND the prompt", () => {
    // border 2 + paddingX 2 + "› " 2 = 6. Getting this wrong by the prompt's
    // two columns is what wrapped the box onto a second row.
    expect(composerRoom(44)).toBe(38);
    expect(composerRoom(50)).toBe(44);
  });

  test("never returns something unusable on a tiny pane", () => {
    expect(composerRoom(4)).toBe(8);
    expect(composerRoom(0)).toBe(8);
  });
});
