// The provider catalog: who can answer, what they cost you, and where the
// key comes from.
//
// Model lists are DISCOVERED, not hardcoded, everywhere it is possible:
// Ollama exposes what you have pulled, and the OpenAI-compatible providers
// expose `/models`. A hardcoded list goes stale silently and then offers you
// a model id that 404s, which reads as "the app is broken".
//
// Anthropic is the exception and is curated on purpose: `/v1/models` returns
// every id including retired snapshots, with no indication of which one you
// actually want. The short list below names the current models with the
// tradeoff spelled out, which is the thing a picker exists to show.

export type ProviderId = "ollama" | "anthropic" | "openai" | "google" | "openrouter";

const IDS: ProviderId[] = ["ollama", "anthropic", "openai", "google", "openrouter"];

export function isProviderId(v: unknown): v is ProviderId {
  return typeof v === "string" && (IDS as string[]).includes(v);
}

export type ModelOption = {
  id: string;
  /** One line on why you would pick this over its neighbours. */
  note: string;
};

export type Provider = {
  id: ProviderId;
  label: string;
  /** Shown under the provider name — where the work actually happens. */
  where: string;
  /** Environment variable consulted when no key is stored. */
  envKey?: string;
  /** Absent for local providers, which need no credential at all. */
  needsKey: boolean;
  /** Where the user gets a key, shown when they have none. */
  keyHint?: string;
  /** Base URL for the OpenAI-compatible providers. */
  baseUrl?: string;
  /** Fixed list, when discovery is the wrong answer (Anthropic). */
  models?: ModelOption[];
};

/** Anthropic's current models. Opus 5 leads because it is the capable
 *  default; the rest are here because a three-pane terminal makes latency
 *  and cost visible in a way a chat window does not, and those are
 *  tradeoffs the user should get to make rather than have made for them.
 *  Fable 5 needs no special handling in anthropic.ts: we never send a
 *  `thinking` param (Fable rejects explicit configs — thinking is always
 *  on), and the refusal fallback regex already covers it. */
const ANTHROPIC_MODELS: ModelOption[] = [
  { id: "claude-opus-5", note: "most capable · the default" },
  { id: "claude-fable-5", note: "highest capability tier · 2× opus price, longer turns" },
  { id: "claude-sonnet-5", note: "near-opus, faster and cheaper" },
  { id: "claude-haiku-4-5", note: "fastest, cheapest" },
  { id: "claude-opus-4-8", note: "previous opus" },
];

export const PROVIDERS: Provider[] = [
  {
    id: "ollama",
    label: "OLLAMA",
    where: process.env.SCELO_OLLAMA_URL ?? "http://localhost:11434",
    needsKey: false,
  },
  {
    id: "anthropic",
    label: "ANTHROPIC",
    where: "claude api",
    envKey: "ANTHROPIC_API_KEY",
    needsKey: true,
    keyHint: "console.anthropic.com → api keys (or run `ant auth login`)",
    models: ANTHROPIC_MODELS,
  },
  {
    id: "openai",
    label: "OPENAI",
    where: "api.openai.com",
    envKey: "OPENAI_API_KEY",
    needsKey: true,
    keyHint: "platform.openai.com → api keys",
    baseUrl: process.env.SCELO_OPENAI_URL ?? "https://api.openai.com/v1",
  },
  {
    id: "google",
    label: "GOOGLE",
    where: "gemini",
    envKey: "GEMINI_API_KEY",
    needsKey: true,
    keyHint: "aistudio.google.com → get api key",
    // Gemini's own OpenAI-compatible endpoint, so it shares one adapter with
    // OpenAI and OpenRouter instead of needing a third request shape.
    baseUrl:
      process.env.SCELO_GOOGLE_URL ?? "https://generativelanguage.googleapis.com/v1beta/openai",
  },
  {
    id: "openrouter",
    label: "OPENROUTER",
    where: "everything else",
    envKey: "OPENROUTER_API_KEY",
    needsKey: true,
    keyHint: "openrouter.ai → keys",
    baseUrl: process.env.SCELO_OPENROUTER_URL ?? "https://openrouter.ai/api/v1",
  },
];

export function provider(id: ProviderId): Provider {
  const p = PROVIDERS.find((x) => x.id === id);
  if (!p) throw new Error(`unknown provider: ${id}`);
  return p;
}

/** What the app is currently pointed at. */
export type Selection = { provider: ProviderId; model: string };

/** Short label for the header — the provider is implied by the model id for
 *  every provider except Ollama, where the id is just a local tag. */
export function describe(sel: Selection): string {
  return sel.provider === "ollama" ? sel.model : `${sel.provider}/${sel.model}`;
}
