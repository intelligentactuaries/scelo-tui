// The greeting.
//
// Claude Code opens with a warm boxed hello and its little orange creature;
// scelo's counterpart is a pixelated 🤓 — the Noto Color Emoji glyph
// downsampled to 12x12 and drawn as half-block terminal art. Each character
// cell carries two vertical pixels: `▀` paints the TOP one as the
// foreground and the BOTTOM one as the background, which is two
// independently coloured pixels per cell and the most a terminal will give.
//
// The art is baked rather than computed: regenerate with
// scripts/emojimark.py after a change, which also writes a scaled-up PNG so
// the result can be looked at. (scripts/brandmark.py, which made the SN Pro
// "S" that used to sit here, is still there if the brand mark comes back.)
//
// Pixels the emoji leaves transparent are left UNPAINTED — a plain space,
// or a half-block with only its opaque half coloured — rather than filled
// with a guess at the terminal's own background. That is what lets a
// full-colour picture sit in a palette otherwise built to survive both a
// white RStudio terminal and a black one: the face is opaque and the round
// hole around it is not, so nothing draws a rectangle of the wrong colour.

import { Box, Text } from "ink";
import type { ReactNode } from "react";
import { theme } from "./theme";

/** A run of cells sharing both colours. `t` is the glyph run, `f` the
 *  foreground (the top pixel), `b` the background (the bottom one). */
type Pixel = { t: string; f?: string; b?: string };

// Generated — see scripts/emojimark.py.
const MARK: Pixel[][] = [
  [{ t: "   " }, { t: "▄", f: "#f5b327" }, { t: "▄", f: "#f7c52b" }, { t: "▄▄", f: "#f8c62b" }, { t: "▄", f: "#f8c52b" }, { t: "▄", f: "#f5b427" }, { t: "   " }],
  [{ t: "▄▄", f: "#35220b" }, { t: "▀", f: "#f7c22b", b: "#f9cb2c" }, { t: "▀", f: "#f8c82c", b: "#fad32d" }, { t: "▀", f: "#f9cf2d", b: "#35220b" }, { t: "▀▀", f: "#fad12d", b: "#35220b" }, { t: "▀", f: "#f9cf2d", b: "#35220b" }, { t: "▀", f: "#f8c82c", b: "#fad32d" }, { t: "▀", f: "#f5b427", b: "#f9cb2c" }, { t: "▄▄", f: "#35220b" }],
  [{ t: "▀", f: "#35220b", b: "#f5ae25" }, { t: "▀", f: "#f8c52b", b: "#f8c92c" }, { t: "▀", f: "#f9cf2d", b: "#fad12d" }, { t: "▀", f: "#36220b", b: "#35220b" }, { t: "▀", f: "#fde030", b: "#fde030" }, { t: "▀▀", f: "#35220b", b: "#fde030" }, { t: "▀", f: "#fde030", b: "#fde030" }, { t: "▀", f: "#35220b", b: "#35220b" }, { t: "▀", f: "#f9cf2d", b: "#fad22d" }, { t: "▀", f: "#f8c52b", b: "#f8c92c" }, { t: "▀", f: "#35220b", b: "#35220b" }],
  [{ t: "▀", f: "#f5b327" }, { t: "▀", f: "#35220b", b: "#f8c52b" }, { t: "▀", f: "#35220b", b: "#35220b" }, { t: "▀▀", f: "#35220b", b: "#ffffff" }, { t: "▀▀", f: "#fde030", b: "#ffffff" }, { t: "▀▀", f: "#35220b", b: "#ffffff" }, { t: "▀", f: "#35220b", b: "#35220b" }, { t: "▀", f: "#35220b", b: "#f8c52b" }, { t: "▀", f: "#f5b327" }],
  [{ t: " " }, { t: "▀", f: "#f5b427" }, { t: "▀", f: "#f8c82c", b: "#f7c42b" }, { t: "▀", f: "#35220b", b: "#f8c92c" }, { t: "▀", f: "#35220b", b: "#f9cd2c" }, { t: "▀▀", f: "#35220b", b: "#ed7770" }, { t: "▀", f: "#35220b", b: "#f9cd2c" }, { t: "▀", f: "#35220b", b: "#f8c92c" }, { t: "▀", f: "#f8c92c", b: "#f7c32b" }, { t: "▀", f: "#f5b427" }, { t: " " }],
  [{ t: "   " }, { t: "▀", f: "#f7c32b" }, { t: "▀", f: "#f8c52b" }, { t: "▀▀", f: "#f8c82c" }, { t: "▀", f: "#f8c52b" }, { t: "▀", f: "#f7c32b" }, { t: "   " }],
];

/** Rows the mark occupies. Exported because the model picker sizes its
 *  scrolling list against everything above it, and "everything above it"
 *  includes this — a mark that grew without that constant following pushed
 *  the bottom of the list off the screen. */
export const MARK_ROWS = MARK.length;

export function Mark(): ReactNode {
  return (
    <Box flexDirection="column">
      {MARK.map((row, y) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: fixed art, positional rows.
        <Text key={y}>
          {row.map((span, x) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: fixed art, positional cells.
            <Text key={x} color={span.f} backgroundColor={span.b}>
              {span.t}
            </Text>
          ))}
        </Text>
      ))}
    </Box>
  );
}

/** The boxed hello: the face on the left, headline + quiet lines on the
 *  right, wrapped in the mascot-orange rounded border. */
export function Welcome({ lines }: { lines: string[] }): ReactNode {
  return (
    <Box
      borderStyle="round"
      borderColor={theme.mascot}
      paddingX={2}
      alignSelf="flex-start"
    >
      <Mark />
      <Box flexDirection="column" marginLeft={2} justifyContent="center">
        <Text>
          <Text color={theme.mascot} bold>
            ✻ Welcome to Scelo!
          </Text>
        </Text>
        {lines.map((line) => (
          <Text key={line} color={theme.mute}>
            {line}
          </Text>
        ))}
      </Box>
    </Box>
  );
}
