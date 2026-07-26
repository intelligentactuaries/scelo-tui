// The shape every provider adapter implements.
//
// Separate from llm.ts so the adapters can import it without importing the
// dispatcher that imports them.

export type LlmMessage = { role: "system" | "user" | "assistant"; content: string };

export type CallOpts = {
  /** Prose budget the caller wants back. Adapters may enlarge the wire value
   *  — on a model that thinks, `max_tokens` covers reasoning AND the reply,
   *  so passing this through verbatim truncates the answer. */
  maxTokens?: number;
  /** Honoured where the provider accepts it. Deliberately ignored on the
   *  Anthropic path: recent Claude models reject sampling parameters with a
   *  400 rather than clamping them. */
  temperature?: number;
  signal?: AbortSignal;
  apiKey?: string;
  baseUrl?: string;
};

export type Adapter = {
  /** Can we reach it, with the credentials we have? A real round trip —
   *  "there is a key in the config" is not the same question. */
  available(model: string, opts: CallOpts): Promise<boolean>;
  /** Which models this provider will serve right now. */
  models(opts: CallOpts): Promise<string[]>;
  complete(model: string, messages: LlmMessage[], opts: CallOpts): Promise<string>;
  stream(model: string, messages: LlmMessage[], opts: CallOpts): AsyncGenerator<string>;
};

/** Split our flat message list into Anthropic's shape: system prompt hoisted
 *  out, and a turn list that must begin with a user message. */
export function splitSystem(messages: LlmMessage[]): {
  system: string;
  turns: Array<{ role: "user" | "assistant"; content: string }>;
} {
  const system = messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n\n");
  const turns = messages
    .filter((m): m is LlmMessage & { role: "user" | "assistant" } => m.role !== "system")
    .map((m) => ({ role: m.role, content: m.content }));
  // A leading assistant turn is rejected. It should not happen — a bot turn
  // only exists after a user turn — but a truncated history could produce one.
  while (turns.length > 0 && turns[0].role === "assistant") turns.shift();
  return { system, turns };
}
