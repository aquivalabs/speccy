#!/usr/bin/env bash
# tests/git-rules.test.sh — Vehicle 1 for the stranded-task-recovery change
# (skills/plan-execution/{workflow.js,prompts.md}).
#
# TWO SUBJECTS, and the second is not obvious from the first — read both before adding a
# scenario.
#
# Subject 1, scenarios 1-11: git rules, asserted against throwaway repositories this file builds
# under `mktemp -d`. Every scenario transcribes a behaviour that was measured against a real
# repository first and is named in the scenario's own heading comment — this file is
# transcription plus assertion, not discovery.
#
# Subject 2, scenario 12: the prompt text itself. That group greps
# ../skills/plan-execution/prompts.md — a file two directories above the fixtures the git
# scenarios build, and nothing to do with any repository this file creates. It asserts that each
# rule's load-bearing command and each anchored-line name is still literally in the section that
# has to carry it. The git group proves those commands produce the verdicts the spec claims; the
# prompt group proves the prompts still name those commands. Without it, an edit that drops a
# command or renames an anchored line breaks the design and no automated suite notices.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
pass=0; fail=0

# check desc expected actual — generic string/exit-code comparator, the house idiom
# (scripts/eval-gate.test.sh, scripts/scout-gate.test.sh).
check() {
  if [ "$2" = "$3" ]; then echo "  ok: $1"; pass=$((pass+1));
  else echo "  FAIL: $1 (want [$2], got [$3])"; fail=$((fail+1)); fi
}

ROOT="$(mktemp -d)"
trap 'rm -rf "$ROOT"' EXIT

# mkrepo dir — a fresh repo with a deterministic identity, no signing prompts.
mkrepo() {
  local r="$1"
  mkdir -p "$r"
  git -C "$r" init -q -b main
  git -C "$r" config user.email t@t
  git -C "$r" config user.name t
  git -C "$r" config commit.gpgsign false
}

# commit_at repo iso-date -m message [git-commit-flags...] — a commit at a fixed, deterministic
# date. Needed wherever a branch commit and the squash commit that later re-commits its content
# would otherwise land in the same second with the same tree, parent, author and message and
# collide on the same hash (measured while building this suite).
commit_at() {
  local r="$1" d="$2" m="$3"; shift 3
  GIT_AUTHOR_DATE="$d" GIT_COMMITTER_DATE="$d" git -C "$r" commit -q -m "$m" "$@"
}

# ---------------------------------------------------------------------------------------------
# Scenario 1 — the four verification conditions, including the empty commit, the root commit
# and the merge tip that condition 4's flags exist for.
# Decision log: "The four verification conditions, and why three are not enough".
# ---------------------------------------------------------------------------------------------
echo "=== Scenario 1: the four verification conditions ==="
r="$ROOT/s1"; mkrepo "$r"
echo base > "$r/a.txt"; git -C "$r" add -A; commit_at "$r" "2020-01-01T00:00:00" base
base_sha="$(git -C "$r" rev-parse HEAD)"

# Condition 1 — a blob is not a commit. `cat-file -e` alone can't tell them apart; the named
# command (`rev-parse --verify <hash>^{commit}`) can.
blob="$(git -C "$r" hash-object -w --stdin <<< "not a commit")"
cat_e="$(git -C "$r" cat-file -e "$blob" >/dev/null 2>&1; echo $?)"
check "cond1 contrast: cat-file -e succeeds on a blob (why it's not enough)" 0 "$cat_e"
verify_blob="$(git -C "$r" rev-parse --verify "${blob}^{commit}" >/dev/null 2>&1; echo $?)"
check "cond1: rev-parse --verify <blob>^{commit} rejects a blob" 128 "$verify_blob"
verify_commit="$(git -C "$r" rev-parse --verify "${base_sha}^{commit}" >/dev/null 2>&1; echo $?)"
check "cond1: rev-parse --verify <commit>^{commit} accepts a real commit" 0 "$verify_commit"

# Condition 2 — subject prefix. A do-nothing sequential task at a later step reports HEAD
# (t1's commit) as its own. Condition 3 alone (is-ancestor of the run-start base_sha) passes it;
# only the subject check (condition 2) fails it.
echo more > "$r/b.txt"; git -C "$r" add -A; commit_at "$r" "2020-01-01T00:01:00" "t1: first task"
t1_sha="$(git -C "$r" rev-parse HEAD)"
cond3_alone="$(git -C "$r" merge-base --is-ancestor "$t1_sha" "$base_sha" >/dev/null 2>&1; echo $?)"
check "cond3 alone on a do-nothing task reporting HEAD: non-zero = passes the guard" 1 "$cond3_alone"
subject="$(git -C "$r" log -1 --format=%s "$t1_sha")"
case "$subject" in "t2: "*) cond2="pass" ;; *) cond2="fail" ;; esac
check "cond2 (subject 't2: ') correctly fails the do-nothing task" "fail" "$cond2"

# Condition 4, and why the flag set matters — root, normal, empty and merge-tip shapes.
r2="$ROOT/s1-cond4"; mkrepo "$r2"
echo root > "$r2/a.txt"; git -C "$r2" add -A; commit_at "$r2" "2020-01-01T00:00:00" "root commit"
root_sha="$(git -C "$r2" rev-parse HEAD)"
echo normal >> "$r2/a.txt"; git -C "$r2" add -A; commit_at "$r2" "2020-01-01T00:01:00" "t5: normal commit"
normal_sha="$(git -C "$r2" rev-parse HEAD)"
commit_at "$r2" "2020-01-01T00:02:00" "t9: implement the widget" --allow-empty
empty_sha="$(git -C "$r2" rev-parse HEAD)"
git -C "$r2" checkout -qb feature
echo feature-file > "$r2/s.txt"; git -C "$r2" add -A; commit_at "$r2" "2020-01-01T00:03:00" "feature work"
git -C "$r2" checkout -q main
git -C "$r2" merge --no-ff -q feature -m "merge feature into main"
merge_sha="$(git -C "$r2" rev-parse HEAD)"

