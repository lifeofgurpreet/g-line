---
name: g-line-dev
description: Extend or fix g-line, the Claude Code mod in this repository (live status under the prompt, receipts on each turn's closing line). Use when changing what g-line draws on the hint line, its second row, the spinner or a turn's closing line, its pane or commands, its heads-ups, the Pulse feed or the status tool. Covers the mod API surfaces g-line uses, verified against Claude Code 2.1.296, and the traps found while building it. Not for statusLine scripts; g-line has none.
---

# Extending g-line

g-line is a **mod**: `hooks/register.tsx`, loaded by `hooks/hooks.json` (`{ "modules": ["./register.tsx"] }`),
exporting `register(on, options)`. Every hook is `($, e, next)`. There is no `statusLine`
script and no stdin JSON: never write one, and never read the transcript file. Read
`AGENTS.md` for the rules (never above the prompt, at most two lines, engine figures only,
private by default).

Verified on Claude Code **2.1.296** (mods need 2.1.287 or later; g-line says 2.1.293). For any
API detail, the types Claude Code writes for this build are the truth: run a session with
`claude --plugin-dir .` once, then read `.claude-plugin/types/claude-code/index.d.ts`. The
built-in `plugin-authoring` skill has the long-form reference.

## The surfaces g-line draws on

| Where | Site / call | How g-line uses it | Traps |
| --- | --- | --- | --- |
| Hint line under the prompt (line 1) | `ui.render` `{ component: 'PromptHint' }`, props `hint`, `tail`, `isDraft`, `isWorking` | `next({ ...e, props: { ...e.props, tail } })`: the engine draws `tail` dim at the end of its own line | Rewriting `hint` replaces the hint and **drops `tail`**. Combined with a returned tree, it makes the engine put the mode label in its own column. Shorten the hint (`withText` in `inline.ts`) only in the one-line layout |
| Line 2 | The same hook returns `<Box flexDirection="column">{engine}<Box>…</Box></Box>` | The second row is g-line's own, in colour (`Text color`), starting at column 2 | A `flexDirection="row"` beside the engine element wraps onto a new row anyway. Measure room as `columns - 5` (`nextRoom`) |
| Permission-mode label (`⏵⏵ bypass permissions on`) | none | **Not rewritable.** It isn't in `PromptHint.props` or `SessionMode.props.modes`; the engine draws it beside the hint | Don't promise to shorten it. Its width is unknown, so budget 26 columns for a `(shift+tab to cycle)` hint and 19 otherwise (`tailRoom`) |
| Footer mode labels | `ui.render` `{ component: 'SessionMode' }`, props `modes` | One-line layout only: `agents 2 running`, `compacts in ~3 turns` | Joined by ` & ` at the row's right; leave room for them (`modesWidth`) |
| Spinner | `ui.render` `{ component: 'Spinner' }`, props `word`, `message`, `suffix`, `mode` | `suffix` gets the burn, failures and (Pulse on) a headline | The engine follows the suffix with its own `(38s · ↓ 1.2k tokens)`; keep about 34 columns for it |
| Turn's closing line | `ui.render` `{ component: 'TurnDuration' }`, props `word`, `durationMs`; `e.requestId` is the line's message id | Draw `{engine}` and lay the receipt over the row's blank end: `<Box position="absolute" bottom={0} left={own}>` | Terminal only. Pair the line to its turn through `session.append` (`door: 'notice'`, `message.name === 'turn_duration'`, `e.uuid`) |
| Pane | `$.ui.open({ id })` and `ui.render` `{ component: 'Pane', requestId: id }` | Settings buttons, details, Pulse links (`Link`), the share card, `$.ui.copy` | Opened only by the person (`/g-line`). In a narrow terminal a pane sits above the prompt, so never open one unasked |
| Toasts, notifications | `$.ui.toast(text, { timeoutMs })`, `$.ui.notify(text, { title })` | Heads-ups; `notify` reaches another app through the person's channel and falls back to a toast | `notify` resolves `{ isSent: false }` with no channel (tmux): fall back |
| Commands | `$.command.register({ name })` in `session.start`, `on('command.run', { command }, …)` | `/g-line`, and `/glanceline` for one release | Return `{}`: a command's `text` goes into the conversation, and Claude reads it. The handler must be a **top-level function** (the loader refuses a `$` passed to a nested closure) |

## The figures

- `$.session.usage()` gives `{ startedAt, context: { tokens, window, percent }, rateLimits: [{ kind, percentUsed, resetsAt }], cost: { usd } }`.
  `$.session.usage({ breakdown: 'summary' })` adds the `/context` breakdown with `autoCompactThreshold`.
- `session.measure` fires after each turn and when a limit's percent changes.
- `turn.step` (an async generator: `yield* next(e)`) gives each request's `usage` (cache reads and writes), `model` and `effort`.
- `tool.call`: `await next(e)` and read `isError`; never gate or rewrite.
- `agent.spawn` (`e.background`) and `$.agent.list()` give subagents and their status.
- `session.compact` gives `tokensBefore` and `tokensAfter`.
- `$.clock.every(ms, fn)` keeps countdowns moving while idle. `$.store` persists across sessions
  (shared by every session on the machine). `$.state` is per session, through the atoms in
  `types/index.d.ts`.

## Loader and validator rules that bit

- `types/index.d.ts` must be self-contained (no `import`), and declare every atom key under
  `PluginState['g-line']`.
- Don't name a local variable `on`. `on` is reserved for `on('<event>', hook)`.
- A tool's handler is `on('tool.call', { tool: /^mcp__g-line__status$/ }, …)` and returns
  `{ result: string, text: string }`. An object result is rejected.
- Keep source free of invisible characters. Write them as `\u` escapes.
- `$.http.fetch` has no timeout: race it with `$.clock.sleep`, and never call it from a render
  hook.

## Check every change

```sh
claude plugin validate .     # must say: Validation passed
claude plugin test .         # every *.test.ts(x); tests/cases.ts is the golden file for hooks/core.ts
bun scripts/golden.ts        # only after changing hooks/core.ts on purpose; read the diff
```

Then look at the real thing: run `claude --plugin-dir .` in tmux and
`tmux capture-pane -p -e` at 140, 100 and 80 columns.
