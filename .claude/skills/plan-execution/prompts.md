# Subagent Prompts

Prompt templates for each subagent role. The SKILL.md instructs Claude to read this file and pass the prompts via `args.prompts`. The workflow appends task-specific data (plan text, file lists, acceptance criteria, etc.) to each prompt at runtime.

---

## breakdown

Decompose this implementation plan into an ordered list of steps for execution by subagents in separate git worktrees.

Each step contains one or more tasks. Return steps in execution order.

**Default to sequential steps** (one task per step). Only group tasks into a parallel step when they are obviously independent — e.g. touching completely separate files and features with no interaction.

For each task, write self-contained instructions — a fresh agent with no knowledge of the plan must be able to complete the task from the description alone. Include relevant context about the codebase, conventions, and surrounding code.

Read the files referenced in the plan and their immediate dependencies to understand the current state before decomposing.

Write each task description to `.tasks/{run-id}/{task-id}.md`, using the run ID provided below. These files are the durable record of the decomposition — they enable resuming after partial failure without re-running breakdown. Ensure `.tasks/` is in `.gitignore`.

---

## execute

Execute this task in your worktree. Do NOT merge or modify other branches.

The plan and spec are authoritative — treat them as read-only. Never edit them, and never redesign around them to force your task to pass. If the task is impossible as written — the plan contradicts itself or the spec, an acceptance criterion is technically infeasible, or completing it would require changing the agreed design — stop. Commit nothing, and report plainly what is blocked, why, and what decision is needed. Halting lets a human revise the spec or plan; a silently improvised workaround corrupts both.

Before committing, run the project's verification tools (build, lint, static analysis, tests) as documented in CLAUDE.md. If none are documented, note this under `suggestions` in your friction log.

When satisfying an enforced completion gate forces violating a softer CLAUDE.md preference, satisfy the gate and log the friction. An enforced gate is a rule whose violation blocks "done" — a failing lint / static-analysis check or a required test. If the only way to clear it conflicts with a CLAUDE.md *style or aesthetic* preference (e.g. a rule requiring doc comments vs. "comment only the non-obvious"), clear the gate and record the trade under `harder_than_expected` in your friction log. This carve-out is for style preferences only: an enforced gate must never override a CLAUDE.md *safety or correctness* rule (e.g. "never log PII") — there, stop and report it as a blocker rather than complying.

Stay within your task's footprint: only create or modify files your task requires. When running a formatter or autofixer, scope it to the files you touched — prefer the project's *verify*/*check* command over a repo-wide *write*. A whole-repo formatter run reformats unrelated files and pollutes the diff; if one does so, revert the unrelated changes before committing. Commit only the files belonging to your task.

When done, commit all changes. Note your branch name (`git branch --show-current`) and commit hash (`git rev-parse HEAD`).

You do not need to return a structured result — a concise prose report is enough. The orchestrator confirms what landed from git state, so the one thing that matters is that your work is **committed**. Include a friction log in your report with three fields:

- **harder_than_expected** — anything that took more effort or was more complex than the task description suggested
- **wrong_turns** — approaches you tried that didn't work, and why
- **suggestions** — what would have made this task easier (better instructions, missing context, tooling gaps)

---

## integrate

Integrate a completed task branch onto the base branch via squash merge.

Steps:

1. `git checkout <base-branch>`
2. `git merge --squash <task-branch>`
3. Resolve conflicts if any, based on the task's intent
4. Verify the project builds
5. `git commit -m "<task-id>: <task-title>"`

Do not delete the task branch or remove its worktree — the workflow owns that teardown after the run (it removes the worktree first, then deletes the branch). Running `git branch -D` here while the task's worktree is still live makes git refuse ("cannot delete branch ... used by worktree") and fails the integration.

If the build fails after merge, run `git reset --hard HEAD` to restore the base branch, then report failure.

---

## verify

Verify implementation completeness against the original plan.

Steps:

1. Run the project's test suite
2. Extract every deliverable from the plan
3. For each, find concrete evidence: a file, function, test, or config change
4. Deliverables without evidence are gaps
5. Classify each gap before acting on it:
   - **Fillable gap** — missing or incomplete work an agent can finish _within the agreed spec and plan_. Define a corrective task with full self-contained instructions.
   - **Blocked requirement** — the deliverable cannot be met as specified: the plan contradicts itself or the spec, an acceptance criterion is technically infeasible on this platform, or closing the gap would require changing the agreed design. The execute agents' friction logs are a primary signal (a task that halted as impossible), alongside your own analysis.

Corrective tasks may only fill gaps **within the agreed design**. Never author a corrective task that redesigns, "replaces the mechanism," works around the spec, or edits the spec/plan to make a deliverable pass — that is the build improvising around intent, the exact failure this guard prevents.

For a blocked requirement: mark the deliverable a gap, define **no** corrective task for it, and state the blocking reason and the decision the human must make in that deliverable's `evidence`. With no corrective task to run, the loop ends and the run reports incomplete — routing the decision back to a human to revise the spec or plan and re-run. That is the correct outcome; do not manufacture a corrective task to avoid it.

This is a gap check, not a quality review.

---

## retrospective

Synthesize friction logs from a multi-task execution run into a retrospective.

Focus on cross-cutting patterns: repeated struggles, systemic plan gaps, friction a skill or CLAUDE.md update could eliminate. Note positives too. Individual one-off difficulties: mention briefly.

Collect any finding that points at a project-level doc gap (a CLAUDE.md convention worth adding, an ADR worth capturing, a stale reference) under a final `## Repo-doc suggestions (CLAUDE.md / ADR)` heading, so the orchestrator can surface them at wrap-up.

Be concise and actionable.
