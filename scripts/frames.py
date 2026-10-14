#!/usr/bin/env python3
"""Record a tmux pane as timed frames, then turn them into an MP4 and a GIF.

  python3 scripts/frames.py record --target demo --out /tmp/rec --seconds 30
  python3 scripts/frames.py render --frames /tmp/rec --out demo --title glanceline [--crop-top N]
      [--edit "42996:3.5,22441-42609@2.5,62382:3"]

`record` saves `tmux capture-pane -p -e` every `--interval` seconds, keeping a
frame only when the pane changed, with its timestamp in the file name. `render`
draws each frame with ansi2png.py (the same renderer as the screenshots) and
asks ffmpeg for `<out>.mp4` and a palette-optimised `<out>.gif`, each frame held
until the next one. `--edit` cuts the recording instead: `T:SECONDS` holds the
frame recorded at T milliseconds, `A-B@SPEED` plays the frames from A to B that
many times faster, in the order given. Real captures only: nothing is drawn that
the terminal did not show. Needs tmux, Pillow and ffmpeg.
"""
import argparse
import os
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))


def record(args):
    os.makedirs(args.out, exist_ok=True)
    start = time.time()
    last = None
    count = 0
    while time.time() - start < args.seconds:
        shot = subprocess.run(["tmux", "capture-pane", "-p", "-e", "-t", args.target],
                              capture_output=True, text=True).stdout
        if shot != last:
            at = int((time.time() - start) * 1000)
            with open(os.path.join(args.out, f"{at:08d}.ansi"), "w") as f:
                f.write(shot)
            last = shot
            count += 1
        time.sleep(args.interval)
    print(f"{count} frames in {args.out}")


def render(args):
    names = sorted(n for n in os.listdir(args.frames) if n.endswith(".ansi"))
    if not names:
        sys.exit("no frames")
    pngs = os.path.join(args.frames, "png")
    os.makedirs(pngs, exist_ok=True)
    times = [int(n.split(".")[0]) for n in names]
    plan = []  # (frame name, seconds held)
    if args.edit:
        for step in args.edit.split(","):
            if ":" in step:
                at, hold = step.split(":")
                index = max(i for i, t in enumerate(times) if t <= int(at))
                plan.append((names[index], float(hold)))
            else:
                span, speed = step.split("@")
                start, end = (int(x) for x in span.split("-"))
                picked = [i for i, t in enumerate(times) if start <= t <= end]
                for i in picked:
                    gap = (times[i + 1] if i + 1 < len(times) else times[i] + 1000) - times[i]
                    plan.append((names[i], min(gap / 1000, args.max_hold) / float(speed)))
    else:
        for index, name in enumerate(names):
            hold = ((times[index + 1] if index + 1 < len(times) else times[index] + args.tail * 1000) - times[index]) / 1000
            plan.append((name, min(hold, args.max_hold) / args.speed))
    drawn = set()
    concat = []
    for name, hold in plan:
        png = os.path.join(pngs, name.replace(".ansi", ".png"))
        if name not in drawn:
            draw(args, name, png)
            drawn.add(name)
        concat += [f"file '{png}'", f"duration {max(hold, 0.04):.3f}"]
    concat.append(concat[-2])
    finish(args, concat, len(plan))


def draw(args, name, png):
    """One recorded frame as a PNG, through the screenshots' own renderer."""
    with open(os.path.join(args.frames, name)) as f:
        lines = f.read().rstrip("\n").split("\n")
    if args.crop_top:
        lines = lines[args.crop_top:]
    if args.rows:
        lines = lines[-args.rows:]
    cmd = [sys.executable, os.path.join(HERE, "ansi2png.py"), "--out", png, "--title", args.title]
    if args.columns:
        cmd += ["--columns", str(args.columns)]
    subprocess.run(cmd, input="\n".join(lines), text=True, check=True)


def finish(args, concat, count):
    listing = os.path.join(args.frames, "frames.txt")
    with open(listing, "w") as f:
        f.write("\n".join(concat) + "\n")
    scale = f"scale={args.width}:-2:flags=lanczos" if args.width else "scale=trunc(iw/2)*2:trunc(ih/2)*2"
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", listing,
                    "-vf", f"{scale},format=yuv420p", "-r", "30", "-c:v", "libx264", "-crf", "18",
                    "-movflags", "+faststart", f"{args.out}.mp4"], check=True)
    gif(concat, f"{args.out}.gif", args.gif_width)
    print(f"{args.out}.mp4 {args.out}.gif from {count} frames")


def gif(concat, out, width):
    """A GIF with one frame per held picture and its own duration: a still
    terminal costs one frame, not a frame per tick, so the file stays small."""
    from PIL import Image
    held = []
    for line, after in zip(concat, concat[1:]):
        if line.startswith("file ") and after.startswith("duration "):
            path, seconds = line[6:-1], float(after.split()[1])
            if held and held[-1][0] == path:
                held[-1][1] += seconds
            else:
                held.append([path, seconds])
    pictures = {}
    for path, _ in held:
        if path not in pictures:
            image = Image.open(path).convert("RGB")
            image = image.resize((width, round(image.height * width / image.width)), Image.LANCZOS)
            pictures[path] = image.quantize(colors=128, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
    frames = [pictures[path] for path, _ in held]
    frames[0].save(out, save_all=True, append_images=frames[1:], duration=[round(s * 1000) for _, s in held],
                   loop=0, optimize=True, disposal=1)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("record")
    r.add_argument("--target", required=True)
    r.add_argument("--out", required=True)
    r.add_argument("--seconds", type=float, default=30)
    r.add_argument("--interval", type=float, default=0.25)
    d = sub.add_parser("render")
    d.add_argument("--frames", required=True)
    d.add_argument("--out", required=True)
    d.add_argument("--title", default="")
    d.add_argument("--columns", type=int)
    d.add_argument("--crop-top", type=int, default=0)
    d.add_argument("--rows", type=int, default=0, help="keep only the last N rows")
    d.add_argument("--speed", type=float, default=1.0, help="play this many times faster")
    d.add_argument("--max-hold", type=float, default=4.0, help="longest any one frame is held, in seconds")
    d.add_argument("--tail", type=float, default=3.0, help="seconds the last frame is held")
    d.add_argument("--width", type=int, default=0)
    d.add_argument("--gif-width", type=int, default=900)
    d.add_argument("--edit", default="", help="cut list: T:SECONDS holds a frame, A-B@SPEED plays a span")
    args = parser.parse_args()
    record(args) if args.cmd == "record" else render(args)


if __name__ == "__main__":
    main()
