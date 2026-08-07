// Python and R generators — the pane's analysis, restated in the reader's
// own language.
//
// The scripts read `data.csv` (the CLEANED dataset, written alongside) and
// recompute the analysis from it. Cleaning is therefore provenance, not
// code: the TUI's auto-clean records human-readable step labels rather than
// machine-replayable ops, so the honest export is "here is the cleaned data,
// here is exactly what was done to produce it" — the same fidelity note the
// IDE's own exporter makes about its quick-runs.
//
// Column choices are NOT re-derived in pandas/R — they are baked in from the
// same heuristic functions the pane used (analyses.ts), so the script's
// groupby lands on the columns the user actually saw. One registry entry per
// analysis id; a test asserts the registry covers the whole menu, so a ninth
// analysis cannot ship without its export story.

import type { ColumnMeta, Dataset } from "@scelo/core";
import {
  correlationColumns,
  dateColumn,
  frequencyColumn,
  groupColumn,
  valueColumn,
} from "../agent/analyses";
import type { PipelineResult } from "../agent/pipeline";
import { chooseBin, parseDateUTC, spanDays } from "../core/dates";

const pyStr = (s: string) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
const rStr = pyStr; // same escaping rules for double-quoted literals

export type Snippet = {
  /** Analysis body — assumes `df` is loaded. */
  py: string[];
  r: string[];
  /** Notebook-only plot cell (matplotlib via pandas). */
  pyPlot: string[];
  /**
   * The same picture in base R. Base graphics on purpose: an exported script
   * that needs install.packages() before it draws anything is not a script
   * that runs, and RStudio's plot pane renders base output natively. Reads
   * only the variables the matching `r` body leaves behind.
   */
  rPlot?: string[];
  /** Emitted when the body uses numpy directly. */
  needsNumpy?: boolean;
};

/** One analysis the session ran, in the order it ran. The exported R restates
 *  every one of them, so a session that switched analyses three times exports
 *  three sections rather than only the last. */
export type AnalysisRun = { id: string; label: string; rationale: string };

/** The time bin the pane would have chosen, re-derived from the profile so
 *  the script buckets identically. */
function binFor(dc: ColumnMeta): "month" | "quarter" | "year" {
  const a = parseDateUTC(dc.dateMin);
  const b = parseDateUTC(dc.dateMax);
  return a && b ? chooseBin(spanDays(a, b)) : "month";
}

const PERIOD_CODE = { month: "M", quarter: "Q", year: "Y" } as const;

/**
 * The bucket key, as a function so it can be applied to BOTH the data and a
 * calendar sequence — which is what gap-filling needs.
 *
 * Every branch guards NA explicitly. `paste0` stringifies NA into the
 * literal "NA-QNA", which `table()` then treats as a real quarter and prints
 * among the results; `format()` alone returns NA, which table() drops. Only
 * the quarter branch had the bug, and quarter is what a multi-year book
 * picks.
 */
const R_KEY_FN: Record<"month" | "quarter" | "year", string[]> = {
  month: ['scelo_period <- function(x) format(x, "%Y-%m")'],
  year: ['scelo_period <- function(x) format(x, "%Y")'],
  quarter: [
    "scelo_period <- function(x) ifelse(is.na(x), NA_character_,",
    '  paste0(format(x, "%Y"), "-Q", (as.integer(format(x, "%m")) + 2) %/% 3))',
  ],
};
const R_STEP = { month: "month", quarter: "3 months", year: "year" } as const;

