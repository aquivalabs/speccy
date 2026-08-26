#!/usr/bin/env bash
# The convergence table for one review round: the round's lens files reduced to
# one ranked list of anchors. See triage.mjs for why the merge is a script.
#
# Usage: bash <skill-dir>/triage.sh <run-dir> <round> [--window N]
# <run-dir> is .speccy/<run-id>, or the run id itself. --window sets how many
# lines apart two findings can be and still count as the same anchor (5).
#
# Like the banner and the metrics reader, this must never block a run: no node,
# no lens files, or a bad argument all print one line and exit 0.

set -o nounset

if ! command -v node > /dev/null 2>&1; then
  echo "speccy triage: skipped (needs node on PATH)"
  exit 0
fi

reader="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)/triage.mjs"

if [[ ! -f "$reader" ]]; then
  echo "speccy triage: skipped (triage.mjs not found next to triage.sh)"
  exit 0
fi

node "$reader" "$@" || echo "speccy triage: skipped (reader failed)"
exit 0
