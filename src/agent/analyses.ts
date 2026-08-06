// The analysis menu — what the agent can choose to run.
//
// Eight entries, grown from the walking skeleton's three. The bar for being
// on this menu: the result must read in a ~45-column pane (a table and one
// bar series), run headlessly in under a second on 200k rows, and answer a
// question an actuary actually asks of a fresh dataset. The IDE's full
// catalog is ~30 models; everything here maps to its `descriptive` family —
// profiling and screening, not fitting. Model FITS (chain-ladder, GLMs,
// Lee-Carter) stay in the IDE where there is room to show diagnostics;
// pretending to fit a GLM in a terminal pane would produce a number nobody
// should trust.
//
// Every entry: `applies` decides eligibility from the column profile ALONE
// (cheap, runs before the LLM sees the menu), `run` computes from raw rows.
// Both are pure, which is what makes them testable and what makes the
// exported scripts honest — anything computed here can be restated in pandas
// or base R without translation loss.

import type { CellValue, ColumnMeta, Dataset } from "@scelo/core";
import { boxStats, profileNumericColumns } from "@scelo/core";
import { type DatePoint, binPoints, chooseBin, parseDateUTC, spanDays } from "../core/dates";
import { decileShares, gini, pearson, topShare } from "../core/stats";

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

// ── column heuristics ─────────────────────────────────────────────────────
// Shared by several analyses AND by the export snippets, so a script's
// groupby lands on the same columns the pane showed. Deterministic on
// purpose: the same dataset must always pick the same columns.

const VALUE_NAME = /premium|claim|loss|amount|paid|incurred|cost|exposure|benefit|salary|sum_?insured|value/i;

export function numericColumns(metas: ColumnMeta[]): ColumnMeta[] {
  return metas.filter((m) => m.type === "number" && m.min !== undefined);
}

/** Rough column total from the profile — the ranking signal for "which
 *  number is the money". */
function metaTotal(m: ColumnMeta): number {
  return Math.abs(m.mean ?? 0) * Math.max(0, m.count - m.missing);
}

/** The numeric column an actuary would call the value: named like money if
 *  any is, else the one carrying the largest total. */
export function valueColumn(metas: ColumnMeta[]): ColumnMeta | null {
  const nums = numericColumns(metas);
  if (nums.length === 0) return null;
  const named = nums.filter((m) => VALUE_NAME.test(m.name));
  const pool = named.length > 0 ? named : nums;
  return [...pool].sort((a, b) => metaTotal(b) - metaTotal(a) || a.name.localeCompare(b.name))[0];
}

/** A categorical worth splitting by: 2..`maxLevels` distinct values, and the
 *  RICHEST such split (most levels) — mean premium by region beats mean
 *  premium by sex when both exist. The frequency profile wants the opposite
 *  (fewest levels) and keeps its own rule. */
export function groupColumn(metas: ColumnMeta[], maxLevels = 12): ColumnMeta | null {
  const cats = metas.filter((m) => m.type === "string" && m.unique >= 2 && m.unique <= maxLevels);
  if (cats.length === 0) return null;
  return [...cats].sort((a, b) => b.unique - a.unique || a.name.localeCompare(b.name))[0];
}

export function dateColumn(metas: ColumnMeta[]): ColumnMeta | null {
  return metas.find((m) => m.type === "date") ?? null;
}

/** The frequency profile's categorical: the TIGHTEST usable split, opposite
 *  of groupColumn's richest — an exposure profile over 40 levels is noise,
 *  over 4 it is a picture. */
export function frequencyColumn(metas: ColumnMeta[]): ColumnMeta | null {
  return (
    metas
      .filter((m) => m.type === "string" && m.unique > 1 && m.unique <= 40)
      .sort((a, b) => a.unique - b.unique || a.name.localeCompare(b.name))[0] ?? null
  );
}

/** Columns the correlation screen looks at: numeric, ranked by total so the
 *  money survives the cut, capped so the pair count stays readable. Exported
 *  because the generated pandas/R must screen the SAME columns the pane did. */
export function correlationColumns(metas: ColumnMeta[], cap = 12): ColumnMeta[] {
  return [...numericColumns(metas)]
    .sort((a, b) => metaTotal(b) - metaTotal(a) || a.name.localeCompare(b.name))
    .slice(0, cap);
}

function num(v: CellValue): number {
  return typeof v === "number" && Number.isFinite(v) ? v : Number.NaN;
}

