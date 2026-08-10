// What a paste may deposit in a one-line composer.
//
// Bracketed paste (Ink's usePaste turns it on) hands over the pasted text
// verbatim — newlines, tabs, and whatever escape bytes survived the
// emulator. The composer is a single line and its draft is rendered raw, so
// everything that is not printable text is folded away here, in one place,
// for both the bracketed path and the unbracketed fallback chunk.

/**
 * ESC sequences that may ride along inside a paste, in the order they must be
 * tried:
 *   • OSC — `ESC ] … BEL` or `ESC ] … ESC \`. Title sets and OSC-8 hyperlinks
 *     both appear in text copied out of a terminal.
 *   • CSI — `ESC [ params final`. The parameter class includes `:`, which is
 *     how modern terminals write sub-parameters (`ESC[38:5:196m` for colour);
 *     without it the payload `38:5:196mred` survives as visible text.
 *   • a lone `ESC` + one byte, for the two-character forms.
 */
const ESCAPES =
  /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?|\x1b\[[0-9;:?<>=!]*[A-Za-z~]|\x1b./g;

export function flattenPaste(text: string): string {
  return text
    .replace(ESCAPES, "")
    // The composer is one line: line breaks and tabs become spaces rather
    // than vanishing, so `a\nb` cannot silently fuse into `ab`.
    .replace(/[\r\n\t]+/g, " ")
    // Whatever control bytes remain carry no text.
    .replace(/[\x00-\x1f\x7f]/g, "");
}
