// The greeting.
//
// Claude Code opens with a warm boxed hello and its little orange creature;
// scelo's counterpart is a pixelated 🤓 — the Noto Color Emoji glyph
// downsampled and drawn as half-block terminal art. Each character cell
// carries two vertical pixels: `▀` paints the TOP one as the foreground and
// the BOTTOM one as the background, which is two independently coloured
// pixels per cell and the most a terminal will give.
//
// Two sizes, because a terminal cannot scale a glyph and this is the only
// way to have a big one. LARGE (16 rows x 36 cols) is the greeting proper,
// on the model picker where the whole screen is available. SMALL (5 x 12) is
// for the SOFT pane, whose 42 usable columns cannot hold the large mark AND
// the words next to it, and for terminals too short to spend 18 rows on a
// hello. Both come out of the same generator at different sizes rather than
// one being a hand-shrunk copy of the other.
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
const LARGE: Pixel[][] = [
  [{ t: "          " }, { t: "▄", f: "#f4a424" }, { t: "▄", f: "#f5ad25" }, { t: "▄", f: "#f5b527" }, { t: "▀", f: "#f5ae25", b: "#f6ba29" }, { t: "▀", f: "#f5b026", b: "#f7c12b" }, { t: "▀", f: "#f5b427", b: "#f7c12b" }, { t: "▀", f: "#f5b427", b: "#f7c22b" }, { t: "▀▀", f: "#f6b427", b: "#f7c22b" }, { t: "▀", f: "#f5b427", b: "#f7c22b" }, { t: "▀", f: "#f5b427", b: "#f7c12b" }, { t: "▀", f: "#f5b126", b: "#f7c12b" }, { t: "▀", f: "#f5ad25", b: "#f6ba29" }, { t: "▄", f: "#f6b627" }, { t: "▄", f: "#f5af26" }, { t: "▄", f: "#f4a624" }, { t: "          " }],
  [{ t: "       " }, { t: "▄", f: "#f4a323" }, { t: "▀", f: "#f4a323", b: "#f5b226" }, { t: "▀", f: "#f5af26", b: "#f6bb29" }, { t: "▀", f: "#f6b527", b: "#f7c22b" }, { t: "▀", f: "#f6ba29", b: "#f7c42b" }, { t: "▀", f: "#f7c22b", b: "#f8c62c" }, { t: "▀", f: "#f7c32b", b: "#f8c82c" }, { t: "▀", f: "#f8c52b", b: "#f9c92c" }, { t: "▀", f: "#f8c62c", b: "#f9ca2c" }, { t: "▀", f: "#f8c62c", b: "#f9cb2c" }, { t: "▀", f: "#f8c72c", b: "#f9cb2c" }, { t: "▀", f: "#f8c72c", b: "#f9cc2c" }, { t: "▀", f: "#f8c62c", b: "#f9cb2c" }, { t: "▀", f: "#f8c62c", b: "#f9ca2c" }, { t: "▀", f: "#f8c52b", b: "#f9c92c" }, { t: "▀", f: "#f7c32b", b: "#f8c82c" }, { t: "▀", f: "#f7c22b", b: "#f8c62c" }, { t: "▀", f: "#f7c12b", b: "#f8c42b" }, { t: "▀", f: "#f6b628", b: "#f7c22b" }, { t: "▀", f: "#f5af26", b: "#f6bb29" }, { t: "▀", f: "#f4a423", b: "#f5b226" }, { t: "▄", f: "#f4a423" }, { t: "       " }],
  [{ t: "     " }, { t: "▄", f: "#f4a323" }, { t: "▀", f: "#f4a323", b: "#f5b427" }, { t: "▀", f: "#f5b427", b: "#f7c12b" }, { t: "▀", f: "#f7c12b", b: "#f7c42b" }, { t: "▀", f: "#f7c32b", b: "#f8c72c" }, { t: "▀", f: "#f8c62c", b: "#f9ca2c" }, { t: "▀", f: "#f8c82c", b: "#f9cc2c" }, { t: "▀", f: "#f9ca2c", b: "#facf2d" }, { t: "▀", f: "#f9cc2c", b: "#fad12d" }, { t: "▀", f: "#f9ce2c", b: "#fad22e" }, { t: "▀", f: "#facf2d", b: "#fad32e" }, { t: "▀▀▀▀", f: "#fad02d", b: "#fbd42e" }, { t: "▀", f: "#facf2d", b: "#fad32e" }, { t: "▀", f: "#f9ce2c", b: "#fad32e" }, { t: "▀", f: "#f9cc2c", b: "#fad12d" }, { t: "▀", f: "#f9cb2c", b: "#facf2d" }, { t: "▀", f: "#f8c82c", b: "#f9cc2c" }, { t: "▀", f: "#f8c62c", b: "#f9ca2c" }, { t: "▀", f: "#f7c32b", b: "#f8c72c" }, { t: "▀", f: "#f7c12b", b: "#f8c42b" }, { t: "▀", f: "#f5b628", b: "#f7c22b" }, { t: "▀", f: "#f5ac25", b: "#f6b628" }, { t: "▄", f: "#f4a323" }, { t: "     " }],
  [{ t: "▄", f: "#36220b" }, { t: "▄▄▄", f: "#35220b" }, { t: "▀", f: "#f4a223", b: "#35220b" }, { t: "▀", f: "#35220b", b: "#36230b" }, { t: "▀▀▀▀▀", f: "#35220b", b: "#35220b" }, { t: "▀", f: "#35220b", b: "#36230b" }, { t: "▀", f: "#fad22e", b: "#35220b" }, { t: "▀", f: "#fad42e", b: "#35220b" }, { t: "▀", f: "#f9d32d", b: "#35220b" }, { t: "▀", f: "#fbd82f", b: "#35220b" }, { t: "▀", f: "#fbd92f", b: "#fddd30" }, { t: "▀▀", f: "#fbd92f", b: "#fdde30" }, { t: "▀", f: "#fbd92f", b: "#fddd30" }, { t: "▀", f: "#fbd82f", b: "#fcdb2f" }, { t: "▀", f: "#fbd82f", b: "#35220b" }, { t: "▀", f: "#fbd42e", b: "#35220b" }, { t: "▀", f: "#fad22e", b: "#35220b" }, { t: "▀", f: "#35220b", b: "#36230b" }, { t: "▀▀▀▀▀", f: "#35220b", b: "#35220b" }, { t: "▀", f: "#35220b", b: "#36230b" }, { t: "▀", f: "#35220b", b: "#35220b" }, { t: "▄▄▄▄", f: "#35220b" }],
  [{ t: "▀▀▀", f: "#35220b", b: "#35220b" }, { t: "▀", f: "#35220b", b: "#36230b" }, { t: "▀", f: "#f6bb29", b: "#f6bb29" }, { t: "▀", f: "#f7c22b", b: "#f7c42b" }, { t: "▀", f: "#f8c62c", b: "#f8c82c" }, { t: "▀", f: "#f9ca2c", b: "#f9cc2c" }, { t: "▀", f: "#f9cd2c", b: "#fad02d" }, { t: "▀", f: "#fad12d", b: "#fad42e" }, { t: "▀", f: "#fad42e", b: "#fbd82f" }, { t: "▀", f: "#fbd82f", b: "#fbda2f" }, { t: "▀", f: "#fcda2f", b: "#fdde30" }, { t: "▀", f: "#38240b", b: "#fddf30" }, { t: "▀", f: "#35220b", b: "#fde030" }, { t: "▀", f: "#35220b", b: "#35220b" }, { t: "▀", f: "#36230b", b: "#35220b" }, { t: "▀▀▀", f: "#35220b", b: "#35220b" }, { t: "▀", f: "#36220b", b: "#35220b" }, { t: "▀", f: "#35220b", b: "#37240b" }, { t: "▀", f: "#37230b", b: "#fddf30" }, { t: "▀", f: "#fcda2f", b: "#fdde30" }, { t: "▀", f: "#fbd82f", b: "#fbda2f" }, { t: "▀", f: "#fbd42e", b: "#fbd82f" }, { t: "▀", f: "#fad12d", b: "#fad32e" }, { t: "▀", f: "#f9cd2c", b: "#fad02d" }, { t: "▀", f: "#f9ca2c", b: "#f9cd2c" }, { t: "▀", f: "#f8c62c", b: "#f8c92c" }, { t: "▀", f: "#f7c22b", b: "#f8c52b" }, { t: "▀", f: "#f6ba29", b: "#f7c12b" }, { t: "▀", f: "#36230b", b: "#f6b527" }, { t: "▀▀▀", f: "#35220b", b: "#35220b" }],
  [{ t: " " }, { t: "▀", f: "#35220b" }, { t: "▀▀", f: "#35220b", b: "#35220b" }, { t: "▀", f: "#f7c22b", b: "#f7c32b" }, { t: "▀", f: "#f8c62c", b: "#f8c82c" }, { t: "▀", f: "#f9ca2c", b: "#f9cc2c" }, { t: "▀", f: "#facf2d", b: "#fad12d" }, { t: "▀", f: "#fad22e", b: "#35220b" }, { t: "▀", f: "#37230b", b: "#896023" }, { t: "▀", f: "#35220b", b: "#896023" }, { t: "▀", f: "#35220b", b: "#35220b" }, { t: "▀", f: "#fde030", b: "#35220b" }, { t: "▀▀", f: "#fde030", b: "#fde030" }, { t: "▀▀", f: "#35220b", b: "#35220b" }, { t: "▀▀", f: "#35220b", b: "#fde030" }, { t: "▀▀", f: "#35220b", b: "#35220b" }, { t: "▀▀▀", f: "#fde030", b: "#fde030" }, { t: "▀", f: "#35220b", b: "#37230c" }, { t: "▀", f: "#35220b", b: "#896023" }, { t: "▀", f: "#35220b", b: "#35220b" }, { t: "▀", f: "#f7d12d", b: "#35220b" }, { t: "▀", f: "#facf2d", b: "#fad22d" }, { t: "▀", f: "#f9cb2c", b: "#f9cd2c" }, { t: "▀", f: "#f8c72c", b: "#f8c82c" }, { t: "▀", f: "#f7c22b", b: "#f7c42b" }, { t: "▀", f: "#f6bb29", b: "#f7c12b" }, { t: "▀", f: "#35220b", b: "#35220b" }, { t: "▀", f: "#35220b" }, { t: " " }],
  [{ t: " " }, { t: "▄", f: "#f4a223" }, { t: "▀", f: "#35220b", b: "#36230b" }, { t: "▀", f: "#35220b", b: "#35220b" }, { t: "▀", f: "#f8c52b", b: "#f8c62c" }, { t: "▀", f: "#f9c92c", b: "#f9cb2c" }, { t: "▀", f: "#f9ce2c", b: "#facf2d" }, { t: "▀", f: "#fad32e", b: "#fad42e" }, { t: "▀", f: "#35220b", b: "#35220b" }, { t: "▀", f: "#896023", b: "#35220b" }, { t: "▀", f: "#37230b", b: "#35220b" }, { t: "▀▀", f: "#35220b", b: "#35220b" }, { t: "▀▀", f: "#fde030", b: "#fde030" }, { t: "▀", f: "#35220b", b: "#35220b" }, { t: "▀", f: "#35220b", b: "#fde030" }, { t: "▀▀▀", f: "#fde030", b: "#fde030" }, { t: "▀▀", f: "#35220b", b: "#35220b" }, { t: "▀", f: "#fde030", b: "#fde030" }, { t: "▀", f: "#35220b", b: "#37230b" }, { t: "▀", f: "#36220b", b: "#35220b" }, { t: "▀▀▀", f: "#35220b", b: "#35220b" }, { t: "▀", f: "#fad32e", b: "#fad32d" }, { t: "▀", f: "#facf2d", b: "#fad02d" }, { t: "▀", f: "#f9ca2c", b: "#f9cb2c" }, { t: "▀", f: "#f8c52c", b: "#f8c72c" }, { t: "▀", f: "#f7c22b", b: "#f8c32b" }, { t: "▀", f: "#35220b", b: "#36220b" }, { t: "▀", f: "#b87b1a", b: "#f4a323" }, { t: " " }],
  [{ t: " " }, { t: "▀", f: "#f4a323", b: "#f4a223" }, { t: "▀", f: "#f5ae25", b: "#f5b226" }, { t: "▀", f: "#35220b", b: "#35220b" }, { t: "▀", f: "#f8c72c", b: "#35220b" }, { t: "▀", f: "#f9cb2c", b: "#f9cc2c" }, { t: "▀", f: "#fad02d", b: "#fad12d" }, { t: "▀", f: "#fbd42e", b: "#fbd42e" }, { t: "▀", f: "#fbd82f", b: "#fbd92f" }, { t: "▀", f: "#35220b", b: "#fdde30" }, { t: "▀▀", f: "#35220b", b: "#fde030" }, { t: "▀▀", f: "#fde030", b: "#fde030" }, { t: "▀", f: "#37240b", b: "#35220b" }, { t: "▀", f: "#36220b", b: "#35220b" }, { t: "▀▀▀▀", f: "#fde030", b: "#fde030" }, { t: "▀", f: "#36230b", b: "#fde030" }, { t: "▀", f: "#35220b", b: "#35220b" }, { t: "▀▀", f: "#fde030", b: "#fde030" }, { t: "▀▀", f: "#35220b", b: "#fde030" }, { t: "▀", f: "#35220b", b: "#fdde30" }, { t: "▀", f: "#39250c", b: "#fcda2f" }, { t: "▀", f: "#fbd42e", b: "#fbd52e" }, { t: "▀", f: "#fad12d", b: "#fad12d" }, { t: "▀", f: "#f9cc2c", b: "#f9cc2c" }, { t: "▀", f: "#f8c72c", b: "#f8c92c" }, { t: "▀", f: "#35220b", b: "#35220b" }, { t: "▀", f: "#36230b", b: "#35220b" }, { t: "▀", f: "#f5a824", b: "#f5aa25" }, { t: " " }],
  [{ t: " " }, { t: "▀", f: "#f4a223", b: "#f4a323" }, { t: "▀", f: "#f5b327", b: "#f6b627" }, { t: "▀", f: "#36230b", b: "#f7c22b" }, { t: "▀", f: "#35220b", b: "#36230b" }, { t: "▀", f: "#35220b", b: "#35220b" }, { t: "▀", f: "#fad12d", b: "#35220b" }, { t: "▀", f: "#fbd52e", b: "#35220b" }, { t: "▀", f: "#fbda2f", b: "#35220b" }, { t: "▀", f: "#fdde30", b: "#35220b" }, { t: "▀▀▀", f: "#fde030", b: "#35220b" }, { t: "▀▀", f: "#35220b", b: "#35220b" }, { t: "▀▀▀▀▀▀", f: "#fde030", b: "#fde030" }, { t: "▀", f: "#35220b", b: "#fde030" }, { t: "▀", f: "#35220b", b: "#35220b" }, { t: "▀▀▀", f: "#fde030", b: "#35220b" }, { t: "▀", f: "#fdde30", b: "#35220b" }, { t: "▀", f: "#fcda2f", b: "#35220b" }, { t: "▀", f: "#fbd52e", b: "#35220b" }, { t: "▀", f: "#fad22d", b: "#35220b" }, { t: "▀", f: "#f9cd2c", b: "#35220b" }, { t: "▀", f: "#35220b", b: "#35220b" }, { t: "▀", f: "#36230b", b: "#39250c" }, { t: "▀", f: "#f5b627", b: "#f6b527" }, { t: "▀", f: "#f5aa25", b: "#f5a924" }, { t: " " }],
  [{ t: " " }, { t: "▀", f: "#f4a223" }, { t: "▀", f: "#f5b327", b: "#f5b126" }, { t: "▀", f: "#f7c22b", b: "#f7c12b" }, { t: "▀", f: "#f8c62c", b: "#f8c52b" }, { t: "▀", f: "#f9ca2c", b: "#f9ca2c" }, { t: "▀", f: "#36230b", b: "#eb8f00" }, { t: "▀", f: "#35220b", b: "#39250c" }, { t: "▀▀▀▀", f: "#35220b", b: "#ffffff" }, { t: "▀", f: "#37230b", b: "#ffffff" }, { t: "▀", f: "#eb8f00", b: "#ffffff" }, { t: "▀▀▀▀▀▀▀▀", f: "#fde030", b: "#eb8f00" }, { t: "▀", f: "#eb8f00", b: "#ffffff" }, { t: "▀", f: "#37240b", b: "#ffffff" }, { t: "▀▀▀▀▀", f: "#35220b", b: "#ffffff" }, { t: "▀", f: "#36230b", b: "#face2d" }, { t: "▀", f: "#f9cb2c", b: "#f9ca2c" }, { t: "▀", f: "#f8c72c", b: "#f8c62c" }, { t: "▀", f: "#f7c22b", b: "#f7c12b" }, { t: "▀", f: "#f6b527", b: "#f5b226" }, { t: "▀", f: "#f4a323", b: "#f4a223" }, { t: " " }],
  [{ t: "  " }, { t: "▀", f: "#f5ae25", b: "#f4a323" }, { t: "▀", f: "#f6ba29", b: "#f6b728" }, { t: "▀", f: "#f7c42b", b: "#f7c22b" }, { t: "▀", f: "#f8c82c", b: "#f8c72c" }, { t: "▀", f: "#f8ca2c", b: "#f9ca2c" }, { t: "▀", f: "#36230b", b: "#35220b" }, { t: "▀▀", f: "#35220b", b: "#35220b" }, { t: "▀▀", f: "#ffffff", b: "#35220b" }, { t: "▀", f: "#ffffff", b: "#36220b" }, { t: "▀", f: "#ffffff", b: "#35220b" }, { t: "▀▀▀▀▀▀▀▀", f: "#ffffff", b: "#ffffff" }, { t: "▀▀▀▀", f: "#ffffff", b: "#35220b" }, { t: "▀", f: "#35220b", b: "#35220b" }, { t: "▀", f: "#36230b", b: "#35220b" }, { t: "▀", f: "#35220b", b: "#35220b" }, { t: "▀", f: "#f9cc2c", b: "#f9cb2c" }, { t: "▀", f: "#f8c92c", b: "#f8c72c" }, { t: "▀", f: "#f7c42b", b: "#f7c32b" }, { t: "▀", f: "#f7c12b", b: "#f6b929" }, { t: "▀", f: "#f5b026", b: "#f5ad25" }, { t: "  " }],
  [{ t: "  " }, { t: "▀", f: "#f4a223" }, { t: "▀", f: "#f5b126", b: "#f4a323" }, { t: "▀", f: "#f7c22b", b: "#f6b828" }, { t: "▀", f: "#f8c52b", b: "#f7c22b" }, { t: "▀", f: "#f8c92c", b: "#f8c72c" }, { t: "▀", f: "#f9cc2c", b: "#f9ca2c" }, { t: "▀", f: "#35220b", b: "#3a260c" }, { t: "▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀", f: "#35220b", b: "#35220b" }, { t: "▀", f: "#36230b", b: "#facd2d" }, { t: "▀", f: "#f9cd2c", b: "#f9cb2c" }, { t: "▀", f: "#f9c92c", b: "#f8c72c" }, { t: "▀", f: "#f8c52c", b: "#f7c32b" }, { t: "▀", f: "#f7c22b", b: "#f6b928" }, { t: "▀", f: "#f5b226", b: "#f5ad25" }, { t: "▀", f: "#f4a223" }, { t: "  " }],
  [{ t: "   " }, { t: "▀", f: "#f4a223" }, { t: "▀", f: "#f5b026", b: "#f4a323" }, { t: "▀", f: "#f7c12b", b: "#f5b527" }, { t: "▀", f: "#f7c42b", b: "#f7c22b" }, { t: "▀", f: "#f8c82c", b: "#f8c52b" }, { t: "▀", f: "#f9cb2c", b: "#f8c82c" }, { t: "▀", f: "#39250c", b: "#f9cb2c" }, { t: "▀", f: "#35220b", b: "#f9cd2c" }, { t: "▀", f: "#35220b", b: "#36230b" }, { t: "▀▀", f: "#35220b", b: "#35220b" }, { t: "▀▀", f: "#35220b", b: "#ed7770" }, { t: "▀", f: "#37230b", b: "#ed7770" }, { t: "▀▀", f: "#ed7770", b: "#ed7770" }, { t: "▀", f: "#35220b", b: "#ed7770" }, { t: "▀", f: "#36230b", b: "#ed7770" }, { t: "▀", f: "#35220b", b: "#ed7770" }, { t: "▀▀▀", f: "#35220b", b: "#35220b" }, { t: "▀", f: "#35220b", b: "#face2d" }, { t: "▀", f: "#f9cd2c", b: "#f9cb2c" }, { t: "▀", f: "#f9cb2c", b: "#f8c82c" }, { t: "▀", f: "#f8c82c", b: "#f8c52b" }, { t: "▀", f: "#f8c42b", b: "#f7c12b" }, { t: "▀", f: "#f7c12b", b: "#f6b627" }, { t: "▀", f: "#f5b226", b: "#f5ab25" }, { t: "▀", f: "#f4a223" }, { t: "   " }],
  [{ t: "    " }, { t: "▀", f: "#f4a223" }, { t: "▀", f: "#f5ac25", b: "#e69921" }, { t: "▀", f: "#f6b728", b: "#f5af26" }, { t: "▀", f: "#f7c22b", b: "#f6b728" }, { t: "▀", f: "#f8c52b", b: "#f7c22b" }, { t: "▀", f: "#f8c82c", b: "#f7c42b" }, { t: "▀", f: "#f9cb2c", b: "#f8c72c" }, { t: "▀", f: "#f9cd2c", b: "#f8c92c" }, { t: "▀", f: "#39250c", b: "#f9cc2c" }, { t: "▀", f: "#ed7770", b: "#f9cd2c" }, { t: "▀", f: "#ed7770", b: "#face2d" }, { t: "▀", f: "#ed7770", b: "#facf2d" }, { t: "▀▀▀▀", f: "#ed7770", b: "#ed7770" }, { t: "▀▀", f: "#ed7770", b: "#facf2d" }, { t: "▀", f: "#ed7770", b: "#f9cc2c" }, { t: "▀", f: "#facf2d", b: "#f9cc2c" }, { t: "▀", f: "#f9cd2c", b: "#f9ca2c" }, { t: "▀", f: "#f9cb2c", b: "#f8c72c" }, { t: "▀", f: "#f8c82c", b: "#f8c42b" }, { t: "▀", f: "#f8c52c", b: "#f7c12b" }, { t: "▀", f: "#f7c32b", b: "#f6b929" }, { t: "▀", f: "#f6b929", b: "#f5af25" }, { t: "▀", f: "#f5ae25", b: "#e69921" }, { t: "▀", f: "#f4a223" }, { t: "    " }],
  [{ t: "      " }, { t: "▀", f: "#f4a323" }, { t: "▀", f: "#f5ac25" }, { t: "▀", f: "#f6b628", b: "#f5ac25" }, { t: "▀", f: "#f7c12b", b: "#f5b327" }, { t: "▀", f: "#f7c32b", b: "#f6b828" }, { t: "▀", f: "#f8c52b", b: "#f7c22b" }, { t: "▀", f: "#f8c72c", b: "#f7c32b" }, { t: "▀", f: "#f8c92c", b: "#f8c52b" }, { t: "▀", f: "#f9cb2c", b: "#f8c62c" }, { t: "▀", f: "#f9cc2c", b: "#f8c72c" }, { t: "▀", f: "#f9cc2c", b: "#f8c82c" }, { t: "▀▀", f: "#f9cd2c", b: "#f8c82c" }, { t: "▀", f: "#f9cc2c", b: "#f8c82c" }, { t: "▀", f: "#f9cc2c", b: "#f8c72c" }, { t: "▀", f: "#f9cb2c", b: "#f8c62c" }, { t: "▀", f: "#f9c92c", b: "#f8c52b" }, { t: "▀", f: "#f8c72c", b: "#f7c32b" }, { t: "▀", f: "#f8c52c", b: "#f7c22b" }, { t: "▀", f: "#f7c32b", b: "#f6b928" }, { t: "▀", f: "#f7c12b", b: "#f5b227" }, { t: "▀", f: "#f6b628", b: "#f5ac25" }, { t: "▀", f: "#f5ad25" }, { t: "▀", f: "#f4a223" }, { t: "      " }],
  [{ t: "          " }, { t: "▀", f: "#f5ab25" }, { t: "▀", f: "#f5b226" }, { t: "▀", f: "#f6b929", b: "#f5ad25" }, { t: "▀", f: "#f7c12b", b: "#f5b126" }, { t: "▀", f: "#f7c12b", b: "#f5b427" }, { t: "▀", f: "#f7c22b", b: "#f5b527" }, { t: "▀", f: "#f7c32b", b: "#f6b728" }, { t: "▀", f: "#f8c42b", b: "#f6b928" }, { t: "▀", f: "#f8c42b", b: "#f6b828" }, { t: "▀", f: "#f7c32b", b: "#f6b728" }, { t: "▀", f: "#f7c32b", b: "#f5b527" }, { t: "▀", f: "#f7c22b", b: "#f6b527" }, { t: "▀", f: "#f7c12b", b: "#f5b226" }, { t: "▀", f: "#f6ba29", b: "#f5ae25" }, { t: "▀", f: "#f5b327" }, { t: "▀", f: "#f5ad25" }, { t: "          " }],
];

