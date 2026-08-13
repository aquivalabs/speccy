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
  - [ ] each task's `depends_on` stated — the ids it needs, or an empty list
  - [ ] all four run-start baseline values captured last and returned
- ↩ a plan that contradicts itself, or a task infeasible from the plan alone, halts breakdown — report the conflict, decompose nothing.

Decompose this implementation plan into an ordered list of steps for execution by subagents in separate git worktrees.

Each step contains one or more tasks. Tasks within a step run in parallel, in isolated worktrees; steps run in order. Return steps in execution order.

**Favour parallelism — optimise for wall-clock.** Put tasks in the same parallel step whenever they have no real dependency on each other; the same work as three parallel batches finishes far sooner than as one sequential chain. Reserve a sequential step for a genuine dependency: a task needs a prior task's committed output, or two tasks would write the same files and conflict.

**Translate the plan's checkpoint milestones into verification-checkpoint tasks.** The plan's Order of operations names natural verification milestones — layer boundaries, integration seams. Read them and translate them; do not invent a cadence of your own. This supersedes any self-authored cadence. The plan says *where*; you say *how*. If the plan names no Checkpoint milestones, fall back to deciding the intermediate cadence yourself, as before. Either way, always author the final checkpoint — it is mandatory.

The full gate suite — build, lint, static analysis, full test run — is the dominant cost of a large run. Distribute it by the plan's milestones:

- Mark ordinary feature tasks **scoped**: they run only fast checks — a typecheck/compile plus the tests covering what they touched — before committing. Enough not to hand broken code downstream.
- At each milestone the plan names, author an explicit **verification-checkpoint** task: a sequential step whose task runs the full gate suite against the integrated base and fixes any breakage. Always author one final checkpoint at the end, even when the plan omits it.
- State in each task which level it runs in its `verification_level` field, `scoped` or `checkpoint`. A task with no marking runs the full suite by default, so an un-marked or single-task plan is never under-verified.

**State each task's dependencies in its `depends_on` field.** List the ids of the tasks whose committed output this task needs; an empty list when it needs none. Step order already carries the ordinary case — `depends_on` is how a task names an earlier task it cannot run without, so one failure isolates to the tasks that actually needed that work instead of cancelling everything after it. Spell the ids exactly as you wrote them: an id naming no task in your own breakdown is logged and ignored.

For each task, write self-contained instructions — a fresh agent with no knowledge of the plan must be able to complete the task from the description alone. Include relevant context about the codebase, conventions, and surrounding code.

**Shared-type edits ripple past the Files list.** When a task edits a type, interface, or fixture that other files consume — a shared schema, a reducer map, a common test fixture — say so in the task: expect literal and fixture updates across the repo, outside the Files list. A downstream file that won't compile against the new shape is a required edit, not scope creep.

**Conform to the target file's convention; don't prescribe one.** When a task names a concrete convention — a metadata element, a field or key name, a file layout — tell it to match what sibling files actually use, not a value asserted here. A prescribed value that differs from the real convention is wrong at worst, dead at best.

**Attach the project's own capabilities to each task.** If a project-capability manifest is provided, or the project's skills and agents are otherwise visible to you, give each task the skills whose triggers match its files — an explicit "consult these before writing" list. The executing agent can invoke a Skill, so naming them makes it apply the house convention instead of re-deriving it. A task that turns on where-something-belongs or whether-something-already-exists is different: resolve it *now* against the project's read-only research or hunter agents and bake the answer into the task description — the executing agent runs in an isolated worktree and cannot dispatch an agent of its own. Absent any such capabilities, author the task as usual.

Read the files referenced in the plan and their immediate dependencies to understand the current state before decomposing.

Write each task description to `.tasks/{run-id}/{task-id}.md`, using the run ID provided below. These files are the durable record of the decomposition — they enable resuming after partial failure without re-running breakdown. Ensure `.tasks/` is in `.gitignore`.

**Capture the four run-start baseline values last, and return them in the `baseline` object.** The commands arrive fully interpolated under `## Run-start baseline capture` below — run them exactly as written and copy their output. Run them **after** ensuring `.tasks/` is in `.gitignore` and **after** writing the task files, so the run's own setup dirt sits inside the baseline rather than beyond it: the `.gitignore` edit is itself an uncommitted tracked modification, and a baseline captured before it convicts every later checkpoint of dirt this run created. Nothing else in the run can produce these values — the script has no shell and no clock, and by the time the first task is confirmed the base branch has already moved — so a missing value aborts the run before the first task.

