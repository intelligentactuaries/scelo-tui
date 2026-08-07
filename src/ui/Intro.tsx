// The opening screen: which model is going to answer.
//
// It probes every provider in parallel on mount and shows what it found,
// because the two questions people actually have at this point are "which of
// these can I use" and "why is that one greyed out" — and a picker that lists
// options it cannot reach answers neither.
//
// Providers with no credential still get a selectable row, so `k` has
// somewhere to land. A screen that hides the thing you need in order to
// configure it until after you have configured it is a locked door.

import { Box, Text, useApp, useInput, useStdout } from "ink";
import { useCallback, useEffect, useMemo, useState } from "react";
import { keyFor, loadConfig, maskKey, saveConfig } from "../agent/config";
import { discoverModels, getActive, llmAvailable, reloadConfig } from "../agent/llm";
import { PROVIDERS, type Provider, type ProviderId, type Selection } from "../agent/providers";
import { MARK_ROWS, Welcome } from "./Mascot";
import { Working } from "./spinner";
import { MIN_WIDTH, theme } from "./theme";

/** Discovered lists can run to hundreds of entries (OpenRouter). Show a
 *  usable slice and let `m` type an exact id for anything past it. */
const MODELS_SHOWN = 10;

type Probe = {
  state: "probing" | "ready" | "nokey" | "unreachable";
  models: string[];
  /** Masked, never the key itself. */
  key?: string;
};

type Row =
  | { kind: "header"; provider: Provider }
  | {
      kind: "model";
      provider: Provider;
      model: string;
      note?: string;
      /** False while the provider cannot be reached. The row stays visible
       *  and selectable — you should be able to see what is on offer before
       *  paying for a key — but it is drawn dim and ⏎ asks for the key
       *  instead of starting a session that would fail in the panes. */
      ready: boolean;
    }
  | { kind: "hint"; provider: Provider; text: string; spin?: boolean };

const selectable = (r: Row) => r.kind !== "header";

