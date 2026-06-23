---
name: speccy
description: Guided specification writing, adversarial spec critique, and post-build review. Full pipeline from rough idea to reviewed implementation.
when_to_use: When the user says "speccy", "spec mode", "adversarial mode", or similar. Also when about to execute a complex multi-step plan and adversarial critique would help.
allowed-tools: Bash(bash *skills/speccy/banner.sh), Read(.speccy/**), Write(.speccy/**), Edit(.speccy/**)
---

# Speccy

Full pipeline: specification → spec critique → planning → plan critique → implementation → implementation review.

The orchestrator runs in the main conversation. Heavy work — adversarial critiques, codebase research for planning, applying critique revisions, implementation, and code review — is delegated to subagents so the main context stays small. Persistent state lives in files; the run can be paused at any phase boundary, `/clear`ed, and resumed.

## Getting started

When the skill triggers, **print the Speccy banner first**, on every invocation. Run `banner.sh` from this skill's own directory (alongside this SKILL.md), using its **absolute path** so it resolves no matter what the Bash tool's current directory is — the working directory persists across calls and may have drifted, and a plugin install lives outside the project tree entirely. Don't prepend `cd` and don't use command substitution; both break the pre-approved permission match.

```bash
bash <skill-dir>/banner.sh
```

The banner is cosmetic. If it fails or would prompt, just proceed without it — never block the run on it.

Then check for an in-progress run (see **Resuming a run** below). If one exists, offer to resume before starting fresh.

For a new run, give a one-sentence introduction: this skill walks through writing a spec, getting it independently critiqued, building the implementation, and reviewing the result. Then ask two things in one turn:

1. **Walkthrough or start?** Tell the user they can ask for a walkthrough of the process, or just describe what they want to build to get going. If they ask for the walkthrough, explain each phase in a few sentences, organised around what the user does vs what runs autonomously:
   - **Spec** (interactive) — the skill interviews the user to build a structured spec, then the user reviews and edits until satisfied.
   - **Spec critique** (user-in-the-loop) — an independent reviewer critiques the spec each round. The user decides what feedback to incorporate.
   - **Plan** (autonomous loop) — a subagent researches the codebase and drafts a plan; an independent reviewer critiques and a revise agent applies findings until the plan is clean.
   - **Plan review** (user decides) — the user reviews the hardened plan, raises concerns, approves.
   - **Implementation** (autonomous loop) — the skill builds to the plan; an independent reviewer checks the code against the spec and fixes issues directly.
   - **Wrap-up** — summary, ADR, retrospective. The user reviews the final diff on the branch.

   Also mention: state is saved after every phase boundary, so the user can `/clear` and re-invoke the skill at any point to resume with a fresh context. Useful for long runs where the main conversation has grown.

2. **Model defaults.** Note the per-phase defaults (just below) and that they're overridable — no need to ask, just flag that the options exist.

Models are per-phase, defaulting to a `"ladder"` scheme:

- **Spec and plan critique** — opus every round (both the adversary and the revise agent), up to 3 rounds. These artifacts are short and high-leverage; on knowledge-heavy domains the durable findings cluster in the opus passes, so the whole loop runs on opus rather than escalating cheaper tiers that mostly add triage churn.
- **Implementation review** — escalating `haiku → sonnet → opus → opus`, up to 4 rounds. The diff is large and many findings mechanical, so cheap-first pays off; the doubled opus is a fresh-context final pass over the prior round's fixes.

The **builder** (execute/integrate/verify inside plan-execution) defaults to sonnet; plan-execution's breakdown agent always uses opus. The user may pin a single adversary model — then use it for every round of every loop — or raise the builder to opus for high-stakes work.

Each loop restarts at round 1 and early-exits when a round surfaces no valuable criticism.

If the user's trigger message already includes a description of what to build, skip straight to the adversary model note and proceed to the precondition check and Phase 1.

## Resuming a run

Run state lives at `.speccy/<run-id>/state.json` and is written after every phase boundary. Schema:

```json
{
  "runId": "auth-refactor-20260609-1430",
  "slug": "auth-refactor",
  "baseBranch": "develop",
  "adversaryModel": "ladder",
  "builderModel": "sonnet",
  "phase": "planning" | "spec-critique" | "plan-critique" | "implementation" | "review" | "complete",
  "specPath": "specs/auth-refactor.md",
  "planPath": ".speccy/auth-refactor-20260609-1430/plan.md",
  "specCritiqueRounds": 1,
  "planCritiqueRounds": 0,
  "reviewRounds": 0
}
```

`adversaryModel` is `"ladder"` by default — the per-phase scheme described under **Getting started** (spec/plan critique: opus every round, up to 3; implementation review: `haiku → sonnet → opus → opus`, up to 4). If the user pinned a single adversary model, store that model name here instead and use it for every critique round.

On trigger, read `.speccy/.current-runid` — a pointer to the most recent run, written when the run is created (see Phase 1c). If it exists, read that run's `state.json`; if `phase` is not `"complete"`, surface the run to the user and ask whether to resume or start fresh. To resume, read the artifacts state.json references (spec, plan, latest critique round) and continue from the recorded phase. A resumed run skips the precondition checks, so if the recorded phase is anything past the spec interview, suggest auto-accept mode (shift+tab) first — the rest of the run is autonomous tool calls.

After completing each phase, update state.json and continue to the next phase. The user can `/clear` and re-invoke the skill at any point to resume from the recorded phase — no need to ask permission at phase boundaries.

Read and write `.speccy/` state with the Read/Write tools — these paths are pre-approved in this skill's `allowed-tools`, so they won't prompt. Do **not** rely on the Glob tool: it isn't available in every session. Run discovery uses the `.current-runid` pointer above precisely so resume needs only Read, never an enumeration. The pointer tracks the latest run; earlier runs remain in `.speccy/` if the user wants to revisit one.

## Preconditions

Before running any of the checks below, suggest the user enable auto-accept mode (shift+tab). From here to the end of the run the work is mostly tool calls — the verification smoke-test runs the project's linters and tests, then planning, critique, implementation, and review run autonomous loops — so approving each one by hand is pure friction. The spec interview is a conversation regardless, so auto-accept doesn't take any decisions away: the user still reviews and edits the spec content directly.

### Verification tools

Check that CLAUDE.md documents the project's verification tools (build, lint, static analysis, test commands). These are needed during implementation — execute agents run them to validate their work. If they're missing, tell the user before proceeding. Establishing verification standards is part of project setup, not something to discover mid-build.

Documented is not the same as working. **Smoke-test the tooling now, on the clean tree, before investing in spec and plan** — a broken or pathological verification setup discovered at implementation has already cost a spec, several critique rounds, and a plan. Run each documented command once and confirm it completes, passes (or note its baseline failures), and returns in a reasonable time. Surface anything that hangs, errors, or floods output before proceeding.

### Worktree init

Worktrees come into play only for **parallel** tasks. Plan-execution runs sequential tasks directly on the main checkout; only parallel tasks get git worktrees, which lack gitignored state. You won't know whether the plan produces parallel tasks until breakdown, so treat this as preparation that may not be exercised this run. Check whether CLAUDE.md has a `## Worktree init` section with gather/apply blocks. If it does, nothing to do — plan-execution will use it if parallel tasks arise. If it's missing:

1. Note that worktree agents (parallel tasks only) will lack gitignored files (node_modules, tool configs, generated artifacts).
2. Offer to help draft the section — look at `.gitignore` and the verification commands for clues about what needs recreating.
3. The format is gather (commands run in the main checkout, capturing stdout as named variables) and apply (commands run in the worktree, substituting gathered values). See existing CLAUDE.md examples.
4. Have the user review and commit the section before proceeding.

A purely sequential plan never touches worktrees, so a project that only runs sequential work can skip this — but it's cheap insurance for any run that fans out.

### Git state

Before starting work:

1. Run `git status --porcelain` — if the working tree is dirty, tell the user and stop.
2. Run `git branch --show-current` — note the current branch. This is the **base branch** for the rest of the pipeline.
3. If not on the main branch, confirm with the user that the current branch is the intended base. Proceed on whatever they confirm.

## Formatting

Use bullet lists and unnumbered headings by default. Reserve numbered lists for sequences where order is the point — steps that must execute in a specific order, or items that will be referenced by position. If inserting or removing an item forces renumbering, it shouldn't have been numbered.

This applies to all generated artifacts: specs, plans, critiques, and review notes.

## Subagent results: trust files, not returns

Subagents run in the background, and their completion notifications are unreliable: the returned summary can arrive **misrouted** under a different agent's completion, and the notification's apparent identity (which agent, which round) can be wrong — a round-3 critique may surface labelled as the round-2 revise agent. This is expected harness noise.

So for every spawned agent: you know what it was spawned to do and the exact file it writes, and the round number comes from state.json, not the notification. When a completion arrives, read that file and act only on its contents — never branch control flow (early-exit, round counting, commit messages, what you tell the user) on a returned summary or a notification's label. Don't narrate or diagnose misrouting; read the right file and carry on.

## Phase 1 — Specification

Build a structured spec through interview.

### 1a. Intake

The user may or may not have provided a starting description alongside the trigger.

**If they provided something** — a sentence, a feature request, an existing spec file — use that as the seed. If they point to a file in the repo, that's the starting draft.

**If they provided nothing** (e.g. just "spec mode") — ask what they want to build. Suggest the kind of information that's useful at this stage: what problem they're solving, who it's for, any constraints they already know about, and how they'll know it's done. Don't require all of this upfront — just enough to start the interview.

### 1b. Interview

Ask clarifying questions to fill gaps:

- Scope boundaries — what's in, what's out
- Edge cases and error scenarios
- Constraints (performance, security, compatibility)
- Integration points with existing code
- Non-functional requirements

Research the codebase where it helps clarify requirements ("there's an existing X — should we use it?"). Questions that need deeper codebase research to answer: mark as open and defer to planning.

Identify external context that would improve the spec or plan — documentation, other projects with relevant patterns, standards, API references. Ask the user about anything you can't access directly. This is worth doing early: missing context discovered mid-build is expensive. Record the references that matter in the spec itself (under Open questions, or a short references note) so they survive the context clear before planning — anything left only in conversation is lost when the user `/clear`s.

Keep the interview focused. Don't ask questions the codebase can answer — save those for planning.

### 1c. Structured spec

Produce a first-draft spec from the interview answers using the template in `prompts/spec-template.md` (relative to this SKILL.md's directory). Fill in every section; remove the HTML comments.

**Do not restate CLAUDE.md.** Reference it by file/section when a constraint matters; only spell out a rule if this feature diverges from it.

The **Assumptions** section is important — it captures the reasonable defaults chosen where the user's description was ambiguous. Unstated assumptions can't be challenged during critique, so surface them here.

Let the user review and edit until satisfied.

Create a feature branch before committing anything:

```
git checkout -b speccy/<slug>
```

Save to `specs/<slug>.md`. Commit the spec.

Generate a `runId`: lowercase kebab from the slug plus a `YYYYMMDD-HHmm` timestamp (e.g. `auth-refactor-20260609-1430`). Create `.speccy/<run-id>/` and ensure `.speccy/` is in `.gitignore`. Write the initial `state.json` (phase: `spec-critique`, with runId, slug, baseBranch, adversaryModel, builderModel, specPath). Also write the runId to `.speccy/.current-runid` (plain text, no newline needed) so a later session can find this run without globbing.

Tell the user about the directory — critique rounds, the plan, review notes, and run state will be saved there so they can open them in their editor rather than scrolling terminal output. Mention the path once here; don't repeat it at every save.

### 1d. Adversarial spec critique

Before investing in planning, the spec gets an independent review. Read `prompts/spec-critique.md` (relative to this SKILL.md's directory).

Run the loop to exhaustion before offering to clear or move on. The user is in the loop on which findings to incorporate each round, but a single revised round is not a stopping point — keep critiquing until a round surfaces no valuable criticism, or 3 rounds run. Don't offer the clear or planning as a mid-loop alternative to the next round.

For each round (up to 3):

1. **Critique.** Spawn an adversary subagent (Agent tool) with the spec critique prompt and the path to the spec. Instruct it to **write its review to `.speccy/<run-id>/spec-critique-round-N.md`**. Use **opus** for the model override on every round (or the user's pinned model, if they set one).
2. **Present.** Read `.speccy/<run-id>/spec-critique-round-N.md` (N from state.json) and present its findings to the user. Point the user to the file for the full text. Ask which findings to incorporate. If the round surfaced no valuable criticism, the loop is done — exit it.
3. **Revise.** Spawn a revise subagent (Agent tool) **on opus** with `prompts/revise.md`, the spec path, the critique file path, and the list of accepted findings. The subagent rewrites the spec in place. Once it completes, commit the updated spec with a message summarising the accepted findings you incorporated — you already have that list, so build the message from it rather than from the agent's return. Then run the next round to check the revisions and probe deeper.

After 3 rounds, proceed regardless, noting any unaddressed feedback. Update state.json after each round (`specCritiqueRounds`). When the critique loop exits, set `phase: "planning"`.

Only once the loop has fully exited, reach the primary context-clearing point. The spec interview and critique are the heaviest interactive context in the run, and the approved spec now captures every decision in a committed file — so the window can reset before planning, which is largely subagent-driven. Verify all run state is in files (state.json current, spec committed, external references recorded in the spec — not left only in conversation), then suggest the user `/clear` and re-invoke to resume at planning. If they'd rather continue, proceed to Phase 2.

## Phase 2 — Planning

Before diving in, briefly orient the user on why planning is a separate step: the spec says _what_ to build, the plan says _how_. Planning is where we research the codebase, discover what already exists, make architecture decisions, and work out the order of operations. Without it, the spec's open questions carry into implementation and cause mid-build surprises.

Planning research happens in a subagent to keep the codebase-reading noise out of the main context. Read `prompts/plan-research.md`.

Spawn a planning subagent (Agent tool) with the plan-research prompt, the spec path, and the target plan path (`.speccy/<run-id>/plan.md`). If the spec recorded external context (docs, standards, related projects), pass those references too — read them from the spec rather than relying on conversation memory, since planning may run in a freshly cleared context.

When it completes, brief the user on the approach, key decisions, and risks from `.speccy/<run-id>/plan.md` — point them there for the full text rather than dumping it inline. Update state.json with `planPath` and `phase: "plan-critique"`.

### 2a. Adversarial plan critique

The spec has already been hardened. Now the plan gets an independent review. This loop runs autonomously — the user reviews the final hardened plan in 2b. Read `prompts/plan-critique.md` (relative to this SKILL.md's directory).

For each round (up to 3):

1. **Critique.** Spawn an adversary subagent with the plan critique prompt, the path to the plan, and the path to the spec (for context — the spec itself should not be re-reviewed). Instruct it to **write its review to `.speccy/<run-id>/plan-critique-round-N.md`**. Use **opus** for the model override on every round (or the user's pinned model, if they set one). Read the critique file (N from state.json) to triage. If no legitimate flaws found, exit the loop.
2. **Revise.** Spawn a revise subagent **on opus** with `prompts/revise.md`, the plan path, the critique file path, and instructions to incorporate every finding in the critique. When it completes, the revised plan file is the truth — don't depend on its return.

After 3 rounds, exit the loop regardless. Update state.json after each round (`planCritiqueRounds`). When the loop exits, surface a one-line note of how many rounds ran and what changed, then proceed to 2b.

### 2b. User review

Present the hardened plan to the user for free-form review. The adversary has already cleaned up obvious issues — this is the user's chance to raise concerns the adversary didn't catch, adjust the approach based on their own knowledge, or approve as-is. Have them read the plan file directly rather than re-dumping it into the conversation.

Iterate until the user is satisfied. When approved, set `phase: "implementation"` in state.json.

Before starting implementation, verify all run state is in files: state.json current, spec and plan committed, review decisions reflected in the plan. The main clear already happened after the spec, so this is conditional: if plan critique and review accumulated heavy context, suggest the user `/clear` and re-invoke to resume at implementation; if planning stayed lean, just proceed.

## Phase 3 — Implementation

Invoke the `plan-execution` skill directly via the Skill tool from the main conversation, passing the plan path as `args.planPath` (not the full plan text — the workflow reads the file itself, which keeps the orchestration call small and the plan editable mid-run) and the builder model as `args.model` (from state.json's `builderModel`, default sonnet). The breakdown agent inside plan-execution always uses Opus regardless; only execute/integrate/verify pick up the override.

Do _not_ wrap this in an Agent subagent. Plan-execution drives a `Workflow` tool, which already isolates the orchestration — breakdown, execute, integrate, and verify all run backgrounded, and only the final result returns. Wrapping it in an Agent adds no isolation and breaks the call (Agent subagents lack `Workflow`).

When the workflow reports complete, do not advance on its "gates pass" / "0 violations" summary — a build agent can satisfy a gate by fabricating or inverting a rule and still report green. Re-run the project's load-bearing gates yourself (the build, lint / static-analysis, and test commands from CLAUDE.md) and confirm the actual tool output. If a gate fails, the run isn't done: carry the real tool output into a fix round (the Phase 4 implementation-fix agent handles exactly this), re-run the gates after it, and repeat until you have seen them pass. Only then set `phase: "review"` in state.json and continue.

If the implementation workflow exits incomplete, stop the pipeline. Report what's done and what remains — the user has a branch with partial progress. State.json remains at `phase: "implementation"` so the run can be resumed later.

## Phase 4 — Implementation review

After implementation is complete, the code gets an adversarial review. Read `prompts/implementation-review.md` (relative to this SKILL.md's directory).

The implementation review focuses on quality, design, and spec fidelity — the task execution skill has already verified completeness. The human is _on_ the loop (observing), not _in_ it — design decisions were settled in earlier phases, so implementation fixes are mechanical.

For each round (up to 4):

1. **Review.** Spawn an adversary subagent with the implementation review prompt, the spec path, and instructions to run `git diff <base-branch>...HEAD` for the full implementation diff. Instruct it to read key files for deeper understanding and write its review to `.speccy/<run-id>/review-round-N.md`. Use the implementation-review ladder for the model override: round 1 → haiku, round 2 → sonnet, round 3 → opus, round 4 → opus (or the user's pinned model, if they set one).
2. **Fix.** Read `.speccy/<run-id>/review-round-N.md` (N from state.json) to triage. If no legitimate flaws found, the review is done. Otherwise, read `prompts/implementation-fix.md` and spawn a subagent with that prompt, the review file path, the spec path, and the plan path. The subagent makes the code changes and commits. After it commits, re-run the load-bearing gates yourself and confirm the actual output before starting the next round — never advance on the fix agent's claim that the gates pass.

After 4 rounds, proceed regardless. Update state.json after each round (`reviewRounds`) and set `phase: "complete"` when done.

## Wrap-up

A completed run is a handoff. Speccy has built and self-reviewed the work; the verdict is the user's, reached through the diff, the artefacts below, CI, E2E, or running it themselves. Speccy stops at a reviewable PR — it does not merge, certify, or run end-to-end verification (see DECISION_LOG, "E2E and final verification are out of scope"). Report what was built and leave the review to the user.

When all phases complete, report concisely:

1. **Summary** — what was built, how many critique/review rounds ran, what changed, and that the branch is ready for review.
2. **ADR** — distil key decisions from the critique rounds into `specs/<slug>-adrs.md`. Each entry: what was proposed, what was decided, why. Commit the ADR.
3. **Deferred feedback** — any substantial feedback the user chose to skip
4. **Retrospective** — if the task execution skill produced one, save it to `.speccy/<run-id>/retrospective.md` and surface the cross-cutting patterns

If the pipeline exited early (implementation failure), report what's done and what remains. The user has a branch with partial progress.