export function snippetFor(id: string, metas: ColumnMeta[]): Snippet | null {
  switch (id) {
    case "numeric-summary":
      // Mirrors the pane (and the IDE's descriptive report) stat for stat:
      // sample sd (ddof=1 — pandas' and R's default), median by linear
      // interpolation (type 7 — numpy's and R's default), missingness made
      // visible, CV-ranked so scale never decides the order.
      return {
        py: [
          'num = df.select_dtypes("number")',
          "summary = pd.DataFrame({",
          '    "n": num.count(),',
          '    "miss_pct": (100 * num.isna().mean()).round(1),',
          '    "mean": num.mean(),',
          '    "sd": num.std(),',
          '    "cv": num.std() / num.mean().abs(),',
          '    "min": num.min(),',
          '    "median": num.median(),',
          '    "max": num.max(),',
          "})",
          'print(summary.sort_values("cv", ascending=False))',
        ],
        r: [
          "num <- df[sapply(df, is.numeric)]",
          "summary_tbl <- data.frame(",
          "  n = sapply(num, function(x) sum(!is.na(x))),",
          "  miss_pct = round(100 * sapply(num, function(x) mean(is.na(x))), 1),",
          "  mean = sapply(num, mean, na.rm = TRUE),",
          "  sd = sapply(num, sd, na.rm = TRUE),",
          "  min = sapply(num, min, na.rm = TRUE),",
          "  median = sapply(num, median, na.rm = TRUE),",
          "  max = sapply(num, max, na.rm = TRUE)",
          ")",
          "summary_tbl$cv <- summary_tbl$sd / abs(summary_tbl$mean)",
          'print(summary_tbl[order(-summary_tbl$cv), c("n", "miss_pct", "mean", "sd", "cv", "min", "median", "max")])',
        ],
        pyPlot: ['df.select_dtypes("number").iloc[:, :6].hist(bins=30, figsize=(10, 6))'],
        rPlot: [
          "shown <- head(names(num), 6)",
          "if (length(shown) > 0) {",
          "  op <- par(mfrow = c(2, 3), mar = c(4, 4, 2, 1))",
          '  for (nm in shown) hist(num[[nm]], main = nm, xlab = "", col = "grey80")',
          "  par(op)",
          "}",
        ],
      };
    case "group-metric": {
      const v = valueColumn(metas);
      const c = groupColumn(metas);
      if (!v || !c) return null;
      return {
        py: [
          `seg = df.groupby(${pyStr(c.name)})[${pyStr(v.name)}].agg(n="count", mean="mean", total="sum")`,
          'seg["share"] = seg["total"] / seg["total"].sum()',
          'seg = seg.sort_values("total", ascending=False)',
          "print(seg)",
        ],
        r: [
          `n <- tapply(df[[${rStr(v.name)}]], df[[${rStr(c.name)}]], function(x) sum(!is.na(x)))`,
          `mean_ <- tapply(df[[${rStr(v.name)}]], df[[${rStr(c.name)}]], mean, na.rm = TRUE)`,
          `total <- tapply(df[[${rStr(v.name)}]], df[[${rStr(c.name)}]], sum, na.rm = TRUE)`,
          "seg <- data.frame(n, mean = mean_, total, share = total / sum(total))",
          "print(seg[order(-seg$total), ])",
        ],
        pyPlot: ['seg["total"].plot(kind="bar", title=' + `${pyStr(`${v.name} by ${c.name}`)})`],
        rPlot: [
          "top <- head(seg[order(-seg$total), , drop = FALSE], 12)",
          "op <- par(mar = c(9, 4, 2, 1))",
          "barplot(top$total, names.arg = rownames(top), las = 2,",
          `        col = "steelblue", main = ${rStr(`${v.name} by ${c.name}`)})`,
          "par(op)",
        ],
      };
    }
    case "frequency": {
      const c = frequencyColumn(metas);
      if (!c) return null;
      return {
        py: [
          `counts = df[${pyStr(c.name)}].value_counts()`,
          'print(pd.DataFrame({"count": counts, "share": counts / counts.sum()}))',
        ],
        r: [
          `counts <- sort(table(df[[${rStr(c.name)}]]), decreasing = TRUE)`,
          "print(data.frame(count = as.vector(counts),",
          "                 share = as.vector(counts) / sum(counts),",
          "                 row.names = names(counts)))",
        ],
        pyPlot: [`counts.plot(kind="bar", title=${pyStr(`${c.name} exposure`)})`],
        rPlot: [
          "op <- par(mar = c(9, 4, 2, 1))",
          `barplot(head(counts, 12), las = 2, col = "steelblue", main = ${rStr(`${c.name} exposure`)})`,
          "par(op)",
        ],
      };
    }
    case "time-profile": {
      const dc = dateColumn(metas);
      if (!dc) return null;
      const v = valueColumn(metas);
      const bin = binFor(dc);
      const agg = v
        ? `.agg(records=(${pyStr(dc.name)}, "size"), total=(${pyStr(v.name)}, "sum"))`
        : `.agg(records=(${pyStr(dc.name)}, "size"))`;
      const rTotal = v
        ? [`total <- tapply(df[[${rStr(v.name)}]], period, sum, na.rm = TRUE)`]
        : [];
      return {
        py: [
          `d = pd.to_datetime(df[${pyStr(dc.name)}], errors="coerce")`,
          `period = d.dt.to_period("${PERIOD_CODE[bin]}")`,
          `prof = df.assign(period=period).groupby("period")${agg}`,
          "print(prof)",
        ],
        r: [
          `d <- as.Date(df[[${rStr(dc.name)}]])`,
          ...R_KEY_FN[bin],
          // Gap-filled, like the pane: the levels come from walking the
          // CALENDAR between the first and last date, not from the values
          // present, so a period with no records prints an explicit zero.
          // An invisible gap is the exact thing a missing-exposure scan
          // exists to surface.
          `span <- seq(min(d, na.rm = TRUE), max(d, na.rm = TRUE), by = "${R_STEP[bin]}")`,
          "period <- factor(scelo_period(d), levels = unique(scelo_period(span)))",
          "records <- table(period)",
          ...rTotal,
          v
            ? "prof <- data.frame(records = as.vector(records), total = as.vector(total), row.names = names(records))"
            : "prof <- data.frame(records = as.vector(records), row.names = names(records))",
          "prof[is.na(prof)] <- 0",
          "print(prof)",
        ],
        pyPlot: [`prof["records"].plot(kind="bar", title=${pyStr(`records by ${bin}`)})`],
        rPlot: [
          "op <- par(mar = c(9, 4, 2, 1))",
          "barplot(prof$records, names.arg = rownames(prof), las = 2,",
          `        col = "steelblue", main = ${rStr(`records by ${bin}`)})`,
          "par(op)",
        ],
      };
    }
    case "concentration": {
      const v = valueColumn(metas);
      if (!v) return null;
      return {
        needsNumpy: true,
        py: [
          `x = np.sort(df[${pyStr(v.name)}].dropna().to_numpy())`,
          "x = x[x >= 0]",
          "n, total = len(x), x.sum()",
          "gini = (2 * np.sum(np.arange(1, n + 1) * x) / (n * total) - (n + 1) / n) if total > 0 else 0.0",
          'print(f"gini = {gini:.4f}")',
          "desc = x[::-1]",
          "for frac in (0.01, 0.05, 0.10, 0.20):",
          "    take = max(1, int(np.ceil(n * frac)))",
          "    share = desc[:take].sum() / total if total > 0 else 0.0",
          '    print(f"largest {frac:.0%} hold {share:.1%} of the total")',
        ],
        r: [
          `x <- sort(df[[${rStr(v.name)}]][!is.na(df[[${rStr(v.name)}]]) & df[[${rStr(v.name)}]] >= 0])`,
          "n <- length(x); total <- sum(x)",
          "gini <- if (total > 0) 2 * sum(seq_len(n) * x) / (n * total) - (n + 1) / n else 0",
          'cat(sprintf("gini = %.4f\\n", gini))',
          "desc <- rev(x)",
          "for (frac in c(0.01, 0.05, 0.10, 0.20)) {",
          "  take <- max(1, ceiling(n * frac))",
          '  cat(sprintf("largest %d%% hold %.1f%% of the total\\n",',
          "              round(100 * frac), 100 * sum(desc[seq_len(take)]) / total))",
          "}",
        ],
        pyPlot: [
          "# Lorenz curve — the standard picture of concentration.",
          "import matplotlib.pyplot as plt",
          "cum = np.insert(np.cumsum(x), 0, 0) / total",
          "plt.plot(np.linspace(0, 1, len(cum)), cum, label=" + pyStr(v.name) + ")",
          'plt.plot([0, 1], [0, 1], "k--", label="perfect equality")',
          "plt.legend()",
        ],
        rPlot: [
          "# Lorenz curve — the standard picture of concentration.",
          "if (n > 0 && total > 0) {",
          "  cum <- c(0, cumsum(x)) / total",
          '  plot(seq(0, 1, length.out = length(cum)), cum, type = "l", col = "steelblue",',
          '       xlab = "share of records (smallest first)", ylab = "share of the total",',
          `       main = ${rStr(`Lorenz curve — ${v.name}`)})`,
          '  abline(0, 1, lty = 2, col = "grey50")',
          `  legend("topleft", c(${rStr(v.name)}, "perfect equality"),`,
          '         lty = c(1, 2), col = c("steelblue", "grey50"), bty = "n")',
          "}",
        ],
      };
    }
    case "correlation": {
      const cols = correlationColumns(metas).map((m) => m.name);
      if (cols.length < 2) return null;
      const pyCols = `[${cols.map(pyStr).join(", ")}]`;
      const rCols = `c(${cols.map(rStr).join(", ")})`;
      return {
        needsNumpy: true,
        py: [
          `num = df[${pyCols}]`,
          "corr = num.corr()",
          "mask = np.triu(np.ones(corr.shape, dtype=bool), k=1)",
          "pairs = corr.where(mask).stack().sort_values(key=abs, ascending=False)",
          "print(pairs.head(8))",
        ],
        r: [
          `num <- df[, ${rCols}]`,
          'cm <- cor(num, use = "pairwise.complete.obs")',
          "cm[lower.tri(cm, diag = TRUE)] <- NA",
          "pairs <- na.omit(as.data.frame(as.table(cm)))",
          "print(head(pairs[order(-abs(pairs$Freq)), ], 8))",
        ],
        pyPlot: [
          "import matplotlib.pyplot as plt",
          'plt.imshow(corr, cmap="coolwarm", vmin=-1, vmax=1)',
          "plt.colorbar()",
          "plt.xticks(range(len(corr)), corr.columns, rotation=90)",
          "plt.yticks(range(len(corr)), corr.columns)",
        ],
        rPlot: [
          // `cm` has had its lower triangle NA-ed for the ranking above, so
          // the heatmap recomputes rather than drawing half a matrix.
          'cmap <- cor(num, use = "pairwise.complete.obs")',
          "op <- par(mar = c(9, 9, 2, 1))",
          "image(seq_len(ncol(cmap)), seq_len(ncol(cmap)), t(cmap[rev(seq_len(nrow(cmap))), ]),",
          '      zlim = c(-1, 1), axes = FALSE, xlab = "", ylab = "", main = "correlation",',
          '      col = hcl.colors(21, "Blue-Red"))',
          "axis(1, seq_len(ncol(cmap)), colnames(cmap), las = 2, cex.axis = 0.7)",
          "axis(2, seq_len(ncol(cmap)), rev(colnames(cmap)), las = 2, cex.axis = 0.7)",
          "par(op)",
        ],
      };
    }
    case "outliers":
      return {
        py: [
          'num = df.select_dtypes("number")',
          "q1, q3 = num.quantile(0.25), num.quantile(0.75)",
          "iqr = q3 - q1",
          "mask = (num < q1 - 1.5 * iqr) | (num > q3 + 1.5 * iqr)",
          "# No spread, no outlier classification: with IQR 0 the fences sit",
          "# on the quartiles and a discrete column flags half its rows.",
          "mask.loc[:, iqr <= 0] = False",
          'print(mask.sum().sort_values(ascending=False).rename("outliers"))',
        ],
        r: [
          "num <- df[, sapply(df, is.numeric), drop = FALSE]",
          "outliers <- sapply(num, function(x) {",
          "  q <- quantile(x, c(0.25, 0.75), na.rm = TRUE); iqr <- q[2] - q[1]",
          // No spread, no outlier classification — the same guard the pane's
          // own boxStats makes. With IQR 0 the Tukey fences collapse onto
          // the quartiles and a discrete count column (80% zeros) reports
          // every other row as an outlier.
          "  if (!is.finite(iqr) || iqr <= 0) return(0L)",
          "  sum(x < q[1] - 1.5 * iqr | x > q[2] + 1.5 * iqr, na.rm = TRUE)",
          "})",
          "print(sort(outliers, decreasing = TRUE))",
        ],
        pyPlot: ['mask.sum().sort_values(ascending=False).plot(kind="bar", title="outliers (1.5·IQR)")'],
        rPlot: [
          "op <- par(mar = c(9, 4, 2, 1))",
          'barplot(head(sort(outliers, decreasing = TRUE), 12), las = 2, col = "steelblue",',
          '        main = "outliers (1.5 x IQR)")',
          "par(op)",
        ],
      };
    case "missingness":
      return {
        py: [
          "miss = df.isna().sum()",
          "miss = miss[miss > 0].sort_values(ascending=False)",
          'print(pd.DataFrame({"missing": miss, "pct": (100 * miss / len(df)).round(1)}))',
        ],
        r: [
          "miss <- colSums(is.na(df))",
          "miss <- sort(miss[miss > 0], decreasing = TRUE)",
          "print(data.frame(missing = miss, pct = round(100 * miss / nrow(df), 1)))",
        ],
        pyPlot: ['miss.plot(kind="bar", title="missing cells per column")'],
        rPlot: [
          "if (length(miss) > 0) {",
          "  op <- par(mar = c(9, 4, 2, 1))",
          '  barplot(head(miss, 12), las = 2, col = "steelblue",',
          '          main = "missing cells per column")',
          "  par(op)",
          "}",
        ],
      };
    default:
      return null;
  }
}