combined() { git -C "$r2" diff-tree --no-commit-id --name-only -r --root -m --first-parent "$1"; }
alt_form() { git -C "$r2" show --pretty=format: --name-only "$1"; }

check "cond4 combined form: root commit changes a path" "1" "$(combined "$root_sha" | grep -c .)"
check "cond4 combined form: normal commit changes a path" "1" "$(combined "$normal_sha" | grep -c .)"
check "cond4 combined form: empty commit (--allow-empty) changes no path" "0" "$(combined "$empty_sha" | grep -c .)"
check "cond4 combined form: merge tip changes a path (needs --root -m --first-parent)" "1" "$(combined "$merge_sha" | grep -c .)"
check "cond4 naive alternative (git show --pretty=format: --name-only) misses the merge tip" "0" "$(alt_form "$merge_sha" | grep -c .)"

# ---------------------------------------------------------------------------------------------
# Scenario 2 — condition 3 against base_sha and against the moved tip.
# Decision log: "Condition 3's command, and its comparison point".
# ---------------------------------------------------------------------------------------------
echo "=== Scenario 2: condition 3 against base_sha and against the moved tip ==="
r="$ROOT/s2"; mkrepo "$r"
echo base > "$r/a.txt"; git -C "$r" add -A; commit_at "$r" "2020-01-01T00:00:00" base
run_start_base_sha="$(git -C "$r" rev-parse HEAD)"
echo work > "$r/w.txt"; git -C "$r" add -A; commit_at "$r" "2020-01-01T00:01:00" "task-2: sequential work"
task_sha="$(git -C "$r" rev-parse HEAD)"
against_base_sha="$(git -C "$r" merge-base --is-ancestor "$task_sha" "$run_start_base_sha" >/dev/null 2>&1; echo $?)"
check "condition 3 against base_sha: not contained, verifies (non-zero)" 1 "$against_base_sha"
against_head_same_state="$(git -C "$r" merge-base --is-ancestor "$task_sha" HEAD >/dev/null 2>&1; echo $?)"
check "condition 3 against HEAD (== task's own commit here): contained, would wrongly unverify" 0 "$against_head_same_state"

# The base moves on: a later commit lands on main after the task's own commit.
echo later > "$r/c.txt"; git -C "$r" add -A; commit_at "$r" "2020-01-01T00:02:00" "task-3: later work"
moved_tip="$(git -C "$r" rev-parse HEAD)"
still_against_base_sha="$(git -C "$r" merge-base --is-ancestor "$task_sha" "$run_start_base_sha" >/dev/null 2>&1; echo $?)"
check "condition 3 against base_sha after the base moved: still not contained, still verifies" 1 "$still_against_base_sha"
against_moved_tip="$(git -C "$r" merge-base --is-ancestor "$task_sha" "$moved_tip" >/dev/null 2>&1; echo $?)"
check "condition 3 against the moved tip: contained, would unverify every sequential task" 0 "$against_moved_tip"

# ---------------------------------------------------------------------------------------------
# Scenario 3 — the landed-content check: the five measured directions, the moved-tip-vs-
# recorded-squash-commit direction, the base-tip fallback, and the empty-touched-path keep.
# Decision log: "The landed-content check replaces patch equivalence" and
# "The comparison point is the recorded squash commit, not the base tip".
# ---------------------------------------------------------------------------------------------
echo "=== Scenario 3: the landed-content check ==="

touched_paths() { local r="$1" branch="$2" mb; mb="$(git -C "$r" merge-base main "$branch")"; git -C "$r" diff --name-only "$mb" "$branch"; }
diff_vs() { local r="$1" branch="$2" comparepoint="$3"; shift 3; git -C "$r" diff "$branch" "$comparepoint" -- "$@" | wc -l | tr -d ' '; }
cherry_plus() { local r="$1" upstream="$2" branch="$3"; git -C "$r" cherry "$upstream" "$branch" | grep -c '^+' || true; }

# Direction 1 — single: one commit, squash-merged. Byte-identical -> DELETE.
r="$ROOT/s3-single"; mkrepo "$r"
echo base > "$r/a.txt"; git -C "$r" add -A; commit_at "$r" "2020-01-01T00:00:00" base
git -C "$r" checkout -qb work
echo w1 > "$r/w.txt"; git -C "$r" add -A; commit_at "$r" "2020-01-01T00:01:00" "wip: add w1"
git -C "$r" checkout -q main; git -C "$r" merge --squash -q work >/dev/null
commit_at "$r" "2020-01-01T00:02:00" "task-a: add w1"
squash="$(git -C "$r" rev-parse HEAD)"
paths="$(touched_paths "$r" work)"
check "single: byte-identical against the recorded squash commit -> DELETE" "0" "$(diff_vs "$r" work "$squash" $paths)"

