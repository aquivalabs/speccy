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

When the skill triggers, **show the Speccy banner first**, on every invocation. Run `banner.sh` from this skill's own directory (alongside this SKILL.md) by its **absolute path** — a relative path breaks when the Bash cwd has drifted or the skill is installed as a plugin. Don't prepend `cd` and don't use command substitution; both break the pre-approved permission match.

```bash
bash <skill-dir>/banner.sh
```

The script prints two Markdown lines. **Reproduce them verbatim at the top of your reply** — that is what the user sees. Running the script alone isn't enough; its tool output is hidden by default.

The banner is cosmetic. If the script fails or would prompt, just proceed without it — never block the run on it.

Then check for an in-progress run (see **Resuming a run** below). If one exists, offer to resume before starting fresh.

For a new run, give a one-sentence introduction: this skill walks through writing a spec, getting it independently critiqued, building the implementation, and reviewing the result. Then ask two things in one turn:

1. **Walkthrough or start?** Tell the user they can ask for a walkthrough of the process, or just describe what they want to build to get going. If they ask for the walkthrough, explain each phase in a few sentences, organised around what the user does vs what runs autonomously:
   - **Spec** (interactive) — the skill interviews the user to build a structured spec, then the user reviews and edits until satisfied.
   - **Spec critique** (user-in-the-loop) — an independent reviewer critiques the spec each round. The user decides what feedback to incorporate.
   - **Plan** (autonomous loop) — a subagent researches the codebase and drafts a plan; an independent reviewer critiques and a revise agent applies findings until the plan is clean.
   - **Plan review** (user decides) — the user reviews the hardened plan, raises concerns, approves.
   - **Implementation** (autonomous loop) — the skill builds to the plan; parallel reviewers check the code across several lenses (correctness and quality via the built-in `code-review` skill, the repo's own review gate when it ships one, plus spec fidelity, tests, codebase fit, local-doc adherence, and strict scrutiny of linter/analysis suppressions); fixes are applied directly, or deferred as future work.
   - **Wrap-up** — summary, decision log, retrospective. The user reviews the final diff on the branch.

   Also mention: state is saved after every phase boundary, so the user can `/clear` and re-invoke the skill at any point to resume with a fresh context. Useful for long runs where the main conversation has grown.

2. **Defaults you can change.** Note the per-phase model defaults (just below) and that they're overridable. No need to ask — just flag that the options exist.

Each phase has its own model default:

- **Spec and plan critique** — opus every round (both the adversary and the revise agent), up to 3 rounds. These are short, high-leverage artifacts where cheaper tiers cost more in false-positive triage than they save.
- **Implementation review** — parallel review lenses, up to 3 rounds (see Phase 4). The four judgment lenses (spec fidelity, tests, codebase fit, local-doc adherence) run on opus and the suppressions lens on sonnet; the built-in `code-review` skill runs alongside them at `high` effort and manages its own models.
- **Builder** (execute/integrate/verify inside plan-execution) — sonnet; plan-execution's breakdown agent always uses opus.

Two overrides: pin a single adversary model (`adversaryModel`), then used for every critique round and review lens; and raise the builder (`builderModel`), commonly to opus for high-stakes work.

Each loop restarts at round 1 and early-exits when a round surfaces no valuable criticism.

If the user's trigger message already includes a description of what to build, skip straight to the adversary model note and proceed to the precondition check and Phase 1.

## Resuming a run

Run state lives at `.speccy/<run-id>/state.json` and is written after every phase boundary. Schema:

```json
{
  "runId": "auth-refactor-20260609-1430",
  "slug": "auth-refactor",
  "baseBranch": "develop",
  "adversaryModel": "opus",
  "builderModel": "sonnet",
  "phase": "planning" | "spec-critique" | "plan-critique" | "implementation" | "review" | "complete",
  "specPath": "specs/auth-refactor.md",
  "planPath": ".speccy/auth-refactor-20260609-1430/plan.md",
  "specCritiqueRounds": 1,
  "planCritiqueRounds": 0,
  "reviewRounds": 0,
  "engagementQuestions": [
    { "gate": "spec-critique", "asked": "the finding you'd bet the reviewer raises" }
  ]
}
```

`adversaryModel` defaults to `"opus"` — the tier for every critique round and the review panel's judgment lenses (the suppressions and comment lenses run a tier below; see **Getting started**). If the user pinned a different adversary model, store that name here instead and use it for every critique round and review lens.

On trigger, read `.speccy/.current-runid` — a pointer to the most recent run, written when the run is created (see Phase 1c). If it exists, read that run's `state.json`; if `phase` is not `"complete"`, surface the run to the user and ask whether to resume or start fresh. To resume, read the artifacts state.json references (spec, plan, latest critique round) and continue from the recorded phase. A resumed run skips the precondition checks, so if the recorded phase is anything past the spec interview, suggest auto-accept mode (shift+tab) first — the rest of the run is autonomous tool calls.

After completing each phase, update state.json and continue to the next phase. The user can `/clear` and re-invoke the skill at any point to resume from the recorded phase — no need to ask permission at phase boundaries.

Read and write `.speccy/` state with the Read/Write tools — these paths are pre-approved in this skill's `allowed-tools`, so they won't prompt. Do **not** rely on the Glob tool: it isn't available in every session, which is why run discovery uses the `.current-runid` pointer. The pointer tracks the latest run; earlier runs remain in `.speccy/` if the user wants to revisit one.

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

## Propagate the session's voice to subagents

The main session may be governed by a behavioural or output style a fresh agent context does **not** inherit — a house-voice hook (e.g. one injected at session start), a configured output style, or communication conventions that live beyond the project's `CLAUDE.md`. A subagent starts clean and never sees the main session's system prompt, so unless you carry that style across, every critic, revise agent, planner, review lens, and fixer speaks in a default voice that clashes with how this session talks — and the artifacts they write (critiques, plan, review notes) read in a different register from the rest of the run.

So **before spawning any subagent, restate the active style concisely at the top of its prompt** — enough that both its reasoning and its written output match the session's voice. Two things are out of reach and don't need carrying: conventions already in `CLAUDE.md` (subagents read it anyway), and the built-in `code-review` skill run inline (it manages its own prompt — the orchestrator just applies the session's voice when it normalises those findings into the lens file). This rule applies to every spawn site in the phases below; it is stated once here rather than repeated at each. Speccy's own narration back to the user follows the same style as a matter of course.

## Steering away from cognitive surrender

Speccy's own output is the hazard. Adversarially-hardened specs and plans read as authoritative, and the more authoritative they read, the stronger the pull for the user to approve without understanding (cognitive surrender: borrowed confidence, surface correctness hiding deeper flaws). The pipeline already hardens its artifacts. These habits guard the user's engagement, which nothing else does.

Apply these habits at the run's three human gates and nowhere else: the spec critique (1d), the plan review (2b), and the wrap-up decision log (Phase 5). The other interactive moments are not gates — the intake and interview gather requirements, the first-draft review (1c) is the user's turn to read and edit, and the build kickoff (Phase 3) is a handoff — so pose no pre-question there. The pre-question in particular assumes the user has read the artifact and is about to see it critiqued; asked before a draft is read, or after a decision is already made, it has no referent and reads as the ritual this section exists to prevent. The three habits:

- **Ask before you tell, then reveal.** Before showing the agent's findings, have the user commit a *prediction*, not an open judgment: the one thing they'd bet the critique flags, or the part they'd defend least confidently. An open "where is it weakest?" is too easy to shrug off; predicting forces the user to build their own model of the artifact first, which is the anti-anchoring point. If they genuinely have nothing, offer to look together at one thing *you* find risky — but only if a real one exists (many artifacts are straightforward; don't manufacture one), drawn from your own read rather than the critique you are holding, which would leak it early. Then when you present the critique, close the loop against their prediction — "you expected X; it flagged Y — surprised?". The consequence is what makes the question land; without the reveal it decays to a shrug.
- **Flag doubt; stay quiet about certainty.** Surface where the agent is unsure and what it assumed. Never offer high confidence as a reason to skip review, since a confident wrong call adopted wholesale is the worst outcome. Point the user's attention at the doubtful parts and let the settled ones pass.
- **Name what convinced you.** A recorded decision reaches this point one of three ways — its **origin** — and each wants a different touch. **(1) Speccy, user-agreed** — speccy proposed it and the user agreed at a gate: the borrowed-confidence zone, and what this whole habit is built for. Ask what persuaded them, and whether they verified it or simply trusted that the agent sounded sure. **(2) User** — the user made the call themselves: don't run the borrowed-confidence check on it; if the rationale is clear and recorded, or the call is plainly right as far as you can tell, let it stand (re-quizzing someone on reasoning they've already given is the empty ritual this section exists to prevent), but if it rests on a hunch with no clear reason you can see is right, challenge it on its merits — that is speccy doing its job, not skipping it. **(3) Speccy, alone** — speccy decided it autonomously, with no gate for the user to sign off (a plan-critique revision, a review disposition): the user never agreed to it, so the borrowed-confidence check has no referent. Surface only the **load-bearing** ones — a call that shapes the design, or one the user would want to own — as speccy's own now sitting in the spec or plan, and invite them to check they agree and could justify it. Judgement governs hard here: a small or trivially-correct autonomous call speccy can stand behind doesn't need raising, and burying the user in autonomous-call checks trains them to tune speccy out — the disengagement this section fights. Keep the probing to one decision per gate, so it reads as a self-check rather than an interrogation.

