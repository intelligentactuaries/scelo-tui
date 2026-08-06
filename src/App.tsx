// Three panes on one screen: soft | tools | hard, each with its own bot.
//
// Drop a file (or paste a path) and the whole pipeline runs unprompted; the
// panes fill in as each stage lands. Chat does not trigger work — it changes
// what the agent already decided.

import { relative } from "node:path";
import { SAMPLES, SAMPLE_BY_KEY, type ColumnMeta, type SampleKey, type SampleSpec } from "@scelo/core";
import { Box, Text, useApp, useInput } from "ink";
import { useCallback, useEffect, useRef, useState } from "react";
import { MODELS, resolveChoice } from "./agent/analyses";
import { activeLabel, llmAvailable } from "./agent/llm";
import {
  type PipelinePartial,
  type PipelineResult,
  type PipelineSource,
  type StageEvent,
  type StageId,
  runPipeline,
} from "./agent/pipeline";
import { type ExportOutcome, type ExportTarget, exportArtifacts, parseTarget } from "./export";
import { detectHost, hostLabel, performHandoff, performOpen, planFor } from "./export/handoff";
import { type LiveMirror, type LiveRun, createLiveMirror } from "./export/live";
import { slugify } from "./export/sce";
import { type ChatHandle, type ChoiceList, ChatView, useChat } from "./ui/Chat";
import { COMMAND_NAMES, helpText } from "./ui/commands";
import { isMouseReport, swallowingMouseBytes, useMouse } from "./ui/mouse";
import { paneWidths, useTerminalSize } from "./ui/size";
import { Spinner, Working } from "./ui/spinner";
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

/** What the header says while a run is in flight. Naming the live stage
 *  rather than cycling a decorative word means the animation carries real
 *  information: a run parked on "understanding the data" for 40s is the model
 *  being slow, which is a different problem from a stuck pipeline. */
const STAGE_GERUND: Record<StageId, string> = {
  ingest: "reading the file",
  clean: "cleaning",
  read: "understanding the data",
  pick: "choosing an analysis",
  run: "running the analysis",
};

function activeStageLabel(stages: Partial<Record<StageId, StageEvent>>): string {
  for (const id of Object.keys(STAGE_LABEL) as StageId[]) {
    if (stages[id]?.state === "active") return STAGE_GERUND[id];
  }
  return "working";
}

