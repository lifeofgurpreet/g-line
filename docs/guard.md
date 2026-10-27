# Guard: your rules for a low usage window

Everything else in g-line only watches. The guard acts, but only on rules you write, and it
says what it did. With no `guard` block in `~/.config/g-line/config.json` it does nothing.

Each rule names how much of a usage window is left (`left`, in percent; the 5-hour window
unless the rule says `"window": "week"`) and one thing to do from then on:

```json
{
  "account_command": ["my-account-tool", "--label"],
  "guard": {
    "rules": [
      { "left": 20, "effort": "medium" },
      { "left": 10, "agents": "sonnet" },
      { "left": 5, "stop": true, "unless_reset_within": "1h" },
      { "left": 10, "stop": true, "end_turn": true, "accounts": ["team@"], "hours": "09:00-17:00 mon-fri", "tz": "Europe/London" }
    ],
    "keep_warm": { "after": "45m", "max": 2, "min_context": "50k" }
  }
}
```

Read top to bottom:

1. At 20% left, the conversation runs at effort `medium`.
2. At 10%, new subagents start on Sonnet.
3. At 5%, new prompts stop, unless the window resets within the hour.
4. On a shared account (one whose `account_command` line contains `team@`), prompts stop at 10%
   during London office hours, and a turn running then ends too, so teammates keep some of the
   window.

## What a rule can do

- **`effort`** lowers the main conversation's effort, never raises it, and applies from the
  start of a turn to its end. On Opus 5.5, Sonnet 5.5, Haiku 5.5 and Fable 5.1 through the
  Claude API (an API key or a Claude subscription), Claude Code keeps the prompt cache when
  effort changes. Elsewhere (Bedrock, Vertex, Foundry, other models) a change of effort reads
  the whole conversation again, so the guard waits until the cache has gone cold, and line 2
  says `effort medium when cache cold`. The guard never switches the main model, since that
  always rebuilds the cache.
- **`agents`** starts new subagents on that model (`sonnet`, `haiku`, or a model id). It only
  moves an agent to a cheaper model: one already on Haiku stays there, and a fork keeps its
  parent's model. An agent type whose own definition picks its model (a plugin's agent, for
  example) is left alone until g-line has seen what it runs on. Running agents aren't touched.
