# Changelog

## 0.16.0 (2026-10-23): pace the working day, and use the end of the week

- **A pace rule can pace the 5-hour window** (`"window": "5h"`): the allowance rises across the
  five hours instead of the week. With `hours`, it paces only in those hours, so a shared seat
  lasts the office day and is free to spend outside it. The words follow the window
  (`ahead of pace: 45% of the 5-hour window used, 22% allowed by now`).
- **`drain`** in `guard`: in the last 48 hours of a week with 20% or more left (both yours to
  set), g-line says once that it's there to use, with what the guard still keeps back, and line 2
  reads `use it: 64% of the week left`.
- Times take days (`"unless_reset_within": "3d"`), and a rule reads `unless it resets within 3d`
  rather than in minutes.
- The README has a short "Change it yourself".

## 0.15.0 (2026-10-23): see usage spent on another machine

- Usage spent in a session on another machine never reached this one, so `5h` and `week` read
  low and the guard waited. A new opt-in `usage_command` in config.json prints the account's
  usage as one line of JSON; g-line runs it about every 2 minutes (only with an `account_command`)
  and merges the answer into line 1, line 2 and the guard. It can raise a figure and never lowers
  one in the same window; a command that fails, times out or prints something else changes
  nothing. The command is your own, like `account_command`: g-line makes no network call itself.

## 0.14.0 (2026-10-23): sessions on one account share their usage

- A session learns the account's usage only from its own requests, so an idle terminal kept
  reading `5h 84%` while another on the same account spent it to 88%. With an `account_command`,
  sessions on the same machine and account now share their readings through Claude Code's plugin
  store every 15 seconds: in one window the higher percent wins (use only grows until the reset),
  across a reset the newer window. Line 1, line 2 and the guard all read the shared figure, so a
  rule stops an idle session as soon as a busy one crosses it. Different accounts never mix.

## 0.13.1 (2026-10-23): a cold cache keeps its size, and a hold says when it really lifts

- A cold cache read only `cache cold` on a busy line, where a warm one kept `cache ~48m 57k`.
  It now keeps its size the same way (`cache cold, rebuilds 57k`, `cache cold 57k`) and gives it
  up only before something as important would be dropped.
- Line 2's `over pace till …` named the week's reset, days away. It now names about when the pace
  step lets go as the allowance grows (`over pace till ~Sun 12:00`). A rule with hours says when
  its hours end, if that comes before the reset.

## 0.13.0 (2026-10-23): see the effort that ran, and free your own session

- **The effort that ran, next to the one you set.** When the guard lowered the conversation's
  effort, Claude Code's own label still read `xhigh` and nothing said the turn ran at `medium`.
  Line 2's model now reads `Opus 5.5 xhigh→medium by guard`, in amber, and plain
  `Opus 5.5 xhigh` once the effort is yours again.
- **`/g-line guard off here`** (or `off me`) lets this session alone: prompts, effort and new
  agents run as you set them, keep-warm waits, and line 2 says `guard off here`. Other sessions on
  the machine stay guarded, where `pause` and `off` free every one of them. `/g-line guard on here`
  brings the rules back; a new session starts guarded.

## 0.12.2 (2026-10-23): a turn the pace ended says so

- The line under a turn that a `pace` rule ended read `guard: ended the turn, 38% week left`,
  which looked like a stop well above any reserve. It now says what the toast and the refusal
  say: `guard: ended the turn, ahead of pace: 62% of the week used, 48% allowed`. A turn ended
  inside the week's reserve, and one a plain rule ended, still say how much of the window is left.

## 0.12.1 (2026-10-23): Pulse headlines are links in herdr, Zellij and over SSH

- Claude Code decides whether to draw links on every draw, from its own environment, and it
  doesn't recognise herdr, Zellij or SSH sessions. With Pulse on, g-line now sets
  `FORCE_HYPERLINK=1` in Claude Code's process, so the headline is a link there, with nothing to
  set by hand. A SessionStart hook unsets it again for Bash commands: tried on 2.1.309, a
  command's `env` no longer shows it, where without the hook tools inherit it and print link
  codes into what Claude reads. `FORCE_HYPERLINK=0` where Claude Code starts keeps links off.

