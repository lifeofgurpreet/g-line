# Changelog

## 0.6.4 (2026-10-19): the cache line knows about compaction

- After a compaction the cache line reads `compacted, next turn caches 31k`: the size of the
  summary the next turn writes. It used to keep timing the old conversation and, an hour
  later, warned `cache cold, next turn rebuilds 204k` about a conversation that was no longer
  there. This matters most with Claude Code's idle compaction, which summarises a long
  conversation shortly before an hour-long cache expires.
- A compaction counts even when no compaction event reaches the mod: if Claude Code's
  context count falls below half of the last request with no request in between, the cache
  line treats it as one.
- The heads-up before an hour-long cache goes cold says, when idle compaction covers the
  conversation, that Claude Code compacts it to a summary if you don't reply, instead of
  saying the next turn rebuilds it all. It reads `"idleCompaction"` from settings and
  `CLAUDE_CODE_IDLE_COMPACT_MIN_TOKENS` (200k unset), as Claude Code does.
- `/clear` forgets the cleared conversation's cache instead of counting it down.
- The `status` tool reports the cache state `compacted` in that case.

## 0.6.3 (2026-10-19): one headline at a time, on one row

- With a footer, Pulse's headline shows only on its row under the prompt. The spinner no
  longer carries a second, different headline at the same time; it does so only in the
  receipts-only layout, where there is no row.
- The row's headline is a link only in terminals known to draw OSC 8 links (Ghostty, iTerm2,
  WezTerm, VS Code) and not inside tmux. Elsewhere Claude Code prints a link's whole address
  after its text, which pushed the row onto a second line; there the headline is plain text,
  and `/g-line open` opens it.

## 0.6.2 (2026-10-19): headlines with emoji stay on one row

- Feed text is measured in terminal columns, not characters: an emoji or an East Asian wide
  character counts two. A post starting with 🚀 used to run one column over and wrap Pulse's
  row under the prompt onto a second line. The spinner and the reader now cut such headlines
  in the right place too.
- Variation selectors are dropped from feed text, so a symbol such as ❤ draws in its
  one-column form.
- The README shows the settings manager, the news reader and Pulse's row under the prompt,
  captured from a real session; screenshots draw emoji in colour, two columns wide.

## 0.6.1 (2026-10-16): the reader reads like a front page

- `/g-line news` keeps the feed's own order, best first, instead of re-sorting by time; items
  since your last look are still marked new.
- The picked item shows the story a post on 𝕏 is about (`↳ …`), Hacker News points (`▲ 290`)
  and a link to the comments (`d` opens them), and a publisher's name with who found it
  (`Reuters via Techmeme`). A headline the text doesn't repeat is shown above it.
- The key row wraps instead of running off a narrow pane.

## 0.6.0 (2026-10-16): a settings manager, a news reader, and Pulse you can see

- **`/g-line settings`.** Every setting on one screen: its key, its value, where the value
  comes from (`default`, `config.json`, `/config`, `your choice`) and a `•` where it differs
  from a fresh install. One key flips it. `/g-line set <name> on|off`, `/g-line toggle <name>`,
  `/g-line reset [name]` and `/g-line set all on` do the same from the prompt.
- **Everything applies at once, everywhere.** A change made in the pane or by command takes
  effect in the running session and reaches every other open session within 15 seconds, and
  so does an edit to `~/.config/g-line/config.json`: no restart. Turning on `claude_reads`
  registers the `status` tool for your next message; turning it off makes the tool answer
  that it's off (Claude Code can't take a tool back mid-session, so it's gone from the next
  session).
- **Pulse under the prompt.** With Pulse on, a dim row under line 2 shows one headline at a
  time, `𝕏 @handle · 2h:` first, moving on every 8 seconds, and the headline is a link
  (cmd-click). Turning Pulse on shows it within seconds. `/g-line open` opens the one showing.
- **`/g-line news`, the reader.** Every item, the picked one in full with its author, age,
  likes and link; `j`/`k`, `o`, `c`, `r`, `q`; items since your last look marked new. The
  feed's new optional fields are read when present: 0.5 readers ignore them, and 0.6 falls
  back to the title.
