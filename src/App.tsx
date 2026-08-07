// Three panes on one screen: soft | tools | hard, each with its own bot.
//
// Drop a file (or paste a path) and the whole pipeline runs unprompted; the
// panes fill in as each stage lands. Chat does not trigger work — it changes
// what the agent already decided.

import { basename, relative } from "node:path";
import { SAMPLES, SAMPLE_BY_KEY, type ColumnMeta, type SampleKey, type SampleSpec } from "@scelo/core";
import { Box, Text, useApp, useInput, usePaste } from "ink";
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
import {
  type ExportOutcome,
  type ExportTarget,
  exportArtifacts,
  parseTarget,
  parseTargets,
} from "./export";
import { detectHost, hostLabel, performHandoff, performOpen, planFor } from "./export/handoff";
import { type LiveMirror, type LiveRun, createLiveMirror } from "./export/live";
import { slugify } from "./export/sce";
import { type ChatHandle, type ChoiceList, ChatView, useChat } from "./ui/Chat";
import { COMMAND_NAMES, helpText } from "./ui/commands";
import { type DataFileListing, fmtBytes, fmtWhen, listDataFiles } from "./core/files";
import {
  dropInsertText,
  extractDataPath,
  looksLikeFileContents,
  normaliseDroppedPath,
} from "./core/ingest";
import { flattenPaste } from "./ui/paste";
import { Welcome } from "./ui/Mascot";
import {
  isMouseFragment,
  isMouseReport,
  mouseActive,
  setMouseActive,
  stripMouseNoise,
  swallowingMouseBytes,
  useMouse,
  usePasteDeadlockHatch,
} from "./ui/mouse";
import {
  MIN_PANE_ROWS,
  chatLines,
  chatRows,
  isPortrait,
  paneHeights,
  paneWidths,
  useTerminalSize,
} from "./ui/size";
import { Spinner, Working } from "./ui/spinner";
import {
  STACK_MIN_HEIGHT,
  STACK_MIN_WIDTH,
  WIDE_MIN_HEIGHT,
  WIDE_MIN_WIDTH,
  theme,
} from "./ui/theme";
import { fanIn, fanOut } from "./ui/diagram";
import { CHART_LIST_TOP, ChartScreen, chartListWidth } from "./ui/ChartScreen";
import { type ChartCard, buildChart, chartMenu } from "./ui/gallery";
import { BarPlot, Diagram, Head, Pane, Prose, Table } from "./ui/widgets";

type Focus = "soft" | "tools" | "hard";
const ORDER: Focus[] = ["soft", "tools", "hard"];

/** Longest paste the one-line composer will take. Past this the paste is
 *  certainly not a path, and inserting it would wedge the render. */
const MAX_PASTE = 20_000;

/** A pane's own frame: two border rows and the title. */
const PANE_CHROME = 3;
/** Result rows the HARD table shows before it is expanded. */
const TABLE_ROWS = 5;

/**
 * Terminal row (1-based) of the HARD table's "… N more" line — the one line
 * in the panes that is a button.
 *
 * Counted rather than measured, because Ink reports no absolute positions:
 * `hardTop` is where the HARD pane starts, then its top border and title,
 * the "table" head with its blank, the headline, the blank above the table,
 * its column header, then the body. The same accounting the diagrams already
 * do against each pane's height, and wrong the same way if the pane's layout
 * changes — hence its own test, and hence being the ONLY row bound to an
 * action besides the header.
 */
export function tableFooterRow(shown: number, hardTop: number): number {
  return hardTop + 1 + 2 + 1 + 1 + 1 + shown + 1;
}

/** Why a paste was refused. Inside RStudio the "drop the file" advice is
 *  actively wrong — a drop there opens RStudio's own editor. */
const contentsNotice = (host: { kind: string }) =>
  host.kind === "rstudio"
    ? "that looks like a file's contents, not its path — /files picks the file itself (dragging it here opens RStudio's editor instead)"
    : "that looks like a file's contents, not its path — drop the file itself, or /files to pick it";

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

/** The stages, in order — used both to draw the list and to budget its rows,
 *  so the two cannot drift apart. */
