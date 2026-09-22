---
name: speccy
description: Guided specification writing, adversarial spec critique, and post-build review. Full pipeline from rough idea to reviewed implementation.
when_to_use: When the user says "speccy", "spec mode", "adversarial mode", or similar. Also when about to execute a complex multi-step plan and adversarial critique would help.
allowed-tools: Bash(bash *skills/speccy/banner.sh), Bash(bash *skills/speccy/metrics.sh), Bash(bash *skills/speccy/metrics.sh *), Bash(node *skills/speccy/state.mjs *), Read(.speccy/**), Write(.speccy/**), Edit(.speccy/**)
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

- **Spec and plan critique**: the adversary runs on opus every round, up to 3 rounds. These are short, high-leverage artifacts where cheaper tiers cost more in false-positive triage than they save. The revise agent and readability pass inside each loop run on sonnet: each executes a written instruction.
- **Implementation review**: parallel review lenses, up to 3 rounds (see Phase 4). The four judgment lenses (spec fidelity, tests, codebase fit, local-doc adherence) run on opus, and the suppressions and comments lenses on sonnet; the built-in `code-review` skill runs alongside them at `high` effort and manages its own models.
- **Builder** (execute/integrate/verify inside plan-execution): sonnet; plan-execution's breakdown agent always uses opus.

Two overrides: pin a single adversary model (`adversaryModel`), then used for every critique round and review lens; and raise the builder (`builderModel`), commonly to opus for high-stakes work.

Each loop restarts at round 1 and exits early when a round surfaces no valuable criticism (the spec and plan loops first run one more round to check the readability pass; see 1d and 2a).

If the user's trigger message already includes a description of what to build, skip straight to the adversary model note and proceed to the precondition check and Phase 1 (`phases/spec.md`; see **Phase dispatch**).

## Resuming a run

Run state lives at `.speccy/<run-id>/state.json`, written after every phase boundary by `state.mjs`, its **only** writer. You read it directly with the Read tool (resume, the round number N, prior engagement questions, the models, whether a readability pass has run) and never hand-write it. Its fields: runId, slug, baseBranch, adversaryModel, builderModel, phase, specPath, planPath, decisionLogPath, the three round counters, readabilityPasses, engagementQuestions. The schema is closed; the CLI rejects anything else.

Run the CLI by its **absolute path**, `node <skill-dir>/state.mjs <verb> --run <runId> …` (the same literal-path, no-`cd`, no-substitution rule as the banner; `--run` is required on every verb). It writes loudly: a bad transition or an unmet guard prints the reasons and exits non-zero, leaving state untouched, and every call prints the phase you land in and a one-line hint at what comes next. Each phase below gives the exact call to make; you never need `--help`.

The pull to add a field comes when a decision lands and the artifact hasn't caught up. Write it to the artifact then and there:

- A user ruling, override, or ratification goes to **Decisions & rationale** in the spec or plan, with its Origin tag. An origin flip edits that entry.
- A spike's result goes to its spike file, folded into the spec before the next critique round.
- A constraint or environment quirk goes to the spec's **Constraints** if it belongs to this feature, `CLAUDE.md` if it belongs to the project.
- A tension to put to the critic goes to the spec's **Assumptions** or **Open questions**, where the critique loop reads it.
- A correction still to apply gets applied. Parked in state, it stays unapplied.
- How a decision was reached goes to the decision log, which exists from 1c onward for exactly this (see **The decision log runs with the run**).

What remains is genuinely transient: the user is mid-read, a precondition passed an hour ago, an agent is running. That dies with the context by design, and a resumed run re-checks or asks.

`adversaryModel` defaults to `"opus"`: the tier for every critique round and the review panel's judgment lenses (the suppressions and comment lenses run a tier below; see **Getting started**). If the user pinned a different adversary model, store that name here instead and use it for every critique round and review lens.

On trigger, read `.speccy/.current-runid`, a pointer to the most recent run written when the run is created (see Phase 1c). If it exists, Read that run's `state.json`; if `phase` is not `"complete"`, surface the run to the user and ask whether to resume or start fresh. To resume, Read the phase file the recorded phase maps to (see **Phase dispatch**), read the artifacts state.json references (spec, plan, latest critique round), and continue from the recorded phase.

state.json names the spec, plan, and decision log, and no other file. **List `.speccy/<run-id>/` to see what else the run produced** — earlier rounds, spikes, readability change notes, deferred findings — and read what the phase you are resuming into needs.

**When an artifact is replaced, rename what reviewed it.** A re-plan leaves its critique rounds and readability change notes describing a draft that no longer exists, and a resumed context reading one cold will act on findings that no longer apply. For a re-plan, `state.mjs replan` does this: it renames the plan-review files to `SUPERSEDED-<original name>` (a spike verdict is evidence about the world rather than a review of a draft, so it keeps its name). They remain the run's history, grouped in a listing, and the wrap-up reads them for a reversal nobody logged, so they are renamed rather than deleted.

A resumed run skips the precondition checks, so if the recorded phase is `spec-critique` or later, suggest auto-accept mode (shift+tab) first: the rest of the run is autonomous tool calls. A resume at `spec-draft` just re-presents the draft for reading, so it needs no such nudge.

After completing each phase, `state.mjs advance` to the next and continue. The user can `/clear` and re-invoke the skill at any point to resume from the recorded phase; no need to ask permission at phase boundaries.

Read `.speccy/` artifacts with the Read tool and write run artifacts (spec, engagement-question files, review notes) with the Write tool; both are pre-approved in `allowed-tools`, as is `state.mjs`, so none prompt. `state.json` itself is written only through `state.mjs`, never by hand. Do **not** rely on the Glob tool: it isn't available in every session, which is why run discovery uses the `.current-runid` pointer. The pointer tracks the latest run; earlier runs remain in `.speccy/` if the user wants to revisit one.

## Preconditions

Before running any of the checks below, suggest the user enable auto-accept mode (shift+tab). From here to the end of the run the work is mostly tool calls (the verification smoke-test runs the project's linters and tests, then planning, critique, implementation, and review run autonomous loops), so approving each one by hand is pure friction. The spec interview is a conversation regardless, so auto-accept doesn't take any decisions away: the user still reviews and edits the spec content directly.

### Reasoning effort

Every subagent inherits the session's effort, and speccy spawns dozens of them: critics, revise agents, a planner, the review lenses, the fixers, and the whole build. At `xhigh` or `max` that multiplies across the pipeline and the run takes far longer.

```bash
echo "${CLAUDE_EFFORT:-$(grep -o '"effortLevel"[^,]*' ~/.claude/settings.json 2>/dev/null | cut -d'"' -f4)}"
```

If that prints `xhigh` or `max`, say so and suggest dropping to `high` in `/effort` before starting. It is the user's call, since this costs time rather than correctness. If it prints nothing, say nothing: an unreported effort is not a low one.

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

**Pass `prompts/tool-use.md` to every subagent speccy spawns**, plan-execution's build agents included. Like the writing-style rule above, it applies at every spawn site in the phases below and is stated once here rather than repeated at each, with the same two exceptions: the built-in `code-review` skill and any project review gate manage their own prompts.

## Steering away from cognitive surrender

speccy's own output is the hazard. Adversarially-hardened specs and plans read as authoritative, and the more authoritative they read, the stronger the pull for the user to approve without understanding (cognitive surrender: borrowed confidence, surface correctness hiding deeper flaws). The pipeline already hardens its artifacts. These habits guard the user's engagement, which nothing else does.

Apply these habits at the run's three human gates and nowhere else: the spec critique (1d), the plan review (2b), and the wrap-up decision log (Phase 5). The other interactive moments are not gates, so pose no pre-question there: the intake and interview gather requirements, the first-draft review (1c) is the user's turn to read and edit, and the build kickoff (Phase 3) is a handoff. The pre-question in particular assumes the user has read the artifact and is about to see it critiqued; asked before a draft is read, or after a decision is already made, it has no referent and reads as the ritual this section exists to prevent. The three habits:

- **Ask before you tell, then reveal.** Before showing the agent's findings, have the user commit a *prediction* rather than an open judgment: the one thing they'd bet the critique flags, or the part they'd defend least confidently. An open "where is it weakest?" is too easy to shrug off; predicting forces the user to build their own model of the artifact first, which is the anti-anchoring point. If they genuinely have nothing, offer to look together at one thing *you* find risky, but only if a real one exists (many artifacts are straightforward; don't manufacture one). Draw it from your own read rather than the critique you are holding, which would leak the critique early. Then when you present the critique, close the loop against their prediction: "you expected X; it flagged Y. Surprised?". The consequence is what makes the question land; without the reveal it decays to a shrug.
- **Flag doubt; stay quiet about certainty.** Surface where the agent is unsure and what it assumed. Never offer high confidence as a reason to skip review, since a confident wrong call adopted wholesale is the worst outcome. Point the user's attention at the doubtful parts and let the settled ones pass.
- **Name what convinced you.** A recorded decision reaches this point one of three ways (its **origin**), and each wants a different touch. **(1) speccy, user-agreed**: speccy proposed it and the user agreed at a gate. This is the borrowed-confidence zone, and what this whole habit is built for. Ask what persuaded them, and whether they verified it or simply trusted that the agent sounded sure. **(2) User**: the user made the call themselves, so don't run the borrowed-confidence check on it. If the rationale is clear and recorded, or the call is plainly right as far as you can tell, let it stand; re-quizzing someone on reasoning they've already given is the empty ritual this section exists to prevent. But if it rests on a hunch with no clear reason you can see is right, challenge it on its merits. That is speccy doing its job rather than skipping it. **(3) speccy, alone**: speccy decided it autonomously, with no gate for the user to sign off (a plan-critique revision, a review disposition). The user never agreed to it, so the borrowed-confidence check has no referent. Surface only the **load-bearing** ones (a call that shapes the design, or one the user would want to own) as speccy's own now sitting in the spec or plan, and invite the user to check they agree and could justify it. Judgement governs hard here: a small or trivially-correct autonomous call speccy can stand behind doesn't need raising, and burying the user in autonomous-call checks trains them to tune speccy out, the disengagement this section fights. Keep the probing to one decision per gate, so it reads as a self-check rather than an interrogation.

**Origin flips as the user engages.** When speccy surfaces a *speccy, alone* decision and the user ratifies it, re-tag it *speccy, user-agreed*; if they override or reshape it, re-tag it *User*. Record the flip in the artifact, so a later gate or the wrap-up doesn't re-surface a call the user has already owned. (Challenging a *User* hunch is different: if the user then gives a clear reason, it stays *User*, now with its rationale recorded.)

Ask these as ordinary questions inside the flow of the gate; never announce that you're doing them and never give them a label to the user (no "engagement check", no "cognitive surrender"): a prompt flagged as a check gets performed rather than thought about. A user who would rather not be asked can simply decline, or say so at the start; honour that, and you need not advertise the possibility.

**Vary the questions across gates.** The job repeats at each gate but the wording must not: the same pre-question framing heard three times decays into a ritual the user pattern-matches and shrugs past, which is the ritualization this whole section fights. Before posing a pre-question or a "what convinced you", read `engagementQuestions` from state.json to see what earlier gates already asked, and come at this one from a fresh angle (a different referent, a different way in) rather than reciting the template. After you ask, write a short paraphrase of what you actually posed to a file and record it with `state.mjs engagement-add --run <id> --gate <gate> --from-file <path>` (the text goes through a file, never a flag). The list starts empty and survives a `/clear`, so a resumed context still knows what framings are spent. The point is to avoid repeating yourself, and it never demands perfect wording: the engagement comes from the loop, and variation only keeps the loop from going stale.

**Each of these questions is a stop.** Ask it as the last thing in the turn and wait: the question fails precisely when the orchestrator asks, then keeps thinking and running tool calls until it scrolls off unanswered. Nothing follows the question until the user replies, and a pre-question never reveals the critique in the same turn (which would pre-empt the answer and lose the anti-anchoring). Put it on its own line at the end of the reply.

**The long idle stretches are the other good moment.** The autonomous phases (plan critique in 2a, the build in Phase 3, the review panel in Phase 4) leave the user waiting on a subagent for a long while. That idle time engages well with a different device from the gate habits: an offer to deepen understanding rather than a pre-question, since there is no artifact to predict yet. Offer to walk through how a part of the system works relative to what's being built, or raise an implementation detail the plan left open and ask whether the user has a preference. Only when there's something genuine to say; manufactured filler trains the user to tune speccy out. Two rules keep it from backfiring, and both invert the gate question's "stop":

- **It never blocks.** The job runs regardless, and a completion that lands mid-conversation is surfaced at once. The chat is opportunistic filler and never a reason to sit on a finished job.
- **Any steer feeds forward**, into an upcoming task or the review; never expect the running build to have already adopted it. A preference that would change approved scope is a re-plan rather than a mid-build aside.

Apply the same standard to the final diff: read it as if a contributor you do not fully trust wrote it.

## Phase dispatch

The phase bodies live in one file each, under `phases/` (relative to this SKILL.md's directory). The core above (getting started, resuming, preconditions, the state CLI contract, and every **bold** cross-cutting rule) is always loaded; the phase files layer on top. So a run that `/clear`s at a boundary reloads this core plus only the phase it is resuming into.

**When you enter or resume into a phase, Read its file before acting.** Map the `phase` in state.json to a file:

| `phase` in state.json | Read |
| --- | --- |
| `spec-draft`, `spec-critique` | `phases/spec.md` (Phase 1) |
| `planning`, `plan-critique`, `plan-review` | `phases/plan.md` (Phase 2) |
| `implementation`, `review`, `wrap-up` | `phases/build.md` (Phases 3–4 + wrap-up) |
| `complete` | none; report and run metrics (see `phases/build.md`, wrap-up) |

A fresh run starts at `spec-draft`, so read `phases/spec.md` once the precondition checks pass. Each file ends by naming the next, so you know which to load when a phase hands on. This extra Read is the point: it keeps a phase's detail out of context until the phase needs it.