export function Intro({ onStart }: { onStart: (sel: Selection) => void }) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const cols = stdout?.columns ?? 80;
  const termRows = stdout?.rows ?? 24;

  const [probes, setProbes] = useState<Record<string, Probe>>(() =>
    Object.fromEntries(PROVIDERS.map((p) => [p.id, { state: "probing", models: [] } as Probe])),
  );
  const [cursor, setCursor] = useState(0);
  const [mode, setMode] = useState<"list" | "key" | "model">("list");
  const [buffer, setBuffer] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [round, setRound] = useState(0);

  // ── probe everything at once ──────────────────────────────────────────────
  useEffect(() => {
    let live = true;
    const cfg = loadConfig();
    for (const p of PROVIDERS) {
      void (async () => {
        const key = keyFor(cfg, p.id, p.envKey);
        // Anthropic is probed even with no key in hand: the SDK also resolves
        // an `ant auth login` profile, so "nothing stored" is not "no access".
        const canTry = !p.needsKey || key !== undefined || p.id === "anthropic";
        if (!canTry) {
          if (live) setProbes((s) => ({ ...s, [p.id]: { state: "nokey", models: [] } }));
          return;
        }
        const models = await discoverModels(p.id);
        const ok = await llmAvailable({ provider: p.id, model: models[0] ?? "" });
        if (!live) return;
        setProbes((s) => ({
          ...s,
          [p.id]: {
            state: ok ? "ready" : key || !p.needsKey ? "unreachable" : "nokey",
            models,
            key: key ? maskKey(key) : undefined,
          },
        }));
      })();
    }
    return () => {
      live = false;
    };
  }, [round]);

  // ── flatten into rows ─────────────────────────────────────────────────────
  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    for (const p of PROVIDERS) {
      const probe = probes[p.id] ?? { state: "probing", models: [] };
      out.push({ kind: "header", provider: p });
      const curated = new Map((p.models ?? []).map((m) => [m.id, m.note]));
      const list = probe.models.slice(0, MODELS_SHOWN);
      for (const id of list) {
        out.push({
          kind: "model",
          provider: p,
          model: id,
          note: curated.get(id),
          ready: probe.state === "ready",
        });
      }
      if (probe.state === "probing") {
        out.push({ kind: "hint", provider: p, text: "checking", spin: true });
      } else if (probe.state !== "ready") {
        // Shown even when the model list is populated: Anthropic's list is
        // curated rather than fetched, so it is there whether or not you can
        // actually reach the API, and without this the two look identical.
        out.push({
          kind: "hint",
          provider: p,
          text:
            probe.state === "nokey"
              ? `no api key — press k${p.keyHint ? ` · ${p.keyHint}` : ""}`
              : p.id === "ollama"
                ? "not running — start ollama, then press r"
                : "unreachable — press k to replace the key, or r to retry",
        });
      } else if (probe.models.length > list.length) {
        out.push({
          kind: "hint",
          provider: p,
          text: `…${probe.models.length - list.length} more · press m to type an id`,
        });
      }
    }
    return out;
  }, [probes]);

  // Land the cursor on the model already in use, so a returning user just
  // presses ⏎. Falling back to the first row instead would quietly hand them
  // a different model than the one they chose last time — the failure mode
  // being that it looks like it remembered when it did not.
  const [placed, setPlaced] = useState(false);
  useEffect(() => {
    if (placed) return;
    const saved = getActive();
    const mine = rows.findIndex(
      (r) => r.kind === "model" && r.provider.id === saved.provider && r.model === saved.model,
    );
    if (mine >= 0) {
      setCursor(mine);
      setPlaced(true);
      return;
    }
    // The saved model may belong to a provider that has not answered yet, so
    // the first row is only provisional — locking it in here is how you end
    // up on Ollama's first model when Anthropic was what you picked.
    const first = rows.findIndex((r) => r.kind === "model");
    if (first >= 0) setCursor(first);
    const settling = PROVIDERS.some((p) => (probes[p.id]?.state ?? "probing") === "probing");
    if (!settling && first >= 0) setPlaced(true);
  }, [rows, probes, placed]);

  const move = useCallback(
    (delta: number) => {
      setCursor((c) => {
        let i = c;
        for (let n = 0; n < rows.length; n++) {
          i = (i + delta + rows.length) % rows.length;
          if (selectable(rows[i])) return i;
        }
        return c;
      });
    },
    [rows],
  );

  const current = rows[Math.min(cursor, Math.max(0, rows.length - 1))];
  const currentProvider: Provider | undefined = current?.provider;

  const commit = useCallback(
    (sel: Selection) => {
      const cfg = loadConfig();
      const err = saveConfig({ ...cfg, provider: sel.provider, model: sel.model });
      if (err) setNote(`could not save your choice: ${err}`);
      reloadConfig();
      onStart(sel);
    },
    [onStart],
  );

  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      exit();
      return;
    }

    // ── key / model entry ───────────────────────────────────────────────────
    if (mode !== "list") {
      if (key.escape) {
        setMode("list");
        setBuffer("");
        return;
      }
      if (key.return) {
        const value = buffer.trim();
        setBuffer("");
        setMode("list");
        if (!currentProvider || value === "") return;
        if (mode === "key") {
          const cfg = loadConfig();
          const err = saveConfig({
            ...cfg,
            keys: { ...cfg.keys, [currentProvider.id]: value },
          });
          // Never echo the value — only that it landed, and where.
          setNote(err ? `could not save the key: ${err}` : `key saved to ${CONFIG_NOTE}`);
          reloadConfig();
          setRound((r) => r + 1);
        } else {
          commit({ provider: currentProvider.id, model: value });
        }
        return;
      }
      if (key.backspace || key.delete) {
        setBuffer((b) => b.slice(0, -1));
        return;
      }
      // Strip control characters so a stray escape sequence cannot end up
      // inside a saved credential.
      // biome-ignore lint/suspicious/noControlCharactersInRegex: filtering them is the point
      const clean = input.replace(/[\x00-\x1f\x7f]/g, "");
      if (clean) setBuffer((b) => b + clean);
      return;
    }

    // ── list ────────────────────────────────────────────────────────────────
    if (key.upArrow) return move(-1);
    if (key.downArrow || key.tab) return move(1);
    if (input === "q") {
      exit();
      return;
    }
    if (input === "r") {
      setNote(null);
      setProbes(
        Object.fromEntries(PROVIDERS.map((p) => [p.id, { state: "probing", models: [] } as Probe])),
      );
      setRound((n) => n + 1);
      return;
    }
    if (input === "k" && currentProvider?.needsKey) {
      setNote(null);
      setMode("key");
      return;
    }
    if (input === "x" && currentProvider?.needsKey) {
      const cfg = loadConfig();
      const { [currentProvider.id]: _dropped, ...rest } = cfg.keys;
      const err = saveConfig({ ...cfg, keys: rest });
      setNote(err ? `could not forget the key: ${err}` : `forgot the stored ${currentProvider.label} key`);
      reloadConfig();
      setRound((n) => n + 1);
      return;
    }
    if (input === "m" && currentProvider) {
      setNote(null);
      setMode("model");
      return;
    }
    if (key.return) {
      if (current?.kind === "model" && current.ready) {
        commit({ provider: current.provider.id, model: current.model });
      } else if (current?.provider.needsKey) {
        // ⏎ on a model we cannot reach asks for the credential rather than
        // starting a session that would fail three panes later.
        setNote(null);
        setMode("key");
      } else if (current?.kind === "model") {
        // Local, listed, and still unreachable — a key is not the problem.
        setNote(`${current.provider.label} is not responding — press r to recheck`);
      }
      return;
    }
  });

  // ── scrolling window ──────────────────────────────────────────────────────
  const saved = getActive();
  // Everything above the list: the greeting's art plus its border, the
  // padding, and the "choose a model" line. Written against MARK_ROWS rather
  // than as a bare number so that changing the mark's height cannot silently
  // push the bottom of this list off the screen.
  const viewport = Math.max(6, termRows - (MARK_ROWS + 3));
  const start = Math.max(0, Math.min(cursor - Math.floor(viewport / 2), rows.length - viewport));
  const visible = rows.slice(Math.max(0, start), Math.max(0, start) + viewport);

  return (
    <Box flexDirection="column" padding={1}>
      <Welcome
        lines={[
          "the agentic actuarial workstation — soft data → tools → hard data",
          "pick the model that will drive it, then drop a CSV in",
        ]}
      />

      <Box marginTop={1}>
        <Text color={theme.soft} bold>
          scelo
        </Text>
        <Text color={theme.mute}> · choose a model</Text>
      </Box>

      <Box marginTop={1} flexDirection="column">
        {visible.map((row, i) => {
          const idx = Math.max(0, start) + i;
          const on = idx === cursor;
          if (row.kind === "header") {
            const probe = probes[row.provider.id];
            return (
              <Box key={`h${idx}`} marginTop={i === 0 ? 0 : 1}>
                <Text color={accentFor(row.provider.id)} bold>
                  {row.provider.label}
                </Text>
                <Text color={theme.mute}> {row.provider.where}</Text>
                <Text color={statusColour(probe?.state)}> {statusText(probe)}</Text>
              </Box>
            );
          }
          const accent = accentFor(row.provider.id);
          return (
            <Box key={`r${idx}`}>
              <Text color={on ? accent : theme.mute}>{on ? "▸ " : "  "}</Text>
              {row.kind === "model" ? (
                <>
                  <Text color={row.ready ? (on ? accent : theme.fg) : theme.mute} bold={on}>
                    {row.model}
                  </Text>
                  {row.note && <Text color={theme.mute}> · {row.note}</Text>}
                  {row.provider.id === saved.provider && row.model === saved.model && (
                    <Text color={theme.ok}> · in use</Text>
                  )}
                  {/* What to do about it lives on the provider's hint row,
                      which is already on screen — this only has to say that
                      ⏎ will not start here. */}
                  {!row.ready && on && <Text color={theme.warn}> · unavailable</Text>}
                </>
              ) : row.spin ? (
                <Working label={row.text} color={accent} />
              ) : (
                <Text color={theme.mute}>{row.text}</Text>
              )}
            </Box>
          );
        })}
      </Box>

      {mode === "key" && currentProvider && (
        <Box marginTop={1} flexDirection="column">
          <Text color={theme.warn}>
            paste your {currentProvider.label} api key, then ⏎ · esc cancels
          </Text>
          <Box>
            <Text color={theme.mute}>› </Text>
            {/* Masked on the way in: this is a terminal, and terminals get
                screenshotted and screen-shared. */}
            <Text color={theme.fg}>{"•".repeat(buffer.length)}</Text>
            <Text color={theme.soft}>▌</Text>
          </Box>
          <Text color={theme.mute}>
            stored in {CONFIG_NOTE} (0600), never printed back
          </Text>
        </Box>
      )}

      {mode === "model" && currentProvider && (
        <Box marginTop={1} flexDirection="column">
          <Text color={theme.warn}>
            type a {currentProvider.label} model id, then ⏎ · esc cancels
          </Text>
          <Box>
            <Text color={theme.mute}>› </Text>
            <Text color={theme.fg}>{buffer}</Text>
            <Text color={theme.soft}>▌</Text>
          </Box>
        </Box>
      )}

      {note && (
        <Box marginTop={1}>
          <Text color={theme.ok}>{note}</Text>
        </Box>
      )}

      {cols < MIN_WIDTH && (
        <Box marginTop={1}>
          <Text color={theme.warn}>
            terminal is {cols} columns — the three-pane layout needs {MIN_WIDTH}. Widen it before
            starting.
          </Text>
        </Box>
      )}

      <Box marginTop={1}>
        <Text color={theme.mute}>
          ↑↓ move · ⏎ start · k api key · x forget key · m type an id · r recheck · q quit
        </Text>
      </Box>
    </Box>
  );
}

/** Shown instead of the absolute path, which is long and mostly noise. */
const CONFIG_NOTE = "~/.config/scelo-tui/config.json";

function accentFor(id: ProviderId): string {
  return id === "ollama" ? theme.soft : id === "anthropic" ? theme.tools : theme.hard;
}

function statusColour(state: Probe["state"] | undefined): string {
  if (state === "ready") return theme.ok;
  if (state === "probing" || state === undefined) return theme.mute;
  return theme.warn;
}

function statusText(probe: Probe | undefined): string {
  // Nothing here while probing: the row underneath is already spinning, and
  // two "checking" indicators per provider says it twice.
  if (!probe || probe.state === "probing") return "";
  if (probe.state === "ready") return probe.key ? `· ready · key ${probe.key}` : "· ready";
  if (probe.state === "nokey") return "· no key";
  return "· unreachable";
}
