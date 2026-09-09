# Phase 1: Specification

_Paths like `prompts/spec-template.md` are relative to the skill directory (the parent of this `phases/` folder), the same anchor `SKILL.md` uses. **Bold section names** (e.g. **Steering away from cognitive surrender**) refer to `SKILL.md`, which is always loaded; read it for the cross-cutting rules this phase relies on._

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

Produce a first-draft spec from the interview answers using the template in `prompts/spec-template.md` (relative to the skill directory). Fill in every section; remove the HTML comments. Write it to the standard in `prompts/writing-style.md`: a draft that starts dense stays dense, because every later step is a revision of it.

The template defines what each section holds. Two things about **Decisions & rationale** are the interview's job rather than the template's:

- **Draw the reasoning out, but only where the user hasn't given it.** When a choice has a real alternative and the description doesn't explain the pick, ask why they lean that way rather than recording it silently. Don't re-ask about a decision the input already settles: a stated preference, mandate, or existing convention is a complete rationale on its own.
- **Capture it now, because the decision log distils that section.** Rationale recorded here is rationale the user isn't reconstructing from memory at the end of the run.

Create a feature branch before committing anything. Pick a short, descriptive name for the work; if it collides with an existing branch, adjust it. Then `git checkout -b <branch>`.

Save to `specs/<slug>.md`.

Start `specs/<slug>-decision-log.md` next to it (see **The decision log runs with the run**). Open it with what the run is working from: the seed and how it was treated, and any decision already taken that the spec's Decisions & rationale cannot hold, such as a point where the seed was overruled. If the interview produced no such history, the file opens with the seed alone and stays short. Commit both.

Generate a `runId`: lowercase kebab from the slug plus a `YYYYMMDD-HHmm` timestamp (e.g. `auth-refactor-20260609-1430`). Create the run with `state.mjs init --run <id> --slug <slug> --base-branch <base> --spec-path specs/<slug>.md --decision-log-path specs/<slug>-decision-log.md` (add `--adversary-model` / `--builder-model` if the user pinned either). This writes `state.json` at `spec-draft`, writes `.speccy/.current-runid` so a later session finds the run without globbing, and gitignores `.speccy/`.

Tell the user about the directory: critique rounds, the plan, review notes, and run state will be saved there so they can open them in their editor rather than scrolling terminal output. Mention the path once here; don't repeat it at every save.

Now present the draft and **stop**: the user reads and edits it until satisfied, and 1d's critique does not begin until they hand it on. Commit any edits they make. This is their first read rather than a gate, so pose no engagement question here; the pre-question comes at the 1d critique, once they have the draft in hand. Put the hand-off prompt last in the turn and wait, the way the gate stops do. The run sits at `spec-draft` for the whole read, so a `/clear` mid-read resumes here; when the user hands it on, `state.mjs advance --run <id> spec-critique` and continue to 1d.

### 1d. Adversarial spec critique

Before investing in planning, the spec gets an independent review. Read `prompts/spec-critique.md` (relative to the skill directory).

Run the loop to exhaustion before offering to clear or move on. The user is in the loop on which findings to incorporate each round, but a single revised round is not a stopping point: keep critiquing until a round surfaces no valuable criticism *and* the readability pass has been checked by a round, or 3 rounds run. Don't offer the clear or planning as a mid-loop alternative to the next round.

For each round (up to 3):

1. **Critique.** Start the round with `state.mjs record-round --run <id> spec-critique`; the new count is this round's **N**. Spawn an adversary subagent (Agent tool) with the spec critique prompt and the path to the spec. Instruct it to **write its review to `.speccy/<run-id>/spec-critique-round-N.md`**. Use **opus** for the model override on every round (or the user's pinned model, if they set one). Tell it whether the readability pass has run (read `readabilityPasses` from state.json): before the pass it critiques substance only and skips the reader lens, since the pass rewrites the prose anyway and the user shouldn't spend triage on findings that get fixed regardless.
2. **Present.** Before showing the critique, ask the user to predict it: the finding they'd bet the reviewer raises, or the part of the spec they'd defend least confidently (see **Steering away from cognitive surrender**). If they have none and you can see a genuine soft spot, offer to look at it together; if the spec is solid, let it go. Then read `.speccy/<run-id>/spec-critique-round-N.md` (N from state.json), present its findings, and close the loop against their prediction ("you expected X; it flagged Y. Surprised?"). Point the user to the file for the full text. Ask which findings to incorporate, and on the most consequential finding they choose to adopt, ask what convinced them: adopting the adversary's call is where borrowed confidence lives; a finding they reject on their own judgement is their call, so leave it. Log their answer in their words, along with any position the round reversed. If the round surfaced no valuable criticism, the critique is done, but don't leave the loop until the readability pass has run and a round has read the result (see below).
3. **Revise.** Spawn a revise subagent (Agent tool) **on opus** with `prompts/revise.md`, the spec path, the critique file path, and the list of accepted findings. The subagent rewrites the spec in place. Once it completes, commit the updated spec with a message summarising the accepted findings you incorporated: you already have that list, so build the message from it rather than from the agent's return. Then run the next round to check the revisions and probe deeper.

**The readability pass runs after round 1, once per run, whether or not that round produced a revision.** Spawn a subagent **on sonnet** with `prompts/readability-pass.md`, `prompts/writing-style.md`, `prompts/spec-template.md`, the spec path, and `.speccy/<run-id>/readability-spec.md` as its change-note path. It rewrites the spec for its reader and changes nothing the spec says. Commit it separately from the round's revision, so the user can read a rewrite-only diff, and record it with `state.mjs record-readability --run <id> spec` so a resumed context doesn't run it twice. Sonnet is the tier because rewriting to a written style guide is execution against an instruction, and the critique round that follows is what checks the result; a pinned `adversaryModel` doesn't govern this agent, which isn't a critic.

**A critique round always follows the pass.** A rewrite is the one step that can silently drop a load-bearing fact, and a critic reading the rewritten spec cold is what catches that: missing deliverables and unstated constraints are already its first two finding classes. So the pass never lands after the last round: if round 1 surfaced no valuable criticism, run the pass anyway and let round 2 check it. **Don't give that round the change note.** A critic told what was cut checks those cuts and reads past everything else, and the cut nobody declared is the failure this round exists to catch. `readability-spec.md` is for you, the user, and the wrap-up: tell the user what the pass cut before they read the round's findings.

After 3 rounds, proceed regardless. (Step 1's `record-round` keeps `specCritiqueRounds` current.)

**Leaving the phase.** `state.mjs advance --run <id> planning` refuses until the mechanical exits hold. One thing it can't check, so do it first:

- the findings the user skipped, and any the 3-round cap left unaddressed, go in `.speccy/<run-id>/spec-critique-skipped.md` with the reason. The wrap-up reports them, and the `/clear` suggested just below deletes anything held only in conversation. Keep them out of `deferred.md`: the review panel is told not to re-raise anything in that file, and a skipped spec finding is a decision about the spec rather than acceptance of the matching defect in the code.

Only once the loop has fully exited, reach the primary context-clearing point. The spec interview and critique are the heaviest interactive context in the run, and the approved spec now captures every decision in a committed file, so the window can reset before planning, which is largely subagent-driven. Verify all run state is in files (state.json current, spec committed, external references recorded in the spec rather than left only in conversation), then suggest the user `/clear` and re-invoke to resume at planning. If they'd rather continue, proceed to Phase 2 (`phases/plan.md`).