const SMALL: Pixel[][] = [
  [{ t: "  " }, { t: "▄", f: "#f7c22b" }, { t: "▀", f: "#f5b327", b: "#f8c82c" }, { t: "▀", f: "#f7c52b", b: "#f9cf2d" }, { t: "▀▀", f: "#f8c62b", b: "#fad12d" }, { t: "▀", f: "#f8c52b", b: "#f9cf2d" }, { t: "▀", f: "#f5b427", b: "#f8c82c" }, { t: "▄", f: "#f5b427" }, { t: "  " }],
  [{ t: "▀", f: "#35220b", b: "#35220b" }, { t: "▀", f: "#35220b", b: "#f8c52b" }, { t: "▀", f: "#f9cb2c", b: "#f9cf2d" }, { t: "▀", f: "#fad32d", b: "#36220b" }, { t: "▀", f: "#35220b", b: "#fde030" }, { t: "▀▀", f: "#35220b", b: "#35220b" }, { t: "▀", f: "#35220b", b: "#fde030" }, { t: "▀", f: "#fad32d", b: "#35220b" }, { t: "▀", f: "#f9cb2c", b: "#f9cf2d" }, { t: "▀", f: "#35220b", b: "#f8c52b" }, { t: "▀", f: "#35220b", b: "#35220b" }],
  [{ t: "▀", f: "#f5ae25", b: "#f5b327" }, { t: "▀", f: "#f8c92c", b: "#35220b" }, { t: "▀", f: "#fad12d", b: "#35220b" }, { t: "▀", f: "#35220b", b: "#35220b" }, { t: "▀", f: "#fde030", b: "#35220b" }, { t: "▀▀", f: "#fde030", b: "#fde030" }, { t: "▀", f: "#fde030", b: "#35220b" }, { t: "▀", f: "#35220b", b: "#35220b" }, { t: "▀", f: "#fad22d", b: "#35220b" }, { t: "▀", f: "#f8c92c", b: "#35220b" }, { t: "▀", f: "#35220b", b: "#f5b327" }],
  [{ t: " " }, { t: "▀", f: "#f8c52b", b: "#f5b427" }, { t: "▀", f: "#35220b", b: "#f8c82c" }, { t: "▀▀▀▀▀▀", f: "#ffffff", b: "#35220b" }, { t: "▀", f: "#35220b", b: "#f8c92c" }, { t: "▀", f: "#f8c52b", b: "#f5b427" }, { t: " " }],
  [{ t: "  " }, { t: "▀", f: "#f7c42b" }, { t: "▀", f: "#f8c92c", b: "#f7c32b" }, { t: "▀", f: "#f9cd2c", b: "#f8c52b" }, { t: "▀▀", f: "#ed7770", b: "#f8c82c" }, { t: "▀", f: "#f9cd2c", b: "#f8c52b" }, { t: "▀", f: "#f8c92c", b: "#f7c32b" }, { t: "▀", f: "#f7c32b" }, { t: "  " }],
];

