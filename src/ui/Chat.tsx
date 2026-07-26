// Per-pane chatbot.
//
// Three of these live on screen at once, so the component is deliberately
// cheap: a bounded scrollback, no markdown rendering, and streaming appended
// to a single string rather than a growing list of nodes. Ink re-renders the
// whole tree on every state change, and three panes streaming tokens
// simultaneously is exactly where that becomes visible as flicker.

import { Box, Text } from "ink";
import { useCallback, useRef, useState } from "react";
import { type LlmMessage, stream } from "../agent/llm";
import { theme } from "./theme";
import { Prose } from "./widgets";

export type Turn = { role: "you" | "bot"; text: string };

/** Turns kept per pane. The panes are short, and an unbounded transcript in
 *  three simultaneous streams is the fastest way to make Ink stutter. */
const MAX_TURNS = 12;

export type ChatHandle = {
  turns: Turn[];
  draft: string;
  busy: boolean;
  setDraft: (s: string) => void;
  submit: () => void;
  /** Push a turn without calling the model — used by the pipeline to narrate
   *  itself into the pane it belongs to. */
  say: (text: string) => void;
};

export function useChat(args: {
  /** Stage framing plus whatever the pipeline currently knows. Recomputed on
   *  every send so the bot always sees the CURRENT dataset, not the one that
   *  was loaded when the pane mounted. */
  context: () => string;
  /** Deterministic intents handled locally; return a reply to skip the model. */
  onLocal?: (text: string) => string | null;
}): ChatHandle {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const abort = useRef<AbortController | null>(null);

  const say = useCallback((text: string) => {
    setTurns((t) => [...t, { role: "bot" as const, text }].slice(-MAX_TURNS));
  }, []);

  const submit = useCallback(() => {
    const text = draft.trim();
    if (!text || busy) return;
    setDraft("");
    setTurns((t) => [...t, { role: "you" as const, text }].slice(-MAX_TURNS));

    const local = args.onLocal?.(text);
    if (local != null) {
      setTurns((t) => [...t, { role: "bot" as const, text: local }].slice(-MAX_TURNS));
      return;
    }

    setBusy(true);
    setTurns((t) => [...t, { role: "bot" as const, text: "" }].slice(-MAX_TURNS));
    const ac = new AbortController();
    abort.current = ac;
    const msgs: LlmMessage[] = [
      { role: "system", content: args.context() },
      { role: "user", content: text },
    ];
    void (async () => {
      let acc = "";
      try {
        for await (const piece of stream(msgs, { signal: ac.signal, maxTokens: 320 })) {
          acc += piece;
          // Replace the trailing empty bot turn as tokens arrive.
          setTurns((t) => {
            const next = t.slice();
            next[next.length - 1] = { role: "bot" as const, text: acc };
            return next;
          });
        }
        if (acc.trim() === "") {
          setTurns((t) => {
            const next = t.slice();
            next[next.length - 1] = { role: "bot" as const, text: "(the model returned nothing)" };
            return next;
          });
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setTurns((t) => {
          const next = t.slice();
          next[next.length - 1] = { role: "bot" as const, text: `error: ${msg}` };
          return next;
        });
      } finally {
        setBusy(false);
        abort.current = null;
      }
    })();
  }, [draft, busy, args, say]);

  return { turns, draft, busy, setDraft, submit, say };
}

export function ChatView({
  chat,
  width,
  accent,
  focused,
  lines = 6,
}: {
  chat: ChatHandle;
  width: number;
  accent: string;
  focused: boolean;
  lines?: number;
}) {
  // Show the tail — the most recent exchange is what matters in a pane this
  // short, and scrollback would need its own key handling.
  const recent = chat.turns.slice(-4);
  return (
    <Box flexDirection="column" marginTop={1}>
      <Box>
        <Text color={theme.chrome}>{"─".repeat(Math.max(0, width))}</Text>
      </Box>
      <Box flexDirection="column" minHeight={lines}>
        {recent.length === 0 ? (
          <Text color={theme.mute}>ask to change what the agent decided…</Text>
        ) : (
          recent.map((t, i) => (
            <Box key={i} flexDirection="column">
              <Text color={t.role === "you" ? theme.you : accent}>
                {t.role === "you" ? "you" : "scelo"}
              </Text>
              <Prose
                text={t.text || (chat.busy && i === recent.length - 1 ? "…" : "")}
                width={width}
                maxLines={4}
              />
            </Box>
          ))
        )}
      </Box>
      <Box>
        <Text color={focused ? accent : theme.mute}>{focused ? "› " : "  "}</Text>
        <Text color={focused ? theme.fg : theme.mute}>
          {chat.draft || (focused ? "" : "")}
        </Text>
        {focused && !chat.busy && <Text color={accent}>▌</Text>}
        {chat.busy && <Text color={theme.mute}>working…</Text>}
      </Box>
    </Box>
  );
}
