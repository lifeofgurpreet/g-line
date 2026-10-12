#!/usr/bin/env python3
"""Render captured terminal output (ANSI SGR colours) as an SVG window.

  tmux capture-pane -p -e -t demo | python3 scripts/ansi2svg.py --title "glanceline" > shot.svg

Used for the README screenshots, which are real captures of real sessions.
Standard library only.
"""
import argparse
import html
import re
import sys

BASE = ["#1d1f21", "#e06c75", "#98c379", "#e5c07b", "#61afef", "#c678dd", "#56b6c2", "#d0d0d0",
        "#5c6370", "#ff7b86", "#b5e890", "#ffd88a", "#7fc4ff", "#de9bff", "#7ee3ef", "#ffffff"]
FG, BG = "#d7dae0", "#16181d"
CW, LH, FS, PAD, BAR = 8.43, 19, 14, 18, 34


def xterm(n):
    if n < 16:
        return BASE[n]
    if n < 232:
        n -= 16
        steps = [0, 95, 135, 175, 215, 255]
        return "#%02x%02x%02x" % (steps[n // 36], steps[(n // 6) % 6], steps[n % 6])
    v = 8 + (n - 232) * 10
    return "#%02x%02x%02x" % (v, v, v)


def parse(lines):
    """Rows of (text, style) runs."""
    rows = []
    style = {}
    for line in lines:
        runs, pos = [], 0
        for match in re.finditer(r"\x1b\[([0-9;]*)m|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)", line):
            if match.start() > pos:
                runs.append((line[pos:match.start()], dict(style)))
            pos = match.end()
            if match.group(0).startswith("\x1b]"):
                continue
            codes = [int(c) if c else 0 for c in match.group(1).split(";")]
            i = 0
            while i < len(codes):
                c = codes[i]
                if c == 0:
                    style = {}
                elif c == 1:
                    style["bold"] = True
                elif c == 2:
                    style["dim"] = True
                elif c == 3:
                    style["italic"] = True
                elif c == 7:
                    style["inverse"] = True
                elif c == 22:
                    style.pop("bold", None)
                    style.pop("dim", None)
                elif c == 23:
                    style.pop("italic", None)
                elif c == 27:
                    style.pop("inverse", None)
                elif 30 <= c <= 37 or 90 <= c <= 97:
                    style["fg"] = BASE[c - 30 if c < 90 else c - 82]
                elif 40 <= c <= 47 or 100 <= c <= 107:
                    style["bg"] = BASE[c - 40 if c < 100 else c - 92]
                elif c in (38, 48) and i + 2 < len(codes) and codes[i + 1] == 5:
                    style["fg" if c == 38 else "bg"] = xterm(codes[i + 2])
                    i += 2
                elif c in (38, 48) and i + 4 < len(codes) and codes[i + 1] == 2:
                    style["fg" if c == 38 else "bg"] = "#%02x%02x%02x" % tuple(codes[i + 2:i + 5])
                    i += 4
                elif c == 39:
                    style.pop("fg", None)
                elif c == 49:
                    style.pop("bg", None)
                i += 1
        if pos < len(line):
            runs.append((line[pos:], dict(style)))
        rows.append(runs)
    return rows


def svg(rows, title, columns):
    width = columns * CW + 2 * PAD
    height = BAR + len(rows) * LH + PAD
    out = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{width:.0f}" height="{height:.0f}" '
           f'viewBox="0 0 {width:.0f} {height:.0f}" role="img" aria-label="{html.escape(title)}">',
           '<style>text{font-family:"JetBrains Mono","SF Mono",Menlo,Consolas,monospace;'
           f'font-size:{FS}px;white-space:pre}}</style>',
           f'<rect width="100%" height="100%" rx="10" fill="{BG}"/>',
           '<circle cx="20" cy="17" r="6" fill="#ff5f57"/><circle cx="40" cy="17" r="6" fill="#febc2e"/>'
           '<circle cx="60" cy="17" r="6" fill="#28c840"/>',
           f'<text x="{width / 2:.0f}" y="22" fill="#8a8f98" text-anchor="middle">{html.escape(title)}</text>']
    for index, runs in enumerate(rows):
        y = BAR + index * LH + LH - 5
        column = 0
        for text, style in runs:
            if not text:
                continue
            fg, bg = style.get("fg", FG), style.get("bg")
            if style.get("inverse"):
                fg, bg = bg or BG, fg
            x = PAD + column * CW
            if bg:
                out.append(f'<rect x="{x:.1f}" y="{y - LH + 5:.1f}" width="{len(text) * CW:.1f}" height="{LH}" fill="{bg}"/>')
            if text.strip():
                attrs = [f'x="{x:.1f}"', f'y="{y}"', f'fill="{fg}"']
                if style.get("bold"):
                    attrs.append('font-weight="700"')
                if style.get("italic"):
                    attrs.append('font-style="italic"')
                if style.get("dim"):
                    attrs.append('opacity="0.6"')
                out.append(f'<text {" ".join(attrs)} textLength="{len(text) * CW:.1f}" '
                           f'lengthAdjust="spacingAndGlyphs">{html.escape(text)}</text>')
            column += len(text)
    out.append("</svg>")
    return "\n".join(out) + "\n"


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--title", default="")
    parser.add_argument("--columns", type=int)
    parser.add_argument("--out", help="write here instead of stdout")
    args = parser.parse_args()
    lines = sys.stdin.read().rstrip("\n").split("\n")
    rows = parse(lines)
    columns = args.columns or max(sum(len(t) for t, _ in runs) for runs in rows)
    text = svg(rows, args.title, columns)
    if args.out:
        with open(args.out, "w", encoding="utf-8") as stream:
            stream.write(text)
    else:
        sys.stdout.write(text)


if __name__ == "__main__":
    main()
