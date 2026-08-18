#!/usr/bin/env bash
# Per-phase time and token metrics for a speccy run. Reads the harness
# transcripts after the fact; see metrics.mjs for why measurement can't happen
# live.
#
# Usage: bash <skill-dir>/metrics.sh [run-id]
# With no argument the run id comes from .speccy/.current-runid in the current
# directory, which keeps the wrap-up's call argument-free like the banner's.
#
# Like the banner, this must never block a run: no node, no transcripts, or a
# bad run id all print one line and exit 0.

set -o nounset

if ! command -v node > /dev/null 2>&1; then
  echo "speccy metrics: skipped (needs node on PATH)"
  exit 0
fi

reader="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)/metrics.mjs"

if [[ ! -f "$reader" ]]; then
  echo "speccy metrics: skipped (metrics.mjs not found next to metrics.sh)"
  exit 0
fi

node "$reader" "$@" || echo "speccy metrics: skipped (reader failed)"
exit 0
