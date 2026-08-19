---
name: speccy
description: Guided specification writing, adversarial spec critique, and post-build review. Full pipeline from rough idea to reviewed implementation.
when_to_use: When the user says "speccy", "spec mode", "adversarial mode", or similar. Also when about to execute a complex multi-step plan and adversarial critique would help.
allowed-tools: Bash(bash *skills/speccy/banner.sh), Bash(bash *skills/speccy/metrics.sh), Bash(bash *skills/speccy/metrics.sh *), Read(.speccy/**), Write(.speccy/**), Edit(.speccy/**)
---

# speccy

Full pipeline: specification → spec critique → planning → plan critique → implementation → implementation review.

The orchestrator runs in the main conversation. Heavy work (adversarial critiques, codebase research for planning, applying critique revisions, implementation, and code review) is delegated to subagents so the main context stays small. Persistent state lives in files; the run can be paused at any phase boundary, `/clear`ed, and resumed.

## Getting started

When the skill triggers, **show the speccy banner first**, on every invocation. Run `banner.sh` from this skill's own directory (alongside this SKILL.md) by its **absolute path**: a relative path breaks when the Bash cwd has drifted or the skill is installed as a plugin. Don't prepend `cd` and don't use command substitution; both break the pre-approved permission match.

```bash
bash <skill-dir>/banner.sh
```

The script prints two Markdown lines. **Reproduce them verbatim at the top of your reply**; that is what the user sees. Running the script alone isn't enough, because its tool output is hidden by default.

The banner is cosmetic. If the script fails or would prompt, just proceed without it; never block the run on it.

Then check for an in-progress run (see **Resuming a run** below). If one exists, offer to resume before starting fresh.

For a new run, give a one-sentence introduction: this skill walks through writing a spec, getting it independently critiqued, building the implementation, and reviewing the result. Then ask two things in one turn:

1. **Walkthrough or start?** Tell the user they can ask for a walkthrough of the process, or just describe what they want to build to get going. If they ask for the walkthrough, explain each phase in a few sentences, organised around what the user does vs what runs autonomously:
   - **Spec** (interactive): the skill interviews the user to build a structured spec, then the user reviews and edits until satisfied.
   - **Spec critique** (user-in-the-loop): an independent reviewer critiques the spec each round. The user decides what feedback to incorporate.
   - **Plan** (autonomous loop): a subagent researches the codebase and drafts a plan; an independent reviewer critiques and a revise agent applies findings until the plan is clean.
   - **Plan review** (user decides): the user reviews the hardened plan, raises concerns, approves.
   - **Implementation** (autonomous loop): the skill builds to the plan; parallel reviewers check the code across several lenses (correctness and quality via the built-in `code-review` skill, the repo's own review gate when it ships one, plus spec fidelity, tests, codebase fit, local-doc adherence, comment noise, and strict scrutiny of linter/analysis suppressions); fixes are applied directly, or deferred as future work.
   - **Wrap-up**: summary, decision log, retrospective. The user reviews the final diff on the branch.

   Also mention: state is saved after every phase boundary, so the user can `/clear` and re-invoke the skill at any point to resume with a fresh context. Useful for long runs where the main conversation has grown.

2. **Defaults you can change.** Note the per-phase model defaults (just below) and that they're overridable. No need to ask; just flag that the options exist.

Each phase has its own model default:

- **Spec and plan critique**: opus every round (both the adversary and the revise agent), up to 3 rounds. These are short, high-leverage artifacts where cheaper tiers cost more in false-positive triage than they save. The readability pass inside each loop runs on sonnet.
- **Implementation review**: parallel review lenses, up to 3 rounds (see Phase 4). The four judgment lenses (spec fidelity, tests, codebase fit, local-doc adherence) run on opus, and the suppressions and comments lenses on sonnet; the built-in `code-review` skill runs alongside them at `high` effort and manages its own models.
- **Builder** (execute/integrate/verify inside plan-execution): sonnet; plan-execution's breakdown agent always uses opus.

Two overrides: pin a single adversary model (`adversaryModel`), then used for every critique round and review lens; and raise the builder (`builderModel`), commonly to opus for high-stakes work.

Each loop restarts at round 1 and exits early when a round surfaces no valuable criticism (the spec and plan loops first run one more round to check the readability pass; see 1d and 2a).

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
  "phase": "spec-critique" | "planning" | "plan-critique" | "implementation" | "review" | "wrap-up" | "complete",
  "specPath": "specs/auth-refactor.md",
  "planPath": ".speccy/auth-refactor-20260609-1430/plan.md",
  "decisionLogPath": "specs/auth-refactor-decision-log.md",
  "specCritiqueRounds": 1,
  "planCritiqueRounds": 0,
  "reviewRounds": 0,
  "readabilityPasses": ["spec"],
  "engagementQuestions": [
    { "gate": "spec-critique", "asked": "the finding you'd bet the reviewer raises" }
  ]
}
```

**The schema is closed.** Write these fields and no others.

The pull to add a field comes when a decision lands and the artifact hasn't caught up. Write it to the artifact then and there:

- A user ruling, override, or ratification goes to **Decisions & rationale** in the spec or plan, with its Origin tag. An origin flip edits that entry.
- A spike's result goes to its spike file, folded into the spec before the next critique round.
- A constraint or environment quirk goes to the spec's **Constraints** if it belongs to this feature, `CLAUDE.md` if it belongs to the project.
- A tension to put to the critic goes to the spec's **Assumptions** or **Open questions**, where the critique loop reads it.
- A correction still to apply gets applied. Parked in state, it stays unapplied.
- How a decision was reached goes to the decision log, which exists from 1c onward for exactly this (see **The decision log runs with the run**).

What remains is genuinely transient: the user is mid-read, a precondition passed an hour ago, an agent is running. That dies with the context by design, and a resumed run re-checks or asks.

`adversaryModel` defaults to `"opus"`: the tier for every critique round and the review panel's judgment lenses (the suppressions and comment lenses run a tier below; see **Getting started**). If the user pinned a different adversary model, store that name here instead and use it for every critique round and review lens.

On trigger, read `.speccy/.current-runid`, a pointer to the most recent run written when the run is created (see Phase 1c). If it exists, read that run's `state.json`; if `phase` is not `"complete"`, surface the run to the user and ask whether to resume or start fresh. To resume, read the artifacts state.json references (spec, plan, latest critique round) and continue from the recorded phase.

state.json names the spec, plan, and decision log, and no other file. **List `.speccy/<run-id>/` to see what else the run produced** — earlier rounds, spikes, readability change notes, deferred findings — and read what the phase you are resuming into needs.

**When an artifact is replaced, rename what reviewed it.** A re-plan leaves its critique rounds and readability change notes describing a draft that no longer exists, and a resumed context reading one cold will act on findings that no longer apply. Rename each to `SUPERSEDED-<original name>`, which groups them in a listing. They remain the run's history, and the wrap-up reads them for a reversal nobody logged, so rename rather than delete. A spike verdict is evidence about the world rather than a review of a draft, so it keeps its name.

A resumed run skips the precondition checks, so if the recorded phase is anything past the spec interview, suggest auto-accept mode (shift+tab) first: the rest of the run is autonomous tool calls.

After completing each phase, update state.json and continue to the next phase. The user can `/clear` and re-invoke the skill at any point to resume from the recorded phase; no need to ask permission at phase boundaries.

Read and write `.speccy/` state with the Read/Write tools: these paths are pre-approved in this skill's `allowed-tools`, so they won't prompt. Do **not** rely on the Glob tool: it isn't available in every session, which is why run discovery uses the `.current-runid` pointer. The pointer tracks the latest run; earlier runs remain in `.speccy/` if the user wants to revisit one.

## Preconditions

Before running any of the checks below, suggest the user enable auto-accept mode (shift+tab). From here to the end of the run the work is mostly tool calls (the verification smoke-test runs the project's linters and tests, then planning, critique, implementation, and review run autonomous loops), so approving each one by hand is pure friction. The spec interview is a conversation regardless, so auto-accept doesn't take any decisions away: the user still reviews and edits the spec content directly.

### Verification tools

Check that CLAUDE.md documents the project's verification tools (build, lint, static analysis, test commands). These are needed during implementation: execute agents run them to validate their work. If they're missing, tell the user before proceeding. Establishing verification standards is part of project setup; discovering them mid-build is too late.

Documented is not the same as working. **Smoke-test the tooling now, on the clean tree, before investing in spec and plan**: a broken or pathological verification setup discovered at implementation has already cost a spec, several critique rounds, and a plan. Run each documented command once and confirm it completes, passes (or note its baseline failures), and returns in a reasonable time. Surface anything that hangs, errors, or floods output before proceeding.

### Worktree init

Worktrees come into play only for **parallel** tasks. Plan-execution runs sequential tasks directly on the main checkout; only parallel tasks get git worktrees, which lack gitignored state. You won't know whether the plan produces parallel tasks until breakdown, so treat this as preparation that may not be exercised this run. Check whether CLAUDE.md has a `## Worktree init` section with gather/apply blocks. If it does, nothing to do: plan-execution will use it if parallel tasks arise. If it's missing:

1. Note that worktree agents (parallel tasks only) will lack gitignored files (node_modules, tool configs, generated artifacts).
2. Offer to help draft the section: look at `.gitignore` and the verification commands for clues about what needs recreating.
3. The format is gather (commands run in the main checkout, capturing stdout as named variables) and apply (commands run in the worktree, substituting gathered values). See existing CLAUDE.md examples.
4. Have the user review and commit the section before proceeding.

A purely sequential plan never touches worktrees, so a project that only runs sequential work can skip this, but it's cheap insurance for any run that fans out.

### Git state

Before starting work:

1. Run `git status --porcelain`; if the working tree is dirty, tell the user and stop.
2. Run `git branch --show-current` and note the current branch. This is the **base branch** for the rest of the pipeline.
3. If not on the main branch, confirm with the user that the current branch is the intended base. Proceed on whatever they confirm.

## Writing style

Every artifact this pipeline produces (spec, plan, critique, review notes, summary, decision log) is written for a person first: the reviewer now, and whoever picks the work up later. `prompts/writing-style.md` (relative to this SKILL.md's directory) holds the rules. It governs what speccy writes itself, and it is passed to every subagent speccy spawns to write one of those artifacts (see **Propagate the session's voice to subagents**). Plan-execution's build agents are outside it: their task files are working notes for the build rather than something a reviewer reads.

The critique loops pull the other way, since the cheapest answer to a critic is one more clause. Three things push back, all wired in below. Every one of those agents gets `writing-style.md`, so a draft starts readable. The readability pass (`prompts/readability-pass.md`) is the one step allowed to remove. And once that pass has run, the critique prompts add a reader lens, which is what stops the rewrite sliding back over the rounds that follow.

## The decision log runs with the run

`specs/<slug>-decision-log.md` is created with the spec at 1c and appended to as the run goes. The wrap-up completes it; it does not start it.

It exists this early because the spec and plan hold only the position they now hold. How a position was reached has nowhere else to go, so a run without this file writes it into state.json, into a chat message a `/clear` eats, or nowhere. Three things go in, at the moment they land:

- A decision reverses, whether a critique, a spike, or the user changed the call. The artifact moves to the new position; the log keeps the old one and what changed it.
- An origin flips (see **Steering away from cognitive surrender**): the user ratified, overrode, or reshaped a decision.
- The user answers "what convinced you" at a gate. Their words, and only theirs.

Nothing else. Use the wrap-up's entry shape from the start (what was proposed, what was decided, why, origin), keep entries to a few lines, and write no entry at all for a decision that still stands as the spec or plan states it. Commit it alongside the change it explains.

## Subagent results: trust files over returns

Subagents run in the background, and their completion notifications are unreliable: the returned summary can arrive **misrouted** under a different agent's completion, and the notification's apparent identity (which agent, which round) can be wrong. A round-3 critique may surface labelled as the round-2 revise agent. This is expected harness noise.

So for every spawned agent: you know what it was spawned to do and the exact file it writes, and the round number comes from state.json rather than the notification. When a completion arrives, read that file and act only on its contents. Never branch control flow (early-exit, round counting, commit messages, what you tell the user) on a returned summary or a notification's label. Don't narrate or diagnose misrouting; read the right file and carry on.

## Propagate the session's voice to subagents

The main session may be governed by a behavioural or output style a fresh agent context does **not** inherit: a house-voice hook (e.g. one injected at session start), a configured output style, or communication conventions that live beyond the project's `CLAUDE.md`. A subagent starts clean and never sees the main session's system prompt, so unless you carry that style across, every critic, revise agent, planner, review lens, and fixer speaks in a default voice that clashes with how this session talks, and the artifacts they write (critiques, plan, review notes) read in a different register from the rest of the run.

So **before spawning any subagent, restate the active style concisely at the top of its prompt**, enough that both its reasoning and its written output match the session's voice. **Pass `prompts/writing-style.md` to every subagent that writes an artifact**, which is all of them but the fixer: the session's voice is a layer on top of those rules rather than a substitute for them, and a style restated from memory is the least reliable way to carry a writing standard across a context boundary. Two things are out of reach and don't need carrying: conventions already in `CLAUDE.md` (subagents read it anyway), and the built-in `code-review` skill run inline (it manages its own prompt; the orchestrator just applies the session's voice when it normalises those findings into the lens file). This rule applies to every spawn site in the phases below; it is stated once here rather than repeated at each. speccy's own narration back to the user follows the same style as a matter of course.

## Pass the tool-use rules to every subagent

**Pass `prompts/tool-use.md` to every subagent speccy spawns**, including plan-execution's build agents. It holds one rule: gather independent lookups in a single turn rather than one per turn. Like the writing-style rule above, this applies at every spawn site in the phases below and is stated once here rather than repeated at each. The same two exceptions apply, for the same reason: the built-in `code-review` skill and any project review gate manage their own prompts.

Its scope is deliberately wider than `writing-style.md`, which skips the build agents because their task files are working notes. This one governs how an agent works rather than what it writes, so the agents that read the most code need it most.

A subagent's whole context is re-read on every turn, so cost tracks the number of turns far more than the volume of what it reads. Measured on one lens over a 136-file diff, two agents given this rule took 29% fewer turns and 28% less cache read than two without it, while fetching 3% *more* material, reaching the same final context, and finding the same number of things. The saving is round trips, not thoroughness, which is why the rule says to look at no less than you would have.

## Steering away from cognitive surrender

speccy's own output is the hazard. Adversarially-hardened specs and plans read as authoritative, and the more authoritative they read, the stronger the pull for the user to approve without understanding (cognitive surrender: borrowed confidence, surface correctness hiding deeper flaws). The pipeline already hardens its artifacts. These habits guard the user's engagement, which nothing else does.

Apply these habits at the run's three human gates and nowhere else: the spec critique (1d), the plan review (2b), and the wrap-up decision log (Phase 5). The other interactive moments are not gates, so pose no pre-question there: the intake and interview gather requirements, the first-draft review (1c) is the user's turn to read and edit, and the build kickoff (Phase 3) is a handoff. The pre-question in particular assumes the user has read the artifact and is about to see it critiqued; asked before a draft is read, or after a decision is already made, it has no referent and reads as the ritual this section exists to prevent. The three habits:

- **Ask before you tell, then reveal.** Before showing the agent's findings, have the user commit a *prediction* rather than an open judgment: the one thing they'd bet the critique flags, or the part they'd defend least confidently. An open "where is it weakest?" is too easy to shrug off; predicting forces the user to build their own model of the artifact first, which is the anti-anchoring point. If they genuinely have nothing, offer to look together at one thing *you* find risky, but only if a real one exists (many artifacts are straightforward; don't manufacture one). Draw it from your own read rather than the critique you are holding, which would leak the critique early. Then when you present the critique, close the loop against their prediction: "you expected X; it flagged Y. Surprised?". The consequence is what makes the question land; without the reveal it decays to a shrug.
- **Flag doubt; stay quiet about certainty.** Surface where the agent is unsure and what it assumed. Never offer high confidence as a reason to skip review, since a confident wrong call adopted wholesale is the worst outcome. Point the user's attention at the doubtful parts and let the settled ones pass.
- **Name what convinced you.** A recorded decision reaches this point one of three ways (its **origin**), and each wants a different touch. **(1) speccy, user-agreed**: speccy proposed it and the user agreed at a gate. This is the borrowed-confidence zone, and what this whole habit is built for. Ask what persuaded them, and whether they verified it or simply trusted that the agent sounded sure. **(2) User**: the user made the call themselves, so don't run the borrowed-confidence check on it. If the rationale is clear and recorded, or the call is plainly right as far as you can tell, let it stand; re-quizzing someone on reasoning they've already given is the empty ritual this section exists to prevent. But if it rests on a hunch with no clear reason you can see is right, challenge it on its merits. That is speccy doing its job rather than skipping it. **(3) speccy, alone**: speccy decided it autonomously, with no gate for the user to sign off (a plan-critique revision, a review disposition). The user never agreed to it, so the borrowed-confidence check has no referent. Surface only the **load-bearing** ones (a call that shapes the design, or one the user would want to own) as speccy's own now sitting in the spec or plan, and invite the user to check they agree and could justify it. Judgement governs hard here: a small or trivially-correct autonomous call speccy can stand behind doesn't need raising, and burying the user in autonomous-call checks trains them to tune speccy out, the disengagement this section fights. Keep the probing to one decision per gate, so it reads as a self-check rather than an interrogation.

**Origin flips as the user engages.** When speccy surfaces a *speccy, alone* decision and the user ratifies it, re-tag it *speccy, user-agreed*; if they override or reshape it, re-tag it *User*. Record the flip in the artifact, so a later gate or the wrap-up doesn't re-surface a call the user has already owned. (Challenging a *User* hunch is different: if the user then gives a clear reason, it stays *User*, now with its rationale recorded.)

Ask these as ordinary questions inside the flow of the gate; never announce that you're doing them and never give them a label to the user (no "engagement check", no "cognitive surrender"): a prompt flagged as a check gets performed rather than thought about. A user who would rather not be asked can simply decline, or say so at the start; honour that, and you need not advertise the possibility.

**Vary the questions across gates.** The job repeats at each gate but the wording must not: the same pre-question framing heard three times decays into a ritual the user pattern-matches and shrugs past, which is the ritualization this whole section fights. Before posing a pre-question or a "what convinced you", read `engagementQuestions` from state.json to see what earlier gates already asked, and come at this one from a fresh angle (a different referent, a different way in) rather than reciting the template. After you ask, append a short paraphrase of what you actually posed (`{ gate, asked }`) to `engagementQuestions` and save state.json. The list starts empty and survives a `/clear`, so a resumed context still knows what framings are spent. The point is to avoid repeating yourself, and it never demands perfect wording: the engagement comes from the loop, and variation only keeps the loop from going stale.

**Each of these questions is a stop.** Ask it as the last thing in the turn and wait: the question fails precisely when the orchestrator asks, then keeps thinking and running tool calls until it scrolls off unanswered. Nothing follows the question until the user replies, and a pre-question never reveals the critique in the same turn (which would pre-empt the answer and lose the anti-anchoring). Put it on its own line at the end of the reply.

**The long idle stretches are the other good moment.** The autonomous phases (plan critique in 2a, the build in Phase 3, the review panel in Phase 4) leave the user waiting on a subagent for a long while. That idle time engages well with a different device from the gate habits: an offer to deepen understanding rather than a pre-question, since there is no artifact to predict yet. Offer to walk through how a part of the system works relative to what's being built, or raise an implementation detail the plan left open and ask whether the user has a preference. Only when there's something genuine to say; manufactured filler trains the user to tune speccy out. Two rules keep it from backfiring, and both invert the gate question's "stop":

- **It never blocks.** The job runs regardless, and a completion that lands mid-conversation is surfaced at once. The chat is opportunistic filler and never a reason to sit on a finished job.
- **Any steer feeds forward**, into an upcoming task or the review; never expect the running build to have already adopted it. A preference that would change approved scope is a re-plan rather than a mid-build aside.

Apply the same standard to the final diff: read it as if a contributor you do not fully trust wrote it.

## Phase 1: Specification

Build a structured spec through interview.

### 1a. Intake

The user may or may not have provided a starting description alongside the trigger.

**If they provided something** (a sentence, a feature request, an existing spec file), use that as the seed. If they point to a file in the repo, that's the starting draft.

**If they provided nothing** (e.g. just "spec mode"), ask what they want to build. Suggest the kind of information that's useful at this stage: what problem they're solving, who it's for, any constraints they already know about, and how they'll know it's done. Don't require all of this upfront; just enough to start the interview.

### 1b. Interview

**Treat the intake as settled.** Take what the user gave you at face value: don't re-ask what it answers, don't ask them to reconfirm a stated choice, and only reopen a settled point if they re-raise it or you have a serious, specific doubt. Prefer recording a reasonable default in the spec's Assumptions section over asking; the critique loop challenges it there.

Ask only about gaps the intake leaves genuinely open and that materially change the spec:

- Scope boundaries: what's in, what's out
- Edge cases and error scenarios
- Constraints (performance, security, compatibility)
- Integration points with existing code
- Non-functional requirements

Identify external context that would improve the spec or plan: documentation, other projects with relevant patterns, standards, API references. Ask the user about anything you can't access directly. This is worth doing early: missing context discovered mid-build is expensive. Record the references that matter in the spec itself (under Open questions, or a short references note) so they survive the context clear before planning. Anything left only in conversation is lost when the user `/clear`s.

**Never ask what code or the environment can answer.** If a quick look at the repo, config, or tooling would settle it, look instead of asking. Mark questions needing deeper codebase research open and defer them to planning.

**Asking nothing is fine.** If the intake settles what you need, write the draft and skip the interview. (Clarifying questions only; the habits under **Steering away from cognitive surrender** still apply.)

### 1c. Structured spec

Produce a first-draft spec from the interview answers using the template in `prompts/spec-template.md` (relative to this SKILL.md's directory). Fill in every section; remove the HTML comments. Write it to the standard in `prompts/writing-style.md`: a draft that starts dense stays dense, because every later step is a revision of it.

The template defines what each section holds. Two things about **Decisions & rationale** are the interview's job rather than the template's:

- **Draw the reasoning out, but only where the user hasn't given it.** When a choice has a real alternative and the description doesn't explain the pick, ask why they lean that way rather than recording it silently. Don't re-ask about a decision the input already settles: a stated preference, mandate, or existing convention is a complete rationale on its own.
- **Capture it now, because the decision log distils that section.** Rationale recorded here is rationale the user isn't reconstructing from memory at the end of the run.

Let the user read and edit the draft until satisfied. This is their first read rather than a gate, so pose no engagement question here; the pre-question comes at the 1d critique, once they have the draft in hand.

Create a feature branch before committing anything. Pick a short, descriptive name for the work; if it collides with an existing branch, adjust it. Then `git checkout -b <branch>`.

Save to `specs/<slug>.md`.

Start `specs/<slug>-decision-log.md` next to it (see **The decision log runs with the run**). Open it with what the run is working from: the seed and how it was treated, and any decision already taken that the spec's Decisions & rationale cannot hold, such as a point where the seed was overruled. If the interview produced no such history, the file opens with the seed alone and stays short. Commit both.

Generate a `runId`: lowercase kebab from the slug plus a `YYYYMMDD-HHmm` timestamp (e.g. `auth-refactor-20260609-1430`). Create `.speccy/<run-id>/` and ensure `.speccy/` is in `.gitignore`. Write the initial `state.json` (phase: `spec-critique`, with runId, slug, baseBranch, adversaryModel, builderModel, specPath, decisionLogPath). Also write the runId to `.speccy/.current-runid` (plain text, no newline needed) so a later session can find this run without globbing.

Tell the user about the directory: critique rounds, the plan, review notes, and run state will be saved there so they can open them in their editor rather than scrolling terminal output. Mention the path once here; don't repeat it at every save.

### 1d. Adversarial spec critique

Before investing in planning, the spec gets an independent review. Read `prompts/spec-critique.md` (relative to this SKILL.md's directory).

Run the loop to exhaustion before offering to clear or move on. The user is in the loop on which findings to incorporate each round, but a single revised round is not a stopping point: keep critiquing until a round surfaces no valuable criticism *and* the readability pass has been checked by a round, or 3 rounds run. Don't offer the clear or planning as a mid-loop alternative to the next round.

For each round (up to 3):

1. **Critique.** Spawn an adversary subagent (Agent tool) with the spec critique prompt and the path to the spec. Instruct it to **write its review to `.speccy/<run-id>/spec-critique-round-N.md`**. Use **opus** for the model override on every round (or the user's pinned model, if they set one). Tell it whether the readability pass has run (`readabilityPasses` in state.json): before the pass it critiques substance only and skips the reader lens, since the pass rewrites the prose anyway and the user shouldn't spend triage on findings that get fixed regardless.
2. **Present.** Before showing the critique, ask the user to predict it: the finding they'd bet the reviewer raises, or the part of the spec they'd defend least confidently (see **Steering away from cognitive surrender**). If they have none and you can see a genuine soft spot, offer to look at it together; if the spec is solid, let it go. Then read `.speccy/<run-id>/spec-critique-round-N.md` (N from state.json), present its findings, and close the loop against their prediction ("you expected X; it flagged Y. Surprised?"). Point the user to the file for the full text. Ask which findings to incorporate, and on the most consequential finding they choose to adopt, ask what convinced them: adopting the adversary's call is where borrowed confidence lives; a finding they reject on their own judgement is their call, so leave it. Log their answer in their words, along with any position the round reversed. If the round surfaced no valuable criticism, the critique is done, but don't leave the loop until the readability pass has run and a round has read the result (see below).
3. **Revise.** Spawn a revise subagent (Agent tool) **on opus** with `prompts/revise.md`, the spec path, the critique file path, and the list of accepted findings. The subagent rewrites the spec in place. Once it completes, commit the updated spec with a message summarising the accepted findings you incorporated: you already have that list, so build the message from it rather than from the agent's return. Then run the next round to check the revisions and probe deeper.

**The readability pass runs after round 1, once per run, whether or not that round produced a revision.** Spawn a subagent **on sonnet** with `prompts/readability-pass.md`, `prompts/writing-style.md`, `prompts/spec-template.md`, the spec path, and `.speccy/<run-id>/readability-spec.md` as its change-note path. It rewrites the spec for its reader and changes nothing the spec says. Commit it separately from the round's revision, so the user can read a rewrite-only diff, and append `"spec"` to `readabilityPasses` in state.json so a resumed context doesn't run it twice. Sonnet is the tier because rewriting to a written style guide is execution against an instruction, and the critique round that follows is what checks the result; a pinned `adversaryModel` doesn't govern this agent, which isn't a critic.

**A critique round always follows the pass.** A rewrite is the one step that can silently drop a load-bearing fact, and a critic reading the rewritten spec cold is what catches that: missing deliverables and unstated constraints are already its first two finding classes. So the pass never lands after the last round: if round 1 surfaced no valuable criticism, run the pass anyway and let round 2 check it. **Don't give that round the change note.** A critic told what was cut checks those cuts and reads past everything else, and the cut nobody declared is the failure this round exists to catch. `readability-spec.md` is for you, the user, and the wrap-up: tell the user what the pass cut before they read the round's findings.

After 3 rounds, proceed regardless. Update state.json after each round (`specCritiqueRounds`).

**Exit checks.** Confirm each before leaving this phase (a resumed context has only what's on disk):

- the revised spec is committed
- `readabilityPasses` includes `"spec"`, and a critique round ran after it
- the findings the user skipped, and any the 3-round cap left unaddressed, are in `.speccy/<run-id>/spec-critique-skipped.md` with the reason. The wrap-up reports them, and the `/clear` suggested just below deletes anything held only in conversation. Keep them out of `deferred.md`: the review panel is told not to re-raise anything in that file, and a skipped spec finding is a decision about the spec rather than acceptance of the matching defect in the code.
- `phase` is `"planning"`

Only once the loop has fully exited, reach the primary context-clearing point. The spec interview and critique are the heaviest interactive context in the run, and the approved spec now captures every decision in a committed file, so the window can reset before planning, which is largely subagent-driven. Verify all run state is in files (state.json current, spec committed, external references recorded in the spec rather than left only in conversation), then suggest the user `/clear` and re-invoke to resume at planning. If they'd rather continue, proceed to Phase 2.

## Phase 2: Planning

Before diving in, briefly orient the user on why planning is a separate step: the spec says _what_ to build, the plan says _how_. Planning is where we research the codebase, discover what already exists, make architecture decisions, and work out the order of operations. Without it, the spec's open questions carry into implementation and cause mid-build surprises.

Planning research happens in a subagent to keep the codebase-reading noise out of the main context. Read `prompts/plan-research.md`.

**Dispatch the project's own research agents from here rather than from the planner.** A spawned subagent is shown no agent types at all, so the planner cannot name a repo's own research agent, and a subagent that spawns children and waits on them has stalled twice. So if `.claude/agents/` holds read-only research agents, dispatch the relevant ones yourself before spawning the planner and pass their findings into its prompt. Cite them in the plan as research: unlike a house skill's rule, a research agent's answer is one agent's output, and the critique loop weighs it like any other evidence.

Spawn a planning subagent (Agent tool) with the plan-research prompt, the spec path, the target plan path (`.speccy/<run-id>/plan.md`), the paths to `prompts/plan-template.md` and `prompts/writing-style.md`, and the path to `prompts/plan-spike.md` so the planner can prove any load-bearing mechanism (preferably by spawning a spike subagent, or inline). If the spec recorded external context (docs, standards, related projects), pass those references too. Read them from the spec rather than relying on conversation memory, since planning may run in a freshly cleared context.

When it completes, brief the user on the approach, key decisions, and risks from `.speccy/<run-id>/plan.md`; point them there for the full text rather than dumping it inline. Update state.json with `planPath` and `phase: "plan-critique"`.

**If the plan flags a contradicted spec assumption**, stop before the plan-critique loop and put it to the user as a blocking choice: accept the adjusted scope, or revise the spec and re-plan. A falsified assumption can invalidate scope, so this blocking gate always fires.

### 2a. Adversarial plan critique

The spec has already been hardened. Now the plan gets an independent review. This loop runs autonomously; the user reviews the final hardened plan in 2b. Read `prompts/plan-critique.md` (relative to this SKILL.md's directory).

For each round (up to 3):

1. **Critique.** Spawn an adversary subagent with the plan critique prompt, the path to the plan, and the path to the spec (for context; the spec itself should not be re-reviewed). Instruct it to **write its review to `.speccy/<run-id>/plan-critique-round-N.md`**. Use **opus** for the model override on every round (or the user's pinned model, if they set one). Tell it whether the readability pass has run (`readabilityPasses` in state.json): before the pass it critiques substance only and skips the reader lens. Read the critique file (N from state.json) to triage. If no legitimate flaws found, the critique is done, but don't leave the loop until the readability pass has run and a round has read the result (see below).
2. **Spike, if the critique flags an unproven load-bearing mechanism.** The critic judges the plan's evidence but does not spike; when it flags a mechanism whose feasibility the plan hasn't proven, prove it before revising. Spawn a spike subagent with `prompts/plan-spike.md` and the mechanism to prove, writing its verdict to `.speccy/<run-id>/spike-round-N.md`. Read the verdict:
   - `confirmed` → carry its evidence into the revise step so the plan records it in the Assumptions check.
   - `refuted` or `unproven` → a load-bearing mechanism that can't be proven can invalidate scope, so treat it like a contradicted spec assumption. Stop the loop and put a blocking choice to the user: accept a redesign around a mechanism that works, or revise the spec and re-plan. Like the contradicted-assumption gate, this one always fires.
3. **Revise.** Spawn a revise subagent **on opus** with `prompts/revise.md`, the plan path, the critique file path, and instructions to incorporate every finding in the critique. When it completes, the revised plan file is the truth; don't depend on its return. Commit it, with a message built from the critique's findings rather than from the agent's return.

**The readability pass runs after round 1, whether or not that round produced a revision, and a critique round always follows it.** This is the same shape as the spec loop in 1d, and for the same reason: a critic reading the rewritten plan cold is what catches a rewrite that dropped something load-bearing. So the pass never lands after the last round: if round 1 found no legitimate flaws, run the pass anyway and let round 2 check it, and don't give that round the change note. Spawn the pass **on sonnet** with `prompts/readability-pass.md`, `prompts/writing-style.md`, `prompts/plan-template.md`, the plan path, the spec path, and `.speccy/<run-id>/readability-plan.md` as its change-note path. Commit it separately from the round's revision, then append `"plan"` to `readabilityPasses`. This one earns its keep twice over, because 2b is where the user reads the plan and decides whether to build from it.

After 3 rounds, exit the loop regardless. Update state.json after each round (`planCritiqueRounds`). When the loop exits, surface a one-line note of how many rounds ran and what changed, then proceed to 2b.

**Exit checks.** Confirm both before leaving this phase (a resumed context has only what's on disk):

- the revised plan is committed
- `readabilityPasses` includes `"plan"`, and a critique round ran after it

### 2b. User review

This is the highest-stakes human gate, so engage it deliberately (see **Steering away from cognitive surrender**):

- **Draw out the user first.** Before walking the plan, ask them to predict it: the choice they'd bet the critique loop pushed hardest on, or the decision they'd defend least confidently. If they have none and you can see a genuinely shaky or load-bearing decision, offer to look at that one together, but only if a real one exists. When you then walk the plan, close the loop against their prediction and what the 2a critique actually changed ("you flagged the retry design; the critique reworked the idempotency key instead. Surprised?").
- **Then present, candidly.** Have them read the plan file directly rather than re-dumping it into the conversation. Walk through the two or three load-bearing decisions, and for each surface the alternative the plan rejected and its best argument. Include any **load-bearing** call the 2a critique settled autonomously: flag it as speccy's own and invite the user to own or challenge it (re-tag it *speccy, user-agreed* if they ratify it, *User* if they change it). Leave the trivial or clearly-correct revisions unremarked, since parading them just trains the user to skim. Flag where the plan is genuinely uncertain, and don't let a confident passage stand in for a verified one.
- **Name what convinced you.** On the single most consequential decision, ask the user to say what persuaded them, and whether they checked it or are trusting the plan's confidence.

**Recommend a builder.** With the plan's shape now clear, tell the user whether Sonnet (the default) or Opus suits this build, and why: weigh complexity and novelty, how much is left to build-time judgment versus mechanical execution, and how tightly the plan pins down each task. They set `builderModel`.

The adversary has already cleaned up obvious issues; this is the user's chance to raise concerns it missed, adjust the approach on their own knowledge, or approve as-is. Iterate until the user is satisfied. Tag each load-bearing plan decision's **origin** in the plan's decision body: one the user reshapes or overrides on their own knowledge is **User**; one speccy proposed that the user examined and signed off here is **speccy, user-agreed**; one the 2a critique settled autonomously that never surfaced at this gate stays **speccy, alone**. That provenance lets the wrap-up probe each the right way, and stops it re-asking the user to justify a steer they made themselves. When approved, set `phase: "implementation"` in state.json.

Before starting implementation, verify all run state is in files: state.json current, spec and plan committed, review decisions reflected in the plan. The main clear already happened after the spec, so this is conditional: if plan critique and review accumulated heavy context, suggest the user `/clear` and re-invoke to resume at implementation; if planning stayed lean, just proceed.

## Phase 3: Implementation

The build kickoff is a handoff rather than a gate (see **Steering away from cognitive surrender**): 2b was the engagement point, so pose no pre-question and announce no check here. If you frame the handoff at all, keep it to a passing line: the build now runs autonomously and the user stays **on** the loop, free to watch it work and step in, rather than walking away from it, which is the vibe-coding failure mode speccy exists to avoid. ("In the loop" is for the spec and plan gates, where the user decides each acceptance; the build is supervision rather than decision-by-decision.) Then start the build.

Invoke the `plan-execution` skill directly via the Skill tool from the main conversation: as `speccy:plan-execution` when running from the installed plugin (plugin skills are namespaced `plugin:skill`), or bare `plan-execution` from a local `.claude/skills` checkout; use whichever name the available-skills listing shows. Pass the plan path as `args.planPath` (rather than the full plan text; the workflow reads the file itself, which keeps the orchestration call small and the plan editable mid-run) and the builder model as `args.model` (from state.json's `builderModel`, default sonnet). The breakdown agent inside plan-execution always uses Opus regardless; only execute/integrate/verify pick up the override.

Do _not_ wrap this in an Agent subagent: Agent subagents lack `Workflow`, so the call breaks. Plan-execution already backgrounds its own work (breakdown, execute, integrate, verify); only the final result returns.

When the workflow reports complete, do not advance on its "gates pass" / "0 violations" summary: a build agent can satisfy a gate by fabricating or inverting a rule and still report green. Re-run the project's load-bearing gates yourself (the build, lint / static-analysis, and test commands from CLAUDE.md) and confirm the actual tool output. If a gate fails, the run isn't done: carry the real tool output into a fix round (the Phase 4 implementation-fix agent handles exactly this), re-run the gates after it, and repeat until you have seen them pass. Only then set `phase: "review"` in state.json and continue.

If the implementation workflow exits incomplete, stop the pipeline. Report what's done and what remains: the user has a branch with partial progress. State.json remains at `phase: "implementation"` so the run can be resumed later.

## Phase 4: Implementation review

After implementation is complete, the code gets an independent review across several lenses, run in parallel. Completeness is already verified by the task execution skill, so this phase is about quality, spec fidelity, and fit.

### The lenses

Each round spawns these reviewers as **parallel** subagents (one message, one Agent call each), all **read-only**; none edits code. Each writes its findings to its own file `.speccy/<run-id>/review-round-N-<lens>.md`. Pass each the base branch so it can diff `<base-branch>...HEAD`. All prompt paths are relative to this SKILL.md's directory.

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

1. **Review.** Spawn the bespoke lenses as parallel subagents in one message, and invoke the inline gates in the main conversation (see above): `code-review` every round, and the project review gate if the repo ships one. Their own fan-out overlaps with the spawned lenses. **Every round is a cold review**, rounds 2 and 3 included. Point each lens at the whole diff again, and add the round-(N-1) fixes as further ground to cover: verify they hold, and catch any regression they introduced. A round that *only* verifies the last round's fixes can never find what the panel missed the first time, and one cold pass is not enough: findings well within the panel's reach routinely surface in a later independent review of the same code. Always pass the `.speccy/<run-id>/deferred.md` list as accepted decisions it must not re-raise.

   Run all lenses every round by default. You may drop a lens only when the fix round provably didn't touch its surface (e.g. skip local-doc adherence when nothing under a governing doc changed). A lens finding nothing last round is **not** grounds to drop it: yield describes the round that ran rather than the code as it now stands, and the lenses whose clean result is the expected one (suppressions above all) are exactly the ones a fix round is most likely to break. Note any lens you drop and why.

   For the spawned lenses, don't branch on a returned summary (see **Subagent results: trust files over returns**); confirm the file exists instead. **Self-heal a stalled lens:** if a spawned lens's file is missing after it reports complete, `SendMessage` that agent to write its findings file as its final action, marking anything unconfirmed `PLAUSIBLE`, rather than re-spawning it from scratch. Once every lens file is present (the spawned lens files plus the inline-gate files you wrote: code-review, and the project gate if you ran one), read them (N from state.json) and move to triage.
2. **Triage & merge.** Consolidate the findings across lenses yourself: drop false positives, de-duplicate overlaps, and resolve contradictory suggestions. Don't spawn a separate agent for this. Every lens emits the shared finding shape, so merge on `file:line`: two lenses landing on the same anchor is a **convergence signal**, and independent lenses pointing at one spot raise confidence rather than being noise, so weight those up instead of collapsing them to a lone finding. As a backstop for anything the lenses re-raised despite being told not to, drop findings already in `.speccy/<run-id>/deferred.md`; a deferred finding must not churn back into the fix set. Then give each surviving finding a disposition:
   - **Fix**: route it to the fixer this round. Where the finding is a copied smell, tell the fixer whether to diverge (fix cleanly here) or fix wider (also fix the existing instance); a wider fix grows the diff, so choose it deliberately.
   - **Defer**: legitimate but out of scope for this PR, meaning one of three things: it isn't this slice's code, it needs a decision only the user can make, or it is genuinely larger than the slice. Append it to `.speccy/<run-id>/deferred.md` under `## Deferred by scope`: what, and why deferred.

   **Diff size is not a reason to defer.** A real finding with a cheap fix is dispositioned Fix however many others share its shape. The review attention a small diff protects was already spent on finding them, so deferring saves nothing and ships a defect you have already written down; the fix costs a subagent's context rather than yours. (Observed alongside this: where an independent review followed, it rediscovered the deferred batch and fixed it on the same branch, so the diff arrived at its full size having been reviewed twice.) A fix that genuinely is wide is the deliberate fix-wider call above rather than a deferral.

   A suppression finding is effectively never Defer: remove it or make it watertight, this round. **Exit the loop when nothing is dispositioned Fix.**

   You make these disposition calls yourself as the loop runs; the review is autonomous. But surface them to the human at wrap-up so they still review the judgment: deferrals in the deferred list, and any divergence-from-pattern or wider-than-the-diff fix in the summary and decision log.
3. **Fix.** If nothing is dispositioned Fix, skip to the next round's review (or exit). Otherwise read `prompts/implementation-fix.md` and spawn a fix subagent with that prompt, the Fix findings (point it at the lens files, and state any diverge / fix-wider instruction), the spec path, and the plan path. It makes the changes and commits.

   **The fixer runs on sonnet.** A triaged finding names the defect and its location, so applying it is execution against a written instruction, which sonnet does faster and no worse. `builderModel` does not govern this: a build raised to opus for its novelty says nothing about the difficulty of applying a finding, and inheriting it would put every fix round on the slower tier for the rest of the run.

   Raise a batch to opus on evidence rather than on how serious its findings look. Two cases qualify: a later round found the previous fix broken or regressive in this same area, so sonnet has already been tried and failed here; or the finding establishes that the current shape is wrong without stating the right one, leaving the design call to the fixer. Name the batch you raised and why in the round's report: with the choice free each round, an unexplained opus batch is where this drifts back to "opus for anything that looks hard".

   **Split a large fix set across a series of agents.** One agent carrying thirty findings across twenty files degrades as it goes: the last findings get the thinnest attention, and a fixer running short of room compensates by taking the cheap ones and reporting done. Group the findings into coherent batches (by area or layer reads better than by count) and spawn a fresh agent per batch, each with the same prompt and its own findings. Run them **strictly one after another, never in parallel**: they share a working tree and an index, so concurrent fixers race on the same files. Each commits its own batch before the next starts.

   After the last fix agent commits, re-run the load-bearing gates yourself and confirm the actual output before the next round; never advance on a fix agent's claim that the gates pass. (Gates passing doesn't prove coverage held; a dropped test still passes.)

After 3 rounds, proceed regardless. Update state.json after each round (`reviewRounds`).

**Exit checks.** Confirm each before leaving this phase (a resumed context has only what's on disk):

- every finding still dispositioned Fix when the cap hit is in `.speccy/<run-id>/deferred.md` under `## Unaddressed at the round cap`, with the reason. These are not deferrals (the panel judged them in scope and the rounds ran out), so the heading is what lets the wrap-up report them as unfixed rather than as future work.
- `reviewRounds` is current
- `phase` is `"wrap-up"`, never `"complete"`. The wrap-up hasn't run yet, and `complete` is what tells a resumed session there is nothing left to do.

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
**Exit checks.** Only once all of these hold, set `phase: "complete"`:

- `.speccy/<run-id>/summary.md` is written
- `specs/<slug>-decision-log.md` is written and committed
- all three kinds of unaddressed feedback are reported: deferred by scope, skipped at spec critique, and unaddressed at the round cap
- the retrospective is saved, if the task execution skill produced one

Set `complete` any earlier and a `/clear` during the wrap-up resumes as a finished run, silently dropping the decision log and the retrospective: the artifacts the handoff exists to produce.

**Last, after `complete` is set: what the run cost.** Run the metrics script from this skill's own directory by its **absolute path**, the same way the banner runs (no `cd`, no command substitution, or the pre-approved permission match breaks).

```bash
bash <skill-dir>/metrics.sh
```

It reads the harness transcripts and writes `.speccy/<run-id>/metrics.md`: wall and active time per phase, tokens by model and reasoning effort, and a per-agent table. Report the headline in chat, a line or two at most (where the wall time went, which phase carried the tokens, anything the script flagged), and point the user at the file.

Everything you need to say that is already in the output: the phases, the run total, and the **Notes**. Summarise from what it printed and **don't open `metrics.md`** — the per-agent table is most of the file, nothing asks you to summarise it, and reading it back spends the context this step is written to protect.

Pass on what the Notes say. They flag phases the reader could not tell apart, work it excluded as belonging to something else, and any agent whose model override did not take effect. Those change how much the numbers are worth.

This step is deliberately outside the exit checks and runs after `complete`, not before it. The measurement is a nice-to-have and must never stand between the user and a finished run: nothing here can fail in a way that leaves the run looking unfinished. It also reads a truer timeline, because `complete` is what closes the last phase. The cost is that a `/clear` in the gap loses the report; `bash <skill-dir>/metrics.sh <run-id>` recovers it later from whatever the transcripts still hold.

The script never blocks: no `node` on `PATH`, no transcripts, or a pruned run all print one line and exit. If it skips, say so in a clause and move on. Measurement happens after the run rather than during it because nothing in a live session tells the orchestrator its own token usage; a figure written mid-run would be invented.

If the pipeline exited early (implementation failure), report what's done and what remains. The user has a branch with partial progress.
