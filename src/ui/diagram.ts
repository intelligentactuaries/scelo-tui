// Node/edge diagrams, drawn the way a terminal draws.
//
// The Scelo IDE puts a React Flow canvas in both of these panes, and the
// shape it draws is the same twice, mirrored:
//
//   TOOLS  a dataset HUB fans OUT to the candidate models   (hub → leaves)
//   HARD   the result nodes fan IN to the board-pack hub    (leaves → hub)
//
// The canvas is a luxury of a GPU and 900 pixels of width. What survives the
// translation to 45 columns of monospace is the part that was carrying the
// meaning: which node is the hub, what hangs off it, which of those are LIVE,
// and which way the arrows point. So the star is flattened onto a vertical
// spine — the topology a narrow column can actually hold — and everything
// else (drag, zoom, ports, per-node chat) is dropped rather than miniaturised
// into something unreadable.
//
// Deliberately not a pixel-perfect reproduction: single-line boxes, ASCII
// arrowheads, a double-ruled box for the hub because the IDE's hub is the one
// node with a 2px border. It should look drawn by a terminal, not squeezed
// into one.
//
// Pure layout — no Ink, no React. Spans carry colour so the renderer stays a
// dumb loop, and so the shapes can be asserted in tests as plain text.

import { theme } from "./theme";

export type Span = { text: string; color?: string; bold?: boolean };
export type DiagramLine = Span[];

/** Mirrors the IDE's StatusPip, which is the one place status is stated:
 *  border colour there means FAMILY, never status, and the pip means status.
 *  A terminal has one attribute to spend, so the pip does the work. */
export type NodeStatus = "live" | "running" | "failed" | "idle";

export type DiagramNode = {
  label: string;
  /** A second line inside the box — counts, units, the "why". */
  detail?: string;
  status: NodeStatus;
  /** Edge label, drawn on the connector into this node ("+ variance",
   *  "feeds"). Dropped when the pane is too narrow to hold it. */
  edge?: string;
};

const PIP: Record<NodeStatus, string> = {
  live: "●",
  running: "◐",
  failed: "✕",
  idle: "·",
};

function pipColor(s: NodeStatus): string {
  if (s === "live") return theme.ok;
  if (s === "running") return theme.warn;
  if (s === "failed") return theme.err;
  return theme.mute;
}

/** Live nodes get the pane's accent; everything else recedes — the terminal's
 *  version of the canvas dropping inactive cards to 55% opacity. */
function nodeColor(s: NodeStatus, accent: string): string {
  return s === "idle" ? theme.mute : accent;
}

function cut(s: string, n: number): string {
  if (n <= 0) return "";
  return s.length > n ? `${s.slice(0, Math.max(0, n - 1))}…` : s;
}

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + " ".repeat(n - s.length);
}

/** The hub, double-ruled. `inner` is the width between the rules. */
function hubBox(node: DiagramNode, inner: number, accent: string, indent: string): DiagramLine[] {
  const rule = "═".repeat(inner + 2);
  const lines: DiagramLine[] = [
    [{ text: indent }, { text: `╔${rule}╗`, color: accent }],
  ];
  const body = [node.label, ...(node.detail ? [node.detail] : [])];
  for (const [i, text] of body.entries()) {
    lines.push([
      { text: indent },
      { text: "║ ", color: accent },
      // The first line carries the hub's own marker; the rest is detail.
      ...(i === 0
        ? [
            { text: "▓ ", color: accent },
            { text: pad(cut(text, inner - 2), inner - 2), color: theme.fg, bold: true },
          ]
        : [{ text: pad(cut(text, inner), inner), color: theme.mute }]),
      { text: " ║", color: accent },
    ]);
  }
  lines.push([{ text: indent }, { text: `╚${rule}╝`, color: accent }]);
  return lines;
}

/** One leaf's three lines, without the connector column. */
function leafBox(node: DiagramNode, inner: number, accent: string): DiagramLine[] {
  const col = nodeColor(node.status, accent);
  const rule = "─".repeat(inner + 2);
  return [
    [{ text: `┌${rule}┐`, color: col }],
    [
      { text: "│ ", color: col },
      { text: `${PIP[node.status]} `, color: pipColor(node.status) },
      { text: pad(cut(node.label, inner - 2), inner - 2), color: node.status === "idle" ? theme.mute : theme.fg },
      { text: " │", color: col },
    ],
    [{ text: `└${rule}┘`, color: col }],
  ];
}

/** Smallest width that still draws a box with a readable label in it. */
const MIN_WIDTH = 24;

/** Boxes are sized to their CONTENT, not to the pane. A node stretched to
 *  the full column reads as a table row; a node that stops where its label
 *  stops reads as a node. `room` is the hard ceiling. */
function fit(
  marked: Array<string | undefined>,
  room: number,
  marker = 0,
  plain: Array<string | undefined> = [],
): number {
  const w = (ts: Array<string | undefined>, extra: number) =>
    Math.max(0, ...ts.filter((t): t is string => !!t).map((t) => t.length + extra));
  return Math.max(6, Math.min(room, Math.max(w(marked, marker), w(plain, 0))));
}

