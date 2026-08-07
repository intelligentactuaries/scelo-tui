// What `/charts` has to show — every plot this session produces, whether it
// was drawn on screen, will be drawn by the exported script, or is waiting
// on an analysis nobody has run yet.
//
// Three sources, deliberately kept in one list rather than three:
//
//   the pane's series   what HARD plots under its table, at full size
//   the export's plots  what analysis.R and analysis.ipynb draw when run
//   the eligible menu   analyses that apply to this data but have not run
//
// A chart that only the export draws (the Lorenz curve) is a real answer to
// "what plots do I get", so it is in the list at the same rank as the rest.
// An analysis that has not run is in the list too, marked, because the
// question "what could this data show me" is the reason to open a gallery.
//
// Building a card RUNS the analysis, which is why that is a separate call
// from listing them: `/charts` on a 200k-row file must open now and compute
// the one chart being looked at, not all eight up front.

import type { ColumnMeta } from "@scelo/core";
import { MODEL_BY_ID, MODELS, type Series } from "../agent/analyses";
import type { PipelineResult } from "../agent/pipeline";
import { snippetFor } from "../export/scripts";
import type { ChartKind } from "./charts";

/** A row in the gallery's list — cheap, computed for every eligible
 *  analysis the moment the screen opens. */
export type ChartEntry = {
  /** Unique in the list: an analysis id, or `<id>:<variant>` for a picture
   *  the analysis does not itself plot. */
  key: string;
  analysisId: string;
  /** The analysis it belongs to. */
  title: string;
  /** What the picture shows, if that differs from the title. */
  subtitle: string;
  /** The session ran this analysis, so the numbers behind it are the ones
   *  the HARD pane showed. */
  ran: boolean;
};

/** A built chart: the entry, plus the numbers and how to draw them. */
export type ChartCard = ChartEntry & {
  kind: ChartKind;
  values: number[];
  labels?: string[];
  unit?: string;
  /** The analysis result's own one-line summary. */
  headline: string;
  /** How the exported artifacts draw this same picture. Absent when the
   *  export has no plot for it. */
  draws: { r?: string; py?: string };
};

/**
 * The list, ordered by how close each chart is to what the user is looking
 * at: the analyses this session ran first (in the order they ran), then
 * everything else the data is eligible for.
 */
export function chartMenu(metas: ColumnMeta[], ranIds: string[]): ChartEntry[] {
  const eligible = MODELS.filter((m) => m.applies(metas));
  const rank = new Map(ranIds.map((id, i) => [id, i]));
  const ordered = [...eligible].sort((a, b) => {
    const ra = rank.get(a.id);
    const rb = rank.get(b.id);
    if (ra !== undefined && rb !== undefined) return ra - rb;
    if (ra !== undefined) return -1;
    if (rb !== undefined) return 1;
    return 0;
  });
  const out: ChartEntry[] = [];
  for (const m of ordered) {
    const ran = rank.has(m.id);
    out.push({ key: m.id, analysisId: m.id, title: m.label, subtitle: "", ran });
    // The one picture the exported script draws that the pane never does.
    // The pane plots the decile shares because that is what fits next to a
    // four-row table; base R and matplotlib get a full canvas and draw the
    // curve those shares came from.
    if (m.id === "concentration") {
      out.push({
        key: "concentration:lorenz",
        analysisId: m.id,
        title: m.label,
        subtitle: "Lorenz curve",
        ran,
      });
    }
  }
  return out;
}

/**
 * Run the entry's analysis and turn its series into a chart.
 *
 * Null when the analysis produces no series, or throws — a chart nobody can
 * draw is not an error worth a banner, it is a gallery entry that says so.
 */
export function buildChart(entry: ChartEntry, pipe: PipelineResult): ChartCard | null {
  const model = MODEL_BY_ID.get(entry.analysisId);
  if (!model) return null;
  let result: { headline: string; series?: Series };
  try {
    result = model.run(pipe.dataset, pipe.metas);
  } catch {
    return null;
  }
  const draws = drawnBy(entry.analysisId, pipe.metas);
  if (entry.key === "concentration:lorenz") {
    const curve = lorenzFrom(result.series?.values ?? []);
    if (curve.length < 3) return null;
    return {
      ...entry,
      kind: "lorenz",
      values: curve,
      labels: curve.map((_, i) =>
        i === 0 ? "0%" : i === curve.length - 1 ? "100%" : "",
      ),
      unit: "",
      headline: result.headline,
      draws,
    };
  }
  const series = result.series;
  if (!series || series.values.length === 0) return null;
  return {
    ...entry,
    kind: series.kind ?? "bars",
    values: series.values,
    labels: series.labels,
    unit: series.unit,
    subtitle: entry.subtitle || series.label,
    headline: result.headline,
    draws,
  };
}

/**
 * Cumulative share of the total against cumulative share of the population,
 * poorest first — the curve `analysis.R` plots.
 *
 * `decileShares` hands back the shares LARGEST first (that is the order the
 * concentration table reads in), so the curve is built by walking them
 * backwards. The leading zero is the origin: a Lorenz curve that starts at
 * its first decile instead of at (0, 0) is missing the point it is measured
 * against.
 */
export function lorenzFrom(sharesLargestFirst: number[]): number[] {
  if (sharesLargestFirst.length === 0) return [];
  const total = sharesLargestFirst.reduce((a, b) => a + b, 0) || 1;
  const out = [0];
  let cum = 0;
  for (let i = sharesLargestFirst.length - 1; i >= 0; i--) {
    cum += sharesLargestFirst[i] / total;
    out.push(cum);
  }
  return out;
}

/** The call in R and in Python that draws this analysis's plot in the
 *  exported artifacts — the whole reason an un-run analysis is worth listing.
 *  Trimmed to the drawing call itself; the file has the rest. */
function drawnBy(id: string, metas: ColumnMeta[]): { r?: string; py?: string } {
  const snip = snippetFor(id, metas);
  if (!snip) return {};
  return { r: drawingCall(snip.rPlot), py: drawingCall(snip.pyPlot) };
}

/**
 * The first call that actually DRAWS, joined back together if the generator
 * wrapped it over several lines.
 *
 * Both halves matter. `op <- par(mfrow = ...)` is the line before the one
 * that draws, and taking it would caption a histogram with a layout call;
 * `barplot(top$total, names.arg = rownames(top), las = 2,` is a real drawing
 * call cut mid-argument, and showing it with its trailing comma reads as a
 * bug in the export rather than a wrap in the display.
 */
function drawingCall(lines: string[] | undefined): string | undefined {
  const src = (lines ?? []).map((l) => l.trim());
  const start = src.findIndex(isDrawing);
  if (start === -1) return undefined;
  let call = src[start];
  // Keep taking continuation lines until the parentheses balance. Bounded by
  // the snippet, so an unbalanced one costs the rest of it and not a hang.
  for (let i = start + 1; i < src.length && depth(call) > 0; i++) {
    call += ` ${src[i]}`;
  }
  return call.replace(/\s+/g, " ");
}

function isDrawing(line: string): boolean {
  return /\b(?:hist|barplot|plot|image|lines|abline)\s*\(|\.plot\(|\.hist\(/.test(line);
}

function depth(s: string): number {
  let n = 0;
  for (const ch of s) {
    if (ch === "(") n++;
    else if (ch === ")") n--;
  }
  return n;
}
