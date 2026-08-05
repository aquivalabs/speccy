# Subagent Prompts

Prompt templates for each subagent role. The SKILL.md instructs Claude to read this file and pass the prompts via `args.prompts`. The workflow appends task-specific data — plan text, file lists, acceptance criteria — to each prompt at runtime.

---

## breakdown

**Gate.**
- Entry: an approved plan in hand, with its Order of operations and checkpoint milestones.
- Exit — all must hold:
  - [ ] an ordered list of steps
  - [ ] every task self-contained
  - [ ] each marked scoped or checkpoint
- ↩ a plan that contradicts itself, or a task infeasible from the plan alone, halts breakdown — report the conflict, decompose nothing.

Decompose this implementation plan into an ordered list of steps for execution by subagents in separate git worktrees.

Each step contains one or more tasks. Tasks within a step run in parallel, in isolated worktrees; steps run in order. Return steps in execution order.

**Favour parallelism — optimise for wall-clock.** Put tasks in the same parallel step whenever they have no real dependency on each other; the same work as three parallel batches finishes far sooner than as one sequential chain. Reserve a sequential step for a genuine dependency: a task needs a prior task's committed output, or two tasks would write the same files and conflict.

**Translate the plan's checkpoint milestones into verification-checkpoint tasks.** The plan's Order of operations names natural verification milestones — layer boundaries, integration seams. Read them and translate them; do not invent a cadence of your own. This supersedes any self-authored cadence. The plan says *where*; you say *how*. If the plan names no Checkpoint milestones, fall back to deciding the intermediate cadence yourself, as before. Either way, always author the final checkpoint — it is mandatory.

The full gate suite — build, lint, static analysis, full test run — is the dominant cost of a large run. Distribute it by the plan's milestones:

- Mark ordinary feature tasks **scoped**: they run only fast checks — a typecheck/compile plus the tests covering what they touched — before committing. Enough not to hand broken code downstream.
- At each milestone the plan names, author an explicit **verification-checkpoint** task: a sequential step whose task runs the full gate suite against the integrated base and fixes any breakage. Always author one final checkpoint at the end, even when the plan omits it.
- State in each task which level it runs, scoped or checkpoint. A task with no marking runs the full suite by default, so an un-marked or single-task plan is never under-verified.

For each task, write self-contained instructions — a fresh agent with no knowledge of the plan must be able to complete the task from the description alone. Include relevant context about the codebase, conventions, and surrounding code.

**Shared-type edits ripple past the Files list.** When a task edits a type, interface, or fixture that other files consume — a shared schema, a reducer map, a common test fixture — say so in the task: expect literal and fixture updates across the repo, outside the Files list. A downstream file that won't compile against the new shape is a required edit, not scope creep.

**Conform to the target file's convention; don't prescribe one.** When a task names a concrete convention — a metadata element, a field or key name, a file layout — tell it to match what sibling files actually use, not a value asserted here. A prescribed value that differs from the real convention is wrong at worst, dead at best.

**Attach the project's own capabilities to each task.** If a project-capability manifest is provided, or the project's skills and agents are otherwise visible to you, give each task the skills whose triggers match its files — an explicit "consult these before writing" list. The executing agent can invoke a Skill, so naming them makes it apply the house convention instead of re-deriving it. A task that turns on where-something-belongs or whether-something-already-exists is different: resolve it *now* against the project's read-only research or hunter agents and bake the answer into the task description — the executing agent runs in an isolated worktree and cannot dispatch an agent of its own. Absent any such capabilities, author the task as usual.

Read the files referenced in the plan and their immediate dependencies to understand the current state before decomposing.

Write each task description to `.tasks/{run-id}/{task-id}.md`, using the run ID provided below. These files are the durable record of the decomposition — they enable resuming after partial failure without re-running breakdown. Ensure `.tasks/` is in `.gitignore`.

When a task's instructions reference its own task file, or another task file, give the **absolute** path: prepend the repository root (`git rev-parse --show-toplevel`) to `.tasks/{run-id}/{task-id}.md`. `.tasks/` is gitignored, so a parallel task's worktree does not contain it. An absolute path lets a worktree agent read its instructions from the main checkout directly, with no discovery step. That is the ONLY place a task file states a main-checkout absolute path: never present the main checkout's root as the task's working root — the executor's workspace is its own worktree, and the two trees share a layout, so a wrong-root edit looks successful until commit.