# Direction 2 — multi: two commits, squash-merged. `git cherry` alone reports both unmerged
# (>0, patch-equivalence would KEEP); the diff-only rule correctly says DELETE.
r="$ROOT/s3-multi"; mkrepo "$r"
echo base > "$r/a.txt"; git -C "$r" add -A; commit_at "$r" "2020-01-01T00:00:00" base
git -C "$r" checkout -qb work
echo w1 > "$r/w.txt"; git -C "$r" add -A; commit_at "$r" "2020-01-01T00:01:00" "task-a: part 1"
echo w2 >> "$r/w.txt"; git -C "$r" add -A; commit_at "$r" "2020-01-01T00:02:00" "task-a: part 2"
git -C "$r" checkout -q main; git -C "$r" merge --squash -q work >/dev/null
commit_at "$r" "2020-01-01T00:03:00" "task-a: squashed two"
squash="$(git -C "$r" rev-parse HEAD)"
paths="$(touched_paths "$r" work)"
cherry="$(cherry_plus "$r" main work)"
if [ "$cherry" -gt 0 ]; then cherry_would_keep="would-keep"; else cherry_would_keep="unexpected"; fi
check "multi: git cherry alone reports unmerged commits (patch-equivalence would KEEP)" "would-keep" "$cherry_would_keep"
check "multi: diff-only rule against the recorded squash commit -> DELETE (correct)" "0" "$(diff_vs "$r" work "$squash" $paths)"

# Direction 3 — marker: an empty-commit branch, squash-merged. Touched-path set is empty ->
# kept, and the landed-content check is never even invoked (see the empty-touched-path
# assertion below, which shows why: an empty pathspec degrades to a whole-tree diff).
r="$ROOT/s3-marker"; mkrepo "$r"
echo base > "$r/a.txt"; git -C "$r" add -A; commit_at "$r" "2020-01-01T00:00:00" base
git -C "$r" checkout -qb work
commit_at "$r" "2020-01-01T00:01:00" "task-a: marker only" --allow-empty
git -C "$r" checkout -q main; git -C "$r" merge --squash -q work >/dev/null 2>&1 || true
commit_at "$r" "2020-01-01T00:02:00" "task-a: marker only" --allow-empty
paths="$(touched_paths "$r" work)"
check "marker: touched-path set is empty" "0" "$(printf '%s' "$paths" | grep -c .)"

# Direction 4 — unlanded: real unlanded work, never merged, no squash commit recorded -> falls
# back to a diff against the base tip. Non-empty -> KEEP.
r="$ROOT/s3-unlanded"; mkrepo "$r"
echo base > "$r/a.txt"; git -C "$r" add -A; commit_at "$r" "2020-01-01T00:00:00" base
base_tip="$(git -C "$r" rev-parse HEAD)"
git -C "$r" checkout -qb work
echo w1 > "$r/w.txt"; git -C "$r" add -A; commit_at "$r" "2020-01-01T00:01:00" "task-a: unlanded work"
git -C "$r" checkout -q main
paths="$(touched_paths "$r" work)"
check "unlanded (base-tip fallback, no recorded squash): diff against the base tip is non-empty -> KEEP" "1" "$([ "$(diff_vs "$r" work "$base_tip" $paths)" -gt 0 ] && echo 1 || echo 0)"

# Direction 5 — ws: the base moved by whitespace only. `git cherry` alone reads the branch as
# already landed (no unmerged commits); the content diff correctly proves the trees differ.
r="$ROOT/s3-ws"; mkrepo "$r"
printf 'hello\n' > "$r/w.txt"; git -C "$r" add -A; commit_at "$r" "2020-01-01T00:00:00" base
git -C "$r" checkout -qb work
printf 'hello\n' > "$r/w.txt"; git -C "$r" add -A; commit_at "$r" "2020-01-01T00:01:00" "task-a: ws work" --allow-empty
git -C "$r" checkout -q main
printf 'hello \n' > "$r/w.txt"; git -C "$r" add -A; commit_at "$r" "2020-01-01T00:02:00" "reformat: trailing space"
tip="$(git -C "$r" rev-parse HEAD)"
check "ws: content diff proves the trees differ (non-empty) -> KEEP" "1" "$([ "$(git -C "$r" diff work "$tip" -- w.txt | wc -l | tr -d ' ')" -gt 0 ] && echo 1 || echo 0)"

# Direction 6 — the moved-tip-vs-recorded-squash-commit direction. A LATER task edits the same
# path on base after the first task's squash landed; against the moved tip a provably landed
# branch reads unlanded (would KEEP forever); against the recorded squash commit it still reads
# landed (correctly DELETE).
r="$ROOT/s3-movedtip"; mkrepo "$r"
echo base > "$r/shared.txt"; git -C "$r" add -A; commit_at "$r" "2020-01-01T00:00:00" base
git -C "$r" checkout -qb taskA
printf 'line-a\n' >> "$r/shared.txt"; git -C "$r" add -A; commit_at "$r" "2020-01-01T00:01:00" "task-a: edit shared"
git -C "$r" checkout -q main; git -C "$r" merge --squash -q taskA >/dev/null
commit_at "$r" "2020-01-01T00:02:00" "task-a: edit shared"
squash="$(git -C "$r" rev-parse HEAD)"
printf 'line-b\n' >> "$r/shared.txt"; git -C "$r" add -A; commit_at "$r" "2020-01-01T00:03:00" "task-b: also touches shared"
later_tip="$(git -C "$r" rev-parse HEAD)"
check "moved tip: diff against the current base tip is non-empty (would wrongly KEEP a landed branch forever)" "1" "$([ "$(git -C "$r" diff taskA "$later_tip" -- shared.txt | wc -l | tr -d ' ')" -gt 0 ] && echo 1 || echo 0)"
check "recorded squash commit: still byte-identical -> correctly DELETE despite the base having moved" "0" "$(git -C "$r" diff taskA "$squash" -- shared.txt | wc -l | tr -d ' ')"