- **Borrowed, with thanks.** One table drives every setting, its toggle, its command name and
  its docs, like starship's per-module config; `/g-line toggle` is `starship toggle`. Showing
  where each value comes from is `git config --show-origin`; the `•` and per-setting reset are
  VS Code's "Modified" marker and "Reset Setting". Instant apply and the line itself as the
  preview come from ccstatusline's and p10k's live configurators, without their wizard; the
  hot reload of the config file is starship reading its config on every prompt. The reader's
  `j`/`k`/`o`/`r`/`q`, the expanded picked item and "new since last look" are newsboat's and
  circumflex's, in a pane that sizes itself to the room it gets.

## 0.5.2 (2026-10-16): posts on 𝕏 from the last hours, not the last week

- **Fresh posts on 𝕏.** Pulse now finds posts through the links Techmeme's front page and AI
  subreddits carry, as well as the Internet Archive, so they can be minutes old. A post has to
  be about AI itself, and either under 2 hours old, or gaining about 30 likes an hour (up to a
  day), or past 3,000 likes (up to 3 days). The strongest lead; two of the five slots go to the
  newest, so a quiet hour's posts aren't crowded out. At most two per story or author.
- **Every post shows its age:** `𝕏 @AnthropicAI · 3h:`, `· 40m`, `· 2d`.
- The feed rebuilds every 30 minutes.

## 0.5.1 (2026-10-15): posts on 𝕏 in Pulse

- **Pulse carries posts on 𝕏.** The feed now picks the best recent posts from @claudeai,
  @AnthropicAI and the Claude Code team (most likes, discounted by age; replies left out).
  On the spinner and in the pane they lead with the author, and with their age once a day
  old: `𝕏 @claudeai · 2d: Claude Dashboards and Claude Motion are in beta today…`. No X API
  key is involved; the feed finds posts through X's public embed pages and the Internet
  Archive's index, so it can trail X by a few days.
- **Maintainer picks can be just a link.** An X post's URL in `curated.json` is enough; the
  author and text are filled in.
- Anthropic news titles no longer end in "| Anthropic".

## 0.5.0 (2026-10-14): glanceline is now g-line

Live status, and receipts on the turns. A mod only.

- **New name.** The plugin, the marketplace and the command are now `g-line`
  (`/plugin install g-line --marketplace lifeofgurpreet/g-line`). The repository moved to
  `lifeofgurpreet/g-line`, and GitHub redirects the old address. `/glanceline` still answers
  for this release, and `~/.config/glanceline/config.json` is still read. Day and week totals
  start again under the new name. See the README's upgrade section.
- **Two lines under the prompt (the new default).** Line 1, at the end of Claude Code's hint
  line, holds the gauges (`ctx 13% · 5h 1% · wk 79%!`). Line 2, g-line's own coloured row,
  holds the model and its **effort**, the **cache countdown** (back on screen, now `~59m`
  because it's an estimate), and what happens next (`wk out ~Thu 19:00, resets Fri 16:00`;
  projections are rounded). What line 1 can't fit moves to line 2 rather than vanishing. The
  footer labels (agents, compaction) move onto line 2. `lines: 1` keeps everything on the hint
  line, with `(shift+tab to cycle)` shortened to `⇧⇥` to make room. `lines: receipts` draws no
  footer at all, for people who keep another status line.
- **Receipts can say two things.** A turn whose first request rebuilt a cold cache says so
  (`cache cold · rebuilt 42k · API $0.31` in the demo), and when it also grew the context a
  lot, both facts show, for example `cache cold · rebuilt 42k · +45k context`.
- **The spinner shows the burn.** `3 tools · +4.1k ctx · 5h 74%` while a turn runs. Once calls
  keep failing, it leads with the tool and file: `⚠ 3× Edit failures on core.ts`. The toast
  says the same.
