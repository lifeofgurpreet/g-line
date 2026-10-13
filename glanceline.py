#!/usr/bin/env python3
"""glanceline (statusLine fallback): your Claude Code session at a glance.

The glanceline mod is the main way to run glanceline (Claude Code 2.1.293 or
later). This single file is the fallback for any Claude Code version: a
`statusLine` command that reads the JSON Claude Code sends on stdin and
prints the same segments the mod draws, fitted to the terminal width.

  glanceline                        render (Claude Code runs this)
  glanceline demo                   sample lines at several widths
  glanceline install [--dry-run]    point statusLine at this script
  glanceline uninstall              put the previous statusLine back exactly

Everything shown is Claude Code's own figures, plus your git branch. It makes
no network calls, never prints payload text other than the model name and
branch, and always exits 0 with output: a failing status line goes blank.
Python 3.8+, standard library only.
"""
import json
import os
import sys
import time

sys.dont_write_bytecode = True

VERSION = "0.2.0"
LIMIT = 262144          # stdin bytes accepted; Claude Code sends a few KB
RESERVE = 4             # columns Claude Code keeps for its own padding
REFRESH = 15            # seconds; keeps countdowns moving while idle
SEP = " · "
GIT_TTL = 5             # seconds a git reading is reused within a session

PRESETS = {
    "minimal": "model,context,five_hour,cache",
    "default": "model,context,five_hour,seven_day,spend,cache,git",
    "full": "model,context,five_hour,seven_day,spend,cache|git,pr,cost,time,lines,vim",
}
NERD = {
    "model": "\U000f06a9 ", "context": "\U000f035b ", "five_hour": "\U000f0150 ", "seven_day": "\U000f00f0 ",
    "spend": "\U000f01c1 ", "cache": "\U000f0e57 ", "git": " ", "pr": " ", "cost": "\U000f01c1 ",
    "time": "\U000f051f ", "lines": "\U000f0c7e ",
}
THEMES = {
    "color": {"ok": "32", "warn": "33", "bad": "1;31", "dim": "2", "accent": "36"},
    "mono": {"warn": "1", "bad": "1;7", "dim": "2"},
}
WINDOW_SECONDS = {"five_hour": 5 * 3600, "seven_day": 7 * 86400}
MIN_ELAPSED = {"five_hour": 15 * 60, "seven_day": 12 * 3600}
DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]


# ---------------------------------------------------------------- formatting

def num(value):
    """A finite int/float (bools are not numbers here), else None."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return value if value == value and abs(value) != float("inf") else None


def text(value, limit=48):
    """A short printable string from the payload, else None."""
    if not isinstance(value, str):
        return None
    value = value.strip()
    if not value or any(ord(c) < 32 or 127 <= ord(c) <= 159 for c in value):
        return None
    return value[:limit]


def rnd(value):
    """Round half up, as JavaScript's Math.round does."""
    import math
    return int(math.floor(value + 0.5))


