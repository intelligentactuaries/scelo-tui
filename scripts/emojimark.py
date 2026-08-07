#!/usr/bin/env python3
"""Regenerate the terminal mark baked into src/ui/Mascot.tsx from an emoji.

Half-block art, like scripts/brandmark.py, but in colour: one character cell
carries 1x2 pixels, drawn as `▀` with the TOP pixel as the foreground and the
BOTTOM pixel as the background. Two independently coloured pixels per cell is
the most a terminal gives you, and at this size it is enough — the point is a
recognisable pixelated face, not a faithful emoji.

Transparent pixels are left unpainted (a plain space, or `▀`/`▄` with only
the opaque half coloured) rather than filled with a guess at the terminal's
background. That is what lets the mark sit on a white RStudio terminal and a
black one without a rectangle of the wrong colour around it.

    python3 scripts/emojimark.py [emoji] [rows]     # default 🤓, 6

Prints the MARK literal to paste into src/ui/Mascot.tsx, and writes a
scaled-up PNG preview next to it so the result can be looked at rather than
imagined. Requires Pillow and Noto Color Emoji.
"""

import sys
from collections import Counter
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

FONT = Path("/usr/share/fonts/truetype/noto/NotoColorEmoji.ttf")
# NotoColorEmoji is a CBDT bitmap font: 109 is the one embedded strike, and
# asking for any other size raises rather than scaling.
FONT_SIZE = 109
EMOJI = sys.argv[1] if len(sys.argv) > 1 else "🤓"
ROWS = int(sys.argv[2]) if len(sys.argv) > 2 else 6
# Below this an edge pixel is more background than glyph, and painting it
# puts a halo of face-colour on whatever the terminal's own background is.
ALPHA = 140


def raster(emoji: str, size: int) -> Image.Image:
    """The emoji, square, `size` pixels on a side, alpha preserved."""
    font = ImageFont.truetype(str(FONT), FONT_SIZE)
    canvas = Image.new("RGBA", (FONT_SIZE * 2, FONT_SIZE * 2), (0, 0, 0, 0))
    ImageDraw.Draw(canvas).text((10, 10), emoji, font=font, embedded_color=True)
    glyph = canvas.crop(canvas.getbbox())
    # Square first, THEN resize: a face squashed to the glyph's own aspect
    # comes out as an egg.
    side = max(glyph.size)
    padded = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    padded.paste(glyph, ((side - glyph.width) // 2, (side - glyph.height) // 2))
    small = modal_resize(padded, size)
    # Squaring the glyph before the resize keeps the face round; it also
    # leaves a rim of empty pixels, and at 36 across that rim is a blank
    # terminal row above and below the art. Trim it AFTER downsampling, so
    # the aspect ratio is already settled and only genuinely empty cells go.
    box = small.getbbox()
    return small.crop(box) if box else small


# Colours close enough to be the same ink. Coarse on purpose: the face is a
# gradient of two dozen yellows and they all have to vote together, or the
# ink that matters loses to its own shading.
QUANT = 24


def modal_resize(img: Image.Image, size: int) -> Image.Image:
    """
    Downsample by MOST COMMON colour per block, not by averaging.

    The averaging filters (LANCZOS, BILINEAR) are built to hide the fact that
    pixels got bigger, which is the opposite of what pixel art wants: at 12
    across, the emoji's thin black spectacle frames blend into the yellow
    behind them and the result is a smiley with a smudge. Voting keeps every
    edge hard, so the glasses survive being three pixels wide — and hard
    edges are the whole request.
    """
    src = img.load()
    w, h = img.size
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    dst = out.load()
    for y in range(size):
        for x in range(size):
            x0, x1 = x * w // size, max(x * w // size + 1, (x + 1) * w // size)
            y0, y1 = y * h // size, max(y * h // size + 1, (y + 1) * h // size)
            block = [src[i, j] for j in range(y0, y1) for i in range(x0, x1)]
            visible = [p for p in block if p[3] >= ALPHA]
            # A block that is more hole than glyph stays a hole — that is
            # what keeps the round face round instead of squared off.
            if len(visible) * 2 < len(block):
                continue
            key = Counter(
                (p[0] // QUANT, p[1] // QUANT, p[2] // QUANT) for p in visible
            ).most_common(1)[0][0]
            winners = [
                p for p in visible if (p[0] // QUANT, p[1] // QUANT, p[2] // QUANT) == key
            ]
            n = len(winners)
            dst[x, y] = (
                sum(p[0] for p in winners) // n,
                sum(p[1] for p in winners) // n,
                sum(p[2] for p in winners) // n,
                255,
            )
    return out


def hexof(px: tuple[int, int, int, int]) -> str:
    return f"#{px[0]:02x}{px[1]:02x}{px[2]:02x}"


def main() -> None:
    # Half-blocks make a cell twice as tall as it is wide in pixels, which is
    # roughly the shape of a terminal cell — so a square image wants as many
    # columns as it has pixel rows.
    img = raster(EMOJI, ROWS * 2)
    px = img.load()
    width, height = img.size
    rows_out = (height + 1) // 2

    rows: list[list[tuple[str, str | None, str | None]]] = []
    for r in range(rows_out):
        cells: list[tuple[str, str | None, str | None]] = []
        for c in range(width):
            top = px[c, 2 * r]
            # An odd pixel height leaves the last row with no bottom half.
            bot = px[c, 2 * r + 1] if 2 * r + 1 < height else (0, 0, 0, 0)
            t_on = top[3] >= ALPHA
            b_on = bot[3] >= ALPHA
            if t_on and b_on:
                cells.append(("▀", hexof(top), hexof(bot)))
            elif t_on:
                cells.append(("▀", hexof(top), None))
            elif b_on:
                cells.append(("▄", hexof(bot), None))
            else:
                cells.append((" ", None, None))
        rows.append(cells)

    # Coalesce neighbours that share both colours — 12 cells a row is small,
    # but the literal is read by people.
    print("const MARK: Pixel[][] = [")
    for cells in rows:
        spans: list[list] = []
        for ch, fg, bg in cells:
            if spans and spans[-1][1] == fg and spans[-1][2] == bg:
                spans[-1][0] += ch
                continue
            spans.append([ch, fg, bg])
        out = []
        for text, fg, bg in spans:
            attrs = "".join([f', f: "{fg}"' if fg else "", f', b: "{bg}"' if bg else ""])
            out.append(f'{{ t: "{text}"{attrs} }}')
        print(f"  [{', '.join(out)}],")
    print("];")

    out = Path(__file__).resolve().parent / "emojimark-preview.png"
    # One cell drawn as it renders: 1 pixel wide, 2 tall, blown up 16x.
    preview = Image.new("RGB", (width, height), (18, 18, 18))
    ppx = preview.load()
    for y in range(height):
        for x in range(width):
            if px[x, y][3] >= ALPHA:
                ppx[x, y] = px[x, y][:3]
    zoom = max(1, 320 // max(width, height))
    preview.resize((width * zoom, height * zoom), Image.NEAREST).save(out)
    print(f"\n# {rows_out} rows x {width} cols · preview: {out}", file=sys.stderr)


if __name__ == "__main__":
    main()