/** Rows each mark occupies. Exported because the model picker sizes its
 *  scrolling list against everything above it, and "everything above it"
 *  includes this — a mark that grew without that constant following would
 *  push the bottom of the list off the screen with nothing to say why. */
export function markRows(compact: boolean): number {
  return (compact ? SMALL : LARGE).length;
}

/** Cell width of each mark, measured rather than declared — the generator
 *  trims its own transparent edges, so the number is whatever came out. */
const cols = (mark: Pixel[][]) =>
  Math.max(...mark.map((row) => row.reduce((n, s) => n + [...s.t].length, 0)));
const LARGE_COLS = cols(LARGE);
const SMALL_COLS = cols(SMALL);

/** Below this the large mark is most of the screen. The picker still has a
 *  list to show under it, so it takes the small one instead. */
export const COMPACT_ROWS = 36;

export function Mark({ compact = false }: { compact?: boolean }): ReactNode {
  return (
    <Box flexDirection="column">
      {(compact ? SMALL : LARGE).map((row, y) => (
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

/** Columns the box spends before the text starts: two borders, paddingX on
 *  both sides, and the gap between the mark and the words. */
const BOX_CHROME = 2 + 4 + 2;

/**
 * The boxed hello: the face on the left, headline + quiet lines on the
 * right, wrapped in the mascot-orange rounded border.
 *
 * `width` is the container's usable width, and giving it is what stops the
 * box running past the edge of whatever holds it. The SOFT pane is 42
 * columns at the minimum terminal size and this box sizes itself to its
 * longest line, so without a ceiling the greeting spilled across the pane
 * border and into TOOLS — which it had been doing since before the mark was
 * a face.
 */
export function Welcome({
  lines,
  compact = false,
  width,
}: {
  lines: string[];
  /** The small mark — for a container too narrow to hold the large one
   *  beside its own text, or a terminal too short to spare the rows. */
  compact?: boolean;
  /** Usable columns in the container. Unbounded when omitted. */
  width?: number;
}): ReactNode {
  const markW = compact ? SMALL_COLS : LARGE_COLS;
  const room = width === undefined ? undefined : Math.max(8, width - markW - BOX_CHROME);
  const clip = (s: string) =>
    room !== undefined && s.length > room ? `${s.slice(0, room - 1)}…` : s;
  return (
    <Box
      borderStyle="round"
      borderColor={theme.mascot}
      paddingX={2}
      alignSelf="flex-start"
    >
      <Mark compact={compact} />
      <Box flexDirection="column" marginLeft={2} justifyContent="center">
        <Text wrap="truncate">
          <Text color={theme.mascot} bold>
            {clip("✻ Welcome to Scelo!")}
          </Text>
        </Text>
        {lines.map((line) => (
          <Text key={line} color={theme.mute} wrap="truncate">
            {clip(line)}
          </Text>
        ))}
      </Box>
    </Box>
  );
}
