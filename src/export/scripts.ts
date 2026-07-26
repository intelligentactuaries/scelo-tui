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

type Snippet = {
  /** Analysis body — assumes `df` is loaded. */
  py: string[];
  r: string[];
  /** Notebook-only plot cell (matplotlib via pandas). */
  pyPlot: string[];
  /** Emitted when the body uses numpy directly. */
  needsNumpy?: boolean;
};

/** The time bin the pane would have chosen, re-derived from the profile so
 *  the script buckets identically. */
function binFor(dc: ColumnMeta): "month" | "quarter" | "year" {
  const a = parseDateUTC(dc.dateMin);
  const b = parseDateUTC(dc.dateMax);
  return a && b ? chooseBin(spanDays(a, b)) : "month";
}

const PERIOD_CODE = { month: "M", quarter: "Q", year: "Y" } as const;
const R_PERIOD: Record<"month" | "quarter" | "year", (d: string) => string[]> = {
  month: (d) => [`period <- format(${d}, "%Y-%m")`],
  quarter: (d) => [
    `period <- paste0(format(${d}, "%Y"), "-Q", (as.integer(format(${d}, "%m")) + 2) %/% 3)`,
  ],
  year: (d) => [`period <- format(${d}, "%Y")`],
};

function snippetFor(id: string, metas: ColumnMeta[]): Snippet | null {
  switch (id) {
    case "numeric-summary":
      return {
        py: [
          "summary = df.describe(percentiles=[0.2, 0.4, 0.6, 0.8]).T",
          "print(summary)",
        ],
        r: ["print(summary(df))"],
        pyPlot: ['df.select_dtypes("number").iloc[:, :6].hist(bins=30, figsize=(10, 6))'],
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
          ...R_PERIOD[bin]("d"),
          "records <- table(period)",
          ...rTotal,
          v
            ? "prof <- data.frame(records = as.vector(records), total = as.vector(total), row.names = names(records))"
            : "prof <- data.frame(records = as.vector(records), row.names = names(records))",
          "print(prof)",
        ],
        pyPlot: [`prof["records"].plot(kind="bar", title=${pyStr(`records by ${bin}`)})`],
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
      };
    }
    case "outliers":
      return {
        py: [
          'num = df.select_dtypes("number")',
          "q1, q3 = num.quantile(0.25), num.quantile(0.75)",
          "iqr = q3 - q1",
          "mask = (num < q1 - 1.5 * iqr) | (num > q3 + 1.5 * iqr)",
          'print(mask.sum().sort_values(ascending=False).rename("outliers"))',
        ],
        r: [
          "num <- df[, sapply(df, is.numeric), drop = FALSE]",
          "outliers <- sapply(num, function(x) {",
          "  q <- quantile(x, c(0.25, 0.75), na.rm = TRUE); iqr <- q[2] - q[1]",
          "  sum(x < q[1] - 1.5 * iqr | x > q[2] + 1.5 * iqr, na.rm = TRUE)",
          "})",
          "print(sort(outliers, decreasing = TRUE))",
        ],
        pyPlot: ['mask.sum().sort_values(ascending=False).plot(kind="bar", title="outliers (1.5·IQR)")'],
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

function provenance(pipe: PipelineResult, now: Date, dataFile: string): string[] {
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

export function buildR(pipe: PipelineResult, now: Date, dataFile = "data.csv"): string {
  const snip = pipe.chosen ? snippetFor(pipe.chosen.id, pipe.metas) : null;
  const out: string[] = provenance(pipe, now, dataFile).map((l) => `# ${l}`.trimEnd());
  out.push("", `df <- read.csv(${rStr(dataFile)}, stringsAsFactors = FALSE)`, "");
  if (snip) {
    out.push(...snip.r);
  } else {
    out.push("# No analysis was chosen for this dataset — the profile is yours to explore.");
    out.push("print(summary(df))");
  }
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
