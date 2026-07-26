// Where the TUI remembers which model you picked, and the API keys for the
// providers that need one.
//
// This file holds secrets, so three rules apply throughout:
//   - the directory is 0700 and the file 0600, re-applied on every write
//     (writeFile's `mode` only takes effect when it CREATES the file, so a
//     file that already exists with loose permissions would keep them),
//   - keys are never written to stdout, stderr or the transcript — only
//     `maskKey` output ever reaches the screen,
//   - a corrupt or unreadable config degrades to defaults rather than
//     throwing, because losing your model preference must not stop the app
//     from starting.
//
// It lives under the user's config dir, not the repo, so there is nothing to
// gitignore and nothing to leak by committing.

import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { type ProviderId, isProviderId } from "./providers";

function configHome(): string {
  const xdg = process.env.XDG_CONFIG_HOME;
  return xdg && xdg.startsWith("/") ? xdg : join(homedir(), ".config");
}

export const CONFIG_PATH =
  process.env.SCELO_TUI_CONFIG ?? join(configHome(), "scelo-tui", "config.json");

export type Config = {
  provider: ProviderId;
  model: string;
  /** Per-provider API keys, entered by the user in the settings screen. */
  keys: Partial<Record<ProviderId, string>>;
};

export const DEFAULT_CONFIG: Config = {
  provider: "ollama",
  model: process.env.SCELO_TUI_MODEL ?? "qwen2.5:7b-instruct-q4_K_M",
  keys: {},
};

/** Read the saved config. Any problem — missing, unreadable, malformed,
 *  hand-edited into nonsense — yields defaults instead of an exception. */
export function loadConfig(): Config {
  try {
    const parsed: unknown = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
    if (!parsed || typeof parsed !== "object") return { ...DEFAULT_CONFIG };
    const raw = parsed as Partial<Config>;
    const keys: Config["keys"] = {};
    if (raw.keys && typeof raw.keys === "object") {
      for (const [k, v] of Object.entries(raw.keys)) {
        if (isProviderId(k) && typeof v === "string" && v.trim() !== "") keys[k] = v;
      }
    }
    return {
      provider: isProviderId(raw.provider) ? raw.provider : DEFAULT_CONFIG.provider,
      model:
        typeof raw.model === "string" && raw.model.trim() !== ""
          ? raw.model
          : DEFAULT_CONFIG.model,
      keys,
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

/** Persist the config, tightening permissions on both the directory and the
 *  file. Returns an error message rather than throwing: a save that fails
 *  should tell you in the UI, not take the screen down. */
export function saveConfig(cfg: Config): string | null {
  try {
    mkdirSync(dirname(CONFIG_PATH), { recursive: true, mode: 0o700 });
    writeFileSync(CONFIG_PATH, `${JSON.stringify(cfg, null, 2)}\n`, { mode: 0o600 });
    // Explicit, because `mode` above is ignored for an existing file.
    chmodSync(CONFIG_PATH, 0o600);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

/** The key to use for a provider: an explicitly stored one first, otherwise
 *  the provider's environment variable. `undefined` means "we have nothing" —
 *  which is not the same as "this will fail", since the Anthropic SDK also
 *  resolves an `ant auth login` profile with no key set anywhere. */
export function keyFor(cfg: Config, provider: ProviderId, envName?: string): string | undefined {
  const stored = cfg.keys[provider];
  if (stored && stored.trim() !== "") return stored.trim();
  const fromEnv = envName ? process.env[envName] : undefined;
  return fromEnv && fromEnv.trim() !== "" ? fromEnv.trim() : undefined;
}

/** How a key is allowed to appear on screen: enough to tell two keys apart,
 *  never enough to use. Short strings are masked entirely rather than
 *  revealing most of themselves. */
export function maskKey(key: string): string {
  const k = key.trim();
  if (k.length <= 8) return "•".repeat(Math.max(4, k.length));
  return `${k.slice(0, 3)}…${"•".repeat(4)}${k.slice(-4)}`;
}
