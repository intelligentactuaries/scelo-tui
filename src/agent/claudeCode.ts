// Claude Code — the machine's signed-in `claude` CLI, used as a provider.
//
// No API key: the CLI carries the user's own Claude login (a Pro/Max
// subscription or whatever `claude` was signed in with), and this adapter
// shells out to it headless. The Scelo IDE and the swarm grew the same
// provider in 0.2; this is the same contract, kept in step with theirs
// (apps/scelo-ide/src/main.ts `chatClaudeCode`, apps/swarm's claudeCode.ts):
//
//   - `--strict-mcp-config`, always. Without it the CLI starts every MCP
//     server the user has configured and folds their tool schemas into the
//     prompt — measured in the IDE at 5,222 input tokens for a six-word
//     question against 167 with the flag.
//   - `--tools ""` and `--no-session-persistence`, when `--help` lists them.
//     The first makes "do not use tools" a fact instead of a request (a
//     headless -p call could otherwise read or write files); the second
//     stops every reply leaving a resumable session under ~/.claude. An
//     unknown flag is a hard exit, hence the probe.
//   - a neutral cwd under the temp dir. The CLI treats its cwd as "the
//     project" and reads that directory's CLAUDE.md, settings and hooks into
//     every call — and the TUI's cwd is the user's data folder.
//   - never `--bare`: it switches OAuth off, and reusing the login is the
//     whole point.
//
// Where the TUI differs from the IDE: it STREAMS. The IDE waits for one JSON
// blob; a pane here that sits silent for twenty seconds reads as a hang, so
// this asks for `stream-json` with partial messages and yields the text
// deltas as they land. Thinking deltas are skipped, like the SDK path.

