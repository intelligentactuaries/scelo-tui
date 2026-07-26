// One adapter for the three providers that speak the OpenAI chat shape:
// OpenAI itself, OpenRouter, and Gemini through Google's OpenAI-compatible
// endpoint. Same `/chat/completions` body, same SSE frames, same `/models`
// listing — the only difference is the base URL and the key.
//
// Model lists here are always discovered. Hardcoding ids for providers that
// rename and retire them on their own schedule produces a picker that
// confidently offers you a 404.

import type { Adapter, CallOpts, LlmMessage } from "./types";

function headers(opts: CallOpts): Record<string, string> {
  return {
    "content-type": "application/json",
    ...(opts.apiKey ? { authorization: `Bearer ${opts.apiKey}` } : {}),
  };
}

function base(opts: CallOpts): string {
  if (!opts.baseUrl) throw new Error("no endpoint configured for this provider");
  return opts.baseUrl.replace(/\/+$/, "");
}

/** Error text without the request body, which would carry the prompt, and
 *  never the headers, which carry the key. */
async function fail(r: Response, where: string): Promise<never> {
  const body = await r.text().catch(() => "");
  throw new Error(`${where} ${r.status}: ${body.slice(0, 200)}`);
}

function body(model: string, messages: LlmMessage[], opts: CallOpts, streaming: boolean) {
  return JSON.stringify({
    model,
    messages,
    stream: streaming,
    max_tokens: opts.maxTokens ?? (streaming ? 500 : 400),
    ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
  });
}

export const openaiCompat: Adapter = {
  async available(_model, opts) {
    if (!opts.apiKey || !opts.baseUrl) return false;
    try {
      const r = await fetch(`${base(opts)}/models`, {
        headers: headers(opts),
        signal: AbortSignal.timeout(6000),
      });
      return r.ok;
    } catch {
      return false;
    }
  },

  async models(opts) {
    if (!opts.apiKey || !opts.baseUrl) return [];
    try {
      const r = await fetch(`${base(opts)}/models`, {
        headers: headers(opts),
        signal: AbortSignal.timeout(6000),
      });
      if (!r.ok) return [];
      const parsed = (await r.json()) as { data?: Array<{ id?: string }> };
      return (parsed.data ?? [])
        .map((m) => m.id)
        .filter((id): id is string => typeof id === "string" && id !== "")
        // Embedding, audio, image and moderation endpoints share the models
        // list with chat models; offering them in a chat picker is a 400
        // waiting to happen.
        .filter((id) => !/embed|whisper|tts|dall-e|moderation|image|audio|rerank/i.test(id))
        .map((id) => id.replace(/^models\//, "")) // Gemini prefixes its ids
        .sort();
    } catch {
      return [];
    }
  },

  async complete(model, messages, opts) {
    const r = await fetch(`${base(opts)}/chat/completions`, {
      method: "POST",
      headers: headers(opts),
      body: body(model, messages, opts, false),
      signal: opts.signal,
    });
    if (!r.ok) await fail(r, "provider");
    const parsed = (await r.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    return (parsed.choices?.[0]?.message?.content ?? "").trim();
  },

  async *stream(model, messages, opts) {
    const r = await fetch(`${base(opts)}/chat/completions`, {
      method: "POST",
      headers: headers(opts),
      body: body(model, messages, opts, true),
      signal: opts.signal,
    });
    if (!r.ok) await fail(r, "provider");
    if (!r.body) throw new Error("provider returned no body");
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl = buf.indexOf("\n");
      while (nl !== -1) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        nl = buf.indexOf("\n");
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (payload === "" || payload === "[DONE]") continue;
        try {
          const ev = JSON.parse(payload) as {
            choices?: Array<{ delta?: { content?: string } }>;
          };
          const piece = ev.choices?.[0]?.delta?.content;
          if (piece) yield piece;
        } catch {
          // partial / malformed frame — skip rather than abandon the stream
        }
      }
    }
  },
};
