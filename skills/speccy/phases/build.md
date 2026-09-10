# Phase 3: Implementation

_Paths like `prompts/implementation-fix.md` are relative to the skill directory (the parent of this `phases/` folder), the same anchor `SKILL.md` uses. **Bold section names** (e.g. **Steering away from cognitive surrender**, **Subagent results: trust files over returns**) refer to `SKILL.md`, which is always loaded; read it for the cross-cutting rules this phase relies on._

The build kickoff is a handoff rather than a gate (see **Steering away from cognitive surrender**): 2b was the engagement point, so pose no pre-question and announce no check here. If you frame the handoff at all, keep it to a passing line: the build now runs autonomously and the user stays **on** the loop, free to watch it work and step in, rather than walking away from it, which is the vibe-coding failure mode speccy exists to avoid. ("In the loop" is for the spec and plan gates, where the user decides each acceptance; the build is supervision rather than decision-by-decision.) Then start the build.

Invoke the `plan-execution` skill directly via the Skill tool from the main conversation: as `speccy:plan-execution` when running from the installed plugin (plugin skills are namespaced `plugin:skill`), or bare `plan-execution` from a local `.claude/skills` checkout; use whichever name the available-skills listing shows. Pass the plan path as `args.planPath` (rather than the full plan text; the workflow reads the file itself, which keeps the orchestration call small and the plan editable mid-run) and the builder model as `args.model` (from state.json's `builderModel`, default sonnet). The breakdown agent inside plan-execution always uses Opus regardless; only execute/integrate/verify pick up the override.

Do _not_ wrap this in an Agent subagent: Agent subagents lack `Workflow`, so the call breaks. Plan-execution already backgrounds its own work (breakdown, execute, integrate, verify); only the final result returns.

When the workflow reports complete, do not advance on its "gates pass" / "0 violations" summary: a build agent can satisfy a gate by fabricating or inverting a rule and still report green. Re-run the project's load-bearing gates yourself (the build, lint / static-analysis, and test commands from CLAUDE.md) and confirm the actual tool output. If a gate fails, the run isn't done: carry the real tool output into a fix round (the Phase 4 implementation-fix agent handles exactly this), re-run the gates after it, and repeat until you have seen them pass. Only then `state.mjs advance --run <id> review` and continue.

If the implementation workflow exits incomplete, stop the pipeline. Report what's done and what remains: the user has a branch with partial progress. State.json remains at `phase: "implementation"` so the run can be resumed later.

## Phase 4: Implementation review

After implementation is complete, the code gets an independent review across several lenses, run in parallel. Completeness is already verified by the task execution skill, so this phase is about quality, spec fidelity, and fit.

### The lenses

Each round spawns these reviewers as **parallel** subagents (one message, one Agent call each), all **read-only**; none edits code. Each writes its findings to its own file `.speccy/<run-id>/review-round-N-<lens>.md`. Pass each the base branch so it can diff `<base-branch>...HEAD`. All prompt paths are relative to the skill directory.

Pass each bespoke lens `prompts/review-output-contract.md` alongside its own prompt. It standardises the finding shape across lenses so triage is mechanical, and makes writing the file a hard contract: a lens that runs out of room mid-verification still leaves a file, marking the unconfirmed candidate `PLAUSIBLE`, rather than returning nothing. `code-review` is a built-in skill that won't read the contract; the orchestrator applies the same shape itself when it normalises `code-review`'s findings into the code-review lens file.

- **Code review**: the built-in `code-review` skill, targeting `<base-branch>...HEAD` at `high` effort, with no `--fix` and no `--comment`. It covers correctness and general code quality, so the bespoke lenses handle only what it can't. Run it every round.

  Invoke it **directly in the main conversation** (via the `Skill` tool) rather than inside an Agent subagent: it spawns its own subagents, and wrapping a multi-agent skill stalls it. Parse its output tolerantly (the shape may change), normalise its verdicts into the shared finding shape, and write `review-round-N-code-review.md` yourself.
- **Project review gate**: the repo's *own* review gate, if it ships one (a `/review`-style skill, project-defined reviewer agents, or a `.claude/review.config.json`). When present, run it as an extra lens. It encodes the house security bar, thresholds, and invariants a generic reviewer can't replicate, so where it exists it is the highest-signal lens in the panel; run it the way the repo documents (its own agents, models, and thresholds; do not override them). Like `code-review`, a project gate is usually itself multi-agent, so invoke it **directly in the main conversation** rather than wrapped in an Agent subagent (same reason, and see **Subagent results: trust files over returns**). It is **spec-blind**: it checks house quality and says nothing about whether the build meets _this spec's_ criteria, so it complements the spec-fidelity lens and never replaces it. Normalise its findings into the shared shape and write `review-round-N-project-gate.md` yourself; the triage step dedups its overlap with `code-review`, codebase fit, and local-doc adherence like any other lens. If the repo has no such gate, skip this lens.
- **Spec fidelity**: `prompts/review-spec-fidelity.md`, with the spec path. Does the code satisfy the spec's completion criteria and intent?
- **Tests**: `prompts/review-tests.md`, with the spec and plan paths. Test-strategy adherence, test quality, and consolidation of new tests against the existing suite.
- **Codebase fit**: `prompts/review-codebase-fit.md`. Does this change worsen an already-imperfect area or repeat an existing smell? Judged against the touched files' current state rather than the diff alone.
- **Local-doc adherence**: `prompts/review-local-docs.md`. Violations of the repo's governing docs, including CLAUDE.md, which it deliberately re-checks even though code-review covers it too.
- **Suppressions**: `prompts/review-suppressions.md`. Extremely harsh on any linter/analysis/type/test-gate suppression the change adds or leans on. Each must be watertight or it is a finding.
- **Comments**: `prompts/review-comments.md`. Comments the change adds or edits that restate the code, narrate edit history, or pad a real point. Proposes deletions only; the fixer mends any seam.

Run the bespoke lenses on **opus**, except suppressions and comments on **sonnet** (a mechanical scan, and a focused style pass). A pinned adversary model overrides all of them; `code-review` and any project review gate manage their own.

### The loop (up to 3 rounds)

1. **Review.** Start the round with `state.mjs record-round --run <id> review`; the new count is this round's **N**. Spawn the bespoke lenses as parallel subagents in one message, and invoke the inline gates in the main conversation (see above): `code-review` every round, and the project review gate if the repo ships one. Their own fan-out overlaps with the spawned lenses. **Every round is a cold review**, rounds 2 and 3 included. Point each lens at the whole diff again, and add the round-(N-1) fixes as further ground to cover: verify they hold, and catch any regression they introduced. A round that *only* verifies the last round's fixes can never find what the panel missed the first time, and one cold pass is not enough: findings well within the panel's reach routinely surface in a later independent review of the same code. Always pass the `.speccy/<run-id>/deferred.md` list as accepted decisions it must not re-raise.

   Run all lenses every round by default. You may drop a lens only when the fix round provably didn't touch its surface (e.g. skip local-doc adherence when nothing under a governing doc changed). A lens finding nothing last round is **not** grounds to drop it: yield describes the round that ran rather than the code as it now stands, and the lenses whose clean result is the expected one (suppressions above all) are exactly the ones a fix round is most likely to break. Note any lens you drop and why.

   For the spawned lenses, don't branch on a returned summary (see **Subagent results: trust files over returns**); confirm the file exists instead. **Self-heal a stalled lens:** if a spawned lens's file is missing after it reports complete, `SendMessage` that agent to write its findings file as its final action, marking anything unconfirmed `PLAUSIBLE`, rather than re-spawning it from scratch. Once every lens file is present (the spawned lens files plus the inline-gate files you wrote: code-review, and the project gate if you ran one), read them (N from state.json) and move to triage.
2. **Triage & merge.** Consolidate the findings across lenses yourself: drop false positives, de-duplicate overlaps, and resolve contradictory suggestions. Don't spawn a separate agent for this. Every lens emits the shared finding shape, so merge on `file:line`: two lenses landing on the same anchor is a **convergence signal**, and independent lenses pointing at one spot raise confidence rather than being noise, so weight those up instead of collapsing them to a lone finding. As a backstop for anything the lenses re-raised despite being told not to, drop findings already in `.speccy/<run-id>/deferred.md`; a deferred finding must not churn back into the fix set. Then give each surviving finding a disposition:
   - **Fix**: route it to the fixer this round. Where the finding is a copied smell, tell the fixer whether to diverge (fix cleanly here) or fix wider (also fix the existing instance); a wider fix grows the diff, so choose it deliberately.
   - **Defer**: legitimate but out of scope for this PR, meaning one of three things: it isn't this slice's code, it needs a decision only the user can make, or it is genuinely larger than the slice. Append it to `.speccy/<run-id>/deferred.md` under `## Deferred by scope`: what, and why deferred.

   **Diff size is not a reason to defer.** A real finding with a cheap fix is dispositioned Fix however many others share its shape. The review attention a small diff protects was already spent on finding them, so deferring saves nothing and ships a defect you have already written down; the fix costs a subagent's context rather than yours. (Observed alongside this: where an independent review followed, it rediscovered the deferred batch and fixed it on the same branch, so the diff arrived at its full size having been reviewed twice.) A fix that genuinely is wide is the deliberate fix-wider call above rather than a deferral.

   A suppression finding is effectively never Defer: remove it or make it watertight, this round. **Exit the loop when nothing is dispositioned Fix.**

   You make these disposition calls yourself as the loop runs; the review is autonomous. But surface them to the human at wrap-up so they still review the judgment: deferrals in the deferred list, and any divergence-from-pattern or wider-than-the-diff fix in the summary and decision log.
3. **Fix.** If nothing is dispositioned Fix, skip to the next round's review (or exit). Otherwise read `prompts/implementation-fix.md` and spawn a fix subagent with that prompt, the Fix findings (point it at the lens files, and state any diverge / fix-wider instruction), the spec path, the plan path, and **`baseBranch` from state.json**. It makes the changes and commits.

   **The fixer runs on sonnet.** A triaged finding names the defect and its location, so applying it is execution against a written instruction, which sonnet does faster and no worse. `builderModel` does not govern this: a build raised to opus for its novelty says nothing about the difficulty of applying a finding, and inheriting it would put every fix round on the slower tier for the rest of the run.

   Raise a batch to opus on evidence rather than on how serious its findings look. Two cases qualify: a later round found the previous fix broken or regressive in this same area, so sonnet has already been tried and failed here; or the finding establishes that the current shape is wrong without stating the right one, leaving the design call to the fixer. Name the batch you raised and why in the round's report: with the choice free each round, an unexplained opus batch is where this drifts back to "opus for anything that looks hard".

   **Split a large fix set across a series of agents.** One agent carrying thirty findings across twenty files degrades as it goes: the last findings get the thinnest attention, and a fixer running short of room compensates by taking the cheap ones and reporting done. Group the findings into coherent batches (by area or layer reads better than by count) and spawn a fresh agent per batch, each with the same prompt and its own findings. Run them **strictly one after another, never in parallel**: they share a working tree and an index, so concurrent fixers race on the same files. Each commits its findings, a commit per fix, before the next starts.

   **Blockers go first, in their own batch**, committed and gated before any other batch is spawned. **No batch is the remainder**: a leftover finding gets its own agent rather than being appended to the last batch, even if it is the only finding in it.

   **Confirm each batch committed before spawning the next**, from `git log` and `git status` rather than the agent's report. A commit per fix means a batch can land some of its findings and leave the rest in the tree, so read both: uncommitted work is still work, so review that diff and commit it; nothing committed and a clean tree means the batch built nothing, which is a hand-back.

   **A fix agent that hands back is a signal about the handout.** A batch too large to hold is the usual reason it gets there, so re-split the remaining findings smaller and spawn a fresh agent, rather than returning the same batch to a context already full of the dead end. Anything still unfixed when the round ends surfaces again in the next cold round.

   After the last fix agent commits, re-run the load-bearing gates yourself and confirm the actual output before the next round; never advance on a fix agent's claim that the gates pass. (Gates passing doesn't prove coverage held; a dropped test still passes.) A fixer runs only the checks covering what it touched, so this is what covers the round's work as a whole, and it is where an unverified hand-back gets its verdict. Between batches nothing is gated but the blockers, which is the accepted cost of not paying for a full suite per batch: a breakage a batch's own checks miss surfaces here, with the round's other commits already on top of it.