## 0.12.0 (2026-10-23): a paced week, and the guard says why

- **A paced weekly allowance** (`pace`, a rule of its own). The cliff rules waited for the last
  few percent, so a shared seat could still be drained by Friday. A `pace` rule gives the week an
  allowance that opens up with the clock (office hours count more) and steps in when the account
  has used more than that: first a lower effort, then cheaper new subagents, then a stop (with
  `end_turn`, a running turn ends too). It says it in words: `ahead of pace: 62% of the week
  used, 48% allowed by now`. The week is anchored on the weekly reset the engine reports, office
  hours are read in your own `tz` (daylight saving included), and it works for groups like any
  rule: `{ "groups": ["team", "other"], "pace": { "reserve": 10, "burst": 8, "office":
  "09:00-18:00 mon-fri", "office_weight": 4, "tz": "Asia/Kuala_Lumpur" } }`. README: Guard.
- **`/g-line guard why`.** A toast gives the verdict and the pane's guard section lists the
  weekly and 5-hour figures, this account's group, each rule's state, the pace allowance now
  and about when the hold lifts.
- **A pass or a held prompt belongs to its account and window.** `/g-line guard once`, Enter
  again and a queued prompt are each bound to the account and the window's reset they were
  given for. A switch of account, or a stop that comes back for a new window, makes them lapse,
  with a toast, instead of carrying over.
- **A malformed rule is left out whole.** An empty `accounts` or `except_accounts`, an unknown
  `window`, a bad `effort`, `agents`, `unless_reset_within` or `end_turn` used to be said and
  then half-read into a rule that applied more widely than written. Now the rule is left out
  and the startup toast says which. `09:99-18:00` is no longer an hour range, and a number
  too big to be one is refused.
- A new subagent model g-line can't rank no longer hides a cheaper one it can. A change of
  effort or agent model between two rules that both stay in force now gets its toast. A reading
  that isn't a number can't start keep-warm, hold a lease or schedule a resume.

## 0.11.0 (2026-10-23): a held prompt waits for you, on a warm cache

- **`guard.queue`.** A typed prompt the guard holds is kept and sent by g-line as soon as the
  guard lets go (the window's reset, or the end of a rule's hours), with a toast. The refusal
  says about when; line 2 adds `1 queued`; `/g-line guard cancel` keeps it from going; Enter
  again still sends it now. A prompt you type that goes through, `/clear`, the session ending or
  an account change drops it. Sending takes it out of the prompt box if it's still there.
- **The cache is kept warm for it.** If the prompt cache would lapse before the prompt goes,
  g-line re-reads it once, four minutes before, so the prompt doesn't pay for a rebuild: at most
  twice, and only with room in the window (a used-up window can't be read from; the refusal
  says the cache will be cold).
- An account in no group reads "in none of your groups".

## 0.10.0 (2026-10-23): groups of accounts, your own time zone, and a guard that says why

