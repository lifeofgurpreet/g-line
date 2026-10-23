# Working on g-line

g-line is a Claude Code **mod**: a plugin whose TypeScript hooks run inside Claude Code
(2.1.293 or later) and draw onto Claude Code's own lines. It isn't a `statusLine` command,
and it has no fallback script. Read this file before changing anything. It's written for
coding agents and for people.

## The rules the product stands on

1. **Never above the prompt, never more than two lines** (plus Pulse's one row, only while
   the person has Pulse on). Line 1 is the tail of Claude Code's own hint line. Line 2 is one
   row the mod draws directly under it (`lines: 2`, the default). With `lines: 1` it's the
   hint line alone; with `lines: receipts`, no footer at all. Never draw in `AbovePrompt`,
   and never open a pane the person didn't ask for.
2. **Write on the line where the thing happened.** A turn's facts go on that turn's closing
   line (`TurnDuration`). The running turn's facts go on the spinner. Agents and compaction
   go on line 2 (or the footer labels in the one-line layout).
3. **Engine figures only.** Everything comes from what Claude Code hands mods:
   `$.session.usage()`, `session.measure`, `turn.step`, `turn.complete`, `tool.call`,
   `agent.spawn`, `$.agent.list()`, `session.compact` and, while idle, the length of
   `$.session.messages({ as: "api" })` (a managed plugin can send compaction events on past
   user plugins). Sessions on one machine and one account share those readings through the
   plugin store (`mergeLimits`: the higher percent in a window, the later window across a reset).
   Never parse the transcript, never
   estimate what the engine reports, never make a network call of its own, never write into the system
   prompt. The one network request the mod makes is Pulse's GET of a static file, and only when the person
   turns Pulse on. The person's own `usage_command` (opt-in, like `account_command`, and only with
   one) is a command they chose, run through `$.process.run` about every two minutes; it may reach
   a network, but that is their command's doing, never the mod's. Its readings merge with
   `mergeLimits`, so they can raise a figure and never lower one in the same window. Keep-warm's re-read (rule 5's guard) is Claude Code's own request through
   `$.model.fork`, made only when the person configured it.
4. **Private by default.** No account, email, branch, path or repository name shows unless
   configured (`account_command`, `git: true`). The share card leaves all of them out.
   Notifications don't carry agent descriptions unless `notify.agents` is on.
5. **Observe; steer only by the person's own rules, and say so.** Tool calls are observed
   (`await next(e)`), never gated or rewritten. The coach only suggests (`prompt.suggest`),
   and it's off by default. The `status` tool Claude can call (opt-in) is read-only and
   returns no advice. Commands answer with toasts and return `{}`, because Claude reads a
   command's text. The one exception is the **guard** (`hooks/guard.ts`). It acts only on
   rules the person wrote under `guard` in config.json, and with none it does nothing. It
   may lower the main conversation's effort for a whole turn (`turn.step`), start new
   subagents on a cheaper model (`agent.spawn`), refuse a prompt that would start a turn
   (`prompt.submit`; a `pace` rule steps through effort, cheaper agents and a stop by how far the week runs ahead of its allowance), with `end_turn`, end a running main-loop turn between steps, before its next
   request (`$.turn.abort`), re-read an idle cache (`$.model.fork`), and, with `resume`, send one
   prompt after a usage limit's reset (`$.prompt.submit`, one session per account). It never touches a tool
   call, a turn mid-step (`end_turn` waits for the step boundary and only a rule the person
   marked so), the main model or the system prompt, and it never raises a cost.
   Everything it does is said: a toast when a rule starts or stops, line 2 while one is in
   force, the turn's receipt, and `/g-line guard`. A new guard action needs all four, and a
   test that it does nothing without a rule.
6. **Say what's known.** A projection reads `~`. A cost overlapped by background agents is left
   out, not guessed. A receipt states observations (`cache write 84k`), not causes.

## Map