# Empty-touched-path keep, made concrete: an empty pathspec after `--` is NOT "compare nothing" —
# it degrades to a whole-tree diff, which is why the rule special-cases the empty set instead of
# ever calling diff with it.
r="$ROOT/s3-emptypath"; mkrepo "$r"
echo base > "$r/a.txt"; git -C "$r" add -A; commit_at "$r" "2020-01-01T00:00:00" base
git -C "$r" checkout -qb noop-work
commit_at "$r" "2020-01-01T00:01:00" "task-a: no-op, touched nothing" --allow-empty
git -C "$r" checkout -q main
echo "unrelated later edit" >> "$r/a.txt"; git -C "$r" add -A; commit_at "$r" "2020-01-01T00:02:00" "task-b: unrelated edit"
check "empty pathspec degrades to a whole-tree diff (why the empty set is special-cased, never diffed)" "1" "$([ "$(git -C "$r" diff noop-work main -- | wc -l | tr -d ' ')" -gt 0 ] && echo 1 || echo 0)"

# ---------------------------------------------------------------------------------------------
# Scenario 4 — the create-only ref write's replay and collision.
# Decision log: "The two ref-write forms".
# ---------------------------------------------------------------------------------------------
echo "=== Scenario 4: create-only ref write, replay and collision ==="
r="$ROOT/s4"; mkrepo "$r"
echo base > "$r/a.txt"; git -C "$r" add -A; commit_at "$r" "2020-01-01T00:00:00" base
echo work1 > "$r/w.txt"; git -C "$r" add -A; commit_at "$r" "2020-01-01T00:01:00" "task-1: work"
sha1="$(git -C "$r" rev-parse HEAD)"
echo more1 >> "$r/w.txt"; git -C "$r" add -A; commit_at "$r" "2020-01-01T00:02:00" "task-1: more work (retry)"
sha1b="$(git -C "$r" rev-parse HEAD)"
REF="refs/task/run1/task-1"

first_write="$(git -C "$r" update-ref "$REF" "$sha1" "" >/dev/null 2>&1; echo $?)"
check "create-only: first write succeeds" 0 "$first_write"
replay="$(git -C "$r" update-ref "$REF" "$sha1" "" >/dev/null 2>&1; echo $?)"
check "create-only: replay of the same sha is refused as loudly as a collision" 128 "$replay"
collision="$(git -C "$r" update-ref "$REF" "$sha1b" "" >/dev/null 2>&1; echo $?)"
check "create-only: a different sha (collision) is also refused" 128 "$collision"
check "create-only: the ref still holds its first write, untouched by the refused attempts" "$sha1" "$(git -C "$r" rev-parse "$REF")"

# ---------------------------------------------------------------------------------------------
# Scenario 5 — the confirm agent's compare-and-swap move.
# Decision log: "The two ref-write forms" (the CAS half).
# ---------------------------------------------------------------------------------------------
echo "=== Scenario 5: the confirm agent's compare-and-swap move ==="
cas_move="$(git -C "$r" update-ref "$REF" "$sha1b" "$sha1" >/dev/null 2>&1; echo $?)"
check "CAS move with the correct expected old value succeeds" 0 "$cas_move"
check "CAS move: the ref now points at the verified commit" "$sha1b" "$(git -C "$r" rev-parse "$REF")"
stale_cas="$(git -C "$r" update-ref "$REF" "$sha1" "$sha1" >/dev/null 2>&1; echo $?)"
check "CAS move with a stale expected old value is refused" 128 "$stale_cas"
check "CAS refusal: the ref is unchanged by the refused attempt" "$sha1b" "$(git -C "$r" rev-parse "$REF")"

# ---------------------------------------------------------------------------------------------
# Scenario 6 — a ref written from inside a linked worktree, read from the main checkout.
# Decision log: "The task ref is durable, harmless, and visible from the main checkout".
# ---------------------------------------------------------------------------------------------
echo "=== Scenario 6: a ref written inside a linked worktree, read from the main checkout ==="
git -C "$r" branch wt-branch "$sha1"
wt="$ROOT/s6-wt"
git -C "$r" worktree add -q "$wt" wt-branch
echo wtwork >> "$wt/w.txt"; git -C "$wt" add -A; commit_at "$wt" "2020-01-01T00:03:00" "task-7: worktree work"
wt_sha="$(git -C "$wt" rev-parse HEAD)"
wt_write="$(git -C "$wt" update-ref "refs/task/run1/task-7" "$wt_sha" "" >/dev/null 2>&1; echo $?)"
check "write from inside the linked worktree succeeds" 0 "$wt_write"
check "the ref is visible from the MAIN checkout, equal to the worktree's own commit" "$wt_sha" "$(git -C "$r" rev-parse refs/task/run1/task-7)"
common_dir="$(git -C "$wt" rev-parse --git-common-dir)"
private_dir="$(git -C "$wt" rev-parse --git-dir)"
check "the ref file lives in the shared .git/refs (common dir)" "yes" \
  "$([ -f "$common_dir/refs/task/run1/task-7" ] && echo yes || echo no)"
check "the ref file does NOT live under the worktree's own private ref store" "no" \
  "$([ -f "$private_dir/refs/task/run1/task-7" ] && echo yes || echo no)"

