# Changelog

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