/**
 * TOOLS: the dataset hub, fanning out to the analyses that apply to it.
 *
 * The star is flattened onto a spine dropping from the hub's left shoulder,
 * with one arrow per leaf — a fan-out drawn as a bus, because a real radial
 * fan needs width a pane does not have. `maxLeaves` is a ROW budget, not a
 * preference: the pane also owns a stage list, a rationale and a chat.
 */
export function fanOut(
  hub: DiagramNode,
  leaves: DiagramNode[],
  opts: { width: number; accent: string; maxLeaves?: number },
): DiagramLine[] {
  const { width, accent } = opts;
  if (width < MIN_WIDTH) return [];
  const max = Math.max(1, opts.maxLeaves ?? leaves.length);
  const shown = leaves.slice(0, max);
  const hidden = leaves.length - shown.length;

  // The hub's first line carries a 2-char marker before its label.
  const hubInner = fit([hub.label], width - 4, 2, [hub.detail]);
  const out: DiagramLine[] = [...hubBox(hub, hubInner, accent, "")];
  if (shown.length === 0) return out;

  // The spine hangs from column 3 — under the hub's body, not its corner, so
  // it reads as leaving the box rather than continuing its border.
  const SP = "   ";
  const leafInner = fit(
    shown.map((l) => l.label),
    width - 6 - 4,
    2,
  );
  if (leafInner < 6) return out;

  out.push([{ text: SP }, { text: "│", color: accent }]);
  for (const [i, leaf] of shown.entries()) {
    const last = i === shown.length - 1 && hidden === 0;
    const box = leafBox(leaf, leafInner, accent);
    const live = leaf.status !== "idle";
    const edgeCol = live ? accent : theme.mute;
    // A dashed shaft for an inactive edge, mirroring the canvas's dashed
    // strokes: the connector says whether the branch is carrying anything.
    const shaft = live ? "─▶" : "┄▶";
    out.push([{ text: SP }, { text: "│", color: accent }, { text: "  " }, ...box[0]]);
    out.push([
      { text: SP },
      { text: last ? "└" : "├", color: accent },
      { text: shaft, color: edgeCol },
      ...box[1],
    ]);
    out.push([
      { text: SP },
      { text: last ? " " : "│", color: last ? undefined : accent },
      { text: "  " },
      ...box[2],
    ]);
  }
  if (hidden > 0) {
    out.push([
      { text: SP },
      { text: "└┄▶ ", color: theme.mute },
      { text: `+${hidden} more · /list`, color: theme.mute },
    ]);
  }
  return out;
}

/**
 * HARD: the results that were produced, fanning in to the output hub.
 *
 * Mirror of `fanOut` — boxes on the left, the spine gathering them on the
 * right and turning down into the hub. Same reason the IDE mirrors its two
 * canvases: fan-out is "what could run", fan-in is "what did".
 */
export function fanIn(
  leaves: DiagramNode[],
  hub: DiagramNode,
  opts: { width: number; accent: string; maxLeaves?: number },
): DiagramLine[] {
  const { width, accent } = opts;
  if (width < MIN_WIDTH) return [];
  const max = Math.max(1, opts.maxLeaves ?? leaves.length);
  const shown = leaves.slice(0, max);
  const hidden = leaves.length - shown.length;
  const leafInner = fit(
    shown.map((l) => l.label),
    width - 2 - 4,
    2,
  );
  if (leafInner < 6) return [];
  // Where the gathering spine runs: just clear of the widest box.
  const spineCol = leafInner + 4 + 1;

  const out: DiagramLine[] = [];
  for (const [i, leaf] of shown.entries()) {
    const box = leafBox(leaf, leafInner, accent);
    const live = leaf.status !== "idle";
    const edgeCol = live ? accent : theme.mute;
    const first = i === 0;
    // The spine is unbroken between leaves: it starts at the first box's
    // shoulder and runs down past every one after it.
    out.push(
      first
        ? [...box[0], { text: "  " }]
        : [...box[0], { text: " " }, { text: "│", color: accent }],
    );
    out.push([
      ...box[1],
      { text: live ? "─" : "┄", color: edgeCol },
      { text: first ? "┐" : "┤", color: accent },
    ]);
    out.push([...box[2], { text: " " }, { text: "│", color: accent }]);
  }
  if (hidden > 0) {
    out.push([{ text: `+${hidden} more`, color: theme.mute }, { text: " ┄┤", color: theme.mute }]);
  }
  // The spine turns left and drops into the hub.
  out.push([
    { text: "  " },
    { text: `┌${"─".repeat(Math.max(0, spineCol - 3))}┘`, color: accent },
  ]);
  out.push([{ text: "  " }, { text: "▼", color: accent }]);
  // Indented under the arrow it arrived on.
  const hubInner = fit([hub.label], width - 6, 2, [hub.detail]);
  out.push(...hubBox(hub, hubInner, accent, "  "));
  return out;
}

/** Spans → plain text, for tests and for anything that needs the raw shape. */
export function render(lines: DiagramLine[]): string[] {
  return lines.map((l) => l.map((s) => s.text).join("").trimEnd());
}
