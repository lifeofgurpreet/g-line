# g-line

**Live status. Receipts on the turns.**

g-line is a Claude Code mod that puts context jumps, cache rebuilds and tool failures on the
turns where they happen, not just in a status bar. Model and effort, the prompt cache and your
usage windows stay under the prompt.

In Claude Code 2.1.293 or later, type at the prompt:

```text
/plugin install g-line --marketplace lifeofgurpreet/g-line
```

![A real Claude Code session with g-line: an ordinary turn closes with "API $0.22 · cache read 49%"; while it runs, the spinner shows its burn and a Pulse headline; over five idle minutes the cache countdown on the second line runs down, a heads-up warns before it goes cold, and it goes cold; the next turn compares two API schemas and closes with "cache cold · rebuilt 42k · API $0.31"](docs/demo.gif)

## What it does

- **The unusual turn identifies itself.** The line that closes each turn (`Worked for 20s ·
  done 11:01 AM`) gets a receipt. An ordinary turn says what it cost at API prices and how
  much of its input the prompt cache served: `API $0.22 · cache read 49%`. An unusual one
  leads with up to two of these, in colour: `+86k context`, `cache cold · rebuilt 42k`,
  `cache write 84k`, `3 failed Bash calls` or `compacted 182k → 31k`. A cost several times
  your recent turns says so: `API $1.42 · 4x recent`. Scroll back to see which turn changed
  things.
- **The warning stays with the work.** While a turn runs, the spinner shows its burn
  (`3 tools · +4.1k ctx · 5h 74%`). When calls keep failing, it names the tool and the file:
  `⚠ 3× Edit failures on core.ts`. The receipt keeps that record after the turn ends.
- **What matters stays visible.** Your gauges ride at the end of Claude Code's own hint line
  (`ctx 13% · 5h 1% · wk 79%!`). One coloured line under it has the model and its effort, the
  cache countdown and what happens next: `Opus 5.5 high · cache ~59m · wk out ~Thu 19:00,
  resets Fri 16:00`. Nothing goes above the prompt.
