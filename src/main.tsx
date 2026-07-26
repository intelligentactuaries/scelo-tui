#!/usr/bin/env bun
// Entry point.
//
//   scelo [path/to/data.csv] [--no-intro]
//
// Opens on the model picker, then hands over to the three-pane workstation. A
// path given here is loaded and analysed as soon as the panes appear;
// otherwise drag a file onto the window (terminals paste the path) or type
// one into any pane.

import { render } from "ink";
import { useCallback, useState } from "react";
import { App } from "./App";
import { getActive, llmAvailable, setActive } from "./agent/llm";
import type { Selection } from "./agent/providers";
import { normaliseDroppedPath } from "./core/ingest";
import { Intro } from "./ui/Intro";

const args = process.argv.slice(2);
const skipIntro = args.includes("--no-intro");
const pathArg = args.find((a) => !a.startsWith("-"));
const initialPath = pathArg ? normaliseDroppedPath(pathArg) : undefined;

function Root() {
  const [picking, setPicking] = useState(!skipIntro);
  const [path, setPath] = useState(initialPath);

  const onStart = useCallback((sel: Selection) => {
    setActive(sel);
    setPicking(false);
  }, []);

  if (picking) return <Intro onStart={onStart} />;
  // Re-entering the picker unmounts the panes, so coming back re-runs the
  // pipeline on whatever file was loaded — which is the point: a different
  // model should get to read the data and choose an analysis for itself.
  return (
    <App initialPath={path} onPath={setPath} onSettings={() => setPicking(true)} />
  );
}

// Only worth saying when the picker is skipped; otherwise the picker itself
// shows what is reachable, which is strictly more useful than a warning.
if (skipIntro && !(await llmAvailable())) {
  const { provider, model } = getActive();
  process.stderr.write(
    `scelo-tui: ${provider}/${model} is unreachable — the pipeline will still profile and clean,\n` +
      "           but the narrative and chat panes will be inert. Run `scelo` without\n" +
      "           --no-intro to pick a different model or add an api key.\n\n",
  );
}

render(<Root />);
