# Vehicle 3 — confirm-rule conformance checklist (agent-driven, operator-run)

Subject: `skills/plan-execution/prompts.md`'s `## confirm` section. Not a new
framework and not automatable in CI — it needs the harness. What Vehicle 1 (`git-rules.test.sh`)
and Vehicle 2 (`script-rules.test.mjs`) cannot assert is whether an agent *reading* `## confirm`
reaches the verdict the spec claims for four groups of criteria that are agent reasoning, not git
rules and not script logic: the no-op predicate's three shapes, the failing-gate checkpoint's two
shapes, the absent-and-unrecognised level, and a report handed over with no anchored lines at all.

**The gap this leaves, and what covers it.** A hand-run checklist is no regression lock — a later
edit to `## confirm` could silently invert one of these verdicts. Vehicle 1's prompt-text group is
the lock: it pins the load-bearing command and anchored-line name of each rule, so this checklist
verifies the reasoning and the automated suite verifies the text the reasoning reads.

## How to run one scenario

1. Run the scenario's **Setup** block. It builds a throwaway repository under `mktemp -d` using
   `tests/fixtures/repo-builder.sh`'s `mkrepo`/`commit_at` (byte-for-byte the same
   primitives `git-rules.test.sh` uses inline), and prints the values the scenario needs
   (`base_sha`, `started_at`, `started_at_epoch`, `dirty_at_start`, and any commit hash the
   scenario stages).
2. Build the prompt: `prompts.md`'s `## confirm` section, verbatim, followed by the scenario's
   **Interpolated block** below it — this is the same shape `confirmFromGit` builds in
   `workflow.js` (`## Task`, the checkout note, `## Run` / `## Run-start baseline`, `## Task ref`,
   `## Gate line`, `## Verified no-op`, `## Execute report`), with the setup step's real values
   substituted for the placeholders.
3. Hand that prompt to a single fresh agent invocation on the builder model (a general-purpose
   agent with `Bash` access to the repository the setup step built, no other context). Do not tell
   it the expected verdict.
4. Record the agent's reported `state`, `rung`, and (for `verified`) hash, in the **Recorded**
   block, alongside a one-line pass/fail verdict against **Expected**.
5. Leave the throwaway repository in place until recorded (it is not needed after); nothing here
   persists across scenarios.

Roughly nine invocations, each a few git reads — an order of magnitude cheaper than one live run.

---

### Scenario 1 — no-op shape 1: repair line names a path → `failed`, even when porcelain matches the baseline byte for byte

The repair reused a path the baseline already recorded as modified, so porcelain alone cannot
distinguish this from a healthy no-op — the repair *line* is what must fail it.

**Setup**

```bash
source tests/fixtures/repo-builder.sh
r="$(mktemp -d)"; mkrepo "$r"
echo base > "$r/greet.sh"; git -C "$r" add -A; commit_at "$r" "2020-01-01T00:00:00" base
base_sha="$(git -C "$r" rev-parse HEAD)"
started_at="2020-01-01T00:05:00"
started_at_epoch="$(date -u -d "$started_at" +%s 2>/dev/null || date -u -jf '%Y-%m-%dT%H:%M:%S' "$started_at" +%s)"
# dirty_at_start already shows this same path modified — the "already recorded" half.
echo edited >> "$r/greet.sh"
dirty_at_start="$(git -C "$r" status --porcelain)"
echo "repo: $r"; echo "base_sha: $base_sha"; echo "started_at: $started_at"
echo "started_at_epoch: $started_at_epoch"; echo "dirty_at_start: $dirty_at_start"
```

**Interpolated block**

```
## Task: milestone checkpoint (task-9)

This task ran on the main checkout — the current branch — so it has no branch of its own to report.

## Run
- Run ID: `confirm-rules-scenario-1`
- Base branch: `main`

## Run-start baseline
- `base_sha`: `<base_sha from setup>`
- `started_at`: `2020-01-01T00:05:00`
- `started_at_epoch`: `<started_at_epoch from setup>`
- `dirty_at_start`:

```
 M greet.sh
