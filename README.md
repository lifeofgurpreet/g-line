# glanceline

**A status line that adds zero lines.**

Every turn gets a receipt, and the unusual turn says what was unusual. The prompt stays
where it is.

In Claude Code 2.1.293 or later, type at the prompt:

```text
/plugin install glanceline --marketplace lifeofgurpreet/glanceline
```

![A real Claude Code session with glanceline: an ordinary turn closes with "API $0.13 · cache read 82%", the next one reads three files and closes with "+86k context · API $0.75", the limits ride on the hint line under the prompt, and /glanceline off shows the same screen without them](docs/demo.gif)

glanceline is a native Claude Code **mod**. It doesn't add a status bar. It writes onto the
lines Claude Code already draws:

- **A receipt on every turn.** The line that closes each turn (`Worked for 20s · done
  11:01 AM`) says what the turn cost at API prices and how much of its input the prompt
  cache served. When something was out of the ordinary, that comes first instead, in colour:
  `+86k context`, `cache write 84k`, `3 failed Bash calls`, `compacted 182k → 31k`, or a cost
  several times your recent turns (`API $1.42 · 4x recent`). Scroll back and the turn that
  ate your context is marked.
- **Live limits on the hint line.** Context, your 5-hour and weekly windows, and the prompt
  cache sit at the end of the hint line under the prompt. A window on pace to run out says
  when: `wk 79% ! out ~Thu 17:35`. What warns keeps its words longest when the terminal is
  narrow.
- **Local observation.** Every figure is one Claude Code hands its mods. glanceline doesn't
  parse your transcript, make network calls or write into the system prompt, and nothing
  leaves your machine.

![The payoff frame: the closing line reads "Worked for 20s · done 11:01 AM · +86k context · API $0.75", and the hint line under the prompt reads "ctx 13% · wk 79% ! out ~Thu 17:35"](docs/hero.png)

