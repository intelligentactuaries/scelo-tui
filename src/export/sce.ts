// The .sce project file — what the Scelo IDE actually opens.
//
// This mirrors apps/web/src/components/Scelo/projectFile.ts byte for byte in
// spirit: magic "scelo-project", version 1, a StoredSessionSnapshot inside.
// The TUI and the IDE share `@scelo/core`, so the dataset serialises in the
// IDE's own shape without translation — this file IS a Scelo save, not an
// imitation of one. (The extension is .sce, not .scelo — checked against the
// IDE source rather than guessed from the product name.)
//
// Two honesty rules shape what goes in:
//   - `selectedModels` names the catalog's `descriptive` model, because that
//     is what a TUI quick-analysis IS in catalog terms. Claiming
//     `glm-frequency` because our frequency profile shares a word with it
//     would make the IDE's export screen generate a GLM nobody fitted.
//   - `runs` stays empty. The IDE's RunResult wants a numeric headline; ours
//     is prose. Fabricating a number to fill the slot would put a fake KPI
//     on a result card. The events log carries what actually happened.

import type { PipelineResult } from "../agent/pipeline";

export const SCE_MAGIC = "scelo-project";
export const SCE_VERSION = 1;
export const SCE_EXTENSION = ".sce";

/** Matches the IDE's slugify: lowercase, keep [a-z0-9_-], collapse the rest
 *  to hyphens, cap at 60, never empty. */
export function slugify(raw: string): string {
  const s = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return s || "scelo-project";
}

export function sceFilename(datasetName: string): string {
  return `${slugify(datasetName.replace(/\.(csv|tsv|txt|parquet)$/i, ""))}${SCE_EXTENSION}`;
}

/** The activity-log slice of the session. The IDE's script exporters replay
 *  these events in order, so the .sce round-trips into the IDE's own
 *  Python/R export screens with the load + clean + pick steps intact. */
function buildEvents(pipe: PipelineResult, now: Date): unknown[] {
  const t0 = now.getTime();
  const events: unknown[] = [
    {
      ts: t0,
      stage: "soft",
      kind: "dataset.load",
      payload: {
        name: pipe.dataset.name,
        rows: pipe.dataset.rows.length,
        cols: pipe.dataset.columns.length,
        columns: pipe.dataset.columns,
        source: "import",
      },
    },
  ];
  const clean = pipe.clean;
  const opLabels = clean?.passes.flatMap((p) => p.opLabels) ?? [];
  // The IDE's cleaning.auto outcome has no "empty" arm — but an empty
  // dataset never gets this far, and a no-op clean is not worth an event.
  if (clean && opLabels.length > 0 && clean.outcome !== "empty") {
    events.push({
      ts: t0 + 1,
      stage: "soft",
      kind: "cleaning.auto",
      payload: {
        passes: clean.passes.length,
        outcome: clean.outcome,
        opLabels,
        rowsBefore: clean.rowsBefore,
        rowsAfter: clean.rowsAfter,
        columnsBefore: clean.columnsBefore,
        columnsAfter: clean.columnsAfter,
        droppedColumns: clean.droppedColumns,
      },
    });
  }
  if (pipe.chosen) {
    events.push({
      ts: t0 + 2,
      stage: "tools",
      kind: "models.aiPick",
      payload: {
        domain: "general",
        models: [{ id: "descriptive", rationale: pipe.rationale }],
        summary: `${pipe.chosen.label} — ${pipe.rationale}`,
        source: "ai",
      },
    });
    if (pipe.result) {
      events.push({
        ts: t0 + 3,
        stage: "hard",
        kind: "runs.execute",
        payload: { models: ["descriptive"] },
      });
    }
  }
  return events;
}

export function buildSce(pipe: PipelineResult, now: Date): string {
  const file = {
    format: SCE_MAGIC,
    version: SCE_VERSION,
    app: "Scelo",
    savedAt: now.toISOString(),
    project: null,
    session: {
      dataset: pipe.dataset,
      filters: [],
      selectedModels: pipe.chosen
        ? [{ id: "descriptive", enabled: true, source: "ai", rationale: pipe.rationale }]
        : [],
      domain: pipe.chosen ? "general" : null,
      pickSummary: pipe.chosen ? `${pipe.chosen.label} — ${pipe.rationale}` : null,
      picksDatasetName: pipe.chosen ? pipe.dataset.name : null,
      modelWires: [],
      runs: {},
      derivedColumns: {},
      transformLog: [],
      events: buildEvents(pipe, now),
    },
  };
  return `${JSON.stringify(file)}\n`;
}
