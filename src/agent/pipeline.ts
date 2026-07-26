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

import { type ColumnMeta, type Dataset, summariseDataset } from "@scelo/core";
import { type AutoCleanResult, autoCleanDataset } from "../core/cleaning";
import { loadDataset } from "../core/ingest";
import { MODELS, type ModelChoice, type ModelResult } from "./analyses";
import { complete, llmAvailable } from "./llm";

export type StageId = "ingest" | "clean" | "read" | "pick" | "run";
export type StageState = "pending" | "active" | "done" | "failed" | "skipped";

export type StageEvent = {
  stage: StageId;
  state: StageState;
  detail?: string;
};

// The menu itself lives in analyses.ts — the export generators need it
// without dragging in the pipeline. Re-exported so existing importers keep
// one obvious place to look.
export { MODELS };
export type { ModelChoice, ModelResult };

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

/**
 * Hand the event loop back so the renderer can paint the stage we just
 * announced, before we block on it.
 *
 * Ingest and clean are synchronous and CPU-bound — parsing 25MB and cleaning
 * 120k rows to a fixed point holds the thread for seconds. Announcing a stage
 * and starting it in the same turn means `onStage` never reaches the screen
 * until the work is already done, so a run that is two seconds into reading a
 * file still reads "waiting for data". The `await` costs one macrotask.
 *
 * It does not make those stages animate — nothing can, while they hold the
 * thread. It makes the app say the true thing about what it is doing.
 */
const paint = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

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

/** What a run starts from: a path on disk, or a dataset already in memory —
 *  the bundled samples arrive the second way, and everything after ingest
 *  must not care which it was. */
export type PipelineSource = string | { dataset: Dataset };

export async function runPipeline(
  source: PipelineSource,
  onStage: (e: StageEvent) => void,
): Promise<{ ok: true; value: PipelineResult } | { ok: false; error: string }> {
  // 1 — ingest
  onStage({ stage: "ingest", state: "active" });
  await paint();
  let raw: Dataset;
  if (typeof source === "string") {
    const loaded = await loadDataset(source);
    if (!loaded.ok) {
      onStage({ stage: "ingest", state: "failed", detail: loaded.error });
      return { ok: false, error: loaded.error };
    }
    raw = loaded.dataset;
  } else {
    raw = source.dataset;
  }
  onStage({
    stage: "ingest",
    state: "done",
    detail: `${raw.rows.length.toLocaleString()} rows x ${raw.columns.length} cols${typeof source === "string" ? "" : " (sample)"}`,
  });

  // 2 — clean, to a fixed point
  onStage({ stage: "clean", state: "active" });
  await paint();
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
  await paint();
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
  await paint();
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
  await paint();
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
