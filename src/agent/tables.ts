// Actuarial tables — the vocabulary the Scelo IDE gave every stage chat in
// 0.2 (apps/web/.../useActuarialTableChat.ts), brought to the terminal.
//
// The engine is shared, not ported: `@scelo/core`'s actuarialTables builds
// life tables, commutation columns, annuity/assurance factors, net premium
// grids, run-off triangles, discount curves, A/E studies and model points,
// deterministically, from a spec. What lives here is only the glue a
// terminal needs:
//
//   - suggestions, read off the loaded data (`/tables` lists them),
//   - the deterministic path: a typed request ("build a life table at 4 %
//     from age 20 to 100") is parsed and built locally — no model in the
//     loop, so it works offline, exactly as it does in the IDE,
//   - the model path: the same ```table protocol the IDE teaches its chats,
//     so a free-form reply can PROPOSE a table and Scelo builds it. The model
//     never types the numbers; it only names the spec.
//
// Built tables are kept for the session in the IDE's WorkspaceTable shape,
// so the .sce export hands them to the IDE unchanged.

import {
  ACTUARIAL_TABLE_KINDS,
  type ActuarialTableSpec,
  type Dataset,
  type TableSuggestion,
  coerceTableSpec,
  describeTableSpec,
  generateActuarialTable,
  parseTablePrompt,
  suggestActuarialTables,
} from "@scelo/core";
import type { ModelResult } from "./analyses";

export type TableOrigin = "chat" | "suggestion" | "llm";

/** The IDE's WorkspaceTable (sceloContext.tsx), field for field — it is what
 *  the .sce `tables` array holds. */
export type SessionTable = {
  id: string;
  title: string;
  spec: ActuarialTableSpec;
  dataset: Dataset;
  notes: string[];
  basisLabel: string;
  sourceDataset: string | null;
  origin: TableOrigin;
  createdAt: number;
};

/** The IDE keeps a dozen; so does the session here. Oldest go first. */
export const MAX_TABLES = 12;

/** "suggest tables", "which tables could I build?", "table ideas" — the
 *  IDE's SUGGEST_RE, so the two answer the same sentences. One deliberate
 *  difference: a definition question ("what is a life table?") is left to
 *  the model, which can explain; a list of suggestions does not answer it. */
const SUGGEST_RE =
  /\b(suggest|recommend|propose|what|which|any|ideas?)\b.*\b(tables?)\b|\btables? (i|we) (can|could|should) (build|make|create)|\btable ideas\b/;

const DEFINITION_RE = /^(what|how|why)\s+(is|are|does|do)\s+(a|an|the)?\s*[\w\s/-]*tables?\b(?!.*\b(could|can|should|would|fit|suit|build|make)\b)/;

export function isSuggestRequest(text: string): boolean {
  const t = text.toLowerCase().trim();
  if (DEFINITION_RE.test(t)) return false;
  return SUGGEST_RE.test(t) && /\btables?\b/.test(t);
}

export function suggestTables(dataset: Dataset | null, prompt?: string | null): TableSuggestion[] {
  return suggestActuarialTables(dataset, prompt ?? null);
}

/** A typed request → spec, or null when the text is not a table request
 *  (questions like "what is a life table?" fall through to the model). */
export function parseRequest(text: string, dataset: Dataset | null): ActuarialTableSpec | null {
  return parseTablePrompt(text, dataset);
}

/** The IDE's `tableIdFor` (actuarialTableUi.tsx), byte for byte: keys
 *  sorted, undefined dropped, `title` ignored, the source dataset folded in
 *  only when the spec reads it. Same spec, same id — in either app — so a
 *  rebuild replaces rather than duplicates, and a .sce round-trip agrees. */
export function tableIdFor(spec: ActuarialTableSpec, sourceDataset: string | null): string {
  const { title: _title, ...rest } = spec as ActuarialTableSpec & { title?: string };
  const raw = `${sourceDataset ?? "-"}|${stableStringify(rest)}`;
  let h = 0;
  for (let i = 0; i < raw.length; i++) h = (h * 31 + raw.charCodeAt(i)) | 0;
  return `tbl-${spec.kind}-${(h >>> 0).toString(36)}`;
}

function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    const keys = Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`).join(",")}}`;
  }
  return JSON.stringify(v);
}

/** True when the spec reads columns from the loaded data, as opposed to a
 *  purely parametric table (the IDE's `specReadsDataset`). */
export function specReadsDataset(spec: ActuarialTableSpec): boolean {
  switch (spec.kind) {
    case "life-table":
    case "commutation":
    case "annuity-assurance":
    case "net-premium":
      return spec.basis.kind !== "gompertz-makeham";
    case "runoff-triangle":
    case "exposure-ae":
    case "model-points":
      return true;
    case "discount-curve":
      return Boolean(spec.tenorColumn && spec.rateColumn);
  }
}

