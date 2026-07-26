// Local models over Ollama's HTTP API.
//
// Lifted out of llm.ts unchanged when the second provider arrived — the
// original two functions were already the right seam.

import type { Adapter, CallOpts, LlmMessage } from "./types";

function base(opts: CallOpts): string {
  return opts.baseUrl ?? process.env.SCELO_OLLAMA_URL ?? "http://localhost:11434";
}

export const ollama: Adapter = {
  async available(_model, opts) {
    try {
      const r = await fetch(`${base(opts)}/api/tags`, { signal: AbortSignal.timeout(2500) });
      return r.ok;
    } catch {
      return false;
    }
  },

  async models(opts) {
    try {
      const r = await fetch(`${base(opts)}/api/tags`, { signal: AbortSignal.timeout(2500) });
      if (!r.ok) return [];
      const body = (await r.json()) as { models?: Array<{ name?: string }> };
      return (body.models ?? [])
        .map((m) => m.name)
        .filter((n): n is string => typeof n === "string" && n !== "")
        .sort();
    } catch {
      return [];
    }
  },

  async complete(model, messages, opts) {
    const r = await fetch(`${base(opts)}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model,
        messages,
        stream: false,
        options: {
          num_predict: opts.maxTokens ?? 400,
          temperature: opts.temperature ?? 0.3,
        },
      }),
      signal: opts.signal,
    });
    if (!r.ok) throw new Error(`ollama ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const body = (await r.json()) as { message?: { content?: string } };
    return (body.message?.content ?? "").trim();
  },

  async *stream(model, messages: LlmMessage[], opts) {
    const r = await fetch(`${base(opts)}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model,
        messages,
        stream: true,
        options: {
          num_predict: opts.maxTokens ?? 500,
          temperature: opts.temperature ?? 0.4,
        },
      }),
      signal: opts.signal,
    });
    if (!r.ok) throw new Error(`ollama ${r.status}: ${(await r.text()).slice(0, 200)}`);
    if (!r.body) throw new Error("ollama returned no body");
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      // Ollama emits newline-delimited JSON, one object per token batch.
      let nl = buf.indexOf("\n");
      while (nl !== -1) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (line) {
          try {
            const ev = JSON.parse(line) as { message?: { content?: string }; done?: boolean };
            const piece = ev.message?.content;
            if (piece) yield piece;
          } catch {
            // partial / malformed line — skip rather than abandon the stream
          }
        }
        nl = buf.indexOf("\n");
      }
    }
  },
};