**Origin is not fixed — it flips as the user engages.** When speccy surfaces a *Speccy, alone* decision and the user ratifies it, re-tag it *Speccy, user-agreed*; if they override or reshape it, re-tag it *User*. Record the flip in the artifact, so a later gate or the wrap-up doesn't re-surface a call the user has already owned. (Challenging a *User* hunch is different: if the user then gives a clear reason, it stays *User*, now with its rationale recorded.)

Ask these as ordinary questions inside the flow of the gate; never announce that you're doing them and never give them a label to the user (not "engagement check", not "cognitive surrender") — a prompt flagged as a check gets performed, not thought about. A user who would rather not be asked can simply decline, or say so at the start; honour that, and you need not advertise the possibility.

**Vary the questions across gates.** The job repeats at each gate but the wording must not: the same pre-question framing heard three times decays into a ritual the user pattern-matches and shrugs past, which is the ritualization this whole section fights. Before posing a pre-question or a "what convinced you", read `engagementQuestions` from state.json to see what earlier gates already asked, and come at this one from a fresh angle — a different referent, a different way in — rather than reciting the template. After you ask, append a short paraphrase of what you actually posed (`{ gate, asked }`) to `engagementQuestions` and save state.json. The list starts empty and survives a `/clear`, so a resumed context still knows what framings are spent. This is about not repeating yourself, not about hunting for perfect wording — the engagement comes from the loop, and variation only keeps the loop from going stale.