- **`stop`** refuses a new prompt and says which window, how much is left and when it resets.
  That covers typed prompts and machine-started ones (a `/loop` or schedule waking up, a
  background task's notice). The one notice it lets through is the report of a background
  agent your conversation started, because that work is already done and paid for. A stop never
  stops a tool call. A slash command you type still goes through. The refusal is one line:

  ```text
  g-line held this: sam@example.com has 35% of its 5-hour window left; g-line keeps the last
  40% for its owner. Lifts at 13:00, in 3h 0m. Enter again sends it anyway.
  ```

  Claude Code puts the refused prompt back in the box, so **Enter again sends it anyway** (the
  same prompt, within three minutes; a loop's or schedule's prompt never gets this). A loop's
  prompt held again in the same hold gets just `g-line: still held, lifts about 13:00.`
- **`end_turn`** (with `stop`) also ends a turn that's already running when the rule starts
  during it. The turn ends between steps, before its next request, so every tool call the last
  response asked for has finished. A turn that began with the rule already in force (after
  `/g-line guard once`, a pause, a slash command or an agent's report) runs to its end. You get
  a toast, a notification and `guard: held` on line 2. Claude Code draws no closing line for a
  turn ended this way; type `continue` and press Enter twice to carry on. Without `end_turn`, a
  stop only refuses new prompts, so one long agentic turn can still run a window down.
- **`unless_reset_within`**: the rule waits while the window resets within that time. Times take
  `d`, `h`, `m` and `s` (`3d`, `72h`, `1h30m`).
- **`accounts`**: the rule applies only when the `account_command` line contains one of these
  words, in any case. With no account reading it doesn't apply, and with no `account_command`
  at all, g-line says so when the session starts and in `/g-line guard`.
- **`except_accounts`**: every account except those whose line contains one of these words
  (`["me@"]` for every shared account). With no account reading it doesn't apply either.
- **`hours`** (`09:00-17:00 mon-fri`, `22:00-06:00`, `9-17 sat,sun`) in **`tz`** (an IANA zone;
  the machine's own when left out).
- **`groups`**: the rule applies to every account in these groups (see [Account groups](#account-groups)).
- **`pace`**: a paced week or 5-hour window instead of `left` (see [Pace](#pace-a-week)).

A rule starts when the window falls to its threshold. It lets go when the window climbs 2
points past it, when the window resets, or when one of its conditions stops holding. A reading
taken before the window's reset counts for nothing. The percentages belong to the account, so
every session using it crosses a threshold at about the same time. With several stops in force,
the reason given is the one that started first, so it stays the same from one prompt to the
next.

A shared account runs out by the week as well as by the hour, so a reserve usually wants a
`"window": "week"` rule too, with no `hours`: a week drained overnight is still drained in the
morning.

**Stop before usage credits.** If your plan has extra usage turned on, Claude Code keeps going
past 100% of a window and bills it as usage credits, and its prompt caches drop to five minutes
there. A stop rule near the end keeps you off them: `{ "left": 2, "stop": true }`.

## Letting work through

| Command | Effect |
| --- | --- |
| Enter again | Sends the refused prompt anyway |
| `/g-line guard once` | Lets the next prompt through |
| `/g-line guard pause` | Lets everything through for an hour (or `pause 30m`) in every session on the machine |
| `/g-line guard resume` | Ends the pause |
| `/g-line guard off here` | Frees this session (your prompts, effort and agents run as you set them) until `/g-line guard on here` or the session ends |
| `/g-line guard off` | Turns your rules off until `/g-line guard on` |
| `/g-line guard cancel` | Drops a queued prompt or a planned resume |

## Pace a week

A rule that waits until the last 10% and then stops still lets a shared seat run dry by Friday,
because nothing slowed down on the way. A `pace` rule gives the week an allowance that opens up
as the week goes by, and steps in when the account has used more than that:

```json
{ "groups": ["team", "other"], "end_turn": true,
  "pace": { "reserve": 10, "burst": 8, "office": "09:00-18:00 mon-fri", "office_weight": 4, "tz": "Europe/London" } }
```

The week runs from seven days before the weekly reset the engine reports to that reset, so it
follows your plan's own week, not Monday. The allowance is `burst` percent from the first
minute, rising to `100 - reserve` percent by the reset. How fast it rises follows the clock: an
hour of `office` hours counts `office_weight` times an hour outside them. The example's week has
45 office hours and 123 others, 303 weighted hours, so by Monday 09:00 about 15% of the rise is
allowed, and by Friday 18:00 about 95%. Office hours are read in `tz`, daylight saving
included. With no `office`, the allowance rises in a straight line.

When the week's used percent plus `buffer` (2 points of slack for a coarse reading) passes the
allowance, the rule steps down, one step at each of `tiers` points ahead (`[0, 3, 6]`):

1. the conversation runs at `effort` (`medium`);
2. new subagents also run on `agents` (`sonnet`);
3. new prompts stop, and with `end_turn`, a running turn ends between steps.

Inside the `reserve` plus the buffer, it stops whatever the pace. Each step lets go 2 points
after it would have started, so it doesn't flicker, and only in the account and window it began
in. The refusal states the figures:

```text
g-line held this: sam@example.com is ahead of pace: 62% of the week used, 48% allowed by now,
so it lasts for the team. Lifts about Sun 12:00, in 2d 1h.
```

A `pace` rule takes the same `groups`, `accounts`, `except_accounts`, `hours` and
`unless_reset_within` as any other, and no `left`, `effort`, `agents` or `stop` of its own.
`reserve` is 0 to 50, `burst` 0 to `100 - reserve`, `office_weight` 0.1 to 20, and the `tiers`
rise.

**Pace a 5-hour window** with `"window": "5h"` on a `pace` rule. The allowance then rises from
`burst` to `100 - reserve` across the five hours before the 5-hour reset, so a seat isn't spent
in its first hour. With `hours`, it paces only then: in office hours a shared seat lasts the
day, and outside them it's yours to spend.

```json
{ "groups": ["team", "other"], "window": "5h", "hours": "09:00-18:00 mon-fri", "tz": "Europe/London",
  "end_turn": true, "pace": { "reserve": 10, "burst": 15, "tiers": [0, 5, 10] } }
```

**The end of the week is for using.** With `"drain": { "within": "48h", "left": 20 }` in
`guard` (or `"drain": true`), when the weekly reset is that close and that much is left, g-line
says so once per account and week, and line 2 reads `use it: 64% of the week left` while nothing
holds the account back:

```text
team@example.com has 64% of its week left, and it resets at Sun 05:00, in 1d 19h.
It's yours to use: g-line keeps only the last 2%.
```

A floor that loosens near the end pairs with it:

```json
{ "groups": ["team"], "window": "week", "left": 10, "stop": true, "unless_reset_within": "3d" },
{ "groups": ["team"], "window": "week", "left": 2, "stop": true }
```

## Account groups

Rules can name groups of accounts instead of listing accounts, so you bucket your accounts once
and give each bucket its rules. An account belongs to the first group, in the order written,
whose words its `account_command` line contains, and to `other` when it's in none:

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

A group is a list of words, or `{ "accounts": [...], "for": "..." }`, where `for` names who the
reserve is kept for in the refusal (`g-line keeps the last 40% of it for its owner`). Line 2
names the group (`guard: people reserve, 35% 5h left till 13:00`), and the `/g-line` pane lists
the groups with the session's own marked. Change a group's rules and every account in it
follows.

## Queue a held prompt

With `"queue": true` in `guard`, g-line keeps a refused prompt and sends it itself as soon as the
guard lets go: when the window resets, or when a rule's hours end. The refusal says when (`g-line
will send it when the guard lets it through, about 08:21`), line 2 adds `1 queued`, and
`/g-line guard cancel` keeps it from going.

If the prompt cache would lapse before then, g-line re-reads it once, a few minutes before it
would, so the prompt lands on a warm cache. It does this at most twice, and only with room left
in the window; a window that's used up can't be read from, and the refusal then says the cache
will be cold. Enter again still sends the prompt straight away. A prompt you type that goes
through, `/clear`, an account change, or a stop that comes back for a different window drops
the queued one. `/g-line guard once` and Enter again each apply to the account and window the
prompt was held in, and lapse if either has changed.

## Keep-warm

Keep-warm reads an idle conversation's prompt cache again before its hour runs out, so your next
prompt doesn't pay to rebuild it. Claude Code sends the conversation again with one short
question and no tools (`$.model.fork`); nothing is added to the conversation. The re-read
counts toward your usage like any cached read. `"keep_warm": true` takes the defaults. Its
limits:

- It runs only after `after` idle (45 minutes by default, 10 to 55), plus up to 3 minutes so
  sessions that went quiet together don't all run at once.
- `"sessions": "last"` (the default) keeps only the session you last typed in on each account;
  `"all"` keeps every idle one. One session per account re-reads at a time.
- It runs at most `max` times per idle stretch (2 by default), and `per_hour` times an hour per
  account across the machine's sessions (6).
- It needs a cache of at least `min_context` (50k), an hour-long cache, and `min_left` percent of
  the 5-hour window left (20). A window that has reset since its last reading counts as full,
  and no reading yet (or an account without a 5-hour window) doesn't hold it back. Past your
  plan's limit, on usage credits, Claude Code uses five-minute caches, so it stops there.
- While a stop is in force, it keeps re-reading if the stop lifts within the re-reads it has
  left (`max` of them, about an hour each), and stands aside for a longer hold. A guard pause or
  `off here` lets your prompts through and leaves keep-warm running, since it holds nothing
  back; `/g-line guard off` stops it too.
- It skips a cache the conversation no longer has: after a compaction, a `/clear`, a model
  change or an account change.
- It stands aside for a conversation Claude Code will compact on its own when idle
  (`idleCompaction`, at 200k tokens and up by default). Claude Code turns idle compaction on per
  account, so keep-warm counts on it only once a session on the same account has been seen
  compacting while idle in the last 14 days; until then big conversations are kept warm too.
  A conversation emptied while idle, or shrunk after you typed `/clear`, `/compact`, `/rewind`
  or `/resume`, is yours, not idle compaction, and isn't counted (before 0.20 it was, so 0.20
  drops older sightings). A
  sighting on one account says nothing about another on the same machine. If a big conversation
  then sits idle a full hour and its cache lapses with nothing compacting it, the sighting is
  dropped and keep-warm covers that account's big conversations again, with a toast saying so. Set
  `"idleCompaction": false` in Claude Code's settings to keep them warm regardless.
- A resumed conversation waits for its first request: before it, Claude Code has nothing to send
  again.

The first re-read of an idle stretch is a toast (`◆ cache kept warm · 182k re-read after 46m
idle · $0.04`), and line 2 shows `kept warm 2× · $0.08` until your next turn. The cost comes
from the session's own ledger before and after the re-read, and is left out when something
else was running then. The pane's day line adds `kept warm 3× ($0.12)`.

A re-read that gets no answer at all (an API error, an empty reply) says nothing about the
cache, so it's tried again on the next beats, up to three times a stretch. A re-read that reads
nothing, or writes a tenth or more of what it reads, found no cache: that ends the stretch. So
does a next turn that rebuilds the cache anyway, unless a model or account change explains it.
The second time in a session the kept cache turns out gone, keep-warm turns itself off for that
session and says so (`◆ keep-warm off in this session · twice the kept cache was gone`). In one
test session on Claude Code 2.1.305 the fork read only the cached tools and system prompt, not
the conversation. Pressing Esc ends that idle stretch for keep-warm.

When a cache goes cold anyway, the turn's receipt says why keep-warm didn't keep it, from what it
saw while you were away: `cache cold · rebuilt 412k · 5h window low`, `out of re-reads`,
`left to idle compaction`, `keep-warm stopped here`, or `the machine slept` (no beat reached
keep-warm for over ten minutes: a laptop asleep, a stalled process). The dashboard's history
counts the week's cold rebuilds by those reasons.

## Resume after a limit

When a turn ends on an error while a usage window reads full, the limit stopped it, and g-line
says so with the reset on your clock. With `"resume": true` in `guard` (off by default), it also
plans one prompt, `continue` (or your `"resume": { "text": "...", "jitter": "5m" }`), for just
after the reset plus up to 5 random minutes, so sessions don't all start at once. You get a
notification, line 2 reads `resumes 14:17`, and `/g-line guard cancel` drops it.

One session per account holds the plan (a lease in the plugin store); the others say so and
wait for you. A prompt you type before the reset, a `/clear`, or the session ending drops the
plan. At the reset nothing is sent while the guard is off or paused or a turn is running, and a
toast says which. The prompt reaches Claude as a message from the g-line plugin. g-line writes
no handoff file.

## Seeing what it does

- A toast when a rule starts or stops.
- Line 2 says what's in force: `guard: effort medium, agents sonnet`, `guard: stopped, 4% 5h
  left`, `guard paused 52m`. The model shows the effort you set next to the one that ran (`Opus
  5.5 xhigh→medium by guard`, in amber).
- A turn the guard changed says so on its closing line (`guard: effort medium, 1 agent on a
  cheaper model`).
- `/g-line guard` says what's in force; `/g-line guard why` adds the figures behind it: the
  weekly and 5-hour readings, this account's group, each rule's state (for a pace rule, the used
  percent against what's allowed now and which step is in force), and about when the hold lifts.
  The `/g-line` pane shows every rule as written.

When a model other than the one asked for answers a request (Claude Code fell back), the turn's
closing line says `answered by Sonnet 5.5`, guard or not.

![A real session under a simulated low window: a turn that started a background agent closes with "guard: effort low, 1 agent on a cheaper model"; the agent's report still reaches Claude; the next typed prompt is refused with "g-line guard stopped this prompt: 4% of the 5-hour window left (simulated; your rule: stop at 5%)", its reset time and the way past; line 2 reads "guard: stopped, 4% 5h left (sim)"](guard.png)

## Try your rules without spending anything

`/g-line guard simulate 5h 96` (or `week 90`) makes the guard act as if that much of the window
were used, for 15 minutes or until `/g-line guard simulate off`. Line 2 marks it `(sim)`, a
refusal says `simulated`, and only the guard sees the made-up reading.

With no usage readings at all (an API key, a cloud provider, or `claude -p` before its first
request), the rules can't act: `/g-line guard` says so, and a headless run logs it once.

## Changing the rules

Every rule lives in `~/.config/g-line/config.json` under `guard`. Edit it and running sessions
follow within 30 seconds. A mistake is named in a toast and that rule is left out, never
half-applied.

## Usage from other machines

The guard acts on the usage windows the engine reports to this session. To act on usage spent
on the same account elsewhere, give g-line a `usage_command`: a command of yours that prints the
account's 5-hour and weekly usage as one line of JSON. See
[Configuration](configuration.md#usage_command).
