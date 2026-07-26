import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExportOutcome } from "./index";
import { detectHost, hostLabel, openCommand, performHandoff, planFor } from "./handoff";

const noBin = () => null;
const allBins = (b: string) => `/usr/bin/${b}`;

describe("detectHost", () => {
  test("plain terminal when nothing is set", () => {
    expect(detectHost({}, noBin).kind).toBe("plain");
  });

  test("RStudio by its terminal marker", () => {
    expect(detectHost({ RSTUDIO: "1" }, noBin).kind).toBe("rstudio");
  });

  test("VS Code by TERM_PROGRAM, with the first available CLI", () => {
    const h = detectHost({ TERM_PROGRAM: "vscode" }, allBins);
    expect(h).toEqual({ kind: "vscode", bin: "/usr/bin/code" });
  });

  test("a fork's CLI is found when `code` is absent", () => {
    const h = detectHost({ TERM_PROGRAM: "vscode" }, (b) => (b === "cursor" ? "/usr/bin/cursor" : null));
    expect(h).toEqual({ kind: "vscode", bin: "/usr/bin/cursor" });
  });

  test("VS Code without any CLI still detects, with bin null", () => {
    expect(detectHost({ VSCODE_PID: "123" }, noBin)).toEqual({ kind: "vscode", bin: null });
  });

  test("Scelo IDE wins over everything — most specific first", () => {
    // An IDE terminal can inherit VS Code's variables (IDE launched from a
    // VS Code terminal); the reverse cannot happen.
    const h = detectHost(
      { SCELO_IDE: "1", SCELO_IDE_WORKSPACE: "/work", TERM_PROGRAM: "vscode", RSTUDIO: "1" },
      allBins,
    );
    expect(h).toEqual({ kind: "scelo-ide", workspace: "/work" });
  });

  test("an empty workspace marker means no workspace, not workspace ''", () => {
    const h = detectHost({ SCELO_IDE: "1", SCELO_IDE_WORKSPACE: "" }, noBin);
    expect(h).toEqual({ kind: "scelo-ide", workspace: null });
  });

  test("labels are human words", () => {
    expect(hostLabel({ kind: "rstudio" })).toBe("RStudio");
    expect(hostLabel({ kind: "plain" })).toBe("terminal");
  });
});

describe("planFor", () => {
  test("RStudio exports flat into the cwd — the open project", () => {
    expect(planFor({ kind: "rstudio" }, "/proj")).toEqual({ layout: "flat", dir: "/proj" });
  });

  test("Scelo IDE targets the open workspace when it exists", () => {
    const ws = mkdtempSync(join(tmpdir(), "scelo-ws-"));
    expect(planFor({ kind: "scelo-ide", workspace: ws }, "/elsewhere")).toEqual({
      layout: "flat",
      dir: ws,
    });
  });

  test("Scelo IDE falls back to cwd when the workspace path is stale", () => {
    expect(planFor({ kind: "scelo-ide", workspace: "/no/such/dir" }, "/here")).toEqual({
      layout: "flat",
      dir: "/here",
    });
  });

  test("VS Code and plain keep the tidy export directory", () => {
    expect(planFor({ kind: "vscode", bin: "/usr/bin/code" }, "/x")).toEqual({ layout: "dir" });
    expect(planFor({ kind: "plain" }, "/x")).toEqual({ layout: "dir" });
  });
});

function outcome(names: string[], dir = "/out"): ExportOutcome {
  return { dir, files: names.map((name) => ({ name, bytes: 1 })), layout: "dir", stem: "book" };
}

describe("performHandoff", () => {
  test("VS Code opens the code artifacts, not the data or the workbook", () => {
    const calls: Array<[string, string[]]> = [];
    const hand = performHandoff(
      { kind: "vscode", bin: "/usr/bin/code" },
      outcome(["data.csv", "analysis.py", "analysis.ipynb", "analysis.R", "book.xlsx", "book.sce"]),
      (bin, args) => {
        calls.push([bin, args]);
        return true;
      },
    );
    expect(calls).toHaveLength(1);
    const [bin, args] = calls[0];
    expect(bin).toBe("/usr/bin/code");
    expect(args[0]).toBe("-r"); // reuse the window the terminal lives in
    expect(args.slice(1)).toEqual([
      "/out/analysis.py",
      "/out/analysis.ipynb",
      "/out/analysis.R",
    ]);
    expect(hand.opened).toEqual(["analysis.py", "analysis.ipynb", "analysis.R"]);
  });

  test("VS Code with no CLI explains how to get one instead of failing mute", () => {
    const hand = performHandoff({ kind: "vscode", bin: null }, outcome(["analysis.py"]));
    expect(hand.opened).toEqual([]);
    expect(hand.hint).toContain("Install code command");
  });

  test("RStudio's hint is the exact source() line for the flat layout", () => {
    const hand = performHandoff(
      { kind: "rstudio" },
      outcome(["book_data.csv", "book_analysis.R", "book.sce"]),
      () => {
        throw new Error("rstudio handoff must not spawn anything");
      },
    );
    expect(hand.hint).toContain('source("book_analysis.R")');
  });

  test("Scelo IDE points at the .sce in the file browser", () => {
    const hand = performHandoff(
      { kind: "scelo-ide", workspace: "/w" },
      outcome(["book_data.csv", "book.sce"]),
      () => {
        throw new Error("scelo-ide handoff must not spawn anything");
      },
    );
    expect(hand.hint).toContain("book.sce");
  });

  test("plain terminal hands nothing off", () => {
    expect(performHandoff({ kind: "plain" }, outcome(["analysis.py"]))).toEqual({
      opened: [],
      hint: null,
    });
  });
});

describe("openCommand", () => {
  test("code artifacts reuse the VS Code window", () => {
    expect(openCommand("/out/analysis.ipynb", { kind: "vscode", bin: "/usr/bin/code" })).toEqual([
      "/usr/bin/code",
      ["-r", "/out/analysis.ipynb"],
    ]);
  });

  test("the workbook goes to the OS even inside VS Code", () => {
    // VS Code renders .xlsx as binary mush without an extension; Excel /
    // LibreOffice is what "open the spreadsheet normally" means.
    const cmd = openCommand("/out/book.xlsx", { kind: "vscode", bin: "/usr/bin/code" });
    expect(cmd?.[0]).not.toBe("/usr/bin/code");
  });

  test("a .sce prefers the packaged Scelo IDE binary when findable", () => {
    const cmd = openCommand("/out/book.sce", { kind: "plain" }, { SCELO_IDE_BIN: "/opt/scelo-ide" }, noBin);
    expect(cmd).toEqual(["/opt/scelo-ide", ["/out/book.sce"]]);
    const probed = openCommand("/out/book.sce", { kind: "plain" }, {}, (b) =>
      b === "scelo-ide" ? "/usr/bin/scelo-ide" : null,
    );
    expect(probed).toEqual(["/usr/bin/scelo-ide", ["/out/book.sce"]]);
  });

  test("a .sce with no IDE anywhere falls back to the OS opener", () => {
    const cmd = openCommand("/out/book.sce", { kind: "plain" }, {}, noBin);
    expect(cmd?.[1]).toContain("/out/book.sce");
  });
});