**Each of these questions is a stop.** Ask it as the last thing in the turn and wait — the question is the failure point precisely because the orchestrator tends to ask, then keep thinking and running tool calls until it scrolls off unanswered. Nothing follows the question until the user replies, and a pre-question never reveals the critique in the same turn (which would pre-empt the answer and lose the anti-anchoring). Put it on its own line at the end of the reply.

**The long idle stretches are the other good moment.** The autonomous phases — plan critique (2a), the build (Phase 3), the review panel (Phase 4) — leave the user waiting on a subagent for a long while, and that idle time engages well with a different device from the gate habits: not a pre-question (there's no artifact to predict yet) but an offer to deepen understanding. Offer to walk through how a part of the system works relative to what's being built, or raise an implementation detail the plan left open and ask whether the user has a preference. Only when there's something genuine to say — manufactured filler trains the user to tune speccy out. Two rules keep it from backfiring, and both invert the gate question's "stop":

- **It never blocks.** The job runs regardless, and a completion that lands mid-conversation is surfaced at once — the chat is opportunistic filler, never a reason to sit on a finished job.
- **Any steer feeds forward** — into an upcoming task or the review — never expecting the running build to have already adopted it. A preference that would change approved scope is a re-plan, not a mid-build aside.

Apply the same standard to the final diff: read it as if a contributor you do not fully trust wrote it.
## Phase 1 — Specification

Build a structured spec through interview.

### 1a. Intake

The user may or may not have provided a starting description alongside the trigger.

**If they provided something** — a sentence, a feature request, an existing spec file — use that as the seed. If they point to a file in the repo, that's the starting draft.

**If they provided nothing** (e.g. just "spec mode") — ask what they want to build. Suggest the kind of information that's useful at this stage: what problem they're solving, who it's for, any constraints they already know about, and how they'll know it's done. Don't require all of this upfront — just enough to start the interview.

### 1b. Interview

**Treat the intake as settled.** Take what the user gave you at face value: don't re-ask what it answers, don't ask them to reconfirm a stated choice, and only reopen a settled point if they re-raise it or you have a serious, specific doubt. Prefer recording a reasonable default in the spec's Assumptions section over asking; the critique loop challenges it there.

Ask only about gaps the intake leaves genuinely open and that materially change the spec:

- Scope boundaries — what's in, what's out
- Edge cases and error scenarios
- Constraints (performance, security, compatibility)
- Integration points with existing code
- Non-functional requirements

Identify external context that would improve the spec or plan — documentation, other projects with relevant patterns, standards, API references. Ask the user about anything you can't access directly. This is worth doing early: missing context discovered mid-build is expensive. Record the references that matter in the spec itself (under Open questions, or a short references note) so they survive the context clear before planning — anything left only in conversation is lost when the user `/clear`s.

**Never ask what code or the environment can answer.** If a quick look at the repo, config, or tooling would settle it, look — don't ask. Questions needing deeper codebase research: mark open and defer to planning.

**Asking nothing is fine.** If the intake settles what you need, write the draft and skip the interview. (Clarifying questions only; the habits under **Steering away from cognitive surrender** still apply.)

### 1c. Structured spec

Produce a first-draft spec from the interview answers using the template in `prompts/spec-template.md` (relative to this SKILL.md's directory). Fill in every section; remove the HTML comments.

**Do not restate CLAUDE.md.** Reference it by file/section when a constraint matters; only spell out a rule if this feature diverges from it.

The **Assumptions** section is important — it captures the reasonable defaults chosen where the user's description was ambiguous. Unstated assumptions can't be challenged during critique, so surface them here.

The **Decisions & rationale** section is equally load-bearing — every spec makes choices, and a choice whose reasoning isn't written down reads as an arbitrary default and can't be challenged. For each meaningful decision the spec commits to (a scope call, an approach, a contract or deliverable shape), record what was chosen, the viable alternative(s) weighed, and the deciding factor — *why this and not that*. Draw the reasoning out during the interview, but only where the user hasn't already given it: when a choice has a real alternative and the description doesn't explain the pick, ask why the user leans that way rather than recording it silently. Don't re-ask about a decision the input already settles — a stated preference, mandate, or existing convention is a complete rationale on its own. Tag each decision's **origin** so the wrap-up can probe each the way that fits (see the three origins under **Steering away from cognitive surrender**). In the interview only two arise: **User** (a preference, mandate, or judgement the user brought) or **Speccy, user-agreed** (speccy proposed it, the user agreed). The third, **Speccy, alone** — speccy's own autonomous calls — comes later in the plan and review phases. This is not an assumption (a guess under ambiguity); a decision is a deliberate pick among options. Keep it spec-level — the "why" behind *what* to build, not code-level *how* (that is the plan's decision body). This section is also the up-front source the wrap-up co-authored decision log distils from, so capturing rationale now means the user isn't reconstructing it from memory later.

Let the user read and edit the draft until satisfied. This is their first read, not a gate — pose no engagement question here; the pre-question comes at the 1d critique, once they have the draft in hand.

Create a feature branch before committing anything. Pick a short, descriptive name for the work; if it collides with an existing branch, adjust it. Then `git checkout -b <branch>`.

Save to `specs/<slug>.md`. Commit the spec.

Generate a `runId`: lowercase kebab from the slug plus a `YYYYMMDD-HHmm` timestamp (e.g. `auth-refactor-20260609-1430`). Create `.speccy/<run-id>/` and ensure `.speccy/` is in `.gitignore`. Write the initial `state.json` (phase: `spec-critique`, with runId, slug, baseBranch, adversaryModel, builderModel, specPath). Also write the runId to `.speccy/.current-runid` (plain text, no newline needed) so a later session can find this run without globbing.

Tell the user about the directory — critique rounds, the plan, review notes, and run state will be saved there so they can open them in their editor rather than scrolling terminal output. Mention the path once here; don't repeat it at every save.

### 1d. Adversarial spec critique

Before investing in planning, the spec gets an independent review. Read `prompts/spec-critique.md` (relative to this SKILL.md's directory).

Run the loop to exhaustion before offering to clear or move on. The user is in the loop on which findings to incorporate each round, but a single revised round is not a stopping point — keep critiquing until a round surfaces no valuable criticism, or 3 rounds run. Don't offer the clear or planning as a mid-loop alternative to the next round.

For each round (up to 3):

1. **Critique.** Spawn an adversary subagent (Agent tool) with the spec critique prompt and the path to the spec. Instruct it to **write its review to `.speccy/<run-id>/spec-critique-round-N.md`**. Use **opus** for the model override on every round (or the user's pinned model, if they set one).
2. **Present.** Before showing the critique, ask the user to predict it — the finding they'd bet the reviewer raises, or the part of the spec they'd defend least confidently (see **Steering away from cognitive surrender**). If they have none and you can see a genuine soft spot, offer to look at it together; if the spec is solid, let it go. Then read `.speccy/<run-id>/spec-critique-round-N.md` (N from state.json), present its findings, and close the loop against their prediction ("you expected X; it flagged Y — surprised?"). Point the user to the file for the full text. Ask which findings to incorporate, and on the most consequential finding they choose to adopt, ask what convinced them — adopting the adversary's call is where borrowed confidence lives; a finding they reject on their own judgement is their call, so leave it. If the round surfaced no valuable criticism, the loop is done — exit it.
3. **Revise.** Spawn a revise subagent (Agent tool) **on opus** with `prompts/revise.md`, the spec path, the critique file path, and the list of accepted findings. The subagent rewrites the spec in place. Once it completes, commit the updated spec with a message summarising the accepted findings you incorporated — you already have that list, so build the message from it rather than from the agent's return. Then run the next round to check the revisions and probe deeper.

After 3 rounds, proceed regardless, noting any unaddressed feedback. Update state.json after each round (`specCritiqueRounds`). When the critique loop exits, set `phase: "planning"`.

Only once the loop has fully exited, reach the primary context-clearing point. The spec interview and critique are the heaviest interactive context in the run, and the approved spec now captures every decision in a committed file — so the window can reset before planning, which is largely subagent-driven. Verify all run state is in files (state.json current, spec committed, external references recorded in the spec — not left only in conversation), then suggest the user `/clear` and re-invoke to resume at planning. If they'd rather continue, proceed to Phase 2.

## Phase 2 — Planning

Before diving in, briefly orient the user on why planning is a separate step: the spec says _what_ to build, the plan says _how_. Planning is where we research the codebase, discover what already exists, make architecture decisions, and work out the order of operations. Without it, the spec's open questions carry into implementation and cause mid-build surprises.

Planning research happens in a subagent to keep the codebase-reading noise out of the main context. Read `prompts/plan-research.md`.

Spawn a planning subagent (Agent tool) with the plan-research prompt, the spec path, the target plan path (`.speccy/<run-id>/plan.md`), and the path to `prompts/plan-spike.md` so the planner can prove any load-bearing mechanism (preferably by spawning a spike subagent, or inline). If the spec recorded external context (docs, standards, related projects), pass those references too — read them from the spec rather than relying on conversation memory, since planning may run in a freshly cleared context.

When it completes, brief the user on the approach, key decisions, and risks from `.speccy/<run-id>/plan.md` — point them there for the full text rather than dumping it inline. Update state.json with `planPath` and `phase: "plan-critique"`.

**If the plan flags a contradicted spec assumption**, stop before the plan-critique loop and put it to the user as a blocking choice: accept the adjusted scope, or revise the spec and re-plan. A falsified assumption can invalidate scope, so this blocking gate always fires.

### 2a. Adversarial plan critique

The spec has already been hardened. Now the plan gets an independent review. This loop runs autonomously — the user reviews the final hardened plan in 2b. Read `prompts/plan-critique.md` (relative to this SKILL.md's directory).

For each round (up to 3):

1. **Critique.** Spawn an adversary subagent with the plan critique prompt, the path to the plan, and the path to the spec (for context — the spec itself should not be re-reviewed). Instruct it to **write its review to `.speccy/<run-id>/plan-critique-round-N.md`**. Use **opus** for the model override on every round (or the user's pinned model, if they set one). Read the critique file (N from state.json) to triage. If no legitimate flaws found, exit the loop.
2. **Spike, if the critique flags an unproven load-bearing mechanism.** The critic judges the plan's evidence but does not spike; when it flags a mechanism whose feasibility the plan hasn't proven, prove it before revising. Spawn a spike subagent with `prompts/plan-spike.md` and the mechanism to prove, writing its verdict to `.speccy/<run-id>/spike-round-N.md`. Read the verdict:
   - `confirmed` → carry its evidence into the revise step so the plan records it in the Assumptions check.
   - `refuted` or `unproven` → a load-bearing mechanism that can't be proven can invalidate scope, so treat it like a contradicted spec assumption: stop the loop and put a blocking choice to the user — accept a redesign around a mechanism that works, or revise the spec and re-plan. Like the contradicted-assumption gate, this one always fires.
3. **Revise.** Spawn a revise subagent **on opus** with `prompts/revise.md`, the plan path, the critique file path, and instructions to incorporate every finding in the critique. When it completes, the revised plan file is the truth — don't depend on its return.

After 3 rounds, exit the loop regardless. Update state.json after each round (`planCritiqueRounds`). When the loop exits, surface a one-line note of how many rounds ran and what changed, then proceed to 2b.

### 2b. User review

This is the highest-stakes human gate, so engage it deliberately (see **Steering away from cognitive surrender**):

- **Draw out the user first.** Before walking the plan, ask them to predict it: the choice they'd bet the critique loop pushed hardest on, or the decision they'd defend least confidently. If they have none and you can see a genuinely shaky or load-bearing decision, offer to look at that one together — only if a real one exists. When you then walk the plan, close the loop against their prediction and what the 2a critique actually changed ("you flagged the retry design; the critique reworked the idempotency key instead — surprised?").
- **Then present, candidly.** Have them read the plan file directly rather than re-dumping it into the conversation. Walk through the two or three load-bearing decisions, and for each surface the alternative the plan rejected and its best argument. Include any **load-bearing** call the 2a critique settled autonomously — flag it as speccy's own and invite the user to own or challenge it (re-tag it *Speccy, user-agreed* if they ratify it, *User* if they change it); leave the trivial or clearly-correct revisions unremarked, since parading them just trains the user to skim. Flag where the plan is genuinely uncertain, and don't let a confident passage stand in for a verified one.
- **Name what convinced you.** On the single most consequential decision, ask the user to say what persuaded them, and whether they checked it or are trusting the plan's confidence.

**Recommend a builder.** With the plan's shape now clear, tell the user whether Sonnet (the default) or Opus suits this build, and why — weigh complexity and novelty, how much is left to build-time judgment versus mechanical execution, and how tightly the plan pins down each task. They set `builderModel`.

The adversary has already cleaned up obvious issues; this is the user's chance to raise concerns it missed, adjust the approach on their own knowledge, or approve as-is. Iterate until the user is satisfied. Tag each load-bearing plan decision's **origin** in the plan's decision body: one the user reshapes or overrides on their own knowledge is **User**; one speccy proposed that the user examined and signed off here is **Speccy, user-agreed**; one the 2a critique settled autonomously that never surfaced at this gate stays **Speccy, alone**. That provenance lets the wrap-up probe each the right way, and stops it re-asking the user to justify a steer they made themselves. When approved, set `phase: "implementation"` in state.json.

Before starting implementation, verify all run state is in files: state.json current, spec and plan committed, review decisions reflected in the plan. The main clear already happened after the spec, so this is conditional: if plan critique and review accumulated heavy context, suggest the user `/clear` and re-invoke to resume at implementation; if planning stayed lean, just proceed.

## Phase 3 — Implementation

The build kickoff is a handoff, not a gate (see **Steering away from cognitive surrender**): 2b was the engagement point, so pose no pre-question and announce no check here. If you frame the handoff at all, keep it to a passing line: the build now runs autonomously and the user stays **on** the loop — free to watch it work and step in — rather than walking away from it, which is the vibe-coding failure mode speccy exists to avoid. ("In the loop" is for the spec and plan gates, where the user decides each acceptance; the build is supervision, not decision-by-decision.) Then start the build.

Invoke the `plan-execution` skill directly via the Skill tool from the main conversation — as `speccy:plan-execution` when running from the installed plugin (plugin skills are namespaced `plugin:skill`), or bare `plan-execution` from a local `.claude/skills` checkout; use whichever name the available-skills listing shows. Pass the plan path as `args.planPath` (not the full plan text — the workflow reads the file itself, which keeps the orchestration call small and the plan editable mid-run) and the builder model as `args.model` (from state.json's `builderModel`, default sonnet). The breakdown agent inside plan-execution always uses Opus regardless; only execute/integrate/verify pick up the override.

Do _not_ wrap this in an Agent subagent — Agent subagents lack `Workflow`, so the call breaks. Plan-execution already backgrounds its own work (breakdown, execute, integrate, verify); only the final result returns.

When the workflow reports complete, do not advance on its "gates pass" / "0 violations" summary — a build agent can satisfy a gate by fabricating or inverting a rule and still report green. Re-run the project's load-bearing gates yourself (the build, lint / static-analysis, and test commands from CLAUDE.md) and confirm the actual tool output. If a gate fails, the run isn't done: carry the real tool output into a fix round (the Phase 4 implementation-fix agent handles exactly this), re-run the gates after it, and repeat until you have seen them pass. Only then set `phase: "review"` in state.json and continue.

If the implementation workflow exits incomplete, stop the pipeline. Report what's done and what remains — the user has a branch with partial progress. State.json remains at `phase: "implementation"` so the run can be resumed later.

## Phase 4 — Implementation review

After implementation is complete, the code gets an independent review across several lenses, run in parallel. Completeness is already verified by the task execution skill, so this phase is about quality, spec fidelity, and fit.

### The lenses

Each round spawns these reviewers as **parallel** subagents (one message, one Agent call each), all **read-only** — none edits code. Each writes its findings to its own file `.speccy/<run-id>/review-round-N-<lens>.md`. Pass each the base branch so it can diff `<base-branch>...HEAD`. All prompt paths are relative to this SKILL.md's directory.

Pass each bespoke lens `prompts/review-output-contract.md` alongside its own prompt. It standardises the finding shape across lenses so triage is mechanical, and makes writing the file a hard contract — a lens that runs out of room mid-verification still leaves a file, marking the unconfirmed candidate `PLAUSIBLE`, rather than returning nothing. `code-review` is a built-in skill that won't read the contract; the orchestrator applies the same shape itself when it normalises `code-review`'s findings into the code-review lens file.

- **Code review** — the built-in `code-review` skill, targeting `<base-branch>...HEAD` at `high` effort, with no `--fix` and no `--comment`. It covers correctness and general code quality, so the bespoke lenses handle only what it can't. Run it every round.

  Invoke it **directly in the main conversation** (via the `Skill` tool), not inside an Agent subagent — it spawns its own subagents, and wrapping a multi-agent skill stalls it. Parse its output tolerantly (the shape may change), normalise its verdicts into the shared finding shape, and write `review-round-N-code-review.md` yourself.
- **Project review gate** — the repo's *own* review gate, if it ships one: a `/review`-style skill, project-defined reviewer agents, or a `.claude/review.config.json`. When present, run it as an extra lens. It encodes the house security bar, thresholds, and invariants a generic reviewer can't replicate, so where it exists it is the highest-signal lens in the panel — run it the way the repo documents (its own agents, models, and thresholds; do not override them). Like `code-review`, a project gate is usually itself multi-agent, so invoke it **directly in the main conversation**, not wrapped in an Agent subagent (same reason, and see **Subagent results: trust files, not returns**). It is **spec-blind** — it checks house quality, not whether the build meets _this spec's_ criteria — so it complements the spec-fidelity lens, never replaces it. Normalise its findings into the shared shape and write `review-round-N-project-gate.md` yourself; the triage step dedups its overlap with `code-review`, codebase fit, and local-doc adherence like any other lens. If the repo has no such gate, skip this lens.
- **Spec fidelity** — `prompts/review-spec-fidelity.md`, with the spec path. Does the code satisfy the spec's completion criteria and intent?
- **Tests** — `prompts/review-tests.md`, with the spec and plan paths. Test-strategy adherence, test quality, and consolidation of new tests against the existing suite.
- **Codebase fit** — `prompts/review-codebase-fit.md`. Does this change worsen an already-imperfect area or repeat an existing smell? Judged against the touched files' current state, not the diff alone.
- **Local-doc adherence** — `prompts/review-local-docs.md`. Violations of the repo's governing docs, including CLAUDE.md — which it deliberately re-checks even though code-review covers it too.
- **Suppressions** — `prompts/review-suppressions.md`. Extremely harsh on any linter/analysis/type/test-gate suppression the change adds or leans on. Each must be watertight or it is a finding.
- **Comments** — `prompts/review-comments.md`. Comments the change adds or edits that restate the code, narrate edit history, or pad a real point. Proposes deletions only; the fixer mends any seam.

Run the bespoke lenses on **opus**, except suppressions and comments on **sonnet** (a mechanical scan, and a focused style pass). A pinned adversary model overrides all of them; `code-review` and any project review gate manage their own.

### The loop (up to 3 rounds)

1. **Review.** Spawn the bespoke lenses as parallel subagents in one message, and invoke the inline gates in the main conversation (see above) — `code-review` every round, and the project review gate if the repo ships one — their own fan-out overlaps with the spawned lenses. Round 1 is a cold review. **Rounds 2+ are fix-verification:** re-point each lens at "verify the round-(N-1) fixes hold, and catch any regression they introduced" rather than a fresh cold pass, and always pass it the `.speccy/<run-id>/deferred.md` list as accepted decisions it must not re-raise. Run all lenses every round by default; you may drop a lens only when the fix round provably didn't touch its surface (e.g. skip local-doc adherence when nothing under a governing doc changed). Note any lens you drop and why.

   For the spawned lenses, don't branch on a returned summary (see **Subagent results: trust files, not returns**) — confirm the file exists. **Self-heal a stalled lens:** if a spawned lens's file is missing after it reports complete, `SendMessage` that agent to write its findings file as its final action, marking anything unconfirmed `PLAUSIBLE`, rather than re-spawning it from scratch. Once every lens file is present — the spawned lens files plus the inline-gate files you wrote (code-review, and the project gate if you ran one) — read them (N from state.json) and move to triage.
2. **Triage & merge.** Consolidate the findings across lenses yourself — drop false positives, de-duplicate overlaps, and resolve contradictory suggestions. Don't spawn a separate agent for this. Every lens emits the shared finding shape, so merge on `file:line`: two lenses landing on the same anchor is a **convergence signal**, and independent lenses pointing at one spot raise confidence rather than being noise — weight those up instead of collapsing them to a lone finding. As a backstop for anything the lenses re-raised despite being told not to, drop findings already in `.speccy/<run-id>/deferred.md`; a deferred finding must not churn back into the fix set. Then give each surviving finding a disposition:
   - **Fix** — route it to the fixer this round. Where the finding is a copied smell, tell the fixer whether to diverge (fix cleanly here) or fix wider (also fix the existing instance); a wider fix grows the diff, so choose it deliberately.
   - **Defer** — legitimate but out of scope for this PR. Append it to `.speccy/<run-id>/deferred.md`: what, and why deferred.
   A suppression finding is effectively never Defer — remove it or make it watertight, this round. **Exit the loop when nothing is dispositioned Fix.**

   You make these disposition calls yourself as the loop runs — the review is autonomous. But surface them to the human at wrap-up so they still review the judgment: deferrals in the deferred list, and any divergence-from-pattern or wider-than-the-diff fix in the summary and decision log.
3. **Fix.** If nothing is dispositioned Fix, skip to the next round's review (or exit). Otherwise read `prompts/implementation-fix.md` and spawn a fix subagent with that prompt, the Fix findings (point it at the lens files, and state any diverge / fix-wider instruction), the spec path, and the plan path. It makes the changes and commits. After it commits, re-run the load-bearing gates yourself and confirm the actual output before the next round — never advance on the fix agent's claim that the gates pass. (Gates passing doesn't prove coverage held — a dropped test still passes.)

After 3 rounds, proceed regardless. Update state.json after each round (`reviewRounds`) and set `phase: "complete"` when done. Any `deferred.md` items surface at wrap-up.

## Wrap-up

A completed run is a handoff. Speccy has built and self-reviewed the work; the verdict is the user's, reached through the diff, the artefacts below, CI, E2E, or running it themselves. Speccy stops at a reviewable PR — it does not merge, certify, or run end-to-end verification. Report what was built and leave the review to the user. When pointing them at the diff, suggest they read it as if a contributor they do not fully trust wrote it: the same standard they would apply to any other author's code (see **Steering away from cognitive surrender**).

When all phases complete, report concisely — both in the chat and written to `.speccy/<run-id>/summary.md`, so the handoff survives a context clear and sits alongside the run's other artefacts. Cover:

1. **Summary** — what was built, how many critique/review rounds ran, what changed, and that the branch is ready for review.
2. **Decision log, co-authored** — distil key decisions from the spec, plan, and critique/review rounds into `specs/<slug>-decision-log.md` (including any review-phase divergence from an existing pattern). These are usually implementation-specific choices, not the durable architecture decisions an ADR captures for the wider team. Each entry: what was proposed, what was decided, why, and its **origin** — **User**, **Speccy, user-agreed**, or **Speccy, alone** (carried from the artifacts: the spec's Decisions & rationale is tagged, plan decisions are tagged at 2b, and a review-phase disposition is *Speccy, alone* unless the user raised the concern, in which case it's *User*). Before writing the log, probe only the one or two decisions that warrant it, each the way its origin calls for (see **Steering away from cognitive surrender**): for a **Speccy, user-agreed** decision, ask what convinced them and whether they verified it or trusted the agent's confidence — borrowed confidence is the surrender signal worth catching while the code is fresh and they are about to own it; for a **User** decision, log the rationale as given when it's clear or the call is plainly right, but challenge one resting on a hunch they can't show is correct; a **Speccy, alone** decision isn't a borrowed-confidence target (the user never agreed to it); surface a **load-bearing** one as speccy's own call in the spec or plan and invite them to own or challenge it (re-tagging it *Speccy, user-agreed* or *User* by what they do), but leave the small and trivially-correct ones logged as speccy's without a question. Don't manufacture a probe where nothing warrants one. Commit the decision log.
3. **Deferred feedback** — substantial feedback set aside for later: findings the user skipped at spec critique, plus any review findings deferred to future work in `.speccy/<run-id>/deferred.md` (with the why). These are candidates for follow-up issues outside this PR.
4. **Retrospective** — if the task execution skill produced one, save it to `.speccy/<run-id>/retrospective.md` and surface the cross-cutting patterns. If it has a `## Repo-doc suggestions (CLAUDE.md / ADR)` section, present those for the user to accept or decline, never auto-applied.

If the pipeline exited early (implementation failure), report what's done and what remains. The user has a branch with partial progress.