When a task's instructions reference its own task file, or another task file, give the **absolute** path: prepend the repository root (`git rev-parse --show-toplevel`) to `.tasks/{run-id}/{task-id}.md`. `.tasks/` is gitignored, so a parallel task's worktree does not contain it. An absolute path lets a worktree agent read its instructions from the main checkout directly, with no discovery step. That is the ONLY place a task file states a main-checkout absolute path: never present the main checkout's root as the task's working root — the executor's workspace is its own worktree, and the two trees share a layout, so a wrong-root edit looks successful until commit.

---

## execute

**Gate.**
- Entry: a self-contained task with its files, premises, and the gate stated under `## Verification level`.
- Exit — all must hold:
  - [ ] the gate stated under `## Verification level` run
  - [ ] work committed on the task branch — or, where that section states the full gate suite, a gate run that passed with nothing left to repair
  - [ ] the task ref written, or its refusal reported
  - [ ] a prose report returned, ending with its anchored lines
- ↩ a false premise halts the task (HARD) or reports under `## Deviations` (SOFT); an impossible task halts.

Execute this task in your worktree. Do NOT merge or modify other branches.

**Your worktree is your only workspace.** Use paths relative to your own cwd. An absolute repo-root path from the task file or the project docs points at the MAIN checkout — editing there corrupts other agents' work, and your commit will report "nothing to commit". The one sanctioned absolute path is reading task files under the main checkout's `.tasks/`.

**A refused worktree is handled, not improvised.** If you cannot enter the worktree you were assigned, make one by hand rather than working in the main checkout. Add a worktree on a new branch off the current HEAD, in a directory outside the repository's working tree; the branch name is yours to choose. Then work, commit with the `<task-id>: ` subject prefix, write your task ref exactly as described below, and say in your report that the worktree was hand-made, naming its path and its branch. The name costs nothing: your work is found by its commit hash and its subject prefix, never by its branch name. What is never allowed is committing into the main checkout. If you cannot create a worktree at all, halt — commit nothing and report that you could neither enter nor create one. A stated halt is recoverable; an improvised write into a shared tree is not.

**Use the project's own conventions first.** If your task lists project skills to consult, activate them — invoke the Skill — before writing; they carry the house conventions for this kind of work, and following them now avoids a rewrite at review. Treat any research finding baked into the task — where a thing belongs, what already exists — as authoritative context about this repo.

The plan and spec are authoritative — treat them as read-only. Never edit them, and never redesign around them to force your task to pass. If the task is impossible as written — the plan contradicts itself or the spec, an acceptance criterion is technically infeasible, or completing it would require changing the agreed design — stop. Commit nothing, and report plainly what is blocked, why, and what decision is needed. Halting lets a human revise the spec or plan; a silently improvised workaround corrupts both. You never write a shared file, and you never edit the plan or spec.

**Run a preflight premise check before writing code.** The task asserts premises about the current state — which files exist, their shapes, the integration points. Verify them first. Two outcomes, by severity:

- **HARD mismatch** — a premise so false the task cannot be done. This fires the halt-on-impossibility rule above: halt, commit nothing, report what is blocked and what decision is needed.
- **SOFT discrepancy** — a premise false, but you adapted and finished. Report it in your prose report under a fixed `## Deviations` heading. One entry each, shaped `plan expected X / found Y / done thus`. Omit the heading when there are no deviations.

Before committing, run the gate stated under `## Verification level` below. That section is composed for you and it is the whole answer: do not infer a level from your task's description, and do not decide one yourself. Where it states the **full gate suite** — build, lint, static analysis, tests, as documented in CLAUDE.md — fix any breakage you find; that gate's footprint is the whole integrated base, so repair regressions wherever they surface, not only in files you introduced. Where it states the **scoped** gate, run only the fast checks it names. Either way, never hand broken code downstream. If CLAUDE.md documents no verification tools, note this under `suggestions` in your friction log.

**A full gate suite that passes with nothing to repair needs no commit.** Where `## Verification level` states the full gate suite, your exit gate is satisfied by *either* work committed *or* a gate run that passed with nothing left to repair. That second case is the ordinary shape of a healthy run's checkpoint: nothing was broken, so there is nothing to fix and nothing to commit. Report it and stop.

**Never commit `--allow-empty`.** It is forbidden by name, whatever your exit gate seems to demand of you. An empty commit changes no path, so it fails the orchestrator's fourth verification condition and your task is recorded unverified — the commit buys you nothing and costs you the task. Report the passing gate and the absent commit instead.