Answer `y` to add the marketplace and pick a scope (user is the usual choice). The line
appears right away, with no restart. To remove it, run `/plugin uninstall glanceline`. Older
Claude Code? Use the [status line fallback](#works-everywhere-the-status-line-fallback).

## What you see

### The receipt on each turn's closing line

An ordinary turn gets two quiet facts: `· API $0.13 · cache read 82%`. A turn that did
something unusual leads with it, then its cost:

| Receipt | When |
| --- | --- |
| `+86k context` | The turn grew the context by at least 8k tokens, or 2% of the window when that is more |
| `cache write 84k` | One request wrote at least 20k tokens to the prompt cache, well beyond what the context grew, after the session already had a cache |
| `3 failed Bash calls` | Two or more tool calls failed in the turn (named when they were all one tool) |
| `compacted 182k → 31k` | The context was compacted during the turn |
| `API $1.42 · 4x recent` | The turn cost at least three times the median of your recent turns, and at least 20 cents more |

These are observations, not diagnoses: glanceline says a large cache write happened, not why.
When a background agent ran alongside the turn, the session's cost growth isn't the turn's
alone, so the dollar figure is left out. A narrow terminal drops the supporting facts first
and keeps the lead. `receipt` in the config picks a fixed field list instead.

### The hint line under the prompt

| Segment | Example | What it means |
| --- | --- | --- |
| model | `Opus 5.5 high` | The model, its reasoning effort, and `fast` when fast mode is on |
| context | `ctx 41% (118k left)` | How full the context window is, from the last response |
| 5h | `5h 23% (2h14m)` | Your 5-hour usage window and when it resets |
| 5h, running hot | `5h 72% ! out ~10:03` | At your average rate since the window opened, you reach 100% around 10:03, before the reset |
| week | `wk 41% (3d5h)` | Your weekly window, with the same pace check |
| spend | `spend $416 of $500 monthly` | Shown behind a Claude gateway that sets a spend limit |
| cache | `cache 4m` / `cache cold` | Shown once the prompt cache has under 15 minutes left, or has gone cold and the next turn rebuilds it |

The line narrows as the terminal does. Calm segments go to their short forms first, then
drop, the model name before the context; a segment that warns keeps its projection the
longest. The `!` and `~` carry the meaning without colour, since Claude Code draws this
line dim. Your branch, cost and session time are a `segments` or `preset` away.

![The hint line at 140 columns](docs/line-140.png)
![The hint line at 100 columns](docs/line-100.png)
![The hint line at 76 columns](docs/line-76.png)

### The footer and the spinner

- **Footer mode labels** (right of the hint line): `agents 2 running` while subagents or
  teammates are at work, `compacts in ~3 turns` once a compaction is near. Each label is
  there only while it has something to say.
- **Spinner**: what the running turn has done so far, `· 6 tools`, and `· 2 failed Bash`
  once a tool keeps failing.

![The spinner while a turn runs: Philosophizing… · 3 tools](docs/spinner.png)

### Heads-ups

A native notification five minutes before a one-hour prompt cache goes cold, and when your
5-hour or weekly window resets after you'd come close to its limit. Toasts when a limit is
on pace to run out, a background agent fails, the same tool call fails three times in a row,
or the context is about to compact. `/glanceline off` hides everything glanceline draws and
keeps it quiet too: no toasts, notifications or suggestions until `/glanceline on`.

### The details pane and the share card

`/glanceline` opens a pane, docked beside the conversation on a wide terminal, with every
figure spelled out: bars, reset times, any warning that's live, the agents, the last turns'
receipts, what fills the context (counted locally, like `/context`), the tools used and
failed, and today's and this week's totals across sessions. `/glanceline card` shows a share
card of the session with a button that copies it as text. It leaves out your repository,
branch, paths and account. The pane opens only when you ask for it.

![The /glanceline details pane, docked beside the conversation](docs/details-pane.png)

![The /glanceline card share card, with a Copy as text button](docs/card.png)

## Configure

`/config` lists five settings: **layout** (`default`, `minimal` or `full`), **icons**
(`none` or `nerd`, for Nerd Font glyphs), **heads-up toasts** (on or off), **native
notifications** (on or off) and **turn receipt** (`adaptive`, `short`, `full` or `off`).

For more control, add `~/.config/glanceline/config.json` (or put it under
`$XDG_CONFIG_HOME`):

```json
{
  "segments": "model,context,five_hour,seven_day,cache,git",
  "receipt": "adaptive",
  "notify": { "cache": true, "reset": true, "long_turn": true, "agents": false },
  "long_turn_seconds": 90,
  "today_budget": 50
}
```

| Key | Values | Default |
| --- | --- | --- |
| `preset` | `minimal` (model, context, 5h, cache), `default` (adds week and spend), `full` (adds bars, git, PR, cost, time; still one line under the prompt) | `default` |
| `segments` | Your own layout for the hint line. Keys: `model`, `context`, `five_hour`, `seven_day`, `spend`, `cache`, `git`, `pr`, `cost`, `time`, `lines`, `vim`, and the mod-only `agents`, `compact` and `today`. Separate them with `,`. Naming `agents` or `compact` moves it from the footer to the hint line. `git` runs `git status` in your project; nothing else does | the preset's |
| `receipt` | `adaptive`, `short` (cost, cache, tools), `full`, `off`, or a list of `cost`, `cache`, `context`, `tools`, `agents`, `output` | `adaptive` |
| `toasts` | `true`, `false` | `true` |
| `notify` | `true`, `false`, or per kind: `cache` (prompt cache about to go cold), `reset` (a usage window reset after you passed `reset_threshold`), `long_turn` (a turn longer than `long_turn_seconds` finished), `agents` (a background agent finished; a failure always raises a toast) | `cache` and `reset` on, the rest off |
| `reset_threshold` | Percent of a window you must have reached for its reset to notify | `80` |
| `long_turn_seconds` | How long a turn runs before its end notifies (with `long_turn` on) | `60` |
| `today_budget` | Dollars at API prices. Today's total across sessions joins the line at 80% of it, and a toast says when you pass it | none |
| `spinner` | `true`, `false`: progress on the spinner | `true` |
| `footer_labels` | `true`, `false`: agents and the compaction forecast in the footer | `true` |
| `coach` | `true` puts a suggestion in the prompt box for Tab to take: `/effort medium` or `/model` when the 5-hour window is on pace to run out (once per window, across sessions), `/compact keep ` two turns before a compaction. It never changes anything itself | `false` |
| `tool_streak` | Failures in a row of the same call before the toast; `0` turns it off | `3` |
| `export_state` | `true` writes the figures as JSON to `~/.cache/glanceline/state/<session id>.json` for tmux, sketchybar and other bars | `false` |
| `icons` | `none`, `nerd` | `none` |
| `cache_ttl` | `auto`, `5m`, `1h` (see the FAQ) | `auto` |
| `account_command` | A command, as an argv list, whose first output line goes at the end of the line (`account you@example.com (via CAAM)` shows as `you@example.com`). It runs at start and every ten minutes. Off unless you set it, so screenshots don't show who you are | none |

A `config.json` placed next to the plugin's `plugin.json` sets defaults for everyone who
uses that copy, which is handy for a team. Notifications go through your own
`preferredNotifChannel`; where your terminal has no channel, the heads-up shows as a toast.

## Works everywhere: the status line fallback

The mod needs Claude Code 2.1.293 or later. On any version, `glanceline.py` runs as a
classic `statusLine` command and prints the hint-line segments with the same wording. It's
a single standard-library Python file and works with Python 3.8 or later on macOS and
Linux. It is a compatibility tool: a configured status line keeps a row of its own, and the
receipts, footer labels, notifications, pane and card need the mod.

```sh
curl -fsSL https://raw.githubusercontent.com/lifeofgurpreet/glanceline/main/install.sh | sh
```

The installer copies the script to `~/.local/bin/glanceline` and changes one key in
`~/.claude/settings.json`: `statusLine`. It saves a backup first and records the status
line it replaced. To undo it, run:

```sh
glanceline uninstall     # puts your previous statusLine back, byte for byte when nothing else changed
```

- `glanceline demo` prints sample lines at four widths.
- Settings come from the same `config.json` (`preset`, `segments`, `icons`, plus
  `theme`: `color` or `mono`), or from `GLANCELINE_PRESET`, `GLANCELINE_SEGMENTS`,
  `GLANCELINE_ICONS` and `GLANCELINE_THEME`. `NO_COLOR` is respected.
- `--extra-command CMD` adds that command's output below the line.
- When the mod is also installed, the fallback steps aside in that session, so you never
  see the same figures twice: the mod keeps `~/.cache/glanceline/live/<session id>` fresh,
  and the fallback prints nothing while that file is under a minute old. Claude Code still
  keeps an empty row for a configured status line, so once the mod runs everywhere you
  use, `glanceline uninstall` gives that row back.

The two share one core: `hooks/core.ts` for the mod and its line-for-line port in
`glanceline.py`. Both are tested against the same golden file, `tests/cases.ts`.

## FAQ

**Is the dollar figure my bill?**
No. It's Claude Code's own cost ledger at API list prices: the session's in the pane, the
growth during one turn in its receipt (`API $0.75`). On a subscription it's a sense of
scale, not a charge.

**What does "cache read 82%" mean?**
The share of the turn's input tokens the prompt cache served. It isn't money saved, and it
doesn't say the whole context is still warm.

**What does "cache 4m" mean?**
Claude Code keeps your conversation in Anthropic's prompt cache, so each turn re-reads it
cheaply instead of processing it again. The cache lasts a set time after your last
message: one hour on a Claude subscription within its limits, five minutes on an API key
or a cloud provider. After that it goes **cold**, and your next message rebuilds all of it
(`cache cold (next turn rebuilds 84k)`), which is slower and uses more of your limit. The
line shows the countdown once under 15 minutes are left, and a notification comes five
minutes before an hour-long cache goes cold. The `full` layout always shows it.

**How does it know 1 hour vs 5 minutes?**
It applies Claude Code's own rule: `FORCE_PROMPT_CACHING_5M`, `CLAUDE_CODE_PROMPT_CACHE_TTL`,
the `promptCacheTtl` setting, `ENABLE_PROMPT_CACHING_1H`, and otherwise one hour on a
subscription and five minutes elsewhere. If it later sees the cache hit or miss after a
long pause, it corrects itself. You can also pin it with `cache_ttl`. (The fallback reads
the exact expiry, because the status line gets it from Claude Code directly.)

**What does "! out ~14:24" mean?**
glanceline takes your usage so far in the window, divides it by the time since the window
opened, and projects that rate forward. If the projection reaches 100% before the reset,
you see roughly when. It's a projection, hence the `~`. It stays quiet for the first 15
minutes of a 5-hour window and the first 12 hours of a week, while the average still means
little.

**How good is the compaction forecast?**
It divides the room left before the auto-compact threshold by the average context growth of
your last five turns, so it's a rough count that sharpens as you go. It appears only past 60%
of the threshold, only when compaction is under 30 turns away, and says `soon` rather than
`next turn`.

**Where do the day and week totals live?**
In glanceline's own store under your Claude Code configuration directory: one small entry per
session per day with its cost, turns, tool calls, cold-cache rebuilds and agents. Numbers
only, never conversation content. Entries older than 35 days are removed. Only sessions where
glanceline ran on this machine are counted.

**Does it read my conversation or send anything anywhere?**
No. It reads the figures Claude Code hands every mod, and runs `git status` only when your
layout shows the branch (or the pane is open). Nothing leaves your machine. It refreshes its
countdowns on a 15-second timer while you're idle.

**Is a mod sandboxed?**
No more than any plugin: it runs with your permissions, and organisations can restrict
plugins. `claude plugin validate .` in this repository lists every event glanceline hooks
and every call it makes.

**Something's missing.**
Usage windows show up after the first response of a session, and only on a subscription.
The cache segment appears once a response reports cache tokens and the countdown gets
short. Lines added and removed come from the status line payload, so only the fallback
shows them. The receipt rides on the terminal; other surfaces draw their own turn footer.

## How is this different from other status lines?

Projects like ccstatusline, claude-powerline and claude-hud are `statusLine` commands: a
line of their own that Claude Code refreshes. glanceline is a mod. It adds no row, puts each
fact on the line where the work happened (the receipt on the turn that did it, the limits on
the hint line you already look at), sees turns, tool calls, subagents and compactions as they
happen, and can raise notifications, open a pane or add a command. It has no dependencies.

## Develop

```sh
claude plugin validate .               # what the engine sees and would refuse
claude plugin test .                   # mod tests: golden file, line, receipts, agents, forecast, ledger, card, heads-ups
python3 tests/test_glanceline.py       # fallback tests: golden parity, install round trips, garbage input
bun scripts/golden.ts                  # regenerate tests/cases.ts after changing hooks/core.ts
claude --plugin-dir .                  # run a session with your working copy
```

`hooks/core.ts` (shared with the fallback), `hooks/inline.ts` and `hooks/extras.ts` are pure
functions; `hooks/register.tsx` wires them to Claude Code. The screenshots and the demo are
real captures (`tmux capture-pane -e`), rendered by `scripts/ansi2svg.py`,
`scripts/ansi2png.py` and `scripts/frames.py`, which records a pane as timed frames and
cuts them into an MP4 and a GIF.

## License

MIT
