# Changelog

## 0.1.0 (2026-10-12)

First release.

- **The mod**: a live band above the prompt with model and effort, context left, the
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