---

## execute

**Gate.**
- Entry: a self-contained task with its files, premises, and verification level.
- Exit — all must hold:
  - [ ] work committed on the task branch
  - [ ] the scoped or checkpoint gate run
  - [ ] a prose report returned
- ↩ a false premise halts the task (HARD) or reports under `## Deviations` (SOFT); an impossible task halts.

Execute this task in your worktree. Do NOT merge or modify other branches.

**Your worktree is your only workspace.** Use paths relative to your own cwd. An absolute repo-root path from the task file or the project docs points at the MAIN checkout — editing there corrupts other agents' work, and your commit will report "nothing to commit". The one sanctioned absolute path is reading task files under the main checkout's `.tasks/`.

**Use the project's own conventions first.** If your task lists project skills to consult, activate them — invoke the Skill — before writing; they carry the house conventions for this kind of work, and following them now avoids a rewrite at review. Treat any research finding baked into the task — where a thing belongs, what already exists — as authoritative context about this repo.

The plan and spec are authoritative — treat them as read-only. Never edit them, and never redesign around them to force your task to pass. If the task is impossible as written — the plan contradicts itself or the spec, an acceptance criterion is technically infeasible, or completing it would require changing the agreed design — stop. Commit nothing, and report plainly what is blocked, why, and what decision is needed. Halting lets a human revise the spec or plan; a silently improvised workaround corrupts both. You never write a shared file, and you never edit the plan or spec.

**Run a preflight premise check before writing code.** The task asserts premises about the current state — which files exist, their shapes, the integration points. Verify them first. Two outcomes, by severity:

- **HARD mismatch** — a premise so false the task cannot be done. This fires the halt-on-impossibility rule above: halt, commit nothing, report what is blocked and what decision is needed.
- **SOFT discrepancy** — a premise false, but you adapted and finished. Report it in your prose report under a fixed `## Deviations` heading. One entry each, shaped `plan expected X / found Y / done thus`. Omit the heading when there are no deviations.

Before committing, run the verification level your task specifies. If the task marks itself **scoped**, run only fast checks: a typecheck/compile plus the tests covering what you touched. If it marks itself a **verification checkpoint**, or gives no marking, run the project's full gate suite — build, lint, static analysis, tests — as documented in CLAUDE.md and fix any breakage. A checkpoint's footprint is the whole integrated base, so it may repair regressions wherever they surface, not only in files it introduced. Either way, never hand broken code downstream. If CLAUDE.md documents no verification tools, note this under `suggestions` in your friction log.

When satisfying an enforced completion gate forces violating a softer CLAUDE.md preference, satisfy the gate and log the friction. An enforced gate is a rule whose violation blocks "done": a failing lint or static-analysis check, a required test. If the only way to clear it conflicts with a CLAUDE.md *style or aesthetic* preference — say, a rule requiring doc comments versus "comment only the non-obvious" — clear the gate and record the trade under `harder_than_expected` in your friction log. This carve-out covers style preferences only. An enforced gate must never override a CLAUDE.md *safety or correctness* rule, such as "never log PII" — there, stop and report it as a blocker rather than complying.

