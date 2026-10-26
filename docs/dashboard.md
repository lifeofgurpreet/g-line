# The dashboard

`/g-line dashboard` (or `b` in the `/g-line` pane) writes one page,
`~/.cache/g-line/dashboard.html`, and opens it in your browser. Over SSH or on a machine with no
display, a toast tells you where the file is instead.

The page is a snapshot of what g-line holds at that moment. Nothing runs in the background to
keep it current; run the command again for a fresh one.

![The g-line dashboard: usage cards for the 5-hour and weekly windows with meters, reset times and pace; the sessions on this machine; a bar chart of cost per day over 14 days and a table of turns, cost, cold rebuilds, keep-warm re-reads and tool calls per day](dashboard.png)

## What it shows

- **Usage windows.** The 5-hour and weekly windows: used percent, the reset time on your clock,
  and the pace projection line 2 would show. Amber when a window is on pace to run out.
- **Sessions on this machine.** Every g-line session the roster knows: working, waiting on you
  or idle, with context, cache and model. Accounts show only when you set an `account_command`.
- **History.** The last 14 days from g-line's day ledger: turns, cost at API prices, cold cache
  rebuilds, keep-warm re-reads and their cost, tool calls and agents, with this week's totals and
  a cost-per-day chart. Only sessions g-line ran in are counted.
- **Cache.** This session's cache estimate, the same one line 2 shows.
- **Guard.** Each of your rules as written, whether it is in force, and the reasons
  `/g-line guard why` gives. With no rules, it says so.

## Privacy

The page loads nothing from the network: no scripts, fonts, images or styles from anywhere else,
and no JavaScript at all. It shows no paths, repository or branch names, nothing from your
conversation, and no account unless you set an `account_command`. Every value is escaped before
it is written. The file stays on your machine; delete it whenever you like.
