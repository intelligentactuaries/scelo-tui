// Per-pane chatbot.
//
// Three of these live on screen at once, so the component is deliberately
// cheap: a bounded scrollback, no markdown rendering, and streaming appended
// to a single string rather than a growing list of nodes. Ink re-renders the
// whole tree on every state change, and three panes streaming tokens
// simultaneously is exactly where that becomes visible as flicker.

import { Box, Text } from "ink";
import { useCallback, useEffect, useRef, useState } from "react";
import { type LlmMessage, stream } from "../agent/llm";
import { type Command, commandMenu } from "./commands";
import { Working } from "./spinner";
import { theme } from "./theme";
import { Prose } from "./widgets";

/**
 * One row of a pushed list — the samples, the analyses.
 *
 * Distinct from a `Command`: the `/` menu is DERIVED from what you are
 * typing, whereas these are PUSHED by an action that has a set to choose
 * from. Both are navigated identically, which is the point — after the
 * command menu hands you to a sub-list, the arrows keep working.
 */
export type Choice = { id: string; label: string; hint?: string };

export type ChoiceList = {
  title: string;
  items: Choice[];
  /** Return another list to drill in; anything else closes the picker. */
  onPick: (c: Choice) => ChoiceList | void;
};

export type Turn = {
  role: "you" | "bot";
  text: string;
  /**
   * True when the app wrote this turn, not the model: menus, command
   * results, errors. It is displayed the same way — it IS scelo speaking —
   * but it must never be replayed to the model as something the model said.
   * See `historyFor`.
   */
  local?: true;
  /** Identity for the in-flight streamed turn, so its writer can find it
   *  again after another turn has been appended behind its back. */
  tag?: symbol;
};

/** Turns kept per pane. The panes are short, and an unbounded transcript in
 *  three simultaneous streams is the fastest way to make Ink stutter. */
const MAX_TURNS = 12;

/** Turns replayed to the model. Bounded separately from MAX_TURNS: the pane
 *  can hold more than it is useful (or affordable) to resend, and a 7B model
 *  on a laptop degrades quickly as the prompt grows. */
const HISTORY_TURNS = 8;

/** Longest single turn replayed. One pasted stack trace should not evict the
 *  rest of the conversation from the context window. */
const HISTORY_CHARS = 1200;

/** Prompt lines remembered per pane for ↑↓ recall. */
const HIST_MAX = 50;

/** Back over spaces, then over the word — where ctrl-w and alt-b land. */
function prevWordStart(text: string, from: number): number {
  let i = from;
  while (i > 0 && text[i - 1] === " ") i--;
  while (i > 0 && text[i - 1] !== " ") i--;
  return i;
}

/** Forward over spaces, then over the word — alt-f. */
function nextWordEnd(text: string, from: number): number {
  let i = from;
  while (i < text.length && text[i] === " ") i++;
  while (i < text.length && text[i] !== " ") i++;
  return i;
}

/**
 * Prior turns as model messages.
 *
 * Two things are deliberately filtered out, because replaying them teaches
 * the model to imitate its own failures:
 *
 *   - empty assistant turns (the streaming placeholder, or a model that
 *     returned nothing);
 *
 *   - EVERY LOCAL TURN. This one is load-bearing and was learned the hard
 *     way. Command output is the app talking, but replaying it as an
 *     `assistant` message tells the model it said those words itself — so
 *     after `/example` printed the sample menu, the model believed it had
 *     just described six datasets, and when the user replied "2" it
 *     confabulated a whole schema card for a file nothing had loaded. The
 *     app's state reaches the model through the system context, which is
 *     rebuilt per send and is authoritative; it must not also arrive as
 *     fake memories of the model's own speech.
 *
 * Dropping local turns can leave two adjacent user turns. Every provider
 * accepts that (Anthropic merges same-role neighbours), and the alternative
 * — inventing filler assistant text — is exactly the confabulation this
 * function exists to prevent.
 */
export { historyFor as historyForTest };

function historyFor(turns: Turn[]): LlmMessage[] {
  const usable = turns.filter((t) => t.text.trim() !== "" && !t.local);
  return usable.slice(-HISTORY_TURNS).map((t) => ({
    role: t.role === "you" ? ("user" as const) : ("assistant" as const),
    content: t.text.length > HISTORY_CHARS ? `${t.text.slice(0, HISTORY_CHARS)}…` : t.text,
  }));
}

