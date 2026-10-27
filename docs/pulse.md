# Pulse: headlines under the prompt

Pulse is off unless you turn it on. `/g-line set pulse on` (or `p` in `/g-line settings`) turns
it on, and within seconds a headline appears on a dim row of its own under line 2:

```text
𝕏 @NeelNanda5 · 2h: This is interesting work, but I don't think it's a significant… · /g-line news
```

![Under the prompt, after a turn that closed with "API $0.17 · cache read 53%": the hint line ends with "ctx 4% · 5h 0% · wk 24%", line 2 reads "Opus high · cache ~57m · 5h resets 4h41m · wk resets 4d4h", and Pulse's row under it reads "𝕏 @deepseek_ai · 1d: 🚀 DeepSeek-V4.1-Flash-1017 is here! Stronger benchmark per… · /g-line news"](pulse-row.png)

## How the row moves

- The row moves to the next headline every **8 seconds**. `pulse_speed` (`v` in
  `/g-line settings`) makes it every **40 seconds** (`slow`), or holds one headline (`paused`).
- Headlines you haven't seen come first, in the feed's order (best first).
- A headline that has been shown **rests for 30 minutes** before it can come back, and shows at
  most **3 times a day**.
- When every headline is resting, the row **holds still** on the one it shows. It moves again
  when a new headline arrives or a rest ends.
- The same headline never shows twice in a row, even when the feed refreshes.
- Every session on the machine shares these counts, so two terminals don't repeat each other.
- The feed is rebuilt every 30 minutes (up to 15 items), and g-line fetches it at most every
  **45 minutes**. `r` in `/g-line news` fetches it now.

With 15 headlines, the row shows each one once in its first two minutes, then stays on the last
one until something new comes in or half an hour has passed.

With the receipts-only layout (`lines: receipts`) there is no row, so the spinner shows the
headlines on turns longer than 15 seconds instead, by the same rules. Only one of the two ever
shows.

![Pulse on the spinner during a long turn, in the receipts-only layout: Churning… · 1 tool · 5h 9% │ 𝕏 @claudeai · 6d: Claude Dashboards and Claude Motion are in b…](pulse.png)

## Links

In Claude Code's fullscreen layout, where it reports clicks, a plain click on the headline
opens it: g-line opens your browser itself (or, over SSH, copies the link for you to paste),
so it works the same in any terminal or multiplexer. Cmd-click still opens it the terminal's
way.

On the main screen a click belongs to the terminal, so the headline is a link wherever Claude
Code itself draws links: Ghostty, iTerm2, kitty, WezTerm, VS Code, Windows Terminal, Warp, and
tmux 3.4 or later. Cmd-click (ctrl-click on Linux) opens it.

Claude Code doesn't recognise herdr, Zellij or a session reached over SSH as terminals that
draw links. With Pulse on, g-line sets `FORCE_HYPERLINK=1` in Claude Code's own process (Claude
Code decides links on every draw), and its SessionStart hook unsets it again for Bash commands,
so tools don't print link codes into what Claude reads. If your terminal can't show links, set
`FORCE_HYPERLINK=0` where Claude Code starts; the address then prints after the headline.

`/g-line open` opens the headline showing, in any terminal. Over SSH, or on a machine with no
display, it copies the link instead, for your own terminal to paste.

## The reader

`/g-line news` lists every item in the feed, best first. The picked item is shown in full: who
and when, likes on 𝕏 or points on Hacker News, the story a post is about, the whole post, and
its link. The rest get one headline each.

| Key | Action |
| --- | --- |
| `j`, `k` | Move |
| `o`, Enter | Open |
| `d` | Open a Hacker News item's comments |
| `c` | Copy the link |
| `m` | Mute the picked item's source, or unmute it |
| `r` | Refresh |
| `q` | Close |

Items posted since you last opened the reader are marked **new**. A muted source stays in the
reader, marked **muted**, and leaves Pulse's row and the spinner. `pulse_mute` in
`config.json` does the same from a file (see [Configuration](configuration.md)).

![/g-line news: "3–6 of 8, best first · updated 43m ago" over the key row; the picked item, "Hacker News · 4h · ▲ 163", shows its full title, "163 points and 100 comments on Hacker News.", its link and a link to the comments; the items around it show one headline and their source each, such as "James Titcomb / Telegraph via Techmeme · 18h"](news.png)

## Where headlines come from

The feed is a static file built from public sources and labelled by source: posts on 𝕏 about
AI, Claude Code releases, Anthropic's news pages, Hacker News stories about Claude, Simon
Willison's AI posts, and a few items the maintainer picks. Posts on 𝕏 are the freshest part:
under two hours old, or gaining likes fast enough to stay up to a day, or big enough to stay up
to three days, and always about AI. No 𝕏 API key is involved: the builder finds posts through
the links Techmeme, AI subreddits and the Internet Archive carry. The builder is
`tools/pulse/build_pulse.py`; it runs on the maintainer's machine and isn't part of the mod.

## What it sends and keeps

With Pulse on, g-line fetches one file,
`raw.githubusercontent.com/lifeofgurpreet/g-line/pulse/pulse.json`, at most every 45 minutes.
It sends nothing about you, never fetches while drawing, and gives up after five seconds.
Headline text is stripped of escape and control characters before it reaches your terminal; the
only escape g-line draws is its own link, to an `https` address it has checked.

To apply the rules above across sessions, g-line remembers which headlines it showed and when,
for a day, in Claude Code's plugin store on your machine.

With Pulse off (the default), g-line makes no network requests.
