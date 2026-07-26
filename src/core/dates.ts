// Date parsing and binning for the time-profile analysis.
//
// A compact sibling of the web app's dateProfile.ts, carrying over its one
// hard-won rule: never round-trip a date string through `new Date(s)` and the
// local-time getters. `new Date("2024-03-01").getMonth()` is February for
// every user west of UTC, which silently shifts month buckets — the web app
// has a regression test for exactly this. Components are read from the
// string.

export type DatePoint = { y: number; m: number; d: number };

const SHAPE = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[T ].*)?$/;

/** Days in a month, leap-aware — used to reject 2024-02-31 instead of
 *  letting it normalise into March. */
function daysIn(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function parseDateUTC(v: unknown): DatePoint | null {
  if (typeof v !== "string") return null;
  const m = SHAPE.exec(v.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > daysIn(y, mo)) return null;
  return { y, m: mo, d };
}

export type DateBin = "month" | "quarter" | "year";

/** Bucket width for a span, chosen so the series stays plottable in a pane
 *  that shows at most a handful of bars: months up to ~3y, quarters to ~10y,
 *  years beyond. Day/week bins are deliberately absent — a terminal pane
 *  cannot show 400 daily bars, and the analysis reads better aggregated. */
export function chooseBin(spanDays: number): DateBin {
  if (spanDays <= 1100) return "month";
  if (spanDays <= 3700) return "quarter";
  return "year";
}

export function binKey(p: DatePoint, bin: DateBin): string {
  if (bin === "year") return String(p.y);
  if (bin === "quarter") return `${p.y}-Q${Math.floor((p.m - 1) / 3) + 1}`;
  return `${p.y}-${String(p.m).padStart(2, "0")}`;
}

function nextKey(key: string, bin: DateBin): string {
  if (bin === "year") return String(Number(key) + 1);
  if (bin === "quarter") {
    const [y, q] = key.split("-Q").map(Number);
    return q === 4 ? `${y + 1}-Q1` : `${y}-Q${q + 1}`;
  }
  const [y, m] = key.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

export type BinRow = { key: string; count: number; sum: number };

/**
 * Bin points into a dense, gap-filled series: a month with no claims appears
 * as an explicit zero, because an invisible gap is precisely the thing an
 * actuary scanning for missing exposure periods needs to see.
 *
 * `weights` (parallel to `points`) accumulates a value column per bucket —
 * claims amount by quarter — alongside the count. Absent, sum tracks count.
 */
export function binPoints(points: DatePoint[], bin: DateBin, weights?: number[]): BinRow[] {
  if (points.length === 0) return [];
  const acc = new Map<string, { count: number; sum: number }>();
  for (let i = 0; i < points.length; i++) {
    const key = binKey(points[i], bin);
    const cur = acc.get(key) ?? { count: 0, sum: 0 };
    cur.count++;
    const w = weights?.[i];
    cur.sum += w !== undefined && Number.isFinite(w) ? w : 1;
    acc.set(key, cur);
  }
  const keys = [...acc.keys()].sort();
  const out: BinRow[] = [];
  // Walk from first to last key through the calendar, not through the data,
  // so the gaps materialise. Guard: a corrupt key pair that fails to advance
  // must not loop forever.
  let key = keys[0];
  const last = keys[keys.length - 1];
  for (let guard = 0; guard < 4000 && key <= last; guard++) {
    const hit = acc.get(key);
    out.push({ key, count: hit?.count ?? 0, sum: hit?.sum ?? 0 });
    const nk = nextKey(key, bin);
    if (nk <= key) break;
    key = nk;
  }
  return out;
}

/** Inclusive span in days between two points, via UTC so DST cannot make a
 *  span of whole days fractional. */
export function spanDays(a: DatePoint, b: DatePoint): number {
  const ms =
    Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d);
  return Math.round(ms / 86_400_000) + 1;
}