- **A heads-up before the cache goes cold.** A native notification five minutes before a
  one-hour prompt cache expires, with what's at stake: `Claude cache goes cold in 5m (148k of
  context at risk)`. When Claude Code's idle compaction covers the conversation (an hour-long
  cache of 200k tokens or more), it says so: if you don't reply, Claude Code compacts the
  conversation to a summary first. Another tells you when a usage window resets after you
  came close to its limit.

![A schema comparison closes with "Baked for 43s · done 1:22 PM · cache cold · rebuilt 42k · API $0.31"; under the prompt, the hint line ends with "ctx 4% · 5h 1% · wk 80%!" and the coloured line reads "Opus 5.5 high · cache warm ~4m · 5h resets in 2h 47m · wk out ~Thu 19:00, resets Fri 16:00"](docs/hero.png)

Answer `y` to add the marketplace and pick a scope (user is the usual choice). The mod starts
at once, with no restart. To remove it, run `/plugin uninstall g-line`.

## Why a mod

A `statusLine` command is a separate program. Claude Code runs it and prints what it prints
in a status area under the prompt. A mod runs inside Claude Code and can draw on Claude
Code's own lines. That is what makes g-line possible:

- the receipt on each turn's own closing line, kept beside that turn in the terminal;
- the burn and failures on the working spinner, while the turn runs;
- the gauges at the end of the existing hint line, so the footer grows by one row, not two
  or three;
- each request's cache reads and writes, every tool call and its result, subagents, and
  compactions, read from the engine as they happen rather than from the transcript file;
- a `/g-line` command that runs without a Claude turn, a pane with buttons, and native
  notifications through your own notification channel.

## How it compares

Read from each project's README on 2026-10-14. "Not documented" means not in its docs, not
impossible.

| | g-line | claude-hud | ccstatusline | claude-powerline | ccusage |
| --- | --- | --- | --- | --- | --- |
| What it is | Claude Code mod | Plugin that sets up a `statusLine` command | `statusLine` command | `statusLine` command | Usage-report CLI with a statusline command |
| Where it draws | The hint line, one row under it, the spinner, each turn's closing line | Its status lines (two by default) | Its status lines, configurable | Its status lines, powerline style | Its status line, and separate reports |
| Receipt on each turn's own line | Yes | Not documented | Not documented | Not documented | Not documented |
| Model and effort | Yes | Yes (effort optional) | Yes (widget) | Yes | When Claude Code supplies it |
| Prompt-cache countdown | Yes, an estimate | Optional | Yes (widget) | Optional | Not documented |
| Limits with pace | Projected run-out time | Usage windows, pace colours | Usage and reset widgets | Usage with an even-spend pace marker | Block cost, time and burn rate |
| History | Receipts in scrollback; today and this week in the pane | Optional cost ledger | Session and compaction widgets | Today and month budgets | Daily, monthly and session reports |
| Where activity comes from | Engine events | Status data; optional lines read the transcript | Status data, transcript and usage API, by widget | Status data and local transcripts, by feature | Local usage records |
| Pick it to | See which turn changed things, beside the work | Get a configurable session overview | Get extensive widget customisation | Get a styled layout with budgets | Get retrospective usage analysis |

Already happy with one of those? Set `lines` to `receipts`: g-line then adds only the
receipts, spinner and heads-ups, and leaves your status line alone.

## What you see

### The receipt

| Receipt | When |
| --- | --- |
| `API $0.22 · cache read 49%` | An ordinary turn: its cost at API prices and the share of its input the cache served |
| `+86k context` | The turn grew the context by at least 8k tokens, or by 2% of the window when that is more |
| `cache cold · rebuilt 42k` | The turn's first request came after the cache's lifetime and rewrote it |
| `cache write 84k` | A request wrote at least 20k tokens to the cache, well beyond what the context grew |
| `3 failed Bash calls` | Two or more tool calls failed in the turn (named when they were all one tool) |
| `compacted 182k → 31k` | The context was compacted during the turn |
| `API $1.42 · 4x recent` | At least three times the median of your recent turns, and at least 20 cents more |

These are observations, not diagnoses. g-line says a cold cache was rebuilt; it doesn't say
whose fault that was. When a background agent ran alongside the turn, the session's cost
growth isn't the turn's alone, so the dollar figure is left out. A narrow terminal drops the
supporting facts first.

### The two lines under the prompt

Line 1, at the end of Claude Code's hint line, drawn dim by Claude Code:

| Segment | Example | What it means |
| --- | --- | --- |
| context | `ctx 13%` | How full the context window is, from the last response |
| 5h, week | `5h 1%`, `wk 79%!` | Your usage windows. `!` means on pace to run out before the reset |
| spend | `spend 83%` | Behind a Claude gateway that sets a spend limit |

Line 2, g-line's own row, in colour:

| Segment | Example | What it means |
| --- | --- | --- |
| model | `Opus 5.5 high` | The model and the effort of the last request (`fast` when fast mode is on) |
| cache | `cache ~59m`, `cache cold`, `compacted, next turn caches 31k` | How long the prompt cache stays warm, green, then amber in its last minutes. `~` because it's an estimate from when the last request ran and the cache's lifetime. After a compaction (yours, automatic, or Claude Code's while you were idle) the old conversation's cache no longer applies, so it shows the summary the next turn writes instead. When your `account_command` line changes (an account manager switched accounts), it reads `cache cold (account changed)`: prompt caches are kept per organization, so the next turn starts a new one, and that turn's closing line says `cache cold after account change · rebuilt 120k`. Without an `account_command`, g-line can't see a switch |
| timing | `wk out ~Thu 19:00, resets Fri 16:00` | When a window on pace to run out gets there (rounded: it's a projection), else when it resets |
| agents, compaction | `agents 2 running`, `compacts in ~3 turns` | While subagents work; when a compaction is near |
| guard, keep-warm | `guard: effort medium`, `kept warm 2× · $0.08`, `resumes 14:17` | Only with your `guard` rules (see Guard): what they're doing now |
| others | `2 others · 1 waiting` | Other g-line sessions on this machine, and how many wait on you for a permission answer. Only when there are others; it's the first thing a narrow line drops. `roster: false` turns it off |

When the terminal narrows, line 2 shortens first (`Opus 5.5` to `Opus`, the effort kept), and
what line 1 can't fit moves down rather than vanishing. A healthy window's reset time goes
first; the warning keeps its projection the longest.

![Line 1 and line 2 at 100 columns](docs/line-100.png)
![At 80 columns](docs/line-80.png)

Prefer one line? Set `lines` to `1`: everything rides on the hint line, and Claude Code's
standing hint `(shift+tab to cycle)` shortens to `⇧⇥` to make room. Claude Code's own
permission-mode label (`⏵⏵ bypass permissions on`) is drawn beside the hint where no mod can
change it, so g-line leaves it as it is.

### The spinner

`Sautéing… · 3 tools · +4.1k ctx · 5h 74%` while a turn runs, and
`⚠ 3× Edit failures on core.ts` first once calls keep failing.

![The spinner mid-turn: Sprouting… · 2 tools · +1.2k ctx · 5h 1%](docs/spinner.png)

### Pulse (off unless you turn it on)

`/g-line set pulse on` (or `p` in `/g-line settings`) turns on **Pulse**, and a headline
appears under the prompt within seconds, on a dim row of its own under line 2:

```
𝕏 @NeelNanda5 · 2h: This is interesting work, but I don't think it's a significant… · /g-line news
```

**How it moves, and when a headline stops coming back:**

- The row moves to the next headline every **8 seconds**. `pulse_speed` (`v` in
  `/g-line settings`) makes it every **40 seconds** (`slow`), or holds one headline (`paused`).
- Headlines you haven't seen come first, in the feed's order (best first).
- A headline that has been shown **rests for 30 minutes** before it can come back, and shows at
  most **3 times a day**.
- When every headline is resting, the row **holds still** on the one it shows. It moves again
  when a new headline arrives or a rest ends.
- The same headline never shows twice in a row, even when the feed refreshes.
- Every session on the machine shares these counts, so two terminals don't repeat each other.
- The feed is rebuilt every 30 minutes (15 items when the sources have them), and g-line
  fetches it at most every **45 minutes**. `r` in `/g-line news` fetches it now.

So with 15 headlines the row shows each one once in its first two minutes, then stays on
the last one until something new comes in or half an hour has passed.

**Links.** The headline is a link wherever Claude Code itself draws links: Ghostty, iTerm2,
kitty, WezTerm, VS Code, Windows Terminal, Warp, and tmux 3.4 or later. Cmd-click (ctrl-click
on Linux) opens it. Claude Code doesn't recognise herdr, Zellij or a session reached over SSH,
so with Pulse on g-line sets `FORCE_HYPERLINK=1` in Claude Code's own process (Claude Code
decides links on every draw) and its SessionStart hook unsets it again for Bash commands, so
tools don't start printing link codes into what Claude reads. Set `FORCE_HYPERLINK=0` where
Claude Code starts if your terminal can't show links (the address would then print after the
headline). `/g-line open` opens the headline showing in any terminal. Over SSH, or on a machine
with no display, it copies the link instead, for your own terminal to paste.

With the receipts-only layout there is no row, so the spinner shows the headlines on turns
longer than 15 seconds instead, by the same rules. Only one of the two ever shows.

![Under the prompt, after a turn that closed with "API $0.17 · cache read 53%": the hint line ends with "ctx 4% · 5h 0% · wk 24%", line 2 reads "Opus high · cache ~57m · 5h resets 4h41m · wk resets 4d4h", and Pulse's row under it reads "𝕏 @deepseek_ai · 1d: 🚀 DeepSeek-V4.1-Flash-1017 is here! Stronger benchmark per… · /g-line news"](docs/pulse-row.png)

**`/g-line news` is the reader.** It lists every item in the feed, best first, as the feed
ranks them. The picked one is shown in full: who and when, likes on 𝕏 or points on Hacker
News, the story a post is about, the whole post, and its link. The rest are one headline each.
`j` and `k` move, `o` or Enter opens, `d` opens a Hacker News item's comments, `c` copies the
link, `m` mutes the picked item's source (or unmutes it), `r` refreshes, `q` closes. Items
posted since you last opened it are marked **new**. A muted source stays in the reader, marked
**muted**, and leaves Pulse's row and the spinner.

![/g-line news: "3–6 of 8, best first · updated 43m ago" over the key row; the picked item, "Hacker News · 4h · ▲ 163", shows its full title, "163 points and 100 comments on Hacker News.", its link and a link to the comments; the items around it show one headline and their source each, such as "James Titcomb / Telegraph via Techmeme · 18h"](docs/news.png)

Headlines come from g-line's own static feed: posts on 𝕏 about AI, Claude Code releases,
Anthropic's news pages, Hacker News stories about Claude, Simon Willison's AI posts, and a few
items the maintainer picks. Each is labelled with where it came from. Posts on 𝕏 are the
freshest part: under two hours old, or gaining likes fast enough to stay up to a day, or big
enough to stay up to three days, and always about AI. No X API key is involved: the feed finds
posts through the links Techmeme, AI subreddits and the Internet Archive carry, and rebuilds
every 30 minutes.

When Pulse is on, g-line fetches one file,
`raw.githubusercontent.com/lifeofgurpreet/g-line/pulse/pulse.json`, at most every 45 minutes.
It sends nothing about you, it never fetches while drawing, and it gives up after five
seconds. Headline text is stripped of escape and control characters before it reaches your
terminal; the only escape g-line draws is its own link, to an `https` address it has checked.
To keep the rules above across sessions, g-line remembers which headlines it showed and when,
for a day, in Claude Code's plugin store on your machine.
With Pulse off (the default), g-line makes no network requests at all.

![Pulse on the spinner during a long turn, in the receipts-only layout: Churning… · 1 tool · 5h 9% │ 𝕏 @claudeai · 6d: Claude Dashboards and Claude Motion are in b…](docs/pulse.png)

### The pane, settings and share card

`/g-line` opens a pane with every figure spelled out: limits with bars and reset times (on
your own clock: `5-hour 62% used, resets 14:12 (in 2h 47m)`), warnings, agents, the last
turns' receipts, what fills the context (counted locally, like `/context`), tools used and
failed, the other sessions on this machine, and today's and this week's totals across sessions. Its
top row flips the common settings with one key (`l` layout, `r` receipt, `p` Pulse), `s` opens
all of them, and `n` opens the news reader. `/g-line card` shows a share card of the session
with a copy button; it leaves out your repository, branch, paths and account. `/g-line off`
hides everything g-line draws and keeps it quiet until `/g-line on`.

**`/g-line settings` is the settings manager.** Every setting is one row: its key, its value,
and where the value comes from (`default`, `config.json`, `/config`, or `your choice`), with
`•` marking the ones that differ from a fresh install. Press the key and the setting flips,
at once, in this session and in every other open one, with no restart. `z` clears the choices
you made here, so your files and the defaults decide again.

![/g-line settings: "A key flips a setting now, in every open session. • = not the default", then rows grouped under Show, Heads-ups and Extras, such as "l: Layout two lines default", "g: Git branch on • config.json" and "p: Pulse on • your choice"](docs/settings.png)

The same from the prompt: `/g-line set pulse on`, `/g-line set receipt short`,
`/g-line toggle git`, `/g-line reset pulse` (back to what your files say), `/g-line reset`
(all of them), and `/g-line set all on`. Names are forgiving: `cold cache`, `cache` and
`notify.cache` are the same setting.

![The /g-line pane](docs/details-pane.png)

## Configure

`/g-line settings` sets every on/off and layout choice without editing anything (see above).
`/config` lists six: **Layout** (`2`, `1` or `receipts`), **One-line preset**, **Icons**,
**Heads-up toasts**, **Native notifications** and **Turn receipt**. To set them for every
session on a machine, or every machine you manage, write `~/.config/g-line/config.json` (or
put it under `$XDG_CONFIG_HOME`). Running sessions read it again within 15 seconds of an edit.
Layers, lowest first: defaults, `config.json`, `/config`, then choices made with `/g-line`.

```json
{
  "lines": 2,
  "git": true,
  "notify": { "cache": true, "reset": true, "long_turn": true },
  "today_budget": 50
}
```

| Key | Values | Default |
| --- | --- | --- |
| `lines` | `2`, `1`, or `receipts` (receipts, spinner and heads-ups only) | `2` |
| `receipt` | `adaptive`, `short` (cost, cache, tools), `full`, `off`, or a list of `cost`, `cache`, `context`, `tools`, `agents`, `output` | `adaptive` |
| `pulse` | `true` fetches the headline feed (see Pulse) | `false` |
| `pulse_speed` | `normal` (every 8 s), `slow` (every 40 s), `paused` | `normal` |
| `pulse_mute` | Sources Pulse's row and spinner skip, matched within the source in any case: `["𝕏"]` skips every post on 𝕏, `["@someone", "Hacker News"]` one account and one site | `[]` |
| `git` | `true` puts your branch on line 2; g-line then runs `git status` in your project | `false` |
| `notify` | `true`, `false`, or per kind: `cache`, `reset`, `long_turn` (a turn longer than `long_turn_seconds` finished), `agents` (a background agent finished) | `cache` and `reset` on |
| `toasts` | `true`, `false` | `true` |
| `spinner` | `true`, `false`: the burn on the spinner | `true` |
| `tool_streak` | Failures in a row of the same call before the toast; `0` turns it off | `3` |
| `today_budget` | Dollars at API prices; today's total across sessions joins line 2 and a toast says when you pass it | none |
| `coach` | `true` offers `/effort` or `/model` for Tab to take when the 5-hour window is on pace to run out, and `/compact keep ` before a compaction. It never changes anything itself | `false` |
| `claude_reads` | `true` gives Claude a `status` tool to read these figures when you ask it to (see below) | `false` |
| `footer_labels` | `true`, `false`: agents and compaction in the footer (one-line layout) | `true` |
| `short_hints` | `true` draws `(shift+tab to cycle)` as `⇧⇥` | `true` |
| `export_state` | `true` writes the figures as JSON under `~/.cache/g-line/state/` for tmux and other bars | `false` |
| `roster` | `true` keeps a heartbeat of each g-line session on this machine in Claude Code's plugin store: whether it's working, waiting on you or idle, its context, cache and model, and the `account_command` line when you set one. Line 2 counts the others, the pane lists them. `false` writes and shows nothing | `true` |
| `guard` | Your rules for a low usage window, and keep-warm (see Guard). With none, g-line changes nothing | none |
| `tz` | Your time zone (an IANA name such as `Pacific/Guadalcanal`) for every time g-line shows: resets, projections, receipts, the guard's words. Useful on a machine in another zone, over SSH. `auto` is the machine's own. The pane says which zone the times are in | `auto` |
| `reset_threshold`, `long_turn_seconds`, `cache_ttl`, `icons`, `segments`, `preset`, `account_command` | See `hooks/settings.ts`. `account_command` runs a command you choose and shows its first line; off unless set | |

`~/.config/glanceline/config.json` from 0.4 is still read, and `g-line/config.json` wins.

### Let Claude read the figures (opt-in, experimental)

With `claude_reads: true`, g-line registers a tool, `status`, that returns a small JSON
snapshot: context used and the room before auto-compact (when Claude Code reports it), the
usage windows with projected run-out times, and the cache's estimated expiry, each with its
scope. Unknown figures are `null`, and it gives no advice. Its description tells Claude to use
it when you ask, and not to change model, effort or compaction on its own. Two honest notes:
the result enters the conversation like any tool result, so it goes to your model provider
with the rest of the conversation; and the tool is deferred only where tool search is
available.

### Guard: your rules for a low window (opt-in)

Everything else in g-line only watches. The guard acts, but only on rules you write, and it
says what it did. With no `guard` block in `config.json` it does nothing. Each rule says how
much of a usage window is left (`left`, in percent, the 5-hour window unless it says
`"window": "week"`) and one thing to do from then on:

```json
{
  "account_command": ["my-account-tool", "--label"],
  "guard": {
    "rules": [
      { "left": 20, "effort": "medium" },
      { "left": 10, "agents": "sonnet" },
      { "left": 5, "stop": true, "unless_reset_within": "1h" },
      { "left": 10, "stop": true, "end_turn": true, "accounts": ["team@"], "hours": "09:00-17:00 mon-fri", "tz": "Asia/Kuala_Lumpur" }
    ],
    "keep_warm": { "after": "45m", "max": 2, "min_context": "50k" }
  }
}
```

That reads: at 20% left, run the conversation at effort `medium`. At 10%, start new subagents
on Sonnet. At 5%, stop new prompts, unless the window resets within the hour. And on a shared
account (one whose `account_command` line contains `team@`), stop at 10% during office
hours in Kuala Lumpur, ending a turn that's running then too, so teammates keep some of the
window.

- **`effort`** lowers the main conversation's effort, never raises it, and applies from the
  start of a turn to its end. On Opus 5.5, Sonnet 5.5, Haiku 5.5 and Fable 5.1 through the
  Claude API (an API key or a Claude subscription), Claude Code keeps the prompt cache when
  effort changes. Elsewhere (Bedrock, Vertex, Foundry, other models) a change of effort reads
  the whole conversation again, so the guard waits until the cache has gone cold, and line 2
  says `effort medium when cache cold`. The guard never switches the main model, since that
  always rebuilds the cache.
- **`agents`** starts new subagents on that model (`sonnet`, `haiku`, or a model id). It only
  ever moves an agent to a cheaper model: one that already runs on Haiku keeps it, and a fork
  keeps its parent's model. An agent type whose own definition picks its model (a plugin's
  agent, say) is left alone until g-line has seen what it runs on. Running agents aren't
  touched.
- **`stop`** refuses a new prompt with the window, what's left and when it resets. That covers
  typed prompts and machine-started ones (a `/loop` or schedule waking up, a background task's
  notice). The one notice it lets through is the report of a background agent your
  conversation started: that work is done and paid for, and a refused report would never
  reach Claude. A stop never stops a tool call, and a turn already running only with `end_turn` (below). A slash command
  you type still goes through. The refusal says why in plain words, for example `g-line held
  this prompt: sam@example.com is in your people group, with 35% of its 5-hour window left. g-line
  keeps the last 40% of it for its owner. It resets at 13:00, in 3h 0m.` **Claude Code puts the
  refused prompt back in the box: press Enter again to send it anyway** (the same prompt, within
  three minutes; a loop's or schedule's prompt never gets this). `/g-line guard once` lets the
  next prompt through, `/g-line guard pause` lets everything through for an hour (or
  `pause 30m`) in every session on the machine, and `/g-line guard resume` ends the pause. With
  several stops in force, the reason given is the one that started first, so it doesn't change
  from one prompt to the next.
- **`end_turn`** (with `stop`): a stop also ends a turn that's already running, once the rule
  starts during it. The turn ends between steps, before its next request, so every tool call
  the last response asked for has finished; nothing is cut off mid-call. A turn that began with
  the rule already in force (`/g-line guard once`, a pause, a slash command, an agent's report)
  runs to its end, and so does every turn while the guard is paused. You get a toast, a
  notification and `guard: held` (or `team reserve`) on line 2; Claude Code draws no closing
  line for a turn ended this way. Type `continue` and press Enter twice to carry on. Without
  `end_turn` a stop only refuses new prompts, so one long agentic turn can still run a window
  down to nothing.
- **`unless_reset_within`**: the rule waits while the window resets within that time.
- **`accounts`**: the rule applies only when the `account_command` line contains one of these
  words, in any case. With no account reading, it doesn't apply, and with no
  `account_command` at all, g-line says so when the session starts and in `/g-line guard`.
- **`except_accounts`**: the other way round, every account except those whose line contains
  one of these words (`["me@"]` for "every shared account"). With no account reading it
  doesn't apply either. A shared account runs out by the week as well as by the hour, so a
  reserve usually wants a `"window": "week"` rule too, with no `hours`: a week drained
  overnight is still drained in the morning.
- **`hours`** (`09:00-17:00 mon-fri`, `22:00-06:00`, `9-17 sat,sun`) in **`tz`** (an IANA
  zone; the machine's own when left out).
- **`groups`**: the rule applies to every account in these groups (see Account groups below).
- **`pace`**: a paced week instead of `left` (see Pace a week below).

**Pace a week** (`pace`, 0.12.0). A cliff rule waits until the last 10% and then stops; a team
that shares a seat finds the weekly window gone by Friday all the same, because nothing slowed
down on the way. A `pace` rule gives the week an allowance that opens up as the week goes by,
and steps in when the account has used more than that:

```json
{ "groups": ["team", "other"], "end_turn": true,
  "pace": { "reserve": 10, "burst": 8, "office": "09:00-18:00 mon-fri", "office_weight": 4, "tz": "Asia/Kuala_Lumpur" } }