# ---------------------------------------------------------------------------------------------
# Scenario 7 — the tie rule's date comparison, in each of the three formats, including the
# +03:00 tip 28 minutes before run start.
# Decision log: "The tie rule's date comparison is epoch seconds, and no other format".
# ---------------------------------------------------------------------------------------------
echo "=== Scenario 7: the tie rule in all three date formats ==="
r="$ROOT/s7"; mkrepo "$r"
echo base > "$r/a.txt"; git -C "$r" add -A; commit_at "$r" "2020-01-01T00:00:00" base

started_at="2026-08-06T08:28:05Z"
started_at_epoch="$(date -u -j -f "%Y-%m-%dT%H:%M:%SZ" "$started_at" +%s 2>/dev/null || date -u -d "$started_at" +%s)"

# worktree-old: tip two days before run start.
git -C "$r" checkout -qb worktree-old
echo old > "$r/old.txt"; git -C "$r" add -A
commit_at "$r" "2026-08-04T12:00:00+03:00" "task-7: old work"

# worktree-tz: tip 28 minutes before run start, +03:00 offset (never normalised to UTC by %cI).
git -C "$r" checkout -q main
git -C "$r" checkout -qb worktree-tz
echo tz > "$r/tz.txt"; git -C "$r" add -A
commit_at "$r" "2026-08-06T11:00:05+03:00" "task-8: tz work"

tie_by_ct() { # branch -> "TIED" or "predates", using the in-contract epoch comparison
  local tip ct
  tip="$(git -C "$r" rev-parse "$1")"
  ct="$(git -C "$r" log -1 --format=%ct "$tip")"
  if [ "$ct" -ge "$started_at_epoch" ]; then echo "TIED"; else echo "predates"; fi
}
tie_by_cd() { # branch -> string-compared %cd against started_at (git's default form)
  local tip cd
  tip="$(git -C "$r" rev-parse "$1")"
  cd="$(git -C "$r" log -1 --format=%cd "$tip")"
  if [[ "$cd" > "$started_at" ]]; then echo "TIED"; else echo "predates"; fi
}
tie_by_ci() { # branch -> string-compared %cI against started_at (the plausible ISO fix)
  local tip ci
  tip="$(git -C "$r" rev-parse "$1")"
  ci="$(git -C "$r" log -1 --format=%cI "$tip")"
  if [[ "$ci" > "$started_at" ]]; then echo "TIED"; else echo "predates"; fi
}

check "worktree-old (2 days before run): %ct correctly says predates" "predates" "$(tie_by_ct worktree-old)"
check "worktree-old: %cd wrongly ties it (string sort: 'Tue Aug 4' vs ISO 'started_at')" "TIED" "$(tie_by_cd worktree-old)"
check "worktree-old: %cI correctly says predates" "predates" "$(tie_by_ci worktree-old)"

check "worktree-tz (28 min before run, +03:00): %ct correctly says predates" "predates" "$(tie_by_ct worktree-tz)"
check "worktree-tz: %cd wrongly ties it" "TIED" "$(tie_by_cd worktree-tz)"
check "worktree-tz: %cI ALSO wrongly ties it (a +03:00 offset is never normalised to UTC)" "TIED" "$(tie_by_ci worktree-tz)"

# ---------------------------------------------------------------------------------------------
# Scenario 8 — the fallback search's --branches form against a worktree task's commit, where
# the range form finds nothing.
# Decision log: "The fallback search's reachability half needs a named command".
# ---------------------------------------------------------------------------------------------
echo "=== Scenario 8: the fallback search's --branches form vs the range form ==="
r="$ROOT/s8"; mkrepo "$r"
echo base > "$r/a.txt"; git -C "$r" add -A; commit_at "$r" "2020-01-01T00:00:00" base
base_sha="$(git -C "$r" rev-parse HEAD)"
git -C "$r" branch wtb "$base_sha"
wt="$ROOT/s8-wt"
git -C "$r" worktree add -q "$wt" wtb
echo wtwork > "$wt/w.txt"; git -C "$wt" add -A; commit_at "$wt" "2020-01-01T00:01:00" "task-3: worktree work"
wt_sha="$(git -C "$wt" rev-parse HEAD)"

range_form="$(git -C "$r" log "$base_sha"..HEAD --grep '^task-3: ' --format=%H)"
branches_form="$(git -C "$r" log --branches --not "$base_sha" --grep '^task-3: ' --format=%H)"
check "range form (base_sha..HEAD), run from the main checkout, finds nothing" "" "$range_form"
check "--branches form finds the worktree task's own commit" "$wt_sha" "$branches_form"

# ---------------------------------------------------------------------------------------------
# Scenario 9 — the integrate recognition over two runs sharing a task id, scoped and unscoped.
# Decision log: "The integrate agent is not idempotent, and it is wrapped in a retry".
# ---------------------------------------------------------------------------------------------
echo "=== Scenario 9: integrate recognition over two runs sharing a task id ==="
r="$ROOT/s9"; mkrepo "$r"
echo base > "$r/a.txt"; git -C "$r" add -A; commit_at "$r" "2020-01-01T00:00:00" base
echo f1 > "$r/f1.txt"; git -C "$r" add -A; commit_at "$r" "2020-01-01T00:01:00" "task-1: add f1"
run1_squash="$(git -C "$r" rev-parse HEAD)"
run2_base="$run1_squash"
# run2 reuses task-1's id; its own attempt lands nothing new (e.g. a conflict resolved in
# favour of the base) — the base carries only run1's squash commit for that id.

