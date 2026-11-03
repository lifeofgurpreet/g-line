#!/bin/sh
# g-line's compaction commands, run by hooks.json beneath every hooks module.
#   pre:  PreCompact (automatic only). While keep-warm holds this session's cache
#         (~/.cache/g-line/hold/<session> names a second still to come), Claude
#         Code's automatic compaction of the idle main conversation waits: it
#         answers {"decision":"block"} and leaves hold/<session>.deferred.
#   post: PostCompact. Leaves ~/.cache/g-line/compacted/<session>.json, when and
#         by which trigger, for the mod to see the compaction.
# A subagent's compaction (agent_id) is left alone. Prints nothing else.
in=$(cat)
case "$in" in *'"agent_id"'*) exit 0 ;; esac
field() {
  printf '%s' "$in" | tr ',{}' '\n\n\n' | sed -n "s/^ *\"$1\" *: *\"\\([A-Za-z0-9_.-]*\\)\" *\$/\\1/p" | head -n 1
}
s=$(field session_id)
case "$s" in '' | *[!A-Za-z0-9_.-]*) exit 0 ;; esac
case "$1" in
pre)
  f="$HOME/.cache/g-line/hold/$s"
  [ -f "$f" ] || exit 0
  u=$(head -c 20 "$f" | cut -d. -f1 | tr -dc 0-9)
  [ -n "$u" ] && [ "$u" -gt "$(date +%s)" ] || exit 0
  date +%s >"$f.deferred"
  printf '%s\n' '{"decision":"block","reason":"g-line keep-warm is holding the cache of this idle conversation"}'
  ;;
post)
  t=$(field trigger)
  mkdir -p "$HOME/.cache/g-line/compacted" &&
    printf '{"at":%s,"trigger":"%s"}\n' "$(date +%s)" "$t" >"$HOME/.cache/g-line/compacted/$s.json"
  ;;
esac
exit 0
