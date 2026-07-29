## Design decisions

### Sequential on base, parallel in worktrees (2026-06-15)

Early versions ran every task in a worktree, even sequential ones. This required a cherry-pick chain to keep each worktree current with prior tasks' work — each squash-merge commit SHA was accumulated into a `priorCommits` array and passed to subsequent worktree agents as cherry-pick instructions.

The cherry-pick mechanism was fragile. In the `develop-merge-2` run (2026-06-15), a no-op squash merge returned a duplicate SHA, which stalled a downstream agent trying to cherry-pick it twice. The deeper issue: worktree isolation for sequential tasks is unnecessary overhead. Each task depends on its predecessor's output, so there's no parallelism benefit — only cost (stale base, worktreeInit, cherry-picks, squash merges).

The fix: sequential tasks now run directly on the main checkout, each agent inheriting the prior agent's commit. No cherry-picks, no worktreeInit, no squash merge. Parallel tasks keep worktree isolation (agents mutate files concurrently) and are squash-merged back sequentially. Worktrees for parallel tasks start from the current branch tip, which already includes all prior sequential work — so no cherry-picks are needed there either.

This supersedes the "Cherry-pick chain" mechanism from 2026-06-11.

**Verify asymmetry.** The verify prompt in `prompts.md` says "define corrective tasks" because the multi-task workflow needs structured task definitions to feed back into the execute/integrate pipeline. The simple workflow overrides this inline, telling the verify agent to fix gaps directly. This is intentional — a single-agent run has no integration machinery to route corrections through.

**Feature branch assumption.** Sequential tasks commit directly to the current branch. The integration agent (for parallel tasks only) squash-merges onto the same branch without worktree isolation. If an agent crashes mid-commit or the integration agent fails between `git merge --squash` and the commit, the repo is left dirty. This is acceptable because the skill runs on a feature branch where the user expects commits. The alternative — running integration in a worktree and fast-forwarding the base — adds complexity for a failure mode that's rare and easy to recover from manually.

### Gather/apply worktree init (2026-06-12)

Worktrees lack gitignored state — `.sf/config.json`, `node_modules`, generated bundles. The friction logs from `ic-homepage-spike` showed execute agents tripping over `NoDefaultEnvError` and build failures from missing dependencies.

The fix: CLAUDE.md documents a `## Worktree init` section with two blocks. **Gather** commands run in the main checkout before worktree creation, capturing per-developer state (like the default org alias) as named variables. **Apply** commands run inside the worktree, with gathered values substituted in. The invoking Claude resolves the template and passes fully-substituted commands as `args.worktreeInit`. The workflow prepends them to execute prompts for worktree agents only (parallel tasks and corrective tasks).

The gather/apply split keeps CLAUDE.md portable — it documents the _shape_ of the init (set the target org, symlink node_modules, run the build) without hardcoding per-developer values like org aliases. The two-phase resolution means the workflow itself stays simple: it receives resolved commands, no parsing or execution logic.

spec-driven checks for the section as a prerequisite and helps draft it if missing. plan-execution also checks when invoked directly.

### Worktree baseRef must be `head` (2026-06-16)

The platform's `worktree.baseRef` setting defaults to `fresh`, which branches worktrees from `origin/<default-branch>`. When running a multi-step plan on a feature branch, parallel worktree agents can't see classes committed by prior sequential tasks — they start from the default branch tip, which is behind the feature branch.

The fix: the skill now checks `.claude/settings.json` for `"worktree": { "baseRef": "head" }` during the worktree init prerequisite step and adds it if missing. With `head`, worktrees branch from the current local HEAD, which includes all prior sequential work.

### Idempotent symlink commands (2026-06-16)

CLAUDE.md worktree init sections commonly include `ln -s` to symlink `node_modules` from the main checkout. If the worktree is reused or the init runs twice, `ln -s` follows the existing symlink and creates a circular `node_modules/node_modules` inside the main checkout's `node_modules` directory, breaking the toolchain with ELOOP errors.