```

## Task ref
`refs/task/confirm-rules-scenario-1/task-9`

## Gate line
An anchored gate line reporting a **pass** is required of this task. The four verification
conditions are necessary but not sufficient for it: a gate line reporting a failure, or no gate
line at all, makes this task **failed**, whatever it committed.

## Verified no-op
The `verified-no-op` outcome is **available** for this task: a gate that passed with nothing left
to repair is a verified outcome, not a failure.

## Execute report
Commit: none
Branch: none
Gate: pass
Uncommitted repair: greet.sh
```

**Expected:** `failed`. Fact 2 of the no-op predicate ("the `Uncommitted repair:` line names no
path") is violated outright by the reported line — the porcelain match is irrelevant.

**Recorded:** state `___`, rung `___`, verdict `___`.

---

### Scenario 2 — no-op shape 2: repair line names no path, gate suite left an untracked `dist/` beyond the baseline → `verified-no-op`

Variant worth staging alongside it, not a separate invocation: the same result holds when
`dirty_at_start` already carries an *untracked* leaving from an earlier task (the healthy-shape
case the spec names explicitly) — an untracked addition beyond the baseline never fails the
cross-check either way.

**Setup**

```bash
source tests/fixtures/repo-builder.sh
r="$(mktemp -d)"; mkrepo "$r"; write_source_tree "$r"
git -C "$r" add -A; commit_at "$r" "2020-01-01T00:00:00" base
base_sha="$(git -C "$r" rev-parse HEAD)"
started_at="2020-01-01T00:05:00"
started_at_epoch="$(date -u -d "$started_at" +%s 2>/dev/null || date -u -jf '%Y-%m-%dT%H:%M:%S' "$started_at" +%s)"
dirty_at_start="$(git -C "$r" status --porcelain)"   # empty — clean at start
bash "$r/scripts/verify.sh" >/dev/null               # the gate run itself; leaves untracked dist/
echo "repo: $r"; echo "base_sha: $base_sha"
echo "started_at_epoch: $started_at_epoch"; echo "porcelain now: $(git -C "$r" status --porcelain)"
```

**Interpolated block**

```
## Task: milestone checkpoint (task-9)

This task ran on the main checkout — the current branch — so it has no branch of its own to report.

## Run
- Run ID: `confirm-rules-scenario-2`
- Base branch: `main`

## Run-start baseline
- `base_sha`: `<base_sha from setup>`
- `started_at`: `2020-01-01T00:05:00`
- `started_at_epoch`: `<started_at_epoch from setup>`
- `dirty_at_start`: (empty — the main checkout was clean at run start)

## Task ref
`refs/task/confirm-rules-scenario-2/task-9`

## Gate line
An anchored gate line reporting a **pass** is required of this task. The four verification
conditions are necessary but not sufficient for it: a gate line reporting a failure, or no gate
line at all, makes this task **failed**, whatever it committed.

## Verified no-op
The `verified-no-op` outcome is **available** for this task: a gate that passed with nothing left
to repair is a verified outcome, not a failure.

## Execute report
Commit: none
Branch: none
Gate: pass
Uncommitted repair: none
```

**Expected:** `verified-no-op`. `git status --porcelain` reads `?? dist/`, beyond
`dirty_at_start`, but it is an untracked addition — the cross-check may only fail a task, and it
does not fail on an untracked path.

**Recorded:** state `___`, rung `___`, verdict `___`.

---

### Scenario 3 — no-op shape 3: repair line names no path, but a *tracked* modification beyond the baseline is present → `failed`

**Setup**

```bash
source tests/fixtures/repo-builder.sh
r="$(mktemp -d)"; mkrepo "$r"
echo base > "$r/greet.sh"; git -C "$r" add -A; commit_at "$r" "2020-01-01T00:00:00" base
base_sha="$(git -C "$r" rev-parse HEAD)"
started_at_epoch="$(date -u +%s)"
dirty_at_start="$(git -C "$r" status --porcelain)"    # empty — clean at start
echo "unreported edit" >> "$r/greet.sh"                # tracked mod the agent never claimed
echo "repo: $r"; echo "base_sha: $base_sha"; echo "started_at_epoch: $started_at_epoch"
echo "porcelain now: $(git -C "$r" status --porcelain)"
```

**Interpolated block**

```
## Task: milestone checkpoint (task-9)

This task ran on the main checkout — the current branch — so it has no branch of its own to report.

## Run
- Run ID: `confirm-rules-scenario-3`
- Base branch: `main`

## Run-start baseline
- `base_sha`: `<base_sha from setup>`
- `started_at`: `2020-01-01T00:05:00`
- `started_at_epoch`: `<started_at_epoch from setup>`
- `dirty_at_start`: (empty — the main checkout was clean at run start)

## Task ref
`refs/task/confirm-rules-scenario-3/task-9`

## Gate line
An anchored gate line reporting a **pass** is required of this task. The four verification
conditions are necessary but not sufficient for it: a gate line reporting a failure, or no gate
line at all, makes this task **failed**, whatever it committed.

## Verified no-op
The `verified-no-op` outcome is **available** for this task: a gate that passed with nothing left
to repair is a verified outcome, not a failure.

## Execute report
Commit: none
Branch: none
Gate: pass
Uncommitted repair: none
```

**Expected:** `failed`. `git status --porcelain` reads ` M greet.sh`, a **tracked** modification
beyond `dirty_at_start` — this fails fact 2 regardless of what the repair line claims.

**Recorded:** state `___`, rung `___`, verdict `___`.

---

### Scenario 4 — failing-gate checkpoint, shape 1: clean tree, no commit, `Gate: fail` → `failed`

**Setup**

```bash
source tests/fixtures/repo-builder.sh
r="$(mktemp -d)"; mkrepo "$r"
echo base > "$r/a.txt"; git -C "$r" add -A; commit_at "$r" "2020-01-01T00:00:00" base
base_sha="$(git -C "$r" rev-parse HEAD)"
started_at_epoch="$(date -u +%s)"
echo "repo: $r"; echo "base_sha: $base_sha"; echo "started_at_epoch: $started_at_epoch"
```

**Interpolated block**

```
## Task: milestone checkpoint (task-9)

This task ran on the main checkout — the current branch — so it has no branch of its own to report.

## Run
- Run ID: `confirm-rules-scenario-4`
- Base branch: `main`

## Run-start baseline
- `base_sha`: `<base_sha from setup>`
- `started_at`: `2020-01-01T00:05:00`
- `started_at_epoch`: `<started_at_epoch from setup>`
- `dirty_at_start`: (empty — the main checkout was clean at run start)

## Task ref
`refs/task/confirm-rules-scenario-4/task-9`

## Gate line
An anchored gate line reporting a **pass** is required of this task. The four verification
conditions are necessary but not sufficient for it: a gate line reporting a failure, or no gate
line at all, makes this task **failed**, whatever it committed.

## Verified no-op
The `verified-no-op` outcome is **available** for this task: a gate that passed with nothing left
to repair is a verified outcome, not a failure.

## Execute report
Commit: none
Branch: none
Gate: fail
Uncommitted repair: none
```

**Expected:** `failed`. The gate-line rule fires before the no-op predicate is even reached: a
`Gate:` line reading `fail` makes the task failed whatever it committed — here, nothing.

**Recorded:** state `___`, rung `___`, verdict `___`.

---

### Scenario 5 — failing-gate checkpoint, shape 2: a commit that passes all four verification conditions, but `Gate: fail` → `failed`, commit still recorded

**Setup**

```bash
source tests/fixtures/repo-builder.sh
r="$(mktemp -d)"; mkrepo "$r"
echo base > "$r/a.txt"; git -C "$r" add -A; commit_at "$r" "2020-01-01T00:00:00" base
base_sha="$(git -C "$r" rev-parse HEAD)"
started_at_epoch="$(date -u +%s)"
echo "partial repair" >> "$r/a.txt"; git -C "$r" add -A
commit_at "$r" "2020-01-01T00:01:00" "task-9: partial repair, gate still failing"
commit_hash="$(git -C "$r" rev-parse HEAD)"
echo "repo: $r"; echo "base_sha: $base_sha"
echo "started_at_epoch: $started_at_epoch"; echo "commit_hash: $commit_hash"
```

**Interpolated block**

```
## Task: milestone checkpoint (task-9)

This task ran on the main checkout — the current branch — so it has no branch of its own to report.

## Run
- Run ID: `confirm-rules-scenario-5`
- Base branch: `main`

## Run-start baseline
- `base_sha`: `<base_sha from setup>`
- `started_at`: `2020-01-01T00:05:00`
- `started_at_epoch`: `<started_at_epoch from setup>`
- `dirty_at_start`: (empty — the main checkout was clean at run start)

## Task ref
`refs/task/confirm-rules-scenario-5/task-9`

## Gate line
An anchored gate line reporting a **pass** is required of this task. The four verification
conditions are necessary but not sufficient for it: a gate line reporting a failure, or no gate
line at all, makes this task **failed**, whatever it committed.

## Verified no-op
The `verified-no-op` outcome is **available** for this task: a gate that passed with nothing left
to repair is a verified outcome, not a failure.

## Execute report
Commit: <commit_hash from setup>
Branch: none
Gate: fail
Uncommitted repair: none
```

**Expected:** `failed`, and the summary carries the hash and branch: the commit passes all four
conditions (real commit, subject `task-9: `, not an ancestor of `base_sha`, changes a path), but
`Gate: fail` makes the task failed regardless — "the commit is recorded, it is simply not verified
work." No integrate step should follow a `failed` state.

**Recorded:** state `___`, rung `___`, hash reported `___`, verdict `___`.

---

### Scenario 6 — absent verification level (defaults to the full gate), on the main checkout, valid report → `verified`

Closes: the gate-line demand and requirement key on the same reading; nothing downstream is
blocked for an un-marked task that actually did clean, gated work.

**Setup**

```bash
source tests/fixtures/repo-builder.sh
r="$(mktemp -d)"; mkrepo "$r"
echo base > "$r/a.txt"; git -C "$r" add -A; commit_at "$r" "2020-01-01T00:00:00" base
base_sha="$(git -C "$r" rev-parse HEAD)"
started_at_epoch="$(date -u +%s)"
echo "feature" >> "$r/a.txt"; git -C "$r" add -A
commit_at "$r" "2020-01-01T00:01:00" "task-4: add feature"
commit_hash="$(git -C "$r" rev-parse HEAD)"
echo "repo: $r"; echo "base_sha: $base_sha"
echo "started_at_epoch: $started_at_epoch"; echo "commit_hash: $commit_hash"
```

**Interpolated block**

```
## Task: an un-marked task, no `verification_level` field at all (task-4)

This task ran on the main checkout — the current branch — so it has no branch of its own to report.

## Run
- Run ID: `confirm-rules-scenario-6`
- Base branch: `main`

## Run-start baseline
- `base_sha`: `<base_sha from setup>`
- `started_at`: `2020-01-01T00:05:00`
- `started_at_epoch`: `<started_at_epoch from setup>`
- `dirty_at_start`: (empty — the main checkout was clean at run start)

## Task ref
`refs/task/confirm-rules-scenario-6/task-4`

## Gate line
An anchored gate line reporting a **pass** is required of this task. The four verification
conditions are necessary but not sufficient for it: a gate line reporting a failure, or no gate
line at all, makes this task **failed**, whatever it committed.

## Verified no-op
The `verified-no-op` outcome is **available** for this task: a gate that passed with nothing left
to repair is a verified outcome, not a failure.

## Execute report
Commit: <commit_hash from setup>
Branch: none
Gate: pass
Uncommitted repair: none
```

**Expected:** `verified`, rung `reported-hash`, hash equal to `commit_hash`, nothing blocked. The
composed statements above are exactly what an absent-level task receives — `runsFullGate` reads a
missing level the same as `checkpoint` — so this proves the depth default costs a wider gate and
nothing else.

**Recorded:** state `___`, rung `___`, hash `___`, verdict `___`.

---

### Scenario 7 — unrecognised verification level (`file-scoped`), in a worktree, valid report → `verified`

Same default as scenario 6 (`runsFullGate` reads an unrecognised value the same as absent), staged
on the *other* checkout so the no-op-availability statement differs (unavailable here, since this
task did not run on the main checkout) while the verdict — `verified` — does not change, because a
verified outcome never depends on no-op availability.

**Setup**

```bash
source tests/fixtures/repo-builder.sh
r="$(mktemp -d)"; mkrepo "$r"
echo base > "$r/a.txt"; git -C "$r" add -A; commit_at "$r" "2020-01-01T00:00:00" base
base_sha="$(git -C "$r" rev-parse HEAD)"
started_at_epoch="$(date -u +%s)"
git -C "$r" checkout -q -b worktree-x
echo "other feature" >> "$r/b.txt"; git -C "$r" add -A
commit_at "$r" "2020-01-01T00:01:00" "task-5: add other feature"
commit_hash="$(git -C "$r" rev-parse HEAD)"
git -C "$r" checkout -q main
echo "repo: $r"; echo "base_sha: $base_sha"
echo "started_at_epoch: $started_at_epoch"; echo "commit_hash: $commit_hash"
```

**Interpolated block**

```
## Task: a task marked `verification_level: file-scoped`, an unrecognised value (task-5)

This task ran in an isolated git worktree on its own branch, and you are standing in the main
checkout — which is why the `subject-search` rung reaches for `--branches` rather than a range
against `HEAD`. Report the branch name you saw.

## Run
- Run ID: `confirm-rules-scenario-7`
- Base branch: `main`

## Run-start baseline
- `base_sha`: `<base_sha from setup>`
- `started_at`: `2020-01-01T00:05:00`
- `started_at_epoch`: `<started_at_epoch from setup>`
- `dirty_at_start`: (empty — the main checkout was clean at run start)

## Task ref
`refs/task/confirm-rules-scenario-7/task-5`

## Gate line
An anchored gate line reporting a **pass** is required of this task. The four verification
conditions are necessary but not sufficient for it: a gate line reporting a failure, or no gate
line at all, makes this task **failed**, whatever it committed.

## Verified no-op
The `verified-no-op` outcome is **not available** for this task. Report it verified only on its own
committed evidence, and failed otherwise.

## Execute report
Commit: <commit_hash from setup>
Branch: worktree-x
Gate: pass
Uncommitted repair: none
```

**Expected:** `verified`, rung `reported-hash`, hash equal to `commit_hash`, branch `worktree-x`,
nothing blocked — an unrecognised level demands and receives the same full-gate line as an absent
one, and a real verified commit needs no no-op availability at all.

**Recorded:** state `___`, rung `___`, hash `___`, verdict `___`.

---

### Scenario 8 — no anchored lines at all (empty execute report) → `failed`, rung `none`

The spec's own remedy for "which rung produced the evidence when the hash is absent": an execute
agent cannot be made to omit its anchored lines on demand, so this is exercised by handing the
confirm rules a report with none at all.

**Setup**

```bash
source tests/fixtures/repo-builder.sh
r="$(mktemp -d)"; mkrepo "$r"
echo base > "$r/a.txt"; git -C "$r" add -A; commit_at "$r" "2020-01-01T00:00:00" base
base_sha="$(git -C "$r" rev-parse HEAD)"
started_at="2020-01-01T00:00:00"
started_at_epoch="$(git -C "$r" log -1 --format=%ct HEAD)"
# No task-7 commit exists anywhere in this repo — the subject-search rung must find nothing.
echo "repo: $r"; echo "base_sha: $base_sha"
echo "started_at: $started_at"; echo "started_at_epoch: $started_at_epoch"
```

**Interpolated block**

```
## Task: a task whose execute agent returned no report at all (task-7)

This task ran on the main checkout — the current branch — so it has no branch of its own to report.

## Run
- Run ID: `confirm-rules-scenario-8`
- Base branch: `main`

## Run-start baseline
- `base_sha`: `<base_sha from setup>`
- `started_at`: `2020-01-01T00:00:00`
- `started_at_epoch`: `<started_at_epoch from setup>`
- `dirty_at_start`: (empty — the main checkout was clean at run start)

## Task ref
`refs/task/confirm-rules-scenario-8/task-7`

## Gate line
An anchored gate line reporting a **pass** is required of this task. The four verification
conditions are necessary but not sufficient for it: a gate line reporting a failure, or no gate
line at all, makes this task **failed**, whatever it committed.

## Verified no-op
The `verified-no-op` outcome is **available** for this task: a gate that passed with nothing left
to repair is a verified outcome, not a failure.

## Execute report
Forwarded verbatim, exactly as the execute agent returned it. Nothing has parsed it before you.

(empty — the execute agent returned no report, so it carries no anchored lines)
```

**Expected:** `failed`, rung `none`. Step 1 finds no anchored lines at all, so step 2 goes straight
to `subject-search`: `git log --branches --not <base_sha> --since=<started_at> --grep "^task-7: "`
in this repository returns nothing, because no such commit exists — report `none` for both the
candidate and the rung, and `failed` for the state, per step 7's "anything else" clause.

**Recorded:** state `___`, rung `___`, verdict `___`.

---

### Scenario 9 — a `scoped` task in the no-op shape, but no-op unavailable for it → `failed`

Completion criterion, stated directly: "A `scoped` task in the same state is still a failure." The
tree looks exactly like a healthy no-op (clean commit, nothing to repair, an untracked build
byproduct), but this task was never asked for the full gate, so the no-op outcome was never on the
table for it — a task reporting no verified commit at all is failed.

**Setup**

```bash
source tests/fixtures/repo-builder.sh
r="$(mktemp -d)"; mkrepo "$r"; write_source_tree "$r"
git -C "$r" add -A; commit_at "$r" "2020-01-01T00:00:00" base
base_sha="$(git -C "$r" rev-parse HEAD)"
started_at_epoch="$(date -u +%s)"
bash "$r/scripts/verify.sh" >/dev/null   # leaves the same untracked dist/ as scenario 2
echo "repo: $r"; echo "base_sha: $base_sha"; echo "started_at_epoch: $started_at_epoch"
```

**Interpolated block**

```
## Task: a `scoped` task, no run-scoped commit (task-11)

This task ran on the main checkout — the current branch — so it has no branch of its own to report.

## Run
- Run ID: `confirm-rules-scenario-9`
- Base branch: `main`

## Run-start baseline
- `base_sha`: `<base_sha from setup>`
- `started_at`: `2020-01-01T00:05:00`
- `started_at_epoch`: `<started_at_epoch from setup>`
- `dirty_at_start`: (empty — the main checkout was clean at run start)

## Task ref
`refs/task/confirm-rules-scenario-9/task-11`

## Gate line
No anchored gate line is required of this task. The four verification conditions are sufficient
for a verified outcome.

## Verified no-op
The `verified-no-op` outcome is **not available** for this task. Report it verified only on its own
committed evidence, and failed otherwise.

## Execute report
Commit: none
Branch: none
Gate: pass
Uncommitted repair: none
```

**Expected:** `failed`. No-op is not available for a `scoped` task, so step 5's opening line
applies directly: a task with no verified commit is failed. The untracked `dist/` and the reported
`Gate: pass` are exactly the shape scenario 2 records `verified-no-op` — the only variable that
changed is availability, which is what this scenario isolates.

**Recorded:** state `___`, rung `___`, verdict `___`.

---

## Summary table (fill in after all nine run)

| # | Scenario | Expected | Recorded state | Recorded rung | Verdict |
|---|---|---|---|---|---|
| 1 | repair names a path, porcelain matches | `failed` | | | |
| 2 | repair names no path, untracked `dist/` | `verified-no-op` | | | |
| 3 | repair names no path, tracked mod beyond baseline | `failed` | | | |
| 4 | failing gate, clean tree, no commit | `failed` | | | |
| 5 | failing gate, commit passes all 4 conditions | `failed` (commit recorded) | | | |
| 6 | absent level, main checkout, valid report | `verified` | | | |
| 7 | unrecognised level (`file-scoped`), worktree, valid report | `verified` | | | |
| 8 | no anchored lines at all | `failed`, rung `none` | | | |
| 9 | `scoped` task, no-op shape but unavailable | `failed` | | | |