function fmt(n: number | undefined): string {
  if (n === undefined || !Number.isFinite(n)) return "—";
  const a = Math.abs(n);
  if (a >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
  return String(Math.round(n * 100) / 100);
}

const pct = (x: number) => `${(100 * x).toFixed(1)}%`;

// ── the menu ──────────────────────────────────────────────────────────────

export const MODELS: ModelChoice[] = [
  {
    id: "numeric-summary",
    label: "Descriptive summary",
    applies: (m) => numericColumns(m).length > 0,
    run: (d, metas) => {
      // The SAME profile the IDE's descriptive report computes
      // (@scelo/core's profileNumericColumns): type-7 quantiles, sample sd,
      // CV — in the same CV-ranked (scale-free) order, so the two surfaces
      // can never print different numbers for the same file. The columns
      // are the IDE result card's, minus min/max: seven is what stays
      // legible at this pane's width, the histogram series shows the range,
      // and the outliers analysis owns the extremes. The exported script
      // restates the full nine-column card.
      const profiles = profileNumericColumns(d);
      const gappy = profiles.filter((p) => p.missingPct > 0.1).length;
      const lead = profiles[0];
      const leadBins = lead ? metas.find((m) => m.name === lead.name)?.histogramBins : undefined;
      return {
        headline:
          `${profiles.length} numeric column${profiles.length === 1 ? "" : "s"} described, ` +
          `widest relative spread first${gappy > 0 ? ` · ${gappy} >10% missing` : ""}`,
        columns: ["column", "n", "miss %", "mean", "sd", "cv", "median"],
        rows: profiles.map((p) => [
          p.name,
          p.count,
          p.missing === 0 ? "0%" : `${(p.missingPct * 100).toFixed(1)}%`,
          fmt(p.mean),
          fmt(p.sd),
          p.cv === null ? "—" : fmt(p.cv),
          fmt(p.median),
        ]),
        series:
          lead && leadBins ? { label: `${lead.name} distribution`, values: leadBins } : undefined,
      };
    },
  },
  {
    id: "group-metric",
    label: "Value by segment",
    applies: (m) => valueColumn(m) !== null && groupColumn(m) !== null,
    run: (dataset, metas) => {
      const value = valueColumn(metas);
      const cat = groupColumn(metas);
      if (!value || !cat) throw new Error("no value/segment columns"); // applies() guards
      const acc = new Map<string, { n: number; sum: number }>();
      for (const row of dataset.rows) {
        const v = num(row[value.name]);
        if (!Number.isFinite(v)) continue;
        const level = row[cat.name] == null ? "(missing)" : String(row[cat.name]);
        const cur = acc.get(level) ?? { n: 0, sum: 0 };
        cur.n++;
        cur.sum += v;
        acc.set(level, cur);
      }
      const total = [...acc.values()].reduce((s, g) => s + g.sum, 0) || 1;
      const levels = [...acc.entries()].sort((a, b) => b[1].sum - a[1].sum);
      return {
        headline: `\`${value.name}\` across \`${cat.name}\` (${levels.length} segments)`,
        columns: ["segment", "n", "mean", "total", "share"],
        rows: levels.map(([lv, g]) => [lv, g.n, fmt(g.sum / g.n), fmt(g.sum), pct(g.sum / total)]),
        series: { label: `${value.name} total by ${cat.name}`, values: levels.map(([, g]) => g.sum) },
      };
    },
  },
  {
    id: "frequency",
    label: "Frequency / exposure profile",
    applies: (m) => m.some((x) => x.type === "string" && x.unique > 1 && x.unique <= 40),
    run: (_d, metas) => {
      const cat = frequencyColumn(metas);
      const top = cat?.topValues ?? [];
      const total = top.reduce((s, t) => s + t.count, 0) || 1;
      return {
        headline: `Exposure across \`${cat?.name ?? "?"}\` (${cat?.unique ?? 0} levels)`,
        columns: ["level", "count", "share"],
        rows: top.map((t) => [t.value, t.count, pct(t.count / total)]),
        series: { label: `${cat?.name ?? ""} counts`, values: top.map((t) => t.count) },
      };
    },
  },
  {
    id: "time-profile",
    label: "Time profile",
    applies: (m) => dateColumn(m) !== null,
    run: (dataset, metas) => {
      const dc = dateColumn(metas);
      if (!dc) throw new Error("no date column"); // applies() guards
      const value = valueColumn(metas);
      const points: DatePoint[] = [];
      const weights: number[] = [];
      for (const row of dataset.rows) {
        const p = parseDateUTC(row[dc.name]);
        if (!p) continue;
        points.push(p);
        if (value) weights.push(num(row[value.name]));
      }
      if (points.length === 0) {
        return {
          headline: `\`${dc.name}\` held no parseable dates`,
          columns: ["period", "records"],
          rows: [],
        };
      }
      const sorted = [...points].sort(
        (a, b) => a.y - b.y || a.m - b.m || a.d - b.d,
      );
      const bin = chooseBin(spanDays(sorted[0], sorted[sorted.length - 1]));
      const rows = binPoints(points, bin, value ? weights : undefined);
      const gaps = rows.filter((r) => r.count === 0).length;
      return {
        headline: `\`${dc.name}\` by ${bin} — ${rows.length} periods${gaps ? `, ${gaps} empty` : ""}`,
        columns: value ? ["period", "records", `${value.name} total`] : ["period", "records"],
        rows: rows.map((r) => (value ? [r.key, r.count, fmt(r.sum)] : [r.key, r.count])),
        series: { label: "records per period", values: rows.map((r) => r.count) },
      };
    },
  },
  {
    id: "concentration",
    label: "Concentration / Gini",
    applies: (m) => {
      const v = valueColumn(m);
      return v !== null && (v.min ?? -1) >= 0 && v.unique > 5;
    },
    run: (dataset, metas) => {
      const value = valueColumn(metas);
      if (!value) throw new Error("no value column"); // applies() guards
      const xs = dataset.rows.map((r) => num(r[value.name])).filter((v) => Number.isFinite(v) && v >= 0);
      const g = gini(xs);
      const shares: Array<[string, number | null]> = [
        ["top 1%", topShare(xs, 0.01)],
        ["top 5%", topShare(xs, 0.05)],
        ["top 10%", topShare(xs, 0.1)],
        ["top 20%", topShare(xs, 0.2)],
      ];
      return {
        headline: `\`${value.name}\` concentration — Gini ${g === null ? "—" : g.toFixed(2)}`,
        columns: ["largest…", "share of total"],
        rows: shares.map(([label, s]) => [label, s === null ? "—" : pct(s)]),
        series: { label: "decile shares (largest first)", values: decileShares(xs) },
      };
    },
  },
  {
    id: "correlation",
    label: "Correlation screen",
    applies: (m) => numericColumns(m).length >= 2,
    run: (dataset, metas) => {
      // Cap the screen at 12 columns: 66 pairs is readable, 465 is noise.
      const nums = correlationColumns(metas);
      const series = new Map(
        nums.map((m) => [m.name, dataset.rows.map((r) => num(r[m.name]))]),
      );
      const pairs: Array<{ a: string; b: string; r: number }> = [];
      for (let i = 0; i < nums.length; i++) {
        for (let j = i + 1; j < nums.length; j++) {
          const r = pearson(
            series.get(nums[i].name) ?? [],
            series.get(nums[j].name) ?? [],
          );
          if (r !== null) pairs.push({ a: nums[i].name, b: nums[j].name, r });
        }
      }
      pairs.sort((x, y) => Math.abs(y.r) - Math.abs(x.r));
      const top = pairs.slice(0, 8);
      const strong = pairs.filter((p) => Math.abs(p.r) >= 0.7).length;
      return {
        headline: `${pairs.length} pairs screened${strong ? ` — ${strong} strong (|r| ≥ 0.7)` : ""}`,
        columns: ["a", "b", "r"],
        rows: top.map((p) => [p.a, p.b, `${p.r >= 0 ? "+" : ""}${p.r.toFixed(2)}`]),
        series: { label: "|r| of top pairs", values: top.map((p) => Math.abs(p.r)) },
      };
    },
  },
  {
    id: "outliers",
    label: "Outlier audit",
    applies: (m) => numericColumns(m).length > 0,
    run: (dataset, metas) => {
      const findings: Array<{ name: string; n: number; count: number; lo: number; hi: number }> = [];
      for (const m of numericColumns(metas)) {
        const xs = dataset.rows.map((r) => num(r[m.name])).filter(Number.isFinite);
        const box = boxStats(xs);
        if (!box) continue;
        // stats is [lo whisker, q1, median, q3, hi whisker]; anything the
        // whiskers exclude is in `outliers`.
        findings.push({
          name: m.name,
          n: xs.length,
          count: box.outliers.length,
          lo: box.stats[0],
          hi: box.stats[4],
        });
      }
      findings.sort((a, b) => b.count / Math.max(1, b.n) - a.count / Math.max(1, a.n));
      const flagged = findings.filter((f) => f.count > 0);
      const top = findings.slice(0, 8);
      return {
        headline: `${flagged.length} of ${findings.length} numeric columns carry outliers (1.5·IQR)`,
        columns: ["column", "outliers", "%", "fence lo", "fence hi"],
        rows: top.map((f) => [
          f.name,
          f.count,
          pct(f.count / Math.max(1, f.n)),
          fmt(f.lo),
          fmt(f.hi),
        ]),
        series: { label: "outlier counts", values: top.map((f) => f.count) },
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
          pct(m.missing / Math.max(1, m.count)),
        ]),
        series: {
          label: "missing %",
          values: withGaps.map((m) => (100 * m.missing) / Math.max(1, m.count)),
        },
      };
    },
  },
];

export const MODEL_BY_ID: Map<string, ModelChoice> = new Map(MODELS.map((m) => [m.id, m]));

/** Resolve a user's "/run <what>" — by number in the eligible menu, exact id,
 *  or a case-insensitive fragment of the label. Returns null for no match and
 *  the list for an ambiguous one, so the caller can say which. */
export function resolveChoice(
  what: string,
  eligible: ModelChoice[],
): { ok: true; model: ModelChoice } | { ok: false; matches: ModelChoice[] } {
  const q = what.trim().toLowerCase();
  const n = Number(q);
  if (Number.isInteger(n) && n >= 1 && n <= eligible.length) {
    return { ok: true, model: eligible[n - 1] };
  }
  const exact = eligible.find((m) => m.id === q);
  if (exact) return { ok: true, model: exact };
  const partial = eligible.filter(
    (m) => m.label.toLowerCase().includes(q) || m.id.includes(q),
  );
  if (partial.length === 1) return { ok: true, model: partial[0] };
  return { ok: false, matches: partial };
}
