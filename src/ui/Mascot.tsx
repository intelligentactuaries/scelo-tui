// The greeting.
//
// Claude Code opens with a warm boxed hello and its little orange creature;
// scelo's counterpart is its own brand mark — the SN Pro "S" from
// ../scelo/brand/scelo_S0_1.svg — rendered as half-block terminal art
// (each character cell carries two vertical pixels: ▀ ▄ █). The art is
// baked rather than computed: regenerate with scripts/brandmark.py after a
// brand change. Only the big S travels; the lockup's "0.1" subscript is
// smaller than a terminal cell at this scale, so the text beside the mark
// carries the name instead.
//
// The brand file is white-on-charcoal; in a terminal the glyph wears the
// welcome box's warm orange so the hello reads as one piece.

import { Box, Text } from "ink";
import type { ReactNode } from "react";
import { theme } from "./theme";

const MARK = [
  " ▄██████▄ ",
  "██      ▀ ",
  "▀██▄▄▄    ",
  "   ▀▀▀▀██▄",
  "▄▄      ██",
  "▀▀██████▀ ",
] as const;

export function BrandMark(): ReactNode {
  return (
    <Box flexDirection="column">
      {MARK.map((line, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: fixed art, positional rows.
        <Text key={i} color={theme.mascot} bold>
          {line}
        </Text>
      ))}
    </Box>
  );
}

/** The boxed hello: the S on the left, headline + quiet lines on the right,
 *  wrapped in the mascot-orange rounded border. */
export function Welcome({ lines }: { lines: string[] }): ReactNode {
  return (
    <Box
      borderStyle="round"
      borderColor={theme.mascot}
      paddingX={2}
      alignSelf="flex-start"
    >
      <BrandMark />
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
