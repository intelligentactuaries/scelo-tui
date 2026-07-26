// Which model answers, and the two calls everything else makes.
//
// The panes and the pipeline import `complete` and `stream` and nothing else;
// they have never known which provider is behind them and still don't. What
// changed when Claude was added is that the answer is now chosen at runtime
// instead of baked in at import, so the selection lives here as module state
// rather than as a const.

import { anthropic } from "./anthropic";
import { type Config, keyFor, loadConfig } from "./config";
import { ollama } from "./ollama";
import { openaiCompat } from "./openaiCompat";
import { type ProviderId, type Selection, describe, isProviderId, provider } from "./providers";
import type { Adapter, CallOpts, LlmMessage } from "./types";

export type { LlmMessage };
export type { Selection };

const ADAPTERS: Record<ProviderId, Adapter> = {
  ollama,
  anthropic,
  openai: openaiCompat,
  google: openaiCompat,
  openrouter: openaiCompat,
};

let config: Config = loadConfig();
let active: Selection = initialSelection(config);

/** Saved choice, with the environment allowed to override it — so a script
 *  can pin a provider for one run without rewriting the user's config. */
function initialSelection(cfg: Config): Selection {
  const envProvider = process.env.SCELO_TUI_PROVIDER;
  const envModel = process.env.SCELO_TUI_MODEL;
  return {
    provider: isProviderId(envProvider) ? envProvider : cfg.provider,
    model: envModel && envModel.trim() !== "" ? envModel.trim() : cfg.model,
  };
}

export function getConfig(): Config {
  return config;
}

/** Re-read from disk. Called after the settings screen writes a key, so the
 *  next request picks it up without restarting. */
export function reloadConfig(): Config {
  config = loadConfig();
  return config;
}

export function getActive(): Selection {
  return active;
}

export function setActive(sel: Selection): void {
  active = sel;
}

/** Header text: `qwen2.5:7b` locally, `anthropic/claude-opus-5` remotely. */
export function activeLabel(): string {
  return describe(active);
}

/** Credentials and endpoint for a selection. Kept out of the adapters so
 *  there is exactly one place that reads a key out of the config. */
export function optsFor(sel: Selection): CallOpts {
  const p = provider(sel.provider);
  return {
    apiKey: keyFor(config, sel.provider, p.envKey),
    baseUrl: p.baseUrl ?? (sel.provider === "ollama" ? p.where : undefined),
  };
}

function adapterFor(sel: Selection): Adapter {
  return ADAPTERS[sel.provider];
}

/** Can the selected provider answer right now? A real round trip, so a stale
 *  key or a stopped ollama shows up here rather than as three dead panes. */
export async function llmAvailable(sel: Selection = active): Promise<boolean> {
  try {
    return await adapterFor(sel).available(sel.model, optsFor(sel));
  } catch {
    return false;
  }
}

/** Models a provider will serve. Curated where the provider's own list is
 *  unhelpful (Anthropic), discovered everywhere else. */
export async function discoverModels(id: ProviderId): Promise<string[]> {
  const p = provider(id);
  if (p.models) return p.models.map((m) => m.id);
  try {
    return await ADAPTERS[id].models(optsFor({ provider: id, model: "" }));
  } catch {
    return [];
  }
}

/** One-shot completion. Used for the agent's narrative summaries, where
 *  partial output is worthless and we want the whole thing or an error. */
export async function complete(
  messages: LlmMessage[],
  opts: { maxTokens?: number; temperature?: number; signal?: AbortSignal } = {},
): Promise<string> {
  return adapterFor(active).complete(active.model, messages, { ...optsFor(active), ...opts });
}

/** Streaming completion for the chat panes — a reply that lands all at once
 *  after 20s reads as a hang, which is exactly what these panes must avoid. */
export async function* stream(
  messages: LlmMessage[],
  opts: { maxTokens?: number; temperature?: number; signal?: AbortSignal } = {},
): AsyncGenerator<string> {
  yield* adapterFor(active).stream(active.model, messages, { ...optsFor(active), ...opts });
}