When satisfying an enforced completion gate forces violating a softer CLAUDE.md preference, satisfy the gate and log the friction. An enforced gate is a rule whose violation blocks "done": a failing lint or static-analysis check, a required test. If the only way to clear it conflicts with a CLAUDE.md *style or aesthetic* preference — say, a rule requiring doc comments versus "comment only the non-obvious" — clear the gate and record the trade under `harder_than_expected` in your friction log. This carve-out covers style preferences only. An enforced gate must never override a CLAUDE.md *safety or correctness* rule, such as "never log PII" — there, stop and report it as a blocker rather than complying.

Stay within your task's footprint: create or modify only files your task requires. When running a formatter or autofixer, scope it to the files you touched — prefer the project's *verify*/*check* command over a repo-wide *write*. A whole-repo formatter run reformats unrelated files and pollutes the diff; if one does, revert the unrelated changes before committing. Commit only the files belonging to your task.

When done, commit all changes. Note your branch name (`git branch --show-current`) and your commit hash (`git rev-parse HEAD`) — the full forty characters, never an abbreviation.

**Write your task ref immediately after committing.** The exact ref arrives fully interpolated under `## Task ref` below; use it verbatim and compose no path of your own. Use the create-only form `git update-ref <the ref> <your-full-forty-character-hash> ""` and no other form. The empty third argument is what makes it create-only. Two outcomes:

- **It succeeds.** Done. The ref keeps your commit reachable by name even if your branch is deleted later, and it is written before anything confirms your work, so a run that stops between your commit and its confirmation still leaves your work findable.
- **It is refused** — `cannot lock ref ... reference already exists`. Compare: run `git rev-parse <the ref>`. Equal to your own hash means a replay of your own earlier write, which is success; do nothing more. Different means a collision: write nothing and report both hashes. A collision does not by itself unverify your task.

Never use the plain two-argument form `git update-ref <ref> <sha>` — it overwrites silently. Never use the three-argument compare-and-swap form: only the orchestrator's confirm agent moves a ref, because it is the only actor that has verified the commit. And never reach for create-only to *change* a ref — it cannot, which is what the refusal above is telling you.

**End your report with these anchored lines, each on its own line, in this order.** The confirm agent reads them by their fixed labels and reads nothing else out of your prose, so a relabelled, reworded or omitted line is a line that does not exist:

- `Commit: <the full forty-character hash>` — or `none` if you committed nothing. An abbreviated hash is not an identity.
- `Branch: <git branch --show-current>` — or `none` when you worked on the main checkout. Context only; nothing finds your work by this name.
- `Gate: pass` or `Gate: fail` — the **outcome** of the gate you ran, not the fact that you ran one. Required wherever `## Verification level` asks for an anchored gate line. `fail` is a truthful report and the right thing to send; a pass you did not earn is the one report nothing downstream can catch.
- `Uncommitted repair: none` — or `Uncommitted repair: <paths>`, listing every path you repaired and left uncommitted in the working tree. Required wherever `## Verification level` asks for an anchored repair line. This line, not the state of the tree, is what decides whether a gate that passed with nothing to commit is recorded as verified work.

Report the anchored gate line and the anchored repair line whether or not you committed anything: a gate run with nothing to commit is exactly the case they exist to describe.

You do not need to return a structured result — a concise prose report is enough. The orchestrator confirms what landed from git state, so what matters is that your work is **committed** and that your anchored lines say so. Include a friction log with three fields:

- **harder_than_expected** — anything that took more effort or was more complex than the task description suggested
- **wrong_turns** — approaches you tried that didn't work, and why
- **suggestions** — what would have made this task easier: better instructions, missing context, tooling gaps

---

## confirm

**Gate.**
- Entry: one task's execute report forwarded verbatim, the run id, all four run-start baseline values, the task's ref, and the two composed statements under `## Gate line` and `## Verified no-op`.
- Exit — all must hold:
  - [ ] one state reported — `verified`, `verified-no-op`, or `failed`
  - [ ] the rung that produced the evidence named, or `none`
  - [ ] a `verified` state carrying the full forty-character hash it was verified at
  - [ ] the task's ref read, and moved only by compare-and-swap
  - [ ] one `verification` line appended to the run ledger
- ↩ a condition you cannot evaluate is a condition that failed; report `failed` and say which one.

Determine from git whether a prior agent's task work landed. You are a reader. Run git commands and report what they say. Do NOT do the task's work, do not edit the working tree, do not commit, and do not run the project's build or tests — the gate outcome is the executing agent's report, not yours to re-derive.

Work through these eight steps in order.

**1. Read the execute report's anchored lines.** The report arrives verbatim under `## Execute report`. It may be explicitly empty — then you have no anchored lines and go straight to step 2. Four labelled lines matter, read exactly as written: `Commit:` (the full forty-character hash the agent claims), `Branch:` (context only — identity is the hash, never the branch name), `Gate:` (`pass` or `fail`), and `Uncommitted repair:` (`none`, or the paths the agent left uncommitted). Never infer a gate outcome from surrounding prose, and never read a missing line as a pass.

**2. Find a candidate commit, and name the rung that produced it.** Two rungs, in order:

- `reported-hash` — the hash on the `Commit:` line. Try it first.
- `subject-search` — when there is no `Commit:` line, or the hash it names fails a condition in step 3, run exactly `git log --branches --not <base_sha> --since=<started_at> --grep "^<task-id>: "`, taking `base_sha` and `started_at` as given under `## Run-start baseline`. Every part is load-bearing. `--branches` is what reaches a worktree task's commit: you stand in the main checkout, where that commit is not reachable from `HEAD`, so the range form `<base_sha>..HEAD` finds nothing for exactly the tasks this rung exists for. `--not <base_sha>` and `--since` drop commits that belong to an earlier run, whose task ids repeat this run's by construction.

**Its matches are candidates, not the answer.** `--grep` matches the whole commit message and anchors `^` to any line inside it, so a commit whose subject is unrelated and whose message *body* carries a line starting with the task id is returned. Confirm every candidate with `git log -1 --format=%s <hash>` and discard each one whose subject does not start with `<task-id>: `. Where more than one survives, take the newest. Report the rung that produced the commit you verified, and report `none` when no commit was verified at all.

**3. Verify the candidate against four conditions.** Every task that claims a commit is bound by all four, worktree or main checkout alike. Any one of them failing makes that commit unverified:

1. It resolves as a commit — `git rev-parse --verify <hash>^{commit}` exits 0. `git cat-file -e` is not a substitute: it succeeds on a blob.
2. Its subject starts with `<task-id>: ` — `git log -1 --format=%s <hash>`. This is what catches a task that committed nothing and reported the branch tip as its own.
3. It is not already contained in the base branch as of run start — `git merge-base --is-ancestor <hash> <base_sha>` must exit **non-zero**. Exit 0 means contained, and therefore unverified. The second argument is the captured `base_sha` and nothing else: never the base branch name and never `HEAD`, both of which read the branch as it is *now* and so unverify every main-checkout task in the run.
4. It changes at least one path — `git diff-tree --no-commit-id --name-only -r --root -m --first-parent <hash>` is non-empty. Every flag is load-bearing: the bare `-r` form reports no paths at all for a root commit or for a merge tip, and both are legitimate task commits.

A commit that fails any condition is not this task's evidence. Fall back to rung `subject-search` once, then stop.

**4. Apply the gate-line rule.** The requirement for this task arrives under `## Gate line`. It is composed for you; do not re-derive it from the task's description or from any level you think you can infer. Where an anchored gate line reporting a pass is required, the four conditions are necessary but not sufficient: a `Gate:` line reading `fail`, or no `Gate:` line at all, makes the task **failed** whatever it committed. Report the verified hash and branch anyway — the commit is recorded, it is simply not verified work — and carry the report's own words into your summary.

**5. Apply the no-op predicate.** Availability of the `verified-no-op` outcome arrives under `## Verified no-op`. Where it is not available, a task with no verified commit is `failed`. Where it is available, report `verified-no-op` when all three facts hold, and `failed` otherwise:

1. The `Gate:` line reads `pass`.
2. The `Uncommitted repair:` line names no path. What the agent reported about its own work decides this — not the working tree.
3. No commit carries the task id, under step 2's run-scoped `subject-search` command and never an unscoped search, which a previous run's `<task-id>: ` squash commit on the base would answer.

**The porcelain cross-check is one-sided: it may only ever fail a task, never verify one.** Compare `git status --porcelain` in the main checkout against `dirty_at_start` under `## Run-start baseline`:

- A **tracked-file modification or deletion** beyond the baseline fails fact 2, because the tree then shows work the report did not claim.
- An **untracked addition** beyond the baseline does **not** fail it. Note it in your summary and nothing more. The shapes that produce one are healthy: the gate suite writing a build directory the project does not ignore, and an earlier main-checkout task's uncommitted leaving, which its own prompt told it to leave.
- Porcelain matching the baseline byte for byte is never evidence *for* a no-op. Porcelain reports a path and not its content, and it collapses an untracked directory to its top entry, so a repair inside a path the baseline already recorded leaves the output unchanged. The `Uncommitted repair:` line is what covers that case, which is why fact 2 reads the report rather than the tree.

A `verified-no-op` carries no commit hash and no branch.

**6. Check the task's ref, and move it only by compare-and-swap.** The ref arrives fully interpolated under `## Task ref`. Read it with `git rev-parse <the ref>`:

- Equal to the verified commit — nothing to do.
- Absent — record that in your summary and write nothing. The create-only write belongs to the execute agent.
- Present but different — this is what a retried execute agent leaves behind. Move it with the compare-and-swap form `git update-ref <the ref> <verified-hash> <existing-hash>`, and report that you moved it. A refusal means the ref changed under you: report the refusal and move nothing.

Never the plain two-argument form `git update-ref <ref> <sha>`, which overwrites silently, and never the create-only form with `""`, which cannot update a ref at all.

**7. Report exactly one state.**

- `verified` — a commit passed all four conditions and, where a passing gate line was required, the `Gate:` line reads `pass`. Report the full forty-character hash exactly as long as the agent reported it, the branch you saw, and the rung. A `verified` state with no forty-character hash is refused by the orchestrator and recorded as a failure, so never report one.
- `verified-no-op` — step 5's three facts hold. No hash, no branch.
- `failed` — anything else. Name which condition, which rung, or which anchored line failed, and carry the execute report's own words into your summary. Never repair, re-run, or re-attempt the task to make it pass.

**8. Append one `verification` line to the run ledger.** One line per attempt, on every outcome — `verified`, `verified-no-op`, or `failed`. This is the only per-task record of what you decided, and two readers depend on it: a run that stops after you and before its integration leaves nothing else about this task, and a `verified-no-op` has no commit for anyone to find, so without your line an absent one and a verified no-op read the same.

Resolve the path yourself and create the directory first, because an append redirect into a missing directory fails:

- `mkdir -p "$(git rev-parse --show-toplevel)/.tasks/<run-id>"`
- append one line with a single `>>` redirect to `.tasks/<run-id>/ledger.jsonl` — never a read-modify-write of the file, which would lose a concurrent writer's line:

`{"kind":"verification","run_id":"<run-id>","task_id":"<task-id>","state":"verified","commit":"<the full forty-character hash, or null>","branch":"<the branch you saw, or null>","rung":"reported-hash","ref_moved":false,"at":"<date -u +%FT%TZ>"}`

Take the run id from `## Run`. `state` is the state you report in step 7, spelled exactly as you report it. Set `commit` to `null` for a `verified-no-op` and for any failure with no verified hash, `branch` to `null` where you saw none, `rung` to the rung that produced the evidence or `none`, and `ref_moved` to `true` only when you moved the ref in step 6.

Your line's kind is `verification`. The ledger also carries `integration`, `blocked` and `closing` lines from other agents of this run: append yours, and never rewrite, reorder or delete a line that is already there.

---

## integrate

**Gate.**
- Entry: the task's verified commit, the base branch, the run id, and all four run-start baseline values.
- Exit — all must hold:
  - [ ] the verified commit squash-merged onto the base branch, or recognised as already landed inside this run's range
  - [ ] the project builds
  - [ ] the squash commit reported, at the full forty characters — or its absence reported plainly, never an abbreviation and never a guess
  - [ ] one `integration` line appended to the run ledger
- ↩ a build that fails after merge resets to base (`git reset --hard HEAD`) and reports failure; a recognition search whose range holds no match reports failure.

Integrate one task's verified commit onto the base branch via squash merge.

**Identity is the commit, never the branch name.** The hash under `## Verified commit` is what the confirm agent verified against git, and it is what you merge. The branch under `## Task branch` is context: a hand-made worktree's branch follows no convention this run chose, and a branch can be renamed or gone, while the commit is reachable either way. Never substitute the branch name for the hash, and never abbreviate the hash.

Steps:

1. `git rev-parse --verify <the verified commit>^{commit}` — confirm the commit exists before you touch the base branch. If it does not resolve, merge nothing and report failure.
2. `git checkout <base-branch>`
3. `git merge --squash <the verified commit>`
4. Resolve conflicts if any, based on the task's intent
5. Verify the project builds
6. `git commit -m "<task-id>: <task-title>"`
7. `git rev-parse HEAD` — report those full forty characters as your squash commit.

**Recognise your own landed work, within this run's range only.** If step 3 reports nothing to squash, or step 6 reports nothing to commit, do not report failure yet: this prompt is retried whole when a call is dropped, and a second pass over a squash that already landed reports exactly that state. Check whether the base has gained a commit whose **subject** names this task since the run started. Run

`git log --format='%H %s' <base_sha>..<baseBranch>`

taking `base_sha` as given under `## Run-start baseline` and the base branch as given under `## Run`. Keep only the lines whose subject starts with `<task-id>: `, take the newest, and report success with that hash.

- **The range is what makes the recognition safe, and without it the recognition is worse than none.** Task ids repeat across runs by construction, so the same search unscoped returns a *previous* run's squash commit for this task id, and the run then records this task integrated at a hash that predates it — which teardown takes as its landed-content comparison point.
- **The subject test is the rule, not a detail of the command.** Never `git log -1 --format=%H --grep "^<task-id>: "`. `--grep` matches anywhere in a commit message, so a commit whose *body* carries a line starting with this task id is returned as this task's integration, and `-1` hides the substitution because it reports a hash with no subject to check. A checkpoint repairing several tasks' breakage plausibly writes such a body.
- **An empty range result is a failure report.** No match inside the range means nothing landed for this task in this run. A match outside the range belongs to another run and is never reported as yours.

**Report your squash commit, at the full forty characters** — the one you committed in step 6, or the one the recognition found. It is the fixed point teardown compares a branch against before deleting it, so an abbreviation or a guess is worse than an absence. If you succeeded and genuinely have no hash to name, report success with no `commit` field: the orchestrator records that as an integration with no fixed point, and does not retry you.

Do not delete the task branch or remove its worktree — the workflow owns that teardown after the run; it removes the worktree first, then deletes the branch. Running `git branch -D` here while the task's worktree is still live makes git refuse ("cannot delete branch ... used by worktree") and fails the integration.

If the build fails after merge, run `git reset --hard HEAD` to restore the base branch, then report failure.

**Append one `integration` line to the run ledger.** One line per attempt, on every outcome — merged, recognised, or failed. A missing line makes an integration that failed indistinguishable from one that was never attempted, which is the reading a human recovering the run cannot afford.

Resolve the path yourself and create the directory first, because an append redirect into a missing directory fails:

- `mkdir -p "$(git rev-parse --show-toplevel)/.tasks/<run-id>"`
- append one line with a single `>>` redirect to `.tasks/<run-id>/ledger.jsonl` — never a read-modify-write of the file, which would lose a concurrent writer's line:

`{"kind":"integration","run_id":"<run-id>","task_id":"<task-id>","outcome":"merged","commit":"<the forty-character squash commit>","branch":"<the task branch, or null>","at":"<date -u +%FT%TZ>"}`

Take the run id from `## Run`. `outcome` is `merged` when you committed the squash yourself, `recognised` when the range search found it already landed, and `failed` otherwise. Set `commit` to `null` when you have no forty-character hash to name — on a failure, and on the no-fixed-point case above.

Your line's kind is `integration`. The ledger also carries `verification`, `blocked` and `closing` lines from other agents of this run: append yours, and never rewrite, reorder or delete a line that is already there. In particular your line never supersedes this task's `verification` line — the two answer different questions about it.

---

## verify

**Gate.**
- Entry: the integrated base, the original plan, and the pass mode stated under `## Pass mode`.
- Exit — all must hold:
  - [ ] every plan deliverable has concrete evidence, or is classified as a gap
  - [ ] no corrective task authored where `## Pass mode` states the pass is read-only
- ↩ a fillable gap spawns a corrective task; a blocked requirement ends the loop and reports incomplete.

Verify implementation completeness against the original plan.

**Your pass may be read-only, and `## Pass mode` is the whole answer.** That section is composed for you: do not infer the mode from the state of the base, and do not decide one yourself. Where it states the pass is read-only, tasks in this run failed or were blocked — report which deliverables have evidence and what the tests did, and author **no** corrective tasks. Any you return is ignored, and the run reports incomplete with the failed and blocked lists beside your report. Repairing a base whose own tasks did not land is not this pass's job: the work to redo is the failed tasks themselves, which a human re-runs from the run's refs and ledger.

Steps:

1. Run the project's test suite
2. Extract every deliverable from the plan
3. For each, find concrete evidence: a file, function, test, or config change
4. Deliverables without evidence are gaps — but first confirm you looked where the work would be (below)
5. Classify each gap before acting on it:
   - **Fillable gap** — missing or incomplete work an agent can finish *within the agreed spec and plan*. Define a corrective task with full self-contained instructions.
   - **Blocked requirement** — the deliverable cannot be met as specified: the plan contradicts itself or the spec, an acceptance criterion is technically infeasible on this platform, or closing the gap would require changing the agreed design. The execute agents' friction logs are a primary signal — a task that halted as impossible — alongside your own analysis.

**Absent evidence is evidence of absence only after you confirm where you are looking.** Parallel tasks run in their own git worktrees, and a project can span more than one repository — so a deliverable can be fully built and still invisible from the checkout you happen to be standing in. Before calling anything a gap, establish three things and state them in that deliverable's `evidence`: the checkout (`git rev-parse --show-toplevel`), the branch (`git branch --show-current`), and whether the work sits on a branch you are not on (`git log --all --oneline -- <path>`). A deliverable declared missing because the search ran in the wrong repo or on the wrong branch is a false gap, and the corrective task it spawns rebuilds work that already exists.

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

---

## teardown

**Gate.**
- Entry: five inputs, none of them derivable by you — the run id, all four run-start baseline values, this run's task ids with any branch a confirm agent captured, each integrated task's recorded squash commit or the fact that its integration reported none, and the run's failed and blocked lists.
- Exit — all must hold:
  - [ ] every worktree and every `worktree-*` branch enumerated and reported, tied to this run or not
  - [ ] no worktree removed that was not clean
  - [ ] no branch deleted whose touched paths are not byte-identical in the commit that integrated it
  - [ ] one `blocked` line appended per blocked task
  - [ ] the closing lines appended — one per branch you decided on, and one for the run carrying every worktree path you saw
- ↩ a rule you cannot evaluate keeps the entry: report it with that reason, remove nothing, and record the failure under `errors`.

You are the last agent of the run. **Never delete work git has not proven landed.** Keeping something that could have gone costs the next run a little clutter; removing something that had not landed cannot be undone. The trees most likely to hold such work are the failed ones, because an agent that halts on a false premise commits nothing by instruction. So enumerate everything, report everything, and act only on what you can tie to this run.

Your five inputs arrive under `## Run`, `## Run-start baseline`, `## This run's tasks`, `## Recorded integrations`, and `## Failed tasks` with `## Blocked tasks`. Use them as given and re-derive none of them: never substitute `HEAD` or the base branch name for `base_sha`, and never take the current base tip for a task's recorded squash commit.

Work through these six steps in order.

**1. Enumerate both lists, and report every entry.** Run `git worktree prune` first to clear stale entries left by crashed runs, then:

- `git worktree list`
- `git branch --list 'worktree-*'`

Every entry either command returns appears in your result — a worktree under `worktrees`, a branch you tied to this run under `branches`, and anything you could not tie under `untied`. An entry you cannot explain is listed, never removed.

**2. Tie each entry to this run, or leave it alone.** A branch belongs to this run when **one** of three rungs matches **and** its tip is dated at or after the run start:

- its name appears in `## This run's tasks`;
- its tip is the target of one of this run's task refs — `git for-each-ref --format='%(objectname) %(refname)' refs/task/<run-id>/`, compared against `git rev-parse <branch>`;
- its tip subject starts with a task id from `## This run's tasks` — `git log -1 --format=%s <branch>`.

The date test applies to every rung, the captured name included: `git log -1 --format=%ct <branch>`, compared **numerically** against `started_at_epoch` under `## Run-start baseline`. A tip below that number predates the run and is never eligible for deletion, whichever rung matched.

**No other date format is in contract.** Git's default `%cd`, string-compared against `started_at`, ties a tip two days older than the run, because `T` sorts above a digit. `%cI` looks like the fix and still ties a tip 28 minutes before run start, because a `+03:00` offset is never normalised to UTC. Both were measured. Use `%ct` against the epoch number and convert nothing.

The date test is what stands between this run and an earlier one's work: task ids are ordinal and repeat by construction, so every earlier run leaves `worktree-*` branches whose tip subjects carry ids this run also uses. A subject match on its own ties them here and the delete rule then fires on somebody else's branch.

**3. Remove a worktree only when it is clean, and remove it before its branch.** For each worktree whose branch you tied to this run, run `git -C <path> status --porcelain`:

- **Empty** — `git worktree unlock <path>` (ignore a "not locked" error), then `git worktree remove <path>`. Record it removed.
- **Not empty** — leave it exactly where it is. Record it kept, with its path and its dirty-file count, which is the number of lines that porcelain output printed, so a human can go and read it.

**Never `git worktree remove --force`.** It is forbidden by name. Measured: it destroys modified and untracked content with nothing recoverable — the directory goes, and the file is in no commit and no dangling object. The invariant above has to cover work git was never given, and `--force` is the one command that breaks it.

Then run `git worktree prune` again, and if `.claude/worktrees/` is now empty, remove it. The worktree goes before its branch because git refuses to delete a branch still checked out in a live worktree; that refusal is a leaked branch, not an error to retry blindly.

**4. Run the landed-content check on every branch you tied to this run, before deleting any of them.**

- **The touched-path set** — `git merge-base <base-branch> <branch>`, then `git diff --name-only <the merge base> <branch>`, taking the base branch as given under `## Run`. These are the paths the branch changed, and the check reads nothing else.
- **An empty touched-path set is always kept, and never passed to the diff.** Measured: an empty pathspec after `--` is not "compare nothing", it degrades to a whole-tree diff — so the comparison stops being about this branch at all and its verdict says nothing about the branch's own work. Keep the branch and give that as the reason.
- **The comparison point is the recorded squash commit, not the current base tip.** Take it from `## Recorded integrations`. Teardown runs at the end of the run, so by now a later task, a corrective task or the final checkpoint may have edited the same paths on the base — measured, and against a moved tip a provably landed branch reads unlanded and is kept forever. Two fallbacks, and they are reported differently:
  - **No integration recorded for that task** — fall back to the base tip, `git rev-parse <base-branch>`, and say in the reason that this is the base-tip fallback for a branch with no recorded integration.
  - **An integration that reported no squash commit** — the same base-tip fallback, named in the reason as exactly that case, so a missing fixed point is never mistaken for an absent integration.
- **The check itself** — `git diff <branch> <the comparison point> -- <the touched paths>`. Empty output means the branch's content landed, and only then may it be deleted. Anything else keeps the branch, with the reason.
- **`git cherry <the comparison point> <branch>` is advisory context and decides nothing.** Record its output in the reason. It reports every commit of a squash-merged multi-commit branch as unmerged, so a gate on it keeps every such branch forever — measured against three real branches — and it ignores whitespace, so it also reports a branch as landed whose content the base does not have.

A branch belonging to a task in `## Failed tasks` is expected to be kept: its work never landed, so its own diff says so. Say which task in the reason rather than reporting the keep as an anomaly.

**5. Delete a branch only when every one of these holds.** You tied it to this run; its tip is dated at or after `started_at_epoch`; its touched-path set is non-empty; and step 4's diff was empty. Use `git branch -D <branch>` — a squash merge leaves no ancestry, so `-d` would wrongly refuse. Record every branch, deleted or kept, with the reason that decided it and the commit it was compared against. A delete git refuses because the branch is still checked out in a worktree goes under `errors`, and the branch stays: step 3's removal did not take effect.

**6. Append your ledger lines.** Two kinds, both written by you and by nobody else. Resolve the path yourself and create the directory first, because an append redirect into a missing directory fails:

- `mkdir -p "$(git rev-parse --show-toplevel)/.tasks/<run-id>"`
- append each line with a single `>>` redirect to `.tasks/<run-id>/ledger.jsonl` — one line per append, never a read-modify-write of the file, which would lose a concurrent writer's line.

**One `blocked` line per task in `## Blocked tasks`,** naming the task that blocked it:

`{"kind":"blocked","run_id":"<run-id>","task_id":"<task-id>","blocked_by":"<the blocking task id>","at":"<date -u +%FT%TZ>"}`

Without it a blocked task has no line at all — it ran no confirm agent and no integrate agent — and that absence would be the same evidence for "blocked by an earlier failure" as for "the run never reached this task".

**One `closing` line per branch you decided on,** carrying the task you tied it to:

`{"kind":"closing","run_id":"<run-id>","task_id":"<the task you tied the branch to, or null>","branch":"<branch>","action":"deleted","reason":"<the reason that decided it>","compared_against":"<the squash commit or the base tip, or null>","cherry":"<the advisory git cherry output, or null>","at":"<date -u +%FT%TZ>"}`

`action` is `deleted` or `kept`. Then **one `closing` line for the run itself**, carrying every worktree path you saw. This is the only line in the whole ledger that records a path: `git worktree list` is the only source of one, you are the only agent that runs it, and its output carries no task mapping — so the paths are recorded here, unmapped to a task, and no earlier line claims one.

`{"kind":"closing","run_id":"<run-id>","task_id":null,"worktrees":[{"path":"<path>","branch":"<branch or null>","action":"kept","dirty_files":2}],"at":"<date -u +%FT%TZ>"}`

Take the run id from `## Run`. Append these lines even when there was nothing to remove: a run with no worktree and no branch still has a ledger to close, and the run-level closing line is what says the run reached its end rather than dying somewhere before you.

Your kinds are `blocked` and `closing`. The ledger also carries `verification` and `integration` lines from earlier agents of this run: append yours, and never rewrite, reorder or delete a line that is already there. In particular a closing line never supersedes a task's `verification` line — the two answer different questions about that task.

**Report** four lists: every worktree you saw under `worktrees`, every branch you tied to this run under `branches`, everything you listed and could not tie under `untied`, and every failure under `errors`. All four may be empty, and on a run with no worktrees they are.