The fix: when resolving Apply commands, the skill replaces `ln -s ` with `ln -snf ` (`-n` treats existing symlinks as the target, `-f` replaces). This makes the command idempotent regardless of what's in CLAUDE.md.

### Prior-work summaries for downstream agents (2026-06-16)

The breakdown agent writes task specs before any code runs. Later tasks describe expected file states that may diverge as earlier agents make implementation decisions, hit complexity limits, or rename things. Agents that trust the task description over the actual code waste cycles reconciling spec vs reality, or worse, write code against an outdated assumption.

The fix: the workflow accumulates a one-line summary from each completed execute agent and injects a `## Prior completed tasks` section into subsequent execute prompts. The section lists what each prior task actually did (not what the planner predicted) and instructs the agent to read the files rather than rely on the task description. This costs a few hundred tokens per task and eliminates the "task spec drift" class of friction.

### Verification via CLAUDE.md, not discovery (2026-06-10)

Execute agents need to validate their work — build, lint, static analysis, tests. Rather than asking agents to discover available tools by spelunking through package.json, Makefiles, or CI configs, the skill requires verification tools to be documented in CLAUDE.md as a prerequisite. The execute prompt tells agents to run whatever CLAUDE.md defines. If nothing is documented, agents flag it in their friction log. This mirrors spec-kit's "project constitution" concept without introducing a separate file.

### Build agents may not edit the spec or plan (2026-06-23)

An execute agent that hits a wall — a plan step that contradicts the spec, an acceptance criterion that's technically infeasible — can "resolve" it by quietly editing the plan or spec to match what it managed to build, or by improvising a different design. Either way the governing documents stop describing the system, and the divergence surfaces far downstream, if at all.

The fix: the `execute` prompt declares the plan and spec authoritative and read-only. A build agent never edits them and never redesigns around them to force a pass. When a task is impossible as written, the agent stops, commits nothing, and reports what is blocked and what decision is needed.

This rides the existing git-confirmation mechanism rather than adding new signalling: success is judged by whether the task's work landed in a commit (`confirmFromGit`), so an agent that deliberately commits nothing is recorded as a failed task, halting the run. The agent's prose explanation is preserved in the friction log returned with the result, so the human sees *why* it stopped. Design changes belong upstream — the spec-driven pipeline revises the spec or plan and re-runs — not in a build agent improvising mid-task.

### Build agents satisfy hard gates over soft style preferences (2026-06-23)

Companion to "Build agents may not edit the spec or plan." An execute agent can stall when an enforced completion gate (a failing lint / static-analysis check or a required test) can only be cleared by violating a softer CLAUDE.md *style* preference — e.g. a rule mandating doc comments versus "comment only the non-obvious." The execute prompt now resolves the tie: satisfy the gate and record the trade under `harder_than_expected` in the friction log. The carve-out is style / aesthetic preferences only — an enforced gate must never override a CLAUDE.md *safety or correctness* rule (e.g. "never log PII"); there the agent stops and reports a blocker, as above.

The speccy orchestrator independently re-verifies gates rather than trusting the workflow's green summary — see "Gate reports are re-verified, not trusted" in speccy's log.

### Watchdog over background workflow runs (2026-06-23)

A background workflow notifies the orchestrator only on completion. In one run that left a ~10-minute window where a live-but-slow build (real `sf` deploy + test round-trips, sparse commits) was indistinguishable from a hang, and a build quietly spawning its third corrective task — improvising an async redesign — drew no attention until a human happened to look. The orchestrator had no signal between launch and completion.

The fix: the SKILL instructs the orchestrator to arm a `Monitor` watchdog right after launching the workflow. It polls cheap git and transcript state every ~75s and stays silent while healthy, emitting only on a tripped heuristic. The tiers are deliberately asymmetric to serve both a present user (sees the warning, can correct) and an absent user (overnight run — happier with a completed run than one killed out from under them):

