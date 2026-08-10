---
name: speccy
description: Guided specification writing, adversarial spec critique, and post-build review. Full pipeline from rough idea to reviewed implementation.
when_to_use: When the user says "speccy", "spec mode", "adversarial mode", or similar. Also when about to execute a complex multi-step plan and adversarial critique would help.
allowed-tools: Bash(bash *skills/speccy/banner.sh), Read(.speccy/**), Write(.speccy/**), Edit(.speccy/**)
---

# Speccy

Full pipeline: specification → spec critique → planning → plan critique → implementation → implementation review.

The orchestrator runs in the main conversation. Heavy work goes to subagents — critiques, planning research, revisions, the build, code review — so the main context stays small. State lives in files. The run can pause at any phase boundary, be `/clear`ed, and resume.

## The cycle

Six stages run in order. Three human gates decide; three return routes fold work back.

```
0 environment → 1 spec → 2 plan → 3 build → 4 review → 5 wrap-up
                  │ 1d       │ 2b     (triage)   (gate)      (retro)
                  └ revise   └ revise   └ amend    └ batch
                    loop       loop      & resume    at gate
```

Timeline label ↔ `state.json` phase enum — the human diagram and the machine enum, reconciled once so neither is guessed from the other:

| Timeline label | `state.json` phase enum |
|---|---|
| 0 environment | *(none — pre-run)* |
| 1 spec | `spec-critique` |
| 2 plan | `planning` → `plan-critique` |
| 3 build | `implementation` |
| 4 review | `review` |
| 5 wrap-up | `wrap-up` → `complete` |

The enum order is not the timeline order. `planning` is the plan-research phase of stage 2, set when the spec-critique loop exits — so it maps to plan, not spec. Preserve that mapping; do not renumber it to match.

Stage 0 (environment) is pre-run. It finishes before the run dir exists, has no enum value, and resume can never point at it. It is a timeline label, not a resumable phase.

## Return model

Work folds back three ways, one per stage that can reject:

- **Critique-loop revise** — the spec (1d) and plan (2a) critics feed a revise agent; the loop re-runs until a round is clean or the 3-round cap hits.
- **Build amend-and-resume** — a completion-time deviation that falsifies a plan premise amends the plan, then re-runs plan-execution over the remaining un-integrated tasks.
- **Review batch-at-gate** — `design` and `requirements` findings never fix mid-round; they batch into the decision queue that one post-review gate clears.

**Anti-nesting rule — depth stays 1.** A return route revises the current run in place. It never spawns a nested sub-run. A discovery too large for this run is recorded — deferred, with a decision-log entry — and becomes a *sibling* run on the user's call, never a nested one. Every return route obeys this, including the build's requirements-level deviation gate.

## Getting started

Show the Speccy banner first, on every invocation. Run `banner.sh` from this skill's own directory, by its absolute path — a relative path breaks when the Bash cwd has drifted or the skill is installed as a plugin. Do not prepend `cd` and do not use command substitution; both break the pre-approved permission match.

```bash
bash <skill-dir>/banner.sh
```

The script prints two Markdown lines. Reproduce them verbatim at the top of your reply — that is what the user sees. Running the script alone is not enough; its tool output is hidden by default.

The banner is cosmetic. If the script fails or would prompt, proceed without it. Never block the run on it.

Then check for an in-progress run (see **Resuming a run**). If one exists, offer to resume before starting fresh.

For a new run, print the compact cycle diagram (from **The cycle**) right after the banner, then introduce the skill in one sentence: it walks from writing a spec, through independent critique, to a built and reviewed implementation. Then ask two things in one turn:

1. **Walkthrough or start?** The user can ask for a walkthrough of the process, or describe what they want to build and start. The walkthrough explains each phase in a few sentences, organised by what the user does versus what runs autonomously:
   - **Environment** (autonomous, non-blocking) — a quick probe of the project's own skills, agents, governing docs, and past run records; it never blocks and just primes every later phase.
   - **Spec** (interactive) — an interview builds a structured spec; the user reviews and edits until satisfied.
   - **Spec critique** (user-in-the-loop) — an independent reviewer critiques the spec each round; the user decides what to incorporate, and every finding is dispositioned on the record.
   - **Plan** (autonomous loop) — a subagent researches the codebase and drafts a plan; a reviewer critiques and a revise agent applies findings until the plan is clean.
   - **Plan review** (user decides) — the user reviews the hardened plan, raises concerns, approves.
   - **Implementation** (autonomous loop) — the build follows the plan. On completion, reported deviations are triaged before review. Parallel reviewers then check the code across several lenses: correctness and quality via the built-in `code-review` skill, a generalized security lens, the repo's own review gate when it ships one, plus spec fidelity, plan adherence, tests, codebase fit, local-doc adherence, strict scrutiny of suppressions, and a comments pass. `code` findings are fixed in-loop; `design` and `requirements` findings batch into a decision queue.
   - **Wrap-up** — one gate clears the decision queue, then a summary, a co-authored decision log, and a retrospective with ready-to-apply improvement drafts. The user reviews the final diff on the branch.

   Also mention: state is saved at every phase boundary, so the user can `/clear` and re-invoke at any point to resume with a fresh context. Useful for long runs where the conversation has grown.

2. **Defaults you can change.** Flag the per-phase model defaults below and that they are overridable. Don't ask — just flag that the options exist.

Per-phase model defaults:

- **Spec and plan critique** — opus every round, for both the adversary and the revise agent, up to 3 rounds. These artifacts are short and high-leverage; cheaper tiers cost more in false-positive triage than they save.
- **Implementation review** — parallel review lenses, up to 3 rounds (see Phase 4). The judgment lenses — spec fidelity, plan adherence, security, tests, codebase fit, local-doc adherence — run on opus; the suppressions and comments lenses run on sonnet. Security runs every round and is never dropped. The built-in `code-review` skill runs alongside at `high` effort and manages its own models.
- **Builder** — sonnet, for execute/integrate/verify inside plan-execution. Plan-execution's breakdown agent always uses opus.

Two overrides: pin a single adversary model (`adversaryModel`), then used for every critique round and review lens; and raise the builder (`builderModel`), commonly to opus for high-stakes work.

Each loop restarts at round 1 and exits early when a round surfaces no valuable criticism.

If the trigger message already describes what to build, skip straight to the model note, then the precondition checks, then Phase 1.

## Resuming a run

Run state lives at `.speccy/<run-id>/state.json`, written at every phase boundary. Schema:

```json
{
  "runId": "auth-refactor-20260609-1430",
  "slug": "auth-refactor",
  "baseBranch": "develop",
  "adversaryModel": "opus",
  "builderModel": "sonnet",
  "phase": "planning" | "spec-critique" | "plan-critique" | "implementation" | "review" | "wrap-up" | "complete",
  "specPath": "specs/auth-refactor.md",
  "planPath": ".speccy/auth-refactor-20260609-1430/plan.md",
  "capabilitiesPath": ".speccy/auth-refactor-20260609-1430/capabilities.md",
  "deviationsPath": ".speccy/auth-refactor-20260609-1430/deviations.md",
  "specDispositionsPath": ".speccy/auth-refactor-20260609-1430/spec-dispositions.md",
  "decisionQueuePath": ".speccy/auth-refactor-20260609-1430/decision-queue.md",
  "buildFrictionPath": ".speccy/auth-refactor-20260609-1430/build-friction.md",
  "specCritiqueRounds": 1,
  "planCritiqueRounds": 0,
  "reviewRounds": 0,
  "engagementQuestions": [
    { "gate": "spec-critique", "asked": "the finding you'd bet the reviewer raises" }
  ]
}
```

The five pointers name the run-record files: the held capability manifest, the three append-only records (`deviations.md`, `spec-dispositions.md`, `decision-queue.md`), and the build-friction synthesis (`build-friction.md`, written by Phase 3). Each is written when its stage first needs it; until then the pointer's file does not exist. `wrap-up` is a resumable phase between `review` and `complete` — see **Wrap-up**, where `complete` is set only at the very end.

`adversaryModel` defaults to `"opus"` — the tier for every critique round and the review panel's judgment lenses. The suppressions and comment lenses run a tier below; see **Getting started**. If the user pinned a different adversary model, store that name here and use it for every critique round and review lens.

On trigger, read `.speccy/.current-runid` — a pointer to the most recent run, written when the run is created (Phase 1c). If it exists, read that run's `state.json`. If `phase` is not `"complete"`, surface the run and ask whether to resume or start fresh. When you surface it, print "you are here: <phase>" — map the phase enum to its timeline label from **The cycle**, so the user sees where the loop picks up. To resume, read the artifacts state.json references — spec, plan, latest critique round — and continue from the recorded phase. A resumed run skips the precondition checks; if the recorded phase is past the spec interview, suggest auto-accept mode (shift+tab) first, because the rest of the run is autonomous tool calls.

Re-read the four run-record pointers on resume — `capabilitiesPath`, `deviationsPath`, `specDispositionsPath`, `decisionQueuePath` — and `buildFrictionPath` once Phase 3 has written it (the persisted build-phase friction synthesis the wrap-up retro consumes). The three append-only records are read whole, not by round. A pointer whose file does not exist yet reads as empty — "nothing there", never a crash. Two phases resume into mid-stage work rather than the next stage:

- `phase == "implementation"` with a present `deviations.md` resumes into the completion-time deviation triage (Phase 3 tail), not Phase 4.
- `phase == "wrap-up"` resumes at the decision-queue gate, not at `complete`. A `/clear` during that gate must never resume as finished — that is why `complete` is set only after the gate and the wrap-up artifacts clear (see **Wrap-up**).

After completing each phase, update state.json and continue. The user can `/clear` and re-invoke at any point to resume from the recorded phase — do not ask permission at phase boundaries.

Read and write `.speccy/` state with the Read/Write tools; these paths are pre-approved in `allowed-tools`, so they won't prompt. Do not rely on the Glob tool — it isn't available in every session, which is why run discovery uses the `.current-runid` pointer. The pointer tracks the latest run; earlier runs remain in `.speccy/` if the user wants to revisit one.

## Preconditions — Stage 0 (environment)

**Gate.**
- Entry: a clean tree on the intended base branch; the trigger message in hand.
- Exit — all must hold:
  - [ ] verification tooling smoke-tested
  - [ ] the capability manifest held
  - [ ] worktree init resolved
  - [ ] the base branch noted
- ↩ never blocks — an empty probe degrades to the generic path; a source conflict defers to 1c, not here.

Stage 0 is pre-run: it completes before the run dir exists and has no resumable phase (see **The cycle**), and all its moves are strictly non-blocking.

Before the checks below, suggest the user enable auto-accept mode (shift+tab). From here to the end of the run the work is mostly tool calls: the verification smoke-test runs the project's linters and tests, then planning, critique, implementation, and review run autonomous loops. Approving each call by hand is pure friction. The spec interview stays a conversation either way, so auto-accept takes no decisions away from the user.

### Verification tools

Check that CLAUDE.md documents the project's verification tools: build, lint, static analysis, test commands. Execute agents run them to validate their work. If they're missing, tell the user before proceeding — verification standards are project setup, not something to discover mid-build.

Documented is not the same as working. Smoke-test the tooling now, on the clean tree, before investing in spec and plan — a broken verification setup discovered at implementation has already cost a spec, several critique rounds, and a plan. Run each documented command once. Confirm it completes, passes (or note its baseline failures), and returns in reasonable time. Surface anything that hangs, errors, or floods output before proceeding.

### Project capabilities

Discover the project's own capabilities now and hold the manifest: skills, specialized subagents, governing docs, explicit routing hints, past-run artifacts (prior specs, decision logs, retros), and ADRs. The manifest also carries a **working-configuration** section — which skills or agents serve which phase, which checks are mandatory, and any source-priority ordering. See **Lead with the project's own capabilities** and `prompts/project-capabilities.md` for the manifest shape and what each phase uses. This is discovery only — it never blocks, and a project that exposes none of it just runs the generic pipeline. Doing it before the spec means every downstream phase reads one manifest instead of re-probing. The run directory doesn't exist yet, so hold the manifest in context; persist it to `.speccy/<run-id>/capabilities.md` when the run is created in Phase 1c.

Stage 0 records the raw sources and detects no conflict — the task area does not exist yet. The manifest's mandatory facts flow through three moves: **Stage 0 records**, **1c transmutes** each mandatory fact into a task-specific Constraint or Criterion and detects conflicts against the drafted scope, and **1d adjudicates** any conflict the critic surfaces. A detected conflict enters the spec as an Open question; it is never silently merged and never blocks at Stage 0.

### Worktree init

Worktrees matter only for **parallel** tasks. Plan-execution runs sequential tasks on the main checkout; only parallel tasks get git worktrees, which lack gitignored state. Whether the plan produces parallel tasks is unknown until breakdown, so treat this as preparation that may go unused. Check whether CLAUDE.md has a `## Worktree init` section with gather/apply blocks. If it does, nothing to do — plan-execution will use it.

If the `worktree.baseRef` setting or the `## Worktree init` section is missing, do NOT stop, prompt for a hand-authored section, or silently force the run sequential. Resolve a default in-skill and carry on:

- **`worktree.baseRef` missing** → ensure it is `head`. Write it to `.claude/settings.json` via Bash/python; direct Edit is blocked. The default `fresh` branches from `origin/<default-branch>` and misses feature-branch commits. Plan-execution also self-heals this, so it's belt-and-suspenders.
- **`## Worktree init` section missing** → synthesize a minimal default from `.gitignore` plus the verification commands. Almost every project's worktree just needs its gitignored dependency and config artifacts linked in from the main checkout. Build a `worktreeInit` array that idempotently symlinks those (`ln -snf <main-checkout>/<dir> <dir>`) — at minimum the package-manager install dir the verify commands need (`node_modules`, `.venv`, `vendor`, `target`, …) plus any generated config the verify step reads. Pass the array straight to plan-execution as `worktreeInit`. Resolve `<main-checkout>` with `git rev-parse --show-toplevel` at gather time.
- **Dependency dirs genuinely undeterminable** — no recognizable lockfile or manifest, opaque build → fall back to instructing breakdown to stay sequential-only, and say so.

In every case, after resolving the default, offer the user the drafted `## Worktree init` block to commit into CLAUDE.md so next time it's explicit. That is an after-the-fact convenience, never a blocker.

A purely sequential plan never touches worktrees, so a sequential-only project exercises none of this. The default above means a fan-out run is never blocked on a missing section.

### Git state

Before starting work:

1. Run `git status --porcelain` — if the working tree is dirty, tell the user and stop.
2. Run `git branch --show-current` — note the current branch. This is the **base branch** for the rest of the pipeline.
3. If not on the main branch, confirm with the user that the current branch is the intended base. Proceed on whatever they confirm.

## Formatting

Use bullet lists and unnumbered headings by default. Reserve numbered lists for sequences where order is the point: steps that must run in a specific order, or items referenced by position. If inserting or removing an item forces renumbering, it shouldn't have been numbered.

This applies to all generated artifacts: specs, plans, critiques, and review notes.

## Record-file format

Three run records share one format: `spec-dispositions.md`, `decision-queue.md`, `deviations.md`. Each is:

- a fixed filename under `.speccy/<run-id>/` — no per-round suffix;
- append-only — a new round appends its entries; nothing overwrites a prior round's;
- one entry = a single-line header plus a few detail lines. The header carries a stable id, the source (round N, lens, or task id), and a disposition slot;
- absent or empty is a valid state — it reads as "nothing yet", never a crash.

Each call site below names only its own header specifics against this format. This wording is canonical; `plan-execution`'s `prompts.md` carries one compact restatement of it, marked as such.

Secrets rule: every file under `.speccy/<run-id>/` and every review finding names secrets, never quotes their values — the same rule the spec and plan carry.

## Base-branch drift check

One check, invoked by name at two points. Fetch the base branch's remote — `git fetch` — then compare the local base against `origin/<base>`: `git log <base>..origin/<base>` for incoming commits, plus `git status --porcelain` for a dirty tree. Substantial drift — an unexpected upstream commit, a rebased base, a dirty tree — means the run's floor has shifted; tell the user rather than pressing on. Phase 3 and Phase 4 each invoke this by name with its own consequence.

## Subagent results: trust files, not returns

Subagents run in the background, and their completion notifications are unreliable. A returned summary can arrive misrouted under a different agent's completion. The notification's apparent identity — which agent, which round — can be wrong; a round-3 critique may surface labelled as the round-2 revise agent. This is expected harness noise.

For every spawned agent you know what it was spawned to do and the exact file it writes, and the round number comes from state.json, not the notification. When a completion arrives, read that file and act only on its contents. Never branch control flow — early-exit, round counting, commit messages, what you tell the user — on a returned summary or a notification's label. Don't narrate or diagnose misrouting; read the right file and carry on.

## Propagate the session's voice to subagents

The main session may be governed by a style a fresh agent does not inherit: a house-voice hook injected at session start, a configured output style, or communication conventions beyond the project's `CLAUDE.md`. A subagent starts clean and never sees the main session's system prompt. Unless you carry the style across, every critic, planner, review lens, and fixer speaks in a default voice — and the artifacts they write read in a different register from the rest of the run.

So before spawning any subagent, restate the active style concisely at the top of its prompt — enough that its reasoning and its written output match the session's voice. Two things need no carrying: conventions already in `CLAUDE.md` (subagents read it anyway), and the built-in `code-review` skill run inline (it manages its own prompt; the orchestrator applies the session's voice when normalising its findings into the lens file). This rule covers every spawn site in the phases below; it is stated once here. Speccy's own narration to the user follows the same style as a matter of course.

## Lead with the project's own capabilities

A project often ships capabilities that beat speccy's generic defaults for this codebase: **skills** (house conventions, domain rules, verification harnesses), **specialized subagents** (read-only research or "hunter" agents that answer where-does-this-live, how-does-X-work, does-Y-already-exist — plus the project's own review agents), **governing docs** (CLAUDE.md and what it points to), and sometimes an explicit **review gate**. A generic pipeline that ignores these re-derives, worse, what the repo already maintains — and catches the divergence only at review, a whole fix-round late. So discover them once, up front, and prefer them at every phase.

Nothing here is required. Every signal is optional, and its absence degrades cleanly to the generic path. Do not depend on any one artifact existing — there is no mandatory config file. Probe whatever the project actually exposes.

**Discover once, as a precondition.** Probe in layers, only what the project has:

- **Skills** — the skills available in this session. Each self-describes its trigger in its own description ("use when …").
- **Specialized subagents** — read `.claude/agents/*.md` and any subagent types this session offers. From each one's description and tools, tag it *research* (read-only: answers where / how / exists), *reviewer* (a project review agent), or *other*. Note read-only versus mutating.
- **Governing docs** — CLAUDE.md / AGENTS.md and the docs they point to.
- **Explicit routing hints, opportunistic** — a skill→area map the project happens to expose: a `.claude/review.config.json`, a skills table in CLAUDE.md, zone globs in a skill's frontmatter. Keep it as an accelerator. Its absence changes nothing.

Record the result in `.speccy/<run-id>/capabilities.md` so it survives a `/clear` and every phase reads one manifest. Found nothing? Record that and run the generic pipeline unchanged.

**Route by relevance — no map needed.** Skills self-describe their triggers, so the default router is judgment: match the task in front of a subagent to the skills whose trigger text fits, and name them. An explicit skill→area map only accelerates this; it is never a precondition.

**Inject per phase.** Before spawning a subagent, prepend a short "Project capabilities — prefer these over generic approaches" block scoped to that phase's slice. Format in `prompts/project-capabilities.md`.

- **Spec & plan research** — the research subagents and governing docs. The planner delegates discovery to a project hunter (architecture / frontend / docs) before any generic codebase sweep, and cites what it returns.
- **Build** — the skills whose triggers match each task's files, attached to the task as "consult these first". For placement and existence questions, bake in an answer pre-resolved by a project research agent — a build agent runs inside the workflow and cannot spawn its own subagents.
- **Review** — the project review gate is already a lens (Phase 4). Also pass the skill catalog to the local-doc and codebase-fit lenses, so they judge against house rules rather than generic taste.

**Project capabilities are project truth.** A hunter's finding or a house skill's rule reflects how this repo actually works. Treat it as authoritative context — the same standing the project review gate already has — not a claim to adversarially re-verify.

## Steering away from cognitive surrender

Speccy's own output is the hazard. Adversarially-hardened specs and plans read as authoritative, and the more authoritative they read, the stronger the pull to approve without understanding — cognitive surrender: borrowed confidence, surface correctness hiding deeper flaws. The pipeline hardens its artifacts; these habits guard the user's engagement, which nothing else does.

Apply these habits at the run's three human gates and nowhere else: the spec critique (1d), the plan review (2b), and the wrap-up decision log (Phase 5). The other interactive moments are not gates. The intake and interview gather requirements, the first-draft review (1c) is the user's turn to read and edit, and the build kickoff (Phase 3) is a handoff — pose no pre-question there. The pre-question assumes the user has read the artifact and is about to see it critiqued; asked before a draft is read, or after a decision is already made, it has no referent and reads as the ritual this section exists to prevent. The three habits:

- **Ask before you tell, then reveal.** Before showing the agent's findings, have the user commit a *prediction*, not an open judgment: the one thing they'd bet the critique flags, or the part they'd defend least confidently. An open "where is it weakest?" is too easy to shrug off; predicting forces the user to build their own model of the artifact first, which is the anti-anchoring point. If they genuinely have nothing, offer to look together at one thing *you* find risky — but only if a real one exists; many artifacts are straightforward, and manufacturing a risk is noise. Draw it from your own read, not from the critique you are holding, which would leak it early. When you present the critique, close the loop against their prediction: "you expected X; it flagged Y — surprised?". The consequence is what makes the question land; without the reveal it decays to a shrug.
- **Flag doubt; stay quiet about certainty.** Surface where the agent is unsure and what it assumed. Never offer high confidence as a reason to skip review — a confident wrong call adopted wholesale is the worst outcome. Point the user at the doubtful parts and let the settled ones pass.
- **Name what convinced you.** Probe a decision by what it needs, not by who made it. That turns on the decision's **origin**, and there are three. Probe one decision per gate, so it reads as a self-check rather than an interrogation.
  - **Speccy, user-agreed** — speccy proposed it and the user signed off at a gate. This is the borrowed-confidence zone, and the case this habit is built for. Ask what persuaded them, and whether they verified it or trusted that the agent sounded sure.
  - **User** — the user brought the call themselves: a preference, a mandate, a judgement. Don't run the borrowed-confidence check on it. If the reason is clear and recorded, or the call is plainly right, log it as given — re-quizzing someone on reasoning they already gave is the empty ritual this section exists to prevent. If it rests on a hunch you cannot see is correct, challenge it on its merits. That is speccy doing its job, not skipping it.
  - **Speccy, alone** — settled inside an autonomous loop, with no gate for the user to sign off: a plan-critique revision, a review disposition. The user never agreed to it, so the borrowed-confidence check has no referent. Surface only the **load-bearing** ones — a call that shapes the design, or one the user would want to own — as speccy's own call now sitting in the spec or plan, and invite them to check they agree and could justify it. Judgement governs hard here. A small or clearly-correct autonomous call needs no raising, and burying the user in these checks trains them to tune speccy out — the disengagement this section fights.

**Origin is not frozen; it flips as the user engages.** Ratifying a surfaced *Speccy, alone* call re-tags it *Speccy, user-agreed*; overriding or reshaping it re-tags it *User*. Record the flip in the artifact, so a later gate or the wrap-up doesn't re-raise a call the user has already owned. Challenging a *User* hunch works differently: if the user then gives a clear reason, it stays *User*, now with its rationale recorded.

Ask these as ordinary questions inside the flow of the gate. Never announce them and never give them a label — not "engagement check", not "cognitive surrender" — a prompt flagged as a check gets performed, not thought about. A user who would rather not be asked can decline, or say so at the start; honour that, and don't advertise the possibility.

**Vary the questions across gates.** The job repeats at each gate; the wording must not. The same pre-question framing heard three times decays into a ritual the user pattern-matches and shrugs past — the ritualization this whole section fights. Before posing a pre-question or a "what convinced you", read `engagementQuestions` from state.json to see what earlier gates already asked, and come at this one from a fresh angle: a different referent, a different way in, not the template again. After you ask, append a short paraphrase of what you posed (`{ gate, asked }`) to `engagementQuestions` and save state.json. The list starts empty and survives a `/clear`, so a resumed context knows what framings are spent. This is about not repeating yourself, not hunting for perfect wording — the engagement comes from the loop; variation only keeps the loop from going stale.

**Each of these questions is a stop.** Ask it as the last thing in the turn and wait. The question is the failure point precisely because the orchestrator tends to ask, then keep running tool calls until it scrolls off unanswered. Nothing follows the question until the user replies, and a pre-question never reveals the critique in the same turn — that would pre-empt the answer and lose the anti-anchoring. Put it on its own line at the end of the reply.

**The long idle stretches are the other good moment.** The autonomous phases — plan critique (2a), the build (Phase 3), the review panel (Phase 4) — leave the user waiting on a subagent for a long while. That idle time takes a different device from the gate habits: not a pre-question — there's no artifact to predict yet — but an offer to deepen understanding. Offer to walk through how a part of the system works relative to what's being built, or raise an implementation detail the plan left open and ask whether the user has a preference. Only when there's something genuine to say — manufactured filler trains the user to tune speccy out. Two rules keep it from backfiring, and both invert the gate question's "stop":

- **It never blocks.** The job runs regardless, and a completion that lands mid-conversation is surfaced at once. The chat is opportunistic filler, never a reason to sit on a finished job.
- **Any steer feeds forward** — into an upcoming task or the review — never expecting the running build to have already adopted it. A preference that would change approved scope is a re-plan, not a mid-build aside.

Apply the same standard to the final diff: read it as if a contributor you do not fully trust wrote it.

## Phase 1 — Specification

Build a structured spec through interview.

### 1a. Intake

**No gate — gathers only.** In: the trigger. Out: a seed for the interview — the user's description, a pointed-to file, or their answer to "what do you want to build?".

The user may or may not have provided a starting description alongside the trigger.

**If they provided something** — a sentence, a feature request, an existing spec file — use it as the seed. A file they point to is the starting draft.

**If they provided nothing** (just "spec mode") — ask what they want to build. Suggest what helps at this stage: the problem, who it's for, known constraints, and how they'll know it's done. Don't require all of it — just enough to start the interview.

### 1b. Interview

**No gate — gathers only.** In: a seed from intake. Out: the gaps that materially change the spec closed, external references recorded, the rest deferred to Open questions; never ask what code or the repo can answer.

**Treat the intake as settled.** Take what the user gave you at face value. Don't re-ask what it answers, don't ask them to reconfirm a stated choice, and reopen a settled point only if they re-raise it or you have a serious, specific doubt. Prefer recording a reasonable default in the spec's Assumptions section over asking — the critique loop challenges it there.

Ask only about gaps the intake leaves genuinely open and that materially change the spec:

- Scope boundaries — what's in, what's out
- Edge cases and error scenarios
- Constraints — performance, security, compatibility
- Integration points with existing code
- Non-functional requirements

Identify external context that would improve the spec or plan: documentation, other projects with relevant patterns, standards, API references. Ask the user about anything you can't access directly. Do this early — missing context discovered mid-build is expensive. Record the references that matter in the spec itself, under Open questions or a short references note, so they survive the context clear before planning. Anything left only in conversation is lost when the user `/clear`s.

**Gather in-repo context through the project's own research agents first.** If the capability manifest found read-only research or hunter agents (architecture / frontend / docs), dispatch the relevant one to answer where a thing lives, how an existing flow works, or whether something already exists — it knows the repo better than a cold grep. Fall back to a generic Explore only when none fits. Feed what it returns into the spec's references so it survives the clear.

**Never ask what code or the environment can answer.** If a quick look at the repo, config, or tooling would settle it, look — don't ask. Questions needing deeper codebase research: mark open and defer to planning.

**Asking nothing is fine.** If the intake settles what you need, write the draft and skip the interview. Clarifying questions only; the habits under **Steering away from cognitive surrender** still apply.

### 1c. Structured spec

**Gate.**
- Entry: interview answers plus the held capability manifest.
- Exit — all must hold:
  - [ ] a committed first-draft spec on a feature branch
  - [ ] the run dir, `state.json`, and manifest persisted
  - [ ] mandatory manifest facts transmuted into Constraints and Criteria
  - [ ] any scope conflict logged as an Open question
- ↩ none — 1c is a read-and-draft step, not a gate. It poses no user question.

Produce a first-draft spec from the interview answers using the template in `prompts/spec-template.md`, relative to this SKILL.md's directory. Fill in every section; remove the HTML comments.

**Do not restate CLAUDE.md.** Reference it by file/section when a constraint matters. Spell out a rule only where this feature diverges from it.

**Transmute the manifest's mandatory facts — do not restate them.** Read the held capability manifest. Each mandatory rule or check it carries must become a task-specific Constraint or Completion criterion in the spec — the concrete form this feature owes it, not a verbatim copy of the general rule. A bare restatement is banned; a derived, checkable requirement is mandatory. A general "run the house lint gate" becomes "zero violations from `<the project's linter>` on the touched files"; a general "specs name secrets, never their values" becomes the specific secret this feature touches, named in Constraints with its value never quoted (the `spec-template.md` Constraints section carries this rule).

**Detect conflicts against the drafted scope — 1c conflict detection.** With the scope now drafted, check the transmuted facts against it. A mandatory rule that collides with what this feature must do is a conflict. It does not block and it is never silently merged: enter it into the spec as an Open question, and the 1d gate adjudicates it. This is where Stage 0's recorded sources first meet a concrete scope (see **Preconditions — Stage 0**).

The **Assumptions** section captures the reasonable defaults chosen where the user's description was ambiguous. Unstated assumptions can't be challenged during critique, so surface them here.

The **Decisions & rationale** section is equally load-bearing. A choice whose reasoning isn't written down reads as an arbitrary default and can't be challenged. For each meaningful decision the spec commits to — a scope call, an approach, a contract or deliverable shape — record what was chosen, the viable alternatives weighed, and the deciding factor: why this and not that. Draw the reasoning out during the interview, but only where the user hasn't already given it. When a choice has a real alternative and the description doesn't explain the pick, ask why the user leans that way. Don't re-ask about a decision the input already settles — a stated preference, mandate, or existing convention is a complete rationale on its own. A decision is a deliberate pick among options; an assumption is a guess under ambiguity. Keep it spec-level: the why behind *what* to build, not code-level *how* — that is the plan's decision body. This section is also the source the wrap-up decision log distils from, so capturing rationale now spares the user reconstructing it from memory later.

**Tag each decision's origin.** The wrap-up probes a decision by where it came from, so record that here (see **Steering away from cognitive surrender**). Only two origins arise in the interview: **User**, a preference, mandate, or judgement the user brought, and **Speccy, user-agreed**, a default or option speccy proposed that the user signed off on. The third, **Speccy, alone**, belongs to the autonomous loops in the plan and review phases.

Let the user read and edit the draft until satisfied. This is their first read, not a gate — pose no engagement question here. The pre-question comes at the 1d critique, once they have the draft in hand.

Create a feature branch before committing anything. Pick a short, descriptive name; if it collides with an existing branch, adjust it. Then `git checkout -b <branch>`.

Save to `specs/<slug>.md`. Commit the spec.

**Always ship a one-page digest alongside the full spec.** The full spec is the implementation reference; it hardens and grows dense through critique. It is not what a busy human reads to understand the work. Maintain a digest next to it, `specs/<slug>-digest.md`: the goal in 2–3 lines, the load-bearing decisions as a scannable list with a one-line why each, what gets built in what order, and the open spikes and risks. Every item references the full spec's section — e.g. "(§ Auth)" — so the reader drills in only where needed. The full spec stays canonical; the digest never restates it in full or diverges. Regenerate the digest whenever the spec materially changes, at minimum once the critique loop converges. At the user-review gate, point the user at the digest first, the full spec for depth.

Bilingual rule, inline: the canonical digest, like every doc, is English and git-tracked in the repo's normal docs location — never a non-English copy in a tracked path. If the user reads or edits in their own language, also write a translated copy, kept only in a gitignored `.users-files/` zone. Never put a translation in a tracked path, and never put the canonical doc inside `.users-files/`. Keep the two in sync — on conflict the English git-tracked copy wins — and leave the section references in English so they don't drift.

Generate a `runId`: lowercase kebab from the slug plus a `YYYYMMDD-HHmm` timestamp, e.g. `auth-refactor-20260609-1430`. Create `.speccy/<run-id>/` and ensure `.speccy/` is in `.gitignore`. Write the initial `state.json` (phase: `spec-critique`, with runId, slug, baseBranch, adversaryModel, builderModel, specPath, and the five run-record pointers — `capabilitiesPath`, `deviationsPath`, `specDispositionsPath`, `decisionQueuePath`, `buildFrictionPath` — set to their `.speccy/<run-id>/` paths even though only `capabilities.md` exists yet; the others read empty until their stage writes them, and `buildFrictionPath` only once Phase 3 has written it). Write the runId to `.speccy/.current-runid` — plain text, no newline needed — so a later session finds this run without globbing. Persist the capability manifest from preconditions to `.speccy/<run-id>/capabilities.md`, so every downstream phase — and a resumed context — reads it from disk rather than conversation memory.

Tell the user about the directory: critique rounds, the plan, review notes, and run state land there, easier to open in an editor than to scroll in the terminal. Mention the path once here; don't repeat it at every save.

### 1d. Adversarial spec critique

**Gate.**
- Entry: the committed draft spec, the manifest path, and critic repo access.
- Exit — all must hold:
  - [ ] every finding dispositioned and persisted to `spec-dispositions.md`
  - [ ] the cold-start flow trace run and its contradictions resolved
  - [ ] ≤3 rounds
  - [ ] then `phase: "planning"`
- ↩ critique-loop revise (see **Return model**); a contradiction the flow trace surfaces forces one more round.

Before investing in planning, the spec gets an independent review. Read `prompts/spec-critique.md`, relative to this SKILL.md's directory.

Run the loop to exhaustion before offering to clear or move on. The user picks findings each round, but one revised round is not a stopping point — keep critiquing until a round surfaces no valuable criticism, or 3 rounds run. Don't offer the clear or planning as a mid-loop alternative to the next round.

For each round (up to 3):

1. **Critique.** Spawn an adversary subagent (Agent tool) with the spec critique prompt, the spec path, the capability manifest path (`.speccy/<run-id>/capabilities.md`), and repo read access — the prompt verifies what-is claims against the code and cross-checks the manifest transmutation. Instruct it to write its review to `.speccy/<run-id>/spec-critique-round-N.md`. Use **opus** as the model override every round, or the user's pinned model.
2. **Present.** Before showing the critique, ask the user to predict it: the finding they'd bet the reviewer raises, or the part they'd defend least confidently (see **Steering away from cognitive surrender**). If they have none and you see a genuine soft spot, offer to look at it together; if the spec is solid, let it go. Then read `.speccy/<run-id>/spec-critique-round-N.md` (N from state.json), present the findings, and close the loop against their prediction — "you expected X; it flagged Y — surprised?". Point them to the file for the full text. Ask which findings to incorporate, and on the most consequential finding they choose to **adopt**, ask what convinced them — adopting the adversary's call is where borrowed confidence lives. A finding they reject on their own judgement is their call; leave it. Record each finding's disposition — incorporated, rejected-with-reason, or recorded-as-accepted-risk — appending this round's entries to `.speccy/<run-id>/spec-dispositions.md`. If the round surfaced no valuable criticism, exit the loop.
3. **Revise.** Spawn a revise subagent (Agent tool) on **opus** with `prompts/revise.md`, the spec path, the critique file path, and the accepted findings. It rewrites the spec in place. When it completes, commit the updated spec with a message summarising the accepted findings — build the message from your own list, not the agent's return. Then run the next round to check the revisions and probe deeper.

**Disposition-based exit.** The loop no longer "proceeds regardless, noting unaddressed feedback". Every finding of every round ends in exactly one disposition — incorporated, rejected-with-reason, or recorded-as-accepted-risk — and nothing exits undecided. The dispositions accumulate in `.speccy/<run-id>/spec-dispositions.md` (see **Record-file format**); its header is `stable id · source round · disposition`. The 3-round cap stands; the exit is through dispositions, not a silent proceed. Update state.json after each round (`specCritiqueRounds`). When the loop exits, set `phase: "planning"`.

**Test every scope-growing finding against the filed problem, and default to deferring it.** A critic is paid to find things, so if each find becomes a deliverable the spec grows monotonically with the round count. Before incorporating a finding that adds a deliverable, a field, or a mechanism, name the line of the originating problem it serves — the backlog item's "Done when", the ticket's acceptance list, the user's own words. A finding that serves none of them is real and out of scope: reject it with that reason, or record it as an accepted risk, and file it as a backlog item so it is not lost. Related work is still work; it just belongs to its own task.

Watch the disposition mix as the signal. All three dispositions exist so the loop can push back, and a run whose dispositions are almost all *incorporated* is not a run with an unusually good critic — it is a run that never said no. One real run finished 80 incorporated against 1 rejected and 1 accepted-risk, and about half its final deliverables answered consequences of its own fixes rather than the filed problem. When the mix looks like that, the next finding's default flips: defer unless it serves the problem.

**Convergence closes the adversarial loop, cap or no cap.** A round that returns no Major and no Medium finding is the design converging — stop spawning adversarial rounds even if the cap has rounds left. What may follow is at most one narrow **consistency sweep**: layered fold-ins contradicting each other, a stale count or cross-reference an edit left behind, a section two rounds both rewrote. Scope it to that and say so in its prompt. Past convergence a full adversarial critic mostly finds defects the previous round's own fixes introduced — editing hygiene, not design — and each such round costs a full opus critique plus a revise pass to buy it.

**The author's own read is a separate step, not a round.** Findings that come from the user reading, using, or projecting the thing onto a real case — rather than from adversarial re-reading — fold in through the same revise agent, but they never increment `specCritiqueRounds` and they never re-open the adversarial loop. Keep the two counters apart in what you tell the user, too: conflating them makes a design that converged early read as one that needed twice the rounds.

**Mandatory exit gate — the cold-start flow trace.** Do not leave spec critique until at least one round has explicitly done the end-to-end, first-run dependency trace described in `prompts/spec-critique.md` — walking each primary flow step by step from an empty state and confirming every step's prerequisites already exist at that point — and every bootstrap, ordering, or mutually-exclusive-mechanism contradiction it surfaced is resolved. This is separate from section-by-section consistency. A spec can pass every consistency pass and still hide a step that depends on something only produced later, or two individually-sound choices that collide once the flow runs in order. Only tracing the actual flow catches these. Layered fold-ins across rounds can easily introduce such a contradiction; if they could have, run one more round whose sole job is this trace before declaring the spec ready. The same trace repeats at the Phase 2b plan review — planning can reintroduce an ordering dependency the spec didn't have.

Only once the loop has fully exited, reach the primary context-clearing point. The spec interview and critique are the heaviest interactive context in the run, and the approved spec now captures every decision in a committed file — the window can reset before planning, which is largely subagent-driven. Verify all run state is in files: state.json current, spec committed, external references recorded in the spec, not left in conversation. Then suggest the user `/clear` and re-invoke to resume at planning. If they'd rather continue, proceed to Phase 2.

## Phase 2 — Planning

**Gate.**
- Entry: the hardened spec; the capability manifest.
- Exit — all must hold:
  - [ ] a plan at `.speccy/<run-id>/plan.md`
  - [ ] the plan names secrets by reference, never their values
  - [ ] `phase: "plan-critique"`
- ↩ a contradicted spec assumption is a blocking user choice — accept adjusted scope, or revise the spec and re-plan (see **Return model**).

Orient the user briefly on why planning is separate: the spec says *what* to build, the plan says *how*. Planning researches the codebase, discovers what exists, makes architecture decisions, and sets the order of operations. Without it, the spec's open questions carry into implementation and surface mid-build.

Planning research happens in a subagent, to keep codebase-reading noise out of the main context. Read `prompts/plan-research.md`.

Spawn a planning subagent (Agent tool) with the plan-research prompt, the spec path, the target plan path (`.speccy/<run-id>/plan.md`), and the path to `prompts/plan-spike.md` so the planner can prove any load-bearing mechanism — preferably by spawning a spike subagent, or inline. If the spec recorded external context (docs, standards, related projects), pass those references too. Read them from the spec, not conversation memory — planning may run in a freshly cleared context.

Pass the capability manifest (`.speccy/<run-id>/capabilities.md`) as well, with the phase preamble from `prompts/project-capabilities.md`. Instruct the planner to delegate codebase discovery to the project's research agents before any generic sweep, to consult the skills whose triggers match the area it plans, and to cite what each returns — so the plan is grounded in how the repo actually works.

When it completes, brief the user on the approach, key decisions, and risks from `.speccy/<run-id>/plan.md` — point them at the file rather than dumping it inline. Update state.json with `planPath` and `phase: "plan-critique"`.

**If the plan flags a contradicted spec assumption**, stop before the plan-critique loop and put a blocking choice to the user: accept the adjusted scope, or revise the spec and re-plan. A falsified assumption can invalidate scope, so this gate always fires. A revision too large for this run is a sibling run, never a nested one (see **Return model**).

### 2a. Adversarial plan critique

**Gate.**
- Entry: the drafted plan, the spec as context, the manifest, and the design-principle skill paths.
- Exit — all must hold:
  - [ ] findings routed by level
  - [ ] load-bearing mechanisms spiked where flagged
  - [ ] ≤3 rounds
  - [ ] the plan clean
- ↩ critique-loop revise; a `spec-level` tag or a refuted spike is a blocking user gate (see **Return model**).

The spec is already hardened; now the plan gets its independent review. This loop runs autonomously — the user reviews the hardened plan in 2b. Read `prompts/plan-critique.md`, relative to this SKILL.md's directory.

For each round (up to 3):

1. **Critique.** Spawn an adversary subagent with the plan critique prompt, the plan path, the spec path — context, not re-review material — the capability manifest path (`.speccy/<run-id>/capabilities.md`), and the design-principle skill paths the manifest's working-configuration table names (SOLID, Ockham, Wittgenstein), so it judges the plan against the house design law and the project's enforced static-analysis config. Instruct it to write its review to `.speccy/<run-id>/plan-critique-round-N.md`. Use **opus** every round, or the user's pinned model. Read the critique file (N from state.json) and route each finding by its plan-critique level tag — distinct from the review-lens taxonomy, do not merge them:
   - `plan-level` → the revise loop handles it this round, as normal.
   - `spec-level` → a blocking user choice: accept the scope change, or return to the spec and re-plan (see **Return model**).
   - `needs-spike` → run the spike (step 2), then re-tag on its verdict.

   No legitimate flaws → exit the loop.
2. **Spike, if the critique flags an unproven load-bearing mechanism.** This resolves a `needs-spike` tag. The critic judges the plan's evidence but does not spike. When it flags a mechanism whose feasibility the plan hasn't proven, prove it before revising: spawn a spike subagent with `prompts/plan-spike.md` and the mechanism, writing its verdict to `.speccy/<run-id>/spike-round-N.md`. Read the verdict and re-tag the finding:
   - `confirmed` → the finding folds forward as `plan-level`; carry the evidence into the revise step so the plan records it in the Assumptions check.
   - `refuted` or `unproven` → the finding escalates to `spec-level`. An unprovable load-bearing mechanism can invalidate scope. Treat it like a contradicted spec assumption: stop the loop and put a blocking choice to the user — accept a redesign around a mechanism that works, or revise the spec and re-plan (see **Return model**). Like that gate, this one always fires.
3. **Revise.** Spawn a revise subagent on **opus** with `prompts/revise.md`, the plan path, the critique file path, and instructions to incorporate every finding. When it completes, the revised plan file is the truth — don't depend on its return.

After 3 rounds, exit regardless. Update state.json after each round (`planCritiqueRounds`). On exit, surface a one-line note — how many rounds ran, what changed — then proceed to 2b.

### 2b. User review

**Gate.**
- Entry: the hardened plan.
- Exit — all must hold:
  - [ ] the user approves
  - [ ] `builderModel` set
  - [ ] `phase: "implementation"`
- ↩ concerns re-enter 2a or amend the plan until the user approves.

The highest-stakes human gate. Engage it deliberately (see **Steering away from cognitive surrender**):

- **Draw out the user first.** Before walking the plan, ask them to predict it: the choice they'd bet the critique pushed hardest on, or the decision they'd defend least confidently. If they have none and you see a genuinely shaky, load-bearing decision, offer to look at that one together — only if a real one exists. When you walk the plan, close the loop against their prediction and what the 2a critique actually changed: "you flagged the retry design; the critique reworked the idempotency key instead — surprised?".
- **Then present, candidly.** Have them read the plan file directly rather than re-dumping it. Walk the two or three load-bearing decisions; for each, surface the alternative the plan rejected and its best argument. Include any load-bearing call 2a settled on its own: flag it as speccy's, and invite the user to own or challenge it. Leave the trivial and clearly-correct revisions unremarked — parading them just trains the user to skim. Flag where the plan is genuinely uncertain. Don't let a confident passage stand in for a verified one.
- **Name what convinced you.** On the single most consequential decision, ask what persuaded them — and whether they checked it or are trusting the plan's confidence.

**Recommend a builder.** With the plan's shape clear, tell the user whether sonnet (the default) or opus suits this build, and why. Weigh complexity and novelty, how much is left to build-time judgment versus mechanical execution, and how tightly the plan pins down each task. They set `builderModel`.

The adversary has cleaned up the obvious issues; this gate is the user's chance to raise concerns it missed, adjust the approach on their own knowledge, or approve as-is. Iterate until satisfied.

**Tag each load-bearing plan decision's origin** in the plan's decision body. A call the user reshaped or overrode on their own knowledge is **User**. One speccy proposed that the user examined and signed off here is **Speccy, user-agreed**. One that 2a settled autonomously and never surfaced at this gate stays **Speccy, alone**. That provenance is what lets the wrap-up probe each the right way, instead of asking the user to justify a steer they made themselves.

On approval, set `phase: "implementation"` in state.json.

Before implementation, verify all run state is in files: state.json current, spec and plan committed, review decisions reflected in the plan. The main clear already happened after the spec, so this one is conditional — if plan critique and review accumulated heavy context, suggest `/clear` and re-invoke to resume at implementation; if planning stayed lean, proceed.

## Phase 3 — Implementation

**Gate.**
- Entry: an approved plan; `phase: "implementation"`; a base branch with no unexpected drift.
- Exit — all must hold:
  - [ ] the build reports complete
  - [ ] the load-bearing gates re-run green
  - [ ] every completion-time deviation dispositioned
  - [ ] only then `phase: "review"`
- ↩ a plan-premise deviation amends the plan and resumes over remaining tasks; a requirements-level deviation is a blocking user gate — anti-nesting applies (see **Return model**).

**Base-branch drift check — before the build.** Run the **Base-branch drift check** (see its section). Substantial drift means the plan may no longer describe the starting state; stop before the build rather than building on a shifted floor.

Invoke the `plan-execution` skill directly via the Skill tool from the main conversation. Pass the plan path as `args.planPath` — not the full plan text; the workflow reads the file itself, which keeps the call small and the plan editable mid-run. Pass the builder model as `args.model`, from state.json's `builderModel`, default sonnet. The breakdown agent inside plan-execution always uses opus; only execute/integrate/verify pick up the override.

Do not wrap this in an Agent subagent — Agent subagents lack `Workflow`, so the call breaks. Plan-execution already backgrounds its own work; only the final result returns.

**Pass the deviations path.** Supply the absolute `.speccy/<run-id>/deviations.md` path (from state.json's `deviationsPath`) to plan-execution. It appends that path to `prompts.retrospective` at its own assembly step, so the retrospective agent serializes the build's SOFT deviations into `deviations.md` in the **Record-file format** — its header is `stable id · source round/task · disposition`; plan-execution's `retrospective` prompt carries the compact restatement. Do not disable the retrospective — the deviations pass-through depends on it running; never pass `retrospective:false`. With no path the agent writes no file and produces only a friction synthesis.

**Persist the build friction.** Plan-execution returns a build-phase friction synthesis. Save it to `.speccy/<run-id>/build-friction.md` (fixed filename, from state.json's `buildFrictionPath`) so it survives a `/clear` — the wrap-up retro reads it from there, not from the return.

**Write the friction line at the moment of failure, not at the retrospective.** The moment a task fails its own verification, or you fix its output by hand instead of routing it back through the workflow, append one line to `build-friction.md`: what failed, and what closed it. Do it even when the fix is trivial and lands in the next commit — especially then, because a clean fix is exactly what leaves no trace anywhere else. A run that hit real task failures and reports none has a false record, and the wrap-up retro reads that silence as a smooth build.

The build kickoff is a handoff, not a gate (see **Steering away from cognitive surrender**): 2b was the engagement point, so pose no pre-question and announce no check here. If you frame the handoff at all, keep it to a passing line: the build now runs autonomously and the user stays **on** the loop — free to watch it work and step in — rather than walking away from it, which is the vibe-coding failure mode speccy exists to avoid. "In the loop" belongs to the spec and plan gates, where the user decides each acceptance; the build is supervision, not decision-by-decision. Then start the build.

**Push for parallelism where the plan allows.** Plan-execution's breakdown defaults to sequential steps, and a purely serial run is the single biggest wall-clock cost. When invoking plan-execution, augment the breakdown instruction to parallelize genuinely independent work: group tasks that touch disjoint files with no data dependency into parallel steps, each mapping to a spec or plan acceptance criterion. Authoring independent units concurrently — a test class per production class, separate feature files — is the clearest win. State the caveat to the breakdown: if the project verifies against a single shared environment (one scratch org, one database), the deploy/test step of parallel tasks contends on that resource and effectively serialises. Parallelism cuts authoring time, not the shared-environment round-trip. Parallelise the authoring; let integration and verification funnel through the shared resource.

**Route the project's capabilities into each task.** Also instruct breakdown to attach to every task the skills whose triggers match that task's files — an explicit "consult these before writing" list the build agent activates itself. It can invoke a Skill; it cannot dispatch an Agent. Placement and existence questions — "where does this belong", "does a primitive for this already exist" — are different: a build agent inside the workflow can't spawn a research agent to settle them, so resolve those up front with the project's hunter agents and bake the answer into the task description. Pass the capability manifest path (`.speccy/<run-id>/capabilities.md`) so breakdown has the roster. If the manifest is empty, this augmentation is a no-op.

**Run the security lens as soon as an attack surface exists — do not hold it for Phase 4.** The moment the build has produced the first thing that takes outside input — a script or hook the project will run, an endpoint, a command that interpolates a config value or a path — spawn the Phase 4 security lens (`prompts/review-security.md`, opus) against the diff so far and route its findings into the build as fix work. Order it off the plan's **Order of operations**: the step that creates that surface is the trigger, not the end of the build. A hole found at Phase 4 already has the rest of the build stacked on the vulnerable version; found at its own step it is a one-file fix. This is an extra pass, not a substitution — Phase 4 still runs the security lens over the whole diff.

When the workflow reports complete, do not advance on its "gates pass" summary — a build agent can satisfy a gate by fabricating or inverting a rule and still report green. Re-run the project's load-bearing gates yourself — build, lint, static analysis, tests, from CLAUDE.md — and confirm the actual tool output. Use the project's documented harness the way CLAUDE.md specifies it: if CLAUDE.md names an MCP tool for a gate, invoke that MCP tool rather than shelling out to the raw CLI; the CLI wrapper is a fallback, not the default. If a gate fails, the run isn't done. Carry the real tool output into a fix round — the Phase 4 implementation-fix agent handles exactly this — re-run the gates after it, and repeat until you have seen them pass. Only then proceed to the completion-time deviation triage below — **do not set `phase: "review"` yet**.

**Completion-time deviation triage.** After the gates pass and before Phase 4, read `.speccy/<run-id>/deviations.md` (from `deviationsPath`). An absent or empty file means the build reported no deviations — skip straight to setting `phase: "review"`. Otherwise disposition each entry, and record the disposition back into its header:

- **cosmetic** — a trivial adaptation with no plan or scope effect → nothing to do.
- **plan-premise-false-but-worth-building** — a premise the plan assumed turned out false, but the work is still worth doing. The orchestrator owns the plan edit: amend the plan, log the amendment, and build a **reduced plan** of the remaining un-integrated work. Re-run plan-execution over that reduced plan — the documented amend-and-resume path (`TaskStop` the workflow first if it is still running). This is a return route; depth stays 1 (see **Return model**).
- **requirements-level** — the deviation changes what the feature must do. This is a blocking user gate: the user decides, and may defer the change to a sibling run rather than expand this one. Never a nested sub-run (see **Return model**).

The orchestrator owns every plan edit here; a build agent never edits the plan. **Hold `phase` at `implementation` through the entire triage** — including any amend-and-resume round. Set `phase: "review"` **only** after every deviation is dispositioned and any amend-and-resume has finished. Why this is load-bearing: resume reads `phase == "review"` as done-with-build and enters Phase 4, so a `/clear` mid-triage would skip triage and silently drop an un-triaged deviation. A resumed run at `phase == "implementation"` with a present `deviations.md` re-enters this triage; plan-execution's own resume yields an empty reduced plan once all tasks are integrated, re-completes trivially, and hands back here to re-read `deviations.md`.

**Economise the round-trips.** They dominate wall-clock when the gate hits a remote environment — a scratch org, a CI runner, a container. The trust rule (see it pass yourself) is non-negotiable; what's negotiable is paying the full remote round-trip on every intermediate step.

**Test re-run scope — the hard rule, do not violate:**

- While fixing, re-run only the specific tests you just touched or that were failing — never the whole suite. Re-running every test to confirm a one-line fix in one test is waste; it does not happen.
- Run the full suite of ALL tests exactly once, at the very end, after every fix is in. That single final run is the completeness gate. Not per-fix, not per-round.
- Concretely: fix test/class X → run X and its production class's targeted tests → green → move on. Only when the fix list is exhausted, run the entire suite once to confirm nothing regressed.
- For intermediate checks inside a fix loop, prefer the cheapest signal that still proves the fix: compile, type-check, `--dry-run`, the single changed test. Batch several findings into one fix agent and re-check once, rather than re-gating after each small edit.

If the implementation workflow exits incomplete, stop the pipeline. Report what's done and what remains — the user has a branch with partial progress. Read the returned result's `failed`, `blocked` and `built_not_integrated` lists first: they name each task's state and reason directly, which is the "blocked on intent" vs "mechanical gap" triage plan-execution's own `SKILL.md` describes, made explicit instead of read out of prose. State.json stays at `phase: "implementation"` so the run can resume later.

## Phase 4 — Implementation review

**Gate.**
- Entry: `phase: "review"`; every completion-time deviation dispositioned; a clean diff `<base-branch>...HEAD`.
- Exit — all must hold:
  - [ ] `code` findings fixed and gates green
  - [ ] `design`/`requirements` findings batched to `decision-queue.md`
  - [ ] ≤3 rounds
  - [ ] then `phase: "wrap-up"`
- ↩ review batch-at-gate — no mid-round return; the queue clears at the one post-review gate (see **Return model**).

After implementation, the code gets an independent review across several lenses, run in parallel. Completeness is already verified by the task execution skill; this phase is about quality, spec fidelity, and fit.

**Base-branch drift check — before review.** Run the **Base-branch drift check** (see its section). A shifted base makes the `<base-branch>...HEAD` diff every lens reads wrong; reconcile drift before spawning the lenses.

### The lenses

Each round spawns the reviewers as **parallel** subagents — one message, one Agent call each — all **read-only**; none edits code. Each writes its findings to its own file, `.speccy/<run-id>/review-round-N-<lens>.md`. Pass each the base branch so it can diff `<base-branch>...HEAD`. All prompt paths are relative to this SKILL.md's directory.

Pass each bespoke lens `prompts/review-output-contract.md` alongside its own prompt. It standardises the finding shape so triage is mechanical, and makes writing the file a hard contract: a lens that runs out of room mid-verification still leaves a file, marking the unconfirmed candidate `PLAUSIBLE`, rather than returning nothing. `code-review` is a built-in skill that won't read the contract; the orchestrator applies the same shape when normalising its findings into the code-review lens file.

- **Code review** — the built-in `code-review` skill, targeting `<base-branch>...HEAD` at `high` effort, no `--fix`, no `--comment`. It covers correctness and general code quality; the bespoke lenses handle only what it can't. Run it every round.

  Invoke it directly in the main conversation via the Skill tool, not inside an Agent subagent — it spawns its own subagents, and wrapping a multi-agent skill stalls it. Parse its output tolerantly; the shape may change. Normalise its verdicts into the shared finding shape and write `review-round-N-code-review.md` yourself.
- **Project review gate** — the repo's own review gate, if it ships one: a `/review`-style skill, project-defined reviewer agents, or a `.claude/review.config.json`. When present, run it as an extra lens. It encodes the house security bar, thresholds, and invariants a generic reviewer can't replicate — where it exists it is the highest-signal lens in the panel. Run it the way the repo documents it: its own agents, models, and thresholds, not overridden. Like `code-review`, a project gate is usually itself multi-agent, so invoke it directly in the main conversation, not wrapped in an Agent subagent — same reason, and see **Subagent results: trust files, not returns**. It is spec-blind: it checks house quality, not whether the build meets this spec's criteria, so it complements the spec-fidelity lens, never replaces it. Normalise its findings into the shared shape and write `review-round-N-project-gate.md` yourself. The triage step dedups its overlap with `code-review`, codebase fit, and local-doc adherence like any other lens. No gate in the repo → skip this lens.
- **Security** — `prompts/review-security.md`, on **opus**. Pass it the spec path, the plan path, and the base branch. A generalized paranoid pass: hardcoded secrets, injection reachable from user input, missing authn/authz, data exposure, token boundaries, unsafe input. It runs **every round and is never dropped entirely** — even a fix-only round gets a security fix-verification pass. See the rounds behaviour under **The loop**.
- **Plan adherence** — `prompts/review-plan-adherence.md`, on **opus**. Does the build follow the plan's architecture decisions and Data & contract changes? Inject `.speccy/<run-id>/deviations.md` as context: a divergence that matches a recorded deviation is authorized and not a finding; a silent divergence is. Pass the plan path and the deviations path.
- **Spec fidelity** — `prompts/review-spec-fidelity.md`, with the spec path. Does the code satisfy the spec's completion criteria and intent?
- **Tests** — `prompts/review-tests.md`, with the spec and plan paths. Test-strategy adherence, test quality, and consolidation of new tests against the existing suite.
- **Codebase fit** — `prompts/review-codebase-fit.md`. Does this change worsen an already-imperfect area or repeat an existing smell? Judged against the touched files' current state, not the diff alone.
- **Local-doc adherence** — `prompts/review-local-docs.md`. Violations of the repo's governing docs, including CLAUDE.md — deliberately re-checked even though code-review covers it too. Pass it the capability manifest so it judges against the project's actual skills and governing docs; where a house skill states a rule, a violation is a finding.
- **Suppressions** — `prompts/review-suppressions.md`. Extremely harsh on any linter, analysis, type, or test-gate suppression the change adds or leans on. Each must be watertight or it is a finding.
- **Comments** — `prompts/review-comments.md`. Comments the change adds or edits that restate the code, narrate edit history, or pad a real point. Proposes deletions only; the fixer mends any seam.

Run the bespoke lenses on **opus**, except suppressions and comments on **sonnet** — a mechanical scan and a focused style pass. A pinned adversary model overrides all of them; `code-review` and any project gate manage their own.

### The loop (up to 3 rounds)

1. **Review.** Spawn the bespoke lenses as parallel subagents in one message, and invoke the inline gates in the main conversation — `code-review` every round, and the project gate if the repo ships one; their own fan-out overlaps with the spawned lenses. Round 1 is a cold review. Rounds 2+ are fix-verification: re-point each lens at "verify the round-(N-1) fixes hold, and catch any regression they introduced", and always pass the `.speccy/<run-id>/deferred.md` list as accepted decisions it must not re-raise. Run all lenses every round by default. Drop a lens only when the fix round provably didn't touch its surface — e.g. skip local-doc adherence when nothing under a governing doc changed — and note any lens you drop and why. **Security is the exception: it is never dropped entirely.** In rounds 2+ it narrows to fix-verification like every other lens — confirm the round's fixes opened no new hole, re-check the security-relevant surface those fixes touched — but it always runs as at least a fix-verification pass. Not-skippable does not mean a full cold re-scan each round: a round-2 fix touching only a doc string does not warrant re-scanning the whole diff.

   For the spawned lenses, don't branch on a returned summary (see **Subagent results: trust files, not returns**) — confirm the file exists. Self-heal a stalled lens: if its file is missing after it reports complete, `SendMessage` that agent to write its findings file as its final action, marking anything unconfirmed `PLAUSIBLE`, rather than re-spawning from scratch. Once every lens file is present — the spawned files plus the inline-gate files you wrote — read them (N from state.json) and move to triage.
2. **Triage & merge.** Consolidate the findings yourself — drop false positives, de-duplicate overlaps, resolve contradictory suggestions. Don't spawn a separate agent for this. Every lens emits the shared shape, so merge on `file:line`. Two lenses landing on the same anchor is a convergence signal: independent lenses pointing at one spot raise confidence — weight those up instead of collapsing them to a lone finding. As a backstop for anything re-raised despite instructions, drop findings already in `.speccy/<run-id>/deferred.md`; a deferred finding must not churn back into the fix set.

   **Assign the final level.** Each lens emits a provisional `level` — `code`, `design`, or `requirements` — from its own local view. Triage sets the final level, and may re-level a finding at merge when cross-lens context changes the call: lens proposes, triage disposes. One exception: findings from the suppressions lens are always level `code` — triage never re-levels them to `design` or `requirements`. The level decides the route:
   - `code` → the in-round fix loop, dispositioned Fix or Defer as below.
   - `design` / `requirements` → **not fixed mid-round**. Batch it into `.speccy/<run-id>/decision-queue.md` (see **Record-file format**); its header is `stable id · source lens/round · disposition slot`, the slot empty until the gate decides.

   Give each `code` finding a disposition:
   - **Fix** — route it to the fixer this round. Where the finding is a copied smell, tell the fixer whether to diverge (fix cleanly here) or fix wider (also fix the existing instance). A wider fix grows the diff, so choose it deliberately.
   - **Defer** — legitimate but out of scope for this PR. Append it to `.speccy/<run-id>/deferred.md`: what, and why deferred.

   A suppression finding is effectively never Defer — remove it or make it watertight, this round. **Exit the loop when no `code` finding is dispositioned Fix.** The review never returns mid-round; `design`/`requirements` items wait in the decision queue for the one post-review gate (see **Wrap-up**).

   You make these disposition calls yourself as the loop runs — the review is autonomous. Surface them at wrap-up so the human still reviews the judgment: deferrals in the deferred list, the decision queue at its gate, and any divergence-from-pattern or wider-than-the-diff fix in the summary and decision log.
3. **Fix.** If nothing is dispositioned Fix, skip to the next round's review, or exit. Otherwise read `prompts/implementation-fix.md` and spawn a fix subagent with that prompt, the Fix findings — point it at the lens files, and state any diverge or fix-wider instruction — the spec path, and the plan path. It makes the changes and commits. After it commits, re-run the load-bearing gates yourself and confirm the actual output before the next round. Never advance on the fix agent's claim that gates pass — gates passing doesn't prove coverage held; a dropped test still passes.

After 3 rounds, proceed regardless. Update state.json after each round (`reviewRounds`). When the `code` fix loop ends, set `phase: "wrap-up"` — **not** `"complete"`. This is a deliberate relocation: the review loop no longer marks the run done. `complete` is set later, only after the wrap-up decision-queue gate clears and the wrap-up artifacts are dispositioned (see **Wrap-up**). Any `deferred.md` items and the whole `decision-queue.md` surface at wrap-up.

## Wrap-up

**Gate.**
- Entry: `phase: "wrap-up"`; the decision queue, deviations, dispositions, and review data on disk.
- Exit — all must hold:
  - [ ] the decision-queue gate cleared
  - [ ] summary, decision log, and retrospective authored
  - [ ] wrap-up artifacts dispositioned
  - [ ] only then `phase: "complete"`
- ↩ a targeted re-plan regresses `phase` to Phase 2 for the affected slice under the 3-round caps (see **Return model**).

### Decision-queue gate

The one post-review human gate. Read `.speccy/<run-id>/decision-queue.md` (from `decisionQueuePath`). An absent or empty queue means "nothing to decide" — the gate passes clean, say so, and move on. When it holds items, present **only the undecided ones**; for each, the user picks exactly one outcome, and you record it into that item's disposition slot:

- **Targeted re-plan** — re-enter Phase 2 for the affected slice only, under the same 3-round caps, with `phase` regressed to `plan-critique` (or `planning` if the slice needs fresh research). Reset `planCritiqueRounds` to 0 on entry — the re-planned slice earns a fresh cap — and reset `reviewRounds` to 0 for the re-review pass that follows. This is the one mechanical boundary: re-plan stays inside this run; a sibling run does not.
- **Accept-with-record** — accept the current build as-is; write the decision to the decision log and append it to `deferred.md` if follow-up work remains.
- **Defer-to-sibling-run** — the change is too large for this run; record it (deferred + decision log) and it becomes a separate sibling run on the user's call, never nested (see **Return model**).

Re-plan versus sibling run is the mechanical split — same run or new run. Fix-now versus accept is deliberate user judgment, not a rule the orchestrator decides. This gate is a stop: ask, then wait (see **Steering away from cognitive surrender**).

### Handoff

A completed run is a handoff. Speccy has built and self-reviewed the work; the verdict is the user's, reached through the diff, the artefacts below, CI, E2E, or running it themselves. Speccy stops at a reviewable PR — it does not merge, certify, or run end-to-end verification. Report what was built and leave the review to the user. When pointing them at the diff, suggest they read it as if a contributor they do not fully trust wrote it — the standard they'd apply to any other author (see **Steering away from cognitive surrender**).

When all phases complete, report concisely — in the chat and to `.speccy/<run-id>/summary.md`, so the handoff survives a context clear and sits with the run's other artefacts. Cover:

1. **Summary** — what was built, how many critique and review rounds ran, what changed, and that the branch is ready for review.
2. **Decision log, co-authored** — distil the key decisions from the spec, the plan, and the critique and review rounds into `specs/<slug>-decision-log.md`, including any review-phase divergence from an existing pattern. These are usually implementation-specific choices, not the durable architecture decisions an ADR captures for the wider team. Each entry: what was proposed, what was decided, why, and its **origin**. Carry origin from the artefacts — the spec's Decisions & rationale is tagged, plan decisions are tagged at 2b, and a review-phase disposition is *Speccy, alone* unless the user raised the concern, which makes it *User*. Then probe only the one or two decisions that warrant it, each the way its origin calls for (see **Steering away from cognitive surrender**): ask a *Speccy, user-agreed* decision what convinced them and whether they verified it, since borrowed confidence is the surrender signal worth catching while the code is fresh and they are about to own it; log a *User* decision's reason as given, and challenge it only if it rests on a hunch they cannot show is right; surface a load-bearing *Speccy, alone* call as speccy's own and let them own or challenge it, re-tagging by what they do. Don't manufacture a probe where nothing warrants one. Commit the decision log.
3. **Deferred feedback** — substantial feedback set aside: findings the user skipped at spec critique, plus review findings deferred in `.speccy/<run-id>/deferred.md`, with the why. Candidates for follow-up issues outside this PR.
4. **Retrospective** — authored here, at wrap-up. See the subsection below.

### Retrospective

The retrospective is authored at wrap-up, not lifted from the build. Spawn a subagent — carry the session's voice into its prompt (see **Propagate the session's voice to subagents**) — to write `.speccy/<run-id>/retrospective.md` over the **widened inputs**, not the build friction alone:

- the build-phase friction synthesis, persisted at `.speccy/<run-id>/build-friction.md` (from `buildFrictionPath`);
- the plan's assumption verdicts (spikes, contradicted-assumption gates);
- `deviations.md` — the completion-time deviations and their dispositions;
- `spec-dispositions.md` — the spec-critique dispositions;
- the review round data — findings, levels, fixes, deferrals;
- `decision-queue.md` — the design/requirements decisions and their outcomes.

The orchestrator presents it. The retrospective's output sections are: wrong assumptions; research misses; a critique value audit — which findings helped, which were noise, and what review caught that critique should have caught earlier; plan-vs-reality; which checks caught real defects; and a shorter-path note. Add a **mandatory deliverable: at least one ready-to-apply artifact draft**, or an explicit justification for why none is warranted. An artifact is a concrete, applyable change: a skill edit, a CLAUDE.md rule, a doc fix. The user accepts or declines **per artifact**. Accepted artifacts land on a **separate branch/PR — never the feature branch**, so the reviewable build stays clean.

**ADR chain.** A decision-log architectural decision, or a `design`-level review finding that returned through the decision-queue gate, obliges an ADR draft — a durable record for the wider team, distinct from the run-local decision log. Draft it as one of the wrap-up artifacts; the user accepts or declines it like any other.

Only after the decision-queue gate has cleared and every wrap-up artifact is dispositioned (accepted onto its separate branch, or declined) set `phase: "complete"` in state.json. Setting it earlier would let a `/clear` during the gate or the artifact review resume as finished and silently drop undecided queue items and the mandatory artifact — the exact loss the relocation prevents (see **Resuming a run**).

If the pipeline exited early on an implementation failure, report what's done and what remains. The user has a branch with partial progress.