unscoped="$(git -C "$r" log -1 --grep '^task-1: ' --format=%H)"
check "unscoped recognition wrongly returns run1's squash commit for run2" "$run1_squash" "$unscoped"
scoped="$(git -C "$r" log "$run2_base"..HEAD --format='%H %s' | grep '^[0-9a-f]* task-1: ' || true)"
check "run2-scoped recognition (run2_base..HEAD) correctly reports no landed integration for run2" "" "$scoped"

# ---------------------------------------------------------------------------------------------
# Scenario 10 — a commit whose body line starts with a task id that neither --grep form may
# be trusted with.
# Decision log: "Both scoped commands match the subject, not the message body".
# ---------------------------------------------------------------------------------------------
echo "=== Scenario 10: a body line starting with a task id fools plain --grep ==="
r="$ROOT/s10"; mkrepo "$r"
echo base > "$r/a.txt"; git -C "$r" add -A; commit_at "$r" "2020-01-01T00:00:00" base
base_sha="$(git -C "$r" rev-parse HEAD)"
echo line1 > "$r/x.txt"; git -C "$r" add -A; commit_at "$r" "2020-01-01T00:01:00" "task-3: worktree work landed on main"
real_task3="$(git -C "$r" rev-parse HEAD)"
commit_at "$r" "2020-01-01T00:02:00" "chore: unrelated" -m "task-3: worktree work" --allow-empty
chore_sha="$(git -C "$r" rev-parse HEAD)"
echo line2 > "$r/y.txt"; git -C "$r" add -A; commit_at "$r" "2020-01-01T00:03:00" "task-4: later work"

grep_dash1="$(git -C "$r" log -1 --grep '^task-3: ' --format=%H)"
check "-1 --grep matches the WRONG commit (its body mentions task-3, its subject does not)" "$chore_sha" "$grep_dash1"
subject_filtered="$(git -C "$r" log --format='%H %s' "$base_sha"..HEAD | grep '^[0-9a-f]* task-3: ' | head -1 | cut -d' ' -f1)"
check "the subject-filtered form correctly matches the real task-3 commit" "$real_task3" "$subject_filtered"

# ---------------------------------------------------------------------------------------------
# Scenario 11 — a hand-made worktree, branch and commit whose branch name is outside the
# harness convention, integrating by hash.
# Decision log: "Identity is the reported commit hash, not the branch name".
# ---------------------------------------------------------------------------------------------
echo "=== Scenario 11: an off-convention branch name integrates by hash ==="
r="$ROOT/s11"; mkrepo "$r"
echo base > "$r/a.txt"; git -C "$r" add -A; commit_at "$r" "2020-01-01T00:00:00" base
base_sha="$(git -C "$r" rev-parse HEAD)"
git -C "$r" branch custom-name-outside-convention "$base_sha"
wt="$ROOT/s11-wt"
git -C "$r" worktree add -q "$wt" custom-name-outside-convention
echo handmade > "$wt/h.txt"; git -C "$wt" add -A; commit_at "$wt" "2020-01-01T00:01:00" "task-5: hand-made worktree work"
hand_sha="$(git -C "$wt" rev-parse HEAD)"

found_by_hash="$(git -C "$r" log --branches --not "$base_sha" --format='%H %s' | grep '^[0-9a-f]* task-5: ' | cut -d' ' -f1)"
check "the commit is found by subject search regardless of its branch's off-convention name" "$hand_sha" "$found_by_hash"
cond1="$(git -C "$r" rev-parse --verify "${hand_sha}^{commit}" >/dev/null 2>&1; echo $?)"
check "off-convention commit passes condition 1 (resolves as a commit)" 0 "$cond1"
cond3="$(git -C "$r" merge-base --is-ancestor "$hand_sha" "$base_sha" >/dev/null 2>&1; echo $?)"
check "off-convention commit passes condition 3 (not contained in base_sha)" 1 "$cond3"

# ---------------------------------------------------------------------------------------------
# Scenario 12 — the prompt-text group. This is the file's SECOND SUBJECT: it asserts nothing
# about any repository, it greps prompts.md two directories up. The rules of this change live in
# agent prompts, so a prompt that stops naming its command is the change silently undone. Every
# needle below is a command or an anchored-line name some other assertion — a git scenario here,
# an offline assertion in script-rules.test.mjs, or a hand-run confirm-rules checklist — depends
# on the prompt still carrying.
# ---------------------------------------------------------------------------------------------
echo "=== Scenario 12: the prompts still name their load-bearing commands ==="
PROMPTS="$HERE/../skills/plan-execution/prompts.md"
check "prompts.md is where this group expects it" "yes" "$([ -f "$PROMPTS" ] && echo yes || echo no)"

# section name — one `## <name>` section's body, up to the next heading. The heading names are
# load-bearing themselves: workflow.js aborts on a missing `prompts.<name>`, and the mapping from
# a heading here to that key is by name alone.
section() {
  awk -v want="## $1" '$0 == want { inside = 1; next } /^## / { inside = 0 } inside' "$PROMPTS"
}

# carries body needle — "present" or "absent", for the house `check` comparator.
carries() {
  if printf '%s\n' "$1" | grep -qF -- "$2"; then echo present; else echo absent; fi
}

# lines_with body needle — how many of the body's lines hold the needle.
lines_with() {
  printf '%s\n' "$1" | grep -cF -- "$2"
}