/** Build one. Throws with a message the chat can show. */
export function buildTable(
  spec: ActuarialTableSpec,
  dataset: Dataset | null,
  origin: TableOrigin,
  now: number = Date.now(),
): SessionTable {
  const g = generateActuarialTable(spec, dataset);
  const source = specReadsDataset(spec) ? (dataset?.name ?? null) : null;
  return {
    id: tableIdFor(spec, source),
    title: g.title,
    spec,
    dataset: g.dataset,
    notes: g.notes,
    basisLabel: g.basisLabel,
    sourceDataset: source,
    origin,
    createdAt: now,
  };
}

/** Add to the session list: a rebuild replaces its earlier self in place of
 *  duplicating, and the list is capped from the oldest end. */
export function keepTable(list: SessionTable[], t: SessionTable): SessionTable[] {
  const rest = list.filter((x) => x.id !== t.id);
  return [...rest, t].slice(-MAX_TABLES);
}

/** The table as a HARD-pane result: same Table widget, same /copy, same
 *  expandable footer as an analysis.
 *
 *  `compact` is for the screen only. The engine already rounds each column
 *  to what it means (qx and px to 5 dp, dx to 2); what does not fit a
 *  56-column pane is the big ones — Lx 99987.52, Tx 6591308.82 — and eight
 *  columns fighting for width truncate everything to "0.000…". So values
 *  from 1,000 up lose their decimals and everything else is held to six
 *  significant figures. Per value, never per column: a column-wide rule
 *  keyed on the largest value rounded qx to 0 because qx reaches 1 at the
 *  last age. /copy and /export keep full precision. */
export function tableAsResult(t: SessionTable, opts: { compact?: boolean } = {}): ModelResult {
  const cols = t.dataset.columns;
  const shown = (v: number): number =>
    !opts.compact || !Number.isFinite(v) || v === 0
      ? v
      : Math.abs(v) >= 1000
        ? Math.round(v)
        : Number(v.toPrecision(6));
  return {
    // The title already carries the basis where it matters ("Life table ·
    // Gompertz–Makeham (illustrative)"); the basis label repeats it.
    headline: t.title,
    columns: cols,
    rows: t.dataset.rows.map((r) =>
      cols.map((c) => {
        const v = r[c];
        if (typeof v === "number") return shown(v);
        return v === null || v === undefined ? "" : String(v);
      }),
    ),
  };
}

/** What the chat says after a build. */
export function builtLine(t: SessionTable): string {
  const r = t.dataset.rows.length;
  const c = t.dataset.columns.length;
  const lines = [
    `built ${t.title} — ${r.toLocaleString()} row${r === 1 ? "" : "s"} × ${c} cols`,
    "in HARD now · /copy table · /export writes it as csv",
  ];
  // The notes (illustrative basis, grouping loss, …) are paragraphs; a
  // chat turn clips them to "…". They go where there is room: the HARD
  // bot's context, and the .sce the IDE opens.
  return lines.join("\n");
}

/** Why a build failed, with the columns to name next time. */
export function buildFailedLine(spec: ActuarialTableSpec, e: unknown, dataset: Dataset | null): string {
  const msg = e instanceof Error ? e.message : String(e);
  const cols = dataset
    ? ` — columns here: ${dataset.columns.slice(0, 12).join(", ")}${dataset.columns.length > 12 ? ", …" : ""}`
    : ' — no dataset loaded; ask for a parametric one ("life table on the illustrative basis at 4 %")';
  return `couldn't build ${describeTableSpec(spec)}: ${msg}${cols}`;
}

/** `/tables` when nothing in the data reads as a table. */
export function noSuggestionsLine(dataset: Dataset | null): string {
  return dataset
    ? `nothing in ${dataset.name} reads as an actuarial table (age + mortality, origin × development, tenor + rate, a policy file). Parametric ones still work: "build a life table on the illustrative Gompertz-Makeham basis at 4 %", "build discount factors at a flat 5 %".`
    : 'no data loaded — parametric tables still work: "build a life table on the illustrative Gompertz-Makeham basis at 4 % from age 20 to 110".';
}

/**
 * The system-prompt addendum that teaches a chat model the ```table block —
 * the IDE's `tableProtocol`, kept word for word where the meaning is the
 * same, so a model behaves alike in both. Short on purpose: it rides on
 * every turn.
 */
