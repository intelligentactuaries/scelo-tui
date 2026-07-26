// Three panes on one screen: soft | tools | hard, each with its own bot.
//
// Drop a file (or paste a path) and the whole pipeline runs unprompted; the
// panes fill in as each stage lands. Chat does not trigger work — it changes
// what the agent already decided.

import { Box, Text, useApp, useInput, useStdout } from "ink";
import { useCallback, useRef, useState } from "react";
import { MODEL, llmAvailable } from "./agent/llm";
import { type PipelineResult, type StageEvent, type StageId, runPipeline } from "./agent/pipeline";
import { ChatView, useChat } from "./ui/Chat";
import { MIN_HEIGHT, MIN_WIDTH, theme } from "./ui/theme";
import { BarPlot, Head, Pane, Prose, Table } from "./ui/widgets";

type Focus = "soft" | "tools" | "hard";
const ORDER: Focus[] = ["soft", "tools", "hard"];

const STAGE_LABEL: Record<StageId, string> = {
  ingest: "read file",
  clean: "auto-clean",
  read: "understand",
  pick: "choose analysis",
  run: "run",
};

export function App({ initialPath }: { initialPath?: string }) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const cols = stdout?.columns ?? 80;
  const rows = stdout?.rows ?? 24;

  const [focus, setFocus] = useState<Focus>("soft");
  const [stages, setStages] = useState<Partial<Record<StageId, StageEvent>>>({});
  const [pipe, setPipe] = useState<PipelineResult | null>(null);
  const [running, setRunning] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const started = useRef(false);

  const paneW = Math.max(20, Math.floor((cols - 8) / 3));
  // Content width, not pane width: the Pane draws a border (1 col each side)
  // AND paddingX={1} (1 more each side). Getting this wrong makes every
  // full-width rule wrap onto a second line.
  const inner = paneW - 4;

  const start = useCallback(
    async (path: string) => {
      if (running) return;
      setRunning(true);
      setStages({});
      setPipe(null);
      setBanner(null);
      const r = await runPipeline(path, (e) =>
        setStages((s) => ({ ...s, [e.stage]: e })),
      );
      setRunning(false);
      if (!r.ok) setBanner(r.error);
      else setPipe(r.value);
    },
    [running],
  );

  // Auto-run a path given on the command line.
  if (initialPath && !started.current) {
    started.current = true;
    void start(initialPath);
  }

  // ── context each bot sees ───────────────────────────────────────────────
  // Rebuilt per send so a bot always reasons about the CURRENT state.
  const softCtx = useCallback(() => {
    const p = pipe;
    if (!p) return "You are the SOFT DATA assistant. No dataset is loaded yet; say so.";
    return [
      "You are the SOFT DATA assistant in an actuarial terminal workstation.",
      "Answer only from the profile below. Never invent columns or numbers. Be terse — 4 lines max.",
      "",
      `file: ${p.dataset.name}  (${p.dataset.rows.length} rows x ${p.dataset.columns.length} cols)`,
      `cleaning: ${p.clean ? `${p.clean.outcome}, ${p.clean.passes.length} passes` : "none"}`,
      `dropped columns: ${p.clean?.droppedColumns.join(", ") || "none"}`,
      "columns:",
      ...p.metas.map(
        (m) => `  ${m.name}: ${m.type}, unique=${m.unique}, missing=${m.missing}`,
      ),
    ].join("\n");
  }, [pipe]);

  const toolsCtx = useCallback(() => {
    const p = pipe;
    if (!p) return "You are the TOOLS assistant. Nothing has been analysed yet; say so.";
    return [
      "You are the TOOLS assistant. You explain and revise the agent's choice of analysis.",
      "Be terse — 4 lines max. Never claim to have run anything.",
      "",
      `chosen: ${p.chosen?.label ?? "none"}`,
      `why: ${p.rationale}`,
      `dataset: ${p.dataset.name}, ${p.dataset.rows.length} rows`,
    ].join("\n");
  }, [pipe]);

  const hardCtx = useCallback(() => {
    const p = pipe;
    if (!p?.result) return "You are the HARD DATA assistant. No results yet; say so.";
    return [
      "You are the HARD DATA assistant. You interpret the result table below.",
      "Answer only from it. Be terse — 4 lines max.",
      "",
      `analysis: ${p.chosen?.label}`,
      `headline: ${p.result.headline}`,
      p.result.columns.join(" | "),
      ...p.result.rows.slice(0, 12).map((r) => r.join(" | ")),
    ].join("\n");
  }, [pipe]);

  const softChat = useChat({ context: softCtx });
  const toolsChat = useChat({ context: toolsCtx });
  const hardChat = useChat({ context: hardCtx });
  const chats = { soft: softChat, tools: toolsChat, hard: hardChat };
  const active = chats[focus];

  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      exit();
      return;
    }
    if (key.tab) {
      setFocus((f) => ORDER[(ORDER.indexOf(f) + 1) % ORDER.length]);
      return;
    }
    if (key.return) {
      const text = active.draft.trim();
      // A bare path typed or dragged into any pane starts a run — that is the
      // "drop a file in" gesture, and it should work from wherever you are.
      if (looksLikePath(text)) {
        active.setDraft("");
        void start(text);
        return;
      }
      active.submit();
      return;
    }
    if (key.backspace || key.delete) {
      active.setDraft(active.draft.slice(0, -1));
      return;
    }
    if (input && !key.ctrl && !key.meta && !key.escape) active.setDraft(active.draft + input);
  });

  if (cols < MIN_WIDTH || rows < MIN_HEIGHT) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color={theme.warn}>Terminal too small for the three-pane layout.</Text>
        <Text color={theme.mute}>
          {cols}x{rows} — needs at least {MIN_WIDTH}x{MIN_HEIGHT}. Widen the window.
        </Text>
      </Box>
    );
  }

  const p = pipe;

  return (
    <Box flexDirection="column">
      <Box>
        <Text color={theme.mute}>
          scelo tui · {MODEL} · {running ? "running…" : p ? "ready" : "waiting for data"}
        </Text>
      </Box>

      {banner && (
        <Box>
          <Text color={theme.err}>{banner}</Text>
        </Box>
      )}

      <Box>
        {/* ── SOFT ── */}
        <Pane title="SOFT · data" accent={theme.soft} focused={focus === "soft"} width={paneW}>
          <Head>file(s)</Head>
          {p ? (
            <>
              <Text>
                <Text color={theme.soft}>└ </Text>
                {p.dataset.name}
              </Text>
              <Text color={theme.mute}>
                {"  "}
                {p.dataset.rows.length.toLocaleString()} rows × {p.dataset.columns.length} cols
              </Text>
              <Head>summary</Head>
              <Text color={theme.mute}>
                {p.clean && p.clean.passes.length > 0
                  ? `cleaned: ${p.clean.passes.reduce((n, x) => n + x.opLabels.length, 0)} steps / ${p.clean.passes.length} passes`
                  : "already clean"}
              </Text>
              {p.clean && p.clean.droppedColumns.length > 0 && (
                <Text color={theme.warn}>dropped: {p.clean.droppedColumns.join(", ")}</Text>
              )}
              <Box marginTop={1}>
                <Prose
                  text={p.reading || p.degraded || "(no reading)"}
                  width={inner}
                  maxLines={Math.max(4, rows - 24)}
                  color={p.reading ? theme.fg : theme.mute}
                />
              </Box>
            </>
          ) : (
            <Box flexDirection="column" marginTop={1}>
              <Text color={theme.mute}>drag a CSV onto this window,</Text>
              <Text color={theme.mute}>or paste its path below and press ⏎</Text>
            </Box>
          )}
          <ChatView chat={softChat} width={inner} accent={theme.soft} focused={focus === "soft"} />
        </Pane>

        {/* ── TOOLS ── */}
        <Pane title="TOOLS · models" accent={theme.tools} focused={focus === "tools"} width={paneW}>
          <Head>pipeline</Head>
          {(Object.keys(STAGE_LABEL) as StageId[]).map((id) => {
            const st = stages[id];
            const mark =
              st?.state === "done"
                ? "✓"
                : st?.state === "active"
                  ? "◈"
                  : st?.state === "failed"
                    ? "✕"
                    : st?.state === "skipped"
                      ? "–"
                      : "·";
            const col =
              st?.state === "done"
                ? theme.ok
                : st?.state === "failed"
                  ? theme.err
                  : st?.state === "active"
                    ? theme.tools
                    : theme.mute;
            return (
              <Text key={id} color={col}>
                {mark} {STAGE_LABEL[id]}
                {st?.detail ? <Text color={theme.mute}> · {st.detail}</Text> : null}
              </Text>
            );
          })}
          {p?.chosen && (
            <>
              <Head>chosen</Head>
              <Text color={theme.tools}>{p.chosen.label}</Text>
              <Prose text={p.rationale} width={inner} maxLines={4} color={theme.mute} />
            </>
          )}
          <ChatView
            chat={toolsChat}
            width={inner}
            accent={theme.tools}
            focused={focus === "tools"}
          />
        </Pane>

        {/* ── HARD ── */}
        <Pane title="HARD · output" accent={theme.hard} focused={focus === "hard"} width={paneW}>
          {p?.result ? (
            <>
              <Head>table</Head>
              <Text color={theme.hard}>{p.result.headline}</Text>
              <Box marginTop={1}>
                <Table columns={p.result.columns} rows={p.result.rows} width={inner} maxRows={5} />
              </Box>
              {p.result.series && (
                <>
                  <Head>plot</Head>
                  <Text color={theme.mute}>{p.result.series.label}</Text>
                  <BarPlot
                    values={p.result.series.values}
                    labels={p.result.rows.map((r) => String(r[0]))}
                    width={inner}
                    color={theme.hard}
                    max={5}
                  />
                </>
              )}
            </>
          ) : (
            <Box marginTop={1}>
              <Text color={theme.mute}>no output yet</Text>
            </Box>
          )}
          <ChatView chat={hardChat} width={inner} accent={theme.hard} focused={focus === "hard"} />
        </Pane>
      </Box>

      <Box>
        <Text color={theme.mute}>tab switch pane · ⏎ send (or paste a path to load) · ctrl-c quit</Text>
      </Box>
    </Box>
  );
}

/** A typed/pasted line that is a file path rather than a question. Kept
 *  narrow: it must not swallow a genuine question that happens to contain a
 *  slash, so it requires a data-file extension. */
function looksLikePath(s: string): boolean {
  return /\.(csv|tsv|txt)['"]?$/i.test(s.trim()) && !/\s\?$/.test(s);
}

export { llmAvailable };