for s in breakdown execute confirm integrate verify retrospective teardown; do
  check "section heading '## $s' appears exactly once" 1 "$(grep -c "^## $s\$" "$PROMPTS")"
done

execute="$(section execute)"
confirm="$(section confirm)"
integrate="$(section integrate)"
teardown="$(section teardown)"
for s in execute confirm integrate teardown; do
  eval "body=\$$s"
  check "the '## $s' section is non-empty" "yes" "$([ -n "$body" ] && echo yes || echo no)"
done

# -- execute: the anchored lines the confirm agent reads by their fixed labels, and the ref write
check "execute: the anchored commit line, at full length" present "$(carries "$execute" 'Commit: <the full forty-character hash>')"
check "execute: the anchored branch line" present "$(carries "$execute" 'Branch: <git branch --show-current>')"
check "execute: the anchored gate line, both outcomes" present "$(carries "$execute" 'Gate: pass` or `Gate: fail')"
check "execute: the anchored repair line, the no-path form" present "$(carries "$execute" 'Uncommitted repair: none')"
check "execute: the anchored repair line, the with-paths form" present "$(carries "$execute" 'Uncommitted repair: <paths>')"
check "execute: the create-only ref write, with its empty third argument" present "$(carries "$execute" 'git update-ref <the ref> <your-full-forty-character-hash> ""')"
check "execute: the plain two-argument form is refused by name" present "$(carries "$execute" 'Never use the plain two-argument form `git update-ref <ref> <sha>`')"
check "execute: the compare-and-swap form is reserved for the confirm agent" present "$(carries "$execute" 'Never use the three-argument compare-and-swap form')"
check "execute: the refusal branch reads the ref back" present "$(carries "$execute" 'run `git rev-parse <the ref>`')"
check "execute: --allow-empty is forbidden by name" present "$(carries "$execute" 'Never commit `--allow-empty`.')"
check "execute: and the prohibition says forbidden by name" present "$(carries "$execute" 'It is forbidden by name')"
check "execute: the hash is reported at full length" present "$(carries "$execute" 'the full forty characters, never an abbreviation')"
check "execute: the commit hash command" present "$(carries "$execute" 'git rev-parse HEAD')"
check "execute: the level-aware exit gate admits a gate run with nothing to commit" present "$(carries "$execute" 'a gate run that passed with nothing left to repair')"
check "execute: a refused worktree is handled rather than improvised" present "$(carries "$execute" 'A refused worktree is handled, not improvised')"
check "execute: and a worktree it cannot create at all halts the task" present "$(carries "$execute" 'If you cannot create a worktree at all, halt')"

# -- confirm: the four conditions, the two rungs, the ref check, the two composed statements
check "confirm: condition 1 resolves the hash as a commit" present "$(carries "$confirm" 'git rev-parse --verify <hash>^{commit}')"
check "confirm: condition 1's near-miss is named as not a substitute" present "$(carries "$confirm" 'is not a substitute: it succeeds on a blob')"
check "confirm: condition 2 reads the subject" present "$(carries "$confirm" 'git log -1 --format=%s <hash>')"
check "confirm: condition 3's command" present "$(carries "$confirm" 'git merge-base --is-ancestor <hash> <base_sha>')"
check "confirm: condition 3's polarity" present "$(carries "$confirm" 'must exit **non-zero**')"
check "confirm: condition 3's comparison point is the captured base_sha and nothing else" present "$(carries "$confirm" 'never the base branch name and never `HEAD`')"
check "confirm: condition 4, with every flag" present "$(carries "$confirm" 'git diff-tree --no-commit-id --name-only -r --root -m --first-parent <hash>')"
check "confirm: the subject-search rung's whole command" present "$(carries "$confirm" 'git log --branches --not <base_sha> --since=<started_at> --grep "^<task-id>: "')"
check "confirm: the reported-hash rung is named" present "$(carries "$confirm" '`reported-hash`')"
check "confirm: the subject-search rung is named" present "$(carries "$confirm" '`subject-search`')"
check "confirm: the ref is read before anything moves it" present "$(carries "$confirm" 'git rev-parse <the ref>')"
check "confirm: the ref moves only by compare-and-swap" present "$(carries "$confirm" 'git update-ref <the ref> <verified-hash> <existing-hash>')"
check "confirm: the create-only form cannot update a ref" present "$(carries "$confirm" 'never the create-only form with')"
check "confirm: the gate-line requirement arrives composed" present "$(carries "$confirm" '## Gate line')"
check "confirm: the no-op availability arrives composed" present "$(carries "$confirm" '## Verified no-op')"
check "confirm: neither is re-derived from the task" present "$(carries "$confirm" 'do not re-derive it')"
check "confirm: the porcelain cross-check is one-sided" present "$(carries "$confirm" 'may only ever fail a task, never verify one')"
check "confirm: it compares against the captured dirty_at_start" present "$(carries "$confirm" 'git status --porcelain')"
check "confirm: dirty_at_start is named as the comparison" present "$(carries "$confirm" 'dirty_at_start')"
check "confirm: a verified state with no hash is refused upstream" present "$(carries "$confirm" 'A `verified` state with no forty-character hash is refused by the orchestrator')"

