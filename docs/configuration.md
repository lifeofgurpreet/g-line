# Configuration

`/g-line settings` changes every on/off and layout choice without editing a file: press a
setting's key and it flips at once, in this session and every other open one. `/config` lists
six: **Layout** (`2`, `1` or `receipts`), **One-line preset**, **Icons**, **Heads-up toasts**,
**Native notifications** and **Turn receipt**.

To set them for every session on a machine, or every machine you manage, write
`~/.config/g-line/config.json` (or put it under `$XDG_CONFIG_HOME`). Running sessions read it
again within 15 seconds of an edit. Layers, lowest first: defaults, `config.json`, `/config`,
then choices made with `/g-line`.

```json
{
  "lines": 2,
  "git": true,
  "notify": { "cache": true, "reset": true, "long_turn": true },
  "today_budget": 50
}
```

The same from the prompt: `/g-line set pulse on`, `/g-line set receipt short`,
`/g-line toggle git`, `/g-line reset pulse` (back to what your files say), `/g-line reset` (all of
them) and `/g-line set all on`. Names are forgiving: `cold cache`, `cache` and `notify.cache` are
the same setting.

## Settings

| Key | Values | Default |
| --- | --- | --- |
| `lines` | `2`, `1`, or `receipts` (receipts, spinner and heads-ups only) | `2` |
| `receipt` | `adaptive`, `short` (cost, cache, tools), `full`, `off`, or a list of `cost`, `cache`, `context`, `tools`, `agents`, `output` | `adaptive` |
| `pulse` | `true` fetches the headline feed (see [Pulse](pulse.md)) | `false` |
| `pulse_speed` | `normal` (every 8 s), `slow` (every 40 s), `paused` | `normal` |
| `pulse_mute` | Sources Pulse's row and spinner skip, matched within the source in any case: `["𝕏"]` skips every post on 𝕏, `["@someone", "Hacker News"]` one account and one site | `[]` |
| `git` | `true` puts your branch on line 2; g-line then runs `git status` in your project | `false` |
| `notify` | `true`, `false`, or per kind: `cache`, `reset`, `long_turn` (a turn longer than `long_turn_seconds` finished), `agents` (a background agent finished) | `cache` and `reset` on |
| `toasts` | `true`, `false`: g-line's own heads-ups. Each is a line or two, stays about as long as it takes to read (3 to 9 seconds), and the same one isn't repeated within ten minutes. Guard changes and answers to your commands always show | `true` |
| `spinner` | `true`, `false`: the burn on the spinner | `true` |
| `tool_streak` | Failures in a row of the same call before the toast; `0` turns it off | `3` |
| `today_budget` | Dollars at API prices; today's total across sessions joins line 2, and a toast says when you pass it | none |
| `coach` | `true` offers `/effort` or `/model` for Tab to take when the 5-hour window is on pace to run out, and `/compact keep ` before a compaction. It never changes anything itself | `false` |
| `claude_reads` | `true` gives Claude a `status` tool to read these figures when you ask it to (see below) | `false` |
| `footer_labels` | `true`, `false`: agents and compaction in the footer (one-line layout) | `true` |
| `short_hints` | `true` draws `(shift+tab to cycle)` as `⇧⇥` | `true` |
| `export_state` | `true` writes the figures as JSON under `~/.cache/g-line/state/` for tmux and other bars | `false` |
| `roster` | `true` keeps a heartbeat of each g-line session on this machine in Claude Code's plugin store: whether it's working, waiting on you or idle, its context, cache and model, and the `account_command` line when you set one. Line 2 counts the others, and the pane and the dashboard list them. `false` writes and shows nothing | `true` |
| `guard` | Your rules for a low usage window, and keep-warm (see [Guard](guard.md)). With none, g-line changes nothing | none |
| `tz` | Your time zone (an IANA name such as `Europe/London`) for every time g-line shows: resets, projections, receipts, the guard's words. Useful on a machine in another zone, over SSH. `auto` is the machine's own. The pane says which zone the times are in | `auto` |
| `account_command` | A command of yours, as a list of words, whose first line names the account (see below). Off unless set | none |
| `usage_command` | A command of yours that prints the account's usage (see below). Only with an `account_command` | none |
| `reset_threshold`, `long_turn_seconds`, `cache_ttl`, `icons`, `segments`, `preset` | See `hooks/settings.ts` | |

`~/.config/glanceline/config.json` from 0.4 is still read; `g-line/config.json` wins.

## account_command

g-line can't see which account a session runs on: Claude Code doesn't hand that to mods. If you
switch accounts with a tool of your own, give g-line a command that prints the account:

```json
{ "account_command": ["my-account-tool", "--label"] }
```

g-line runs it when the session starts and every ten minutes after (more often when guard rules
name accounts), with a 5-second limit, and shows its first line on line 2. A leading `account` and a trailing note in parentheses are dropped for display, so
`account you@example.com (via my-accounts)` reads `you@example.com`. With it set:

- an account change shows as `cache cold (account changed)`, because prompt caches are kept per
  organization, and the next turn closes with `cache cold after account change · rebuilt 120k`;
- sessions on the same account share their usage readings, so an idle terminal shows what a
  busy one just spent;
- guard rules can name accounts and groups ([Guard](guard.md)).

Without an `account_command`, g-line can't see a switch, and it never shows an account.

## usage_command

A command of yours, as a list of words, that prints the account's 5-hour and weekly usage as one
line of JSON:

```json
{"five_hour":{"used_percentage":42,"resets_at":"2026-10-23T12:00:00Z"},"seven_day":{"used_percentage":70,"resets_at":"2026-10-27T00:00:00Z"}}
```

g-line runs it about every 2 minutes (5-second limit), only with an `account_command`, so usage
spent in a session on another machine shows here and the guard acts on it. Failures and other
output change nothing. g-line makes no network call itself; whatever the command fetches is its
own doing.

Within one window, the newest reading wins: this session's own (as of its last response),
another session's on the same account, or the command's. If your command's source lags, add
when each figure was read, `"observed_at":"2026-10-23T11:42:00Z"`, inside the window's object;
without it, a reading counts as taken when the command ran.

## Let Claude read the figures (opt-in, experimental)

With `claude_reads: true`, g-line registers a tool, `status`, that returns a small JSON
snapshot: context used and the room before auto-compact (when Claude Code reports it), the
usage windows with projected run-out times, and the cache's estimated expiry, each with its
scope. Unknown figures are `null`, and it gives no advice. Its description tells Claude to use
it when you ask, and not to change model, effort or compaction on its own.

The result enters the conversation like any tool result, so it goes to your model provider with
the rest of the conversation. The tool is deferred only where tool search is available.
