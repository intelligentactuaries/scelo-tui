// The greeting.
//
// Claude Code opens with a warm boxed hello and its little orange creature;
// scelo's counterpart is an owl — the actuary's bird — in the same warm
// orange. One component, two prominences: the full welcome box for the
// landing screens, and the bare bird for anywhere smaller.
//
// The art sticks to plain ASCII glyphs (comma, parens, quotes) so it
// renders identically in every font a terminal might use — box-drawing
// creatures fall apart the moment a font lacks a glyph.

import { Box, Text } from "ink";
import type { ReactNode } from "react";
import { theme } from "./theme";

const OWL = [" ,___, ", " (o,o) ", " /)_)  ", '  " "  '] as const;

export function Owl(): ReactNode {
  return (
    <Box flexDirection="column">
      {OWL.map((line, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: fixed art, positional rows.
        <Text key={i} color={theme.mascot} bold>
          {line}
        </Text>
      ))}
    </Box>
  );
}

/** The boxed hello: owl on the left, headline + up to three quiet lines on
 *  the right, wrapped in the mascot-orange rounded border. */
export function Welcome({ lines }: { lines: string[] }): ReactNode {
  return (
    <Box
      borderStyle="round"
      borderColor={theme.mascot}
      paddingX={2}
      alignSelf="flex-start"
    >
      <Owl />
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
