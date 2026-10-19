#!/usr/bin/env python3
"""Render captured terminal output (ANSI SGR colours) as a PNG window.

  tmux capture-pane -p -e -t demo | python3 scripts/ansi2png.py --title glanceline --out shot.png

The PNG twin of ansi2svg.py (same parser and palette), for places that want
a bitmap, such as a post on X. Needs Pillow and a monospace font (Menlo on
macOS, DejaVu Sans Mono on Linux).
"""
import argparse
import os
import sys

from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ansi2svg import BG, FG, parse  # noqa: E402

SCALE = 2
FS, LH, PAD, BAR = 14 * SCALE, 20 * SCALE, 20 * SCALE, 36 * SCALE
MONO = ["/System/Library/Fonts/Menlo.ttc", "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"]
MONO_BOLD = [("/System/Library/Fonts/Menlo.ttc", 1), ("/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf", 0)]
SYMBOLS = ["/System/Library/Fonts/Apple Symbols.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"]
UNICODE = ["/System/Library/Fonts/Supplemental/Arial Unicode.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"]
MATH = ["/System/Library/Fonts/Supplemental/STIXGeneral.otf", "/usr/share/fonts/opentype/stix/STIXGeneral-Regular.otf"]  # 𝕏 and other math letters
EMOJI = [("/System/Library/Fonts/Apple Color Emoji.ttc", 160), ("/usr/share/fonts/truetype/noto/NotoColorEmoji.ttf", 109)]  # bitmap fonts: one fixed size each


def font(paths, index=0):
    for path in paths:
        if isinstance(path, tuple):
            path, index = path
        if os.path.exists(path):
            return ImageFont.truetype(path, FS, index=index)
    return ImageFont.load_default()


def emoji_face():
    for path, size in EMOJI:
        if os.path.exists(path):
            return ImageFont.truetype(path, size)
    return None


def emoji(face, ch):
    """`ch` drawn in colour, scaled to two columns' height, or None without an emoji font."""
    if face is None:
        return None
    left, top, right, bottom = face.getbbox(ch)
    glyph = Image.new("RGBA", (right, bottom), (0, 0, 0, 0))
    ImageDraw.Draw(glyph).text((0, 0), ch, font=face, embedded_color=True)
    side = int(FS * 1.15)
    return glyph.crop((left, top, right, bottom)).resize((side, side), Image.LANCZOS)


GLYPHS = {}
STANDINS = {"\u23fa": "\u25cf", "\u23f5": "\u25b8", "\u23f8": "\u2016"}  # record, play and pause symbols: no common font has them; stand-ins read the same


def ink(face, ch):
    image = Image.new("L", (FS * 2, FS * 2))
    ImageDraw.Draw(image).text((0, 0), ch, font=face, fill=255)
    return image.tobytes()


def face_for(ch, faces):
    """The first face that has a glyph for `ch` (its mask differs from a missing glyph's)."""
    key = (id(faces[0]), ch)
    if key not in GLYPHS:
        GLYPHS[key] = faces[0]
        if ord(ch) > 0x7F:
            for face in faces:
                if ink(face, ch) != ink(face, "\U0010fffd"):
                    GLYPHS[key] = face
                    break
    return GLYPHS[key]


def hex_rgb(value, alpha=255):
    value = value.lstrip("#")
    return tuple(int(value[i:i + 2], 16) for i in (0, 2, 4)) + (alpha,)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--title", default="")
    parser.add_argument("--columns", type=int)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()
    rows = parse(sys.stdin.read().rstrip("\n").split("\n"))
    regular, bold, symbols, wide, math = font(MONO), font(MONO_BOLD), font(SYMBOLS), font(UNICODE), font(MATH)
    colour_emoji = emoji_face()
    cw = regular.getlength("M")
    columns = args.columns or max(sum(len(t) for t, _ in runs) for runs in rows)
    width = int(columns * cw + 2 * PAD)
    height = int(BAR + len(rows) * LH + PAD)
    image = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle([0, 0, width - 1, height - 1], radius=10 * SCALE, fill=hex_rgb(BG))
    for i, colour in enumerate(("#ff5f57", "#febc2e", "#28c840")):
        cx, cy, r = (20 + 20 * i) * SCALE, 18 * SCALE, 6 * SCALE
        draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=hex_rgb(colour))
    if args.title:
        draw.text((width / 2, 18 * SCALE), args.title, font=regular, fill=hex_rgb("#8a8f98"), anchor="mm")
    for index, runs in enumerate(rows):
        top = BAR + index * LH
        column = 0
        for text, style in runs:
            fg, bg = style.get("fg", FG), style.get("bg")
            if style.get("inverse"):
                fg, bg = bg or BG, fg
            if bg:
                x = PAD + column * cw
                draw.rectangle([x, top, x + len(text) * cw, top + LH], fill=hex_rgb(bg))
            colour = hex_rgb(fg, 150 if style.get("dim") else 255)
            face = bold if style.get("bold") else regular
            for ch in text:
                ch = STANDINS.get(ch, ch)
                # An emoji takes two columns, as in the terminal.
                picture = emoji(colour_emoji, ch) if ord(ch) >= 0x1F300 else None
                if picture:
                    x = PAD + column * cw
                    image.alpha_composite(picture, (int(x + (2 * cw - picture.width) / 2), int(top + (LH - picture.height) / 2)))
                    column += 2
                    continue
                if ch != " ":
                    x = PAD + column * cw
                    draw.text((x, top + LH / 2), ch, font=face_for(ch, (face, symbols, wide, math)) if ord(ch) > 0x7F else face, fill=colour, anchor="lm")
                column += 1
    image.save(args.out)


if __name__ == "__main__":
    main()