- **Pulse (opt-in).** `/g-line pulse` shows AI-dev headlines on turns that run past 15
  seconds, after the burn, and lists five in the pane with links. It's one static file from
  the repository's `pulse` branch, fetched at most every 45 minutes, with nothing sent.
  Headline text is cleaned of escape and control characters, and there's a five-second
  timeout. Off by default, so g-line makes no network requests unless you turn it on.
- **Settings in the pane.** Buttons for the layout, notifications, Pulse and the receipt style.
  Choices stick across sessions.
- **The cache heads-up says what's at stake.** `Claude cache goes cold in 5m (148k of context at
  risk)`.
- **Claude can read the figures, if you let it** (`claude_reads: true`, off by default). A
  `status` tool returns a JSON snapshot with scope and basis, `null` for anything unknown, and
  no advice.
- **No fallback.** The Python `statusLine` script (`glanceline.py`, `install.sh`) is gone;
  g-line is a mod. If you installed the old script, `glanceline uninstall` restores your
  previous `statusLine`.
- Commands answer through toasts and put nothing into the conversation (Claude reads a
  command's text). `today $` leaves the default line (it shows with `today_budget`). The
  window's headroom leaves line 1, because it isn't the room before auto-compact.
- glanceline 0.3/0.4 installs update to a stub (`legacy/glanceline`) that keeps loading and says how to switch, instead of failing with "Plugin glanceline not found".
- `AGENTS.md`, `.claude/CLAUDE.md` and a project skill (`.claude/skills/g-line-dev`) explain
  the mod API surfaces g-line uses, so an agent can extend it without inventing old
  `statusLine` APIs.

## 0.4.0 (2026-10-14)

The receipt flags the turn worth noticing. Still not one extra row.

- **Adaptive receipts** (the new default, `receipt: adaptive`). An ordinary turn closes
  with two quiet facts (`· API $0.13 · cache read 82%`). A turn that did something unusual
  leads with it, bold and in colour: `+86k context` (at least 8k tokens, or 2% of the
  window), `cache write 84k` (a large cache write the context's growth doesn't explain),
  `3 failed Bash calls`, `compacted 182k → 31k`, or `API $1.42 · 4x recent` (three times the
  median of the last attributable turns and 20 cents more). Each receipt is fixed when the
  turn closes. `short`, `full` and field lists still work, worded the same way.
- **Honest dollars.** When a background agent overlaps a turn, the session's cost growth
  isn't the turn's alone, so the receipt and spinner leave the dollar figure out. Costs read
  `API $0.75`. The share card's cache figure is now weighted by tokens over the whole session
  instead of an average of turn percentages. A cold-cache rebuild is recorded on its own
  turn, so a later turn can't take it.
- **A quieter, smarter hint line.** The default layout drops the git branch (add `git` to
  `segments` to keep it; glanceline then runs `git status` only when the branch is shown or
  the pane is open). A warm prompt cache stays off the line until under 15 minutes are left;
  `full` always shows it. `context` reads `ctx`, and "on track" is gone.
- **What warns survives a narrow terminal.** A pace warning reads `5h 72% ! out ~10:03` (the
  `!` and `~` work without colour, as the line is drawn dim), keeps its words while calm
  segments narrow, and outlasts them, the model name first. The hint line now keeps room for
  Claude Code's `⏸ manual mode on` label, so the engine no longer cuts the line's end.
- **The spinner** says when a tool keeps failing: `· 5 tools · 2 failed Bash`.
- **Quieter by default.** The pace coach and the `/compact` suggestion are off by default
  (`coach: true` brings them back). `/glanceline off` now silences toasts, notifications and
  suggestions too, not just the line. The compaction forecast says `compacts soon` instead
  of promising the next turn.
- `scripts/frames.py` records a tmux pane as timed frames and cuts them into the MP4 and GIF
  in the README, from real captures. New screenshots throughout.

## 0.3.0 (2026-10-13)

Everything new rides on lines Claude Code already draws, so the screen still gains no row.

- **A receipt for every turn.** The line that closes each turn (`Baked for 1m 4s`) adds what
  the turn cost at API prices, how much the prompt cache served and how many tools it ran
  (`receipt`: `short`, `full`, `off` or a field list; a `/config` row too).
- **Native notifications** through your own notification channel: five minutes before a
  one-hour cache goes cold, and when a usage window resets after you passed 80% of it. A
  long turn finishing and a background agent finishing can notify too (off by default).
  Where no channel takes it, the heads-up is a toast.
- **Agents in the footer.** `agents 2 running` joins the footer's mode labels while
  subagents or teammates are at work, from Claude Code's own agent list. A background agent
  that fails raises a toast. The pane lists each agent with its type, model, status and age.
- **Compaction forecast and log.** `compacts in ~3 turns` in the footer once the context
  passes 60% of the auto-compact threshold; a toast two turns out suggests `/compact` with a
  note (Tab starts it); each compaction is logged with its before and after size.
- **Spinner progress**: the running turn's cost so far, tools and agents.
- **Context breakdown** in the pane, counted locally like `/context`, naming MCP servers
  whose tool definitions take room but went unused this session.
- **Today and this week across sessions**, kept in the mod's own store (numbers only), with a
  seven-day sparkline in the pane, an optional `today` segment and a `today_budget`.
- **`/glanceline card`**: a share card of the session with a Copy as text button. It leaves
  out repository, branch, paths and account.
- **Repeated-failure warning**: one toast when the same tool call fails three times in a row
  (`tool_streak`). Tool calls are observed only, never gated or rewritten.
- **Pace coach**: when the 5-hour window is on pace to run out, the toast says how much
  slower would last until the reset and offers `/effort` or `/model` for Tab to take. It
  never changes the model or effort itself.
- `export_state` writes the figures as JSON for tmux, sketchybar and other bars (off by
  default). Usage windows of kinds glanceline doesn't know yet are listed in the pane.
- After `/clear` the line refills at once instead of waiting for the next response.
- The account (`account_command`) stays off unless configured, as before.

## 0.2.0 (2026-10-13)

- **One line under the prompt, no extra rows.** The band above the prompt is gone. The
  figures now ride at the end of Claude Code's own hint line under the prompt (the
  `PromptHint` site's `tail`), after the permission mode, so the mode label and the
  engine's pills stay live. Everything fits one line: segments narrow together and the
  least important drop first, measured against the room the hint leaves. The `[-]`
  collapse control and the blank spacer row went with the band.
- **The account folds into the line.** `account_command`'s output is the last segment,
  shortened to the address (`account you@example.com (via CAAM)` reads `you@example.com`),
  and drops before the limits on narrow terminals. It stays off unless configured.
- **The fallback steps aside reliably.** The mod keeps `~/.cache/glanceline/live/<session
  id>` fresh every 15 s, and `glanceline.py` prints nothing while that file is under a
  minute old. The old `GLANCELINE_MOD` environment variable never reached the status line
  process, so both used to draw.
- `/glanceline off` and `on` hide and show the line. Toasts and the details pane are unchanged.

## 0.1.0 (2026-10-12)

First release.

- **The mod**: a live band above the prompt (one line under it since 0.2.0) with model and effort, context left, the
  5-hour and weekly windows with a pace projection (`5h 72%, out at 10:03`), gateway spend,
  a prompt cache countdown and the git branch. It updates from Claude Code's pushed usage
  figures, with no polling.
- **Heads-up toasts** before the prompt cache goes cold and when a usage window is on pace
  to run out before it resets. Each one fires once.
- **`/glanceline`** opens a details pane. `/glanceline off` and `on` hide and show the band.
- Presets `minimal`, `default` and `full`, a custom `segments` layout, Nerd Font icons, and
  an `account_command` plug-in line.
- Width-aware layout: every segment has a wide, medium and short form, and the least
  important segments drop first.
- **The status line fallback** (`glanceline.py`): the same segments for any Claude Code
  version, using only the Python 3.8+ standard library. `install` changes only the
  `statusLine` key, after a backup. `uninstall` restores the previous value, byte for byte
  when nothing else changed. The fallback steps aside while the mod draws the same session.
- One golden file (`tests/cases.ts`) keeps the mod and the fallback in agreement.
