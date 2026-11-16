# Notices

Notices put a heads-up from a tool of yours where you already look: a toast when it first
appears, a short marker on line 2 while it stands, and the full list under `/g-line notices`.
They're for things you'd otherwise only learn from a push on your phone: a credit running
out, a service that needs signing in again, a backup that didn't run.

Off unless you set `notices_command` in `config.json`.

```json
{
  "notices_command": ["my-alerts-tool", "--json"],
  "notices_interval_minutes": 5,
  "notices_repeat_hours": 6
}
```

## What your command prints

One JSON object on stdout, exit status 0:

```json
{
  "notices": [
    { "id": "backup-late", "level": "warn", "text": "Nightly backup is 2 days late",
      "detail": "Last good run: Mon 09:00. Run my-alerts-tool explain backup-late for more.",
      "until": "2026-11-20T09:00:00Z" },
    { "id": "disk", "level": "urgent", "text": "Disk is 96% full" },
    { "id": "update", "level": "info", "text": "A new release is out" }
  ]
}
```

| Field | Meaning |
| --- | --- |
| `id` | Names the notice. The same id isn't toasted again until `notices_repeat_hours` have passed (up to 64 characters) |
| `level` | `info`, `warn` or `urgent` |
| `text` | One line, up to 100 characters |
| `detail` | Optional; shown by `/g-line notices` (up to 400 characters) |
| `until` | Optional ISO time; the notice is gone after it |

Anything else (a failure, a non-zero exit, output that isn't this JSON, an entry without an `id`
or `text`, an unknown `level`) means no notices from that run. Keep the command quick: g-line
gives it 5 seconds, and it should answer from a cache of its own.

## What you see

- **A toast**, once per notice, for `warn` and `urgent` (not `info`). The same `id` shows again
  after `notices_repeat_hours` (6 by default); an urgent one repeats every 2 hours at most.
  `toasts: false` turns the toasts off; the marker stays. Sessions on one machine share what
  has been shown, so you aren't told twice.
- **A marker on line 2** while any `warn` or `urgent` notice stands: `⚠ 2 · /g-line notices`,
  red if any is urgent, amber otherwise. It's one of the figures line 2 keeps at every width, so
  a phone or a narrow pane shows it too (on another row, where one row is too short). With
  `lines: 1` it joins the footer labels; with `lines: receipts` there's no footer, so only the
  toast and the command remain.
- **`/g-line notices`** opens a pane with every notice, urgent first, each with its detail.

## What g-line does and doesn't do

g-line runs your command about every `notices_interval_minutes` (5 by default), away from
drawing, and makes no network call of its own: whatever the command reads is its own doing.
The command's text is untrusted: escape sequences and control characters are stripped before
anything is drawn. g-line never acts on a notice; it only shows it.
