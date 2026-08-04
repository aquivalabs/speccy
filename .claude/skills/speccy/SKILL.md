---
name: speccy
description: Guided specification writing, adversarial spec critique, and post-build review. Full pipeline from rough idea to reviewed implementation.
when_to_use: When the user says "speccy", "spec mode", "adversarial mode", or similar. Also when about to execute a complex multi-step plan and adversarial critique would help.
allowed-tools: Bash(bash *skills/speccy/banner.sh), Read(.speccy/**), Write(.speccy/**), Edit(.speccy/**)
---

# Speccy

Full pipeline: specification → spec critique → planning → plan critique → implementation → implementation review.

The orchestrator runs in the main conversation. Heavy work goes to subagents — critiques, planning research, revisions, the build, code review — so the main context stays small. State lives in files. The run can pause at any phase boundary, be `/clear`ed, and resume.

## Getting started

Show the Speccy banner first, on every invocation. Run `banner.sh` from this skill's own directory, by its absolute path — a relative path breaks when the Bash cwd has drifted or the skill is installed as a plugin. Do not prepend `cd` and do not use command substitution; both break the pre-approved permission match.

```bash
bash <skill-dir>/banner.sh
```

The script prints two Markdown lines. Reproduce them verbatim at the top of your reply — that is what the user sees. Running the script alone is not enough; its tool output is hidden by default.

The banner is cosmetic. If the script fails or would prompt, proceed without it. Never block the run on it.

Then check for an in-progress run (see **Resuming a run**). If one exists, offer to resume before starting fresh.

For a new run, introduce the skill in one sentence: it walks from writing a spec, through independent critique, to a built and reviewed implementation. Then ask two things in one turn:

1. **Walkthrough or start?** The user can ask for a walkthrough of the process, or describe what they want to build and start. The walkthrough explains each phase in a few sentences, organised by what the user does versus what runs autonomously:
   - **Spec** (interactive) — an interview builds a structured spec; the user reviews and edits until satisfied.
   - **Spec critique** (user-in-the-loop) — an independent reviewer critiques the spec each round; the user decides what to incorporate.
   - **Plan** (autonomous loop) — a subagent researches the codebase and drafts a plan; a reviewer critiques and a revise agent applies findings until the plan is clean.
   - **Plan review** (user decides) — the user reviews the hardened plan, raises concerns, approves.
   - **Implementation** (autonomous loop) — the build follows the plan. Parallel reviewers then check the code across several lenses: correctness and quality via the built-in `code-review` skill, the repo's own review gate when it ships one, plus spec fidelity, tests, codebase fit, local-doc adherence, and strict scrutiny of suppressions. Fixes are applied directly or deferred as future work.
   - **Wrap-up** — summary, decision log, retrospective. The user reviews the final diff on the branch.

   Also mention: state is saved at every phase boundary, so the user can `/clear` and re-invoke at any point to resume with a fresh context. Useful for long runs where the conversation has grown.

2. **Defaults you can change.** Flag the per-phase model defaults below and that they are overridable. Don't ask — just flag that the options exist.

Per-phase model defaults:

- **Spec and plan critique** — opus every round, for both the adversary and the revise agent, up to 3 rounds. These artifacts are short and high-leverage; cheaper tiers cost more in false-positive triage than they save.
- **Implementation review** — parallel review lenses, up to 3 rounds (see Phase 4). The four judgment lenses — spec fidelity, tests, codebase fit, local-doc adherence — run on opus; the suppressions lens runs on sonnet. The built-in `code-review` skill runs alongside at `high` effort and manages its own models.
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

`adversaryModel` defaults to `"opus"` — the tier for every critique round and the review panel's judgment lenses. The suppressions and comment lenses run a tier below; see **Getting started**. If the user pinned a different adversary model, store that name here and use it for every critique round and review lens.

On trigger, read `.speccy/.current-runid` — a pointer to the most recent run, written when the run is created (Phase 1c). If it exists, read that run's `state.json`. If `phase` is not `"complete"`, surface the run and ask whether to resume or start fresh. To resume, read the artifacts state.json references — spec, plan, latest critique round — and continue from the recorded phase. A resumed run skips the precondition checks; if the recorded phase is past the spec interview, suggest auto-accept mode (shift+tab) first, because the rest of the run is autonomous tool calls.

After completing each phase, update state.json and continue. The user can `/clear` and re-invoke at any point to resume from the recorded phase — do not ask permission at phase boundaries.

Read and write `.speccy/` state with the Read/Write tools; these paths are pre-approved in `allowed-tools`, so they won't prompt. Do not rely on the Glob tool — it isn't available in every session, which is why run discovery uses the `.current-runid` pointer. The pointer tracks the latest run; earlier runs remain in `.speccy/` if the user wants to revisit one.

## Preconditions

Before the checks below, suggest the user enable auto-accept mode (shift+tab). From here to the end of the run the work is mostly tool calls: the verification smoke-test runs the project's linters and tests, then planning, critique, implementation, and review run autonomous loops. Approving each call by hand is pure friction. The spec interview stays a conversation either way, so auto-accept takes no decisions away from the user.

### Verification tools

Check that CLAUDE.md documents the project's verification tools: build, lint, static analysis, test commands. Execute agents run them to validate their work. If they're missing, tell the user before proceeding — verification standards are project setup, not something to discover mid-build.

Documented is not the same as working. Smoke-test the tooling now, on the clean tree, before investing in spec and plan — a broken verification setup discovered at implementation has already cost a spec, several critique rounds, and a plan. Run each documented command once. Confirm it completes, passes (or note its baseline failures), and returns in reasonable time. Surface anything that hangs, errors, or floods output before proceeding.

### Project capabilities

Discover the project's own capabilities now and hold the manifest: skills, specialized subagents, governing docs, and any explicit routing hints. See **Lead with the project's own capabilities** for what to probe and how each phase uses it. This is discovery only — it never blocks, and a project that exposes none of it just runs the generic pipeline. Doing it before the spec means every downstream phase reads one manifest instead of re-probing. The run directory doesn't exist yet, so hold the manifest in context; persist it to `.speccy/<run-id>/capabilities.md` when the run is created in Phase 1c.

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
- **Name what convinced you.** When the user approves a load-bearing decision, ask them to say what persuaded them, and to notice whether they verified it or trusted that the agent sounded sure. One decision per gate, so it reads as a self-check rather than an interrogation.

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

The user may or may not have provided a starting description alongside the trigger.

**If they provided something** — a sentence, a feature request, an existing spec file — use it as the seed. A file they point to is the starting draft.

**If they provided nothing** (just "spec mode") — ask what they want to build. Suggest what helps at this stage: the problem, who it's for, known constraints, and how they'll know it's done. Don't require all of it — just enough to start the interview.

### 1b. Interview

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

Produce a first-draft spec from the interview answers using the template in `prompts/spec-template.md`, relative to this SKILL.md's directory. Fill in every section; remove the HTML comments.

**Do not restate CLAUDE.md.** Reference it by file/section when a constraint matters. Spell out a rule only where this feature diverges from it.

The **Assumptions** section captures the reasonable defaults chosen where the user's description was ambiguous. Unstated assumptions can't be challenged during critique, so surface them here.

The **Decisions & rationale** section is equally load-bearing. A choice whose reasoning isn't written down reads as an arbitrary default and can't be challenged. For each meaningful decision the spec commits to — a scope call, an approach, a contract or deliverable shape — record what was chosen, the viable alternatives weighed, and the deciding factor: why this and not that. Draw the reasoning out during the interview, but only where the user hasn't already given it. When a choice has a real alternative and the description doesn't explain the pick, ask why the user leans that way. Don't re-ask about a decision the input already settles — a stated preference, mandate, or existing convention is a complete rationale on its own. A decision is a deliberate pick among options; an assumption is a guess under ambiguity. Keep it spec-level: the why behind *what* to build, not code-level *how* — that is the plan's decision body. This section is also the source the wrap-up decision log distils from, so capturing rationale now spares the user reconstructing it from memory later.

Let the user read and edit the draft until satisfied. This is their first read, not a gate — pose no engagement question here. The pre-question comes at the 1d critique, once they have the draft in hand.

Create a feature branch before committing anything. Pick a short, descriptive name; if it collides with an existing branch, adjust it. Then `git checkout -b <branch>`.

Save to `specs/<slug>.md`. Commit the spec.

**Always ship a one-page digest alongside the full spec.** The full spec is the implementation reference; it hardens and grows dense through critique. It is not what a busy human reads to understand the work. Maintain a digest next to it, `specs/<slug>-digest.md`: the goal in 2–3 lines, the load-bearing decisions as a scannable list with a one-line why each, what gets built in what order, and the open spikes and risks. Every item references the full spec's section — e.g. "(§ Auth)" — so the reader drills in only where needed. The full spec stays canonical; the digest never restates it in full or diverges. Regenerate the digest whenever the spec materially changes, at minimum once the critique loop converges. At the user-review gate, point the user at the digest first, the full spec for depth.

Bilingual rule, inline: the canonical digest, like every doc, is English and git-tracked in the repo's normal docs location — never a non-English copy in a tracked path. If the user reads or edits in their own language, also write a translated copy, kept only in a gitignored `.users-files/` zone. Never put a translation in a tracked path, and never put the canonical doc inside `.users-files/`. Keep the two in sync — on conflict the English git-tracked copy wins — and leave the section references in English so they don't drift.

Generate a `runId`: lowercase kebab from the slug plus a `YYYYMMDD-HHmm` timestamp, e.g. `auth-refactor-20260609-1430`. Create `.speccy/<run-id>/` and ensure `.speccy/` is in `.gitignore`. Write the initial `state.json` (phase: `spec-critique`, with runId, slug, baseBranch, adversaryModel, builderModel, specPath). Write the runId to `.speccy/.current-runid` — plain text, no newline needed — so a later session finds this run without globbing. Persist the capability manifest from preconditions to `.speccy/<run-id>/capabilities.md`, so every downstream phase — and a resumed context — reads it from disk rather than conversation memory.

Tell the user about the directory: critique rounds, the plan, review notes, and run state land there, easier to open in an editor than to scroll in the terminal. Mention the path once here; don't repeat it at every save.

### 1d. Adversarial spec critique

Before investing in planning, the spec gets an independent review. Read `prompts/spec-critique.md`, relative to this SKILL.md's directory.

Run the loop to exhaustion before offering to clear or move on. The user picks findings each round, but one revised round is not a stopping point — keep critiquing until a round surfaces no valuable criticism, or 3 rounds run. Don't offer the clear or planning as a mid-loop alternative to the next round.

For each round (up to 3):

1. **Critique.** Spawn an adversary subagent (Agent tool) with the spec critique prompt and the spec path. Instruct it to write its review to `.speccy/<run-id>/spec-critique-round-N.md`. Use **opus** as the model override every round, or the user's pinned model.
2. **Present.** Before showing the critique, ask the user to predict it: the finding they'd bet the reviewer raises, or the part they'd defend least confidently (see **Steering away from cognitive surrender**). If they have none and you see a genuine soft spot, offer to look at it together; if the spec is solid, let it go. Then read `.speccy/<run-id>/spec-critique-round-N.md` (N from state.json), present the findings, and close the loop against their prediction — "you expected X; it flagged Y — surprised?". Point them to the file for the full text. Ask which findings to incorporate, and on the most consequential accept-or-reject call, ask what convinced them. If the round surfaced no valuable criticism, exit the loop.
3. **Revise.** Spawn a revise subagent (Agent tool) on **opus** with `prompts/revise.md`, the spec path, the critique file path, and the accepted findings. It rewrites the spec in place. When it completes, commit the updated spec with a message summarising the accepted findings — build the message from your own list, not the agent's return. Then run the next round to check the revisions and probe deeper.

After 3 rounds, proceed regardless, noting unaddressed feedback. Update state.json after each round (`specCritiqueRounds`). When the loop exits, set `phase: "planning"`.

**Mandatory exit gate — the cold-start flow trace.** Do not leave spec critique until at least one round has explicitly done the end-to-end, first-run dependency trace described in `prompts/spec-critique.md` — walking each primary flow step by step from an empty state and confirming every step's prerequisites already exist at that point — and every bootstrap, ordering, or mutually-exclusive-mechanism contradiction it surfaced is resolved. This is separate from section-by-section consistency. A spec can pass every consistency pass and still hide a step that depends on something only produced later, or two individually-sound choices that collide once the flow runs in order. Only tracing the actual flow catches these. Layered fold-ins across rounds can easily introduce such a contradiction; if they could have, run one more round whose sole job is this trace before declaring the spec ready. The same trace repeats at the Phase 2b plan review — planning can reintroduce an ordering dependency the spec didn't have.

Only once the loop has fully exited, reach the primary context-clearing point. The spec interview and critique are the heaviest interactive context in the run, and the approved spec now captures every decision in a committed file — the window can reset before planning, which is largely subagent-driven. Verify all run state is in files: state.json current, spec committed, external references recorded in the spec, not left in conversation. Then suggest the user `/clear` and re-invoke to resume at planning. If they'd rather continue, proceed to Phase 2.

## Phase 2 — Planning

Orient the user briefly on why planning is separate: the spec says *what* to build, the plan says *how*. Planning researches the codebase, discovers what exists, makes architecture decisions, and sets the order of operations. Without it, the spec's open questions carry into implementation and surface mid-build.

Planning research happens in a subagent, to keep codebase-reading noise out of the main context. Read `prompts/plan-research.md`.

Spawn a planning subagent (Agent tool) with the plan-research prompt, the spec path, the target plan path (`.speccy/<run-id>/plan.md`), and the path to `prompts/plan-spike.md` so the planner can prove any load-bearing mechanism — preferably by spawning a spike subagent, or inline. If the spec recorded external context (docs, standards, related projects), pass those references too. Read them from the spec, not conversation memory — planning may run in a freshly cleared context.

Pass the capability manifest (`.speccy/<run-id>/capabilities.md`) as well, with the phase preamble from `prompts/project-capabilities.md`. Instruct the planner to delegate codebase discovery to the project's research agents before any generic sweep, to consult the skills whose triggers match the area it plans, and to cite what each returns — so the plan is grounded in how the repo actually works.

When it completes, brief the user on the approach, key decisions, and risks from `.speccy/<run-id>/plan.md` — point them at the file rather than dumping it inline. Update state.json with `planPath` and `phase: "plan-critique"`.

**If the plan flags a contradicted spec assumption**, stop before the plan-critique loop and put a blocking choice to the user: accept the adjusted scope, or revise the spec and re-plan. A falsified assumption can invalidate scope, so this gate always fires.

### 2a. Adversarial plan critique

The spec is already hardened; now the plan gets its independent review. This loop runs autonomously — the user reviews the hardened plan in 2b. Read `prompts/plan-critique.md`, relative to this SKILL.md's directory.

For each round (up to 3):

1. **Critique.** Spawn an adversary subagent with the plan critique prompt, the plan path, and the spec path — the spec is context, not re-review material. Instruct it to write its review to `.speccy/<run-id>/plan-critique-round-N.md`. Use **opus** every round, or the user's pinned model. Read the critique file (N from state.json) to triage. No legitimate flaws → exit the loop.
2. **Spike, if the critique flags an unproven load-bearing mechanism.** The critic judges the plan's evidence but does not spike. When it flags a mechanism whose feasibility the plan hasn't proven, prove it before revising: spawn a spike subagent with `prompts/plan-spike.md` and the mechanism, writing its verdict to `.speccy/<run-id>/spike-round-N.md`. Read the verdict:
   - `confirmed` → carry the evidence into the revise step so the plan records it in the Assumptions check.
   - `refuted` or `unproven` → an unprovable load-bearing mechanism can invalidate scope. Treat it like a contradicted spec assumption: stop the loop and put a blocking choice to the user — accept a redesign around a mechanism that works, or revise the spec and re-plan. Like that gate, this one always fires.
3. **Revise.** Spawn a revise subagent on **opus** with `prompts/revise.md`, the plan path, the critique file path, and instructions to incorporate every finding. When it completes, the revised plan file is the truth — don't depend on its return.

After 3 rounds, exit regardless. Update state.json after each round (`planCritiqueRounds`). On exit, surface a one-line note — how many rounds ran, what changed — then proceed to 2b.

### 2b. User review

The highest-stakes human gate. Engage it deliberately (see **Steering away from cognitive surrender**):

- **Draw out the user first.** Before walking the plan, ask them to predict it: the choice they'd bet the critique pushed hardest on, or the decision they'd defend least confidently. If they have none and you see a genuinely shaky, load-bearing decision, offer to look at that one together — only if a real one exists. When you walk the plan, close the loop against their prediction and what the 2a critique actually changed: "you flagged the retry design; the critique reworked the idempotency key instead — surprised?".
- **Then present, candidly.** Have them read the plan file directly rather than re-dumping it. Walk the two or three load-bearing decisions; for each, surface the alternative the plan rejected and its best argument. Flag where the plan is genuinely uncertain. Don't let a confident passage stand in for a verified one.
- **Name what convinced you.** On the single most consequential decision, ask what persuaded them — and whether they checked it or are trusting the plan's confidence.

**Recommend a builder.** With the plan's shape clear, tell the user whether sonnet (the default) or opus suits this build, and why. Weigh complexity and novelty, how much is left to build-time judgment versus mechanical execution, and how tightly the plan pins down each task. They set `builderModel`.

The adversary has cleaned up the obvious issues; this gate is the user's chance to raise concerns it missed, adjust the approach on their own knowledge, or approve as-is. Iterate until satisfied. On approval, set `phase: "implementation"` in state.json.

Before implementation, verify all run state is in files: state.json current, spec and plan committed, review decisions reflected in the plan. The main clear already happened after the spec, so this one is conditional — if plan critique and review accumulated heavy context, suggest `/clear` and re-invoke to resume at implementation; if planning stayed lean, proceed.

## Phase 3 — Implementation

Invoke the `plan-execution` skill directly via the Skill tool from the main conversation. Pass the plan path as `args.planPath` — not the full plan text; the workflow reads the file itself, which keeps the call small and the plan editable mid-run. Pass the builder model as `args.model`, from state.json's `builderModel`, default sonnet. The breakdown agent inside plan-execution always uses opus; only execute/integrate/verify pick up the override.

Do not wrap this in an Agent subagent — Agent subagents lack `Workflow`, so the call breaks. Plan-execution already backgrounds its own work; only the final result returns.

The build kickoff is a handoff, not a gate (see **Steering away from cognitive surrender**): 2b was the engagement point, so pose no pre-question and announce no check here. If you frame the handoff at all, keep it to a passing line: the build now runs autonomously and the user stays **on** the loop — free to watch it work and step in — rather than walking away from it, which is the vibe-coding failure mode speccy exists to avoid. "In the loop" belongs to the spec and plan gates, where the user decides each acceptance; the build is supervision, not decision-by-decision. Then start the build.

**Push for parallelism where the plan allows.** Plan-execution's breakdown defaults to sequential steps, and a purely serial run is the single biggest wall-clock cost. When invoking plan-execution, augment the breakdown instruction to parallelize genuinely independent work: group tasks that touch disjoint files with no data dependency into parallel steps, each mapping to a spec or plan acceptance criterion. Authoring independent units concurrently — a test class per production class, separate feature files — is the clearest win. State the caveat to the breakdown: if the project verifies against a single shared environment (one scratch org, one database), the deploy/test step of parallel tasks contends on that resource and effectively serialises. Parallelism cuts authoring time, not the shared-environment round-trip. Parallelise the authoring; let integration and verification funnel through the shared resource.

**Route the project's capabilities into each task.** Also instruct breakdown to attach to every task the skills whose triggers match that task's files — an explicit "consult these before writing" list the build agent activates itself. It can invoke a Skill; it cannot dispatch an Agent. Placement and existence questions — "where does this belong", "does a primitive for this already exist" — are different: a build agent inside the workflow can't spawn a research agent to settle them, so resolve those up front with the project's hunter agents and bake the answer into the task description. Pass the capability manifest path (`.speccy/<run-id>/capabilities.md`) so breakdown has the roster. If the manifest is empty, this augmentation is a no-op.

When the workflow reports complete, do not advance on its "gates pass" summary — a build agent can satisfy a gate by fabricating or inverting a rule and still report green. Re-run the project's load-bearing gates yourself — build, lint, static analysis, tests, from CLAUDE.md — and confirm the actual tool output. Use the project's documented harness the way CLAUDE.md specifies it: if CLAUDE.md names an MCP tool for a gate, invoke that MCP tool rather than shelling out to the raw CLI; the CLI wrapper is a fallback, not the default. If a gate fails, the run isn't done. Carry the real tool output into a fix round — the Phase 4 implementation-fix agent handles exactly this — re-run the gates after it, and repeat until you have seen them pass. Only then set `phase: "review"` in state.json and continue.

**Economise the round-trips.** They dominate wall-clock when the gate hits a remote environment — a scratch org, a CI runner, a container. The trust rule (see it pass yourself) is non-negotiable; what's negotiable is paying the full remote round-trip on every intermediate step.

**Test re-run scope — the hard rule, do not violate:**

- While fixing, re-run only the specific tests you just touched or that were failing — never the whole suite. Re-running every test to confirm a one-line fix in one test is waste; it does not happen.
- Run the full suite of ALL tests exactly once, at the very end, after every fix is in. That single final run is the completeness gate. Not per-fix, not per-round.
- Concretely: fix test/class X → run X and its production class's targeted tests → green → move on. Only when the fix list is exhausted, run the entire suite once to confirm nothing regressed.
- For intermediate checks inside a fix loop, prefer the cheapest signal that still proves the fix: compile, type-check, `--dry-run`, the single changed test. Batch several findings into one fix agent and re-check once, rather than re-gating after each small edit.

If the implementation workflow exits incomplete, stop the pipeline. Report what's done and what remains — the user has a branch with partial progress. State.json stays at `phase: "implementation"` so the run can resume later.

## Phase 4 — Implementation review

After implementation, the code gets an independent review across several lenses, run in parallel. Completeness is already verified by the task execution skill; this phase is about quality, spec fidelity, and fit.

### The lenses

Each round spawns the reviewers as **parallel** subagents — one message, one Agent call each — all **read-only**; none edits code. Each writes its findings to its own file, `.speccy/<run-id>/review-round-N-<lens>.md`. Pass each the base branch so it can diff `<base-branch>...HEAD`. All prompt paths are relative to this SKILL.md's directory.

Pass each bespoke lens `prompts/review-output-contract.md` alongside its own prompt. It standardises the finding shape so triage is mechanical, and makes writing the file a hard contract: a lens that runs out of room mid-verification still leaves a file, marking the unconfirmed candidate `PLAUSIBLE`, rather than returning nothing. `code-review` is a built-in skill that won't read the contract; the orchestrator applies the same shape when normalising its findings into the code-review lens file.

- **Code review** — the built-in `code-review` skill, targeting `<base-branch>...HEAD` at `high` effort, no `--fix`, no `--comment`. It covers correctness and general code quality; the bespoke lenses handle only what it can't. Run it every round.

  Invoke it directly in the main conversation via the Skill tool, not inside an Agent subagent — it spawns its own subagents, and wrapping a multi-agent skill stalls it. Parse its output tolerantly; the shape may change. Normalise its verdicts into the shared finding shape and write `review-round-N-code-review.md` yourself.
- **Project review gate** — the repo's own review gate, if it ships one: a `/review`-style skill, project-defined reviewer agents, or a `.claude/review.config.json`. When present, run it as an extra lens. It encodes the house security bar, thresholds, and invariants a generic reviewer can't replicate — where it exists it is the highest-signal lens in the panel. Run it the way the repo documents it: its own agents, models, and thresholds, not overridden. Like `code-review`, a project gate is usually itself multi-agent, so invoke it directly in the main conversation, not wrapped in an Agent subagent — same reason, and see **Subagent results: trust files, not returns**. It is spec-blind: it checks house quality, not whether the build meets this spec's criteria, so it complements the spec-fidelity lens, never replaces it. Normalise its findings into the shared shape and write `review-round-N-project-gate.md` yourself. The triage step dedups its overlap with `code-review`, codebase fit, and local-doc adherence like any other lens. No gate in the repo → skip this lens.
- **Spec fidelity** — `prompts/review-spec-fidelity.md`, with the spec path. Does the code satisfy the spec's completion criteria and intent?
- **Tests** — `prompts/review-tests.md`, with the spec and plan paths. Test-strategy adherence, test quality, and consolidation of new tests against the existing suite.
- **Codebase fit** — `prompts/review-codebase-fit.md`. Does this change worsen an already-imperfect area or repeat an existing smell? Judged against the touched files' current state, not the diff alone.
- **Local-doc adherence** — `prompts/review-local-docs.md`. Violations of the repo's governing docs, including CLAUDE.md — deliberately re-checked even though code-review covers it too. Pass it the capability manifest so it judges against the project's actual skills and governing docs; where a house skill states a rule, a violation is a finding.
- **Suppressions** — `prompts/review-suppressions.md`. Extremely harsh on any linter, analysis, type, or test-gate suppression the change adds or leans on. Each must be watertight or it is a finding.
- **Comments** — `prompts/review-comments.md`. Comments the change adds or edits that restate the code, narrate edit history, or pad a real point. Proposes deletions only; the fixer mends any seam.

Run the bespoke lenses on **opus**, except suppressions and comments on **sonnet** — a mechanical scan and a focused style pass. A pinned adversary model overrides all of them; `code-review` and any project gate manage their own.

### The loop (up to 3 rounds)

1. **Review.** Spawn the bespoke lenses as parallel subagents in one message, and invoke the inline gates in the main conversation — `code-review` every round, and the project gate if the repo ships one; their own fan-out overlaps with the spawned lenses. Round 1 is a cold review. Rounds 2+ are fix-verification: re-point each lens at "verify the round-(N-1) fixes hold, and catch any regression they introduced", and always pass the `.speccy/<run-id>/deferred.md` list as accepted decisions it must not re-raise. Run all lenses every round by default. Drop a lens only when the fix round provably didn't touch its surface — e.g. skip local-doc adherence when nothing under a governing doc changed — and note any lens you drop and why.

   For the spawned lenses, don't branch on a returned summary (see **Subagent results: trust files, not returns**) — confirm the file exists. Self-heal a stalled lens: if its file is missing after it reports complete, `SendMessage` that agent to write its findings file as its final action, marking anything unconfirmed `PLAUSIBLE`, rather than re-spawning from scratch. Once every lens file is present — the spawned files plus the inline-gate files you wrote — read them (N from state.json) and move to triage.
2. **Triage & merge.** Consolidate the findings yourself — drop false positives, de-duplicate overlaps, resolve contradictory suggestions. Don't spawn a separate agent for this. Every lens emits the shared shape, so merge on `file:line`. Two lenses landing on the same anchor is a convergence signal: independent lenses pointing at one spot raise confidence — weight those up instead of collapsing them to a lone finding. As a backstop for anything re-raised despite instructions, drop findings already in `.speccy/<run-id>/deferred.md`; a deferred finding must not churn back into the fix set. Give each surviving finding a disposition:
   - **Fix** — route it to the fixer this round. Where the finding is a copied smell, tell the fixer whether to diverge (fix cleanly here) or fix wider (also fix the existing instance). A wider fix grows the diff, so choose it deliberately.
   - **Defer** — legitimate but out of scope for this PR. Append it to `.speccy/<run-id>/deferred.md`: what, and why deferred.

   A suppression finding is effectively never Defer — remove it or make it watertight, this round. **Exit the loop when nothing is dispositioned Fix.**

   You make these disposition calls yourself as the loop runs — the review is autonomous. Surface them at wrap-up so the human still reviews the judgment: deferrals in the deferred list, and any divergence-from-pattern or wider-than-the-diff fix in the summary and decision log.
3. **Fix.** If nothing is dispositioned Fix, skip to the next round's review, or exit. Otherwise read `prompts/implementation-fix.md` and spawn a fix subagent with that prompt, the Fix findings — point it at the lens files, and state any diverge or fix-wider instruction — the spec path, and the plan path. It makes the changes and commits. After it commits, re-run the load-bearing gates yourself and confirm the actual output before the next round. Never advance on the fix agent's claim that gates pass — gates passing doesn't prove coverage held; a dropped test still passes.

After 3 rounds, proceed regardless. Update state.json after each round (`reviewRounds`) and set `phase: "complete"` when done. Any `deferred.md` items surface at wrap-up.

## Wrap-up

A completed run is a handoff. Speccy has built and self-reviewed the work; the verdict is the user's, reached through the diff, the artefacts below, CI, E2E, or running it themselves. Speccy stops at a reviewable PR — it does not merge, certify, or run end-to-end verification. Report what was built and leave the review to the user. When pointing them at the diff, suggest they read it as if a contributor they do not fully trust wrote it — the standard they'd apply to any other author (see **Steering away from cognitive surrender**).

When all phases complete, report concisely — in the chat and to `.speccy/<run-id>/summary.md`, so the handoff survives a context clear and sits with the run's other artefacts. Cover:

1. **Summary** — what was built, how many critique and review rounds ran, what changed, and that the branch is ready for review.
2. **Decision log, co-authored** — distil the key decisions from the critique and review rounds into `specs/<slug>-decision-log.md`, including any review-phase divergence from an existing pattern. These are usually implementation-specific choices, not the durable architecture decisions an ADR captures for the wider team. Each entry: what was proposed, what was decided, why. Before writing it, ask the user to restate the rationale for one or two decisions in their own words, and build those entries from their account (see **Steering away from cognitive surrender**). A decision the user cannot reconstruct is the surrender signal worth catching here, while the code is fresh and they are about to own it. Commit the decision log.
3. **Deferred feedback** — substantial feedback set aside: findings the user skipped at spec critique, plus review findings deferred in `.speccy/<run-id>/deferred.md`, with the why. Candidates for follow-up issues outside this PR.
4. **Retrospective** — if the task execution skill produced one, save it to `.speccy/<run-id>/retrospective.md` and surface the cross-cutting patterns. If it has a `## Repo-doc suggestions (CLAUDE.md / ADR)` section, present those for the user to accept or decline — never auto-applied.

If the pipeline exited early on an implementation failure, report what's done and what remains. The user has a branch with partial progress.