```

The week runs from seven days before the weekly reset the engine reports, to that reset, so it
follows your plan's own week, not Monday. The allowance is `burst` percent from the first
minute, rising to `100 - reserve` percent by the reset. How fast it rises follows the clock:
an hour in `office` hours counts `office_weight` times an hour outside them (the example's week
has 45 office hours and 123 others, 303 weighted hours, so by Monday 09:00 about 15% of the
rise is allowed, and by Friday 18:00 about 95%). Office hours are read in `tz`, daylight saving
included. With no `office`, the allowance rises in a straight line.

When the week's used percent plus `buffer` (2 points of slack for a coarse reading) passes the
allowance, the rule steps down, one step at each of `tiers` points ahead (`[0, 3, 6]`):

1. the conversation runs at `effort` (`medium`);
2. new subagents also run on `agents` (`sonnet`);
3. new prompts stop, and with `end_turn`, a running turn ends between steps.

Inside the `reserve` plus the buffer, it stops whatever the pace. Each step lets go 2 points
after it would have started, so it doesn't flicker, and only in the account and the window it
began in. The words are plain: `g-line held this prompt: sam@example.com is in your team group,
and ahead of pace: 62% of the week used, 48% allowed by now. g-line paces the week so it lasts
for the team. It resets at Sat 10:00, in 4d 1h.` The rule takes the same `groups`, `accounts`,
`except_accounts`, `hours` and `unless_reset_within` as any other, and no `left`, `effort`,
`agents` or `stop` of its own. `reserve` is 0 to 50, `burst` 0 to `100 - reserve`,
`office_weight` 0.1 to 20, and the `tiers` rise.

**Say why** (`/g-line guard why`). A toast gives the verdict and the pane lists the rest: the
weekly and 5-hour figures, this account's group, each rule's state (for a pace rule, the used
percent against what's allowed now and which step is in force), and about when the hold lifts.

**Queue a held prompt** (`"queue": true` in `guard`). Instead of handing your prompt back, g-line
holds it and sends it itself as soon as the guard lets go: when the window resets, or when a
rule's hours end. The refusal says when (`g-line will send it when the guard lets it through,
about 08:21`), line 2 adds `1 queued`, and `/g-line guard cancel` keeps it from going. If the
prompt cache would lapse before then, g-line re-reads it once, a few minutes before it would,
so the prompt lands on a warm cache (at most twice, and only with room left in the window; a
window that's used up can't be read from, and the refusal says the cache will be cold). Enter
again still sends it straight away. A prompt you type that goes through, `/clear`, an
account change, or a stop that comes back for a different window drops the held one. The same
goes for `/g-line guard once` and Enter again: each is for the account and window the prompt was
held in, and lapses if either has changed.

#### Account groups

Rules can name groups of accounts instead of listing accounts, so you bucket your accounts once
and give each bucket its own rules. An account belongs to the first group, in the order
written, whose words its `account_command` line contains, and to `other` when it's in none:

```json
"guard": {
  "groups": {
    "mine":   ["me@"],
    "team":   { "accounts": ["team@", "ops@"], "for": "the team" },
    "people": { "accounts": ["sam@"], "for": "its owner" }
  },
  "rules": [
    { "groups": ["team"], "left": 10, "stop": true, "end_turn": true, "hours": "09:00-17:00 mon-fri" },
    { "groups": ["people"], "left": 40, "stop": true, "end_turn": true },
    { "groups": ["team", "people"], "window": "week", "left": 10, "stop": true, "end_turn": true },
    { "groups": ["other"], "left": 15, "stop": true }
  ]
}
```

A group is a list of words, or `{ "accounts": [...], "for": "..." }` where `for` is who the
reserve is kept for, in the refusal (`g-line keeps the last 40% of it for its owner`). Line 2
names the group (`guard: people reserve, 35% 5h left till 13:00`), and the `/g-line` pane lists
the groups with the session's own marked. Change a group's rules and every account in it
follows.

A rule starts when the window falls to its threshold. It lets go when the window climbs 2
points past it, the window resets, or one of its conditions stops holding. A reading taken
before the window's reset counts for nothing. The percentages belong to the account, so every
session using it crosses a threshold at about the same time.

**Stop before usage credits.** If your plan has extra usage turned on, Claude Code keeps going
past 100% of a window and bills it as usage credits: real money, and its prompt caches drop
to five minutes there. A stop rule near the end keeps you off them, for example
`{ "left": 2, "stop": true }`.

**You see what it does.** A toast says when a rule starts or stops. Line 2 says what's in force
(`guard: effort medium, agents sonnet`, `guard: stopped, 4% 5h left`, `guard paused 52m`). A
turn the guard changed says so on its closing line (`guard: effort medium, 1 agent on a
cheaper model`). `/g-line guard` says what's in force, `/g-line guard why` the figures behind
it, and the `/g-line` pane shows every rule as written. `/g-line guard off` turns your rules off until `/g-line guard on`.

![A real session under a simulated low window: a turn that started a background agent closes with "guard: effort low, 1 agent on a cheaper model"; the agent's report still reaches Claude; the next typed prompt is refused with "g-line guard stopped this prompt: 4% of the 5-hour window left (simulated; your rule: stop at 5%)", its reset time and the way past; line 2 reads "guard: stopped, 4% 5h left (sim)"](docs/guard.png)

**Try your rules without spending anything:** `/g-line guard simulate 5h 96` (or `week 90`)
makes the guard act as if that much of the window were used, for 15 minutes or until
`/g-line guard simulate off`. Line 2 marks it `(sim)`, a refusal says `simulated`, and only
the guard sees the made-up reading. With no usage readings at all (an API key, a cloud provider, or `claude -p` before
its first request), the rules can't act: `/g-line guard` says so, and a headless run logs it
once.

**Keep-warm** reads an idle conversation's prompt cache again before its hour runs out, so
your next prompt doesn't pay to rebuild it. It sends the conversation again with one short
question and no tools, through Claude Code (`$.model.fork`). Nothing is added to the
conversation. The re-read counts toward your usage like any cached read. Its limits:

- It runs only after `after` idle (45 minutes by default, 10 to 55), plus up to 3 minutes so
  sessions that went quiet together don't all run at once.
- It keeps only the session you last typed in on each account (`"sessions": "last"`, the
  default; `"all"` keeps every idle one). One session per account re-reads at a time.
- It runs at most `max` times per idle stretch (2 by default) and `per_hour` times an hour
  per account across the machine's sessions (6).
- It needs a cache of at least `min_context` (50k).
- It needs an hour-long cache. Past your plan's limit, on usage credits, Claude Code uses
  five-minute caches, so it stops there.
- It needs `min_left` percent of the 5-hour window left (20).
- It doesn't run while a stop rule is in force or the guard is paused.
- It skips a cache the conversation no longer has: after a compaction, a `/clear`, a model
  change, or an account change.
- It stands aside for a conversation Claude Code compacts on its own when idle (`idleCompaction`,
  at 200k tokens and up by default): that conversation gets summarised instead. Set
  `"idleCompaction": false` in Claude Code's settings to keep big conversations warm instead.

Each re-read is a toast (`Kept the cache warm: re-read 182k after 46 idle minutes (1 of 2,
$0.04)`), and line 2 shows `kept warm 2× · $0.08` until your next turn. The cost is the
session's own ledger before and after the re-read, left out when something else was running
then. The pane's day line adds `kept warm 3× ($0.12)`. A re-read that reads nothing, or writes
a tenth or more of what it reads, found no cache: keep-warm turns itself off for that session
and says so (`its re-read found no cache (read 28k, wrote 16k)`). So does a next turn that
rebuilds the cache anyway. That happens: in one test session on Claude Code 2.1.305 the fork
read only the cached tools and system prompt, not the conversation, and keep-warm stopped
after that one re-read. An Esc ends that idle stretch
for keep-warm. `"keep_warm": true` takes the defaults.

**Resume after a limit** (`"resume": true` in `guard`, off by default). When a turn ends on an
error while a usage window reads full, the limit stopped it. g-line always says so with the
reset on your clock. With `resume`, it also plans one prompt, `continue` (or your
`"resume": { "text": "...", "jitter": "5m" }`), for just after the reset plus up to 5 random
minutes, so sessions don't all start at once. You get a notification. Line 2 reads
`resumes 14:17`, and `/g-line guard cancel` drops it. One session per account holds the plan
(a lease in the plugin store); the others say so and wait for you. A prompt you type before
the reset, a `/clear`, or the session ending drops the plan, and at the reset nothing is sent
while the guard is off or paused or a turn is running; a toast says which. The prompt reaches
Claude as a message from the g-line plugin. g-line writes no handoff file.

When a model other than the one asked for answers a request (Claude Code fell back), the
turn's closing line says `answered by Sonnet 5.5`, guard or not.

g-line doesn't add its own "Claude is waiting" notifications: Claude Code already sends one
for each permission ask, and one after a minute of waiting for your input
(`messageIdleNotifThresholdMs`), through the same channel g-line would use. The roster's
`waiting` count is there for the sessions you aren't looking at.

## Privacy and what it runs

- **Reads:** the figures Claude Code hands every mod (usage, turns, tool calls and their
  results' success, subagents, compactions). It doesn't read the transcript file.
- **Keeps:** per session per day, numbers only (cost at API prices, turns, tool calls, cold
  rebuilds, agents) in Claude Code's plugin store, deleted after 35 days; your choices made
  with `/g-line`; when you last opened the news reader; with Pulse on, the last feed and
  which headlines it showed today; and, with `roster` on (the default), each running
  session's heartbeat (state, context, cache, model, and the `account_command` line only if
  you set one), cleared when the session ends.
- **Runs:** `git status` only with `git: true` or while the pane is open; your
  `account_command` only if you set one; `uname -s` once per session, to know whether a
  browser can open; `open` (or `xdg-open`) with a feed link when you ask the reader to open one.
- **Sends:** nothing, unless Pulse is on (one GET of a static file) or you enable
  `claude_reads` (the snapshot goes into your conversation). With keep-warm in your `guard`,
  Claude Code sends your conversation again, through its own client, to re-read the cache.
- **Changes:** nothing, unless you write `guard` rules: then a lower effort, a cheaper model
  for new subagents, a refused prompt, or with `resume` one prompt after a limit's reset, each
  as your rule says and each shown.
- **Writes:** a one-line timestamp at `~/.cache/glanceline/live/<session id>` so an older
  status line command can step aside, and with `export_state`, a JSON file for other bars.

## Upgrading from glanceline 0.3 or 0.4

glanceline is now g-line. The repository moved to `lifeofgurpreet/g-line` (the old address
redirects), and the plugin has a new name, so Claude Code treats it as a new plugin. An
installed glanceline updates to a small stub that keeps loading and tells you, once per
session, to switch:

```text
/plugin uninstall glanceline
/plugin install g-line --marketplace lifeofgurpreet/g-line
```

Your `~/.config/glanceline/config.json` keeps working. `/glanceline` still opens the pane until
the next release. The day and week totals start again under the new name. If you used the old
Python status line (`glanceline install`), run `glanceline uninstall` once to put your previous
`statusLine` back. g-line no longer ships that fallback.

## Develop

See [AGENTS.md](AGENTS.md): the rules g-line stands on, a map of the code, and recipes for
adding a figure or a receipt event.

```sh
claude --plugin-dir .        # a session with your working copy; saving reloads it
claude plugin validate .     # what the engine reads, the hooks and calls, what it would refuse
claude plugin test .         # the tests
```

The screenshots and the demo are real captures (`tmux capture-pane -e`), drawn by
`scripts/ansi2png.py` and cut by `scripts/frames.py`. `tools/pulse/` builds the Pulse feed on
the maintainer's machine; it isn't part of the mod.

## License

MIT