export type ChatHandle = {
  turns: Turn[];
  draft: string;
  /** Caret position in the draft, 0..draft.length. */
  cursor: number;
  busy: boolean;
  /** When the in-flight request started, epoch ms; null when idle. Drives the
   *  elapsed counter, which is the part that separates "slow" from "hung". */
  startedAt: number | null;
  setDraft: (s: string) => void;
  /** `override` runs that text instead of the draft — the command menu needs
   *  it, because setDraft-then-submit in one tick would submit the OLD draft
   *  (submit closes over the state, which has not re-rendered yet). */
  submit: (override?: string) => void;

  // ── line editing ────────────────────────────────────────────────────────
  // The composer is a readline, not an append-only buffer: type anywhere,
  // not just at the end. Every mutation goes through one path so the caret
  // can never leave the text.
  insert: (s: string) => void;
  /** Insert a self-contained token — a dropped path — keeping it a separate
   *  word, so it cannot fuse with whatever was already at the caret. */
  insertToken: (s: string) => void;
  /** Delete before the caret (backspace). */
  backspace: () => void;
  /** Delete AT the caret (ctrl-d / forward delete). */
  del: () => void;
  moveCursor: (delta: number) => void;
  cursorHome: () => void;
  cursorEnd: () => void;
  wordLeft: () => void;
  wordRight: () => void;
  /** ctrl-u: kill back to the start of the line. */
  killToStart: () => void;
  /** ctrl-k: kill to the end of the line. */
  killToEnd: () => void;
  /** ctrl-w: kill the word before the caret. */
  killWord: () => void;

  // ── prompt history ──────────────────────────────────────────────────────
  // ↑ recalls what was sent before, ↓ walks back toward the draft that was
  // in progress. Editing a recalled line detaches the walk, shell-style.
  histPrev: () => void;
  histNext: () => void;
  /** True while ↑↓ are walking history — the `/` menu must not steal the
   *  arrows mid-walk just because a recalled command re-opened it. */
  histActive: boolean;
  /** Record a line that bypassed submit() — the dropped-path load in App
   *  submits by starting the pipeline, and ↑ should still offer it. */
  noteHistory: (text: string) => void;

  // ── the `/` menu ────────────────────────────────────────────────────────
  /** Commands matching the draft, or null when no menu should show. */
  menu: Command[] | null;
  /** Highlighted row, always in range for `menu`. */
  menuIndex: number;
  menuMove: (delta: number) => void;
  /** ⏎ / tab on the highlight: run it, or complete the line for its args. */
  menuAccept: () => void;
  menuDismiss: () => void;

  // ── pushed sub-lists ────────────────────────────────────────────────────
  /** The list currently being chosen from, already filtered. */
  choices: {
    title: string;
    items: Choice[];
    index: number;
    filter: string;
    /** How deep the drill-down is; >1 means esc goes back rather than out. */
    depth: number;
  } | null;
  openChoices: (list: ChoiceList) => void;
  choiceMove: (delta: number) => void;
  choiceAccept: () => void;
  /** Esc: up one level, or close at the top. */
  choiceBack: () => void;
  /** Close the picker outright, however deep and however filtered. Distinct
   *  from choiceBack, which is Esc: one step back, filter first. */
  closeChoices: () => void;
  choiceType: (ch: string) => void;
  /** Filter by `text` and accept the first match, atomically — for a chunk
   *  where a keystroke and its Enter arrived together. */
  choiceTypeAccept: (text: string) => void;
  choiceBackspace: () => void;
  /** Push a turn without calling the model — used by the pipeline to narrate
   *  itself into the pane it belongs to. */
  say: (text: string) => void;
};

