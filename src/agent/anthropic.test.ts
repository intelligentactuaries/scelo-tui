// The Anthropic request shape, checked against a stand-in server.
//
// Worth testing rather than eyeballing because every mistake available here
// is a 400 at runtime, in a pane, with no stack trace: a stray `temperature`,
// a system message left in the turn list, a `max_tokens` sized for prose on a
// model that spends the same budget on thinking. None of those are visible by
// reading the adapter next to the Ollama one, where all three are correct.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

type Recorded = { path: string; body: Record<string, unknown> };

const seen: Recorded[] = [];
/** Queue of responses; each request shifts one. */
let script: Array<(body: Record<string, unknown>) => Response> = [];

const ok = (text: string) =>
  Response.json({
    id: "msg_1",
    type: "message",
    role: "assistant",
    model: "claude-opus-5",
    content: [{ type: "text", text }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 5, output_tokens: 2 },
  });

const refusal = () =>
  Response.json({
    id: "msg_2",
    type: "message",
    role: "assistant",
    model: "claude-opus-5",
    content: [],
    stop_reason: "refusal",
    stop_details: { type: "refusal", category: "cyber" },
    usage: { input_tokens: 5, output_tokens: 0 },
  });

const badBeta = () =>
  Response.json(
    {
      type: "error",
      error: { type: "invalid_request_error", message: "unsupported beta: server-side-fallback" },
    },
    { status: 400 },
  );

function sse(pieces: string[], stopReason = "end_turn"): Response {
  const frames = [
    `event: message_start\ndata: ${JSON.stringify({
      type: "message_start",
      message: {
        id: "msg_3",
        type: "message",
        role: "assistant",
        model: "claude-opus-5",
        content: [],
        stop_reason: null,
        usage: { input_tokens: 5, output_tokens: 0 },
      },
    })}\n\n`,
    `event: content_block_start\ndata: ${JSON.stringify({
      type: "content_block_start",
      index: 0,
      content_block: { type: "text", text: "" },
    })}\n\n`,
    ...pieces.map(
      (t) =>
        `event: content_block_delta\ndata: ${JSON.stringify({
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: t },
        })}\n\n`,
    ),
    `event: content_block_stop\ndata: ${JSON.stringify({ type: "content_block_stop", index: 0 })}\n\n`,
    `event: message_delta\ndata: ${JSON.stringify({
      type: "message_delta",
      delta: { stop_reason: stopReason, stop_sequence: null },
      usage: { output_tokens: 3 },
    })}\n\n`,
    `event: message_stop\ndata: ${JSON.stringify({ type: "message_stop" })}\n\n`,
  ];
  return new Response(frames.join(""), {
    headers: { "content-type": "text/event-stream" },
  });
}

let server: ReturnType<typeof Bun.serve>;
// biome-ignore lint/suspicious/noExplicitAny: the adapter is imported after env setup
let anthropic: any;

beforeAll(async () => {
  server = Bun.serve({
    port: 0,
    async fetch(req) {
      const body = (await req.json()) as Record<string, unknown>;
      seen.push({ path: new URL(req.url).pathname, body });
      const next = script.shift();
      return next ? next(body) : ok("default");
    },
  });
  // The SDK reads both of these at construction, so they must be set before
  // the adapter module builds its client.
  process.env.ANTHROPIC_BASE_URL = `http://localhost:${server.port}`;
  process.env.ANTHROPIC_API_KEY = "test-key-not-real";
  ({ anthropic } = await import("./anthropic"));
});

afterAll(() => {
  server.stop(true);
});

function reset() {
  seen.length = 0;
  script = [];
}