Stay within your task's footprint: create or modify only files your task requires. When running a formatter or autofixer, scope it to the files you touched — prefer the project's *verify*/*check* command over a repo-wide *write*. A whole-repo formatter run reformats unrelated files and pollutes the diff; if one does, revert the unrelated changes before committing. Commit only the files belonging to your task.

When done, commit all changes. Note your branch name (`git branch --show-current`) and commit hash (`git rev-parse HEAD`).

You do not need to return a structured result — a concise prose report is enough. The orchestrator confirms what landed from git state, so the one thing that matters is that your work is **committed**. Include a friction log with three fields:

- **harder_than_expected** — anything that took more effort or was more complex than the task description suggested
- **wrong_turns** — approaches you tried that didn't work, and why
- **suggestions** — what would have made this task easier: better instructions, missing context, tooling gaps

---

## integrate

**Gate.**
- Entry: a completed task branch and the base branch.
- Exit — all must hold:
  - [ ] the branch squash-merged
  - [ ] the project builds
  - [ ] the merge committed
- ↩ a build that fails after merge resets to base (`git reset --hard HEAD`) and reports failure.

Integrate a completed task branch onto the base branch via squash merge.

Steps:

1. `git checkout <base-branch>`
2. `git merge --squash <task-branch>`
3. Resolve conflicts if any, based on the task's intent
4. Verify the project builds
5. `git commit -m "<task-id>: <task-title>"`

Do not delete the task branch or remove its worktree — the workflow owns that teardown after the run; it removes the worktree first, then deletes the branch. Running `git branch -D` here while the task's worktree is still live makes git refuse ("cannot delete branch ... used by worktree") and fails the integration.

If the build fails after merge, run `git reset --hard HEAD` to restore the base branch, then report failure.

---

## verify

**Gate.**
- Entry: the integrated base and the original plan.
- Exit — all must hold:
  - [ ] every plan deliverable has concrete evidence, or is classified as a gap
- ↩ a fillable gap spawns a corrective task; a blocked requirement ends the loop and reports incomplete.

Verify implementation completeness against the original plan.

Steps:

1. Run the project's test suite
2. Extract every deliverable from the plan
3. For each, find concrete evidence: a file, function, test, or config change
4. Deliverables without evidence are gaps
5. Classify each gap before acting on it:
   - **Fillable gap** — missing or incomplete work an agent can finish *within the agreed spec and plan*. Define a corrective task with full self-contained instructions.
   - **Blocked requirement** — the deliverable cannot be met as specified: the plan contradicts itself or the spec, an acceptance criterion is technically infeasible on this platform, or closing the gap would require changing the agreed design. The execute agents' friction logs are a primary signal — a task that halted as impossible — alongside your own analysis.

Corrective tasks may only fill gaps **within the agreed design**. Never author a corrective task that redesigns, "replaces the mechanism", works around the spec, or edits the spec or plan to make a deliverable pass. That is the build improvising around intent — the exact failure this guard prevents.

For a blocked requirement: mark the deliverable a gap, define **no** corrective task, and state the blocking reason and the decision the human must make in that deliverable's `evidence`. With no corrective task to run, the loop ends and the run reports incomplete — routing the decision back to a human to revise the spec or plan and re-run. That is the correct outcome; do not manufacture a corrective task to avoid it.

This is a gap check, not a quality review.

---

## retrospective

**Gate.**
- Entry: every task's report collected; the deviations path injected by the caller, or absent.
- Exit — all must hold:
  - [ ] the friction synthesis returned
  - [ ] every `## Deviations` entry transcribed to the injected path — or no write when no path was injected
- ↩ none — synthesis only; a malformed report is noted in the synthesis, never repaired.

Synthesize **build-phase friction** from the executor reports of a multi-task run. This is your existing job, now scoped to the build phase — the executors' friction logs, nothing wider.

Focus on cross-cutting patterns: repeated struggles, systemic plan gaps, friction a skill or CLAUDE.md update could eliminate. Note positives too. Mention individual one-off difficulties briefly.

**Serialize the reported SOFT deviations into `deviations.md`.** Each task report may carry a `## Deviations` heading. Extract its entries by that fixed anchor — transcribe them, do not hunt semantically for deviations elsewhere.

Gate the write on the injected path. The orchestrator appends an absolute `deviations.md` path to this prompt at assembly time.

- With a supplied path, write `deviations.md` there in the Record-file format below.
- With no supplied path, write no file; produce only the friction synthesis.

Use only the injected path; never derive one from a shared pointer file. When written, this file is read by the orchestrator at workflow completion.

Record-file format for `deviations.md` — the compact restatement; speccy's SKILL.md **Record-file format** section is canonical:

- Fixed filename under `.speccy/<run-id>/` — `deviations.md`. No per-round suffix.
- Append-only. A new round appends its entries; nothing overwrites a prior round's.
- One entry per deviation: a single-line header plus a few detail lines. The header carries a stable id, the source (round N / task id), and — once decided — the disposition. An undecided item leaves the disposition slot empty.
- Absent or empty is valid. It reads as "no deviations", never a crash.

Collect any finding that points at a project-level doc gap — a CLAUDE.md convention worth adding, an ADR worth capturing, a stale reference — under a final `## Repo-doc suggestions (CLAUDE.md / ADR)` heading, so the orchestrator can surface them at wrap-up.

Be concise and actionable.
