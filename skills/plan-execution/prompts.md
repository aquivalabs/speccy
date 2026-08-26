# Subagent Prompts

Prompt templates for each subagent role. The SKILL.md instructs Claude to read this file and pass the prompts via `args.prompts`. The workflow appends task-specific data (plan text, file lists, acceptance criteria, etc.) to each prompt at runtime.

---

## breakdown

Decompose this implementation plan into an ordered list of steps for execution by subagents in separate git worktrees.

Each step contains one or more tasks; tasks within a step run in parallel (isolated worktrees), and steps run in order. Return steps in execution order.

**Favour parallelism: optimise for wall-clock.** Put tasks in the same parallel step whenever they have no real dependency on each other; the same work as three parallel batches finishes far sooner than as one sequential chain. Reserve sequential ordering (a step of its own) for a genuine dependency: a task needs a prior task's committed output, or two tasks would write the same files and conflict.

**Carry the plan's own orchestration rules into the tasks, verbatim.** Where the plan states a sequencing, ownership, or shared-environment rule — "step 1 owns the deploy, step 2 waits", "only the migration task writes the schema", "this task must not touch the org" — copy it word for word into every task it governs. Such a rule encodes a constraint the plan's author knew about and the decomposition cannot rediscover from the code, so it outranks your own ordering call: never widen a step the plan sequenced, and never hand two tasks a resource the plan gave to one. Restating it in your own words is where it gets lost.

**Decide the verification cadence.** The full gate suite (build, lint, static analysis, full test run) is the dominant cost of a large run; run inside every task, it pays the whole suite once per task. Distribute it deliberately:

- Mark ordinary feature tasks **scoped**: they run only fast checks (typecheck/compile plus the tests covering what they touched) before committing, enough not to hand broken code downstream.
- Author explicit **verification-checkpoint** tasks (a sequential step whose task runs the full gate suite against the integrated base and fixes any breakage) at natural milestones: after a parallel batch lands, at a layer boundary (e.g. server complete before client begins), and always once at the end. Checkpoint more often on a large multi-batch plan so a regression stays attributable to its batch; a small plan may need only the final one.
- State in each task which level it runs (scoped vs checkpoint). A task with no marking runs the full suite by default, so an un-marked or single-task plan is never under-verified.

**Give each task only the worktree init it needs.** Where the run supplies a numbered list of worktree init commands, set each task's `worktree_init` to the numbers that task needs, and to `[]` for one whose instructions forbid touching the environment those commands configure. Omitting the field runs all of them, which is the right default for a task that builds, deploys, or runs the full gate suite. The init a task must not run is the one that contradicts its brief, and an agent handed both spends its first turns deciding which to believe.

For each task, write self-contained instructions: a fresh agent with no knowledge of the plan must be able to complete the task from the description alone. Include relevant context about the codebase, conventions, and surrounding code.

**Shared-type edits ripple past the Files list.** When a task edits a type, interface, or fixture that other files consume (a shared schema, a reducer map, a common test fixture), say so in the task: expect literal/fixture updates across the repo, outside the Files list. A downstream file that won't compile against the new shape is a required edit rather than scope creep.

**Conform to the target file's convention; don't prescribe one.** When a task names a concrete convention (a metadata element, a field or key name, a file layout), tell it to match what sibling files actually use rather than a value asserted here. A prescribed value that differs from the real convention is wrong at worst, dead at best.

Read the files referenced in the plan and their immediate dependencies to understand the current state before decomposing.

Write each task description to `.tasks/{run-id}/{task-id}.md`, using the run ID provided below. These files are the durable record of the decomposition: they enable resuming after partial failure without re-running breakdown. Ensure `.tasks/` is in `.gitignore`.

When a task's instructions reference its own task file (or another task file), give the **absolute** path: prepend the repository root (`git rev-parse --show-toplevel`) to `.tasks/{run-id}/{task-id}.md`. `.tasks/` is gitignored, so a parallel task's worktree does not contain it. An absolute path lets a worktree agent read its instructions from the main checkout directly, with no discovery step.

---

## execute

Execute this task in your worktree. Do NOT merge or modify other branches.

The plan and spec are authoritative: treat them as read-only. Never edit them, and never redesign around them to force your task to pass. If the task is impossible as written (the plan contradicts itself or the spec, an acceptance criterion is technically infeasible, or completing it would require changing the agreed design), stop. Commit nothing, and report plainly what is blocked, why, and what decision is needed. Halting lets a human revise the spec or plan; a silently improvised workaround corrupts both.

Before committing, run the verification level your task specifies. If the task marks itself **scoped**, run only fast checks: a typecheck/compile plus the tests covering what you touched. If it marks itself a **verification checkpoint**, or gives no marking, run the project's full gate suite (build, lint, static analysis, tests) as documented in CLAUDE.md and fix any breakage. A checkpoint's footprint is the whole integrated base, so it may repair regressions wherever they surface rather than only in files it introduced. Either way, never hand broken code downstream. If CLAUDE.md documents no verification tools, note this under `suggestions` in your friction log.