- **Tier 1 (warn, don't stop)** — ≥2 corrective tasks, or a ~25-min soft wall-clock cap. Emit + `PushNotification`; let the run continue. The build's halt-on-impossibility rule means a *stuck* build now stops itself, so this tier flags "slow / many passes," not "redesigning."
- **Tier 2 (auto-stop)** — a hard stall (>5 min with no commit and no transcript activity). No progress to preserve, so `TaskStop` + `PushNotification` and report where to resume.

The watchdog is best-effort and lives in plan-execution (not the caller), so every invoker — direct or via spec-driven — gets it. It is observability and a kill switch, not flow control: it never redirects the build, only surfaces or stops it.

**Liveness signal (2026-06-23).** Liveness keys off the newest `agent-*.jsonl` mtime in the transcript dir, not `journal.jsonl`. The journal only records phase-boundary events, so it goes silent through a single long-running agent (e.g. breakdown) and would read as a stall. Two follow-on refinements: the stall check confirms no tool is in flight before stopping — transcript mtime ticks only when a tool *returns*, so a long `sf` deploy or test run looks identical to a hang until the orchestrator tails the newest transcript for an unfinished `tool_use`; and the stall flag re-arms once activity resumes, so a confirmed-benign stall doesn't blind the watchdog to a later real one.

### Verify escalates blocked requirements instead of redesigning around them (2026-06-23)

The execute agent halts when a task is impossible (see "Build agents may not edit the spec or plan"), but the **verify** step had the opposite instinct. Its prompt said "if there are gaps or test failures, define corrective tasks" — so when a deliverable couldn't be met as specified, verify authored a corrective task to close it anyway. In one run the verify agent wrote a corrective task titled *"…replace or supplement with a working mechanism"* — explicitly licensing a redesign (an async Platform-Event workaround for a synchronous requirement the platform forbids). The guard against build-time improvisation has to cover the verify loop, not just execute, or the loop becomes the back door.

The fix is in the verify prompt, working within the bundled workflow's fixed schema:

- Verify classifies each gap as a **fillable gap** (finishable within the agreed design → corrective task, as before) or a **blocked requirement** (infeasible, self-contradictory, or only closable by changing the design → no corrective task).
- Corrective tasks may only fill gaps within the agreed design — never redesign, replace a mechanism, work around, or edit the spec/plan to force a pass.
- A blocked requirement gets no corrective task. With nothing to run, the verify loop ends and the run reports incomplete, which routes the decision back to a human. The SKILL's "After the workflow completes" now distinguishes *blocked on intent* (surface the reason from friction logs, present as a decision to revise spec/plan) from a *mechanical gap* (resume where it stopped).

Constraint worth recording: the bundled `COMPLETENESS_SCHEMA` has no first-class "blocked" field, and the workflow's return value omits the verify deliverables, so the blocking *reason* travels on the existing channels — the halted execute agent's friction log (reliable, common case) and the deliverable's `evidence` text. A cleaner signal would add a `blocked` outcome to the schema, but that means editing the bundled workflow (currently fixed). Deferred until the friction-log channel proves insufficient.

### Worktree and branch teardown owned by the workflow (2026-06-26)

The `integrate` prompt's last step used to be `git branch -D <task-branch>`, while worktrees were only removed in an end-of-run cleanup pass that never deleted branches. Two consequences: git refuses to delete a branch still checked out in a live worktree, so the in-prompt `git branch -D` failed on every parallel task — branches accumulated and the failure muddied integration reports; and the end-of-run cleanup ran only on the success path, so any early-return failure (parallel exec, integration, sequential task) leaked its worktrees into the next run. A failed parallel sibling leaked too, because the branch was recorded only when the task succeeded.

The fix consolidates teardown in `workflow.js`:

- A single idempotent `cleanupWorktrees()` removes the worktree **first**, then deletes only squash-merged branches (tracked in `mergedBranches`) with `-D` — a squash merge leaves no ancestry for `-d` to recognise. Unmerged branches survive for recovery and are reported under `skipped_branches`.
- It is called on every exit path — success and each early-return failure — and guards against double-execution with a `worktreesCleaned` flag.
- Worktree branches are recorded regardless of task success, so a failed sibling's worktree is still swept (the harness provisions the worktree before the agent runs).
- The `integrate` prompt no longer deletes the branch or removes the worktree; it is told the workflow owns that teardown, and why an in-prompt `git branch -D` would fail.

`workflow-simple.js` is unaffected — it runs a single task on the main checkout with no worktrees or integration.

### Breakdown favours parallelism (2026-07-08)

The breakdown prompt defaulted to sequential steps — "only group tasks into a parallel step when they are obviously independent." In practice that decomposed real plans into long sequential chains, so wall-clock was the *sum* of per-task times rather than the max. A 14-task run (`taskray-ent` full-page-portfolio) ran largely serially and took hours, most of it waiting on tasks that had no true dependency on each other.

The conservative default was buying little: worktree isolation (`baseRef: head`) plus the prior-work summaries injected into downstream prompts already make parallel batches safe, and squash-merge integration has proven low-conflict across runs. So the cost of the caution (serialised wall-clock) outweighed its benefit (avoiding conflicts that rarely materialise).

The fix: the breakdown prompt now **favours parallelism** — tasks share a parallel step unless there is a genuine dependency (a task needs a prior task's committed output, or two tasks would write the same files and conflict). "When in doubt, parallelise." This is a disposition change only; the mechanism ("Sequential on base, parallel in worktrees") is unchanged — it just gets exercised toward more concurrency. Integration remains the backstop; if aggressive parallelism ever produces real conflicts, the integrate stage surfaces them.

### Breakdown owns the verification cadence (2026-07-08)

The `execute` prompt told every task to run the project's full gate suite (build, lint, static analysis, full test run) before committing. On a large run that pays the whole suite once *per task* — the same full-page-portfolio run above ran it 11+ times, and that repetition, not orchestration overhead, was the dominant wall-clock cost. Running the suite only once at the very end is the opposite failure: a regression surfaces late and is hard to attribute to the batch that caused it.

The fix distributes verification, and hands the decision to breakdown (the phase with the whole dependency graph in view). This refines "Verification via CLAUDE.md, not discovery" — CLAUDE.md still defines *what* the tools are; this governs *how often* the full set runs:

- Breakdown marks ordinary feature tasks **scoped** — they run only fast checks (typecheck/compile plus the tests covering what they touched) before committing.
- Breakdown authors explicit **verification-checkpoint** tasks — a sequential step whose task runs the full suite against the integrated base and fixes any breakage — at milestones it chooses: after a parallel batch lands, at a layer boundary, and always once at the end. More checkpoints on a large multi-batch plan so a regression stays attributable to its batch.
- `execute` honours the per-task level, with a safe default: an **unmarked** task runs the full suite. So `workflow-simple` (a single un-marked task) and any un-marked plan are never under-verified — the speedup is opt-in via breakdown's markings.

Trade-off recorded deliberately: a scoped task that commits can pass a regression to a later checkpoint rather than catching it at once. Accepted to reclaim wall-clock on large runs, bounded by how frequently breakdown checkpoints. Evidence for the change: the full-page-portfolio retrospective (per-task full-suite runs dominated the clock) and the ultracode/Workflow research confirming the platform ships no cadence guidance — the project owns this policy.

### Task-file references are absolute paths for worktree agents (2026-07-10)

`.tasks/` is gitignored, so a parallel task's worktree does not contain it. Breakdown wrote each task's file reference as a repo-relative path (`.tasks/{run-id}/{task-id}.md`), which resolves in the main checkout but not in a worktree. Worktree execute agents (parallel and corrective tasks) could not find their own instructions at the given path and detoured to locate the main checkout on every task, seen across the `taskray-ent` full-page-portfolio parallel batches.

The fix: breakdown now references each task file by its absolute path (the repository root from `git rev-parse --show-toplevel`, prepended). The file is still written under `.tasks/{run-id}/`; only the reference handed to an execute agent becomes absolute, so a worktree agent reads its instructions from the main checkout directly with no discovery step.

Chosen over copying the task file into each worktree (the pattern used for other gitignored state via worktree init). That alternative would need the workflow to inject a per-task copy step, and `workflow.js` is fixed; the absolute-path reference is a single-source, zero-copy change living entirely in the breakdown prompt. It assumes the worktree shares a filesystem with the main checkout, which holds for local git worktrees. If worktrees ever run remotely or in isolated containers, revisit with the copy approach. This narrows the residual case under Known limitations ("Worktrees lose per-checkout state").

### Soft-cap watchdog beat recurs instead of firing once (2026-07-10)

Tier-1's soft wall-clock cap originally fired once (a `w_cap` flag) at ~25 min. Reviewing an overnight `taskray-ent` run showed its value is not failure detection (tier-2's hard stall covers that) but a visible liveness beat: a human glancing at a background run wants periodic proof it is watched and progressing. Firing once undersells that, so a ~100-minute execution got a single beat at 25 min, then 75 minutes of silence.

The fix: the soft cap recurs. Instead of a one-shot flag, the sketch tracks a `cap` threshold that bumps by the interval (~25 min) on each fire, so beats land at 25, 50, 75… minutes. Each beat forces the orchestrator to do a real state check (commits, corrective count, transcript liveness) and report it. The corrective-task warning stays one-shot and the stall flag still re-arms; the ~25-min interval keeps even a multi-hour run to a few beats, well under the Monitor's noise-stop threshold. Cost is one orchestrator check-in turn per beat, cheap relative to the reassurance for a watching human.

### Breakdown flags shared-type ripple and defers to file conventions (2026-07-29)

Two task-authoring rules added to the breakdown prompt, both from friction reported in a speccy run.

**Shared-type edits ripple past the Files list.** A task that edits a shared type, interface, or fixture forces edits in downstream files it doesn't name — a consumer that won't compile against the new shape must change too. The task's Files list read as an exhaustive footprint, so those downstream fixes looked like scope creep and got left or queried. Breakdown now authors the task to say the ripple is expected. This works *with* the execute footprint fence ("only create or modify files your task requires"), which already permits a required edit; the gap was that the authored task never said the edit was required, so the fix lives in authoring, not the fence.

**Conform to the target file's convention; don't prescribe one.** A task instruction that asserted a concrete convention value — a metadata element, a field or key name, a file layout — from the plan rather than the real sibling files was wrong when it differed from what the code actually uses, and dead (read by nothing) when it matched nothing. Breakdown now tells the task to match whatever sibling files use, so the convention is discovered at build time against ground truth rather than frozen into the task from a template.

## Known limitations

These are documented rather than deferred indefinitely — they represent real failure modes that haven't bitten hard enough yet to justify the added complexity.

**No budget awareness.** Neither workflow checks `budget.remaining()`. A large plan will consume the full token budget without warning. The right fix is to log remaining budget after each step and bail when it's insufficient for the next, but this requires estimating per-task cost, which varies widely. For now, keep plans reasonable or set a model override to a cheaper tier for execution.

**Corrective tasks are uncapped.** The verify loop runs up to 3 iterations, and each can spawn an arbitrary number of corrective tasks. In the worst case a verify agent returns many corrections per round, each spawning an execute and integrate agent. A per-iteration cap or total corrective-task budget would bound this, but the right cap depends on plan size and hasn't been calibrated yet. Partially mitigated: the watchdog (see design decision above) now *surfaces* corrective-task escalation as a Tier-1 warning, so a runaway loop no longer goes unnoticed — but the loop itself is still not hard-capped.

**Worktrees lose per-checkout state.** Addressed by the gather/apply worktree init mechanism (see design decision above). This now only affects parallel tasks and corrective tasks — sequential tasks run on the main checkout and have full state. Residual limitation: if a gather command fails (e.g. no default org set), the execute agent is told to stop and report, but this surfaces late — after the worktree is already created. A pre-flight check in the invoking Claude could catch this earlier.