import { type ChildProcess, execFile, execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { provider } from "./providers";
import type { Adapter, LlmMessage } from "./types";

export const CLAUDE_CODE_MISSING =
  "Claude Code CLI not found — install it from https://claude.com/claude-code and sign in once (run `claude`). No API key needed: scelo reuses your Claude Code login.";

export const CLAUDE_CODE_SIGNED_OUT =
  "Claude Code is installed but not signed in — run `claude` once in a terminal and log in, then press r.";

/** Appended to every system prompt. Plain text because every pane renders
 *  prose, and the tool clause backs up `--tools ""` on CLIs too old for it. */
export const CHAT_SUFFIX =
  "Answer directly and concisely in plain text. Do not use tools, do not read or write files, do not run commands — this is a chat reply.";

const TIMEOUT_MS = 180_000;

// ── finding the binary ─────────────────────────────────────────────────────

/** Where installers put `claude` when this process's PATH does not have it
 *  — the same list the IDE and the swarm probe. */
function wellKnownPaths(): string[] {
  const home = homedir();
  return [
    join(home, ".local", "bin", "claude"), // native installer
    join(home, ".claude", "local", "claude"), // older "local" install
    "/usr/local/bin/claude",
    "/opt/homebrew/bin/claude",
    join(home, ".bun", "bin", "claude"),
    join(home, ".npm-global", "bin", "claude"),
  ];
}

let bin: string | null | undefined; // undefined = not looked yet, null = absent

export function claudeBin(): string | null {
  if (bin !== undefined) return bin;
  const override = process.env.SCELO_CLAUDE_BIN;
  if (override && override.trim() !== "") {
    bin = override.trim();
    return bin;
  }
  let found: string | null = null;
  try {
    const out = execFileSync("which", ["claude"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    found = out.split(/\r?\n/).map((l) => l.trim()).find(Boolean) ?? null;
  } catch {
    found = null;
  }
  bin = found ?? wellKnownPaths().find((p) => existsSync(p)) ?? null;
  return bin;
}

/** For tests, and for `r` in the picker after installing the CLI. */
export function resetClaudeCode(): void {
  bin = undefined;
  caps = undefined;
}

let workDir: string | null = null;
function neutralCwd(): string {
  if (!workDir) {
    workDir = join(tmpdir(), "scelo-claude-code");
    mkdirSync(workDir, { recursive: true });
  }
  return workDir;
}

export type ClaudeCaps = { tools: boolean; noSessionPersistence: boolean; partial: boolean };
let caps: ClaudeCaps | undefined;

/** Which optional flags this CLI accepts, read from its help text. */
export function capsFromHelp(help: string): ClaudeCaps {
  return {
    tools: /(^|\s)--tools\b/m.test(help),
    noSessionPersistence: /(^|\s)--no-session-persistence\b/m.test(help),
    partial: /(^|\s)--include-partial-messages\b/m.test(help),
  };
}

function claudeCaps(path: string): ClaudeCaps {
  if (caps) return caps;
  let help = "";
  try {
    help = execFileSync(path, ["--help"], {
      encoding: "utf8",
      timeout: 15_000,
      cwd: neutralCwd(),
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch (e) {
    // Some CLIs print help and exit non-zero; keep what came out.
    const out = (e as { stdout?: unknown }).stdout;
    help = typeof out === "string" ? out : "";
  }
  caps = capsFromHelp(help);
  return caps;
}

// ── the request ────────────────────────────────────────────────────────────

/** `claude -p` is one-shot, so a thread is folded into a labelled transcript.
 *  A lone user turn passes verbatim. */
export function promptFrom(messages: LlmMessage[]): { system: string; prompt: string } {
  const sys = messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n\n")
    .trim();
  const turns = messages.filter((m) => m.role !== "system");
  const prompt =
    turns.length === 1 && turns[0].role === "user"
      ? turns[0].content
      : turns.map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`).join("\n\n");
  return { system: sys ? `${sys}\n\n${CHAT_SUFFIX}` : CHAT_SUFFIX, prompt };
}

/** The model the CLI should use, or null for "whatever `claude` defaults to"
 *  — the picker's `default` row, and the IDE's blank model field. */
export function modelFlag(model: string): string | null {
  const m = model.trim();
  return m === "" || m === "default" ? null : m;
}

export function buildArgs(system: string, model: string, c: ClaudeCaps, streaming: boolean): string[] {
  const args = ["-p", "--strict-mcp-config", "--system-prompt", system];
  if (streaming && c.partial) {
    // --verbose is required by the CLI for stream-json under -p.
    args.push("--output-format", "stream-json", "--verbose", "--include-partial-messages");
  } else {
    args.push("--output-format", "json");
  }
  if (c.noSessionPersistence) args.push("--no-session-persistence");
  if (c.tools) args.push("--tools", "");
  const m = modelFlag(model);
  if (m) args.push("--model", m);
  return args;
}

/** One stream-json line → what it means for the pane. */
export type StreamItem =
  | { kind: "text"; text: string }
  | { kind: "result"; text: string; error: string | null }
  | { kind: "other" };

export function parseStreamLine(line: string): StreamItem {
  let ev: Record<string, unknown>;
  try {
    ev = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return { kind: "other" };
  }
  if (ev.type === "stream_event") {
    const e = ev.event as { type?: string; delta?: { type?: string; text?: string } } | undefined;
    if (e?.type === "content_block_delta" && e.delta?.type === "text_delta" && e.delta.text) {
      return { kind: "text", text: e.delta.text };
    }
    return { kind: "other" };
  }
  if (ev.type === "result") return resultOf(ev);
  return { kind: "other" };
}

function resultOf(ev: Record<string, unknown>): StreamItem & { kind: "result" } {
  const text = typeof ev.result === "string" ? ev.result : "";
  if (ev.is_error === true) {
    return { kind: "result", text: "", error: friendlyError(`${ev.subtype ?? "error"} — ${text}`) };
  }
  return { kind: "result", text: text.trim(), error: null };
}

/** The swarm's mapping: a signed-out CLI says so in half a dozen ways, and
 *  all of them mean the same thing to the person at the keyboard. */
export function friendlyError(raw: string): string {
  if (/not logged in|please run \/login|invalid api key|authentication_error|OAuth token/i.test(raw)) {
    return CLAUDE_CODE_SIGNED_OUT;
  }
  return `claude code: ${raw.trim().slice(0, 300) || "no output"}`;
}

type Run = { child: ChildProcess; lines: AsyncGenerator<string>; exit: Promise<{ code: number | null; stderr: string }> };

function launch(args: string[], prompt: string, signal?: AbortSignal): Run {
  const path = claudeBin();
  if (!path) throw new Error(CLAUDE_CODE_MISSING);
  const child = spawn(path, args, { cwd: neutralCwd(), env: process.env, stdio: ["pipe", "pipe", "pipe"] });
  let stderr = "";
  child.stderr?.on("data", (d) => {
    stderr += String(d);
  });
  const kill = () => {
    try {
      child.kill();
    } catch {
      // already gone
    }
  };
  const timer = setTimeout(kill, TIMEOUT_MS);
  signal?.addEventListener("abort", kill, { once: true });
  const exit = new Promise<{ code: number | null; stderr: string }>((resolve, reject) => {
    child.on("error", (e) => {
      clearTimeout(timer);
      const code = (e as NodeJS.ErrnoException).code;
      reject(new Error(code === "ENOENT" ? CLAUDE_CODE_MISSING : `claude code: ${e.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stderr });
    });
  });
  // An exit before stdin is read (a bad flag, a signed-out CLI) must not
  // surface as an EPIPE crash — the exit code tells the real story.
  child.stdin?.on("error", () => {});
  child.stdin?.end(prompt);

  async function* lines(): AsyncGenerator<string> {
    let buf = "";
    for await (const chunk of child.stdout as AsyncIterable<Buffer | string>) {
      buf += String(chunk);
      let nl = buf.indexOf("\n");
      while (nl >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (line) yield line;
        nl = buf.indexOf("\n");
      }
    }
    if (buf.trim()) yield buf.trim();
  }
  return { child, lines: lines(), exit };
}

/** execFile as a promise that never rejects — a probe wants the answer,
 *  and "it failed" is one. */
function run(path: string, args: string[]): Promise<{ ok: boolean; stdout: string }> {
  return new Promise((resolve) => {
    execFile(path, args, { timeout: 10_000, cwd: neutralCwd(), encoding: "utf8" }, (err, stdout) => {
      resolve({ ok: !err, stdout: typeof stdout === "string" ? stdout : "" });
    });
  });
}

function exitError(code: number | null, stderr: string, stdout: string): Error {
  if (code === null) return new Error("claude code: stopped (timed out after 180s, or cancelled)");
  return new Error(friendlyError(`exited ${code}: ${stderr || stdout}`));
}

export const claudeCode: Adapter = {
  async available() {
    const path = claudeBin();
    if (!path) return false;
    // `claude auth status` is local and answers in ~0.1s with JSON — a real
    // "is this CLI signed in" without spending a model call on every picker
    // open. Async, so the picker's spinners keep turning while it answers.
    // A CLI too old to have the subcommand gets the benefit of the doubt:
    // the first reply will say what is wrong, if anything is.
    const status = await run(path, ["auth", "status"]);
    if (/"loggedIn"\s*:\s*false/.test(status.stdout)) return false;
    if (/"loggedIn"\s*:\s*true/.test(status.stdout)) return true;
    return (await run(path, ["--version"])).ok;
  },

  async models() {
    return (provider("claude-code").models ?? []).map((m) => m.id);
  },

  async complete(model, messages, opts) {
    const path = claudeBin();
    if (!path) throw new Error(CLAUDE_CODE_MISSING);
    const { system, prompt } = promptFrom(messages);
    const run = launch(buildArgs(system, model, claudeCaps(path), false), prompt, opts.signal);
    let out = "";
    for await (const line of run.lines) out += `${line}\n`;
    const { code, stderr } = await run.exit;
    if (code !== 0) throw exitError(code, stderr, out);
    try {
      const r = resultOf(JSON.parse(out) as Record<string, unknown>);
      if (r.error) throw new Error(r.error);
      return r.text;
    } catch (e) {
      if (e instanceof SyntaxError) return out.trim(); // a CLI without json output
      throw e;
    }
  },

  async *stream(model, messages, opts) {
    const path = claudeBin();
    if (!path) throw new Error(CLAUDE_CODE_MISSING);
    const c = claudeCaps(path);
    if (!c.partial) {
      // No partial messages on this CLI: the whole reply, in one piece.
      yield await claudeCode.complete(model, messages, opts);
      return;
    }
    const { system, prompt } = promptFrom(messages);
    const run = launch(buildArgs(system, model, c, true), prompt, opts.signal);
    let emitted = false;
    let final: (StreamItem & { kind: "result" }) | null = null;
    for await (const line of run.lines) {
      const item = parseStreamLine(line);
      if (item.kind === "text") {
        emitted = true;
        yield item.text;
      } else if (item.kind === "result") {
        final = item;
      }
    }
    const { code, stderr } = await run.exit;
    if (final?.error) throw new Error(final.error);
    if (code !== 0) throw exitError(code, stderr, "");
    // A reply that arrived without deltas (a CLI that batches) still lands.
    if (!emitted && final?.text) yield final.text;
  },
};
