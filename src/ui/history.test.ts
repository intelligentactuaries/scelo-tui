// What the model is allowed to remember.
//
// The bug this file exists for: `/example` printed a numbered sample menu,
// the transcript kept it as a bot turn, and the history builder replayed it
// as an `assistant` message. The model therefore believed it had personally
// just described six datasets — so when the user answered "2", it announced
// it had loaded the climate ensemble and printed a schema card for a file
// nothing had opened. Every assertion here is that failure, pinned.

import { describe, expect, test } from "bun:test";
import { type Turn, historyForTest as historyFor } from "./Chat";

const you = (text: string): Turn => ({ role: "you", text });
const model = (text: string): Turn => ({ role: "bot", text });
const app = (text: string): Turn => ({ role: "bot", text, local: true });

describe("historyFor", () => {
  test("app output never comes back as the model's own words", () => {
    const menu = "the IDE's bundled samples:\n1. Synthetic claims — P&C (79×10)\n2. Climate…";
    const h = historyFor([you("load example data"), app(menu), you("2")]);
    // The menu must not appear anywhere, in any role: as an assistant turn
    // it is a false memory, and as a user turn it is a false instruction.
    expect(h.some((m) => m.content.includes("Climate"))).toBe(false);
    expect(h).toEqual([
      { role: "user", content: "load example data" },
      { role: "user", content: "2" },
    ]);
  });

  test("real model turns are kept", () => {
    const h = historyFor([you("what is this data"), model("One row per policy."), you("and now?")]);
    expect(h).toEqual([
      { role: "user", content: "what is this data" },
      { role: "assistant", content: "One row per policy." },
      { role: "user", content: "and now?" },
    ]);
  });

  test("export results and command errors are app output too", () => {
    const h = historyFor([
      you("/export"),
      app("6 files → book.scelo-export/"),
      app("error: provider 429"),
      you("what happened"),
    ]);
    expect(h.every((m) => m.role === "user")).toBe(true);
    expect(h).toHaveLength(2);
  });

  test("the streaming placeholder is never sent", () => {
    const h = historyFor([you("hi"), model("")]);
    expect(h).toEqual([{ role: "user", content: "hi" }]);
  });

  test("dropping app turns may leave adjacent user turns — that is fine", () => {
    // Providers merge same-role neighbours. Synthesising filler assistant
    // text to "fix" the alternation would reintroduce exactly the invented
    // speech this filter removes.
    const h = historyFor([you("/list"), app("1. Descriptive summary"), you("2")]);
    expect(h.map((m) => m.role)).toEqual(["user", "user"]);
  });

  test("long turns are truncated, not dropped", () => {
    const h = historyFor([you("x".repeat(5000))]);
    expect(h[0].content.length).toBeLessThan(1500);
    expect(h[0].content.endsWith("…")).toBe(true);
  });

  test("only the last few turns are replayed", () => {
    const many: Turn[] = [];
    for (let i = 0; i < 30; i++) many.push(you(`q${i}`), model(`a${i}`));
    expect(historyFor(many).length).toBeLessThanOrEqual(8);
  });
});
