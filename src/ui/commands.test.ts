import { describe, expect, test } from "bun:test";
import { COMMANDS, COMMAND_NAMES, commandMenu, helpText } from "./commands";

describe("commandMenu", () => {
  test("a bare slash offers everything", () => {
    expect(commandMenu("/")?.map((c) => c.name)).toEqual(COMMAND_NAMES);
  });

  test("filters by prefix as you type", () => {
    expect(commandMenu("/ex")?.map((c) => c.name)).toEqual(["example", "export"]);
    expect(commandMenu("/exp")?.map((c) => c.name)).toEqual(["export"]);
  });

  test("is case-insensitive", () => {
    expect(commandMenu("/EX")?.map((c) => c.name)).toEqual(["example", "export"]);
  });

  test("closes once an argument is being typed", () => {
    // The command is settled at the space — keeping the menu open would
    // cover the line while the user types the thing the command needs.
    expect(commandMenu("/run ")).toBeNull();
    expect(commandMenu("/run gini")).toBeNull();
  });

  test("ordinary prose is not a command", () => {
    expect(commandMenu("what is this data")).toBeNull();
    expect(commandMenu("")).toBeNull();
    expect(commandMenu("a/b")).toBeNull();
  });

  test("no match shows no menu rather than an empty box", () => {
    expect(commandMenu("/zzz")).toBeNull();
  });
});

describe("registry", () => {
  test("names are unique and slash-free", () => {
    expect(new Set(COMMAND_NAMES).size).toBe(COMMAND_NAMES.length);
    for (const n of COMMAND_NAMES) expect(n.startsWith("/")).toBe(false);
  });

  test("commands needing an argument are not standalone", () => {
    // ⏎ on a non-standalone completes the line instead of submitting
    // something that could only come back as a usage error.
    for (const c of COMMANDS) {
      if (c.args?.startsWith("<")) expect([c.name, c.standalone]).toEqual([c.name, false]);
    }
  });

  test("every standalone command does something bare", () => {
    for (const c of COMMANDS.filter((x) => x.standalone)) {
      expect([c.name, c.args?.startsWith("<") ?? false]).toEqual([c.name, false]);
    }
  });
});

describe("helpText", () => {
  test("lists every command, so it cannot drift from the menu", () => {
    const help = helpText();
    for (const n of COMMAND_NAMES) expect(help).toContain(`/${n}`);
  });

  test("signatures are column-aligned", () => {
    const lines = helpText().split("\n").filter((l) => l.startsWith("/"));
    const hintCols = lines.map((l) => l.indexOf("  ", l.indexOf("/") + 1));
    expect(new Set(lines.map((l) => l.length - l.trimStart().length)).size).toBe(1);
    expect(hintCols.every((c) => c > 0)).toBe(true);
  });
});
