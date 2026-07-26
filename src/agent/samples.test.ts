// The bundled samples, as served to the TUI from @scelo/core.
//
// These are the IDE's own examples, so the tests hold them to the IDE's own
// promises: the advertised shapes are the real shapes, the dirty sample
// actually lights up the auto-cleaner (its entire reason to exist), and the
// claims sample really is an incomplete triangle. A drifted sample would
// pass a smoke test and still betray a tutorial that says "load the claims
// sample and follow along".

import { describe, expect, test } from "bun:test";
import { SAMPLES, summariseDataset } from "@scelo/core";
import { autoCleanDataset } from "../core/cleaning";
import { MODELS } from "./analyses";

describe("registry", () => {
  test("all six IDE samples are present, keys unique", () => {
    expect(SAMPLES.map((s) => s.key).sort()).toEqual([
      "claims",
      "climate",
      "dirty",
      "lifelib-mp",
      "wmtr-scenarios",
      "workspace-demo",
    ]);
  });

  test("every advertised shape is the real shape", () => {
    for (const s of SAMPLES) {
      const ds = s.build();
      expect([s.key, ds.rows.length]).toEqual([s.key, s.rows]);
      expect([s.key, ds.columns.length]).toEqual([s.key, s.cols]);
      expect(ds.name.length).toBeGreaterThan(0);
      // Every declared column exists on the first row's key set.
      for (const c of ds.columns) expect(Object.keys(ds.rows[0])).toContain(c);
    }
  });

  test("builders are deterministic — the tutorial sentence holds", () => {
    for (const s of SAMPLES) {
      expect(JSON.stringify(s.build())).toBe(JSON.stringify(s.build()));
    }
  });
});

describe("what each sample is for", () => {
  test("the dirty sample actually triggers the auto-cleaner, hard", () => {
    const spec = SAMPLES.find((s) => s.key === "dirty");
    if (!spec) throw new Error("unreachable");
    const clean = autoCleanDataset(spec.build(), (d) => summariseDataset(d));
    const steps = clean.passes.reduce((n, p) => n + p.opLabels.length, 0);
    // Hand-crafted to exercise EVERY cleaning op — if it stops tripping the
    // cleaner, either the sample or the cleaner regressed.
    expect(steps).toBeGreaterThanOrEqual(8);
    expect(clean.droppedColumns.length).toBeGreaterThan(0);
    expect(clean.rowsAfter).toBeLessThan(clean.rowsBefore); // duplicate rows went
  });

  test("the claims sample is an INCOMPLETE triangle", () => {
    const spec = SAMPLES.find((s) => s.key === "claims");
    if (!spec) throw new Error("unreachable");
    const ds = spec.build();
    // Reserving methods collapse to IBNR=0 on a complete triangle, so the
    // whole point of this sample is that origin+dev never exceeds 2024.
    for (const r of ds.rows) {
      expect(Number(r.origin_year) + Number(r.dev_period)).toBeLessThanOrEqual(2024);
    }
    const latest = ds.rows.filter((r) => r.origin_year === 2024);
    expect(latest.every((r) => r.dev_period === 0)).toBe(true);
  });

  test("every sample gives the TUI's analysis menu something to run", () => {
    for (const s of SAMPLES) {
      const ds = s.build();
      const metas = summariseDataset(ds);
      const eligible = MODELS.filter((m) => m.applies(metas));
      expect([s.key, eligible.length > 0]).toEqual([s.key, true]);
      // And the first applicable analysis must actually run on it.
      const r = eligible[0].run(ds, metas);
      expect(r.columns.length).toBeGreaterThan(0);
    }
  });
});