| File | What it holds |
| --- | --- |
| `.claude-plugin/plugin.json` | Manifest: name, version, `userConfig` (the `/config` rows), `types` |
| `.claude-plugin/marketplace.json` | Makes this repository its own marketplace: `/plugin install g-line --marketplace lifeofgurpreet/g-line` |
| `hooks/hooks.json` | `{ "modules": ["./register.tsx"] }` |
| `hooks/register.tsx` | The only file that touches `$`: config, events, drawing, the pane, commands, Pulse fetching, the `status` tool |
| `hooks/core.ts` | Pure: segments, widths, fitting (`fit`), pace, alerts, model names |
| `hooks/deck.ts` | Pure: the two-line layout (`lineNow`, `lineNext`, `deck`) |
| `hooks/inline.ts` | Pure: the one-line layout, the hint's room, the shortened standing hints |
| `hooks/extras.ts` | Pure: receipts (adaptive and fixed), agents, compaction forecast, the day ledger, the card, the coach |
| `hooks/glance.ts` | Pure: the `status` tool's JSON snapshot |
| `hooks/settings.ts` | Pure: the settings table (`SETTINGS`), defaults, `merge`, origins, and `/g-line`'s argument parser. Add a setting here and it gets a toggle, a command name and an origin |
| `hooks/guard.ts` | Pure: the guard's rules (`parseGuard`, `evaluate` with thresholds, paced weeks (`pace`, `paceRead`, `paceCalendar`), hysteresis, accounts, hours, `whyLines`, `epochOf`), what it may change (`cappedEffort`, `agentModel`), what it says, `simulated` readings, and keep-warm's limits (`warmDue`, `readBack`, the per-account lease) |
| `hooks/roster.ts` | Pure: the other sessions on this machine from their heartbeats in the store (`rosterOf`), line 2's `2 others · 1 waiting`, the pane's rows |
| `hooks/pulse.ts` | Pure: Pulse feed parsing, cleaning (escapes, controls, https only), the spinner ticker, the row under the prompt, the reader's paging, the cycle's rules (`pickNext`), and Claude Code's own rule for drawing links (`linksDrawn`) |
| `tools/pulse/build_pulse.py` | Operator tooling, not the mod: builds the Pulse feed and pushes it to the `pulse` branch |
| `types/index.d.ts` | The `$.state` contract (`PluginState['g-line']`); self-contained, no imports |
| `tests/*.test.ts(x)` | `claude plugin test .` runs them; `tests/cases.ts` is the golden file for `core.ts` |
| `scripts/golden.ts` | Regenerates `tests/cases.ts` (`bun scripts/golden.ts`) |
| `scripts/ansi2png.py`, `scripts/ansi2svg.py`, `scripts/frames.py` | Real-capture screenshots and the demo video from `tmux capture-pane -e` |

## The loop

```sh
claude --plugin-dir .             # a session with your working copy; saving a file reloads the hooks
claude plugin validate .          # what the engine reads, the hooks and calls it sees, what it would refuse
claude plugin test .              # every *.test.ts(x); 5 s per test
bun scripts/golden.ts             # after changing hooks/core.ts on purpose, then read the diff of tests/cases.ts
```

To type-check against this build's API, load a session with `--plugin-dir .` once: the engine
writes its declarations to `.claude-plugin/types/` (git-ignored). Then run
`bunx -p typescript tsc -p . --noEmit`.

The project skill `.claude/skills/g-line-dev` sums up the API surfaces g-line uses, with the
traps found while building it. Claude Code also ships a skill for writing mods: **`plugin-authoring`** (built in as
`cc-plugin-plugin-authoring`). Load it before extending g-line. It holds the API's
long-form reference, examples of every render site, and the rules `claude plugin validate`
enforces. The public docs are at code.claude.com/docs/en/plugins/mods/overview.

## Recipes

**Add a figure to line 2.** Write a function returning a `Segment` (`key`, `priority`,
`forms` widest first, an optional `tone`) in `hooks/deck.ts`, add it to `lineNext`, and add a
case to `tests/deck.test.ts`. Tones colour it (`ok` green, `warn` amber, `bad` red, `accent`
Claude orange); no tone draws it dim. A warning (`warn`/`bad`) gains priority and keeps its
words longest.

**Add a receipt event.** Record the fact on the live turn (`turnNow` in `register.tsx`), carry
it into `Receipt` (`types/index.d.ts`, `receiptOf`), and add a rule to `receiptEvents` in
`hooks/extras.ts`. Say the observation, not a cause. Test it in `tests/extras.test.ts`.

**Change what Claude reads.** `hooks/glance.ts` builds the `status` JSON and
`tests/deck.test.ts` pins it. Keep it to facts the engine reported, `null` when unknown, no
advice. It's registered only with `claude_reads: true`, deferred where tool search is
available.

**Take screenshots or a demo.** Run a session in tmux at the size you want, then
`tmux capture-pane -p -e -t <session> | python3 scripts/ansi2png.py --title ... --out x.png`.
For video, `python3 scripts/frames.py record` then `render` (see its docstring). Use a neutral
demo repository and no `account_command`, and read every frame before publishing it.

## Release

1. Raise `version` in `.claude-plugin/plugin.json` and add a `CHANGELOG.md` entry.
2. Run `claude plugin validate .` and `claude plugin test .`.
3. Scan the diff and every image for emails, account names, tokens, hostnames, home paths and
   customer names.
4. Commit and push to `main`. Marketplace installs pick up the new version.