export function App({
  initialPath,
  onPath,
  onSettings,
}: {
  initialPath?: string;
  /** Reports the file that is loaded, so re-entering the picker and coming
   *  back re-runs on it rather than landing on an empty screen. */
  onPath?: (path: string) => void;
  /** Back to the model picker. */
  onSettings?: () => void;
}) {
  const { exit } = useApp();
  const { cols, rows } = useTerminalSize();

  const [focus, setFocus] = useState<Focus>("soft");
  const [stages, setStages] = useState<Partial<Record<StageId, StageEvent>>>({});
  const [pipe, setPipe] = useState<PipelineResult | null>(null);
  const [running, setRunning] = useState(false);
  const [runStart, setRunStart] = useState<number | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const started = useRef(false);

  // Full-bleed thirds: the three widths sum to exactly `cols`, remainder
  // absorbed by the HARD pane, so the borders reach the screen edge instead
  // of leaving a dead strip on the right.
  const { paneW, lastW } = paneWidths(cols);
  // Content width, not pane width: the Pane draws a border (1 col each side)
  // AND paddingX={1} (1 more each side). Getting this wrong makes every
  // full-width rule wrap onto a second line. Shared by all three panes —
  // HARD is at most 2 columns wider than its content needs, invisibly.
  const inner = paneW - 4;

  // Click anywhere in a column to type there. Deliberately mapped on the
  // column alone rather than on the pane's exact rectangle: the panes tile
  // the width, so every click has an unambiguous answer, and clicking the
  // header or the hint line under a pane does the thing you meant rather
  // than nothing.
  // The one click target that is not focus: the header's export tag. Row 1
  // is the only row whose meaning is position-independent (Ink draws the
  // header first), which is what makes it safe to bind an action to.
  const exportClick = useRef<(() => void) | null>(null);
  useMouse(
    useCallback(
      ({ column, row }: { column: number; row: number }) => {
        if (row <= 1 && exportClick.current) {
          exportClick.current();
          return;
        }
        const i = Math.min(ORDER.length - 1, Math.max(0, Math.floor((column - 1) / paneW)));
        setFocus(ORDER[i]);
      },
      [paneW],
    ),
  );
  exportClick.current = pipe?.result ? () => doExport(undefined, active) : null;

  // Detected once: the hosting terminal cannot change mid-process, and the
  // detection probes PATH, which is not free. Declared before `start`
  // because the live mirror (below) plans its file layout from it.
  const host = useRef(detectHost()).current;

  // ── the live mirror (/live) ─────────────────────────────────────────────
  // Opt-in: the TUI is a guest in somebody's directory and does not write
  // files unasked. Once armed, every pipeline milestone rewrites
  // <stem>_live.R / <stem>_live.ipynb (+ the cleaned csv) so RStudio can
  // source() and Jupyter can reload WHILE the session is still moving.
  // All refs: nothing here renders — the chat narrates instead.
  const liveEnabled = useRef(false);
  const liveMirror = useRef<LiveMirror | null>(null);
  const liveStem = useRef<string | null>(null);
  const liveRuns = useRef<LiveRun[]>([]);

  const stemOf = (name: string) => slugify(name.replace(/\.(csv|tsv|txt|parquet)$/i, ""));

  /** Rewrite the live files from the current state. Failures disarm the
   *  mirror and surface once in the banner — a full disk must not turn
   *  every later stage into a crash. */
  const liveUpdate = useCallback(
    (
      state: Pick<PipelineResult, "dataset" | "metas" | "clean" | "reading">,
      inProgress: boolean,
    ) => {
      if (!liveEnabled.current) return;
      try {
        const stem = stemOf(state.dataset.name);
        if (!liveMirror.current || liveStem.current !== stem) {
          liveMirror.current = createLiveMirror({ stem, ...planFor(host) });
          liveStem.current = stem;
        }
        liveMirror.current.update({ ...state, runs: liveRuns.current, inProgress });
      } catch (e) {
        liveEnabled.current = false;
        liveMirror.current = null;
        setBanner(
          `live mirror failed: ${e instanceof Error ? e.message : String(e)} — /live to re-arm`,
        );
      }
    },
    [host],
  );

  const start = useCallback(
    async (source: PipelineSource) => {
      if (running) return;
      setRunning(true);
      setRunStart(Date.now());
      setStages({});
      setPipe(null);
      setBanner(null);
      // A fresh dataset starts a fresh live story — the mirror's run list
      // must not carry sections from the previous file.
      liveRuns.current = [];
      // Only a real path is worth remembering for the picker round-trip — a
      // sample rebuilds from its key, and re-running it after a model switch
      // is a fresh build anyway.
      if (typeof source === "string") onPath?.(source);
      const r = await runPipeline(
        source,
        (e) => setStages((s) => ({ ...s, [e.stage]: e })),
        // Cleaned data + profile exist here, before the slow LLM stages —
        // the live mirror's whole reason to exist: RStudio/Jupyter get the
        // data while the model is still thinking.
        (p: PipelinePartial) => liveUpdate({ ...p, reading: "" }, true),
      );
      setRunning(false);
      setRunStart(null);
      if (!r.ok) setBanner(r.error);
      else {
        setPipe(r.value);
        if (r.value.chosen && r.value.result) {
          liveRuns.current = [
            {
              id: r.value.chosen.id,
              label: r.value.chosen.label,
              rationale: r.value.rationale,
            },
          ];
        }
        liveUpdate(r.value, false);
      }
    },
    [running, onPath, liveUpdate],
  );

  // Auto-run a path given on the command line — from an effect, not from
  // render. `start` reports the path upward so re-entering the picker can
  // come back to it, and a parent setState during a child's render is a
  // React error, not a style preference.
  useEffect(() => {
    if (!initialPath || started.current) return;
    started.current = true;
    void start(initialPath);
  }, [initialPath, start]);

  // ── deterministic intents ───────────────────────────────────────────────
  // Slash commands (and their unambiguous bare forms) are handled locally,
  // never sent to the model. Two reasons: they are ACTIONS, and asking an
  // LLM to maybe perform an action is how "export my work" becomes a
  // paragraph about exporting; and they must keep working when the model is
  // down — the app degrades to "no prose", never to "no controls".

  const exporting = useRef(false);
  // What /open resolves names against — the most recent export.
  const lastExport = useRef<ExportOutcome | null>(null);

  const doExport = useCallback(
    (targets: ExportTarget[] | undefined, chat: ChatHandle) => {
      if (!pipe) {
        chat.say("nothing to export yet — drop a dataset in first");
        return;
      }
      if (exporting.current) {
        chat.say("an export is already running");
        return;
      }
      exporting.current = true;
      chat.say(targets?.length ? `exporting ${targets.join(", ")}…` : "exporting everything…");
      // Let the line above paint before the synchronous file writes start.
      setTimeout(() => {
        try {
          const plan = planFor(host);
          const outcome = exportArtifacts(pipe, { targets, ...plan });
          lastExport.current = outcome;
          const rel = relative(process.cwd(), outcome.dir);
          const where =
            outcome.layout === "flat"
              ? rel === ""
                ? "into this directory"
                : `into ${rel}/`
              : `→ ${rel || outcome.dir}/`;
          const hand = performHandoff(host, outcome);
          const lines = [
            `${outcome.files.length} file${outcome.files.length === 1 ? "" : "s"} ${where}`,
            outcome.files.map((f) => f.name).join(" · "),
          ];
          if (hand.opened.length > 0) lines.push(`opened: ${hand.opened.join(" · ")}`);
          if (hand.hint) lines.push(hand.hint);
          if (host.kind === "plain") {
            lines.push("open the .sce in the Scelo IDE; the scripts read the exported csv");
          }
          chat.say(lines.join("\n"));
        } catch (e) {
          chat.say(`export failed: ${e instanceof Error ? e.message : String(e)}`);
        } finally {
          exporting.current = false;
        }
      }, 0);
    },
    [pipe, host],
  );

  /** The bundled samples, as a list you arrow through. Built per-chat so
   *  picking one can narrate into the pane it was picked from. */
  const sampleChoices = useCallback(
    (chat: ChatHandle): ChoiceList => ({
      title: "the IDE's bundled samples",
      items: SAMPLES.map((s, i) => ({
        id: s.key,
        label: `${i + 1}. ${s.title}`,
        hint: `${s.rows}×${s.cols} · ${s.subtitle}`,
      })),
      onPick: (c) => {
        const spec = SAMPLE_BY_KEY.get(c.id as SampleKey);
        if (!spec) return;
        if (running) {
          chat.say("a run is already in progress — wait for it to finish");
          return;
        }
        chat.say(`loading ${spec.title} (${spec.rows}×${spec.cols})`);
        void start({ dataset: spec.build() });
      },
    }),
    [start, running],
  );

  /** The analyses that apply to the loaded data, same widget. */
  const analysisChoices = useCallback(
    (chat: ChatHandle, eligible: typeof MODELS): ChoiceList => ({
      title: "analyses that apply to this data",
      items: eligible.map((m, i) => ({
        id: m.id,
        label: `${i + 1}. ${m.label}`,
        hint: m.id === pipe?.chosen?.id ? "current" : undefined,
      })),
      onPick: (c) => {
        const model = eligible.find((m) => m.id === c.id);
        if (!model || !pipe) return;
        try {
          const result = model.run(pipe.dataset, pipe.metas);
          const next = { ...pipe, chosen: model, rationale: "switched by you in chat", result };
          setPipe(next);
          liveRuns.current.push({ id: model.id, label: model.label, rationale: next.rationale });
          liveUpdate(next, false);
          chat.say(`running ${model.label} — the HARD pane has the result`);
        } catch (e) {
          chat.say(`${model.label} failed: ${e instanceof Error ? e.message : String(e)}`);
        }
      },
    }),
    [pipe, liveUpdate],
  );

  /** All three bots share one intent set — an actuary mid-thought should not
   *  have to remember which pane a command belongs to. Returns null when the
   *  text is conversation, which falls through to the model. */
  const handleIntent = useCallback(
    (text: string, chat: ChatHandle): string | null => {
      const slash = text.startsWith("/");
      const words = (slash ? text.slice(1) : text).trim().split(/\s+/);
      const verb = (words[0] ?? "").toLowerCase();
      const args = words.slice(1);
      const eligible = pipe ? MODELS.filter((m) => m.applies(pipe.metas)) : [];

      // "load example data", "/example", "load the claims sample" — the
      // IDE's bundled samples, offered as a numbered menu. `load` is only
      // claimed when the sentence is actually about samples; "load my
      // broker file" falls through to path handling and the model.
      const exampleVerb = ["example", "examples", "sample", "samples", "demo", "demos"];
      if (exampleVerb.includes(verb) || (verb === "load" && args.some((w) => exampleVerb.includes(w.toLowerCase().replace(/[^a-z]/g, ""))))) {
        const filler = new Set([...exampleVerb, "data", "dataset", "datasets", "the", "a", "an", "some", "please", "me"]);
        const query = args.filter((w) => !filler.has(w.toLowerCase().replace(/[^a-z]/g, ""))).join(" ");
        if (query === "") {
          chat.openChoices(sampleChoices(chat));
          return "";
        }
        const r = resolveSample(query);
        if (!r.ok) {
          // Ambiguous or unknown: offer the list rather than describing it.
          // Being handed a chooser beats being told what you could have typed.
          chat.openChoices(sampleChoices(chat));
          return r.matches.length > 1 ? `"${query}" matches several —` : `no sample matches "${query}" —`;
        }
        if (running) return "a run is already in progress — wait for it to finish";
        void start({ dataset: r.spec.build() });
        return `loading ${r.spec.title} (${r.spec.rows}×${r.spec.cols}) — the pipeline is running on it`;
      }

      const known = COMMAND_NAMES.includes(verb);
      if (!slash && !known) return null;
      // Bare forms are accepted only where misfiring is implausible:
      // "help"/"list" alone, and the imperatives "run X" / "export …".
      // "show me the mean…" and "open questions…" are ordinary chat, so
      // those two require the slash.
      if (!slash && (verb === "show" || verb === "open")) return null;
      if (!slash && (verb === "help" || verb === "list") && args.length > 0) return null;
      if (!slash && verb === "run" && args.length === 0) return null;
      if (!known) {
        return `unknown command /${verb} — ${HELP}`;
      }

      switch (verb) {
        case "help":
          return HELP;
        case "list": {
          if (!pipe) return "no dataset loaded yet";
          chat.openChoices(analysisChoices(chat, eligible));
          return "";
        }
        case "run": {
          if (!pipe) return "no dataset loaded yet";
          if (args.length === 0) return "usage: /run <analysis or number> — /list shows the menu";
          const r = resolveChoice(args.join(" "), eligible);
          if (!r.ok) {
            return r.matches.length > 1
              ? `ambiguous — did you mean: ${r.matches.map((m) => m.label).join(" · ")}?`
              : `no analysis matches "${args.join(" ")}" — /list shows the menu`;
          }
          try {
            const result = r.model.run(pipe.dataset, pipe.metas);
            const next = { ...pipe, chosen: r.model, rationale: "switched by you in chat", result };
            setPipe(next);
            liveRuns.current.push({ id: r.model.id, label: r.model.label, rationale: next.rationale });
            liveUpdate(next, false);
            return `running ${r.model.label} — the HARD pane has the result`;
          } catch (e) {
            return `${r.model.label} failed: ${e instanceof Error ? e.message : String(e)}`;
          }
        }
        case "show": {
          if (!pipe) return "no dataset loaded yet";
          if (args.length === 0) return "usage: /show <column>";
          const q = args.join(" ").toLowerCase();
          const exact = pipe.metas.find((m) => m.name.toLowerCase() === q);
          const partial = pipe.metas.filter((m) => m.name.toLowerCase().includes(q));
          const meta = exact ?? (partial.length === 1 ? partial[0] : null);
          if (!meta) {
            return partial.length > 1
              ? `which one: ${partial.map((m) => m.name).join(" · ")}?`
              : `no column called "${args.join(" ")}"`;
          }
          return columnCard(meta);
        }
        case "export": {
          const targets: ExportTarget[] = [];
          for (const w of args) {
            const t = parseTarget(w);
            if (!t) return `don't know the format "${w}" — try excel, python, notebook, r, sce or csv`;
            targets.push(t);
          }
          doExport(targets.length > 0 ? targets : undefined, chat);
          // doExport speaks for itself (start + finish lines).
          return "";
        }
        case "live": {
          if ((args[0] ?? "").toLowerCase() === "off") {
            if (!liveEnabled.current) return "the live mirror is already off";
            liveEnabled.current = false;
            const f = liveMirror.current?.files();
            liveMirror.current = null;
            return f
              ? `live mirror off — ${f.r} and ${f.ipynb} stay as they are, no longer updated`
              : "live mirror off";
          }
          const already = liveEnabled.current;
          liveEnabled.current = true;
          // A session that already has results seeds the mirror with them —
          // arming late must not produce an emptier file than the screen.
          if (pipe) {
            if (liveRuns.current.length === 0 && pipe.chosen && pipe.result) {
              liveRuns.current = [
                { id: pipe.chosen.id, label: pipe.chosen.label, rationale: pipe.rationale },
              ];
            }
            liveUpdate(pipe, running);
          }
          if (!liveEnabled.current) return ""; // liveUpdate failed and said so in the banner
          const f = liveMirror.current?.files();
          const lines = [
            already ? "the live mirror is already on" : "live mirror on — updating as the session advances",
          ];
          if (f) {
            const where = relative(process.cwd(), f.dir);
            const prefix = host.kind === "rstudio" || !where ? "" : `${where}/`;
            lines.push(
              `RStudio: paste  source("${prefix}${f.watch}")  once — after that, every update runs itself in the console (scelo_watch_stop() to stop)`,
              `manual alternative: source("${prefix}${f.r}") re-runs the session on demand`,
              `Jupyter: /open notebook — reload when it offers "file changed on disk"`,
            );
          } else {
            lines.push("armed — drop a dataset in and the files follow it");
          }
          return lines.join("\n");
        }
        case "open": {
          const last = lastExport.current;
          // The live mirror's files stand in when nothing was /export-ed
          // yet — "/live then /open notebook" is the whole Jupyter flow.
          const live = liveEnabled.current ? liveMirror.current?.files() : undefined;
          if (!last && !live) return "nothing exported yet — /export (or /live) first";
          if (args.length === 0) {
            const dir = last?.dir ?? live?.dir;
            if (!dir) return "nothing exported yet — /export (or /live) first";
            const err = performOpen(dir, host);
            return err ?? `opening ${relative(process.cwd(), dir) || dir}/`;
          }
          const t = parseTarget(args[0]);
          if (!t) return `don't know "${args[0]}" — /open [excel|python|notebook|r|sce|csv]`;
          const suffix = { csv: "data.csv", py: ".py", ipynb: ".ipynb", r: ".R", xlsx: ".xlsx", sce: ".sce" }[t];
          const file = last?.files.find((f) => f.name.endsWith(suffix));
          if (file && last) {
            const err = performOpen(`${last.dir}/${file.name}`, host);
            return err ?? `opening ${file.name}`;
          }
          const liveName =
            live && (t === "ipynb" ? live.ipynb : t === "r" ? live.r : t === "csv" ? live.csv : null);
          if (live && liveName) {
            const err = performOpen(`${live.dir}/${liveName}`, host);
            return err ?? `opening ${liveName} (live — it updates as the session advances)`;
          }
          return last
            ? `the last export did not include ${t} — /export ${t} first`
            : `the live mirror has no ${t} — /export ${t} for that`;
        }
      }
      return null;
    },
    [pipe, doExport, start, running, sampleChoices, analysisChoices, liveUpdate],
  );

  // ── context each bot sees ───────────────────────────────────────────────
  // Rebuilt per send so a bot always reasons about the CURRENT state.
  const softCtx = useCallback(() => {
    const p = pipe;
    if (!p) return NO_DATA_CONTEXT("SOFT DATA");
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
    if (!p) return NO_DATA_CONTEXT("TOOLS");
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
    if (!p?.result) return NO_DATA_CONTEXT("HARD DATA");
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

  const softChat = useChat({ context: softCtx, onLocal: (t) => handleIntent(t, softChat) });
  const toolsChat = useChat({ context: toolsCtx, onLocal: (t) => handleIntent(t, toolsChat) });
  const hardChat = useChat({ context: hardCtx, onLocal: (t) => handleIntent(t, hardChat) });
  const chats = { soft: softChat, tools: toolsChat, hard: hardChat };
  const active = chats[focus];

  useInput((input, key) => {
    // A click arrives on stdin as an escape sequence, and Ink hands it to us
    // as if it were typing. Both guards are load-bearing: the flag catches it
    // however Ink chose to split the bytes up, the pattern catches a sequence
    // that reached us without the flag being set.
    if (swallowingMouseBytes() || isMouseReport(input)) return;
    if (key.ctrl && input === "c") {
      exit();
      return;
    }
    if (key.ctrl && input === "o" && onSettings) {
      onSettings();
      return;
    }
    if (key.ctrl && input === "e") {
      doExport(undefined, active);
      return;
    }
    // A pushed sub-list is modal: it owns every key except the ctrl-
    // shortcuts above and tab, which still moves panes. Typing filters it,
    // which is why printable input is swallowed here rather than reaching
    // the composer.
    if (active.choices) {
      if (key.upArrow) {
        active.choiceMove(-1);
        return;
      }
      if (key.downArrow) {
        active.choiceMove(1);
        return;
      }
      if (key.escape) {
        active.choiceBack();
        return;
      }
      if (key.return) {
        active.choiceAccept();
        return;
      }
      if (key.backspace || key.delete) {
        active.choiceBackspace();
        return;
      }
      if (!key.tab && input && !key.ctrl && !key.meta) {
        active.choiceType(input);
        return;
      }
    }
    // The `/` menu is a mode: while it is open the arrows, ⏎, tab and esc
    // belong to it. Checked before pane-switching so tab completes the
    // command rather than throwing you into the next pane mid-word.
    if (active.menu) {
      if (key.upArrow) {
        active.menuMove(-1);
        return;
      }
      if (key.downArrow) {
        active.menuMove(1);
        return;
      }
      if (key.escape) {
        active.menuDismiss();
        return;
      }
      if (key.return || key.tab) {
        active.menuAccept();
        return;
      }
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
          scelo tui · {activeLabel()} ·{" "}
        </Text>
        {running ? (
          <Working label={activeStageLabel(stages)} color={theme.soft} since={runStart} />
        ) : (
          <Text color={theme.mute}>{p ? "ready" : "waiting for data"}</Text>
        )}
        {p?.result && !running && (
          <Text color={theme.ok}>
            {" "}
            · ⇩ export{host.kind === "plain" ? "" : ` → ${hostLabel(host)}`} (click here or
            ctrl-e)
          </Text>
        )}
      </Box>

      {banner && (
        <Box>
          <Text color={theme.err}>{banner}</Text>
        </Box>
      )}

      {/* A definite height is what makes the composers line up: `flexGrow`
          inside each pane can only push the input to the bottom if there is
          a known bottom to push it to. Header + optional banner + footer are
          the rows this row does not get. */}
      <Box height={Math.max(12, rows - (banner ? 3 : 2))}>
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
              <Text color={theme.mute}>paste its path below and press ⏎,</Text>
              <Text color={theme.mute}>or type /example for the IDE's sample data</Text>
            </Box>
          )}
          <ChatView chat={softChat} width={inner} accent={theme.soft} focused={focus === "soft"} />
        </Pane>

        {/* ── TOOLS ── */}
        <Pane title="TOOLS · models" accent={theme.tools} focused={focus === "tools"} width={paneW}>
          <Head>pipeline</Head>
          {(Object.keys(STAGE_LABEL) as StageId[]).map((id) => {
            const st = stages[id];
            // The live stage pulses; every other state is a settled glyph. So
            // the one line that is still moving is the one still working.
            const mark =
              st?.state === "done"
                ? "✓"
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
                {st?.state === "active" ? <Spinner color={theme.tools} /> : mark} {STAGE_LABEL[id]}
                {st?.detail ? <Text color={theme.mute}> · {st.detail}</Text> : null}
              </Text>
            );
          })}
          {p?.chosen && (
            <>
              <Head>chosen</Head>
              <Text color={theme.tools}>{p.chosen.label}</Text>
              <Prose text={p.rationale} width={inner} maxLines={4} color={theme.mute} />
              <Text color={theme.mute}>/run to change · /list for the menu</Text>
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
        <Pane title="HARD · output" accent={theme.hard} focused={focus === "hard"} width={lastW}>
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
                    // Row labels only when the series IS the rows — the
                    // concentration analysis plots ten deciles against a
                    // four-row table, and borrowing its labels would caption
                    // decile 1 as "top 1%".
                    labels={
                      p.result.series.values.length === p.result.rows.length
                        ? p.result.rows.map((r) => String(r[0]))
                        : undefined
                    }
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
        <Text color={theme.mute}>
          click/tab pane · ⏎ send (or paste a path) · /help commands · ctrl-e export · ctrl-o
          model · ctrl-c quit
        </Text>
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

/**
 * What a bot is told when there is nothing to talk about yet.
 *
 * The thin version of this ("no dataset is loaded; say so") produced the
 * worst failure this app has had: shown a sample menu in its replayed
 * history, then a bare "2", a capable model announced it had loaded the
 * climate ensemble and printed a schema card for it — confidently, and
 * entirely invented. `historyFor` now keeps app output out of the model's
 * mouth; this closes the other half by making the boundary explicit rather
 * than implied. An assistant that cannot act has to be TOLD it cannot act,
 * or it will narrate the action instead.
 */
const NO_DATA_CONTEXT = (pane: string) =>
  [
    `You are the ${pane} assistant in an actuarial terminal workstation.`,
    "",
    "NO DATASET IS LOADED. You have no data, no columns, no rows, no numbers.",
    "",
    "You cannot load, open, read or fetch anything — only the app can, and",
    "only when the user runs a command. Never say or imply that you have",
    "loaded or received data. Never invent a schema, column list, row count,",
    "summary or result. If asked to analyse or proceed, say plainly that",
    "nothing is loaded yet and point at the commands below.",
    "",
    "How the user loads data:",
    "  /example        list the bundled sample datasets",
    "  /example 2      load one by number (a bare number works after the list)",
    "  or drag a CSV onto the window, or paste its path and press enter",
    "",
    "Be terse — 3 lines max.",
  ].join("\n");

const HELP = helpText();

/** Resolve "/example <what>" by menu number, key, or a title/subtitle
 *  fragment. Ambiguity is reported, not guessed — same contract as
 *  resolveChoice for analyses. */
function resolveSample(
  what: string,
): { ok: true; spec: SampleSpec } | { ok: false; matches: SampleSpec[] } {
  const q = what.trim().toLowerCase();
  const n = Number(q);
  if (Number.isInteger(n) && n >= 1 && n <= SAMPLES.length) {
    return { ok: true, spec: SAMPLES[n - 1] };
  }
  const exact = SAMPLES.find((s) => s.key === q);
  if (exact) return { ok: true, spec: exact };
  const partial = SAMPLES.filter(
    (s) =>
      s.key.includes(q) ||
      s.title.toLowerCase().includes(q) ||
      s.subtitle.toLowerCase().includes(q),
  );
  if (partial.length === 1) return { ok: true, spec: partial[0] };
  return { ok: false, matches: partial };
}

/** One column, as a card — the fastest answer the SOFT bot can give, and
 *  the only one that stays available when the model is down. */
function columnCard(m: ColumnMeta): string {
  const lines = [
    `\`${m.name}\` — ${m.type}`,
    `n=${(m.count - m.missing).toLocaleString()} · missing=${m.missing.toLocaleString()} · unique=${m.unique.toLocaleString()}`,
  ];
  if (m.type === "number" && m.min !== undefined) {
    lines.push(`min=${fmtCell(m.min)} · median=${fmtCell(m.median)} · mean=${fmtCell(m.mean)} · max=${fmtCell(m.max)}`);
    if (m.quintiles) {
      lines.push(`p20=${fmtCell(m.quintiles[0])} · p40=${fmtCell(m.quintiles[1])} · p60=${fmtCell(m.quintiles[2])} · p80=${fmtCell(m.quintiles[3])}`);
    }
  }
  if (m.type === "date") lines.push(`${m.dateMin ?? "?"} → ${m.dateMax ?? "?"}`);
  if (m.type === "string" && m.topValues?.length) {
    lines.push(`top: ${m.topValues.slice(0, 5).map((t) => `${t.value} (${t.count})`).join(" · ")}`);
  }
  return lines.join("\n");
}

function fmtCell(n: number | undefined): string {
  if (n === undefined || !Number.isFinite(n)) return "—";
  const a = Math.abs(n);
  if (a >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
  return String(Math.round(n * 100) / 100);
}

export { llmAvailable };