export function tableProtocol(
  dataset: Dataset | null,
  suggestions: TableSuggestion[],
  tables: SessionTable[],
): string {
  const cols = dataset ? dataset.columns.slice(0, 40).join(", ") : "(no dataset loaded)";
  const sug = suggestions.length
    ? `Tables Scelo already thinks fit this data: ${suggestions.map((s) => `${s.kind} (${s.title})`).join("; ")}.`
    : "";
  const built = tables.length ? `Tables already built this session: ${tables.map((t) => t.title).join("; ")}.` : "";
  return `
ACTUARIAL TABLES. When the user asks you to build/derive/create an actuarial table, answer with ONE fenced block tagged \`table\` containing a JSON spec, plus one sentence of context. Scelo builds the table deterministically from the spec against the active dataset (columns: ${cols}) and shows it in the HARD pane. Never type the numbers yourself.
Kinds and fields:
- {"kind":"life-table","basis":B,"ages":{"from":20,"to":110},"radix":100000}
- {"kind":"commutation","basis":B,"interest":0.04,"ages":{...}}
- {"kind":"annuity-assurance","basis":B,"interest":0.04,"term":20}
- {"kind":"net-premium","basis":B,"interest":0.04,"product":"term|endowment|whole-life","ages":{"from":20,"to":65,"step":5},"terms":[10,20,30]}
- {"kind":"runoff-triangle","originColumn":"…","developmentColumn":"…" or "paymentColumn":"…","valueColumn":"…","cumulative":true}
- {"kind":"discount-curve","points":[{"tenor":1,"rate":0.03},…] or "tenorColumn"/"rateColumn" or "flatRate":0.04,"maxTenor":60}
- {"kind":"exposure-ae","ageColumn":"…","deathsColumn":"…","exposureColumn":"…","expected":B,"bandWidth":5}
- {"kind":"model-points","ageColumn":"…","sexColumn":"…","termColumn":"…","sumAssuredColumn":"…","bandWidth":5}
where basis B is one of {"kind":"qx-column","ageColumn":"…","qxColumn":"…"}, {"kind":"lx-column","ageColumn":"…","lxColumn":"…"}, {"kind":"deaths-exposure","ageColumn":"…","deathsColumn":"…","exposureColumn":"…"}, or {"kind":"gompertz-makeham"} (Scelo's illustrative A=0.00022, B=2.7e-6, c=1.124 — say so when you use it). Only name columns that exist. Interest as a decimal.
${sug} ${built}
If the user is unsure what to build, list two or three tables that fit the data with a one-line reason each and the prompt they could send.`.trim();
}

const TABLE_FENCE = /```table[^\S\n]*\n?([\s\S]*?)```/i;
const JSON_FENCE = /```(?:json)?[^\S\n]*\n([\s\S]*?)```/i;

/**
 * The table spec in a model reply, parsed and validated — or null when the
 * reply has none. A block that is there but malformed comes back as an
 * error, so the chat can say so rather than silently drop it.
 *
 * The protocol asks for a ```table fence, and that is always honoured. Small
 * models also answer with ```json (seen from Haiku through Claude Code), so
 * a json or untagged fence counts too — but only when the object inside
 * names a real table kind, so a reply that merely shows some JSON is left
 * alone.
 */
export function extractTableSpec(
  reply: string,
): { spec: ActuarialTableSpec; rest: string } | { error: string; rest: string } | null {
  const tagged = TABLE_FENCE.exec(reply);
  let fence: RegExp = TABLE_FENCE;
  let body = tagged?.[1];
  if (!tagged) {
    const loose = JSON_FENCE.exec(reply);
    if (!loose) return null;
    let kind: unknown;
    try {
      const o = JSON.parse(loose[1].trim()) as Record<string, unknown>;
      kind = o?.kind ?? o?.type ?? o?.table;
    } catch {
      return null;
    }
    if (typeof kind !== "string" || !(ACTUARIAL_TABLE_KINDS as readonly string[]).includes(kind)) return null;
    fence = JSON_FENCE;
    body = loose[1];
  }
  const rest = reply.replace(fence, "").replace(/\n{3,}/g, "\n\n").trim();
  try {
    return { spec: coerceTableSpec(JSON.parse((body ?? "").trim())), rest };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e), rest };
  }
}

/** The IDE's chip labels, for the pick-list. */
export function shortLabel(kind: TableSuggestion["kind"]): string {
  switch (kind) {
    case "life-table":
      return "life table";
    case "commutation":
      return "commutation";
    case "annuity-assurance":
      return "annuity factors";
    case "net-premium":
      return "premium table";
    case "runoff-triangle":
      return "triangle";
    case "discount-curve":
      return "discount curve";
    case "exposure-ae":
      return "A/E table";
    case "model-points":
      return "model points";
  }
}