# -- integrate: recognition inside this run's range, and the subject test
check "integrate: identity is the commit, never the branch name" present "$(carries "$integrate" 'Identity is the commit, never the branch name')"
check "integrate: the commit is resolved before the base is touched" present "$(carries "$integrate" 'git rev-parse --verify <the verified commit>^{commit}')"
check "integrate: the squash merge itself" present "$(carries "$integrate" 'git merge --squash <the verified commit>')"
check "integrate: the squash commit's subject prefix" present "$(carries "$integrate" 'git commit -m "<task-id>: <task-title>"')"
check "integrate: the run-scoped recognition search" present "$(carries "$integrate" "git log --format='%H %s' <base_sha>..<baseBranch>")"
check "integrate: the unscoped --grep form is refused by name" present "$(carries "$integrate" 'Never `git log -1 --format=%H --grep "^<task-id>: "`')"
check "integrate: an empty range result is a failure, not a fallback" present "$(carries "$integrate" 'An empty range result is a failure report')"
check "integrate: a failed build resets the base" present "$(carries "$integrate" 'git reset --hard HEAD')"
check "integrate: teardown owns the branch, not this agent" present "$(carries "$integrate" 'Do not delete the task branch or remove its worktree')"

# -- teardown: the enumeration, the tie rules, the landed-content check, the delete
check "teardown: the worktree enumeration" present "$(carries "$teardown" 'git worktree list')"
check "teardown: the branch enumeration" present "$(carries "$teardown" "git branch --list 'worktree-*'")"
check "teardown: stale entries are pruned first" present "$(carries "$teardown" 'git worktree prune')"
check "teardown: the ref rung's command" present "$(carries "$teardown" "git for-each-ref --format='%(objectname) %(refname)' refs/task/<run-id>/")"
check "teardown: the tip subject rung" present "$(carries "$teardown" 'git log -1 --format=%s <branch>')"
check "teardown: the date test reads the epoch format" present "$(carries "$teardown" '--format=%ct')"
check "teardown: and compares it numerically" present "$(carries "$teardown" 'compared **numerically** against `started_at_epoch`')"
check "teardown: the two rejected date formats are named as rejected" present "$(carries "$teardown" 'No other date format is in contract')"
check "teardown: %cI appears once, and only as the rejected format" 1 "$(lines_with "$teardown" '%cI')"
check "teardown: %cd appears once, and only as the rejected format" 1 "$(lines_with "$teardown" '%cd')"
check "teardown: a worktree's dirt is read before it is removed" present "$(carries "$teardown" 'git -C <path> status --porcelain')"
check "teardown: the clean-worktree removal, unlock then remove" present "$(carries "$teardown" 'git worktree unlock <path>')"
check "teardown: the plain removal form" present "$(carries "$teardown" 'git worktree remove <path>')"
check "teardown: --force is forbidden by name" present "$(carries "$teardown" 'Never `git worktree remove --force`')"
check "teardown: and --force appears on exactly one line, the prohibition's" 1 "$(lines_with "$teardown" '--force')"
check "teardown: the touched-path set's merge base" present "$(carries "$teardown" 'git merge-base <base-branch> <branch>')"
check "teardown: the touched-path set itself" present "$(carries "$teardown" 'git diff --name-only <the merge base> <branch>')"
check "teardown: an empty touched-path set keeps the branch" present "$(carries "$teardown" 'An empty touched-path set is always kept')"
check "teardown: the landed-content check" present "$(carries "$teardown" 'git diff <branch> <the comparison point> -- <the touched paths>')"
check "teardown: the fixed point is the recorded squash commit" present "$(carries "$teardown" 'The comparison point is the recorded squash commit, not the current base tip')"
check "teardown: the base-tip fallback" present "$(carries "$teardown" 'git rev-parse <base-branch>')"
check "teardown: git cherry is advisory and decides nothing" present "$(carries "$teardown" 'git cherry <the comparison point> <branch>')"
check "teardown: the delete uses -D, since a squash leaves no ancestry" present "$(carries "$teardown" 'git branch -D <branch>')"

# The five inputs teardown cannot derive, named in the prompt by the same headings the script
# builds. script-rules.test.mjs asserts the script writes them; this asserts the prompt reads them.
for heading in "## Run" "## Run-start baseline" "## This run's tasks" "## Recorded integrations" "## Failed tasks" "## Blocked tasks"; do
  check "teardown: it names its input section '$heading'" present "$(carries "$teardown" "$heading")"
done
check "teardown: and re-derives none of them" present "$(carries "$teardown" 'Use them as given and re-derive none of them')"

# -- the ledger, asserted against all three writers, because they share one wording
for writer in confirm integrate teardown; do
  eval "body=\$$writer"
  check "$writer: the ledger directory is created first" present "$(carries "$body" 'mkdir -p "$(git rev-parse --show-toplevel)/.tasks/<run-id>"')"
  check "$writer: one append, one redirect" present "$(carries "$body" 'redirect to `.tasks/<run-id>/ledger.jsonl`')"
  check "$writer: never a read-modify-write" present "$(carries "$body" 'never a read-modify-write of the file, which would lose a concurrent writer')"
  check "$writer: never rewrites another agent's line" present "$(carries "$body" 'never rewrite, reorder or delete a line that is already there')"
  for kind in verification integration blocked closing; do
    check "$writer: it knows the ledger's '$kind' line kind" present "$(carries "$body" "\`$kind\`")"
  done
done
check "confirm: writes a verification line" present "$(carries "$confirm" '"kind":"verification"')"
check "integrate: writes an integration line" present "$(carries "$integrate" '"kind":"integration"')"
check "teardown: writes a blocked line per blocked task" present "$(carries "$teardown" '"kind":"blocked"')"
check "teardown: writes the closing lines" present "$(carries "$teardown" '"kind":"closing"')"

echo "== $pass passed, $fail failed =="
[ "$fail" -eq 0 ]
