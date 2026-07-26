// The automatic pipeline.
//
// Drop a file in and this runs the whole way through without being asked:
//
//   ingest -> profile -> auto-clean -> read the data (LLM)
//          -> pick a model (LLM, constrained) -> run it -> render
//
// The design point is that the user never drives it. Chat is for CHANGING
// what it decided, not for triggering it. That inverts the GUI, where every
// step is a button, and it is the reason each stage has to state what it did
// and why — an automatic decision the user cannot see is one they cannot
// correct.
//
// Every stage reports through `onStage` so three panes can fill in as the
// work lands, rather than after it.

import { type ColumnMeta, type Dataset, summariseDataset } from "../core/dataset";
import { type AutoCleanResult, autoCleanDataset } from "../core/cleaning";
import { loadDataset } from "../core/ingest";
import { complete, llmAvailable } from "./llm";

export type StageId = "ingest" | "clean" | "read" | "pick" | "run";
export type StageState = "pending" | "active" | "done" | "failed" | "skipped";

export type StageEvent = {
  stage: StageId;
  state: StageState;
  detail?: string;
};

/** A model the agent may choose. Deliberately a small fixed menu for the
 *  skeleton: the real catalog is ~30 entries and picking well from it is a
 *  separate problem from proving the pipeline runs. */
export type ModelChoice = {
  id: string;
  label: string;
  /** When this model is applicable at all, checked before the LLM sees it. */
  applies: (metas: ColumnMeta[]) => boolean;
  /** Runs headlessly and returns a small result table. */
  run: (dataset: Dataset, metas: ColumnMeta[]) => ModelResult;
};

export type ModelResult = {
  headline: string;
  columns: string[];
  rows: Array<Array<string | number>>;
  /** Values for a terminal plot, when the model produces a series. */
  series?: { label: string; values: number[] };
};

export type PipelineResult = {
  dataset: Dataset;
  metas: ColumnMeta[];
  clean: AutoCleanResult | null;
  /** The agent's prose read of what this data is. */
  reading: string;
  chosen: ModelChoice | null;
  /** Why the agent chose it. */
  rationale: string;
  result: ModelResult | null;
  /** Populated when the LLM was unreachable, so the panes can say so rather
   *  than showing an empty box that looks like a bug. */
  degraded: string | null;
};

function numericColumns(metas: ColumnMeta[]): ColumnMeta[] {
  return metas.filter((m) => m.type === "number" && m.min !== undefined);
}

// ── the model menu ────────────────────────────────────────────────────────

export const MODELS: ModelChoice[] = [
  {
    id: "numeric-summary",
    label: "Descriptive summary",
    applies: (m) => numericColumns(m).length > 0,
    run: (_d, metas) => {
      const nums = numericColumns(metas);
      return {
        headline: `${nums.length} numeric column${nums.length === 1 ? "" : "s"} described`,
        columns: ["column", "n", "mean", "median", "p20", "p80", "min", "max"],
        rows: nums.map((m) => [
          m.name,
          m.count - m.missing,
          fmt(m.mean),
          fmt(m.median),
          fmt(m.quintiles?.[0]),
          fmt(m.quintiles?.[3]),
          fmt(m.min),
          fmt(m.max),
        ]),
        series: nums[0]?.histogramBins
          ? { label: `${nums[0].name} distribution`, values: nums[0].histogramBins }
          : undefined,
      };
    },
  },
  {
    id: "frequency",
    label: "Frequency / exposure profile",
    applies: (m) => m.some((x) => x.type === "string" && x.unique > 1 && x.unique <= 40),
    run: (_d, metas) => {
      const cat = metas
        .filter((m) => m.type === "string" && m.unique > 1 && m.unique <= 40)
        .sort((a, b) => a.unique - b.unique)[0];
      const top = cat?.topValues ?? [];
      const total = top.reduce((s, t) => s + t.count, 0) || 1;
      return {
        headline: `Exposure across \`${cat?.name ?? "?"}\` (${cat?.unique ?? 0} levels)`,
        columns: ["level", "count", "share"],
        rows: top.map((t) => [t.value, t.count, `${((100 * t.count) / total).toFixed(1)}%`]),
        series: { label: `${cat?.name ?? ""} counts`, values: top.map((t) => t.count) },
      };
    },
  },
  {
    id: "missingness",
    label: "Missingness / data-quality audit",
    applies: (m) => m.some((x) => x.missing > 0),
    run: (_d, metas) => {
      const withGaps = metas
        .filter((m) => m.missing > 0)
        .sort((a, b) => b.missing / b.count - a.missing / a.count);
      return {
        headline: `${withGaps.length} column${withGaps.length === 1 ? "" : "s"} with gaps`,
        columns: ["column", "type", "missing", "%"],
        rows: withGaps.map((m) => [
          m.name,
          m.type,
          m.missing,
          `${((100 * m.missing) / Math.max(1, m.count)).toFixed(1)}%`,
        ]),
        series: { label: "missing %", values: withGaps.map((m) => (100 * m.missing) / Math.max(1, m.count)) },
      };
    },
  },
];

