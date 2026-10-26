# Contributing to g-line

Bug reports, ideas and pull requests are welcome.

## Reporting a bug

Open an issue with:

- your Claude Code version (`claude --version`) and g-line version (`/plugin` lists it);
- your terminal and OS, and whether you're in tmux, Zellij or over SSH;
- what g-line drew and what you expected, ideally with a screenshot or the text of the line.

Leave out account emails, paths and anything from your conversation.

## Changing the code

Read [AGENTS.md](AGENTS.md) first. It holds the rules g-line stands on, a map of the code, and
recipes for the common changes. The short version:

- Never draw above the prompt, and never more than two lines.
- Use only figures Claude Code hands mods. Never parse the transcript or estimate what the engine
  reports, and make no network calls of your own.
- Private by default: no account, path, branch or repository name shows unless configured.
- Observe; steer only through rules the person wrote, and say so.

```sh
claude --plugin-dir .        # a session with your working copy; saving a file reloads the hooks
claude plugin validate .     # what the engine reads, the hooks and calls it sees, what it would refuse
claude plugin test .         # every test
```

A pull request should keep `claude plugin validate .` and `claude plugin test .` passing, add a
test for the behaviour it changes, and update the README or the page under `docs/` that
describes it. Screenshots must be real captures with no emails, account names, hostnames, home
paths or repository names in them.

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
