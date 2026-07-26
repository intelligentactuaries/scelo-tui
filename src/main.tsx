#!/usr/bin/env bun
// Entry point.
//
//   bun run src/main.tsx [path/to/data.csv]
//
// A path given here is loaded and analysed immediately; otherwise drag a file
// onto the window (terminals paste the path) or type one into any pane.

import { render } from "ink";
import { App } from "./App";
import { llmAvailable } from "./agent/llm";
import { normaliseDroppedPath } from "./core/ingest";

const arg = process.argv[2];
const initialPath = arg ? normaliseDroppedPath(arg) : undefined;

// Warn once, before taking over the screen — a missing local model is a
// setup problem, and discovering it as three empty panes is unhelpful.
if (!(await llmAvailable())) {
  process.stderr.write(
    "scelo-tui: no local model at :11434 — the pipeline will still profile and clean,\n" +
      "           but the narrative and chat panes will be inert. Start ollama to enable them.\n\n",
  );
}

render(<App initialPath={initialPath} />);