def duration(seconds, compact=False):
    """4d 10h, 2h 5m, 7m, <1m. Floored: a countdown never overstates."""
    seconds = int(seconds // 1)
    if seconds < 60:
        return "<1m"
    days, rest = divmod(seconds, 86400)
    hours, rest = divmod(rest, 3600)
    minutes = rest // 60
    gap = "" if compact else " "
    if days:
        return f"{days}d{gap}{hours}h" if hours else f"{days}d"
    if hours:
        return f"{hours}h{gap}{minutes}m" if minutes else f"{hours}h"
    return f"{minutes}m"


def tokens(count):
    count = int(count // 1)
    if count >= 1_000_000:
        value = f"{count / 1_000_000:.1f}"
        return (value[:-2] if value.endswith(".0") else value) + "M"
    if count >= 1000:
        return f"{rnd(count / 1000)}k"
    return str(count)


def pct(value):
    return f"{rnd(value)}%"


def clock(at, now, offset_minutes=0):
    """16:40 within a day of `now`, else Thu 16:40, in the caller's zone."""
    import datetime
    local = datetime.datetime(1970, 1, 1) + datetime.timedelta(seconds=int(at // 1) + offset_minutes * 60)
    stamp = f"{local.hour:02d}:{local.minute:02d}"
    return stamp if at - now < 20 * 3600 else f"{DAYS[local.weekday()]} {stamp}"


def bar(percent, cells=5):
    filled = max(0, min(cells, rnd(percent / 100 * cells)))
    return "▰" * filled + "▱" * (cells - filled)


def pressure(percent):
    if percent >= 95:
        return "bad"
    if percent >= 80:
        return "warn"
    return None


def pace(kind, window, now):
    """("full",) / ("hot", eta) / ("ok",), or None until the rate means something."""
    window = window if isinstance(window, dict) else {}
    used, resets = num(window.get("used_percentage")), num(window.get("resets_at"))
    length = WINDOW_SECONDS.get(kind)
    if used is None or resets is None or length is None or resets <= now:
        return None
    if used >= 100:
        return ("full",)
    elapsed = now - (resets - length)
    if elapsed < MIN_ELAPSED.get(kind, 0) or used < 1:
        return None
    eta = now + (100 - used) * elapsed / used
    return ("hot", eta) if eta < resets - 60 else ("ok",)


def get(data, *path):
    for key in path:
        if not isinstance(data, dict):
            return None
        data = data.get(key)
    return data


class Segment:
    __slots__ = ("key", "priority", "forms", "tone")

    def __init__(self, key, priority, forms, tone=None):
        self.key, self.priority, self.forms, self.tone = key, priority, list(forms), tone


# ------------------------------------------------------------------ segments

def model_segment(p, o):
    name = text(get(p, "model", "display_name")) or text(get(p, "model", "id"))
    if not name:
        return None
    level = text(get(p, "effort", "level"), 12)
    detail = ", ".join(part for part in (f"{level} effort" if level else "", "fast" if p.get("fast_mode") is True else "") if part)
    forms = [f"{name} ({detail})", f"{name} {level}" if level else name, name] if detail else [name]
    return Segment("model", 100, forms, "accent")


def context_segment(p, o):
    used = num(get(p, "context_window", "used_percentage"))
    if used is None or used < 0:
        return None
    size = num(get(p, "context_window", "context_window_size"))
    inside = num(get(p, "context_window", "total_input_tokens"))
    left = size - inside if size is not None and inside is not None and size > inside else None
    forms = [f"context {pct(used)}", f"ctx {pct(used)}"]
    if left is not None:
        forms.insert(0, f"context {pct(used)} ({tokens(left)} left)")
    if o["full"]:
        forms.insert(0, f"context {bar(used)} {pct(used)}" + (f" ({tokens(left)} left)" if left is not None else ""))
    return Segment("context", 90, forms, pressure(used))


def window_segment(p, o, kind):
    window = get(p, "rate_limits", kind)
    used = num(get(window, "used_percentage"))
    if used is None or used < 0:
        return None
    name, short, priority = ("5h", "5h", 85) if kind == "five_hour" else ("week", "wk", 70)
    now = o["now"]
    resets = num(get(window, "resets_at"))
    left = resets - now if resets is not None and resets > now else None
    state = pace(kind, window, now)
    head = f"{name} {bar(used)} {pct(used)}" if o["full"] else f"{name} {pct(used)}"
    if state and state[0] == "full":
        after = f" (resets in {duration(left)})" if left is not None else ""
        return Segment(kind, priority, [f"{name} limit reached{after}",
                                        f"{short} full" + (f" ({duration(left, True)})" if left is not None else ""),
                                        f"{short} full"], "bad")
    if state and state[0] == "hot":
        at = clock(state[1], now, o["offset"])
        reset = f", resets {clock(resets, now, o['offset'])}" if resets is not None else ""
        tone = "bad" if state[1] - now < 30 * 60 else "warn"
        return Segment(kind, priority, [f"{head} (on pace to run out at {at}{reset})",
                                        f"{short} {pct(used)}, out at {at}",
                                        f"{short} {pct(used)}→{at}", f"{short} {pct(used)}"], tone)
    ok = "on track" if state and state[0] == "ok" else ""
    if left is None:
        return Segment(kind, priority, [f"{head} ({ok})" if ok else head, f"{short} {pct(used)}"], pressure(used))
    return Segment(kind, priority, [f"{head} (resets in {duration(left)}" + (f", {ok})" if ok else ")"),
                                    f"{short} {pct(used)} ({duration(left, True)})", f"{short} {pct(used)}"],
                   pressure(used))


def spend_segment(p, o):
    spend = get(p, "rate_limits", "spend_limit")
    used = num(get(spend, "used_percentage"))
    if used is None or used < 0:
        return None
    forms = [f"spend {pct(used)}"]
    usd, cap = num(get(spend, "used_usd")), num(get(spend, "limit_usd"))
    if usd is not None and cap:
        period = get(spend, "period")
        period = f" {period}" if period in ("daily", "weekly", "monthly") else ""
        forms.insert(0, f"spend ${rnd(usd)} of ${rnd(cap)}{period}")
    return Segment("spend", 75, forms, pressure(used))


def cache_segment(p, o):
    cache = p.get("prompt_cache")
    if not isinstance(cache, dict) or cache.get("caching_observed") is not True:
        return None
    now = o["now"]
    expires = num(cache.get("expires_at"))
    if cache.get("warm") is True and expires is not None and expires > now:
        left = expires - now
        soon = left <= (300 if cache.get("ttl") == "1h" else 60)
        return Segment("cache", 80, [f"cache warm ({duration(left)} left)", f"cache {duration(left, True)}"],
                       "warn" if soon else "ok")
    recache = num(cache.get("recache_tokens_if_cold"))
    forms = [f"cache cold (next turn rebuilds {tokens(recache)})", "cache cold"] if recache and recache > 0 else ["cache cold"]
    return Segment("cache", 80, forms, "warn")


def cost_segment(p, o):
    usd = num(get(p, "cost", "total_cost_usd"))
    if usd is None or usd <= 0:
        return None
    return Segment("cost", 50, [f"${usd:.2f} at API prices", f"${usd:.2f}"], "dim")


def time_segment(p, o):
    ms = num(get(p, "cost", "total_duration_ms"))
    if ms is None or ms < 60000:
        return None
    return Segment("time", 45, [f"{duration(ms / 1000)} session", duration(ms / 1000, True)], "dim")


def lines_segment(p, o):
    added = num(get(p, "cost", "total_lines_added")) or 0
    removed = num(get(p, "cost", "total_lines_removed")) or 0
    if added <= 0 and removed <= 0:
        return None
    return Segment("lines", 40, [f"+{added} −{removed} lines", f"+{added} −{removed}"], "dim")


def git_segment(p, o):
    git = p.get("git")
    branch = text(get(git, "branch"), 40)
    if not branch:
        return None
    mark = "*" if get(git, "dirty") else ""
    return Segment("git", 60, [f"{branch}{mark}", f"{branch[:16]}{mark}"])


def pr_segment(p, o):
    number = num(get(p, "pr", "number"))
    if number is None:
        return None
    label = f"MR !{number}" if get(p, "pr", "kind") == "mr" else f"PR #{number}"
    state = text(get(p, "pr", "review_state"), 20)
    state = state.replace("_", " ") if state else None
    return Segment("pr", 55, [f"{label} {state}", label] if state else [label])


def vim_segment(p, o):
    mode = text(get(p, "vim", "mode"), 12)
    return Segment("vim", 30, [mode], "dim") if mode else None


BUILDERS = {
    "model": model_segment, "context": context_segment,
    "five_hour": lambda p, o: window_segment(p, o, "five_hour"),
    "seven_day": lambda p, o: window_segment(p, o, "seven_day"),
    "spend": spend_segment, "cache": cache_segment, "cost": cost_segment, "time": time_segment,
    "lines": lines_segment, "git": git_segment, "pr": pr_segment, "vim": vim_segment,
}


def layout_keys(options):
    import re
    spec = options.get("segments")
    if not (isinstance(spec, str) and spec and re.fullmatch(r"[a-z_,| ]+", spec)):
        spec = PRESETS.get(options.get("preset") or "default", PRESETS["default"])
    lines = [[key.strip() for key in line.split(",") if key.strip()] for line in spec.split("|")]
    return [line for line in lines if line]


def segments(p, options):
    o = {"now": options["now"], "offset": options.get("utcOffsetMinutes") or 0,
         "full": (options.get("preset") or "default") == "full" and not options.get("segments")}
    icons = options.get("icons") == "nerd"
    lines = []
    for keys in layout_keys(options):
        line = []
        for key in keys:
            build = BUILDERS.get(key)
            segment = build(p, o) if build else None
            if segment:
                if icons and key in NERD:
                    segment.forms = [NERD[key] + form for form in segment.forms]
                line.append(segment)
        if line:
            lines.append(line)
    return lines


# ------------------------------------------------------------------- layout

def width(value):
    return len(value)


def truncate(value, room):
    if room <= 0:
        return ""
    return value if width(value) <= room else value[:max(room - 1, 0)] + "…"


def fit_segments(items, room):
    """One form per segment so the line fits `room` columns (see hooks/core.ts)."""
    if room is None:
        return [(item, item.forms[0]) for item in items]
    live = list(items)
    deepest = max([1] + [len(item.forms) for item in live])
    tier = 0

    def forms():
        return [item.forms[min(tier, len(item.forms) - 1)] for item in live]

    while width(SEP.join(forms())) > room:
        if tier < deepest - 1:
            tier += 1
        elif len(live) > 1:
            lowest = 0
            for index, item in enumerate(live):
                if item.priority < live[lowest].priority:
                    lowest = index
            live.pop(lowest)
        else:
            break
    return [(item, truncate(form, room)) for item, form in zip(live, forms())]


def render(p, options):
    """Every line as [(segment, text)], fitted to options['columns']."""
    return [fit_segments(line, options.get("columns")) for line in segments(p, options)]


def plain(lines):
    return [SEP.join(form for _, form in line) for line in lines]


def alerts(p, options):
    """What deserves a heads-up now (the mod toasts these)."""
    now, offset = options["now"], options.get("utcOffsetMinutes") or 0
    found = []
    cache = p.get("prompt_cache") if isinstance(p.get("prompt_cache"), dict) else {}
    expires = num(cache.get("expires_at"))
    if cache.get("caching_observed") is True and cache.get("warm") is True and expires is not None:
        left = expires - now
        if 0 < left <= (300 if cache.get("ttl") == "1h" else 60):
            recache = num(cache.get("recache_tokens_if_cold"))
            what = f"{tokens(recache)} tokens" if recache and recache > 0 else "the conversation"
            found.append({"id": f"cache:{int(expires // 1)}", "tone": "warn",
                          "text": f"Prompt cache goes cold in {duration(left)}. Reply before then and {what} stay "
                                  "cached; after, the next turn rebuilds them."})
    for kind, name in (("five_hour", "5-hour"), ("seven_day", "weekly")):
        window = get(p, "rate_limits", kind)
        state = pace(kind, window, now)
        resets = num(get(window, "resets_at"))
        if state and state[0] == "hot" and resets is not None:
            found.append({"id": f"{kind}:{int(resets // 1)}", "tone": "warn",
                          "text": f"At this pace you'll hit your {name} limit around {clock(state[1], now, offset)}. "
                                  f"It resets {clock(resets, now, offset)}."})
    return found


# ------------------------------------------------------------- environment

def config_from_env():
    """Options from ~/.config/glanceline/config.json, then GLANCELINE_* env."""
    found = {}
    base = os.environ.get("XDG_CONFIG_HOME") or os.path.join(os.path.expanduser("~"), ".config")
    try:
        with open(os.path.join(base, "glanceline", "config.json"), "rb") as stream:
            raw = json.loads(stream.read(65536))
        if isinstance(raw, dict):
            found.update({key: raw[key] for key in ("preset", "segments", "icons", "theme") if isinstance(raw.get(key), str)})
    except (OSError, ValueError):
        pass
    for key in ("preset", "segments", "icons", "theme"):
        value = os.environ.get("GLANCELINE_" + key.upper())
        if value:
            found[key] = value
    if found.get("preset") not in PRESETS:
        found.pop("preset", None)
    return found


def columns_from_env():
    raw = os.environ.get("COLUMNS", "")
    return int(raw) if raw.isdigit() and 20 <= int(raw) <= 1000 else None


def theme_from_env(config=None):
    config = config if config is not None else config_from_env()
    if "NO_COLOR" in os.environ or os.environ.get("TERM") == "dumb":
        return None
    return THEMES.get(config.get("theme") or "color")


def paint(value, tone, theme):
    code = theme.get(tone) if theme and tone else None
    return f"\x1b[{code}m{value}\x1b[0m" if code and value else value


def utc_offset_minutes(now):
    return int(time.localtime(now).tm_gmtoff // 60)


def git_state(directory, session):
    """Branch and dirty flag via git, reused for a few seconds per session."""
    if not isinstance(directory, str) or not os.path.isabs(directory):
        return None
    import hashlib
    import tempfile
    key = hashlib.sha256(f"{session}\0{directory}".encode("utf-8", "replace")).hexdigest()[:20]
    folder = os.path.join(tempfile.gettempdir(), f"glanceline-{os.getuid()}")
    path = os.path.join(folder, f"git-{key}.json")
    try:
        info = os.lstat(path)
        if info.st_uid == os.getuid() and 0 <= time.time() - info.st_mtime < GIT_TTL:
            with open(path, "rb") as stream:
                cached = json.loads(stream.read(4096))
            if cached is None or isinstance(cached, dict):
                return cached
    except (OSError, ValueError):
        pass
    import subprocess
    try:
        run = subprocess.run(["git", "--no-optional-locks", "status", "--porcelain=v1", "--branch",
                              "--untracked-files=no"], cwd=directory, capture_output=True, timeout=1.0,
                             stdin=subprocess.DEVNULL, check=False)
    except (OSError, subprocess.SubprocessError):
        return None
    state = None
    if run.returncode == 0:
        lines = run.stdout.decode("utf-8", "replace").split("\n")
        head = lines[0][3:] if lines[0].startswith("## ") else lines[0]
        head = head.replace("No commits yet on ", "")
        name = head.split("...")[0].split(" ")[0]
        state = {"branch": "detached" if name == "HEAD" else name, "dirty": any(line.strip() for line in lines[1:])}
    try:
        os.makedirs(folder, mode=0o700, exist_ok=True)
        temporary = path + f".{os.getpid()}"
        with open(temporary, "w") as stream:
            json.dump(state, stream)
        os.replace(temporary, path)
    except OSError:
        pass
    return state


def decode(payload):
    try:
        data = json.loads(payload)
    except (ValueError, UnicodeDecodeError, RecursionError):
        return None
    return data if isinstance(data, dict) else None


LIVE_SECONDS = 60      # the mod rewrites its session file every 15 s


def mod_is_drawing(data):
    """True when the glanceline mod draws this session's line already.

    The mod keeps `~/.cache/glanceline/live/<session id>` fresh while it runs;
    a file under a minute old for the session in the payload means it does.
    """
    session = data.get("session_id")
    home = os.environ.get("HOME")
    if not home or not isinstance(session, str) or not session or len(session) > 128:
        return False
    if not all(c.isalnum() or c in "-_" for c in session):
        return False
    try:
        age = time.time() - os.stat(os.path.join(home, ".cache", "glanceline", "live", session)).st_mtime
    except OSError:
        return False
    return -5 < age < LIVE_SECONDS


def fit(value, columns, color=False, tone=None):
    """Fit one extra line: a string, or alternatives widest first."""
    forms = [value] if isinstance(value, str) else [form for form in value if form]
    if not forms:
        return ""
    room = None if columns is None else max(columns - RESERVE, 8)
    chosen = next((form for form in forms if room is None or width(form) <= room), forms[-1])
    theme = THEMES["color"] if color is True else (color or None)
    return paint(chosen if room is None else truncate(chosen, room), tone, theme)


def render_lines(payload, extra=(), columns=None, color=None, now=None):
    """Status lines for raw stdin bytes: the session's, then `extra` lines.

    `extra` holds plug-in lines (a string, or alternatives widest first) that
    another tool appends below, such as which account a session runs as.
    Nothing is drawn while the glanceline mod draws the same session.
    """
    data = decode(payload) if len(payload) <= LIMIT else None
    if data is not None and mod_is_drawing(data):
        return []
    config = config_from_env()
    columns = columns_from_env() if columns is None else columns
    theme = theme_from_env(config) if color is None else (THEMES["color"] if color else None)
    now = time.time() if now is None else now
    lines = []
    if data is not None:
        if "git" in ",".join(sum(layout_keys(config), [])):
            directory = get(data, "workspace", "current_dir") or data.get("cwd")
            data["git"] = git_state(directory, str(data.get("session_id") or ""))
        options = dict(config, now=now, utcOffsetMinutes=utc_offset_minutes(now),
                       columns=None if columns is None else max(columns - RESERVE, 8))
        separator = paint(SEP, "dim", theme)
        for line in render(data, options):
            lines.append(separator.join(paint(form, item.tone, theme) for item, form in line if form))
    for value in extra:
        line = fit(value, columns, theme)
        if line:
            lines.append(line)
    return lines


def run_command(command, payload, timeout=1.0):
    """Lines a plug-in command prints when fed the same payload."""
    import subprocess
    try:
        done = subprocess.run(command, shell=True, input=payload, capture_output=True, timeout=timeout, check=False)
    except (OSError, subprocess.SubprocessError):
        return []
    out = done.stdout[:LIMIT].decode("utf-8", "replace").rstrip("\n") if done.returncode == 0 else ""
    return out.split("\n") if out else []


# ------------------------------------------------------------------ install

STATE_NAME = "glanceline-statusline.json"


def settings_path(explicit):
    if explicit:
        return os.path.abspath(os.path.expanduser(explicit))
    base = os.environ.get("CLAUDE_CONFIG_DIR") or os.path.join(os.path.expanduser("~"), ".claude")
    return os.path.join(base, "settings.json")


def write_atomic(path, content, mode):
    import tempfile
    fd, temporary = tempfile.mkstemp(prefix=".glanceline-", dir=os.path.dirname(path))
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        os.chmod(temporary, mode)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def load_settings(path):
    real = os.path.realpath(path)
    try:
        with open(real, "rb") as stream:
            raw = stream.read()
        mode = os.stat(real).st_mode & 0o777
    except FileNotFoundError:
        raw, mode = None, 0o600
    data = json.loads(raw) if raw and raw.strip() else {}
    if not isinstance(data, dict):
        raise ValueError(f"{path} is not a JSON object")
    return real, raw, mode, data


def install(args):
    """Set `statusLine` (only that key) to this script; remember what it was."""
    import shlex
    script = os.path.realpath(args.command or sys.argv[0])
    path = settings_path(args.settings)
    real, raw, mode, data = load_settings(path)
    state_path = os.path.join(os.path.dirname(real), STATE_NAME)
    previous = data.get("statusLine")
    original_backup = None
    try:
        with open(state_path, "rb") as stream:
            state = json.loads(stream.read())
        if previous == state.get("installed"):
            previous = state.get("previous")       # re-install keeps the original
            original_backup = state.get("backup")
    except (OSError, ValueError, AttributeError):
        pass
    words = [script] + [word for extra in args.extra_command or [] for word in ("--extra-command", extra)]
    updated = {"type": "command", "command": shlex.join(words)}
    if isinstance(previous, dict) and isinstance(previous.get("padding"), int):
        updated["padding"] = previous["padding"]
    updated["refreshInterval"] = args.refresh if args.refresh else (previous or {}).get("refreshInterval")
    if updated["refreshInterval"] is None:
        updated.pop("refreshInterval")
    plan = {"action": "install", "settings": path, "statusLine_before": data.get("statusLine"),
            "statusLine_after": updated, "other_settings_changed": False, "dry_run": args.dry_run}
    if not args.dry_run:
        backup = None
        if raw is not None:
            stem = real + ".bak-glanceline-" + time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())
            backup, serial = stem, 1
            while os.path.exists(backup):
                serial += 1
                backup = f"{stem}-{serial}"
            write_atomic(backup, raw, 0o600)
        else:
            os.makedirs(os.path.dirname(real), exist_ok=True)
        data["statusLine"] = updated
        write_atomic(state_path, (json.dumps({"previous": previous, "installed": updated,
                                              "backup": original_backup or backup},
                                             indent=2) + "\n").encode(), 0o600)
        write_atomic(real, (json.dumps(data, indent=2, ensure_ascii=False) + "\n").encode(), mode)
        plan["backup"] = backup
    print(json.dumps(plan, indent=2))


def uninstall(args):
    """Restore the statusLine glanceline replaced, byte-exact when possible."""
    path = settings_path(args.settings)
    real, raw, mode, data = load_settings(path)
    state_path = os.path.join(os.path.dirname(real), STATE_NAME)
    try:
        with open(state_path, "rb") as stream:
            state = json.loads(stream.read())
    except (OSError, ValueError):
        raise ValueError("no glanceline install recorded beside these settings; nothing changed")
    if data.get("statusLine") != state.get("installed"):
        raise ValueError("statusLine was changed since glanceline installed it; left as it is")
    previous = state.get("previous")
    if previous is None:
        data.pop("statusLine", None)
    else:
        data["statusLine"] = previous
    content = (json.dumps(data, indent=2, ensure_ascii=False) + "\n").encode()
    backup = state.get("backup")
    if backup:
        try:
            with open(backup, "rb") as stream:
                original = stream.read()
            if json.loads(original) == data:
                content = original                  # nothing else changed: the exact old file
        except (OSError, ValueError):
            pass
    plan = {"action": "uninstall", "settings": path, "statusLine_after": previous, "dry_run": args.dry_run}
    if not args.dry_run:
        write_atomic(real, content, mode)
        os.unlink(state_path)
    print(json.dumps(plan, indent=2))


# --------------------------------------------------------------------- demo

def demo():
    now = time.time()
    h = 3600
    typical = {
        "model": {"display_name": "Opus 5.5"}, "effort": {"level": "high"},
        "context_window": {"used_percentage": 41, "context_window_size": 200000, "total_input_tokens": 82000},
        "rate_limits": {"five_hour": {"used_percentage": 23, "resets_at": now + 2 * h + 14 * 60},
                        "seven_day": {"used_percentage": 41, "resets_at": now + 77 * h}},
        "prompt_cache": {"warm": True, "caching_observed": True, "ttl": "1h", "expires_at": now + 59 * 60 + 20,
                         "recache_tokens_if_cold": 84213},
        "cost": {"total_cost_usd": 3.21, "total_duration_ms": 72 * 60000, "total_lines_added": 120,
                 "total_lines_removed": 14},
        "git": {"branch": "main", "dirty": True},
    }
    hot = dict(typical, context_window={"used_percentage": 88, "context_window_size": 200000,
                                        "total_input_tokens": 176000},
               rate_limits={"five_hour": {"used_percentage": 72, "resets_at": now + 2 * h},
                            "seven_day": {"used_percentage": 64, "resets_at": now + 72 * h}},
               prompt_cache={"warm": True, "caching_observed": True, "ttl": "5m", "expires_at": now + 45,
                             "recache_tokens_if_cold": 151000})
    cold = dict(typical, prompt_cache={"warm": False, "caching_observed": True, "ttl": "1h", "expires_at": now - 30,
                                       "recache_tokens_if_cold": 84213})
    theme = theme_from_env() if sys.stdout.isatty() else None
    offset = utc_offset_minutes(now)
    for title, data, preset in (("on track", typical, "default"), ("running hot", hot, "default"),
                                ("cache went cold", cold, "default"), ("full preset", typical, "full")):
        print(f"# {title}")
        for cols in (180, 110, 80, 50):
            options = {"now": now, "preset": preset, "utcOffsetMinutes": offset, "columns": cols - RESERVE}
            separator = paint(SEP, "dim", theme)
            for index, line in enumerate(render(data, options)):
                body = separator.join(paint(form, item.tone, theme) for item, form in line)
                print(f"{cols:>4} | {body}" if index == 0 else f"     | {body}")
        for alert in alerts(data, {"now": now, "utcOffsetMinutes": offset}):
            print(f"     ! {alert['text']}")
        print()


# --------------------------------------------------------------------- main

def main(argv):
    import argparse
    parser = argparse.ArgumentParser(prog="glanceline", description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("action", nargs="?", default="render", choices=["render", "install", "uninstall", "demo"])
    parser.add_argument("--extra-command", action="append",
                        help="append this command's output lines below (a plug-in line); repeatable")
    parser.add_argument("--settings", help="settings.json to edit (default: $CLAUDE_CONFIG_DIR or ~/.claude)")
    parser.add_argument("--command", help="path Claude Code should run (default: this script)")
    parser.add_argument("--refresh", type=int, default=REFRESH,
                        help=f"statusLine.refreshInterval seconds (default {REFRESH}; 0 keeps the previous)")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--version", action="version", version=VERSION)
    args = parser.parse_args(argv)
    if args.action == "install":
        return install(args)
    if args.action == "uninstall":
        return uninstall(args)
    if args.action == "demo":
        return demo()
    payload = sys.stdin.buffer.read(LIMIT + 1)
    extra = []
    for command in args.extra_command or []:
        extra += run_command(command, payload)
    data = decode(payload) if len(payload) <= LIMIT else None
    if data is not None and mod_is_drawing(data):
        extra = []
    lines = render_lines(payload, extra)
    if not lines and not (data is not None and mod_is_drawing(data)):
        lines = ["Claude"]
    sys.stdout.write("\n".join(lines) + "\n" if lines else "")
    return None


if __name__ == "__main__":
    argv = sys.argv[1:]
    if not argv or argv == ["render"] or (argv[0].startswith("--extra-command")):
        # Hot path: never fail, never go blank by accident.
        try:
            main(argv)
        except Exception:  # noqa: BLE001 - a status line must always print something
            sys.stdout.write("Claude\n")
        sys.exit(0)
    try:
        main(argv)
    except (OSError, ValueError) as error:
        print(f"glanceline: {error}", file=sys.stderr)
        sys.exit(2)