After 3 rounds, proceed regardless. (Step 1's `record-round` keeps `reviewRounds` current.)

**Leaving the phase.** `state.mjs advance --run <id> wrap-up` enforces the mechanical exit (a review round ran) and refuses to jump straight to `complete`. One thing it can't check, so do it first:

- every finding still dispositioned Fix when the cap hit goes in `.speccy/<run-id>/deferred.md` under `## Unaddressed at the round cap`, with the reason. These are not deferrals (the panel judged them in scope and the rounds ran out), so the heading is what lets the wrap-up report them as unfixed rather than as future work.

Any `deferred.md` items surface at wrap-up.

## Wrap-up

A completed run is a handoff. speccy has built and self-reviewed the work; the verdict is the user's, reached through the diff, the artefacts below, CI, E2E, or running it themselves. speccy stops at a reviewable PR: it does not merge, certify, or run end-to-end verification. Report what was built and leave the review to the user. When pointing them at the diff, suggest they read it as if a contributor they do not fully trust wrote it: the same standard they would apply to any other author's code (see **Steering away from cognitive surrender**).

When all phases complete, report concisely, both in the chat and in `.speccy/<run-id>/summary.md`, so the handoff survives a context clear and sits alongside the run's other artefacts. Cover:

1. **Summary**: what was built, how many critique/review rounds ran, what changed, and that the branch is ready for review.
2. **Decision log, co-authored**: `specs/<slug>-decision-log.md` has been accumulating since 1c, so this step completes it rather than writing it from scratch. Distil the key decisions from the spec and plan into it (including any review-phase divergence from an existing pattern), then check the critique and review rounds for a reversal the run made but never logged, and anything the readability pass flagged as possibly load-bearing (`readability-*.md`). Those files are the backstop; a reversal that reached the log when it happened needs no rewriting here. These are usually implementation-specific choices rather than the durable architecture decisions an ADR captures for the wider team. Each entry records what was proposed, what was decided, why, and its **origin**: **User**, **speccy, user-agreed**, or **speccy, alone** (carried from the artifacts: the spec's Decisions & rationale is tagged, plan decisions are tagged at 2b, and a review-phase disposition is *speccy, alone* unless the user raised the concern, in which case it's *User*). Before writing the log, probe only the one or two decisions that warrant it, each the way its origin calls for (see **Steering away from cognitive surrender**). For a **speccy, user-agreed** decision, ask what convinced them and whether they verified it or trusted the agent's confidence; borrowed confidence is the surrender signal worth catching while the code is fresh and they are about to own it. For a **User** decision, log the rationale as given when it's clear or the call is plainly right, but challenge one resting on a hunch they can't show is correct. A **speccy, alone** decision isn't a borrowed-confidence target (the user never agreed to it); surface a **load-bearing** one as speccy's own call in the spec or plan and invite them to own or challenge it (re-tagging it *speccy, user-agreed* or *User* by what they do), but leave the small and trivially-correct ones logged as speccy's without a question. Don't manufacture a probe where nothing warrants one. Commit the decision log.
3. **Feedback not acted on**: read both files and report the three kinds separately, since they ask different things of the user:
   - **Deferred by scope** (`.speccy/<run-id>/deferred.md`): review findings out of scope for this PR, with the why. Candidates for follow-up issues.
   - **Skipped at spec critique** (`.speccy/<run-id>/spec-critique-skipped.md`): findings the user declined, and any the 3-round cap left unaddressed. Also follow-up candidates.
   - **Unaddressed at the round cap** (`deferred.md`, its own section): findings the panel dispositioned Fix and the cap left unfixed. These are known defects in the branch about to merge rather than future work, so put them to the user as a decision: fix them now, or merge knowing they are there.
4. **Retrospective**: if the task execution skill produced one, save it to `.speccy/<run-id>/retrospective.md` and surface the cross-cutting patterns. If it has a `## Repo-doc suggestions (CLAUDE.md / ADR)` section, present those for the user to accept or decline; never auto-apply them.
**Complete the run.** `state.mjs advance --run <id> complete` enforces that `.speccy/<run-id>/summary.md` is written and `specs/<slug>-decision-log.md` is committed, and refuses until they hold. Two more are yours to confirm before you call it:

- all three kinds of unaddressed feedback are reported: deferred by scope, skipped at spec critique, and unaddressed at the round cap
- the retrospective is saved, if the task execution skill produced one

Advance to `complete` any earlier and a `/clear` during the wrap-up resumes as a finished run, silently dropping the decision log and the retrospective: the artifacts the handoff exists to produce.

**Last, after the run is `complete`: what the run cost.** Run the metrics script from this skill's own directory by its **absolute path**, the same way the banner runs (no `cd`, no command substitution, or the pre-approved permission match breaks).

```bash
bash <skill-dir>/metrics.sh
```

It reads the harness transcripts and writes `.speccy/<run-id>/metrics.md`: wall and active time per phase, tokens by model and reasoning effort, and a per-agent table. Report the headline in chat, a line or two at most (where the wall time went, which phase carried the tokens, anything the script flagged), and point the user at the file.

Everything you need to say that is already in the output: the phases, the run total, and the **Notes**. Summarise from what it printed and **don't open `metrics.md`** — the per-agent table is most of the file, nothing asks you to summarise it, and reading it back spends the context this step is written to protect.

Pass on what the Notes say. They flag phases the reader could not tell apart, work it excluded as belonging to something else, and any agent whose model override did not take effect. Those change how much the numbers are worth.

This step is deliberately outside the exit checks and runs after `complete`, not before it. The measurement is a nice-to-have and must never stand between the user and a finished run: nothing here can fail in a way that leaves the run looking unfinished. It also reads a truer timeline, because `complete` is what closes the last phase. The cost is that a `/clear` in the gap loses the report; `bash <skill-dir>/metrics.sh <run-id>` recovers it later from whatever the transcripts still hold.

The script never blocks: no `node` on `PATH`, no transcripts, or a pruned run all print one line and exit. If it skips, say so in a clause and move on. Measurement happens after the run rather than during it because nothing in a live session tells the orchestrator its own token usage; a figure written mid-run would be invented.

If the pipeline exited early (implementation failure), report what's done and what remains. The user has a branch with partial progress.