export function useChat(args: {
  /** Stage framing plus whatever the pipeline currently knows. Recomputed on
   *  every send so the bot always sees the CURRENT dataset, not the one that
   *  was loaded when the pane mounted. */
  context: () => string;
  /** Deterministic intents handled locally; return a reply to skip the model. */
  onLocal?: (text: string) => string | null;
}): ChatHandle {
  const [turns, setTurns] = useState<Turn[]>([]);
  // Draft and caret move as one value — a caret outside the text is
  // impossible by construction rather than by clamping at every call site.
  const [line, setLine] = useState<{ text: string; cur: number }>({ text: "", cur: 0 });
  const draft = line.text;
  const cur = line.cur;
  const [busy, setBusy] = useState(false);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  // Sent lines, oldest first, adjacent duplicates collapsed. A ref: pushing
  // to history must not re-render three panes.
  const hist = useRef<string[]>([]);
  /** Where ↑↓ are in the walk; null means "not walking". */
  const [histIdx, setHistIdx] = useState<number | null>(null);
  /** The in-progress draft, parked while ↑ shows older lines. */
  const stash = useRef("");
  // Esc closes the menu for the command being typed. It reopens only once
  // the draft stops being that command — otherwise every keystroke after Esc
  // would pop it straight back up.
  const [dismissed, setDismissed] = useState(false);
  const [menuIndex, setMenuIndex] = useState(0);
  // A stack, not a single list, so a sub-list can open its own sub-list and
  // esc walks back out the way you came in.
  const [stack, setStack] = useState<ChoiceList[]>([]);
  const [choiceIndex, setChoiceIndex] = useState(0);
  const [choiceFilter, setChoiceFilter] = useState("");
  const abort = useRef<AbortController | null>(null);
  // `submit` is memoised and reads the transcript when it fires, so reading
  // `turns` from its closure would replay whatever the history was when the
  // callback was last built — multi-turn would look wired up and silently
  // resend a stale conversation. The ref is assigned during render, so it is
  // always current, and `submit` keeps a stable identity through streaming.
  const turnsRef = useRef<Turn[]>(turns);
  turnsRef.current = turns;

  // ── the draft line ──────────────────────────────────────────────────────
  /** Programmatic sets: submit's clear, menu completion, history recall.
   *  Unless the change IS a recall, it detaches any history walk, so
   *  editing a recalled line makes it yours. */
  const apply = useCallback((text: string, at: number, opts?: { recall?: boolean }) => {
    setLine({ text, cur: Math.max(0, Math.min(at, text.length)) });
    setMenuIndex(0);
    if (!opts?.recall) setHistIdx(null);
  }, []);

  const setDraft = useCallback((next: string) => apply(next, next.length), [apply]);

  /** Keystroke edits. Functional, never from the render's closure: keys can
   *  arrive faster than re-renders (a paste, held-down arrows), and an edit
   *  built on a stale draft silently drops the keys that came between. */
  const edit = useCallback((fn: (text: string, cur: number) => { text: string; cur: number }) => {
    setLine((l) => {
      const n = fn(l.text, l.cur);
      return { text: n.text, cur: Math.max(0, Math.min(n.cur, n.text.length)) };
    });
    setMenuIndex(0);
    setHistIdx(null);
  }, []);

  const insert = useCallback(
    (s: string) => edit((t, c) => ({ text: t.slice(0, c) + s + t.slice(c), cur: c + s.length })),
    [edit],
  );
  const insertToken = useCallback(
    (s: string) =>
      edit((t, c) => {
        // A leading space when the caret follows a word: dropping a file onto
        // a half-typed line must not glue the path to it ("/exp" + a path is
        // one nonexistent token, and Enter would report "no such file").
        const before = t.slice(0, c);
        const ins = `${before === "" || /\s$/.test(before) ? "" : " "}${s} `;
        return { text: before + ins + t.slice(c), cur: c + ins.length };
      }),
    [edit],
  );
  const backspace = useCallback(
    () => edit((t, c) => (c === 0 ? { text: t, cur: c } : { text: t.slice(0, c - 1) + t.slice(c), cur: c - 1 })),
    [edit],
  );
  const del = useCallback(
    () => edit((t, c) => ({ text: t.slice(0, c) + t.slice(c + 1), cur: c })),
    [edit],
  );
  // Caret-only moves: no menu or history side effects, so they go straight
  // to the state rather than through `edit`.
  const moveCursor = useCallback((delta: number) => {
    setLine((l) => ({ ...l, cur: Math.max(0, Math.min(l.cur + delta, l.text.length)) }));
  }, []);
  const cursorHome = useCallback(() => setLine((l) => ({ ...l, cur: 0 })), []);
  const cursorEnd = useCallback(() => setLine((l) => ({ ...l, cur: l.text.length })), []);
  const wordLeft = useCallback(() => {
    setLine((l) => ({ ...l, cur: prevWordStart(l.text, l.cur) }));
  }, []);
  const wordRight = useCallback(() => {
    setLine((l) => ({ ...l, cur: nextWordEnd(l.text, l.cur) }));
  }, []);
  const killToStart = useCallback(() => edit((t, c) => ({ text: t.slice(c), cur: 0 })), [edit]);
  const killToEnd = useCallback(() => edit((t, c) => ({ text: t.slice(0, c), cur: c })), [edit]);
  const killWord = useCallback(
    () =>
      edit((t, c) => {
        const from = prevWordStart(t, c);
        return { text: t.slice(0, from) + t.slice(c), cur: from };
      }),
    [edit],
  );

  // Esc closes the menu for the command being typed; it re-arms once the
  // draft stops being that command. An effect rather than a check inside
  // every mutator: the mutators no longer know the next text up front.
  useEffect(() => {
    if (!draft.startsWith("/")) setDismissed(false);
  }, [draft]);

  // ── prompt history ──────────────────────────────────────────────────────
  const noteHistory = useCallback((text: string) => {
    const t = text.trim();
    if (t === "") return;
    const h = hist.current;
    // Adjacent duplicates collapse (shell-style): ↑ after three identical
    // sends should reach the line BEFORE them on the second press.
    if (h[h.length - 1] !== t) {
      h.push(t);
      if (h.length > HIST_MAX) h.splice(0, h.length - HIST_MAX);
    }
  }, []);

  const histPrev = useCallback(() => {
    const h = hist.current;
    if (h.length === 0) return;
    if (histIdx === null) {
      // Entering the walk parks the draft, so ↓ can bring it back intact.
      stash.current = draft;
      setHistIdx(h.length - 1);
      apply(h[h.length - 1], h[h.length - 1].length, { recall: true });
    } else if (histIdx > 0) {
      setHistIdx(histIdx - 1);
      apply(h[histIdx - 1], h[histIdx - 1].length, { recall: true });
    }
  }, [apply, draft, histIdx]);

  const histNext = useCallback(() => {
    const h = hist.current;
    if (histIdx === null) return;
    if (histIdx < h.length - 1) {
      setHistIdx(histIdx + 1);
      apply(h[histIdx + 1], h[histIdx + 1].length, { recall: true });
    } else {
      // Walked past the newest entry: back to the draft that was parked.
      setHistIdx(null);
      apply(stash.current, stash.current.length);
    }
  }, [apply, histIdx]);

  const say = useCallback((text: string) => {
    setTurns((t) => [...t, { role: "bot" as const, text, local: true as const }].slice(-MAX_TURNS));
  }, []);

  const submit = useCallback(
    (override?: string) => {
    const text = (override ?? draft).trim();
    if (!text || busy) return;
    noteHistory(text);
    // Clears the line; also resets the menu and ends any history walk.
    apply("", 0);
    setTurns((t) => [...t, { role: "you" as const, text }].slice(-MAX_TURNS));

    const local = args.onLocal?.(text);
    if (local != null) {
      // "" means handled-and-silent: the intent will speak through say()
      // when it has something to report. Pushing an empty bot turn would
      // render a speaker label with nothing under it.
      if (local !== "") {
        setTurns((t) =>
          [...t, { role: "bot" as const, text: local, local: true as const }].slice(-MAX_TURNS),
        );
      }
      return;
    }

    setBusy(true);
    setStartedAt(Date.now());
    // The placeholder is tagged rather than located by position. Streaming
    // used to overwrite "the last turn", which is only the placeholder until
    // something else speaks: a say() during the stream — the dropped-path
    // and pasted-contents notices both can — became the reply's canvas, so
    // the notice vanished and the half-streamed answer was left frozen above
    // it as a duplicate.
    const tag = Symbol("streaming");
    setTurns((t) => [...t, { role: "bot" as const, text: "", tag }].slice(-MAX_TURNS));
    /** Rewrite the tagged turn wherever it now sits; a no-op once it has
     *  aged out of the transcript. */
    const writeStream = (turn: Turn) =>
      setTurns((t) => {
        const i = t.findIndex((x) => x.tag === tag);
        if (i === -1) return t;
        const next = t.slice();
        next[i] = turn;
        return next;
      });
    const ac = new AbortController();
    abort.current = ac;
    const msgs: LlmMessage[] = [
      { role: "system", content: args.context() },
      // Prior turns, so "and the second one?" resolves against what was just
      // said. `turns` here is the pre-send snapshot from the closure, which
      // is what we want: the user turn we just pushed is appended explicitly
      // below, and the empty assistant placeholder must not be sent at all.
      ...historyFor(turnsRef.current),
      { role: "user", content: text },
    ];
    void (async () => {
      let acc = "";
      try {
        for await (const piece of stream(msgs, { signal: ac.signal, maxTokens: 320 })) {
          acc += piece;
          writeStream({ role: "bot", text: acc, tag });
        }
        if (acc.trim() === "") {
          writeStream({ role: "bot", text: "(the model returned nothing)", local: true, tag });
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        writeStream({ role: "bot", text: `error: ${msg}`, local: true, tag });
      } finally {
        setBusy(false);
        setStartedAt(null);
        abort.current = null;
      }
    })();
  },
    [draft, busy, args, say, apply, noteHistory],
  );

  // ── menu derivation ──────────────────────────────────────────────────────
  const menu = dismissed ? null : commandMenu(draft);
  // Clamp on read rather than syncing an effect: the filter narrows as you
  // type, and an index left pointing past the end would highlight nothing.
  const clamped = menu ? Math.min(menuIndex, menu.length - 1) : 0;

  const menuMove = useCallback(
    (delta: number) => {
      if (!menu) return;
      const n = menu.length;
      setMenuIndex((i) => (((Math.min(i, n - 1) + delta) % n) + n) % n);
    },
    [menu],
  );

  const menuAccept = useCallback(() => {
    const cmd = menu?.[clamped];
    if (!cmd) return;
    if (cmd.standalone) {
      // Nothing more to say — run it. Explicit text, because setDraft has
      // not landed yet when submit reads its closure.
      submit(`/${cmd.name}`);
      setMenuIndex(0);
      return;
    }
    // Needs an argument: complete the line and get out of the way. The
    // trailing space also closes the menu on its own (a space means the
    // command is settled), so no extra state is needed.
    setDraft(`/${cmd.name} `);
    setMenuIndex(0);
  }, [menu, clamped, submit]);

  const menuDismiss = useCallback(() => setDismissed(true), []);

  // ── pushed sub-lists ─────────────────────────────────────────────────────
  const top = stack.length > 0 ? stack[stack.length - 1] : null;
  // Typing while a list is open narrows it — six samples is fine to arrow
  // through, but the same widget serves the analyses and anything later.
  const shownChoices = top ? narrow(top.items, choiceFilter) : [];
  const choiceAt = Math.min(choiceIndex, Math.max(0, shownChoices.length - 1));

  const openChoices = useCallback((list: ChoiceList) => {
    setStack([list]);
    setChoiceIndex(0);
    setChoiceFilter("");
  }, []);

  const choiceMove = useCallback(
    (delta: number) => {
      const n = shownChoices.length;
      if (n === 0) return;
      setChoiceIndex((i) => (((Math.min(i, n - 1) + delta) % n) + n) % n);
    },
    [shownChoices.length],
  );

  const choiceAccept = useCallback(() => {
    const item = shownChoices[choiceAt];
    if (!item || !top) return;
    const next = top.onPick(item);
    // A returned list drills in; anything else means the choice was the
    // action and the picker's work is done.
    if (next && typeof next === "object" && Array.isArray(next.items)) {
      setStack((st) => [...st, next]);
    } else {
      setStack([]);
    }
    setChoiceIndex(0);
    setChoiceFilter("");
  }, [shownChoices, choiceAt, top]);

  const choiceBack = useCallback(() => {
    // A filter is the first thing esc clears — otherwise a narrowed list
    // vanishes entirely and it looks like esc closed two levels.
    if (choiceFilter !== "") {
      setChoiceFilter("");
      setChoiceIndex(0);
      return;
    }
    setStack((st) => st.slice(0, -1));
    setChoiceIndex(0);
  }, [choiceFilter]);

  /** Esc semantics are wrong for a drop: choiceBack clears a filter and stops
   *  there, leaving the picker modal — so ⏎ would accept a highlighted item
   *  instead of loading the file that was just dropped. */
  const closeChoices = useCallback(() => {
    setStack([]);
    setChoiceIndex(0);
    setChoiceFilter("");
  }, []);

  const choiceType = useCallback((ch: string) => {
    setChoiceFilter((f) => f + ch);
    setChoiceIndex(0);
  }, []);

  /**
   * Filter and accept in one go — for a chunk where typing and its own Enter
   * arrived together (the event loop was blocked between the keystrokes).
   *
   * It cannot be `choiceType` then `choiceAccept`: accept closes over the
   * list as it was BEFORE the filter, so it would pick the wrong row. The
   * filtering happens here, against the text we already hold.
   */
  const choiceTypeAccept = useCallback(
    (text: string) => {
      if (!top) return;
      const filter = choiceFilter + text;
      const matches = narrow(top.items, filter);
      const item = matches[0];
      if (!item) {
        // Nothing matches: leave the filter visible so the empty state
        // explains itself, exactly as typing it by hand would.
        setChoiceFilter(filter);
        setChoiceIndex(0);
        return;
      }
      const next = top.onPick(item);
      if (next && typeof next === "object" && Array.isArray(next.items)) {
        setStack((st) => [...st, next]);
      } else {
        setStack([]);
      }
      setChoiceIndex(0);
      setChoiceFilter("");
    },
    [top, choiceFilter],
  );

  const choiceBackspace = useCallback(() => {
    setChoiceFilter((f) => f.slice(0, -1));
    setChoiceIndex(0);
  }, []);

  return {
    turns,
    draft,
    cursor: cur,
    busy,
    startedAt,
    setDraft,
    submit,
    insert,
    insertToken,
    backspace,
    del,
    moveCursor,
    cursorHome,
    cursorEnd,
    wordLeft,
    wordRight,
    killToStart,
    killToEnd,
    killWord,
    histPrev,
    histNext,
    histActive: histIdx !== null,
    noteHistory,
    say,
    menu,
    menuIndex: clamped,
    menuMove,
    menuAccept,
    menuDismiss,
    choices: top
      ? {
          title: top.title,
          items: shownChoices,
          index: choiceAt,
          filter: choiceFilter,
          depth: stack.length,
        }
      : null,
    openChoices,
    choiceMove,
    choiceAccept,
    choiceBack,
    closeChoices,
    choiceType,
    choiceTypeAccept,
    choiceBackspace,
  };
}

export function ChatView({
  chat,
  width,
  accent,
  focused,
  lines = 6,
}: {
  chat: ChatHandle;
  width: number;
  accent: string;
  focused: boolean;
  lines?: number;
}) {
  // Show the tail — the most recent exchange is what matters in a pane this
  // short, and scrollback would need its own key handling.
  const recent = chat.turns.slice(-4);
  // `flexGrow` on the transcript pins everything below it to the bottom of
  // the pane. Without it the composer floats at whatever height the pane's
  // content happens to end, so the three panes' input lines sit at three
  // different heights and none of them reads as "the place you type".
  return (
    <Box flexDirection="column" flexGrow={1} marginTop={1}>
      <Box>
        <Text color={theme.chrome}>{"─".repeat(Math.max(0, width))}</Text>
      </Box>
      <Box flexDirection="column" flexGrow={1} minHeight={lines}>
        {recent.length === 0 ? (
          <Text color={theme.mute}>ask to change what the agent decided…</Text>
        ) : (
          recent.map((t, i) => (
            <Box key={i} flexDirection="column">
              <Text color={t.role === "you" ? theme.you : accent}>
                {t.role === "you" ? "you" : "scelo"}
              </Text>
              <Prose
                text={t.text || (chat.busy && i === recent.length - 1 ? "…" : "")}
                width={width}
                maxLines={4}
              />
            </Box>
          ))
        )}
      </Box>

      {/* A pushed sub-list takes precedence over the `/` menu — by the time
          one is open the draft has been submitted and cleared, so they
          cannot both be live, but the order states the intent. */}
      {chat.choices && focused ? (
        <PickList
          title={
            chat.choices.filter
              ? `${chat.choices.title} · ${chat.choices.filter}`
              : chat.choices.title
          }
          rows={chat.choices.items.map((c) => ({ key: c.id, name: c.label, hint: c.hint }))}
          index={chat.choices.index}
          width={width}
          accent={accent}
          footer={
            chat.choices.depth > 1 ? "↑↓ move · ⏎ pick · esc back" : "↑↓ move · ⏎ pick · esc cancel"
          }
          empty={`nothing matches "${chat.choices.filter}"`}
          layout="detail"
        />
      ) : (
        chat.menu &&
        focused && (
          <PickList
            rows={chat.menu.map((c) => ({ key: c.name, name: `/${c.name}`, hint: c.hint }))}
            index={chat.menuIndex}
            width={width}
            accent={accent}
            footer="↑↓ move · ⏎ pick · esc close"
          />
        )
      )}

      <Composer chat={chat} width={width} accent={accent} focused={focused} />
    </Box>
  );
}

/**
 * Columns the composer's TEXT gets, given the pane width.
 *
 * The box takes 2 for its border and 2 for paddingX — and the `"› "` prompt
 * is drawn INSIDE it, which the first version of this forgot. Four columns
 * of budget against six columns of chrome is how a long line wrapped the
 * bordered box onto a second row, shunting every pane's content up a line
 * for the rest of the session.
 */
/** The picker's filter, in one place so typing and typing-then-accepting
 *  cannot disagree about what is on screen. */
function narrow(items: Choice[], filter: string): Choice[] {
  if (filter === "") return items;
  const q = filter.toLowerCase();
  return items.filter((it) => `${it.label} ${it.hint ?? ""}`.toLowerCase().includes(q));
}

export function composerRoom(width: number): number {
  return Math.max(8, width - 6);
}

/**
 * The slice of the draft the composer shows, and where the caret sits in it.
 *
 * Every caret position 0..len is addressable — the caret is a cell of its
 * own, over a character or a bar past the end — so the window is computed in
 * `len + 1` cells, not `len`. The caret is parked ~3 columns from the right
 * edge rather than pinned to it, which is what keeps text VISIBLE after the
 * caret when ← walks back into a long line; pinning made the trailing slice
 * empty by construction, so the rest of the line simply vanished.
 */
export function composerWindow(
  draft: string,
  cursor: number,
  room: number,
): { lead: string; before: string; at: string | null; after: string; tail: string } {
  const len = draft.length;
  const cells = len + 1;
  const start = cells > room ? Math.min(Math.max(0, cursor - room + 3), cells - room) : 0;
  const end = start + room;
  // An ellipsis costs a column, so it replaces a cell rather than adding one.
  const leadEl = start > 0;
  const tailEl = end < cells;
  const s = leadEl ? start + 1 : start;
  const e = tailEl ? end - 1 : end;
  return {
    lead: leadEl ? "…" : "",
    before: draft.slice(s, cursor),
    // The caret is drawn ON the character it sits over (inverse video); past
    // the end of the line it is a bar.
    at: cursor < len ? draft[cursor] : null,
    after: draft.slice(cursor + 1, e),
    tail: tailEl ? "…" : "",
  };
}

/** All of them, when they fit — the list is short enough that scrolling a
 *  seven-item menu is worse than showing it. */
const MENU_ROWS = 7;

/**
 * One list widget, used for both the `/` menu and every pushed sub-list.
 *
 * Shared on purpose rather than by coincidence: when the command menu hands
 * you to the samples, the samples have to look and steer identically or the
 * hand-off reads as landing somewhere else entirely.
 */
function PickList({
  title,
  rows,
  index,
  width,
  accent,
  footer,
  empty,
  layout = "columns",
}: {
  title?: string;
  rows: Array<{ key: string; name: string; hint?: string }>;
  index: number;
  width: number;
  accent: string;
  footer: string;
  empty?: string;
  /**
   * "columns" pairs each name with its hint on one line — right for short
   * names and short hints (the `/` menu). "detail" gives every row the full
   * width and shows only the SELECTED row's hint, on a fixed line above the
   * footer. Sub-lists use it because a 40-column pane splits
   * "2. Climate reanalysis ensemble" against "30×7 · ERA5 / MERRA-2 …" by
   * mangling both, and a detail line at a fixed position says everything
   * without the list jumping as you move.
   */
  layout?: "columns" | "detail";
}) {
  if (rows.length === 0) {
    return (
      <Box flexDirection="column">
        {title && <Text color={theme.mute}>{cut(title, width)}</Text>}
        <Text color={theme.warn}>{cut(empty ?? "nothing here", width)}</Text>
        <Text color={theme.mute}>{cut(`  ${footer}`, width)}</Text>
      </Box>
    );
  }
  // Scroll so the highlight stays visible when more match than fit.
  const start = Math.max(0, Math.min(index - Math.floor(MENU_ROWS / 2), rows.length - MENU_ROWS));
  const from = Math.max(0, start);
  const shown = rows.slice(from, from + MENU_ROWS);
  // +1 for the marker column's gap; capped so a long label cannot push every
  // hint off the right edge.
  const nameW = Math.min(Math.floor(width * 0.55), Math.max(...rows.map((r) => r.name.length + 1)));
  const detail = layout === "detail" ? rows[index]?.hint : undefined;
  return (
    <Box flexDirection="column">
      {title && <Text color={theme.mute}>{cut(title, width)}</Text>}
      {shown.map((r, i) => {
        const on = from + i === index;
        // One row per entry, always. Ink wraps overflowing text, and a list
        // whose rows reflow onto second lines as you type is unreadable in a
        // 40-column pane — so both columns are cut to fit instead.
        if (layout === "detail") {
          return (
            <Box key={r.key}>
              <Text color={on ? accent : theme.mute}>{on ? "▸ " : "  "}</Text>
              <Text color={on ? accent : theme.fg} bold={on}>
                {cut(r.name, width - 2)}
              </Text>
            </Box>
          );
        }
        // `nameW - 1`, so padEnd always leaves a separator: a name that cuts
        // to exactly the column width would otherwise run into its hint.
        const name = cut(r.name, nameW - 1).padEnd(nameW);
        const room = width - nameW - 3;
        return (
          <Box key={r.key}>
            <Text color={on ? accent : theme.mute}>{on ? "▸ " : "  "}</Text>
            <Text color={on ? accent : theme.fg} bold={on}>
              {name}
            </Text>
            {r.hint && room > 8 && <Text color={theme.mute}>{cut(r.hint, room)}</Text>}
          </Box>
        );
      })}
      {rows.length > shown.length && (
        <Text color={theme.mute}>{`  … ${rows.length - shown.length} more`}</Text>
      )}
      {detail && <Text color={theme.mute}>{cut(`  ${detail}`, width)}</Text>}
      <Text color={theme.mute}>{cut(`  ${footer}`, width)}</Text>
    </Box>
  );
}

/** Truncate to `n` columns with an ellipsis, never wrap. */
function cut(s: string, n: number): string {
  if (n <= 1) return "";
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

/**
 * The input line, in a box of its own.
 *
 * The border is the point: three panes each ending in a bare `›` gave no
 * sense of where typing lands, especially with the prompt at a different
 * height in every pane. A frame that lights up in the pane's accent when
 * focused answers "where am I typing" at a glance, from across the room.
 */
function Composer({
  chat,
  width,
  accent,
  focused,
}: {
  chat: ChatHandle;
  width: number;
  accent: string;
  focused: boolean;
}) {
  const { draft, cursor } = chat;
  const { lead, before, at, after, tail } = composerWindow(draft, cursor, composerRoom(width));
  return (
    <Box
      width={width}
      borderStyle="round"
      borderColor={focused ? accent : theme.chrome}
      paddingX={1}
    >
      <Text color={focused ? accent : theme.mute}>{"› "}</Text>
      {chat.busy ? (
        // The draft rides alongside the spinner: a line typed — or a path
        // dropped — while a reply streams must stay visible, or the
        // keystrokes read as having gone nowhere.
        <>
          <Working label="thinking" color={accent} since={chat.startedAt} />
          {draft !== "" && (
            <Text color={theme.mute}>
              {" · "}
              {cut(draft, Math.max(6, composerRoom(width) - 12))}
            </Text>
          )}
        </>
      ) : (
        <>
          <Text color={theme.fg}>{lead + before}</Text>
          {focused ? (
            at !== null ? (
              <Text color={theme.fg} inverse>
                {at}
              </Text>
            ) : (
              <Text color={accent}>▌</Text>
            )
          ) : (
            at !== null && <Text color={theme.fg}>{at}</Text>
          )}
          <Text color={theme.fg}>{after + tail}</Text>
          {!focused && draft === "" && <Text color={theme.mute}>…</Text>}
        </>
      )}
    </Box>
  );
}