/** Every analysis id the registry can restate — the coverage test compares
 *  this against the live menu. */
export function coveredAnalyses(metas: ColumnMeta[], ids: string[]): string[] {
  return ids.filter((id) => snippetFor(id, metas) !== null);
}

// ── provenance header ─────────────────────────────────────────────────────

export function provenance(pipe: PipelineResult, now: Date, dataFile: string): string[] {
  const d = pipe.dataset;
  const steps = pipe.clean?.passes.reduce((n, p) => n + p.opLabels.length, 0) ?? 0;
  const lines = [
    `${d.name} — generated by scelo-tui, ${now.toISOString()}`,
    `shape: ${d.rows.length} rows x ${d.columns.length} columns${d.sampled ? " (SAMPLED — the source file held more rows than the import cap)" : ""}`,
  ];
  if (pipe.clean && steps > 0) {
    lines.push(`auto-clean: ${steps} steps over ${pipe.clean.passes.length} passes (${pipe.clean.outcome})`);
    for (const pass of pipe.clean.passes) {
      for (const op of pass.opLabels) lines.push(`  - ${op}`);
    }
    if (pipe.clean.droppedColumns.length > 0) {
      lines.push(`  dropped columns: ${pipe.clean.droppedColumns.join(", ")}`);
    }
  } else {
    lines.push("auto-clean: nothing to do — data was already clean");
  }
  lines.push(
    `${dataFile} (alongside this script) is the dataset AFTER those steps;`,
    "the code below recomputes the analysis from it.",
  );
  if (pipe.reading) {
    lines.push("", "the agent's reading of this data:");
    for (const l of pipe.reading.split("\n")) lines.push(`  ${l}`);
  }
  if (pipe.chosen) {
    lines.push("", `analysis: ${pipe.chosen.label}`, `why: ${pipe.rationale}`);
  }
  return lines;
}

