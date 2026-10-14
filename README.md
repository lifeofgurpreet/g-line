# g-line Pulse feed

This branch holds the static feed that g-line's opt-in **Pulse** reads:
`https://raw.githubusercontent.com/lifeofgurpreet/g-line/pulse/pulse.json`.

- `pulse.json` is generated hourly by `tools/pulse/build_pulse.py` (on `main`). It runs on the
  maintainer's own machine, not on GitHub Actions. Its sources are curated items, Claude Code
  releases, Anthropic's news pages, Hacker News stories about Claude, and Simon Willison's
  AI/LLM posts. Each item is labelled with its real source.
- `curated.json` is edited by hand. Add an item to pin it to the top of the feed:

```json
{ "items": [
  { "title": "g-line 0.5: receipts on the turns", "url": "https://x.com/…/status/…", "source": "g-line", "until": "2026-10-21T00:00:00Z" }
] }
```

`title`, an `https://` `url` and `source` are required. `until` (optional) drops the item
after that time. Don't label an item as coming from somewhere it didn't.

The mod fetches this one file, at most every 45 minutes, and only when a person has turned
Pulse on. Nothing is sent from their machine.
