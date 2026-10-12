#!/bin/sh
# glanceline status line fallback installer.
#
#   curl -fsSL https://raw.githubusercontent.com/lifeofgurpreet/glanceline/main/install.sh | sh
#   curl -fsSL .../install.sh | sh -s -- --dry-run
#
# Copies glanceline.py to ~/.local/bin/glanceline and sets the `statusLine`
# key of your Claude Code settings (only that key, after a backup). Undo with
# `glanceline uninstall`. On Claude Code 2.1.293 or later, prefer the mod:
#   /plugin install glanceline --marketplace lifeofgurpreet/glanceline
set -eu

repo="${GLANCELINE_REPO:-lifeofgurpreet/glanceline}"
ref="${GLANCELINE_REF:-main}"
bin="${GLANCELINE_BIN:-$HOME/.local/bin}"

say() { printf 'glanceline: %s\n' "$*"; }
die() { say "$*" >&2; exit 1; }

command -v python3 >/dev/null 2>&1 || die "python3 is required (3.8 or later)"
python3 -c 'import sys; sys.exit(0 if sys.version_info >= (3, 8) else 1)' || die "python3 3.8 or later is required"

tmp="$(mktemp "${TMPDIR:-/tmp}/glanceline.XXXXXX")"
trap 'rm -f "$tmp"' EXIT INT TERM

here="$(cd "$(dirname "$0")" 2>/dev/null && pwd || true)"
if [ -n "$here" ] && [ -f "$here/glanceline.py" ] && [ -f "$here/hooks/core.ts" ]; then
  cp "$here/glanceline.py" "$tmp"                      # run from a checkout
else
  command -v curl >/dev/null 2>&1 || die "curl is required"
  curl -fsSL "https://raw.githubusercontent.com/$repo/$ref/glanceline.py" -o "$tmp" || die "download failed"
fi

python3 "$tmp" --version >/dev/null 2>&1 || die "the downloaded script does not run; nothing was changed"

mkdir -p "$bin"
cp "$tmp" "$bin/glanceline"
chmod 0755 "$bin/glanceline"
say "installed $bin/glanceline ($(python3 "$bin/glanceline" --version))"

"$bin/glanceline" install --command "$bin/glanceline" "$@"

version="$(claude --version 2>/dev/null | sed -n 's/^\([0-9][0-9.]*\).*/\1/p' | head -n 1 || true)"
if [ -n "$version" ] && python3 - "$version" <<'EOF'
import sys
parts = tuple(int(p) for p in sys.argv[1].split(".")[:3])
sys.exit(0 if parts >= (2, 1, 293) else 1)
EOF
then
  say "your Claude Code ($version) runs mods. For live updates and heads-up toasts, type in a session:"
  say "  /plugin install glanceline --marketplace $repo"
fi
say "done. Undo with: glanceline uninstall"
