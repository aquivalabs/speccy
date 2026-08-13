#!/usr/bin/env bash
# tests/fixtures/repo-builder.sh — the throwaway-repository
# builder used by Vehicle 3, the hand-run confirm-rule checklist in
# tests/confirm-rules.md. Not a test file itself and not run standalone:
# `source` it, then call its functions.
#
# The primitives (`mkrepo`, `commit_at`) match git-rules.test.sh's own copies
# byte for byte in behaviour, so a scenario staged here and one staged there
# produce identical git state. git-rules.test.sh keeps its own inline copies —
# it predates this file and is out of scope to edit — so this is a second,
# reusable source for the two consumers built after it, not a replacement.
set -u

# mkrepo dir — a fresh repo with a deterministic identity, no signing prompts.
mkrepo() {
  local r="$1"
  mkdir -p "$r"
  git -C "$r" init -q -b main
  git -C "$r" config user.email t@t
  git -C "$r" config user.name t
  git -C "$r" config commit.gpgsign false
}

# commit_at repo iso-date -m message [git-commit-flags...] — a commit at a
# fixed, deterministic date. Needed wherever two commits with the same tree,
# parent, author and message would otherwise land in the same second and
# collide on the same hash.
commit_at() {
  local r="$1" d="$2" m="$3"; shift 3
  GIT_AUTHOR_DATE="$d" GIT_COMMITTER_DATE="$d" git -C "$r" commit -q -m "$m" "$@"
}

# write_governing_doc repo — CLAUDE.md naming the one concrete verification
# command a build-break injection can trip. The command is real: it builds the
# fixture's source tree via scripts/verify.sh and fails loudly when a caller
# renames or removes a symbol another file still references.
write_governing_doc() {
  local r="$1"
  cat > "$r/CLAUDE.md" <<'EOF'
# Fixture project

This is a generated acceptance fixture for the stranded-task-recovery change
(skills/plan-execution). It is not a real product.

## Verification

Run this before every commit and before every integration:

    ./scripts/verify.sh

It builds the project (sources every `src/lib/*.sh` file through
`src/entrypoint.sh`) and runs the unit tests in `tests/run.sh`. Both steps
print `ok` on success. A caller that renames or removes a function another
file still references fails the build step with "command not found" — this is
the one thing an integration-time build-break injection trips.

No lint step, no static-analysis step, no separate typecheck. `verify.sh` is
the whole gate.
EOF
}

# write_source_tree repo — a small, real source tree the governing doc's
# command executes. `greet` is called from `report`, so renaming `greet`
# without updating `report` breaks the build in combination, not on its own —
# the shape R1's injection needs. `verify.sh`'s build step writes an untracked
# `dist/` directory, which is the gate-byproduct shape the no-op predicate's
# porcelain cross-check must not fail on.
write_source_tree() {
  local r="$1"
  mkdir -p "$r/src/lib" "$r/tests" "$r/scripts"

  cat > "$r/src/lib/greet.sh" <<'EOF'
#!/usr/bin/env bash
greet() { echo "Hello, fixture!"; }
EOF

  cat > "$r/src/lib/report.sh" <<'EOF'
#!/usr/bin/env bash
report() { greet; }
EOF

  cat > "$r/src/entrypoint.sh" <<'EOF'
#!/usr/bin/env bash
set -eu
HERE="$(cd "$(dirname "$0")" && pwd)"
source "$HERE/lib/greet.sh"
source "$HERE/lib/report.sh"
report
EOF

  cat > "$r/tests/run.sh" <<'EOF'
#!/usr/bin/env bash
set -eu
HERE="$(cd "$(dirname "$0")/.." && pwd)"
out="$(bash "$HERE/src/entrypoint.sh")"
if [ "$out" = "Hello, fixture!" ]; then
  echo "tests ok"
else
  echo "tests FAILED: got [$out]"
  exit 1
fi
EOF

  cat > "$r/scripts/verify.sh" <<'EOF'
#!/usr/bin/env bash
set -u
HERE="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p "$HERE/dist"
echo "=== build ==="
if bash "$HERE/src/entrypoint.sh" > "$HERE/dist/build.log" 2>&1; then
  echo "build ok"
else
  echo "build FAILED"
  cat "$HERE/dist/build.log"
  exit 1
fi
echo "=== tests ==="
if bash "$HERE/tests/run.sh"; then
  exit 0
else
  echo "tests FAILED"
  exit 1
fi
EOF

  chmod +x "$r/scripts/verify.sh" "$r/src/entrypoint.sh" "$r/tests/run.sh"
}

# write_worktree_settings repo — the one setting worktree tasks cannot start
# without in a freshly generated repository that has no `origin`
# (SKILL.md:22 / decision log § The acceptance venue).
write_worktree_settings() {
  local r="$1"
  mkdir -p "$r/.claude"
  cat > "$r/.claude/settings.json" <<'EOF'
{
  "worktree": {
    "baseRef": "head"
  }
}
EOF
}

# write_gitignore repo [--track-tasks] — .tasks/ is gitignored by default.
# Pass --track-tasks to leave the entry out instead, which is R4's one
# deviation: it dirties the main checkout with the breakdown agent's own
# `.gitignore` ensure and `.tasks/<runId>/` writes, so the no-op predicate's
# porcelain cross-check is exercised live against a non-empty baseline rather
# than a checkout clean by construction.
write_gitignore() {
  local r="$1" mode="${2:-}"
  if [ "$mode" = "--track-tasks" ]; then
    : > "$r/.gitignore"
  else
    printf '.tasks/\n' > "$r/.gitignore"
  fi
}

# seed_worktree_branch repo name task_id iso-date — one of the three seeded
# `worktree-*` branches whose work provably landed: its tip predates the run's
# `started_at_epoch`, and its subject carries a task id this run's own tasks
# will reuse (R5's ref-namespacing subject, and the tie-rule's date test).
# Left checked out nowhere — teardown only ever reads it, this generator never
# provisions a live worktree for it.
seed_worktree_branch() {
  local r="$1" name="$2" task_id="$3" d="$4"
  local cur
  cur="$(git -C "$r" branch --show-current)"
  git -C "$r" checkout -q -b "$name"
  echo "seeded by $name" >> "$r/SEEDED.md"
  git -C "$r" add -A
  commit_at "$r" "$d" "${task_id}: seeded landed work ($name)"
  git -C "$r" checkout -q "$cur"
}

# base_epoch_before_now offset_seconds — an ISO-8601 date `offset_seconds`
# before the current time, for a seeded branch tip that must predate
# `started_at_epoch`. Kept in one place so every caller uses the same clock
# rather than a hand-picked constant that drifts stale.
base_epoch_before_now() {
  local offset="$1"
  date -u -v-"${offset}"S +%Y-%m-%dT%H:%M:%S 2>/dev/null \
    || date -u -d "@$(( $(date -u +%s) - offset ))" +%Y-%m-%dT%H:%M:%S
}
