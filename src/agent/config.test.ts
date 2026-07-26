// Config persistence, with the emphasis on the two things that are not
// merely inconvenient when they go wrong: a key file readable by other users
// on the machine, and a key reaching the screen intact.
//
// The module reads CONFIG_PATH once at import, so each case runs in its own
// subprocess with SCELO_TUI_CONFIG pointed at a temp file.

import { describe, expect, test } from "bun:test";
import { mkdtempSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { maskKey } from "./config";

function inTemp(script: string, env: Record<string, string> = {}) {
  const dir = mkdtempSync(join(tmpdir(), "scelo-cfg-"));
  const path = join(dir, "nested", "config.json");
  const proc = Bun.spawnSync({
    cmd: ["bun", "-e", script],
    env: { ...process.env, SCELO_TUI_CONFIG: path, ...env },
    cwd: import.meta.dir,
    stdout: "pipe",
    stderr: "pipe",
  });
  const out = proc.stdout.toString().trim();
  const err = proc.stderr.toString().trim();
  if (proc.exitCode !== 0) throw new Error(`subprocess failed: ${err || out}`);
  return { out, path, dir };
}

describe("save / load", () => {
  test("round-trips a selection through a directory that does not exist yet", () => {
    const { out } = inTemp(`
      const { loadConfig, saveConfig } = await import("./config.ts");
      saveConfig({ provider: "anthropic", model: "claude-opus-5", keys: {} });
      const c = loadConfig();
      console.log(JSON.stringify([c.provider, c.model]));
    `);
    expect(JSON.parse(out)).toEqual(["anthropic", "claude-opus-5"]);
  });

  test("the key file is not readable by anyone else", () => {
    const { path } = inTemp(`
      const { saveConfig } = await import("./config.ts");
      saveConfig({ provider: "anthropic", model: "claude-opus-5", keys: { anthropic: "sk-secret" } });
    `);
    // 0600 — owner read/write, nothing for group or other.
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  test("re-saving tightens a file that was already loose", () => {
    // writeFile's `mode` only applies when it creates the file, so a config
    // that predates this rule — or one someone chmodded — would silently keep
    // world-readable permissions without the explicit chmod.
    const dir = mkdtempSync(join(tmpdir(), "scelo-cfg-"));
    const path = join(dir, "config.json");
    writeFileSync(path, "{}", { mode: 0o644 });
    const proc = Bun.spawnSync({
      cmd: [
        "bun",
        "-e",
        `const { saveConfig } = await import("./config.ts");
         saveConfig({ provider: "ollama", model: "m", keys: { anthropic: "sk-secret" } });`,
      ],
      env: { ...process.env, SCELO_TUI_CONFIG: path },
      cwd: import.meta.dir,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(proc.exitCode).toBe(0);
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });
});

describe("degrading rather than throwing", () => {
  test("a corrupt config yields defaults instead of taking the app down", () => {
    const dir = mkdtempSync(join(tmpdir(), "scelo-cfg-"));
    const path = join(dir, "config.json");
    writeFileSync(path, "{ not json at all");
    const proc = Bun.spawnSync({
      cmd: [
        "bun",
        "-e",
        `const { loadConfig } = await import("./config.ts");
         console.log(loadConfig().provider);`,
      ],
      env: { ...process.env, SCELO_TUI_CONFIG: path },
      cwd: import.meta.dir,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(proc.exitCode).toBe(0);
    expect(proc.stdout.toString().trim()).toBe("ollama");
  });

  test("a missing config yields defaults", () => {
    const { out } = inTemp(`
      const { loadConfig } = await import("./config.ts");
      console.log(loadConfig().provider);
    `);
    expect(out).toBe("ollama");
  });

  test("an unknown provider in the file falls back rather than being trusted", () => {
    const dir = mkdtempSync(join(tmpdir(), "scelo-cfg-"));
    const path = join(dir, "config.json");
    writeFileSync(path, JSON.stringify({ provider: "skynet", model: "x", keys: { skynet: "k" } }));
    const proc = Bun.spawnSync({
      cmd: [
        "bun",
        "-e",
        `const { loadConfig } = await import("./config.ts");
         const c = loadConfig();
         console.log(JSON.stringify([c.provider, Object.keys(c.keys)]));`,
      ],
      env: { ...process.env, SCELO_TUI_CONFIG: path },
      stdout: "pipe",
      stderr: "pipe",
      cwd: import.meta.dir,
    });
    expect(JSON.parse(proc.stdout.toString().trim())).toEqual(["ollama", []]);
  });
});

describe("keyFor", () => {
  test("a stored key wins over the environment", () => {
    const { out } = inTemp(
      `const { keyFor } = await import("./config.ts");
       console.log(keyFor({ provider: "anthropic", model: "m", keys: { anthropic: "stored" } }, "anthropic", "ANTHROPIC_API_KEY"));`,
      { ANTHROPIC_API_KEY: "from-env" },
    );
    expect(out).toBe("stored");
  });

  test("falls back to the environment when nothing is stored", () => {
    const { out } = inTemp(
      `const { keyFor } = await import("./config.ts");
       console.log(keyFor({ provider: "anthropic", model: "m", keys: {} }, "anthropic", "ANTHROPIC_API_KEY"));`,
      { ANTHROPIC_API_KEY: "from-env" },
    );
    expect(out).toBe("from-env");
  });
});

describe("maskKey", () => {
  test("shows enough to tell two keys apart and not enough to use one", () => {
    const masked = maskKey("sk-ant-api03-ABCDEFGHIJKLMNOP");
    expect(masked).toContain("MNOP");
    expect(masked).not.toContain("ABCDEFGHIJKL");
    expect(masked.length).toBeLessThan("sk-ant-api03-ABCDEFGHIJKLMNOP".length);
  });

  test("a short string is hidden completely rather than mostly revealed", () => {
    expect(maskKey("abcd1234")).toBe("••••••••");
    expect(maskKey("abc")).not.toContain("abc");
  });
});