function fmt(n: number | undefined): string {
  if (n === undefined || !Number.isFinite(n)) return "—";
  const a = Math.abs(n);
  if (a >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
  return String(Math.round(n * 100) / 100);
}

// ── prompts ───────────────────────────────────────────────────────────────

function profileBlock(dataset: Dataset, metas: ColumnMeta[]): string {
  const lines = [
    `file: ${dataset.name}`,
    `shape: ${dataset.rows.length} rows x ${dataset.columns.length} columns`,
    "columns:",
  ];
  for (const m of metas.slice(0, 40)) {
    const bits = [`type=${m.type}`, `unique=${m.unique}`, `missing=${m.missing}`];
    if (m.type === "number" && m.min !== undefined) {
      bits.push(`range=${fmt(m.min)}..${fmt(m.max)}`, `median=${fmt(m.median)}`);
    }
    if (m.type === "date") bits.push(`range=${m.dateMin ?? "?"}..${m.dateMax ?? "?"}`);
    if (m.type === "string" && m.topValues?.length) {
      bits.push(`top=${m.topValues.slice(0, 4).map((t) => t.value).join("|")}`);
    }
    lines.push(`  - ${m.name}: ${bits.join(", ")}`);
  }
  return lines.join("\n");
}

const READ_SYSTEM = `You are the data-reading stage of an actuarial workstation.

You are given a column profile of a dataset that was just loaded and
automatically cleaned. Say what this data IS and what it is FOR, in at most
5 short lines.

Rules:
- Answer only from the profile. Never invent columns, values or counts.
- Lead with what the grain of a row is (one policy? one claim? one person?).
- Name the columns that carry the analytical weight and say why.
- Flag anything that looks wrong or would block analysis.
- No preamble, no restating the question, no markdown headings.`;

const PICK_SYSTEM = `You choose ONE analysis to run on a freshly loaded dataset.

You are given a column profile and a numbered menu. Reply with exactly two
lines and nothing else:

CHOICE: <number>
WHY: <one sentence, naming the specific columns that drove the choice>

Choose only from the menu. Do not invent an analysis.`;

// ── the pipeline ──────────────────────────────────────────────────────────

export async function runPipeline(
  path: string,
  onStage: (e: StageEvent) => void,
): Promise<{ ok: true; value: PipelineResult } | { ok: false; error: string }> {
  // 1 — ingest
  onStage({ stage: "ingest", state: "active" });
  const loaded = await loadDataset(path);
  if (!loaded.ok) {
    onStage({ stage: "ingest", state: "failed", detail: loaded.error });
    return { ok: false, error: loaded.error };
  }
  const raw = loaded.dataset;
  onStage({
    stage: "ingest",
    state: "done",
    detail: `${raw.rows.length.toLocaleString()} rows x ${raw.columns.length} cols`,
  });

  // 2 — clean, to a fixed point
  onStage({ stage: "clean", state: "active" });
  const clean = autoCleanDataset(raw, (d) => summariseDataset(d));
  const dataset = clean.dataset;
  const metas = summariseDataset(dataset);
  const steps = clean.passes.reduce((n, p) => n + p.opLabels.length, 0);
  onStage({
    stage: "clean",
    state: clean.passes.length === 0 ? "skipped" : "done",
    detail:
      clean.passes.length === 0
        ? "already clean"
        : `${steps} step${steps === 1 ? "" : "s"} over ${clean.passes.length} pass${clean.passes.length === 1 ? "" : "es"}`,
  });

  // The LLM stages degrade rather than fail: a pipeline that refuses to show
  // a profile because a local model is down would be worse than useless.
  const haveLlm = await llmAvailable();
  const degraded = haveLlm ? null : "local model unreachable — profile shown, narrative skipped";

  // 3 — read
  onStage({ stage: "read", state: haveLlm ? "active" : "skipped" });
  let reading = "";
  if (haveLlm) {
    try {
      reading = await complete(
        [
          { role: "system", content: READ_SYSTEM },
          { role: "user", content: profileBlock(dataset, metas) },
        ],
        { maxTokens: 300 },
      );
      onStage({ stage: "read", state: "done" });
    } catch (e) {
      reading = "";
      onStage({ stage: "read", state: "failed", detail: e instanceof Error ? e.message : String(e) });
    }
  }

  // 4 — pick a model. The menu is filtered by applicability FIRST, so the
  // model can only choose something that will actually run.
  onStage({ stage: "pick", state: "active" });
  const eligible = MODELS.filter((m) => m.applies(metas));
  let chosen: ModelChoice | null = eligible[0] ?? null;
  let rationale = eligible.length > 0 ? "first applicable analysis for this shape" : "";
  if (haveLlm && eligible.length > 1) {
    try {
      const menu = eligible.map((m, i) => `${i + 1}. ${m.label}`).join("\n");
      const reply = await complete(
        [
          { role: "system", content: PICK_SYSTEM },
          { role: "user", content: `${profileBlock(dataset, metas)}\n\nMENU:\n${menu}` },
        ],
        { maxTokens: 120, temperature: 0.1 },
      );
      const n = Number(/CHOICE:\s*(\d+)/i.exec(reply)?.[1]);
      const why = /WHY:\s*(.+)/i.exec(reply)?.[1]?.trim();
      // Only honour a choice that is actually on the menu — a model that
      // replies "4" for a 3-item menu must not crash the run.
      if (Number.isFinite(n) && n >= 1 && n <= eligible.length) {
        chosen = eligible[n - 1];
        if (why) rationale = why;
      }
    } catch {
      // keep the heuristic choice
    }
  }
  onStage({
    stage: "pick",
    state: chosen ? "done" : "failed",
    detail: chosen?.label ?? "no analysis applies to this shape",
  });

  // 5 — run
  onStage({ stage: "run", state: chosen ? "active" : "skipped" });
  let result: ModelResult | null = null;
  if (chosen) {
    try {
      result = chosen.run(dataset, metas);
      onStage({ stage: "run", state: "done", detail: result.headline });
    } catch (e) {
      onStage({ stage: "run", state: "failed", detail: e instanceof Error ? e.message : String(e) });
    }
  }

  return {
    ok: true,
    value: { dataset, metas, clean, reading, chosen, rationale, result, degraded },
  };
}
