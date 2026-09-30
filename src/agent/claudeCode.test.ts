import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { effortParams } from "./anthropic";
import {
  CHAT_SUFFIX,
  CLAUDE_CODE_SIGNED_OUT,
  buildArgs,
  capsFromHelp,
  claudeCode,
  friendlyError,
  modelFlag,
  parseStreamLine,
  promptFrom,
  resetClaudeCode,
} from "./claudeCode";
import { PROVIDERS, isProviderId } from "./providers";

const ALL = { tools: true, noSessionPersistence: true, partial: true };

describe("claude code — the request", () => {
  test("a lone user turn passes verbatim; the suffix rides on the system prompt", () => {
    const r = promptFrom([
      { role: "system", content: "You are SOFT." },
      { role: "user", content: "what is this data?" },
    ]);
    expect(r.prompt).toBe("what is this data?");
    expect(r.system).toBe(`You are SOFT.\n\n${CHAT_SUFFIX}`);
  });

  test("a thread folds into a labelled transcript", () => {
    const r = promptFrom([
      { role: "user", content: "a" },
      { role: "assistant", content: "b" },
      { role: "user", content: "c" },
    ]);
    expect(r.prompt).toBe("User: a\n\nAssistant: b\n\nUser: c");
    expect(r.system).toBe(CHAT_SUFFIX);
  });

  test("`default` and blank mean no --model", () => {
    expect(modelFlag("default")).toBeNull();
    expect(modelFlag("  ")).toBeNull();
    expect(modelFlag("opus")).toBe("opus");
  });

  test("the IDE's hardening flags, and never --bare", () => {
    const a = buildArgs("sys", "sonnet", ALL, true);
    expect(a).toContain("--strict-mcp-config");
    expect(a).toContain("--no-session-persistence");
    expect(a.slice(a.indexOf("--tools"), a.indexOf("--tools") + 2)).toEqual(["--tools", ""]);
    expect(a.slice(a.indexOf("--model"), a.indexOf("--model") + 2)).toEqual(["--model", "sonnet"]);
    expect(a).toContain("stream-json");
    expect(a).toContain("--include-partial-messages");
    expect(a).not.toContain("--bare");
  });

  test("an older CLI gets only the flags it lists", () => {
    const c = capsFromHelp("  -p, --print\n  --output-format <f>\n");
    expect(c).toEqual({ tools: false, noSessionPersistence: false, partial: false });
    const a = buildArgs("sys", "default", c, true);
    expect(a).not.toContain("--tools");
    expect(a).not.toContain("--no-session-persistence");
    expect(a).not.toContain("--model");
    // No partial messages: one JSON blob instead of a stream.
    expect(a.slice(a.indexOf("--output-format"), a.indexOf("--output-format") + 2)).toEqual([
      "--output-format",
      "json",
    ]);
  });
});

describe("claude code — reading the stream", () => {
  test("text deltas are the reply; thinking deltas are not", () => {
    const text = JSON.stringify({
      type: "stream_event",
      event: { type: "content_block_delta", delta: { type: "text_delta", text: "Hi" } },
    });
    const thinking = JSON.stringify({
      type: "stream_event",
      event: { type: "content_block_delta", delta: { type: "thinking_delta", thinking: "" } },
    });
    expect(parseStreamLine(text)).toEqual({ kind: "text", text: "Hi" });
    expect(parseStreamLine(thinking)).toEqual({ kind: "other" });
    expect(parseStreamLine("not json")).toEqual({ kind: "other" });
  });

  test("a result line carries errors, mapped to what the user should do", () => {
    const bad = JSON.stringify({ type: "result", is_error: true, subtype: "error", result: "Not logged in · Please run /login" });
    expect(parseStreamLine(bad)).toEqual({ kind: "result", text: "", error: CLAUDE_CODE_SIGNED_OUT });
    expect(friendlyError("exited 1: boom")).toBe("claude code: exited 1: boom");
  });
});

describe("claude code — against a stand-in CLI", () => {
  let dir = "";
  const saved = process.env.SCELO_CLAUDE_BIN;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "scelo-fake-claude-"));
    const bin = join(dir, "claude");
    // Speaks just enough of the real CLI: --help, auth status, and a -p call
    // that streams two deltas and a result — echoing the model flag so the
    // test can see it arrived.
    writeFileSync(
      bin,
      `#!/bin/sh
case "$1" in
  --help) echo "  --tools <t>"; echo "  --no-session-persistence"; echo "  --include-partial-messages"; exit 0 ;;
  auth) echo '{"loggedIn": true}'; exit 0 ;;
  --version) echo "9.9.9"; exit 0 ;;
esac
cat > /dev/null
model=default
while [ $# -gt 0 ]; do [ "$1" = "--model" ] && model="$2"; shift; done
echo '{"type":"system","subtype":"init"}'
echo '{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"hello "}}}'
echo "{\\"type\\":\\"stream_event\\",\\"event\\":{\\"type\\":\\"content_block_delta\\",\\"delta\\":{\\"type\\":\\"text_delta\\",\\"text\\":\\"from $model\\"}}}"
echo "{\\"type\\":\\"result\\",\\"is_error\\":false,\\"result\\":\\"hello from $model\\"}"
`,
    );
    chmodSync(bin, 0o755);
    process.env.SCELO_CLAUDE_BIN = bin;
    resetClaudeCode();
  });

  afterAll(() => {
    if (saved === undefined) delete process.env.SCELO_CLAUDE_BIN;
    else process.env.SCELO_CLAUDE_BIN = saved;
    resetClaudeCode();
    rmSync(dir, { recursive: true, force: true });
  });

  test("probes as signed in", async () => {
    expect(await claudeCode.available("default", {})).toBe(true);
  });

  test("streams the deltas in order", async () => {
    const parts: string[] = [];
    for await (const p of claudeCode.stream("sonnet", [{ role: "user", content: "hi" }], {})) parts.push(p);
    expect(parts).toEqual(["hello ", "from sonnet"]);
  });

  test("a signed-out CLI probes false", async () => {
    const bin = join(dir, "claude-out");
    writeFileSync(bin, `#!/bin/sh\necho '{"loggedIn": false}'\nexit 1\n`);
    chmodSync(bin, 0o755);
    process.env.SCELO_CLAUDE_BIN = bin;
    resetClaudeCode();
    expect(await claudeCode.available("default", {})).toBe(false);
    process.env.SCELO_CLAUDE_BIN = join(dir, "claude");
    resetClaudeCode();
  });
});

describe("the catalog", () => {
  test("claude code is a keyless provider with the CLI's aliases", () => {
    expect(isProviderId("claude-code")).toBe(true);
    const p = PROVIDERS.find((x) => x.id === "claude-code");
    expect(p?.needsKey).toBe(false);
    expect(p?.models?.map((m) => m.id)).toEqual(["default", "opus", "sonnet", "haiku"]);
  });

  test("the anthropic list leads with the current models", () => {
    const ids = PROVIDERS.find((x) => x.id === "anthropic")?.models?.map((m) => m.id);
    expect(ids?.slice(0, 4)).toEqual(["claude-opus-5-5", "claude-fable-5-1", "claude-sonnet-5-5", "claude-haiku-4-5"]);
  });

  test("effort goes only where the model accepts it", () => {
    expect(effortParams("claude-opus-5-5")).toEqual({ output_config: { effort: "low" } });
    expect(effortParams("claude-haiku-4-5")).toEqual({});
  });
});
