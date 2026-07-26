// The "something is happening" animation.
//
// One interval for the whole app, not one per spinner. Ink recomputes and
// repaints the entire frame on any state change, so five independently
// ticking components would mean five full repaints per round — which is the
// stutter Chat.tsx already warns about, arriving from a different direction.
// A single ticker read through `useSyncExternalStore` puts every subscriber's
// update in one React batch, so however many spinners are on screen the cost
// is one repaint per tick. The interval is created on the first subscriber
// and cleared after the last, so an idle app does no work at all.
//
// The glyph grows and shrinks rather than rotating, and goes faint at its
// small end: a rotating bar reads as steady progress, whereas a pulse reads
// as thinking, which is the honest description of what the model is doing.

import { Text } from "ink";
import { useSyncExternalStore } from "react";
import { theme } from "./theme";

/** Grow, peak, shrink — a palindrome, so it pulses instead of snapping back
 *  from the largest glyph to the smallest.
 *
 *  Notably absent: `·`, which reads well in a pulse but is also the stage
 *  list's mark for "not started". The synchronous stages hold the thread and
 *  freeze the animation wherever it happens to be, and freezing on a glyph
 *  that means "pending" would say the opposite of what is true. Every frame
 *  here is unambiguously a star. */
export const FRAMES = ["✢", "✳", "∗", "✻", "✽", "✻", "∗", "✳"] as const;

/** Drawn dim, which is what turns the size change into a flicker. */
const FAINT = new Set<string>(["✢"]);

/** ~8 fps. Fast enough to read as alive, slow enough that a full repaint of a
 *  three-pane layout is not competing with the tokens streaming into it. */
const PERIOD_MS = 120;

// ── the shared ticker ──────────────────────────────────────────────────────

let tick = 0;
let timer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  if (!timer) {
    timer = setInterval(() => {
      tick++;
      for (const l of listeners) l();
    }, PERIOD_MS);
    // Never hold the process open for the sake of an animation.
    timer.unref?.();
  }
  return () => {
    listeners.delete(fn);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

const read = () => tick;

/** Re-renders the calling component ~8 times a second, for as long as it is
 *  mounted. Returns a monotonically increasing tick. */
export function useTick(): number {
  return useSyncExternalStore(subscribe, read, read);
}

export function frameAt(n: number): string {
  return FRAMES[((n % FRAMES.length) + FRAMES.length) % FRAMES.length];
}

/** `8s`, `1m 04s`. Seconds stay two-digit past a minute so the label does not
 *  change width every second and shove the text after it sideways. */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  if (total < 60) return `${total}s`;
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}m ${String(s).padStart(2, "0")}s`;
}

// ── components ─────────────────────────────────────────────────────────────

/** Just the pulsing glyph, for places that already have their own label. */
export function Spinner({ color = theme.fg }: { color?: string }) {
  const n = useTick();
  const glyph = frameAt(n);
  return (
    <Text color={color} dimColor={FAINT.has(glyph)}>
      {glyph}
    </Text>
  );
}

/**
 * Glyph, what it is doing, and how long it has been doing it.
 *
 * `since` is a start timestamp in epoch ms. The elapsed count is what makes a
 * slow local model distinguishable from a hung one, which no amount of
 * animation on its own can do.
 */
export function Working({
  label,
  color = theme.mute,
  since,
}: {
  label: string;
  color?: string;
  since?: number | null;
}) {
  const n = useTick();
  const glyph = frameAt(n);
  const elapsed = since != null ? formatElapsed(Date.now() - since) : null;
  return (
    <Text>
      <Text color={color} dimColor={FAINT.has(glyph)}>
        {glyph}
      </Text>
      <Text color={theme.mute}>
        {" "}
        {label}…{elapsed ? ` ${elapsed}` : ""}
      </Text>
    </Text>
  );
}
