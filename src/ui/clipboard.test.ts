// Clipboard writes. The part worth pinning is the honesty: a route that
// cannot confirm the copy must not be reported as one that did.

import { describe, expect, test } from "bun:test";
import { copyText, describeCopy, toTsv } from "./clipboard";

/** Captures the escape sequence instead of writing it to a real terminal. */
function captured(text: string): { result: ReturnType<typeof copyText>; wrote: string } {
  let wrote = "";
  const result = copyText(text, (s) => {
    wrote += s;
  });
  return { result, wrote };
}

const decode = (seq: string): string => {
  const m = seq.match(/^\x1b]52;c;(.*)\x07$/);
  return m ? Buffer.from(m[1], "base64").toString("utf8") : "";
};

describe("copyText", () => {
  test("nothing to copy is a refusal, not an empty success", () => {
    expect(copyText("")).toEqual({ ok: false, reason: "nothing to copy" });
  });

  test("the OSC 52 route carries the text verbatim", () => {
    // Only reached when no helper is installed, which is the case on a fresh
    // machine and over ssh — so it has to be right.
    const { result, wrote } = captured("region\ttotal\nnorth\t42");
    if (result.ok && result.via === "osc52") {
      expect(decode(wrote)).toBe("region\ttotal\nnorth\t42");
      // Fire-and-forget: there is no reply to read, so it must never claim
      // to know the clipboard changed.
      expect(result.confirmed).toBe(false);
    } else {
      // A helper was installed and won, which is the better route anyway.
      expect(result.ok && result.confirmed).toBe(true);
    }
  });

  test("non-ASCII survives the round trip", () => {
    const { result, wrote } = captured("région · 42 × ✻");
    if (result.ok && result.via === "osc52") expect(decode(wrote)).toBe("région · 42 × ✻");
    else expect(result.ok).toBe(true);
  });

  test("too much for an escape is refused, not silently truncated", () => {
    // A clipboard holding the first 60% of a table is the failure nobody
    // notices until they paste it.
    const huge = "x".repeat(200_000);
    const { result } = captured(huge);
    if (!result.ok) expect(result.reason).toContain("/export");
    else expect(result.via).not.toBe("osc52");
  });
});

describe("describeCopy", () => {
  test("a confirmed copy says so plainly", () => {
    const line = describeCopy({ ok: true, via: "xclip", confirmed: true, bytes: 12 }, "3 rows");
    expect(line).toBe("3 rows → clipboard (xclip)");
  });

  test("an unconfirmable one says what to do when nothing pastes", () => {
    const line = describeCopy({ ok: true, via: "osc52", confirmed: false, bytes: 12 }, "3 rows");
    expect(line).toContain("OSC 52");
    expect(line).toContain("xclip");
    expect(line).toContain("/export");
  });

  test("a failure names the reason rather than pretending", () => {
    expect(describeCopy({ ok: false, reason: "nothing to copy" }, "x")).toBe(
      "could not copy — nothing to copy",
    );
  });
});

describe("toTsv", () => {
  test("tabs between cells — what pastes into a spreadsheet as columns", () => {
    expect(toTsv(["a", "b"], [["1", 2]])).toBe("a\tb\n1\t2");
  });

  test("a cell containing a tab or newline cannot forge a new column", () => {
    // The correlation screen's labels and any string column are free text;
    // one stray tab would shift every cell after it into the wrong column.
    expect(toTsv(["a"], [["x\ty"]])).toBe("a\nx y");
    expect(toTsv(["a"], [["x\ny"]])).toBe("a\nx y");
  });

  test("an empty table is still a header row", () => {
    expect(toTsv(["a", "b"], [])).toBe("a\tb");
  });
});