const STAGE_ORDER = Object.keys(STAGE_LABEL) as StageId[];

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
  /** The same fact as `running`, readable from closures that outlive the
   *  render they were built in — see `start`. */
  const runningRef = useRef(false);
  const [runStart, setRunStart] = useState<number | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  /** The node/edge diagrams in TOOLS and HARD. On by default — they are the
   *  IDE's canvases — but they cost rows, and a short terminal may want them
   *  back. */
  const [showGraph, setShowGraph] = useState(true);
  /** `/charts`, which takes the whole screen. Null when the panes are up. */
  const [charts, setCharts] = useState<{ index: number } | null>(null);
  /** Built charts, keyed by gallery entry — and tied to the pipeline result
   *  they were computed from, so a re-run or a new file cannot leave the
   *  gallery showing the last dataset's numbers under this one's name. */
  const chartCache = useRef<{ of: PipelineResult | null; built: Map<string, ChartCard | null> }>({
    of: null,
    built: new Map(),
  });
  /** The HARD table, expanded past its five rows. Clicking its "… N more"
   *  line toggles it; the plot and the flow diagram stand down while it is
   *  open, because the rows have to come from somewhere. */
  const [tableOpen, setTableOpen] = useState(false);
  const started = useRef(false);

  // ── which way the panes go ──────────────────────────────────────────────
  // Side by side is the layout: three full-height columns, each with its own
  // composer. It needs 140 columns, and a PORTRAIT window does not have them
  // — so a portrait window gets the same three panes stacked, which spends
  // the budget it actually has. Landscape is untouched.
  //
  // A landscape window too narrow for columns stacks as well. That is not
  // the portrait rule leaking: it is the alternative to refusing to draw,
  // which is what it used to do.
  const stacked = isPortrait(cols, rows) || cols < WIDE_MIN_WIDTH;
  const tooSmall = stacked
    ? cols < STACK_MIN_WIDTH || rows < STACK_MIN_HEIGHT
    : rows < WIDE_MIN_HEIGHT;

  // Click anywhere in a pane to type there. Deliberately mapped on the ROW
  // alone rather than on the pane's exact rectangle: the panes tile the
  // height, so every click has an unambiguous answer, and clicking a pane's
  // border or title does the thing you meant rather than nothing.
  // Three rows mean something more than focus, and all three are rows whose
  // position can be COUNTED rather than measured — Ink reports no geometry,
  // so a click target has to be arithmetic the render agrees with. The
  // header's export tag is row 1 and needs no arithmetic at all; the HARD
  // table's "… N more" line and the gallery's list are counted, each next to
  // the render that produces them.
  // Independent of mouse reporting: ctrl-c must survive a truncated paste
  // however the terminal is configured.
  usePasteDeadlockHatch();

  const clickTargets = useRef<{
    export: (() => void) | null;
    /** Row of the HARD table's footer line, or null when it has none. */
    tableFooter: number | null;
    /** How many rows the gallery's list has, when the gallery is up. */
    chartRows: number;
    /** First terminal row of each pane, in ORDER. Recomputed every render,
     *  because the split moves when focus does. Stacked layout only. */
    paneTops: [number, number, number];
    /** Which axis the panes tile, and how wide one is side by side — read by
     *  the click map, which runs from a stdin listener rather than a render
     *  and so cannot close over this render's values. */
    stacked: boolean;
    paneW: number;
  }>({
    export: null,
    tableFooter: null,
    chartRows: 0,
    paneTops: [0, 0, 0],
    stacked: false,
    paneW: 1,
  });
  useMouse(
    useCallback(
      ({ column, row }: { column: number; row: number }) => {
        const t = clickTargets.current;
        // `chartRows` is zeroed whenever the panes render, so this is the
        // same "is the gallery actually on screen" question the key handler
        // asks, answered from what was last drawn.
        if (charts && t.chartRows > 0) {
          const i = row - CHART_LIST_TOP;
          if (column <= chartListWidth(cols) && i >= 0 && i < t.chartRows) {
            setCharts({ index: i });
          }
          return;
        }
        if (row <= 1 && t.export) {
          t.export();
          return;
        }
        // The table's own footer: "… 3 more" is the affordance, so clicking
        // it is the gesture. It sits in HARD, which is also what the click
        // focuses — the row does two things because both are what you meant.
        // Side by side that row runs across all three panes, so the column
        // has to agree it was HARD that was clicked; stacked, the row is
        // HARD's alone.
        const inHard = t.stacked || column > t.paneW * 2;
        if (t.tableFooter !== null && row === t.tableFooter && inHard) {
          setTableOpen((v) => !v);
          setFocus("hard");
          return;
        }
        // Stacked, the panes tile the height, so the row picks one: the
        // last whose top is at or above the click. Side by side they tile
        // the width, so the column does. Either way every click has an
        // unambiguous answer, and clicking a pane's border or the hint line
        // under it does the thing you meant rather than nothing.
        const i = t.stacked
          ? t.paneTops.reduce((best, top, n) => (row >= top ? n : best), 0)
          : Math.min(ORDER.length - 1, Math.max(0, Math.floor((column - 1) / t.paneW)));
        setFocus(ORDER[i]);
      },
      [charts, cols],
    ),
  );
  clickTargets.current.export = pipe?.result ? () => doExport(undefined, active) : null;

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
      // The guard reads a REF, not the `running` state, and `start` therefore
      // has no `running` dependency. A modal picker snapshots its onPick when
      // it opens (the list object lives in chat state), so a `running`-derived
      // closure there goes stale the moment a run starts or ends behind it —
      // picking would either refuse while nothing runs, or start a second
      // pipeline on top of a live one and wipe its half-drawn panes.
      if (runningRef.current) return;
      runningRef.current = true;
      setRunning(true);
      setRunStart(Date.now());
      setStages({});
      setPipe(null);
      setBanner(null);
      // Back to the panes, and back to a shut table. A drop still reaches
      // the app while the gallery is up (it arrives as a paste, not a key),
      // and a gallery whose dataset has just been cleared is a screen that
      // cannot render and a keyboard that cannot leave it.
      setCharts(null);
      setTableOpen(false);
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
      runningRef.current = false;
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
    [onPath, liveUpdate],
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
          // The session's runs, so the R script restates every analysis that
          // was actually performed rather than only the one still on screen.
          const outcome = exportArtifacts(pipe, { targets, runs: liveRuns.current, ...plan });
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
        // The ref, not the state: this closure is stored in the picker and
        // outlives the render that built it.
        if (runningRef.current) {
          chat.say("a run is already in progress — wait for it to finish");
          return;
        }
        chat.say(`loading ${spec.title} (${spec.rows}×${spec.cols})`);
        void start({ dataset: spec.build() });
      },
    }),
    [start],
  );

  /** Real files near a directory, same widget. This is THE loading path
   *  inside RStudio, where a drag never reaches the terminal — RStudio
   *  opens drops in its own editor (with a 5 MB dialog past which it will
   *  not even do that). */
  const fileChoices = useCallback(
    (chat: ChatHandle, root: string, listing: DataFileListing): ChoiceList => ({
      // A capped list says so: presenting the newest 400 of 900 as "the data
      // files under here" is how a file that exists reads as missing.
      title:
        listing.found > listing.files.length
          ? `newest ${listing.files.length} of ${listing.found} data files under ${relative(process.cwd(), root) || "."} — type to filter`
          : `data files under ${relative(process.cwd(), root) || "."} — type to filter`,
      items: listing.files.map((e) => ({
        id: e.path,
        label: e.parts ? `${e.rel} (${e.parts} parts)` : e.rel,
        hint: `${fmtBytes(e.bytes)} · ${fmtWhen(e.mtimeMs, Date.now())}${e.parts ? ` · loads all ${e.parts} parts` : ""}`,
      })),
      onPick: (c) => {
        if (runningRef.current) {
          chat.say("a run is already in progress — wait for it to finish");
          return;
        }
        chat.say(`loading ${c.label}`);
        void start(c.id);
      },
    }),
    [start],
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
        if (runningRef.current) return "a run is already in progress — wait for it to finish";
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
      if (
        !slash &&
        (verb === "help" ||
          verb === "list" ||
          verb === "charts" ||
          verb === "files" ||
          verb === "mouse" ||
          verb === "graph") &&
        args.length > 0
      ) {
        return null;
      }
      if (!slash && verb === "run" && args.length === 0) return null;
      if (!known) {
        return `unknown command /${verb} — ${HELP}`;
      }

      switch (verb) {
        case "help":
          return HELP;
        case "graph": {
          const want = (args[0] ?? "").toLowerCase();
          if (want !== "" && !["on", "off", "toggle"].includes(want)) {
            return "usage: /graph [on|off]";
          }
          const next = want === "on" ? true : want === "off" ? false : !showGraph;
          setShowGraph(next);
          return next
            ? "diagrams on — TOOLS shows the dataset feeding each candidate analysis, HARD shows the runs feeding the output"
            : "diagrams off — the panes give the rows back to the tables and the chat";
        }
        case "mouse": {
          const want = (args[0] ?? "").toLowerCase();
          if (want !== "" && !["on", "off", "toggle"].includes(want)) {
            return "usage: /mouse [on|off]";
          }
          const next = want === "on" ? true : want === "off" ? false : !mouseActive();
          const reached = setMouseActive(next);
          if (next && !reached) {
            return "mouse reporting is disabled for this session (SCELO_TUI_MOUSE=0) — restart without it to use clicks";
          }
          return reached
            ? "mouse on — click a pane to focus it. Selecting text to copy needs shift-drag while this is on; /mouse off hands selection back."
            : "mouse off — drag to select and copy normally again. Tab still moves between panes; /mouse on restores click-to-focus.";
        }
        case "files": {
          // The raw remainder, not the re-joined tokens: `/files 'a  b'`
          // names a directory with two spaces, and args.join(" ") would go
          // looking for "a b" and report an error naming a path the user
          // never typed.
          const raw = (slash ? text.slice(1) : text).trim().replace(/^\S+\s*/, "");
          const root = raw === "" ? process.cwd() : normaliseDroppedPath(raw);
          let listing: DataFileListing;
          try {
            listing = listDataFiles(root);
          } catch (e) {
            return `cannot read ${root}: ${e instanceof Error ? e.message : String(e)}`;
          }
          const shown = relative(process.cwd(), root) || ".";
          if (listing.files.length === 0) {
            return `no data files (csv/tsv/txt) under ${shown} — /files <folder> looks elsewhere`;
          }
          chat.openChoices(fileChoices(chat, root, listing));
          return "";
        }
        case "list": {
          if (!pipe) return "no dataset loaded yet";
          chat.openChoices(analysisChoices(chat, eligible));
          return "";
        }
        case "charts": {
          if (!pipe) return "no dataset loaded yet";
          const entries = chartMenu(pipe.metas, liveRuns.current.map((r) => r.id));
          if (entries.length === 0) return "nothing in this data plots";
          // `/charts 3` lands on the third one — the same "a bare number
          // answers the menu you were just shown" habit the rest of the app
          // has, without needing the menu first.
          const n = Number(args[0]);
          const index =
            Number.isInteger(n) && n >= 1 && n <= entries.length ? n - 1 : 0;
          setCharts({ index });
          return `${entries.length} plot${entries.length === 1 ? "" : "s"} — esc returns to the panes`;
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
          // "export the whole analysis in r code" names one format and five
          // filler words; reading every word as a format is how that turns
          // into `don't know the format "the"`.
          const parsed = parseTargets(args);
          if (!parsed.ok) {
            return `don't know the format "${parsed.word}" — try excel, python, notebook, r, sce or csv`;
          }
          doExport(parsed.targets.length > 0 ? parsed.targets : undefined, chat);
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
    [
      pipe,
      doExport,
      start,
      running,
      showGraph,
      sampleChoices,
      analysisChoices,
      fileChoices,
      liveUpdate,
    ],
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

  // ── drag-drop is a paste ────────────────────────────────────────────────
  // Dragging a file onto the window makes the emulator PASTE its path, and
  // usePaste (bracketed paste mode) hands that over as one event that never
  // reaches useInput. Three shapes arrive here: a drop, which deposits ONLY
  // the clean path in the composer — not the file:// URI or quote soup the
  // emulator dressed it in; the file's CONTENTS (opened, copied, pasted
  // whole), which get pointed back at the path instead of flooding a
  // one-line composer; and ordinary text, flattened to the one line the
  // composer is.
  const acceptPaste = useCallback(
    (raw: string, chat: ChatHandle) => {
      // Size first: dropInsertText scans the whole string several times, so
      // probing a 5 MB paste for a path froze all three panes for a third of
      // a second before discarding it. Nothing this long is a path.
      if (raw.length > MAX_PASTE) {
        chat.say(contentsNotice(host));
        return;
      }
      const path = dropInsertText(raw);
      if (path) {
        // A modal picker owns the keys, but a drop outranks it: dropping a
        // file means "load this". It must CLOSE, not step back — choiceBack
        // is Esc, and on a filtered list Esc only clears the filter, leaving
        // the picker up so ⏎ would accept a highlighted item and load a
        // different dataset than the one just dropped.
        chat.closeChoices();
        chat.insertToken(path);
        if (chat.busy) {
          // The composer shows the spinner while a reply streams, so an
          // inserted path would land invisibly and read as a failed drop.
          chat.say(`path ready — ⏎ loads ${basename(path.replace(/^['"]|['"]$/g, ""))}`);
        }
        return;
      }
      if (looksLikeFileContents(raw)) {
        chat.say(contentsNotice(host));
        return;
      }
      const flat = flattenPaste(raw);
      if (flat === "") return;
      if (chat.choices) chat.choiceType(flat);
      else chat.insert(flat);
    },
    [host],
  );

  /** What ⏎ does to a line, given the text explicitly rather than from the
   *  handle — a coalesced burst submits text that has not reached state yet. */
  const submitLine = useCallback(
    (line: string, chat: ChatHandle) => {
      const text = line.trim();
      // A path typed or dragged into any pane starts a run — that is the
      // "drop a file in" gesture, and it should work from wherever you are.
      // extractDataPath ignores everything AROUND the path (drag gestures
      // bracket it with mouse-report bytes) while leaving prose that merely
      // mentions a file to the chat.
      const dropped = extractDataPath(text);
      if (dropped) {
        if (runningRef.current) {
          // Every other load path narrates this; the drop used to be the one
          // that cleared the composer and did nothing at all.
          chat.say("a run is already in progress — wait for it to finish");
          return;
        }
        // A drop is a prompt too: ↑ must be able to offer the load line for
        // a re-run, even though it never goes through submit().
        chat.noteHistory(text);
        chat.setDraft("");
        void start(dropped);
        return;
      }
      chat.submit(text);
    },
    [start],
  );

  usePaste((text) => {
    // NOT stripMouseNoise: between the paste markers the bytes are clipboard
    // content verbatim — a terminal cannot inject a report there — so the
    // `digits;digits;digitsM` shape only ever matches the user's own text,
    // and stripping it would silently eat "10;20;30Max" mid-sentence.
    acceptPaste(text, active);
  });

  useInput((input, key) => {
    // A click arrives on stdin as an escape sequence, and Ink hands it to us
    // as if it were typing. Both guards are load-bearing: the flag catches it
    // however Ink chose to split the bytes up, the pattern catches a sequence
    // that reached us without the flag being set.
    //
    // The flag is per stdin CHUNK, not per event, and Ink drains a whole
    // buffer synchronously — so a drag whose path shares a chunk with the
    // click reports bracketing it would lose the path along with them.
    // Exactly one thing is worth rescuing from a flagged chunk: a path. Any
    // other residue (a split report's "4M" tail) stays swallowed, which is
    // what keeps report fragments from becoming typing.
    if (isMouseReport(input)) return;
    // A report Ink held as an incomplete escape and flushed 20ms later, long
    // after the swallow flag cleared. Only while reporting is on, so a
    // literal "[<12" typed into a mouse-free session still gets through.
    if (mouseActive() && isMouseFragment(input)) return;
    if (swallowingMouseBytes()) {
      const rescued = dropInsertText(stripMouseNoise(input));
      if (rescued) {
        active.closeChoices();
        active.insertToken(rescued);
      }
      return;
    }
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
    // The gallery is the whole screen, so it is the whole keyboard: there is
    // no composer under it to type into, and a key it does not claim must do
    // nothing rather than land invisibly in a pane nobody can see. Guarded on
    // the dataset as well as the flag — the render needs both, so anything
    // that clears one behind this branch's back must hand the keys back.
    if (charts && pipe) {
      const n = clickTargets.current.chartRows;
      const move = (d: number) =>
        setCharts((c) => (c ? { index: (c.index + d + n) % Math.max(1, n) } : c));
      if (key.escape || key.return || input === "q") setCharts(null);
      else if (key.upArrow || key.leftArrow) move(-1);
      else if (key.downArrow || key.rightArrow) move(1);
      else if (/^[1-9]$/.test(input) && Number(input) <= n) {
        setCharts({ index: Number(input) - 1 });
      }
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
        const clean = stripMouseNoise(input);
        if (!clean) return;
        if ([...clean].length === 1) {
          active.choiceType(clean);
          return;
        }
        // The same coalesced typing+Enter the composer handles — and it
        // matters more here: flattening "2\r" to "2 " types a filter that
        // matches nothing and swallows the Enter, so the pick never happens
        // and the list collapses to its empty state.
        if (/^[^\x00-\x1f\x7f]*\r$/.test(clean)) {
          active.choiceTypeAccept(clean.slice(0, -1));
          return;
        }
        // A drop while a picker is open must fold it and load, not become a
        // filter nobody can match ('nothing matches "/tmp/claims.csv"').
        acceptPaste(clean, active);
        return;
      }
    }
    // The `/` menu is a mode: while it is open the arrows, ⏎, tab and esc
    // belong to it. Checked before pane-switching so tab completes the
    // command rather than throwing you into the next pane mid-word.
    if (active.menu) {
      if (key.upArrow) {
        // Mid-history-walk the arrows stay with history: recalling a
        // /command re-opens the menu, and the walk must not strand there.
        if (active.histActive) active.histPrev();
        else active.menuMove(-1);
        return;
      }
      if (key.downArrow) {
        if (active.histActive) active.histNext();
        else active.menuMove(1);
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
    // ── the composer is a readline ──────────────────────────────────────────
    // The keys every terminal input is expected to have: ↑↓ walk the prompt
    // history, ←→/home/end move the caret, and the ctrl chords do what they
    // do in every shell. Only reached when no menu or picker owns the arrows.
    if (key.upArrow) {
      active.histPrev();
      return;
    }
    if (key.downArrow) {
      active.histNext();
      return;
    }
    if (key.leftArrow) {
      // ctrl-← / alt-← hop a word; plain ← moves one column.
      if (key.ctrl || key.meta) active.wordLeft();
      else active.moveCursor(-1);
      return;
    }
    if (key.rightArrow) {
      if (key.ctrl || key.meta) active.wordRight();
      else active.moveCursor(1);
      return;
    }
    if (key.home) {
      active.cursorHome();
      return;
    }
    if (key.end) {
      active.cursorEnd();
      return;
    }
    // The readline chords. (ctrl-e would be readline's End, but it already
    // means export here; the End key and ctrl-a still cover both edges.)
    if (key.ctrl && input === "a") {
      active.cursorHome();
      return;
    }
    if (key.ctrl && input === "u") {
      active.killToStart();
      return;
    }
    if (key.ctrl && input === "k") {
      active.killToEnd();
      return;
    }
    if (key.ctrl && input === "w") {
      active.killWord();
      return;
    }
    if (key.ctrl && input === "d") {
      active.del();
      return;
    }
    if (key.meta && input === "b") {
      active.wordLeft();
      return;
    }
    if (key.meta && input === "f") {
      active.wordRight();
      return;
    }
    if (key.escape) {
      // Esc on a draft clears it. The menus take esc before this line, so
      // this only fires when there is nothing else for esc to close.
      if (active.draft !== "") active.setDraft("");
      return;
    }
    if (key.return) {
      submitLine(active.draft, active);
      return;
    }
    if (key.backspace) {
      active.backspace();
      return;
    }
    // Ink 7 tells the two apart: 0x7f is backspace, `[3~` is the Delete
    // key — which deletes AT the caret, the way it does everywhere else.
    if (key.delete) {
      active.del();
      return;
    }
    if (input && !key.ctrl && !key.meta && !key.escape) {
      // Belt to the chunk classifier's braces: report bytes that slipped
      // through with their ESC[< prefix already consumed must never become
      // typing.
      const clean = stripMouseNoise(input);
      if (!clean) return;
      // One printable character is typing; anything longer arrived as a
      // chunk, and a chunk is either a paste (in a terminal without
      // bracketed paste, where a drop lands here rather than in usePaste) or
      // keystrokes the event loop coalesced while it was blocked.
      if ([...clean].length === 1) {
        active.insert(clean);
        return;
      }
      // Typing that coalesced with its own Enter: the ONLY control byte is
      // one trailing CR. Flattening that (the paste rule) would turn the
      // Enter into a space and silently swallow the message — so it submits
      // instead, with the text the caret would have produced.
      if (/^[^\x00-\x1f\x7f]*\r$/.test(clean)) {
        const body = clean.slice(0, -1);
        const merged =
          active.draft.slice(0, active.cursor) + body + active.draft.slice(active.cursor);
        // Insert FIRST. submit() refuses while the pane is streaming, and a
        // line that only ever existed as a local string would vanish with no
        // trace — where the same keystrokes delivered one at a time sit
        // safely in the draft. On a successful submit this is redundant:
        // submit clears the line anyway.
        if (body !== "") active.insert(body);
        submitLine(merged, active);
        return;
      }
      acceptPaste(clean, active);
    }
  });

  if (tooSmall) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color={theme.warn}>Terminal too small for the three panes.</Text>
        <Text color={theme.mute}>
          {cols}x{rows} — needs {WIDE_MIN_WIDTH}x{WIDE_MIN_HEIGHT} side by side, or{" "}
          {STACK_MIN_WIDTH}x{STACK_MIN_HEIGHT} stacked.{" "}
          {/* Say which way to drag. Which way depends on the shape it is
              already closest to, and "widen the window" is the wrong advice
              for something that is one row short of stacking. */}
          {stacked ? "Make it taller." : "Widen it."}
        </Text>
      </Box>
    );
  }

  const p = pipe;

  // ── /charts, on its own screen ──────────────────────────────────────────
  // Listing is cheap (an `applies` check per analysis); BUILDING one runs the
  // analysis, so only the selected chart is built, and the cache means
  // arrowing back to one you have already seen is free. The first build of a
  // heavy analysis blocks the render — the same trade `/run` already makes,
  // for the same reason: these are sub-second pure functions and a worker
  // would cost more than it saves.
  if (charts && p) {
    if (chartCache.current.of !== p) chartCache.current = { of: p, built: new Map() };
    const cache = chartCache.current.built;
    const entries = chartMenu(p.metas, liveRuns.current.map((r) => r.id));
    clickTargets.current.chartRows = entries.length;
    const index = Math.min(charts.index, Math.max(0, entries.length - 1));
    const entry = entries[index];
    let card: ChartCard | null = null;
    if (entry) {
      if (!cache.has(entry.key)) cache.set(entry.key, buildChart(entry, p));
      card = cache.get(entry.key) ?? null;
    }
    return (
      <ChartScreen
        entries={entries}
        index={index}
        card={card}
        datasetName={p.dataset.name}
        cols={cols}
        rows={rows}
      />
    );
  }
  clickTargets.current.chartRows = 0;

  // ── the geometry, one set of numbers for both layouts ───────────────────
  // Header, optional banner, three panes, footer. Side by side each pane is
  // a third of the width and the full body height; stacked it is the full
  // width and a share of the height — unequal, because three equal thirds
  // leave nowhere to put a table.
  const bodyH = Math.max(stacked ? 3 * MIN_PANE_ROWS : 12, rows - (banner ? 3 : 2));
  const { paneW, lastW } = paneWidths(cols);
  const widths: [number, number, number] = stacked ? [cols, cols, cols] : [paneW, paneW, lastW];
  const heights: [number, number, number] = stacked
    ? paneHeights(bodyH, ORDER.indexOf(focus))
    : [bodyH, bodyH, bodyH];
  const [softH, toolsH, hardH] = heights;
  // Content width, not pane width: the Pane draws a border (1 col each side)
  // AND paddingX={1} (1 more each side). Getting this wrong makes every
  // full-width rule wrap onto a second line.
  const [softW, toolsW, hardW] = widths.map((w) => w - 4) as [number, number, number];
  // Every pane keeps its composer side by side — there is height for three.
  // Stacked there is not, so only the focused one does; see chatRows.
  const focused = (id: Focus) => !stacked || focus === id;
  // First terminal row of each pane, for the click map when stacked: row 1
  // is the header, then the banner if there is one, then the panes.
  const stackTop = 2 + (banner ? 1 : 0);
  clickTargets.current.paneTops = stacked
    ? [stackTop, stackTop + softH, stackTop + softH + toolsH]
    : [stackTop, stackTop, stackTop];
  clickTargets.current.stacked = stacked;
  clickTargets.current.paneW = Math.max(1, paneW);

  // Rows each pane has left for its own content. Every budget below is
  // measured against these rather than against the terminal, because in a
  // stack the panes have three different heights and only one of them has a
  // composer.
  const softRoom = softH - PANE_CHROME - chatRows(softH, focused("soft"));
  const toolsRoom = toolsH - PANE_CHROME - chatRows(toolsH, focused("tools"));
  const hardRoom = hardH - PANE_CHROME - chatRows(hardH, focused("hard"));

  // SOFT spends seven rows on the file and summary blocks before the reading
  // starts (eight when a column was dropped), then a blank, and Prose adds a
  // "…" row of its own when it clips.
  const softFixed = 7 + (p?.clean && p.clean.droppedColumns.length > 0 ? 1 : 0);
  // The empty state's budget, which is a different shape: the "file(s)" head
  // (2), a blank, the greeting, another blank, and the four lines telling you
  // how to load something. The greeting gets what the hints leave, and the
  // hints win — they are the actionable part; the greeting is decoration.
  const welcomeRows = softRoom - 2 - 1 - 1 - 4;
  // The block costs its own blank row and the "…" Prose adds when it clips,
  // so two rows buy nothing: below that it does not appear at all rather
  // than appearing on top of the pane's border.
  const readingLines = softRoom - softFixed - 2;
  // TOOLS spends two rows on its head and five on the stage list. Stacked,
  // that is the whole pane — and a finished stage list is five ticks, while
  // the analysis it chose and why is what TOOLS is actually for. So once the
  // run is over and the rows are tight, the list folds to one line. It never
  // folds mid-run: while something is moving, the moving thing IS the news.
  const stageStates = (Object.keys(STAGE_LABEL) as StageId[]).map((id) => stages[id]?.state);
  const stagesSettled =
    !running && stageStates.every((st) => st === "done" || st === "skipped");
  const foldStages = stagesSettled && toolsRoom < 12;
  const stageRows = foldStages ? 1 : STAGE_ORDER.length;
  // What is left decides how much of the analysis block survives, in
  // priority order: the head and the chosen analysis, then the rationale,
  // then the hint.
  const toolsAfterStages = toolsRoom - 2 - stageRows;
  const rationaleLines = Math.max(0, Math.min(4, toolsAfterStages - 3 - 1 - 1));

  // ── the two canvases, as a terminal draws them ──────────────────────────
  // The IDE puts a node/edge canvas in each of these panes: TOOLS fans the
  // dataset OUT to its candidate models, HARD fans the results back IN to a
  // board pack. Same two pictures here, flattened onto a vertical spine and
  // budgeted in ROWS — the panes already own a stage list, a rationale, a
  // table and a chat, so the diagram takes what is left and truncates itself
  // rather than pushing the composer off the bottom of the screen.
  // Ink CLIPS a pane that overflows its fixed height, and it clips silently —
  // the symptom is a box missing its bottom border, not an error. So the
  // budget is counted honestly against everything else the pane draws, with a
  // row left spare.
  const fanOutLeaves = (budget: number) => Math.floor((budget - 5) / 3);
  const fanInLeaves = (budget: number) => Math.floor((budget - 6) / 3);

  const eligible = p ? MODELS.filter((m) => m.applies(p.metas)) : [];
  const toolsDiagram = (() => {
    if (!showGraph || !p?.chosen || eligible.length === 0) return [];
    const spent =
      2 + // "pipeline" head
      5 + // one line per stage
      2 + // "analyses" head
      4 + // the rationale, at its cap
      1; // the /run hint
    const max = fanOutLeaves(toolsRoom - spent - 1);
    if (max < 1) return [];
    // The chosen analysis leads; the rest are the alternatives `/run` offers.
    const ordered = [
      ...eligible.filter((m) => m.id === p.chosen?.id),
      ...eligible.filter((m) => m.id !== p.chosen?.id),
    ];
    return fanOut(
      {
        label: p.dataset.name,
        detail: `${p.dataset.rows.length.toLocaleString()} × ${p.dataset.columns.length}${
          p.clean && p.clean.passes.length > 0
            ? ` · ${p.clean.passes.reduce((n, x) => n + x.opLabels.length, 0)} clean steps`
            : ""
        }`,
        status: "live",
      },
      ordered.map((m) => ({
        label: m.label,
        status: m.id === p.chosen?.id ? ("live" as const) : ("idle" as const),
      })),
      { width: toolsW, accent: theme.tools, maxLeaves: max },
    );
  })();

  // ── the HARD table, open or shut ────────────────────────────────────────
  // Expanded, the table takes every row the plot and the flow diagram were
  // using — which is the deal the click makes, and why both stand down while
  // it is open rather than being squeezed into two rows each.
  const tableFits =
    hardRoom -
    2 - // "table" head
    1 - // the headline
    1 - // the blank above the table
    1 - // the table's own header row
    1; // the footer line
  // Even shut, the table cannot show five rows in a pane that has three: a
  // stacked HARD is a third of the height a column was, and overflowing it
  // draws the plot over the pane's own border.
  const tableRows = Math.max(1, tableOpen ? tableFits : Math.min(TABLE_ROWS, tableFits));
  const tableBody = p?.result ? Math.min(tableRows, p.result.rows.length) : 0;
  // Only a truncated table has a footer to click; an expanded one always
  // does, because collapsing it again has to be reachable the same way.
  clickTargets.current.tableFooter =
    p?.result && (tableOpen || p.result.rows.length > tableBody)
      ? tableFooterRow(tableBody, clickTargets.current.paneTops[2])
      : null;
  // Bars the sparkline may draw, from whatever the table left. Zero means it
  // does not appear at all — `/charts` has the full-size version, and half a
  // plot drawn over the pane's border is worse than none.
  const plotBars = tableOpen
    ? 0
    : Math.min(
        5,
        hardRoom -
          2 - // "table" head
          1 - // the headline
          1 - // the blank above the table
          1 - // the table's own header row
          tableBody -
          (p?.result && p.result.rows.length > tableBody ? 1 : 0) -
          2 - // "plot" head
          1, // the series label
      );

  const hardDiagram = (() => {
    if (!showGraph || !p?.result || tableOpen) return [];
    // The numbers come first: the table, then the plot. The diagram gets
    // what is left of the pane, or it does not appear.
    const body = p.result.rows.length;
    const spent =
      2 + // "table" head
      1 + // the headline
      1 + // the blank above the table
      1 + // the table's own header row
      Math.min(tableRows, body) +
      (body > tableRows ? 1 : 0) +
      (p.result.series ? 3 + Math.min(plotBars, p.result.series.values.length) : 0) +
      2; // "flow" head
    const max = fanInLeaves(hardRoom - spent - 1);
    if (max < 1) return [];
    // Every analysis the session actually ran — the provenance of the numbers
    // above. liveRuns is appended to by /run and by the pipeline's own pick.
    const runs =
      liveRuns.current.length > 0
        ? liveRuns.current
        : p.chosen
          ? [{ id: p.chosen.id, label: p.chosen.label, rationale: p.rationale }]
          : [];
    if (runs.length === 0) return [];
    return fanIn(
      runs.map((r) => ({
        label: r.label,
        status: r.id === p.chosen?.id ? ("live" as const) : ("live" as const),
      })),
      {
        label: p.result.headline,
        detail: `${runs.length} run${runs.length === 1 ? "" : "s"} · ctrl-e exports`,
        status: "live",
      },
      { width: hardW, accent: theme.hard, maxLeaves: max },
    );
  })();

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
      {/* Side by side by default. Stacked — soft above tools above hard, the
          order the pipeline runs in — when the window is portrait and has no
          width to divide. */}
      <Box flexDirection={stacked ? "column" : "row"} height={bodyH}>
        {/* ── SOFT ── */}
        <Pane
          title="SOFT · data"
          accent={theme.soft}
          focused={focus === "soft"}
          width={widths[0]}
          height={stacked ? softH : undefined}
        >
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
              {readingLines > 0 && (
              <Box marginTop={1}>
                <Prose
                  text={p.reading || p.degraded || "(no reading)"}
                  width={softW}
                  // What the pane has left after the file lines, the summary,
                  // its own blank row and the "…" Prose adds when it clips —
                  // NOT a slice of the terminal, which is what wrote this
                  // paragraph over the pane's border.
                  maxLines={readingLines}
                  color={p.reading ? theme.fg : theme.mute}
                />
              </Box>
              )}
            </>
          ) : (
            <Box flexDirection="column" marginTop={1}>
              {/* The tagline lives on the hint lines just below the box in
                  this pane, so the box itself carries only the hello — at 42
                  usable columns there is no room for both beside the mark. */}
              {/* Stacked, SOFT is a third of the screen and the mark is 16
                  rows at its largest — passing only a width picks a rung
                  that fits across and not down, and Ink answers an
                  overflowing pane by squashing its children rather than
                  saying so. Below the smallest rung the greeting is a line
                  of text: still a hello, and it costs one row. */}
              {welcomeRows >= 8 ? (
                <Welcome width={softW} maxRows={welcomeRows - 2} lines={[]} />
              ) : (
                <Text color={theme.mascot} bold>
                  ✻ Welcome to Scelo!
                </Text>
              )}
              <Box marginTop={1} />
              {/* Inside RStudio, dropping a file on the window opens it in
                  RStudio's own editor (and >5 MB hits its size dialog) — the
                  drop never reaches this terminal, so don't suggest it. */}
              {host.kind === "rstudio" ? (
                <>
                  <Text color={theme.mute}>type /files to pick a CSV from this folder,</Text>
                  <Text color={theme.mute}>or paste a path below and press ⏎</Text>
                  <Text color={theme.mute}>(don't drag — RStudio opens drops in its editor),</Text>
                </>
              ) : (
                <>
                  <Text color={theme.mute}>drag a CSV onto this window</Text>
                  <Text color={theme.mute}>(its path lands below), press ⏎,</Text>
                  <Text color={theme.mute}>or /files to pick one from this folder,</Text>
                </>
              )}
              <Text color={theme.mute}>or type /example for the IDE's sample data</Text>
            </Box>
          )}
          <ChatView
            chat={softChat}
            width={softW}
            accent={theme.soft}
            focused={focus === "soft"}
            lines={chatLines(softH)}
            collapsed={!focused("soft")}
          />
        </Pane>

        {/* ── TOOLS ── */}
        <Pane
          title="TOOLS · models"
          accent={theme.tools}
          focused={focus === "tools"}
          width={widths[1]}
          height={stacked ? toolsH : undefined}
        >
          <Head>pipeline</Head>
          {foldStages ? (
            <Text color={theme.ok} wrap="truncate">
              ✓ {STAGE_ORDER.length} stages ·{" "}
              <Text color={theme.mute}>
                {stageStates.filter((st) => st === "skipped").length > 0
                  ? `${stageStates.filter((st) => st === "done").length} run, ${stageStates.filter((st) => st === "skipped").length} skipped`
                  : "all done"}
              </Text>
            </Text>
          ) : (
          (Object.keys(STAGE_LABEL) as StageId[]).map((id) => {
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
          })
          )}
          {p?.chosen && toolsAfterStages >= 3 && (
            <>
              {/* The diagram shows the chosen analysis AND the alternatives,
                  so it earns the plural. Without the room for it, the pane
                  falls back to naming the one that won. */}
              <Head>{toolsDiagram.length > 0 ? "analyses" : "chosen"}</Head>
              {toolsDiagram.length > 0 ? (
                <Diagram lines={toolsDiagram} />
              ) : (
                <Text color={theme.tools} wrap="truncate">
                  {p.chosen.label}
                </Text>
              )}
              {rationaleLines > 0 && (
                <Prose
                  text={p.rationale}
                  width={toolsW}
                  maxLines={rationaleLines}
                  color={theme.mute}
                />
              )}
              {/* The last thing to go: what the pane says NEXT matters less
                  than what it is showing, and /help lists both commands. */}
              {toolsAfterStages >= 5 && (
                <Text color={theme.mute}>/run to change · /list for the menu</Text>
              )}
            </>
          )}
          <ChatView
            chat={toolsChat}
            width={toolsW}
            accent={theme.tools}
            focused={focus === "tools"}
            lines={chatLines(toolsH)}
            collapsed={!focused("tools")}
          />
        </Pane>

        {/* ── HARD ── */}
        <Pane
          title="HARD · output"
          accent={theme.hard}
          focused={focus === "hard"}
          width={widths[2]}
          height={stacked ? hardH : undefined}
        >
          {p?.result ? (
            <>
              <Head>table</Head>
              <Text color={theme.hard}>{p.result.headline}</Text>
              <Box marginTop={1}>
                <Table
                  columns={p.result.columns}
                  rows={p.result.rows}
                  width={hardW}
                  maxRows={tableRows}
                  expanded={tableOpen}
                />
              </Box>
              {p.result.series && plotBars > 0 && (
                <>
                  <Head>plot</Head>
                  {/* The pane's plot is a sparkline's budget — five rows and
                      forty columns. Saying where the full-size one lives
                      costs no rows here, which a separate hint line would. */}
                  <Text color={theme.mute} wrap="truncate">
                    {p.result.series.label} · /charts
                  </Text>
                  <BarPlot
                    values={p.result.series.values}
                    labels={p.result.series.labels}
                    width={hardW}
                    color={theme.hard}
                    max={plotBars}
                  />
                </>
              )}
              {hardDiagram.length > 0 && (
                <>
                  <Head>flow</Head>
                  <Diagram lines={hardDiagram} />
                </>
              )}
            </>
          ) : (
            <Box marginTop={1}>
              <Text color={theme.mute}>no output yet</Text>
            </Box>
          )}
          <ChatView
            chat={hardChat}
            width={hardW}
            accent={theme.hard}
            focused={focus === "hard"}
            lines={chatLines(hardH)}
            collapsed={!focused("hard")}
          />
        </Pane>
      </Box>

      <Box>
        <Text color={theme.mute}>
          click/tab pane · ⏎ send (or paste a path) · ↑↓ history · /help commands · ctrl-e
          export · ctrl-o model · ctrl-c quit
        </Text>
      </Box>
    </Box>
  );
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
    "  /files          pick a real data file from the working directory",
    "  /example        list the bundled sample datasets",
    "  /example 2      load one by number (a bare number works after the list)",
    "  or paste a CSV's path and press enter (drag-drop works in plain",
    "  terminals; inside RStudio a drop opens ITS editor — use /files there)",
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