When satisfying an enforced completion gate forces violating a softer CLAUDE.md preference, satisfy the gate and log the friction. An enforced gate is a rule whose violation blocks "done": a failing lint / static-analysis check or a required test. If the only way to clear it conflicts with a CLAUDE.md *style or aesthetic* preference (e.g. a rule requiring doc comments vs. "comment only the non-obvious"), clear the gate and record the trade under `harder_than_expected` in your friction log. This carve-out is for style preferences only: an enforced gate must never override a CLAUDE.md *safety or correctness* rule (e.g. "never log PII"); there, stop and report it as a blocker rather than complying.

Stay within your task's footprint: only create or modify files your task requires. When running a formatter or autofixer, scope it to the files you touched; prefer the project's *verify*/*check* command over a repo-wide *write*. A whole-repo formatter run reformats unrelated files and pollutes the diff; if one does so, revert the unrelated changes before committing. Commit only the files belonging to your task.

When done, commit all changes. Then end your report with these two lines, exactly as labelled; the orchestrator reads them by their labels, and your commit is what gets integrated:

- `Commit: <the full hash from git rev-parse HEAD>`: all of it, exactly as git printed it, never an abbreviation
- `Branch: <git branch --show-current>`

You do not need to return a structured result; a concise prose report is enough. The orchestrator confirms what landed from git state, so the one thing that matters is that your work is **committed**. Include a friction log in your report with three fields:

- **harder_than_expected**: anything that took more effort or was more complex than the task description suggested
- **wrong_turns**: approaches you tried that didn't work, and why
- **suggestions**: what would have made this task easier (better instructions, missing context, tooling gaps)

---

## integrate

Integrate one task's confirmed commit onto the base branch via squash merge.

**The commit is the identity.** Merge the hash under `## Verified commit`; the branch is context only. In a parallel step every sibling's branch is equally recent, so any rule that picks a branch by name or by date can pick a sibling's work; and a branch can be renamed or deleted while the commit stays reachable.

Steps:

1. `git rev-parse --verify <the verified commit>^{commit}`: confirm it exists before touching the base branch. If it does not resolve, merge nothing and report failure.
2. `git checkout <base-branch>`, then `git status --porcelain`. It must print nothing. If it prints anything, merge nothing and report failure, naming what was dirty: the base branch is mid-merge from an earlier integration, and squashing on top of someone else's unresolved changes commits their partial work under your task's message.
3. `git merge --squash <the verified commit>`
4. Resolve conflicts if any, based on the task's intent
5. Verify the project builds
6. `git commit -m "<task-id>: <task-title>"`

Do not delete the task branch or remove its worktree: the workflow owns that teardown after the run (it removes the worktree first, then deletes the branch). Running `git branch -D` here while the task's worktree is still live makes git refuse ("cannot delete branch ... used by worktree") and fails the integration.

**On any failure at or after step 3 (an unresolvable conflict, a failing build, a refused commit), restore the base branch with `git reset --hard HEAD` before you report.** That discards only the squash you staged; the task's own commit is untouched on its branch. The next task in this step integrates immediately after you, onto whatever you leave behind, so reporting failure from a dirty base branch corrupts its squash commit rather than just its own.

---

## verify

Verify implementation completeness against the original plan.

Steps:

1. Run the project's test suite
2. Extract every deliverable from the plan
3. For each, find concrete evidence: a file, function, test, or config change
4. Deliverables without evidence are gaps
5. Classify each gap before acting on it:
   - **Fillable gap**: missing or incomplete work an agent can finish _within the agreed spec and plan_. Define a corrective task with full self-contained instructions.
   - **Blocked requirement**: the deliverable cannot be met as specified, because the plan contradicts itself or the spec, an acceptance criterion is technically infeasible on this platform, or closing the gap would require changing the agreed design. The execute agents' friction logs are a primary signal (a task that halted as impossible), alongside your own analysis.

Corrective tasks may only fill gaps **within the agreed design**. Never author a corrective task that redesigns, "replaces the mechanism," works around the spec, or edits the spec/plan to make a deliverable pass: that is the build improvising around intent, the exact failure this guard prevents.

For a blocked requirement: mark the deliverable a gap, define **no** corrective task for it, and state the blocking reason and the decision the human must make in that deliverable's `evidence`. With no corrective task to run, the loop ends and the run reports incomplete, routing the decision back to a human to revise the spec or plan and re-run. That is the correct outcome; do not manufacture a corrective task to avoid it.

This is a gap check rather than a quality review.

---

## retrospective

Synthesize friction logs from a multi-task execution run into a retrospective.

Focus on cross-cutting patterns: repeated struggles, systemic plan gaps, friction a skill or CLAUDE.md update could eliminate. Note positives too. Individual one-off difficulties: mention briefly.

Collect any finding that points at a project-level doc gap (a CLAUDE.md convention worth adding, an ADR worth capturing, a stale reference) under a final `## Repo-doc suggestions (CLAUDE.md / ADR)` heading, so the orchestrator can surface them at wrap-up.

Be concise and actionable.
