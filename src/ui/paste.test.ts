// The paste sanitiser: everything that is not printable text folds away,
// and line structure degrades to spaces rather than to fused words.

import { describe, expect, test } from "bun:test";
import { flattenPaste } from "./paste";

describe("flattenPaste", () => {
  test("plain text passes through untouched", () => {
    expect(flattenPaste("what does column three mean?")).toBe("what does column three mean?");
  });

  test("newlines and tabs become single spaces — `a\\nb` must not fuse", () => {
    expect(flattenPaste("first line\nsecond line")).toBe("first line second line");
    expect(flattenPaste("a\r\nb\rc\td")).toBe("a b c d");
    expect(flattenPaste("a\n\n\nb")).toBe("a b");
  });

  test("escape sequences inside a paste do not reach the draft", () => {
    expect(flattenPaste("safe \x1b[31mred\x1b[0m text")).toBe("safe red text");
    // A `~`-terminated key sequence (e.g. a stray Delete) and a lone ESC pair.
    expect(flattenPaste("a\x1b[3~b\x1bXc")).toBe("abc");
  });

  test("colon sub-parameters and OSC payloads do not leak as text", () => {
    // Truecolor/256-colour SGR is written with colons by modern terminals.
    expect(flattenPaste("\x1b[38:5:196mred text\x1b[0m")).toBe("red text");
    // OSC title set (BEL-terminated) and OSC-8 hyperlink (ST-terminated).
    expect(flattenPaste("\x1b]0;my title\x07hello")).toBe("hello");
    expect(flattenPaste("\x1b]8;;http://x\x1b\\link")).toBe("link");
  });

  test("bare control bytes vanish", () => {
    expect(flattenPaste("a\x00b\x07c")).toBe("abc");
  });
});
