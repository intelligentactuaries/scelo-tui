#!/usr/bin/env python3
"""Regenerate the terminal brand mark baked into src/ui/Mascot.tsx.

Reads the sibling checkout's brand raster (../scelo/brand/scelo_S0_1.png —
the PNG is rendered from scelo_S0_1.svg by scelo's brand/generate_logo.py),
isolates the big S (the lockup's "0.1" subscript is smaller than a terminal
cell at this scale), and emits half-block art: one character cell = 1x2
pixels, so ▀ ▄ █ carry top/bottom/both.

    python3 scripts/brandmark.py [rows]     # default 6

Paste the printed lines into MARK in src/ui/Mascot.tsx.
Requires Pillow.
"""

import sys
from pathlib import Path

from PIL import Image

BRAND = Path(__file__).resolve().parents[2] / "scelo" / "brand" / "scelo_S0_1.png"
ROWS = int(sys.argv[1]) if len(sys.argv) > 1 else 6
THRESHOLD = 110  # post-resize grey level that counts as ink


def main() -> None:
    mask = Image.open(BRAND).convert("L").point(lambda v: 255 if v > 128 else 0)
    crop = mask.crop(mask.getbbox())
    px = crop.load()

    # Column ink profile: the widest empty run separates the S from "0.1".
    cols = [sum(1 for y in range(crop.height) if px[x, y]) for x in range(crop.width)]
    gaps, run, start = [], 0, 0
    for x, c in enumerate(cols):
        if c == 0:
            if run == 0:
                start = x
            run += 1
        else:
            if run:
                gaps.append((run, start))
            run = 0
    s_glyph = crop.crop((0, 0, max(gaps)[1], crop.height))
    s_glyph = s_glyph.crop(s_glyph.getbbox())

    h = ROWS * 2
    w = max(1, round(s_glyph.width * h / s_glyph.height / 2) * 2)
    small = s_glyph.resize((w, h), Image.LANCZOS)
    p = small.load()
    lines = []
    for r in range(ROWS):
        line = "".join(
            "█" if (p[c, 2 * r] > THRESHOLD and p[c, 2 * r + 1] > THRESHOLD)
            else "▀" if p[c, 2 * r] > THRESHOLD
            else "▄" if p[c, 2 * r + 1] > THRESHOLD
            else " "
            for c in range(w)
        )
        lines.append(line.rstrip())
    width = max(len(line) for line in lines)
    for line in lines:
        print(f'  "{line.ljust(width)}",')


if __name__ == "__main__":
    main()
