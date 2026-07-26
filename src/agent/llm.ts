// Direct-to-Ollama client.
//
// No orchestrator backend here — the TUI talks to the local model over HTTP,
// the same shape the desktop IDE's main-process bridge uses. Cloud providers
// would slot in behind the same two functions.

const OLLAMA = process.env.SCELO_OLLAMA_URL ?? "http://localhost:11434";

/** Default is the small fast model: three chat panes on one screen means
 *  interactivity matters more than prose quality. Override for the heavier
 *  local model with SCELO_TUI_MODEL=gemma3:27b. */
export const MODEL = process.env.SCELO_TUI_MODEL ?? "qwen2.5:7b-instruct-q4_K_M";

export type LlmMessage = { role: "system" | "user" | "assistant"; content: string };

export async function llmAvailable(): Promise<boolean> {
  try {
    const r = await fetch(`${OLLAMA}/api/tags`, { signal: AbortSignal.timeout(2500) });
    return r.ok;
  } catch {
    return false;
  }
}

/** One-shot completion. Used for the agent's narrative summaries, where
 *  partial output is worthless and we want the whole thing or an error. */
export async function complete(
  messages: LlmMessage[],
  opts: { maxTokens?: number; temperature?: number; signal?: AbortSignal } = {},
): Promise<string> {
  const r = await fetch(`${OLLAMA}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
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
}

/** Streaming completion for the chat panes — a reply that lands all at once
 *  after 20s reads as a hang, which is exactly what these panes must avoid. */
export async function* stream(
  messages: LlmMessage[],
  opts: { maxTokens?: number; temperature?: number; signal?: AbortSignal } = {},
): AsyncGenerator<string> {
  const r = await fetch(`${OLLAMA}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
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
}