// ── whole-file assembly ───────────────────────────────────────────────────

export function buildPython(pipe: PipelineResult, now: Date, dataFile = "data.csv"): string {
  const snip = pipe.chosen ? snippetFor(pipe.chosen.id, pipe.metas) : null;
  const out: string[] = ['"""', ...provenance(pipe, now, dataFile), '"""', ""];
  out.push("import pandas as pd");
  if (snip?.needsNumpy) out.push("import numpy as np");
  out.push("", `df = pd.read_csv(${pyStr(dataFile)})`, "");
  if (snip) {
    out.push(...snip.py);
  } else {
    out.push("# No analysis was chosen for this dataset — the profile is yours to explore.");
    out.push("print(df.describe(include='all').T)");
  }
  return `${out.join("\n")}\n`;
}

const R_RULE = "─".repeat(70);

/** `# ── <title> ─────…` padded to a constant width, so the sections are
 *  scannable in RStudio's editor rather than ragged. */
function rHeading(title: string): string {
  return `# ── ${title} ${R_RULE.slice(0, Math.max(3, 66 - title.length))}`;
}

/**
 * The session as a script somebody can actually run.
 *
 * Not "the last analysis, in R": the whole arc the panes showed — what the
 * data is, what the auto-clean did, the profile, then EVERY analysis the
 * session ran, in order, each with its result and its plot. Base R only, so
 * it runs in a stock RStudio with no install.packages() step; sections
 * announce themselves with message() so a source() reads like the session
 * did.
 */
