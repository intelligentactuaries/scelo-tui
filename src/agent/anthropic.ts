// Anthropic Claude, through the official SDK.
//
// Three things here are not obvious from the Ollama adapter next door, and
// each one is a bug if you carry the local-model habits across:
//
//   1. No sampling parameters. `temperature`, `top_p` and `top_k` are
//      REJECTED with a 400 on the current Claude models — not clamped, not
//      ignored. `CallOpts.temperature` is deliberately dropped on this path.
//
//   2. `max_tokens` is a ceiling on thinking PLUS the reply, and thinking is
//      on by default. Passing the caller's 300-token prose budget straight
//      through would spend it all on reasoning and truncate the answer
//      mid-sentence. `budget()` adds the headroom. Brevity is enforced by the
//      system prompt ("4 lines max"), which is where it belongs — a token cap
//      does not make a model concise, it makes it stop talking.
//
//   3. A refusal is a successful HTTP 200 with `stop_reason: "refusal"` and
//      empty content, so code that reads `content[0]` unconditionally shows
//      an empty pane and no explanation.

import Anthropic from "@anthropic-ai/sdk";
import { provider } from "./providers";
import type { Adapter, LlmMessage } from "./types";
import { splitSystem } from "./types";

let client: Anthropic | null = null;
let clientKey: string | undefined;
let clientFailed: string | null = null;

/**
 * The SDK resolves credentials itself, in order: `ANTHROPIC_API_KEY`,
 * `ANTHROPIC_AUTH_TOKEN`, then an `ant auth login` profile on disk. So "no
 * key stored in scelo-tui" is NOT the same as "no credentials" — a machine
 * with a logged-in profile works with nothing configured here, which is why
 * the no-key path still constructs a bare client and tries.
 */
function get(apiKey?: string): Anthropic {
  if (client && clientKey === apiKey) return client;
  clientKey = apiKey;
  clientFailed = null;
  try {
    client = apiKey ? new Anthropic({ apiKey }) : new Anthropic();
  } catch (e) {
    // Older SDK builds throw at construction when nothing resolves. Turn it
    // into a message the picker can show instead of a stack trace.
    client = null;
    clientFailed = e instanceof Error ? e.message : String(e);
    throw new Error(`anthropic: no credentials — ${clientFailed}`);
  }
  return client;
}

/** Reasoning share of `max_tokens`. Generous because `max_tokens` is a
 *  ceiling, not a charge: unused headroom costs nothing, a truncated answer
 *  costs the whole request. */
function budget(maxTokens: number | undefined): number {
  return 4096 + (maxTokens ?? 400);
}

/**
 * Server-side refusal fallback. Claude Opus 5 and Fable 5 can decline a
 * request outright; with this on, the API re-runs it on a fallback model
 * inside the same call rather than handing back an empty response.
 *
 * Flipped off permanently for the process if the account cannot use the beta,
 * so an org without it degrades to plain requests instead of failing every
 * one of them. `null` means "not established yet".
 */
const FALLBACK_BETA = "server-side-fallback-2026-07-01";
const FALLBACK_MODELS = /^claude-(opus-5|fable-5|mythos-5)$/;
let fallbacksUsable: boolean | null = null;

function fallbackParams(model: string): {
  betas?: string[];
  fallbacks?: "default";
} {
  if (fallbacksUsable === false || !FALLBACK_MODELS.test(model)) return {};
  return { betas: [FALLBACK_BETA], fallbacks: "default" };
}

/** A 400 that is specifically about the fallback beta, rather than about the
 *  request we actually care about. */
function rejectedFallback(e: unknown): boolean {
  if (fallbacksUsable === false) return false;
  if (!(e instanceof Anthropic.APIError) || e.status !== 400) return false;
  return /fallback|beta/i.test(e.message);
}

/** Interactive terminal: thinking depth is the latency dial, and these are
 *  terse summarisation tasks. Low effort is the right default here — and the
 *  right lever generally, since disabling thinking outright on Opus 5 invites
 *  reasoning leaking into the visible reply. */
const EFFORT = "low" as const;

function textOf(content: Array<{ type: string; text?: string }>): string {
  return content
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("")
    .trim();
}

function refusalMessage(stopDetails: unknown): string {
  const cat =
    stopDetails && typeof stopDetails === "object" && "category" in stopDetails
      ? String((stopDetails as { category?: unknown }).category ?? "")
      : "";
  return cat
    ? `the model declined this request (${cat})`
    : "the model declined this request";
}

export const anthropic: Adapter = {
  async available(_model, opts) {
    try {
      const c = get(opts.apiKey);
      // A real round trip. "There is a key in the config" answers a different
      // question than "that key works", and the picker should show the second.
      await c.models.list({ limit: 1 }, { signal: opts.signal });
      return true;
    } catch {
      return false;
    }
  },

  async models() {
    // Curated rather than discovered: `/v1/models` lists retired snapshots
    // alongside current ones with nothing to tell them apart.
    return (provider("anthropic").models ?? []).map((m) => m.id);
  },

  async complete(model, messages: LlmMessage[], opts) {
    const c = get(opts.apiKey);
    const { system, turns } = splitSystem(messages);
    const send = async (extra: ReturnType<typeof fallbackParams>) =>
      c.beta.messages.create(
        {
          model,
          max_tokens: budget(opts.maxTokens),
          ...(system ? { system } : {}),
          messages: turns,
          output_config: { effort: EFFORT },
          ...extra,
        },
        { signal: opts.signal },
      );

    let msg: Awaited<ReturnType<typeof send>>;
    try {
      msg = await send(fallbackParams(model));
    } catch (e) {
      if (!rejectedFallback(e)) throw e;
      fallbacksUsable = false;
      msg = await send({});
    }

    if (msg.stop_reason === "refusal") throw new Error(refusalMessage(msg.stop_details));
    return textOf(msg.content as Array<{ type: string; text?: string }>);
  },

  async *stream(model, messages: LlmMessage[], opts) {
    const c = get(opts.apiKey);
    const { system, turns } = splitSystem(messages);

    async function* once(extra: ReturnType<typeof fallbackParams>): AsyncGenerator<string> {
      const s = c.beta.messages.stream(
        {
          model,
          max_tokens: budget(opts.maxTokens),
          ...(system ? { system } : {}),
          messages: turns,
          output_config: { effort: EFFORT },
          ...extra,
        },
        { signal: opts.signal },
      );
      for await (const ev of s) {
        // Only visible text. Thinking blocks stream with empty content by
        // default, so this is a filter for clarity rather than for secrecy.
        if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") {
          yield ev.delta.text;
        }
      }
      const final = await s.finalMessage();
      if (final.stop_reason === "refusal") throw new Error(refusalMessage(final.stop_details));
    }

    // A rejected beta surfaces on connect, before any delta, so retrying is
    // safe — but only while nothing has been yielded, or a mid-stream retry
    // would replay text the pane has already shown.
    let emitted = false;
    try {
      for await (const piece of once(fallbackParams(model))) {
        emitted = true;
        yield piece;
      }
    } catch (e) {
      if (emitted || !rejectedFallback(e)) throw e;
      fallbacksUsable = false;
      yield* once({});
    }
  },
};
