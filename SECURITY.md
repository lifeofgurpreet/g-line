# Security

g-line runs inside Claude Code with your permissions. It runs only the commands its README
lists, makes a network request only when Pulse is on, and writes only under `~/.cache` and
Claude Code's plugin store.

## Reporting a vulnerability

Please report security problems privately, through GitHub's
[private vulnerability reporting](https://github.com/lifeofgurpreet/g-line/security/advisories/new),
not in a public issue. Include the g-line and Claude Code versions and the steps to reproduce.
You'll get a reply within a week.

Examples of what counts:

- text from the Pulse feed or any other input reaching your terminal as escape sequences;
- g-line running a command or sending data the README doesn't describe;
- an account, path or other private detail showing where the README says it doesn't.

## Supported versions

Fixes go into the latest release. Update with `claude plugin update g-line`, or from `/plugin`.