export function buildR(
  pipe: PipelineResult,
  now: Date,
  dataFile = "data.csv",
  runs: AnalysisRun[] = [],
): string {
  // The session's runs, falling back to the pipeline's own choice — an
  // export that never switched analyses still has exactly one section.
  const sections =
    runs.length > 0
      ? runs
      : pipe.chosen
        ? [{ id: pipe.chosen.id, label: pipe.chosen.label, rationale: pipe.rationale }]
        : [];

  // With more than one section the header's "analysis: …/why: …" lines would
  // name only the first — the sections carry their own titles, so drop them.
  const head = sections.length > 1 ? { ...pipe, chosen: null } : pipe;
  const out: string[] = provenance(head, now, dataFile).map((l) => `# ${l}`.trimEnd());
  out.push(
    "",
    "# Base R only — no packages to install. Run the whole file (Ctrl+Shift+S",
    "# in RStudio, or Rscript this file), or step through it section by section.",
    "",
    rHeading("load"),
    // check.names=FALSE: R's default runs make.names() over the header, so
    // `loss_ratio_%` silently becomes `loss_ratio_.` and every df[["…"]]
    // below it returns NULL. Auto-clean does not save us — it leaves `%`,
    // `$`, `&`, leading digits and (on a snake-case collision) spaces
    // intact. One renamed column used to halt the whole file.
    // na.strings: toCsv writes an empty field for a null, and R reads that
    // as the literal "" in a character column — so missingness counts came
    // out as zero and every frequency share was computed against a phantom
    // blank level. pandas treats it as NaN; now both agree with the pane.
    `df <- read.csv(${rStr(dataFile)}, stringsAsFactors = FALSE,`,
    '               check.names = FALSE, na.strings = c("NA", ""))',
    'message(sprintf("scelo: %d rows x %d cols loaded", nrow(df), ncol(df)))',
    "# Browse the data with RStudio's viewer:  View(df)",
    "# (Don't open the csv itself as a file — RStudio's source editor caps",
    "#  out at 5 MB; the viewer handles any size.)",
    "",
    // The profile is the "understand" stage the TOOLS pane showed: it is
    // what every analysis below was chosen FROM, so a script without it
    // starts its story in the middle.
    rHeading("profile"),
    'message("scelo → profile")',
    "str(df)",
    "print(summary(df))",
    "miss_all <- colSums(is.na(df))",
    "if (any(miss_all > 0)) {",
    '  cat("\\nmissing cells per column:\\n")',
    "  print(sort(miss_all[miss_all > 0], decreasing = TRUE))",
    "}",
    "",
  );

  if (sections.length === 0) {
    out.push(
      rHeading("analysis"),
      "# No analysis was chosen for this dataset — the profile above is yours",
      "# to explore from.",
      "",
    );
  }
  sections.forEach((run, i) => {
    const snip = snippetFor(run.id, pipe.metas);
    out.push(
      rHeading(`analysis ${i + 1}: ${run.label}`),
      ...(run.rationale ? [`# why: ${run.rationale}`] : []),
      `message(${rStr(`scelo → ${run.label}`)})`,
      ...(snip ? snip.r : ["print(summary(df))  # no scripted form for this analysis"]),
    );
    if (snip?.rPlot) out.push("", ...snip.rPlot);
    out.push("");
  });

  out.push(
    `message(${rStr(`scelo: ${sections.length} analysis section${sections.length === 1 ? "" : "s"} above`)})`,
  );
  return `${out.join("\n")}\n`;
}

/** The notebook wants the same pieces cell by cell rather than as one file. */
export function notebookParts(
  pipe: PipelineResult,
  now: Date,
  dataFile = "data.csv",
): {
  provenance: string[];
  imports: string[];
  body: string[];
  plot: string[] | null;
} {
  const snip = pipe.chosen ? snippetFor(pipe.chosen.id, pipe.metas) : null;
  const imports = ["import pandas as pd"];
  if (snip?.needsNumpy) imports.push("import numpy as np");
  imports.push("", `df = pd.read_csv(${pyStr(dataFile)})`, "df.head()");
  return {
    provenance: provenance(pipe, now, dataFile),
    imports,
    body: snip ? snip.py : ["df.describe(include='all').T"],
    plot: snip ? snip.pyPlot : null,
  };
}

export type { Dataset };
