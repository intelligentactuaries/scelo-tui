// The greeting.
//
// Claude Code opens with a warm boxed hello and its little orange creature;
// scelo's counterpart is a pixelated 🤓 — the Noto Color Emoji glyph
// downsampled and drawn as half-block terminal art. Each character cell
// carries two vertical pixels: `▀` paints the TOP one as the foreground and
// the BOTTOM one as the background, which is two independently coloured
// pixels per cell and the most a terminal will give.
//
// FOUR sizes, because a terminal cannot scale a glyph — baking the art at
// several resolutions is the only way to have a big one where there is room
// and a legible one where there is not. `pickMark` takes the widest that
// fits its container, so the model picker gets 16x36 on a full screen while
// the SOFT pane, at 42 usable columns, gets whichever rung its own width
// allows. All four come out of the same generator: none is a hand-shrunk
// copy of another, which is what keeps the glasses crisp at every size
// instead of progressively smeared.
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

// Generated — see scripts/emojimark.py. Named for their width in cells.
const M36: Pixel[][] = [
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

const M26: Pixel[][] = [
  [{ t: "       " }, { t: "▄", f: "#f5ac25" }, { t: "▄", f: "#f5b226" }, { t: "▄", f: "#f5b427" }, { t: "▄", f: "#f7c12b" }, { t: "▀", f: "#f5b126", b: "#f7c22b" }, { t: "▀▀", f: "#f5b126", b: "#f7c32b" }, { t: "▀", f: "#f5b126", b: "#f7c22b" }, { t: "▄", f: "#f7c22b" }, { t: "▄", f: "#f5b527" }, { t: "▄", f: "#f5b327" }, { t: "▄", f: "#f5ae25" }, { t: "       " }],
  [{ t: "    " }, { t: "▄", f: "#f4a323" }, { t: "▄", f: "#f5b226" }, { t: "▀", f: "#f5b126", b: "#f7c12b" }, { t: "▀", f: "#f6b728", b: "#f8c52b" }, { t: "▀", f: "#f7c22b", b: "#f8c82c" }, { t: "▀", f: "#f7c42b", b: "#f9ca2c" }, { t: "▀", f: "#f8c62c", b: "#f9cc2c" }, { t: "▀", f: "#f8c82c", b: "#f9ce2c" }, { t: "▀▀", f: "#f8c92c", b: "#facf2d" }, { t: "▀", f: "#f8c82c", b: "#f9ce2d" }, { t: "▀", f: "#f8c72c", b: "#f9cc2c" }, { t: "▀", f: "#f8c52b", b: "#f9ca2c" }, { t: "▀", f: "#f7c32b", b: "#f8c82c" }, { t: "▀", f: "#f6b828", b: "#f8c52b" }, { t: "▀", f: "#f5b126", b: "#f7c22b" }, { t: "▄", f: "#f5b327" }, { t: "▄", f: "#f4a223" }, { t: "    " }],
  [{ t: " " }, { t: "▄▄", f: "#35220b" }, { t: "▀", f: "#f4a223", b: "#35220b" }, { t: "▀", f: "#f5b226", b: "#35220b" }, { t: "▀", f: "#f7c12b", b: "#35220b" }, { t: "▀", f: "#f8c52b", b: "#35220b" }, { t: "▀", f: "#f9c92c", b: "#35220b" }, { t: "▀", f: "#f9cd2c", b: "#35220b" }, { t: "▀", f: "#fad02d", b: "#35220b" }, { t: "▀", f: "#fad22d", b: "#fbd82f" }, { t: "▀", f: "#fad32e", b: "#fbd92f" }, { t: "▀▀", f: "#fad32e", b: "#fcda2f" }, { t: "▀", f: "#fad32e", b: "#fbd92f" }, { t: "▀", f: "#fad22d", b: "#fbd82f" }, { t: "▀", f: "#fad02d", b: "#35220b" }, { t: "▀", f: "#f9cd2c", b: "#35220b" }, { t: "▀", f: "#f9ca2c", b: "#35220b" }, { t: "▀", f: "#f8c62b", b: "#35220b" }, { t: "▀", f: "#f7c22b", b: "#35220b" }, { t: "▀", f: "#f5b327", b: "#35220b" }, { t: "▀", f: "#f4a323", b: "#35220b" }, { t: "▄▄", f: "#35220b" }, { t: " " }],
  [{ t: "▀▀", f: "#35220b", b: "#35220b" }, { t: "▀", f: "#35220b", b: "#36230b" }, { t: "▀", f: "#f7c12b", b: "#f7c32b" }, { t: "▀", f: "#f8c52b", b: "#f8c82c" }, { t: "▀", f: "#f9ca2c", b: "#f9cd2c" }, { t: "▀", f: "#f9cf2d", b: "#f9d22d" }, { t: "▀", f: "#fad42e", b: "#fbd82f" }, { t: "▀", f: "#fbd92f", b: "#fddd30" }, { t: "▀", f: "#35220b", b: "#fddf30" }, { t: "▀", f: "#35220b", b: "#fde030" }, { t: "▀▀▀▀", f: "#35220b", b: "#35220b" }, { t: "▀", f: "#35220b", b: "#fde030" }, { t: "▀", f: "#36230b", b: "#fddf30" }, { t: "▀", f: "#fbd92f", b: "#fddd30" }, { t: "▀", f: "#fad42e", b: "#fbd82f" }, { t: "▀", f: "#fad02d", b: "#fad32d" }, { t: "▀", f: "#f9ca2c", b: "#f9ce2c" }, { t: "▀", f: "#f8c52b", b: "#f8c82c" }, { t: "▀", f: "#f7c12b", b: "#f7c32b" }, { t: "▀", f: "#35220b", b: "#f6b928" }, { t: "▀▀", f: "#35220b", b: "#35220b" }],
  [{ t: " " }, { t: "▀", f: "#35220b", b: "#36230b" }, { t: "▀", f: "#35220b", b: "#35220b" }, { t: "▀", f: "#f8c52b", b: "#f8c72c" }, { t: "▀", f: "#f9ca2c", b: "#f9cd2c" }, { t: "▀", f: "#fad02d", b: "#fad22d" }, { t: "▀", f: "#37240b", b: "#35220b" }, { t: "▀", f: "#36230b", b: "#36230b" }, { t: "▀", f: "#35220b", b: "#35220b" }, { t: "▀▀", f: "#fde030", b: "#fde030" }, { t: "▀", f: "#35220b", b: "#35220b" }, { t: "▀▀", f: "#fde030", b: "#fde030" }, { t: "▀", f: "#35220b", b: "#35220b" }, { t: "▀▀", f: "#fde030", b: "#fde030" }, { t: "▀", f: "#36220b", b: "#35220b" }, { t: "▀▀", f: "#35220b", b: "#35220b" }, { t: "▀", f: "#fad02d", b: "#f9d22d" }, { t: "▀", f: "#f9cb2c", b: "#f9cd2c" }, { t: "▀", f: "#f8c52b", b: "#f8c72c" }, { t: "▀", f: "#f7c12b", b: "#f7c22b" }, { t: "▀", f: "#35220b", b: "#35220b" }, { t: " " }],
  [{ t: " " }, { t: "▀", f: "#f4a223", b: "#f5b026" }, { t: "▀", f: "#35220b", b: "#35220b" }, { t: "▀", f: "#f8c82c", b: "#f8ca2c" }, { t: "▀", f: "#f9ce2d", b: "#facf2d" }, { t: "▀", f: "#fad32d", b: "#fbd42e" }, { t: "▀", f: "#35220b", b: "#fcda2f" }, { t: "▀", f: "#35220b", b: "#35220b" }, { t: "▀", f: "#35220b", b: "#fde030" }, { t: "▀", f: "#fde030", b: "#fde030" }, { t: "▀", f: "#fde030", b: "#35220b" }, { t: "▀", f: "#35220b", b: "#fde030" }, { t: "▀▀", f: "#fde030", b: "#fde030" }, { t: "▀", f: "#36220b", b: "#fde030" }, { t: "▀", f: "#35220b", b: "#35220b" }, { t: "▀", f: "#fde030", b: "#fde030" }, { t: "▀", f: "#35220b", b: "#fde030" }, { t: "▀", f: "#35220b", b: "#37230b" }, { t: "▀", f: "#35220b", b: "#fcda2f" }, { t: "▀", f: "#fad32d", b: "#fbd42e" }, { t: "▀", f: "#facf2d", b: "#fad02d" }, { t: "▀", f: "#f8c92c", b: "#f9ca2c" }, { t: "▀", f: "#35220b", b: "#35220b" }, { t: "▀", f: "#36230b", b: "#f5ae25" }, { t: " " }],
  [{ t: " " }, { t: "▀", f: "#f5b126", b: "#f5b126" }, { t: "▀", f: "#36220b", b: "#f7c22b" }, { t: "▀", f: "#35220b", b: "#36230b" }, { t: "▀", f: "#fad02d", b: "#35220b" }, { t: "▀", f: "#fbd42e", b: "#35220b" }, { t: "▀", f: "#fcda2f", b: "#35220b" }, { t: "▀▀", f: "#fde030", b: "#35220b" }, { t: "▀", f: "#35220b", b: "#35220b" }, { t: "▀", f: "#35220b", b: "#fde030" }, { t: "▀▀▀▀", f: "#fde030", b: "#fde030" }, { t: "▀", f: "#35220b", b: "#fde030" }, { t: "▀", f: "#35220b", b: "#35220b" }, { t: "▀▀", f: "#fde030", b: "#35220b" }, { t: "▀", f: "#fdde30", b: "#35220b" }, { t: "▀", f: "#fbd42e", b: "#35220b" }, { t: "▀", f: "#fad02d", b: "#35220b" }, { t: "▀", f: "#35220b", b: "#36220b" }, { t: "▀", f: "#35220b", b: "#f7c22b" }, { t: "▀", f: "#f5b226", b: "#f5b226" }, { t: " " }],
  [{ t: " " }, { t: "▀", f: "#f5ae25", b: "#f4a323" }, { t: "▀", f: "#f7c22b", b: "#f6b627" }, { t: "▀", f: "#f8c72c", b: "#f8c52b" }, { t: "▀", f: "#f9cc2c", b: "#f8ca2c" }, { t: "▀", f: "#36230b", b: "#35220b" }, { t: "▀▀", f: "#ffffff", b: "#35220b" }, { t: "▀▀", f: "#ffffff", b: "#ffffff" }, { t: "▀▀▀▀▀", f: "#eb8f00", b: "#ffffff" }, { t: "▀▀▀", f: "#ffffff", b: "#ffffff" }, { t: "▀▀", f: "#ffffff", b: "#35220b" }, { t: "▀", f: "#e98d00", b: "#35220b" }, { t: "▀", f: "#f9cd2c", b: "#f9cb2c" }, { t: "▀", f: "#f8c82c", b: "#f8c62b" }, { t: "▀", f: "#f7c22b", b: "#f6b828" }, { t: "▀", f: "#f5af26", b: "#f4a323" }, { t: " " }],
  [{ t: "  " }, { t: "▀", f: "#f5b327", b: "#f4a323" }, { t: "▀", f: "#f7c32b", b: "#f7c22b" }, { t: "▀", f: "#f8c82c", b: "#f8c52b" }, { t: "▀", f: "#f9cc2c", b: "#f9ca2c" }, { t: "▀", f: "#35220b", b: "#36230b" }, { t: "▀▀▀▀▀▀▀▀▀▀▀▀▀", f: "#35220b", b: "#35220b" }, { t: "▀", f: "#f9cc2c", b: "#f9cb2c" }, { t: "▀", f: "#f8c92c", b: "#f8c62b" }, { t: "▀", f: "#f7c32b", b: "#f7c22b" }, { t: "▀", f: "#f5b427", b: "#f5b026" }, { t: "  " }],
  [{ t: "   " }, { t: "▀", f: "#f5b327", b: "#f4a223" }, { t: "▀", f: "#f7c22b", b: "#f5b427" }, { t: "▀", f: "#f8c62c", b: "#f7c22b" }, { t: "▀", f: "#f9cb2c", b: "#f8c62c" }, { t: "▀", f: "#35220b", b: "#f9ca2c" }, { t: "▀", f: "#35220b", b: "#f9cd2c" }, { t: "▀", f: "#35220b", b: "#38240c" }, { t: "▀", f: "#36220b", b: "#ed7770" }, { t: "▀▀▀▀", f: "#ed7770", b: "#ed7770" }, { t: "▀", f: "#36220b", b: "#ed7770" }, { t: "▀", f: "#35220b", b: "#36220b" }, { t: "▀", f: "#35220b", b: "#f9cd2c" }, { t: "▀", f: "#35220b", b: "#f9cb2c" }, { t: "▀", f: "#f9cb2c", b: "#f8c72c" }, { t: "▀", f: "#f8c72c", b: "#f7c32b" }, { t: "▀", f: "#f7c22b", b: "#f5b527" }, { t: "▀", f: "#f5b327", b: "#f4a323" }, { t: "   " }],
  [{ t: "    " }, { t: "▀", f: "#f4a323" }, { t: "▀", f: "#f5b427", b: "#f4a323" }, { t: "▀", f: "#f7c22b", b: "#f5b327" }, { t: "▀", f: "#f8c62b", b: "#f7c22b" }, { t: "▀", f: "#f8c92c", b: "#f7c32b" }, { t: "▀", f: "#f9cb2c", b: "#f8c62b" }, { t: "▀", f: "#f9cd2c", b: "#f8c82c" }, { t: "▀", f: "#facf2d", b: "#f8c92c" }, { t: "▀", f: "#facf2d", b: "#f9ca2c" }, { t: "▀", f: "#f9ce2d", b: "#f9ca2c" }, { t: "▀", f: "#facf2d", b: "#f8c92c" }, { t: "▀", f: "#f9ce2c", b: "#f8c82c" }, { t: "▀", f: "#f9cc2c", b: "#f8c62b" }, { t: "▀", f: "#f8c92c", b: "#f7c42b" }, { t: "▀", f: "#f8c62c", b: "#f7c22b" }, { t: "▀", f: "#f7c22b", b: "#f5b427" }, { t: "▀", f: "#f5b527", b: "#f5ac25" }, { t: "▀", f: "#f5ab24" }, { t: "    " }],
  [{ t: "       " }, { t: "▀", f: "#f5af25" }, { t: "▀", f: "#f5b427" }, { t: "▀", f: "#f6b828" }, { t: "▀", f: "#f7c22b", b: "#f5b126" }, { t: "▀", f: "#f7c32b", b: "#f5b527" }, { t: "▀", f: "#f7c32b", b: "#f6b628" }, { t: "▀", f: "#f7c32b", b: "#f6b728" }, { t: "▀", f: "#f7c32b", b: "#f6b627" }, { t: "▀", f: "#f7c22b", b: "#f5b226" }, { t: "▀", f: "#f7c12b" }, { t: "▀", f: "#f5b427" }, { t: "▀", f: "#f5b026" }, { t: "       " }],
];

const M18: Pixel[][] = [
  [{ t: "    " }, { t: "▄", f: "#f5b226" }, { t: "▄", f: "#f7c22b" }, { t: "▀", f: "#f5b427", b: "#f7c42b" }, { t: "▀", f: "#f5b427", b: "#f8c72c" }, { t: "▀▀", f: "#f5b427", b: "#f8c92c" }, { t: "▀", f: "#f5b427", b: "#f8c72c" }, { t: "▀", f: "#f5b327", b: "#f8c52b" }, { t: "▄", f: "#f7c22b" }, { t: "▄", f: "#f5b226" }, { t: "    " }],
  [{ t: " " }, { t: "▄▄", f: "#35220b" }, { t: "▀", f: "#f5b327", b: "#35220b" }, { t: "▀", f: "#f7c42b", b: "#35220b" }, { t: "▀", f: "#f8c92c", b: "#35220b" }, { t: "▀", f: "#f9cd2d", b: "#35220b" }, { t: "▀", f: "#fad02d", b: "#fbd92f" }, { t: "▀▀", f: "#fad22d", b: "#fbd92f" }, { t: "▀", f: "#fad02d", b: "#fbd92f" }, { t: "▀", f: "#f9cd2d", b: "#35220b" }, { t: "▀", f: "#f8c92c", b: "#35220b" }, { t: "▀", f: "#f7c42b", b: "#35220b" }, { t: "▀", f: "#f5b327", b: "#35220b" }, { t: "▄▄", f: "#35220b" }, { t: " " }],
  [{ t: "▀", f: "#35220b" }, { t: "▀", f: "#35220b", b: "#35220b" }, { t: "▀", f: "#f7c32b", b: "#f8c52b" }, { t: "▀", f: "#f8c92c", b: "#f9cd2d" }, { t: "▀", f: "#fad02d", b: "#36230b" }, { t: "▀", f: "#fbd92f", b: "#36220b" }, { t: "▀", f: "#fdde30", b: "#fde030" }, { t: "▀▀▀▀", f: "#35220b", b: "#35220b" }, { t: "▀", f: "#fdde30", b: "#fde030" }, { t: "▀", f: "#fbd92f", b: "#35220b" }, { t: "▀", f: "#fad12d", b: "#35220b" }, { t: "▀", f: "#f8c92c", b: "#f9ce2d" }, { t: "▀", f: "#f7c32b", b: "#f8c52b" }, { t: "▀", f: "#35220b", b: "#35220b" }, { t: "▀", f: "#35220b" }],
  [{ t: " " }, { t: "▀", f: "#35220b", b: "#35220b" }, { t: "▀", f: "#f8c72c", b: "#f9ca2c" }, { t: "▀", f: "#fad12d", b: "#fad22d" }, { t: "▀", f: "#35220b", b: "#fbd92f" }, { t: "▀", f: "#35220b", b: "#35220b" }, { t: "▀", f: "#fde030", b: "#fde030" }, { t: "▀", f: "#35220b", b: "#35220b" }, { t: "▀▀", f: "#fde030", b: "#fde030" }, { t: "▀", f: "#35220b", b: "#35220b" }, { t: "▀", f: "#fde030", b: "#fde030" }, { t: "▀", f: "#35220b", b: "#36230b" }, { t: "▀", f: "#35220b", b: "#35220b" }, { t: "▀", f: "#fad12d", b: "#fad22d" }, { t: "▀", f: "#f8c82c", b: "#f9ca2c" }, { t: "▀", f: "#35220b", b: "#35220b" }, { t: " " }],
  [{ t: " " }, { t: "▀", f: "#f5b527", b: "#f5b327" }, { t: "▀", f: "#35220b", b: "#f8c72c" }, { t: "▀", f: "#35220b", b: "#36230b" }, { t: "▀", f: "#35220b", b: "#ffffff" }, { t: "▀", f: "#fde030", b: "#ffffff" }, { t: "▀", f: "#35220b", b: "#eb8f00" }, { t: "▀", f: "#fde030", b: "#eb8f00" }, { t: "▀▀", f: "#fde030", b: "#fde030" }, { t: "▀", f: "#fde030", b: "#eb8f00" }, { t: "▀", f: "#35220b", b: "#ffffff" }, { t: "▀", f: "#fde030", b: "#ffffff" }, { t: "▀", f: "#35220b", b: "#ffffff" }, { t: "▀", f: "#35220b", b: "#35220b" }, { t: "▀", f: "#35220b", b: "#f8c82c" }, { t: "▀", f: "#f5b527", b: "#f5b427" }, { t: " " }],
  [{ t: " " }, { t: "▀", f: "#f5b327", b: "#f5af26" }, { t: "▀", f: "#f8c52b", b: "#f7c32b" }, { t: "▀", f: "#f8ca2c", b: "#f8c92c" }, { t: "▀▀", f: "#35220b", b: "#35220b" }, { t: "▀▀▀▀▀▀", f: "#ffffff", b: "#35220b" }, { t: "▀▀", f: "#35220b", b: "#35220b" }, { t: "▀", f: "#f9cb2c", b: "#f9ca2c" }, { t: "▀", f: "#f8c62b", b: "#f7c32b" }, { t: "▀", f: "#f5b427", b: "#f5b026" }, { t: " " }],
  [{ t: "  " }, { t: "▀", f: "#f5b327" }, { t: "▀", f: "#f8c42b", b: "#f5b427" }, { t: "▀", f: "#f9ca2c", b: "#f8c42b" }, { t: "▀", f: "#35220b", b: "#f9ca2c" }, { t: "▀", f: "#35220b", b: "#f9cd2c" }, { t: "▀", f: "#35220b", b: "#ed7770" }, { t: "▀▀", f: "#ed7770", b: "#ed7770" }, { t: "▀", f: "#36220b", b: "#ed7770" }, { t: "▀", f: "#35220b", b: "#f9cc2c" }, { t: "▀", f: "#35220b", b: "#f9ca2c" }, { t: "▀", f: "#f9cb2c", b: "#f8c52b" }, { t: "▀", f: "#f8c52b", b: "#f5b527" }, { t: "▀", f: "#f5b327" }, { t: "  " }],
  [{ t: "    " }, { t: "▀", f: "#f5b327" }, { t: "▀", f: "#f7c32b" }, { t: "▀", f: "#f8c62b", b: "#f5b427" }, { t: "▀", f: "#f8c82c", b: "#f7c22b" }, { t: "▀▀", f: "#f9ca2c", b: "#f7c32b" }, { t: "▀", f: "#f8c92c", b: "#f7c22b" }, { t: "▀", f: "#f8c62b", b: "#f5b527" }, { t: "▀", f: "#f7c32b" }, { t: "▀", f: "#f5b327" }, { t: "    " }],
];

const M14: Pixel[][] = [
  [{ t: "  " }, { t: "▄", f: "#f5b126" }, { t: "▄", f: "#f7c32b" }, { t: "▀", f: "#f5b327", b: "#f8c82c" }, { t: "▀", f: "#f7c32b", b: "#f9cd2c" }, { t: "▀", f: "#f8c42b", b: "#f9cf2d" }, { t: "▀", f: "#f7c42b", b: "#facf2d" }, { t: "▀", f: "#f7c32b", b: "#f9cd2c" }, { t: "▀", f: "#f5b427", b: "#f8c82c" }, { t: "▄", f: "#f7c32b" }, { t: "▄", f: "#f5b126" }, { t: "  " }],
  [{ t: "▄", f: "#35220b" }, { t: "▀", f: "#35220b", b: "#35220b" }, { t: "▀", f: "#35220b", b: "#f8c82c" }, { t: "▀", f: "#35220b", b: "#fad12d" }, { t: "▀", f: "#35220b", b: "#fbd92f" }, { t: "▀", f: "#35220b", b: "#fddf30" }, { t: "▀▀", f: "#fbd92f", b: "#35220b" }, { t: "▀", f: "#35220b", b: "#fddf30" }, { t: "▀", f: "#35220b", b: "#fbd92f" }, { t: "▀", f: "#35220b", b: "#fad12d" }, { t: "▀", f: "#35220b", b: "#f8c82c" }, { t: "▀", f: "#35220b", b: "#35220b" }, { t: "▄", f: "#35220b" }],
  [{ t: "▄", f: "#f5ad25" }, { t: "▀", f: "#f7c42b", b: "#35220b" }, { t: "▀", f: "#f9cd2c", b: "#facf2d" }, { t: "▀▀", f: "#35220b", b: "#35220b" }, { t: "▀", f: "#fde030", b: "#35220b" }, { t: "▀▀", f: "#fde030", b: "#fde030" }, { t: "▀", f: "#fde030", b: "#35220b" }, { t: "▀", f: "#35220b", b: "#36220b" }, { t: "▀", f: "#35220b", b: "#35220b" }, { t: "▀", f: "#f9cd2d", b: "#fad02d" }, { t: "▀", f: "#f7c42b", b: "#35220b" }, { t: " " }],
  [{ t: "▀", f: "#f5ae25" }, { t: "▀", f: "#35220b", b: "#f7c32b" }, { t: "▀", f: "#35220b", b: "#f8ca2c" }, { t: "▀▀▀", f: "#35220b", b: "#ffffff" }, { t: "▀▀", f: "#fde030", b: "#ffffff" }, { t: "▀▀▀", f: "#35220b", b: "#ffffff" }, { t: "▀", f: "#35220b", b: "#f9cb2c" }, { t: "▀", f: "#36220b", b: "#f7c42b" }, { t: "▀", f: "#f5af26" }],
  [{ t: " " }, { t: "▀", f: "#f5b427", b: "#f5b126" }, { t: "▀", f: "#f8c82c", b: "#f7c42b" }, { t: "▀", f: "#35220b", b: "#f9ca2c" }, { t: "▀▀", f: "#35220b", b: "#35220b" }, { t: "▀▀", f: "#35220b", b: "#ed7770" }, { t: "▀▀", f: "#35220b", b: "#35220b" }, { t: "▀", f: "#35220b", b: "#f9ca2c" }, { t: "▀", f: "#f8c82c", b: "#f7c42b" }, { t: "▀", f: "#f5b427", b: "#f5b126" }, { t: " " }],
  [{ t: "  " }, { t: "▀", f: "#f5b226" }, { t: "▀", f: "#f7c42b" }, { t: "▀", f: "#f8c92c", b: "#f5b327" }, { t: "▀", f: "#f9cc2c", b: "#f7c42b" }, { t: "▀▀", f: "#f9cd2c", b: "#f8c52b" }, { t: "▀", f: "#f9cc2c", b: "#f7c42b" }, { t: "▀", f: "#f8c92c", b: "#f5b427" }, { t: "▀", f: "#f7c42b" }, { t: "▀", f: "#f5b126" }, { t: "  " }],
];

/** Widest first — `pickMark` walks this and takes the first that fits. */
const LADDER: Pixel[][][] = [M36, M26, M18, M14];

/** Cell width of a mark, measured rather than declared: the generator trims
 *  its own transparent edges, so the number is whatever came out. */
function markCols(mark: Pixel[][]): number {
  return Math.max(...mark.map((row) => row.reduce((n, s) => n + [...s.t].length, 0)));
}

/** The headline sits beside the mark and is the one line that must not be
 *  clipped, so it is part of the mark's width budget rather than a victim
 *  of it. */
const HEADLINE = "✻ Welcome to Scelo!";
/** Columns the box spends before the text starts: two borders, paddingX on
 *  both sides, and the gap between the mark and the words. */
const BOX_CHROME = 2 + 4 + 2;

/**
 * The largest mark that fits, or the smallest one if none does.
 *
 * Both budgets bind in practice and they bind in different places: the SOFT
 * pane is 42 columns at the minimum terminal size and has vertical room to
 * spare, while a short terminal on the model picker has width and no rows.
 */
export function pickMark(width?: number, maxRows?: number): Pixel[][] {
  const room = width === undefined ? Number.POSITIVE_INFINITY : width - BOX_CHROME - HEADLINE.length;
  const rows = maxRows ?? Number.POSITIVE_INFINITY;
  return LADDER.find((m) => markCols(m) <= room && m.length <= rows) ?? LADDER[LADDER.length - 1];
}

/** Rows the chosen mark occupies. Exported because the model picker sizes
 *  its scrolling list against everything above it, and "everything above it"
 *  includes this — a mark that grew without that number following would push
 *  the bottom of the list off the screen with nothing to say why. */
export function markRows(width?: number, maxRows?: number): number {
  return pickMark(width, maxRows).length;
}

export function Mark({ width, maxRows }: { width?: number; maxRows?: number }): ReactNode {
  return (
    <Box flexDirection="column">
      {pickMark(width, maxRows).map((row, y) => (
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

/**
 * The boxed hello: the face on the left, headline + quiet lines on the
 * right, wrapped in the mascot-orange rounded border.
 *
 * `width` is the container's usable width. It picks the mark AND clips the
 * text, which is what stops the box running past the edge of whatever holds
 * it: the box sizes itself to its longest line, so without a ceiling the
 * greeting spilled across the SOFT pane's border and into TOOLS — which it
 * had been doing since before the mark was a face.
 */
export function Welcome({
  lines,
  width,
  maxRows,
}: {
  lines: string[];
  /** Usable columns in the container. Unbounded when omitted. */
  width?: number;
  /** Rows the mark may spend. Unbounded when omitted. */
  maxRows?: number;
}): ReactNode {
  const mark = pickMark(width, maxRows);
  const room =
    width === undefined ? undefined : Math.max(8, width - markCols(mark) - BOX_CHROME);
  const clip = (s: string) =>
    room !== undefined && s.length > room ? `${s.slice(0, room - 1)}…` : s;
  return (
    <Box
      borderStyle="round"
      borderColor={theme.mascot}
      paddingX={2}
      alignSelf="flex-start"
    >
      <Mark width={width} maxRows={maxRows} />
      <Box flexDirection="column" marginLeft={2} justifyContent="center">
        <Text wrap="truncate">
          <Text color={theme.mascot} bold>
            {clip(HEADLINE)}
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