describe("request shape", () => {
  test("sends no sampling parameters even when the caller asks for them", async () => {
    reset();
    script = [() => ok("fine")];
    await anthropic.complete(
      "claude-sonnet-5",
      [{ role: "user", content: "hi" }],
      { apiKey: "test-key-not-real", temperature: 0.1 },
    );
    // Current Claude models reject these with a 400 rather than clamping.
    expect(seen[0].body).not.toHaveProperty("temperature");
    expect(seen[0].body).not.toHaveProperty("top_p");
    expect(seen[0].body).not.toHaveProperty("top_k");
  });

  test("hoists system out of the turn list", async () => {
    reset();
    script = [() => ok("fine")];
    await anthropic.complete(
      "claude-sonnet-5",
      [
        { role: "system", content: "be terse" },
        { role: "user", content: "hi" },
        { role: "assistant", content: "hello" },
        { role: "user", content: "again" },
      ],
      { apiKey: "test-key-not-real" },
    );
    expect(seen[0].body.system).toBe("be terse");
    expect(seen[0].body.messages).toEqual([
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
      { role: "user", content: "again" },
    ]);
  });

  test("drops a leading assistant turn, which the API rejects", async () => {
    reset();
    script = [() => ok("fine")];
    await anthropic.complete(
      "claude-sonnet-5",
      [
        { role: "assistant", content: "orphaned" },
        { role: "user", content: "hi" },
      ],
      { apiKey: "test-key-not-real" },
    );
    expect(seen[0].body.messages).toEqual([{ role: "user", content: "hi" }]);
  });

  test("gives thinking its own headroom above the caller's prose budget", async () => {
    reset();
    script = [() => ok("fine")];
    await anthropic.complete(
      "claude-sonnet-5",
      [{ role: "user", content: "hi" }],
      { apiKey: "test-key-not-real", maxTokens: 300 },
    );
    // The pipeline asks for 300 tokens of prose. Passing that through would
    // let thinking consume the whole budget and truncate the answer.
    expect(seen[0].body.max_tokens as number).toBeGreaterThan(300);
  });

  test("asks for low effort — the latency dial in an interactive terminal", async () => {
    reset();
    script = [() => ok("fine")];
    await anthropic.complete("claude-sonnet-5", [{ role: "user", content: "hi" }], {
      apiKey: "test-key-not-real",
    });
    expect(seen[0].body.output_config).toEqual({ effort: "low" });
  });
});

describe("refusal", () => {
  test("raises instead of returning empty text", async () => {
    reset();
    script = [() => refusal()];
    // A refusal is a 200 with empty content. Reading content[0] blindly shows
    // an empty pane and no reason.
    await expect(
      anthropic.complete("claude-sonnet-5", [{ role: "user", content: "hi" }], {
        apiKey: "test-key-not-real",
      }),
    ).rejects.toThrow(/declined.*cyber/);
  });
});

describe("streaming", () => {
  test("yields text deltas in order", async () => {
    reset();
    script = [() => sse(["Hel", "lo ", "there"])];
    const out: string[] = [];
    for await (const piece of anthropic.stream(
      "claude-sonnet-5",
      [{ role: "user", content: "hi" }],
      { apiKey: "test-key-not-real" },
    )) {
      out.push(piece as string);
    }
    expect(out.join("")).toBe("Hello there");
    expect(seen[0].body.stream).toBe(true);
  });

  test("a mid-stream refusal raises rather than passing off a partial as complete", async () => {
    reset();
    script = [() => sse(["partial"], "refusal")];
    const run = async () => {
      for await (const _ of anthropic.stream(
        "claude-sonnet-5",
        [{ role: "user", content: "hi" }],
        { apiKey: "test-key-not-real" },
      )) {
        // drain
      }
    };
    await expect(run()).rejects.toThrow(/declined/);
  });
});

describe("refusal fallback", () => {
  test("only asks for it on the models that can refuse", async () => {
    reset();
    script = [() => ok("fine")];
    await anthropic.complete("claude-sonnet-5", [{ role: "user", content: "hi" }], {
      apiKey: "test-key-not-real",
    });
    expect(seen[0].body).not.toHaveProperty("fallbacks");
  });

  test("asks for it on opus 5, then gives up permanently if the account cannot", async () => {
    reset();
    script = [() => badBeta(), () => ok("recovered"), () => ok("second call")];
    const first = await anthropic.complete(
      "claude-opus-5",
      [{ role: "user", content: "hi" }],
      { apiKey: "test-key-not-real" },
    );
    expect(first).toBe("recovered");
    expect(seen[0].body.fallbacks).toBe("default");
    // The retry drops it...
    expect(seen[1].body).not.toHaveProperty("fallbacks");
    // ...and so does every later request, rather than eating a wasted 400
    // round trip on each one.
    await anthropic.complete("claude-opus-5", [{ role: "user", content: "hi" }], {
      apiKey: "test-key-not-real",
    });
    expect(seen[2].body).not.toHaveProperty("fallbacks");
  });
});
