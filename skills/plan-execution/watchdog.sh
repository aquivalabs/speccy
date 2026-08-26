#!/usr/bin/env bash
# Watchdog for a running plan-execution workflow. Polls cheap git and
# filesystem state and prints a line only when a heuristic trips, so the
# Monitor running it stays silent through a healthy run. See SKILL.md
# (## While the workflow runs: watchdog) for what each line means.
#
# Usage: bash <skill-dir>/watchdog.sh <base-branch> <transcript-dir> [checkout]
#   base-branch     the branch the workflow commits to; progress is read from it
#   transcript-dir  the run's transcript dir, holding the agent-*.jsonl heartbeat
#   checkout        repository to read git state from (default: the cwd)
#
# It takes its inputs as arguments so a Monitor can arm it with one plain
# command by absolute path: a sandboxed session refuses a compound one.

set -o nounset

usage="usage: watchdog.sh <base-branch> <transcript-dir> [checkout]"
base="${1:?$usage}"
tdir="${2:?$usage}"
checkout="${3:-.}"

poll=75    # seconds between polls
stall=300  # idle seconds before the hard-stall line
beat=1500  # interval of the recurring health check-in

git_at() { git -C "$checkout" "$@" 2> /dev/null; }

# BSD and GNU stat disagree on the mtime flag; settle it once.
if stat -f %m . > /dev/null 2>&1; then
  mtime() { stat -f %m "$@" 2> /dev/null; }
else
  mtime() { stat -c %Y "$@" 2> /dev/null; }
fi

# Newest agent transcript mtime, 0 when the dir holds none yet. Reads metadata
# rather than contents, so it costs nothing and reveals nothing.
newest_transcript() {
  local newest
  newest="$(mtime "$tdir"/agent-*.jsonl | sort -rn | head -1)"
  echo "${newest:-0}"
}

if ! git_at rev-parse --verify --quiet "$base^{commit}" > /dev/null; then
  echo "watchdog: cannot resolve base branch '$base' in $checkout"
  exit 1
fi

start="$(git_at rev-parse "$base")"
start_ts="$(date +%s)"
warned_corrective=0
warned_stall=0
cap="$beat"

while true; do
  now="$(date +%s)"
  elapsed=$(( now - start_ts ))
  corrective="$(git_at log "$start..$base" --format='%s' | grep -cE '^CT-')"
  last_commit="$(git_at log -1 --format=%ct "$base")"
  last_commit="${last_commit:-0}"
  transcript="$(newest_transcript)"
  idle=$(( now - (last_commit > transcript ? last_commit : transcript) ))

  # Re-arm once it moves again, so a benign stall doesn't blind the watchdog.
  if [ "$idle" -le "$stall" ]; then warned_stall=0; fi

  if [ "$idle" -gt "$stall" ] && [ "$warned_stall" -eq 0 ]; then
    echo "STALL: idle $((idle / 60))m (elapsed $((elapsed / 60))m, $corrective corrective)"
    warned_stall=1
  fi

  if [ "$corrective" -ge 2 ] && [ "$warned_corrective" -eq 0 ]; then
    echo "WARN: $corrective corrective tasks — may be struggling (elapsed $((elapsed / 60))m)"
    warned_corrective=1
  fi

  if [ "$elapsed" -gt "$cap" ]; then
    echo "HEARTBEAT: elapsed $((elapsed / 60))m, still running ($corrective corrective) — health check-in"
    cap=$(( cap + beat ))
  fi

  sleep "$poll"
done