- **Account groups** (`guard.groups`). Name buckets of accounts (yours, the team's seats,
  someone's own seat) and give rules to whole groups with `"groups": ["team"]`. An account is in
  the first group whose words its account line contains, or in `other`. The refusal and line 2
  name the group (`people reserve`), and the pane lists the groups with this session's marked.
- **The guard says why, in plain words.** `g-line held this prompt: sam@example.com is in your
  people group, with 35% of its 5-hour window left. g-line keeps the last 40% of it for its
  owner. It resets at 13:00, in 3h 0m.` Rules with hours say them (`Mon-Fri 04:00-17:00 Kuala
  Lumpur time`). A weekly reset reads `Sat 10:00, in 4d 0h`.
- **Press Enter again to send it anyway.** Claude Code puts a held prompt back in the box; the
  same prompt sent again within three minutes goes through, with a toast. Only for prompts you
  type: a loop's or schedule's never does. `/g-line guard once` and `pause` still work.
- **The reason holds still.** With several stop rules in force on the same window, the one given
  is the one that started first (a team reserve before the general 5% stop), so the reason no
  longer changes between two prompts.
- **Line 2 says why and until when:** `guard: team reserve, 9% 5h left till 08:20`, narrowing to
  `team reserve till 08:20`; otherwise `guard: held …`.
- **Your time zone** (`tz`). Every time g-line shows can be in your zone instead of the
  machine's: useful when the machine is in Germany and you're in Malaysia. The pane says which.
- **The cache's size stays on line 2.** On a crowded line it was the first thing dropped. It now
  outlasts the reset times and the session roster, and goes only before a warning would:
  `cache ~48m 57k`. Segments can keep spare forms for this (`spare` in `core.ts`).

## 0.9.0 (2026-10-23): a stop that ends a running turn

- **`end_turn`**, for a stop rule. A stop used to refuse only new prompts, so one long agentic
  turn (an agent working through a task on its own for an hour) ran a shared account's window
  to nothing with the rule in force the whole time. With `"end_turn": true`, a stop rule that
  starts during a turn ends it between steps, before the next request: every tool call the last
  response asked for has finished, so nothing is cut off mid-call. Claude Code's `$.turn.abort`
  does the ending. A turn that began with the rule already in force (let through by
  `/g-line guard once`, a pause, a slash command or an agent's report) runs to its end, and so
  does every turn while the guard is paused. Said in a toast, a notification and line 2
  (`guard: stopped`). Claude Code draws no closing line for a turn ended this way; where it
  does, the receipt reads `guard: ended the turn, 8% 5h left`. `/g-line guard once`, then
  `continue`, carries on.
- **Tried in a real session** (Claude Code 2.1.309, Haiku 5.5): with a stop rule in force on
  another account, the account changed to a shared one while a long tool call ran. The call
  finished, the turn made no further request, and the background task's later wake-up was
  refused like any other.

## 0.8.2 (2026-10-23): a rule for every account but yours

- **`except_accounts`.** A rule can now apply to every account except the ones named, so
  "keep a reserve on shared accounts" no longer means listing each shared account and missing
  the next one added. `{ "left": 10, "stop": true, "except_accounts": ["me@"] }` stops at 10%
  on any account whose `account_command` line doesn't contain `me@`. With no account reading
  it waits, as `accounts` does. It works on the weekly window too, which is the one a
  shared account runs out of for days.
- **A test that broke on Claude Code 2.1.308.** The test harness now runs a call's permission
  check inside `tool.call`, so the roster test's "ask" stub asked again and the call never
  ran. The stub now asks once. No change to the mod.

## 0.8.1 (2026-10-21): the guard, tried in a real session

0.7 and 0.8 were tested only through the engine's dispatch. In a signed-in session the guard
lowered effort, moved a subagent to a cheaper model, refused a typed prompt and let one through
with `once`; keep-warm re-read a 45k cache after 12 idle minutes; the roster counted the other
session. These were wrong:

- **A subagent's run wiped the turn's record.** Every hook hears a subagent's `turn.start`,
  and g-line took it for the main turn's. A turn that lowered effort and then started an agent
  closed with no `guard:` note; tool counts and the cost baseline went too, and a subagent run
  starting after the turn ended left the session reading busy, so keep-warm never ran and the
  roster said `working`. Now only the main loop's start counts.
- **A stop rule lost a background agent's report.** After `/g-line guard once`, the agent the
  turn started finished, and its report was refused like a new prompt, so Claude never saw
  it. A report from a background agent your conversation started now goes through; other
  wake-ups (a `/loop`, a schedule, other tasks' notices) are still refused.
- **A refusal while simulating didn't say so.** It now reads `(simulated; your rule: stop
  at 5%)`.
- **Toasts cut off their way out.** The simulate, pause and limit toasts ran past the toast's
  three lines, losing `/g-line guard simulate off ends it`. They're shorter, and
  `/g-line guard` lists what's in force in a few words (`stop (4% of 5h left), effort low,
  agents on haiku`) instead of every rule; the pane still lists them all.
- **Account changes.** An account switched while idle, with the next turn already on the new
  account, read as `cache cold (account changed)` once g-line read the account. A cache now
  counts cold only if it was written before the old account's last confirmed reading, and the
  account is read again within two minutes of each turn to confirm it. A changing note at the
  end of the line, such as `(82% left)`, no longer reads as another account, and no longer
  splits keep-warm's and resume's per-account shares.
- **The agents rule could raise a cost.** An agent type whose definition picks its own model
  (a plugin's agent on Haiku, say) was taken to run on the parent's model and moved to the
  rule's. Such a type is now left alone until g-line has seen what it runs on; Claude Code's
  own types are known (`general-purpose` and `Plan` run on the parent's model, `Explore` on
  Haiku).
- **Resume.** A `/clear` or the session ending now drops a planned `continue` and its lease
  (it used to go into the cleared conversation, or hold the account's lease for nobody). A
  prompt you type before the reset drops it too, and at the reset nothing is sent while the
  guard is off or paused; each says why, whatever the toasts setting. The same limit is said
  once, not once per jittered plan.
- **Leases** (keep-warm's and resume's, one session per account) are read back after they're
  written, and a session gives back only its own.
- **Keep-warm** with the latest `after` (55 minutes) and the most spread could miss its
  window; it now always leaves a minute. Its hourly counts are pruned from the store.
- Rules naming `accounts` with no `account_command` never apply; g-line now says so when the
  session starts and in `/g-line guard`. The "simulation ended" toast and the refusal's Tab
  suggestion stay quiet after `/g-line off`.
- README: the Guard section has a real screenshot, says how to get a refused prompt back
  (ctrl+u, `/g-line guard once`, ctrl+y), and notes that a keep-warm fork in one test
  session read only the cached tools and system prompt; keep-warm noticed and stopped.

## 0.8.0 (2026-10-21): the other sessions, and going on after a limit

- **The other sessions on this machine.** Each g-line session keeps a heartbeat in Claude
  Code's plugin store, shared by the machine's sessions and nowhere else. It holds whether
  the session is working, waiting on a permission answer from you, or idle, plus its context,
  cache and model, and the `account_command` line only where you set one. Line 2 adds
  `2 others · 1 waiting` when there are others; it's the first thing a narrow line drops. The
  pane lists every session. A session's entry goes when it ends. `roster: false` turns it off.
- **A usage limit stops a turn.** When a turn ends on an error while a window reads full,
  g-line says so with the reset on your clock. With `"resume": true` in `guard` (off by
  default) it also plans one `continue` (or your text) for just after the reset plus up to
  five random minutes. You get a notification, line 2 reads `resumes 14:17`, and
  `/g-line guard cancel` drops it. One session per account holds the plan; the others say so
  and wait for you. No handoff file is written.
- **Resets on your clock.** The pane gives each window's reset in local time:
  `5-hour 62% used, resets 14:12 (in 2h 47m)`.
- Not added: a "waiting on you" notification. Claude Code already sends one for each
  permission ask and after a minute idle, through the same channel. Also not added: the cause
  of a cache miss on the receipt. Claude Code's `/usage` names one, but nothing in the API it
  gives mods (2.1.304) carries it.

## 0.7.1 (2026-10-21): the guard, sturdier; an account change counts the cache cold

- **Account changes.** When the `account_command` line changes, as when an account manager
  switches accounts mid-session, line 2 reads `cache cold (account changed), next turn
  rebuilds 120k`, a toast says so once, and the next turn's closing line reads `cache cold
  after account change · rebuilt 120k`. Prompt caches are kept per organization (Claude's
  prompt-caching docs), so a cache written under another account isn't counted on. That
  holds for every model. The account is read again after a turn when the reading is over two
  minutes old.
- **Keep-warm, one per account.** By default it keeps only the session you typed in last on
  each account (`"sessions": "all"` for every idle one). It holds a lease so one session per
  account re-reads at a time. The hourly cap is per account.
- **Keep-warm stands down** when a re-read reads nothing or writes a tenth or more of what it
  read, after an account change, a model change, a compaction or `/clear`, while the guard is
  paused, and, after an Esc, for the rest of that idle stretch.
- **What keep-warm costs** shows: line 2 reads `kept warm 2× · $0.08` until your next turn,
  each toast gives the cost, and the pane's day line adds `kept warm 3× ($0.12)`. The cost is
  the session's own ledger before and after the re-read, and it's left out when something
  else was running.
- **`/g-line guard simulate 5h 96`** (or `week 90`) has the guard act as if that much of the
  window were used, for 15 minutes, marked `(sim)`, so rules can be tried with no quota spent.
  `simulate off` ends it.
- With no usage readings, `/g-line guard` says the rules can't act, and a headless `claude -p`
  run logs it once instead of passing silently. A reading from before a window's reset no
  longer counts.
- README: stop before usage credits (real money, and five-minute caches there).

## 0.7.0 (2026-10-21): a guard for a low window, by your own rules

- **Guard (opt-in, off by default).** Rules you write under `guard` in config.json act when a
  usage window runs low. With none, nothing changes. A rule names the percent left of the
  5-hour window, or the week's, and one action. `effort` lowers the conversation's effort
  for whole turns. `agents` starts new subagents on a cheaper model, never a dearer one.
  `stop` refuses prompts that would start a turn, typed or started by a loop or schedule,
  with the window, what's left, when it resets and the way past. Conditions are
  `unless_reset_within`, `accounts` (matched against the `account_command` line, for shared
  accounts) and `hours` in a `tz`. A rule lets go 2 points past its threshold, at the
  window's reset, or when a condition stops holding. Missing figures decide nothing.
- The guard never touches a tool call, a running turn or the main model. A lower effort keeps
  the prompt cache on Opus 5.5, Sonnet 5.5, Haiku 5.5 and Fable 5.1 through the Claude API, as
  Claude Code's own prompt-caching page says. Elsewhere the guard waits for the cache to go
  cold before lowering it.
- Everything it does is shown: a toast when a rule starts or stops, line 2 while one is in
  force (`guard: effort medium, agents sonnet`, `guard: stopped, 4% 5h left`), the turn's
  receipt (`guard: effort medium, 1 agent on a cheaper model`), `/g-line guard`, and the pane.
  `/g-line guard once` lets one prompt through (Tab offers it after a refusal). `pause [30m]`
  pauses the guard on the machine, `resume` ends a pause, and `off`/`on` switch your rules.
- **Keep-warm** (`guard.keep_warm`) re-reads an idle conversation's hour-long prompt cache at
  about 45 minutes, through Claude Code's own `$.model.fork`, which adds nothing to the
  conversation. It runs at most twice per idle stretch and six times an hour across the
  machine. It skips caches under 50k, a five-minute cache (as on usage credits), a low 5-hour
  window, an active stop rule, and conversations Claude Code's idle compaction will summarise.
  Each re-read is a toast and moves the cache countdown. A re-read, or a later turn, that
  finds the cache gone turns it off for the session.
- **Fallback on the receipt.** When a model other than the one asked for answers, the turn's
  closing line says `answered by Sonnet 5.5`.
- AGENTS.md rule 5 now says when g-line may steer (only by the person's rules) and what it
  must show when it does.

## 0.6.9 (2026-10-21): Pulse's links, and headlines that don't come round every minute

- **Links.** Since 0.6.3 Pulse's headline was a link only when `TERM_PROGRAM` named Ghostty,
  iTerm2, WezTerm or VS Code, and never inside tmux. In herdr (`TERM_PROGRAM=herdr`), and in a
  session over SSH or in a multiplexer's server, which carry no `TERM_PROGRAM` at all, the
  headline was plain text, so clicking it did nothing. g-line now follows Claude Code's own
  rule for drawing links, the one Claude Code 2.1.304 applies to every `Link`: `FORCE_HYPERLINK`
  first, then the terminals it knows (Ghostty, iTerm2, kitty, WezTerm, VS Code, Windows
  Terminal, Warp, JetBrains, tmux 3.4 or later). herdr, Zellij and SSH sessions get links
  with `FORCE_HYPERLINK=1` set where Claude Code starts; g-line says so once when it draws
  headlines as plain text. The reader prints a link's whole address once, for the terminal
  to find, instead of a link Claude Code would print twice.
- `/g-line open` (and `o` and `d` in the reader) on a Linux machine with no display copies
  the link, instead of trying `xdg-open` where no browser opens for you. A multiplexer's
  server started over SSH carries no SSH variables, so g-line used to try there.
- A link of up to 1000 characters is kept. A publisher's gift link carries a token and can run
  past the old 400-character cap, which dropped the item.
- **Cycling.** The row used to step through the feed every 8 seconds and start over, so with
  10 items the same headline came back every 80 seconds. Now headlines you haven't seen come
  first; a shown headline rests 30 minutes and shows at most 3 times a day; when every headline
  is resting the row holds still; the same headline never shows twice in a row, even across a
  feed refresh. Every session on the machine shares the counts. The README's Pulse section
  states the rules. The spinner, in the receipts-only layout, follows them too.
- The feed builder fills the page from the other sources' leftovers when 𝕏 is quiet, so the
  feed carries up to 15 items instead of stopping at 10.

## 0.6.8 (2026-10-20): the account stays on a busy box

- On a loaded machine the `account_command` sometimes ran past its 5 seconds (one call measured
  5.5 s on a box with a load average near 94). The failure blanked the account, and the next
  try came ten minutes later, so a remote session could go without its account for long
  stretches. A command that fails or runs out of time now keeps the last reading and is tried
  again a minute later. A command that answers still says what is now known, an empty line
  included.

## 0.6.7 (2026-10-20): idle compaction shows even when no event reports it

- After Claude Code compacted an idle session, line 2 could still read `cache cold, next turn
  rebuilds 215k` under Claude Code's own "Compacted while idle, before the prompt cache
  expired". On a machine with managed settings, Claude Code's built-in security plugin sits
  ahead of user plugins and sends both `session.compact` and the `compaction` rows on past
  them, and the context count stays at the old size until the next request. So none of the
  signals g-line used reached it.
- While the session is idle, g-line now counts the messages the next request is built from
  (`$.session.messages({ as: "api" })`), every two minutes until it sees a compaction. A count
  that falls below half reads as one: `cache compacted`, with no size until the engine reports it.
- The context-count check from 0.6.4 also runs on the session's own refresh, not only on
  `session.measure`.
- The idle-compaction threshold follows Claude Code's floor: `CLAUDE_CODE_IDLE_COMPACT_MIN_TOKENS`
  below 100k counts as 100k.

## 0.6.6 (2026-10-20): the warm cache says how much it holds

- Line 2 reads `cache warm ~59m (57k)` while the cache is warm. Every request restarts the
  clock, so in a busy session the time always read about 59 minutes and said little. The size
  is what the next turn would rewrite if the cache lapsed. Narrow lines drop it first.

## 0.6.5 (2026-10-19): Pulse at your pace, without the sources you skip

- `pulse_speed`: `normal` moves Pulse to the next headline every 8 seconds, `slow` every 40,
  and `paused` holds one until you page in `/g-line news`. `v` in `/g-line settings`, or
  `/g-line set pulse_speed slow`. The spinner's headlines follow it too.
- `m` in `/g-line news` mutes the picked item's source on Pulse's row and the spinner; `m`
  again unmutes it. A muted source stays in the reader, marked muted. In config.json,
  `pulse_mute` lists them: `["𝕏"]` skips every post on 𝕏.

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
