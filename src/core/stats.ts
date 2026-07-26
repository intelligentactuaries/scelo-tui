// Statistics the analysis menu needs and @scelo/core does not provide.
//
// Everything here is pure and takes plain arrays, because the callers are
// analyses that must run identically here and in the exported scripts — a
// helper that is easy to state in one line of pandas or base R is a helper
// whose semantics are safe to reimplement three times.

/** Pearson correlation. NaN-free by construction: pairs where either side is
 *  not finite are dropped first, and a degenerate column (constant, or fewer
 *  than 3 usable pairs) returns null rather than 0 — "no correlation" and
 *  "no evidence" are different answers. */
export function pearson(xs: number[], ys: number[]): number | null {
  const n = Math.min(xs.length, ys.length);
  let m = 0;
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < n; i++) {
    if (Number.isFinite(xs[i]) && Number.isFinite(ys[i])) {
      m++;
      sx += xs[i];
      sy += ys[i];
    }
  }
  if (m < 3) return null;
  const mx = sx / m;
  const my = sy / m;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    if (Number.isFinite(xs[i]) && Number.isFinite(ys[i])) {
      const dx = xs[i] - mx;
      const dy = ys[i] - my;
      sxy += dx * dy;
      sxx += dx * dx;
      syy += dy * dy;
    }
  }
  if (sxx === 0 || syy === 0) return null;
  return sxy / Math.sqrt(sxx * syy);
}

/** Gini coefficient of a non-negative vector — the standard measure of how
 *  concentrated a book's premium or claims are. 0 is perfectly even, values
 *  toward 1 mean a few risks carry the total. Negative inputs are rejected
 *  (the formula's geometry stops meaning anything) and an all-zero vector is
 *  0 by convention: nothing is concentrated when there is nothing. */
export function gini(values: number[]): number | null {
  const xs = values.filter((v) => Number.isFinite(v));
  if (xs.length === 0 || xs.some((v) => v < 0)) return null;
  const sorted = [...xs].sort((a, b) => a - b);
  const n = sorted.length;
  let total = 0;
  let weighted = 0;
  for (let i = 0; i < n; i++) {
    total += sorted[i];
    weighted += (i + 1) * sorted[i];
  }
  if (total === 0) return 0;
  return (2 * weighted) / (n * total) - (n + 1) / n;
}

/** Share of the total held by the largest `frac` of values — "the top 10% of
 *  policies carry 62% of claims". `frac` in (0, 1]. The head is
 *  ceil(n·frac): with 10 policies, "top 5%" still means the single largest
 *  one rather than an empty set. */
export function topShare(values: number[], frac: number): number | null {
  const xs = values.filter((v) => Number.isFinite(v) && v >= 0);
  if (xs.length === 0 || !(frac > 0) || frac > 1) return null;
  const sorted = [...xs].sort((a, b) => b - a);
  const total = sorted.reduce((a, b) => a + b, 0);
  if (total === 0) return 0;
  const take = Math.max(1, Math.ceil(sorted.length * frac));
  let head = 0;
  for (let i = 0; i < take; i++) head += sorted[i];
  return head / total;
}

/** Decile totals, largest decile first — the shape a concentration bar chart
 *  wants. Deciles are by count (equal-population), not by value. */
export function decileShares(values: number[]): number[] {
  const xs = values.filter((v) => Number.isFinite(v) && v >= 0).sort((a, b) => b - a);
  if (xs.length === 0) return [];
  const total = xs.reduce((a, b) => a + b, 0);
  if (total === 0) return new Array(Math.min(10, xs.length)).fill(0);
  const buckets = Math.min(10, xs.length);
  const shares: number[] = [];
  for (let d = 0; d < buckets; d++) {
    const from = Math.floor((d * xs.length) / buckets);
    const to = Math.floor(((d + 1) * xs.length) / buckets);
    let s = 0;
    for (let i = from; i < to; i++) s += xs[i];
    shares.push(s / total);
  }
  return shares;
}
