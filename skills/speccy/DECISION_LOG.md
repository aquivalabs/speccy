# Speccy

Full pipeline: specification, adversarial spec critique, planning, adversarial plan critique, implementation, adversarial implementation review.

Instructions are in SKILL.md. This file records design decisions.

## Design decisions

### No triage agent (2026-06-09)

Earlier versions spawned a separate triage subagent after each adversarial critique to classify feedback as substantial vs trivial before showing it to the user. Removed because:

- The triage agent has no special knowledge the adversary lacks -- it just re-reads the same feedback with a different hat on. One agent instead of two per round is simpler.
- There was no triage prompt in `prompts/`, so the triage step was underspecified while the adversary prompts were well-crafted.
- The user sees the feedback anyway and makes the final call on what to incorporate. A noisy finding the user ignores costs less than a filtering layer that accidentally drops a real one.

If adversary output turns out to be too noisy in practice, reintroduce triage -- but as a self-classification instruction in the adversary prompt rather than a separate agent.

### Why `.speccy/` is gitignored (2026-06-09)

Intermediate artifacts (critique rounds, the plan, review notes) are written to `.speccy/<run-id>/` for two reasons:

1. **Human reference during the run.** Scrolling through terminal output to re-read a multi-paragraph critique is painful. Files in a directory are easier to open side-by-side, reference while editing the spec, and compare across rounds.
2. **Future resumability.** The state on disk is scaffolding for crash recovery -- if a session dies, the files record what's been done. Resume logic isn't built yet; for now, a dead session means restarting from scratch.

Both reasons are about the process, not the product. Once the feature is implemented and merged, nobody reads these files again. Committing them would add noise to the repo history, so they're gitignored.

### Sonnet as default adversary model (2026-06-09)

The adversary's job is narrow and well-prompted: read one artifact, find specific problems. Sonnet is more disciplined about returning nothing when there are no legitimate flaws, while Opus tends toward thoroughness that produces hypothetical findings -- exactly the noise that made a triage agent seem necessary. With up to 9 adversary calls across a full pipeline, the cost and speed difference also adds up. Opus is offered as a per-run override for complex or high-stakes work.

### Three rounds is the cap, not the norm (2026-06-09)

Each critique phase allows up to 3 rounds, but the loops exit early -- when the adversary finds no legitimate flaws, or the user skips all feedback. Most runs should settle in 1 round. The 3-round cap exists for complex specs where the first critique surfaces issues whose fixes introduce new gaps.

### Implementation review fixes without user approval (2026-06-09)

The implementation review (Phase 5) fixes issues directly without consulting the user. The user already approved the spec and plan -- the adversary-builder loop in Phase 5 is internal quality control, no different from a single builder's internal deliberation. If an issue requires a design change rather than a mechanical fix, it's skipped with an explanation, since design decisions were settled in earlier phases.

### CLAUDE.md as the project constitution (2026-06-10)

Spec-kit introduced a "project constitution" — a file defining non-negotiable project standards (linting, static analysis, test commands, conventions) that gets injected into every agent context. CLAUDE.md already serves this role. A separate constitution file would be redundant indirection. If users want to factor standards into separate files referenced from CLAUDE.md, that's their call.

Both speccy and plan-execution now require verification tools to be documented in CLAUDE.md as a prerequisite. Execute agents run those tools before committing. This means the execute prompt doesn't need to tell agents how to discover verification tools — they just follow what's documented.

### No session recovery yet (2026-06-09)

If a session dies mid-pipeline, there's no way to resume. The `.speccy/<run-id>/` directory has the intermediate state, but nothing reads it back to pick up where things left off. A dead session means restarting from scratch — though the spec and any committed critique revisions survive on the feature branch.

This is worth building eventually. For now, the priority is getting the pipeline working end-to-end.

### Plan critique loop runs autonomously (2026-06-11)

Earlier the plan critique loop, like the spec critique loop, asked the user each round which findings to incorporate. In practice the user accepted essentially every suggestion — the per-round Q&A added friction without adding signal. The plan critique now runs autonomously: the revise agent incorporates every adversary finding, the loop exits when the adversary returns no flaws (or after 3 rounds), and the user reviews the hardened plan at 2b.

The spec critique loop keeps user-in-the-loop. Specs encode intent — the human's judgment about what's in scope, what tradeoffs are acceptable, what the feature is _for_ — and the adversary's suggestions there often warrant pushback. Plans are downstream of an approved spec, so adversary findings on the plan are more mechanical.

Implementation review (Phase 4) was already autonomous for the same reason.

### No explicit pause prompt at phase boundaries (2026-06-11)

Earlier versions told the user at every phase boundary: _"Phase X done. If you'd like to clear context, say `pause` — otherwise I'll proceed."_ Removed because state.json is already written at every phase boundary, so the user can `/clear` and re-invoke whenever they want without permission. Asking at every boundary added friction without adding capability. The intro now mentions resumability once; the rest of the pipeline just flows.

### Phase 3 invokes plan-execution directly, not via an Agent subagent (2026-06-11)

Earlier versions told Phase 3 to spawn an Agent subagent to invoke plan-execution, on the theory that the subagent would keep implementation noise out of the main context for the Phase 4 review. Two problems:

1. **The isolation was already happening.** Plan-execution drives the `Workflow` tool, which runs breakdown / execute / integrate / verify in a backgrounded execution. Only the final structured result returns to the caller. The Agent wrapper added a layer that didn't isolate anything Workflow wasn't already isolating.
2. **The wrapper broke the handoff.** Agent subagents don't have `Workflow` in their toolset (not even via `ToolSearch`), so the wrapped invocation fails before reaching plan-execution.

Phase 3 now calls `Skill("plan-execution")` directly from the main conversation. Main-context footprint is the skill prompt, a few setup tool calls, the `Workflow(...)` launch, and the completion notification — small enough that Phase 4 still has headroom.

### Separate `builderModel`, default sonnet (2026-06-11)

The `adversaryModel` setting covered critique/review agents but didn't propagate to plan-execution's build agents — those silently inherited the session model, which could be Opus. A small spike caught this when a 13-task build ran on Opus despite the user setting sonnet for adversaries.

State.json now carries a separate `builderModel` (default sonnet, same opus-override pattern as the adversary). Phase 3 passes it as `args.model` to plan-execution. The plan-execution breakdown agent always uses Opus regardless — task decomposition is the hardest-thinking phase and benefits from the strongest model. Only execute/integrate/verify honour the override.

### Plan-execution takes `planPath`, not inline plan text (2026-06-11)

The previous handoff embedded the full plan text as `args.plan` in the `Workflow(...)` call. For a ~28KB plan that meant a large, duplicated tool call (the plan was already on disk at `.speccy/<run-id>/plan.md`). The workflow scripts now accept `args.planPath` and instruct the breakdown / verify agents to read the file themselves. Side benefit: edits to the plan mid-run are picked up, since each agent reads at invocation time rather than from a frozen snapshot.

### Renamed from adversarial-coding (2026-06-09)

"Adversarial coding" sounds like the skill writes adversarial code. The adversarial part is the review, not the coding. "Spec-driven" reflects the actual value: forcing a spec before touching code.

### Rebranded to Speccy (2026-06-22)

Renamed the skill from `spec-driven` to `speccy`. "Speccy" was the affectionate nickname for the Sinclair ZX Spectrum, and it plays on "spec" — the artifact this pipeline forces before any code. The name is shorter to type, more memorable, and the invocation now prints a ZX-Spectrum-flavoured banner (block wordmark plus the Spectrum rainbow stripes) as a bit of character. The skill directory and the `.speccy/` run-state directory moved to match; the descriptive `specs/` output directory keeps its name, since it still holds specs.

### Banner invoked by absolute path, matched by a path-tail wildcard (2026-06-22)

The banner command was `bash .claude/skills/speccy/banner.sh` — a relative path, allow-listed by exact string. Two failures: the Bash tool's working directory persists across calls, so a drifted cwd made the relative path unresolvable; and the obvious workaround (`cd … && bash …`) no longer matched the exact allow rule, so it would prompt — defeating the auto-approve. The relative path was also flat wrong for a plugin install, whose files live under `~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/skills/speccy/`, nowhere near the project's `.claude/skills/`.

Fix: invoke `banner.sh` by its absolute path (resolved from the skill's own directory, the same idiom the prompt files use), and allow-list `Bash(bash *skills/speccy/banner.sh)`. Bash permission matching is command-*string* matching, not path-*glob* matching, so a single `*` spans `/` and the rule matches both a project install (`…/.claude/skills/speccy/banner.sh`) and a plugin install (`…/cache/…/skills/speccy/banner.sh`). `**` is not supported in Bash patterns — only `*` — so the path-tail wildcard is the mechanism. The banner is also now explicitly best-effort: if it fails or would prompt, the run proceeds without it, so a cosmetic flourish can never block the pipeline.

### Run discovery via `.current-runid`, not Glob (2026-06-22)

Resume worked by globbing `.speccy/*/state.json`, and the skill told itself to "read, write, and glob `.speccy/` state with the Read/Write/Glob tools, never Bash." But the Glob tool isn't provided in every session — when it's absent, resume discovery had no path. (A prior session had already improvised a `.speccy/.current-runid` file as a workaround, undocumented.)

Fix: formalise the pointer. On run creation the skill writes the runId to `.speccy/.current-runid`; on trigger it reads that one file to find the active run, needing only Read — no enumeration, no Glob. The pointer tracks the most recent run; earlier runs stay in `.speccy/` for manual revisiting. This trades multi-run auto-discovery (rare — usually one run is active) for working in every session regardless of toolset.

### Round cap raised from three to four, ending on doubled Opus (2026-06-22)

Supersedes "Three rounds is the cap, not the norm" (2026-06-09). Each adversarial loop now allows up to **4** rounds, and the model ladder ends on a doubled Opus (see the ladder ADR below). The doubled top is the reason for the extra round: round 4 is a fresh-context Opus re-reviewing the artifact *after* round 3's fixes — a genuine independent pass, not a re-run. Because every loop still early-exits when a round surfaces no valuable criticism, the 4th round only runs when round 3 was still finding legitimate things, which is exactly when another pass is warranted. The early-exit means most runs still settle in one round; the cap is for complex artifacts whose fixes introduce new gaps.

### Per-phase adversary model ladder (2026-06-22)

Supersedes "Sonnet as default adversary model" (2026-06-09). The adversary model now defaults to a per-phase ladder indexed by round number, rather than a flat Sonnet:

- **Spec critique** and **plan critique** — `sonnet → sonnet → opus → opus`. These artifacts are short and high-leverage, and a cheap model's false findings cost more triage than they save on knowledge-heavy domains (e.g. Salesforce), so the bottom of the ladder is skipped.
- **Implementation review** — `haiku → sonnet → opus → opus`. The diff is large and many findings are mechanical, so cheap-first earns its keep.

A single pinned model remains available as a per-run override for complex or high-stakes work. The builder model is tracked separately (default sonnet); see "Separate `builderModel`" (2026-06-11).

### Spec and plan critique run all-opus, three-round cap (2026-06-22)

Supersedes the spec/plan-critique portions of "Round cap raised from three to four" and "Per-phase adversary model ladder" (both 2026-06-22). Spec critique and plan critique now run **opus on every round, capped at 3 rounds** — and the revise ("creator") agent that applies findings runs on opus too, not just the adversary.

Rationale, from a Salesforce run where the escalating ladder underperformed: the durable, high-value findings clustered in the opus passes, while sonnet round 1 contributed mostly hygiene plus one mis-prioritised finding that a later round had to undo — net churn, not signal. The single highest-value finding (a zero-drop rollup bug) surfaced only once the model reached opus. On knowledge-heavy domains the cheaper tiers cost more in false-positive triage and revision rework than they save, so the whole short, high-leverage loop runs on opus. Running the revise agent on opus too keeps the artifact's edits at the same standard as the critique that prompted them.

The escalating ladder and the four-round cap survive **for implementation review only** (`haiku → sonnet → opus → opus`): that diff is large and many findings are mechanical, so cheap-first still earns its keep and the doubled-opus final pass justifies the 4th round. A single pinned model remains available as a per-run override.

### Subagent results read from file, not the returned summary (2026-06-22)

An adversary subagent's returned summary can arrive misrouted — in one run, a critique round's findings came back under the *previous* revise agent's completion notification, written in that agent's voice, with no separate notification for the critique agent itself. Triaging from that relayed summary would have mis-stated the findings. A first pass fixed the two critique-triage steps, but the bug recurred: the revise and planning steps still leaned on returned summaries, and the orchestrator kept *narrating* the misrouting ("that's the round-2 revise agent's ID reporting round-3 content…") instead of silently reading the right file — surfacing the confusion to the user.

Fix: a single authoritative rule — **"Subagent results: trust files, not returns"** in SKILL.md — now governs every phase. A completion's apparent identity (which agent, which round) carries no information; the deterministic file, keyed by the round number from state.json, is the only source of truth. Concrete consequences threaded through the steps:

- Every agent writes its output to a known file; the orchestrator reads that file and never branches control flow on a returned summary or a notification's label.
- Revise steps no longer parse the agent's return for the commit message — the orchestrator builds it from the accepted-findings list it already holds.
- Planning treats `plan.md` as truth; the returned summary is only a convenience for the briefing.
- The orchestrator must **not** narrate or diagnose misrouting — a mislabelled notification is expected noise, read the correct file and carry on.

This is a second reason the round files exist (see "Why `.speccy/` is gitignored").

### Plans must prove load-bearing mechanisms, not assert them (2026-06-23)

On a Salesforce run, the spec mandated that an Account-merge correction happen "synchronously, in the same transaction." Planning researched the merge against a live org and the plan critique even ran live probes — but they confirmed *adjacent* facts (the Contact trigger fires mid-merge; the reparented Contacts are query-visible afterward) and never exercised the one risky action the mechanism depended on: a DML update of the merged Account from within an Account `after delete` trigger. The platform forbids exactly that (`SELF_REFERENCE_FROM_TRIGGER`). The infeasibility surfaced only at build time, where it triggered three corrective tasks, an async Platform-Event redesign, and — before the read-only rule landed — an edit to the spec. The user resolved it in one sentence by descoping merge.

The lesson: an empirical probe that verifies a precondition is not proof the mechanism works, yet it reads like proof and sails through review. A load-bearing assumption about platform/timing/API behaviour is the kind that survives every paper review and then collapses against reality.

Fix, spread across three prompts so the assumption is caught progressively earlier:

- **`spec-template.md`** — the Open-questions guidance now names *feasibility assumptions* (often hiding in Constraints or Completion criteria, like "corrected synchronously") and tells the author to mark each for a planning spike.
- **`plan-research.md`** — before committing the plan to any non-trivial mechanism not already demonstrated in the codebase, the planner must run a feasibility spike that performs the **riskiest action itself** against the real environment, not the facts around it. If the mechanism is infeasible, design around it — or, if the spec mandates it, stop and flag for spec revision. Spike code is throwaway.
- **`plan-critique.md`** — an unproven load-bearing mechanism is now a named high-severity finding; the critic must confirm the plan's evidence exercised the actual risky action, and demand a spike if it did not.

Complementary to "Build agents may not edit the spec or plan" in plan-execution (2026-06-23): that rule makes the build *halt* when it hits an impossibility; this one keeps the impossibility from reaching the build at all. Together they close the loop the merge saga exposed — prove it can be done before planning around it, and refuse to improvise if it can't.

### E2E and final verification are out of scope; the initiating human owns review (2026-06-23)

Speccy produces reviewable artefacts — spec, plan, ADR, diff, PR — and the human who started the run reviews them through every available tool: the diff, the artefacts, CI, E2E, running it themselves. Speccy does not run end-to-end verification and is not a merge gate.

Scope makes this the right line. Speccy targets scoped changes on live repos, where a human reviewer and CI already stand. Running E2E inside Speccy would duplicate CI and couple the skill to per-project app-running infrastructure (browsers, test envs, fixtures) — the environment-specific machinery Speccy deliberately delegates to CLAUDE.md verification commands. E2E belongs in CI on the PR, one instrument in the reviewer's kit.

This extends the philosophy that already puts the human at the spec and plan-review gates: review accountability sits with the initiating human, and Speccy's job is to make that review time well spent.

A corollary follows. Since the verdict is the human's, a completed run is a handoff — the wrap-up reports what was built and self-reviewed, then leaves the call to the user. Announcing "done" would invite a rubber stamp and undermine that. The Wrap-up section of SKILL.md is worded accordingly.

### Gate reports are re-verified, not trusted; hard gates beat soft style preferences (2026-06-23)

A build or fix agent reports its own success, and the workflow relays a "gates pass / 0 violations" summary upward. Two ways that summary misleads: an agent can clear a gate by fabricating or inverting the rule it was meant to satisfy and still report green; or it stalls on a *soft* CLAUDE.md style preference (e.g. "comment only the non-obvious") that collides with an *enforced* gate (a lint / static-analysis rule mandating doc comments), unsure which wins.

Fix, in two parts:

- **The orchestrator re-verifies.** The Phase 3 handoff and each Phase 4 fix round no longer advance on the agent's or workflow's green summary. The orchestrator re-runs the project's load-bearing gates itself (the build, lint / static-analysis, and test commands from CLAUDE.md) and confirms the actual tool output; a failing gate routes back into a fix round until the gates are *seen* to pass.
- **Hard gate beats soft preference, never safety.** Build and fix agents are told that when clearing an enforced gate forces violating a softer CLAUDE.md *style / aesthetic* preference, they clear the gate and log the trade. The carve-out is style-only — an enforced gate must never override a CLAUDE.md *safety or correctness* rule (e.g. "never log PII"), where the agent stops and reports a blocker. `plan-research.md` also now stub-scans the analyzer's *actual* output (rather than surveying the whole ruleset) and records any style conflict under Risks, so the trade becomes a decision at plan review rather than a surprise at build.

Complementary to "Build agents satisfy hard gates over soft style preferences" in plan-execution's log: that rule governs the build agent's own choice; this one stops the orchestrator from trusting a pass that didn't happen.

### Engagement checks guard the human against cognitive surrender (2026-06-24)

Speccy's strength is its hazard. Adversarial critique makes the spec and plan read as authoritative, and the more authoritative an artefact reads, the stronger the pull for the human to approve it without understanding. Shaw & Nave call this *cognitive surrender* — deferring judgment, effort, and responsibility to an AI's output, especially when that output is fluent, confident, and low-friction (Steven D. Shaw and Gideon Nave, The Wharton School, "Thinking—Fast, Slow, and Artificial: How AI is Reshaping Human Reasoning and the Rise of Cognitive Surrender", <https://papers.ssrn.com/sol3/papers.cfm?abstract_id=6097646>). Their mechanism is exact for our case: fluent, authoritative output lowers the threshold for scrutiny and attenuates the metacognitive signals that would otherwise route a decision to deliberation. Across three preregistered experiments, accuracy tracked the AI's accuracy in a dose-response curve; when the AI was confidently wrong, users followed it about four times in five and fell *below* their no-AI baseline, while their confidence rose.

Every safeguard Speccy already had hardens the *artefact* — the critique loops, the re-verified gates, the proven mechanisms. Nothing guarded the *human's engagement*, and a pipeline that produces polished, confident output is exactly where surrender takes hold. So a "Steering away from cognitive surrender" section in SKILL.md adds three habits at every human gate (spec-critique triage, plan review, wrap-up):

- **Ask before you tell.** Draw out the user's own expectations or concerns before revealing the agent's. This forestalls anchoring and breaks the path dependency across gates, where one nodded-through gate makes the next easier.
- **Flag doubt, stay quiet about certainty.** The agent surfaces where it is unsure and what it assumed, and never offers high confidence as a reason to skip review — broadcasting confidence would feed the borrowed-confidence failure directly.
- **Name what convinced you.** On the single most load-bearing decision per gate, the user says what persuaded them and notices whether they verified it or just trusted that the agent sounded sure. Framed as a self-check rather than an interrogation, which also keeps the friction to one prompt per gate.

The wrap-up adds two more: the ADR is co-authored, with the user restating the rationale for a key decision in their own words (a decision they cannot reconstruct is the surrender signal worth catching while the code is fresh and they are about to own it), and the final diff carries a consistent-standard nudge — read it as if a contributor you do not fully trust wrote it.

The heaviest lever was already in the architecture. The strongest *proven* anti-surrender intervention in the paper's experiments was the pairing of consequence-salience and concrete item-level correctness feedback: it reactivated deliberation and roughly doubled override of faulty AI, shifting users from surrender toward verify-then-adopt. Speccy already carries both — the human owns the PR and is accountable for the review (consequence), and the re-verified gates supply concrete correctness signals (feedback). The engagement prompts are the addition on top of that.

Phase 4 (implementation review) gets no prompts: it is human-on-loop observation, not a decision gate, so the "every human gate" rule does not reach it. An anti-rationalization line we considered was dropped as preachy.

The checks are **on by default** — the default should be to make the user think — but some users find them grating, so a per-run `engagementChecks` flag in state.json (default `true`) turns the active prompts off. When off, the active prompts are skipped but the agent keeps flagging genuine uncertainty, which is costless candour rather than interrogation. The opt-out is flagged at the start alongside the model defaults.

The opt-out is a calculated trade, not a free one. Susceptibility is not uniform: higher trust in AI predicts more surrender, while higher need-for-cognition and fluid intelligence predict resistance. The people most likely to find the prompts grating and switch them off — high trust, low appetite for effortful checking — are the same people most prone to surrender. It is still the right call: the paper's own design recommendation is "customizable modes that align with user preferences for autonomy versus assistance", and forcing friction on someone determined to skip it only trains them to click past it. Keeping uncertainty-flagging on even when the prompts are off preserves the one cue that costs the user nothing.

The skill itself refers to "cognitive surrender" as a plain concept without attribution; the source is credited here and in the README.

### Assumptions checked against the codebase, with a contradicted-assumption gate (2026-06-26)

The "prove load-bearing mechanisms" work (above) covers *feasibility* assumptions — platform/timing/API capabilities. But the spec's `## Assumptions` section is broader: it holds the quieter premises chosen where the description was ambiguous ("this table is append-only", "callers always pass a resolved ID"). Those are never tested against reality, yet a false one can invalidate scope just as a forbidden DML does — only it surfaces at build time instead of review.

Planning research is the first phase positioned to test them against the live codebase, so the check lands there:

- **`plan-research.md`** — the planner marks each spec assumption `confirmed` / `contradicted` / `still-open` against what it finds, records the verdicts in an **Assumptions check** plan section with evidence, and flags any contradiction explicitly in the briefing summary.
- **`SKILL.md` Phase 2** — a contradicted assumption is a blocking confirm-or-revise gate before the autonomous plan-critique loop: the user either accepts the adjusted scope or revises the spec and re-plans. The gate fires regardless of `engagementChecks`, because it surfaces genuine uncertainty — the one cue that stays on even when the active prompts are off (see the cognitive-surrender decision above).

Deliberately not added: the PR's separate `traceability.md` (criterion→test→evidence table). The plan's test strategy already maps each completion criterion to a test, and the implementation review already checks that adherence, so the table would be formalisation without new signal.

### Retrospective routes repo-doc gaps to the user at wrap-up (2026-06-26)

The plan-execution retrospective already noted "friction a CLAUDE.md update could eliminate," but that signal had no fixed home and was easy to lose in prose. The retrospective prompt now collects such findings under a `## Repo-doc suggestions (CLAUDE.md / ADR)` heading, and speccy's wrap-up presents them as concrete suggestions framed as the user's call — never auto-applied, since CLAUDE.md and ADRs are human-reviewed.

### Haiku dropped from the implementation-review ladder (2026-06-30)

Supersedes the implementation-review portions of "Round cap raised from three to four" and "Spec and plan critique run all-opus" (both 2026-06-22). Implementation review now climbs `sonnet → opus → opus` over up to **3** rounds, rather than `haiku → sonnet → opus → opus` over 4.

The haiku round was pulling its weight in theory — cheap-first on a large, mechanical diff — but in practice never surfaced anything worth keeping; its findings were noise that cost more triage than they saved. Dropping it makes sonnet the cheap first pass. The doubled-opus rationale survives intact: round 3 is still a fresh-context Opus re-reviewing the code after round 2's fixes, just one round earlier. With haiku gone the cap falls to 3, matching spec and plan critique.

### Banner rendered in the reply as emoji, not ANSI through the Bash tool (2026-07-01)

Supersedes the rendering mechanism of "Banner invoked by absolute path" (2026-06-22); the absolute-path invocation and best-effort rule still stand. The banner used ANSI escapes printed through the Bash tool. The harness changed: Bash tool output is now collapsed behind ctrl+o by default, so the banner vanished unless the user expanded it.

Every alternative for showing colour by default was checked against the current docs and found closed. Bash tool output is collapsed and its ANSI is unsupported. A model's own reply text has ANSI stripped (feature request still open). `UserPromptSubmit`, `UserPromptExpansion`, and `SessionStart` hook stdout is fed to the model's context, not shown to the user; the only user-visible hook field, `systemMessage`, renders as a plain warning notice with colour sequences excluded. There is no supported way to display a coloured ANSI banner to the user by default.

The one path to colour-by-default is emoji: rainbow-square emoji render in colour wherever text is shown, including the model's reply. So `banner.sh` now emits two Markdown lines (`🟥🟨🟩🟦 **SPECCY** …` plus the quote), and the orchestrator reproduces them at the top of its reply — visible by default, no ctrl+o. The script stays the single source of the attribution-verified rotating quote; running it through the (collapsed) Bash tool is just how the orchestrator picks a quote before echoing it. A hook was prototyped and rejected: `UserPromptSubmit` stdout never reaches the user, and it would also fire on any passing mention of "speccy".

### Feasibility spikes are a formal, shared step with their own prompt (2026-07-01)

Extends "Plans must prove load-bearing mechanisms" (2026-06-23). That work spread the *feasibility check* across `spec-template.md`, `plan-research.md`, and `plan-critique.md`, but it never gave the pipeline a *runnable* spike step. The critic's prompt correctly makes it a read-and-judge job — flag an unproven mechanism — while the only other actor in the plan-critique loop is the revise agent, which just edits the artifact. So a spike demand had no home. On a real run the orchestrator improvised: it spawned an ad-hoc agent, absent from the skill, to run the spike. That worked, but it was undocumented, unrepeatable, and the improvised agent lacked the cleanup instruction, risking orphaned state in a live environment.

Fix: the spike becomes a first-class, shared step with its own prompt.

- **`prompts/plan-spike.md`** — the procedure, deliberately short and principle-led rather than a checklist: exercise the *riskiest action itself* (a holding precondition is not proof of the action that depends on it); verdict is `confirmed` / `refuted` / `unproven`, where an untestable mechanism reports `unproven` rather than passing by default; clean up any state created; report the concrete signal so the reader can weigh the evidence, not take the verdict on trust.
- **Planning (`plan-research.md`)** — the planner proves load-bearing mechanisms by following this prompt, preferring to delegate to a spike subagent, falling back to inline. The long inline spike paragraph collapsed to a trigger plus a pointer, so the procedure has one home.
- **Plan critique (`SKILL.md` Phase 2a)** — a new step between critique and revise: when a round flags an unproven mechanism, the orchestrator spawns a spike agent with `plan-spike.md`. `confirmed` feeds the evidence to the revise pass; `refuted` / `unproven` routes to the blocking user gate that already exists for a contradicted spec assumption (2026-06-26), since an unprovable load-bearing mechanism can invalidate scope the same way. The gate fires regardless of `engagementChecks`.

The critic stays a pure reviewer — the change gives its finding somewhere to go. A subagent is preferred for the spike (its own context, live-environment work isolated from the reviewer) but not mandatory.

### Wrap-up artefact is a decision log, not an ADR (2026-07-03)

Amends the wrap-up description in "Steering away from cognitive surrender" (2026-06-26). The co-authored wrap-up artefact was called an ADR and written to `specs/<slug>-adrs.md`. That name overclaimed: the decisions distilled from the critique rounds are usually implementation-specific choices, whereas an ADR records the durable architecture decisions a team keeps for the wider audience. Renamed to a **decision log** at `specs/<slug>-decision-log.md`; the co-authoring, restate-the-rationale prompt, and commit step are unchanged.

Left as ADR: the retrospective's `## Repo-doc suggestions (CLAUDE.md / ADR)` heading (2026-06-26). That routes findings to the repo's *own* durable docs, which is exactly the end-user ADR territory the rename is drawing a line against.

### False constraints are proven before the design works around them (2026-07-09)

Extends "Plans must prove load-bearing mechanisms" (2026-06-23) and "Feasibility spikes are a formal, shared step" (2026-07-01), which proved *capability* claims like "this API returns Y" or "this DML is allowed here". The mirror case had no coverage: a design that works *around* a constraint asserted but never checked ("this field can't be queried here, so resolve it in a second pass"), building an extra query and a resolution layer to accommodate a limitation that turns out not to exist. The layer is then avoidable bloat.

The asymmetry is the point. A false "can" fails loudly at build time, because the call errors or the DML throws, so it gets caught. A false "can't" never fails: the workaround works, the tests pass, and it ships as permanent machinery that reads as justified by the very constraint that isn't real. That makes a false constraint more dangerous than a false capability, and the most expensive kind of assumption to survive review.

Fix, in two prompts:

- **`plan-research.md`** — the "prove load-bearing mechanisms" bullet now also covers a constraint the design works around, not only a capability it leans on. When the design adds a layer to accommodate a limitation, spike the limitation itself; if it proves false, the direct approach usually deletes the layer.
- **`implementation-review.md`** — a new review lens: a comment, suppression, or design note explaining *why* a workaround exists is an assertion, and the more machinery it unlocks the more it must be independently checked. A load-bearing justification the reviewer cannot confirm is itself a finding.

The guidance is written as a principle. The domain-specific example that first prompted it (a SOQL `GROUP BY` limitation) was deliberately kept out of the prompts so the discipline reads as language-agnostic.

### Prompt examples stay language-agnostic (2026-07-09)

The pipeline runs on any stack, but the examples in the planning and review prompts had drifted into Salesforce vocabulary (SOQL, DML, an Apex trigger firing, PMD / Code Analyzer) because the runs that motivated the guidance were Salesforce work. A reader pattern-matches the domain from the examples, so provider-specific terms quietly narrow how the guidance reads. Each was neutralised to a generic equivalent (a query, a write, a hook firing, ruleset-based analyzers) with the example structure left intact, across `plan-research.md`, `plan-critique.md`, and `plan-spike.md`.

The line holds for the live prompts only. This decision log keeps its specific references, since those record the real cases that prompted each rule and stripping them would erase the evidence.

### The plan splits into a decision body and a no-decision appendix (2026-07-09)

`plan-research.md` now asks for a plan in two parts: an implementation plan where every decision lives, for human and agent review; and a **Build reference** appendix of concrete touchpoints (files, classes, integration points, test surface) for the build agents, holding no decisions. Reasons:

- **The reviewer's surface stays short.** The choices a human must weigh no longer sit buried among file-by-file mechanics. Anything the reviewer must judge belongs in the body; if an appendix entry turns out to be a judgment call, it gets promoted, and needing to promote it is the tell that it was a real decision.
- **Structural misfit becomes visible.** The implementation approach is described as shifts in responsibility and shape, anchored to real classes but above the edit level, so a design that strains its host shows up where a flat edit list would hide it. A fit-against-host lens on Architecture decisions (the Nth method on a per-resource family, a feature-specific field on a shared type) surfaces the cost as an explicit choice for plan review rather than a silent default to the largest option.
- **The appendix is a map, not a script.** No method bodies or prescriptive diffs, since the build agents read the codebase themselves. This keeps the earlier "how to build, not the build itself" rule intact while giving the agents the touchpoints they need.

### Implementation review becomes a parallel multi-lens panel, delegating code quality to the built-in `code-review` skill (2026-07-13)

Supersedes the single-adversary model of implementation review and, for that phase, the model-ladder decisions ("Haiku dropped from the implementation-review ladder", 2026-06-30, and the implementation-review portion of "Spec and plan critique run all-opus", 2026-06-22). Phase 4 was one adversary reading `prompts/implementation-review.md` over an escalating ladder. It is now a panel of independent lenses run in parallel each round.

The trigger was a real gap: a single diff-scoped adversary judges the delta in isolation and misses a whole class of problem — a change that reimplements an existing utility, or nudges an already-smelly file one notch worse. Each such diff looks fine on its own; the cost only shows against the surrounding code. The fix is a reviewer that reads the diff but roams the codebase to judge it in context, with findings **anchored to the diff** (what it introduced, worsened, or should have reused) so the remit doesn't drift into cataloguing pre-existing mess.

**Delegate code quality to the built-in `code-review` skill.** Rather than hand-write correctness/reuse/simplification lenses, one lens invokes Claude Code's `code-review` skill. A feasibility spike (see "Prove load-bearing mechanisms") verified the load-bearing assumptions rather than trusting a docs-agent's secondhand answer, which was wrong on the first point:

- A **spawned subagent can invoke it** — it ran end-to-end from inside a subagent, including its own internal fan-out.
- It **accepts a `<base>...HEAD` range target** and needs no PR (it defaults to `git diff @{upstream}...HEAD` with a working-tree fallback, and honours a passed target).
- It is **read-only without `--fix`/`--comment`** and emits a structured findings list — so it works as a pure finder, fitting speccy's find→fix separation.
- It **already fans out ~8 angles**: correctness (line-by-line + enclosing function, a removed-behavior auditor, a cross-file caller/callee tracer), reuse, simplification, efficiency, altitude, and CLAUDE.md conventions.

So one maintained skill covers the whole code-quality space and improves under speccy for free.

**The lens taxonomy then falls out of "what does the skill know."** The built-in skills know the code, not the spec. The bespoke lenses are only what `code-review` structurally can't do:

- **Spec fidelity** — completion criteria and intent; the skill doesn't have the spec.
- **Tests** — test-strategy adherence, test quality, and consolidation of new tests against the existing suite. This absorbs an earlier, unshipped idea of a standalone pre-review "test consolidation" pass: consolidation is a subtractive judgment, but with an explicit coverage-preservation contract (name the surviving test; doubt keeps the test) it is safe as a lens, and the loop's later rounds re-check coverage. `code-review`'s removed-behavior auditor is a partial backstop against over-cutting, but proactive whole-suite dedup is speccy's job.
- **Codebase fit** — incremental degradation. The spike confirmed `code-review` does **not** cover this: its simplification and altitude angles are scoped to complexity the *diff adds*, not to a small diff worsening an already-imperfect file judged against its current state. That gap is the pain that started the redesign, so it stays bespoke.
- **Local-doc adherence** — violations of CLAUDE.md (root and nested), ADRs, `ARCHITECTURE.md`, and design docs. It re-checks CLAUDE.md even though `code-review`'s angle 8 already does: the double-coverage is deliberate — CLAUDE.md rules matter enough to the code owner to be worth a second, spec-agnostic pass — and the merge step dedups the overlap.

**`simplify` was considered and dropped.** It covers the same reuse/simplification/efficiency axis as `code-review`, but auto-applies with no report-only mode — so including it is both duplication and a break in find→fix separation. `code-review` gives those findings read-only, so it owns the axis.

**Parallel finders, inline merge, one fixer.** Unlike test consolidation (a single whole-suite comparison, where lens fan-out only tripled the reading — see the reasoning that kept *that* a single reviewer), these lenses roam different regions of the codebase, so fan-out genuinely divides work and buys speed, which main speccy otherwise has little of. Each lens writes to `review-round-N-<lens>.md`; the orchestrator merges inline (dedup the overlap between `code-review`'s reuse finding and the codebase-fit lens, resolve contradictions), then the existing `implementation-fix.md` agent applies the merged set. The inline merge is the accept/reject step and does **not** reopen "No triage agent" (2026-06-09): that decision rejected a *spawned* agent doing redundant reclassification and explicitly allowed inline self-classification; dedup across parallel lenses is a real need the single-adversary design never had.

**`code-review` runs every round**, not once up front — it's fast in practice, and a defect it catches here is far cheaper than one surfaced in human review. Its output shape is treated as liable to change and parsed tolerantly, since the operator agent can absorb a shifting schema. The loop still caps at 3 rounds and early-exits on an empty merged set.

**Findings carry a disposition; deferral is first-class.** A finding needn't mean fix-now. The orchestrator dispositions each merged finding as **Fix** (this round, optionally diverging from a copied pattern or fixing wider than the diff) or **Defer** (legitimate but out of PR scope, recorded in `.speccy/<run-id>/deferred.md` and surfaced at wrap-up). Deferred items are fed into each later round's lenses as accepted decisions so they don't re-fire, with a triage-step drop as backstop; the loop exits when nothing is dispositioned Fix. This is what lets the critic be aggressive without forcing scope-creep: a real problem the change shouldn't fix here becomes future work, not a reason to leave it unflagged. The calls are autonomous, matching Phase 4's human-on-loop stance, but surfaced at wrap-up — deferrals in the deferred list, divergences and wider fixes in the summary and decision log — so the human reviews the judgment even though the loop ran without them.

**Codebase-fit also flags repeating an existing smell**, not only worsening an area. The failure mode is drift-by-consistency — the build copies a bad local pattern because "that's how it's done here," and the codebase rots a diff at a time. The lens flags it (distinguishing a genuine smell from a benign convention) and leaves the response — diverge here, clean up wider, or defer — to the orchestrator, which the disposition model above makes possible.

**Suppressions are their own lens, deliberately harsh.** Silencing a linter, analyzer, type check, or test gate is how a defect ships looking clean, so `prompts/review-suppressions.md` treats any suppression the change adds or leans on as a finding unless it is watertight (adjacent comment naming tool and rule, why the code is correct, why no non-suppressing fix exists, scoped to one line). It is a separate lens rather than a codebase-fit bullet so the stance can't be diluted, and a suppression finding is effectively non-deferrable — removed or made watertight in the round it's found. It runs on sonnet: the check is a mechanical scan for suppression syntax plus a judgment on the adjacent justification, not the deep reasoning the other lenses need.

The net is a *smaller* bespoke surface (five focused prompts replacing one giant checklist) with higher coverage, and the code-quality half maintained by Anthropic. The accepted cost is coupling to `code-review`'s behaviour and output — it improves for free, but can also shift under us.

### Lens hardening after the first multi-lens run (2026-07-14)

Extends the multi-lens panel (2026-07-13) with four fixes from its first real run. The core split held — read-only lenses plus orchestrator-run gates, and "trust files, not returns" caught the code-review wrapper's misleading summaries — but the run exposed one process failure and three sources of avoidable manual work.

**The code-review lens didn't compose inside the fan-out.** Five of six lenses are single-agent (prompt → write file → return) and worked. The sixth wrapped `code-review` in a subagent, and `code-review` is itself multi-agent — it spawns its own find/verify children. That composition broke twice: the wrapper returned a mid-thought summary ("I'll wait for the tracer…") and never wrote its file, because the harness fires "complete" when an agent stops with no *live* children, and the wrapper had stopped while conceptually waiting on children it had spawned. Re-spawning reproduced the stall; a hand `SendMessage` nudge was needed to make it write.

The wrapper was the fragile layer, so it's gone: **the orchestrator now invokes `code-review` directly in the main conversation** rather than through an Agent subagent. This is the same move, for the same reason, as "Phase 3 invokes plan-execution directly, not via an Agent subagent" (2026-06-11): a multi-agent skill manages its own fan-out, so a wrapper isolates only its thin orchestration — the heavy reading already runs in its own grandchild agents — while introducing the completion-detection race. Run inline, the orchestrator drives `code-review`, collects its findings directly with no misrouting to guard against, normalises them into the shared schema, and writes the code-review lens file itself. The five bespoke lenses still run as parallel subagents, overlapping with the inline `code-review`. A tight contract on the wrapper was considered and rejected: it constrains the fragile layer instead of removing it.

A general self-heal backstop covers the remaining spawned lenses: when one reports complete, the orchestrator confirms its file exists and, if missing, `SendMessage`s that agent to write it rather than re-spawning. Together with the write-even-if-incomplete contract below, a spawned lens that dies mid-verification leaves a `PLAUSIBLE` file instead of nothing.

**"Write your file, even incomplete" is now a hard contract.** The base prompts said "write your findings to the file"; they didn't say "write it as your final action even if you couldn't verify everything." A lens that found a scary candidate and died verifying it left nothing. The run fixed this by hand — adding the clause to a re-spawn fixed the behaviour instantly — so it moves into the shared contract for every lens: writing the file is the final action, and an unconfirmed candidate ships marked `PLAUSIBLE` rather than being dropped.

**A shared finding schema makes triage mechanical.** The bespoke lenses used ad-hoc severity words while code-review used CONFIRMED/PLAUSIBLE, so merging six files — dedup, resolve overlap, assign disposition — was all manual prose work. A new `prompts/review-output-contract.md`, handed to each bespoke lens (code-review runs inline, so the orchestrator normalises its findings into the shape itself), pins one shape: `[lens-id] file:line · severity · verdict · one-line` plus mechanism and fix. The bespoke prompts' format tails collapsed into it, keeping only their per-lens content requirements (name the spec criterion; name the surviving test for a cut; etc.). Cross-lens convergence — three lenses independently pointing at one scope-join as an NPE root on the run — now surfaces by matching `file:line` instead of by reading and correlating, and the triage step weights a shared anchor up as a confidence signal rather than deduping it away.

**Rounds 2+ are codified as fix-verification.** The skill implied every round re-ran all six lenses cold. The run improvised a better round 2: skip a lens whose surface the fixes didn't touch, always pass the deferred list, and re-point each lens at "verify the round-1 fixes and catch regressions" rather than a fresh cold pass. That is now blessed in the loop: run all by default, drop a lens only when the fix provably didn't touch its surface (noting which and why), always pass `deferred.md`, and frame later rounds as fix-verification.

What the run confirmed worth keeping, unchanged: the read-only-lenses / orchestrator-runs-gates split, "trust files not returns," and the tests lens's adversarial-of-the-fix instinct (it caught a fix agent falsely claiming it had added a test).

### Wrap-up report is persisted, not just streamed (2026-07-14)

The wrap-up report was only shown in the chat, while its sibling artefacts (decision log, `deferred.md`, retrospective) each landed in a file. So the one document that ties the run together vanished on a context clear. It now also writes to `.speccy/<run-id>/summary.md`, alongside the run's other semi-ephemeral state — the handoff survives a clear and can be reopened in an editor rather than scrolled back to.

### The interview trusts the intake and may ask nothing (2026-07-21)

The spec interview (Phase 1b) drifted into two failure modes: re-asking things the user's own intake already answered, and asking clarifying questions at all when the intake left nothing worth asking. Both erode trust in the interview and cost the user friction before the spec even exists.

The intake is the user's decision, so the interview now treats it as settled: don't re-ask what it answers, don't seek reconfirmation of a stated choice, and only reopen a settled point on a re-raise or a serious, specific doubt. A reasonable default is recorded in the spec's Assumptions section rather than turned into a question — the critique loop challenges it there anyway. An empty interview is now an explicit valid outcome; clarifying questions exist to close real gaps, not to justify the phase. The engagement-check prompts (see "Engagement checks guard the human against cognitive surrender", 2026-06-24) are exempt — they are deliberate friction, not gap-closing questions.

The prompt already said not to ask what the codebase can answer, but the behaviour recurred, so that line was strengthened from a trailing aside to a leading imperative: never ask what a quick look at the repo, config, or tooling would settle — look, don't ask.

### The spec records decisions with rationale, not just assumptions (2026-07-20)

The spec template had an Assumptions section but no home for *decisions*. The two are different: an assumption is a guess made under ambiguity; a decision is a deliberate pick among options that were actually weighed. A spec always makes scope, approach, and contract-shape choices, and when the reasoning behind one isn't written down it reads as an arbitrary default — the critic can't challenge it, and it silently commits the build to a path no one argued for.

So the template gains a **Decisions & rationale** section (what was chosen, the viable alternative(s), the deciding factor — *why this and not that*), Phase 1c instructs the interview to draw the reasoning out rather than record picks silently, and `spec-critique.md` gains a matching lens: flag a decision recorded without a reason, one that names no alternative when one plainly exists, one whose rationale doesn't defeat the rejected alternative, or one presented as inevitable that was really a choice.

This is deliberately kept **spec-level** — the "why" behind *what* to build — to stay clear of the plan's decision body ("The plan splits into a decision body and a no-decision appendix", 2026-07-09), which owns the "why" behind *how*. The two are symmetric: spec decisions justify the shape, plan decisions justify the approach. `plan-critique.md` gets the same "hold every decision to its rationale" instruction pointed at the plan's decision body. The up-front spec section also gives the wrap-up co-authored decision log a real source to distil from instead of reconstructing rationale from memory.

### Subagents inherit the session's voice (2026-07-20)

A subagent starts from a clean context and never sees the main session's system prompt, so a behavioural or output style governing the run that lives *outside* `CLAUDE.md` — a house-voice hook injected at session start, a configured output style, communication conventions — does not reach it. Every critic, revise agent, planner, review lens, and fixer then speaks in a default register that clashes with the rest of the run, and so do the artifacts they write.

A new cross-cutting section (beside "trust files, not returns") makes the orchestrator restate the active style at the top of each spawned subagent's prompt. Two things are deliberately out of scope: conventions already in `CLAUDE.md` (subagents read it anyway), and the built-in `code-review` skill run inline (it owns its prompt; the orchestrator applies the voice when it normalises those findings). Stated once centrally rather than repeated at each spawn site, matching how "trust files, not returns" is factored.

### The panel runs the repo's own review gate as a lens, when it ships one (2026-07-20)

The multi-lens panel (2026-07-13) runs speccy's generic lenses plus the built-in `code-review` skill, but is blind to a repo that carries its *own* review gate — a `/review`-style skill, project-defined reviewer agents, or a `.claude/review.config.json`. Such a gate encodes the house security bar, thresholds, and invariants a generic reviewer structurally can't replicate, so where it exists it is the highest-signal reviewer available — and leaving it out means the panel re-derives, worse, what the repo already maintains.

So it becomes an extra lens, in the same category as `code-review` rather than a bespoke prompt: run it the way the repo documents (its own agents, models, thresholds — not overridden), invoke it **directly in the main conversation** because a project gate is usually itself multi-agent (same reasoning as running `code-review` inline, 2026-07-14), normalise its findings into the shared shape, and merge with the triage step deduping its overlap with `code-review`, codebase fit, and local-doc adherence. It is **spec-blind**, so it complements the spec-fidelity lens rather than replacing it. Absent in a repo → the lens is skipped cleanly. The accepted cost is coupling to the repo gate's output shape, the same trade already accepted for `code-review`.

### A comment-discipline lens, deletion-only (2026-07-27)

AI-worked codebases accrete comment noise — restatement of the code, edit-history narration ("changed X to Y", "as requested"), commented-out code, padding — and no existing lens catches it. `code-review` treats it as out of remit (it isn't a correctness bug), and codebase-fit is already loaded; the suppressions and spec-fidelity lenses point the *other* way, wanting justification comments to be *more* thorough. So a new bespoke lens, `prompts/review-comments.md`, owns comment discipline alone.

Two design choices carry it:

- **The reviewer proposes deletions only** — remove the whole comment (A) or a self-contained span within it (B), never a rephrase. This is the anti-noise mechanism, not just the remedy: if a clean deletion can't fix it, there is no finding, which keeps the lens out of taste wars and makes the fix a mechanical span-removal the existing `implementation-fix.md` subagent applies cheaply. The one latitude is the fixer's: it may make the minimal wording repair to mend a seam a mid-comment deletion leaves fragmented — granted in the finding, so the general fixer prompt stays free of lens-specifics.
- **Calibration is priority-ordered:** CLAUDE.md and grounding docs first, then speccy's standard (concise, relevant, explanatory, no history), then the surrounding code as a tie-breaker for neutral conventions *only*. The third is deliberately demoted: much existing code has already drifted, so matching neighbouring comment style would launder the very noise the lens exists to stop.

Runs on **sonnet** — a focused style pass, cheaper like suppressions. **Minor** severity by nature (cosmetic), so it never blocks a round. The SKILL.md prose stopped hard-coding a lens count with this addition, so the panel can grow without a stale number to chase.

### The tests lens flags test-only backdoors into production code (2026-07-27)

On real runs speccy would let a build widen production visibility for the sake of a test — an `@TestVisible` method in Apex, the same move in any language — and then propagate that pattern across the suite, rather than stepping back to a better option. Widening the production API so a test can reach inside it couples the test to internals and leaves a permanent hole in the encapsulation, and no lens named the smell, so it read as normal.

`prompts/review-tests.md` gains a bullet in its test-strategy section: production code widened purely so a test can reach inside it (Java's `@VisibleForTesting` or package-private hatches, Python's `_private` poking, the equivalent elsewhere) is a finding. The default it points back to is observing behaviour through the public surface or injecting a collaborator or mock. The affordance is legitimate in small doses as a last resort, so the lens flags each instance that isn't watertight and names the public observation or injection that would replace it, rather than banning it outright.

It lives in the tests lens, not codebase-fit or suppressions: it is a property of how a test reaches its subject, which is squarely the tests lens's remit. The examples are Java and Python despite speccy's Salesforce-heavy use, keeping with "Prompt examples stay language-agnostic" (2026-07-09) — the smell is universal and the two largest languages carry it best. The term "backdoor" was chosen over "reacharound" (crude), "bypass" (reads as skipping logic), and "reach-in": it is the established term of art for exactly this test-to-internals access.

### The engagement habits are always on, and never announced (2026-07-29)

Supersedes the opt-out portion of "Engagement checks guard the human against cognitive surrender" (2026-06-24). The habits themselves — ask before you tell, flag doubt not certainty, name what convinced you — and the paper attribution stand; only the per-run switch and its framing change.

That decision added an `engagementChecks` flag so a user who found the prompts grating could turn them off, reasoning that forcing friction only trains a determined user to click past it. In practice the flag defeated itself. To be an option it had to be *offered*, so the getting-started step announced the mechanism at the top of every run — and announcing a facilitation habit is exactly what "a prompt flagged as a check gets performed, not thought about" warns against. Speccy kept telling the user it was about to steer them, so it still read as an "engagement check" even though a rule already said not to name one. The flag was also redundant: a user who doesn't want to answer can decline any single question, or open the run by telling speccy not to ask. Autonomy never needed a stored setting.

So the flag is gone. The habits are always on and always silent — asked as ordinary questions in the flow of a gate, never labelled to the user, with an explicit instruction to honour a user who declines or asks not to be questioned without advertising that they may. Removed: the `engagementChecks` field, the start-of-run announcement of it, and the "when off, skip these" branch. The two blocking correctness gates (contradicted spec assumption, unproven load-bearing mechanism) now simply always fire, rather than "firing even when the flag is off". The original decision's worry — that forced friction trains click-past — is answered by the standing freedom to instruct, which lands as a genuine steer the model obeys rather than a knob it had to keep advertising.

### Pre-questions become predictions, revealed against the critique (2026-07-29)

Refines the "ask before you tell" habit from "Engagement checks guard the human against cognitive surrender" (2026-06-24). Each gate deliberately brackets the reveal with two questions, and the pairing is the point: the **pre-question** defends against framing — the user commits a view before the agent's lands, so the agent's confidence can't anchor them — while the **post-question** ("what convinced you?") deepens understanding and gives the decision log its rationale in the user's own words. Different jobs, both wanted.

In use the two came apart. The post-question works: it attaches to a decision the user just made, so it is concrete, answerable, and a shallow answer is conspicuous. The open pre-question — "where is the spec weakest?" — decays to a shrug. The cause is structural, not wording: it asks for an adversarial judgment before the user has any referent (the whole point is they haven't seen the critique) and with no consequence for punting. Rewording a referent-free question can't fix that.

The fix gives the pre-question a stake by closing a loop:

- **Predict, don't judge.** Ask for the one finding the user would bet the critique raises, or the part they'd defend least confidently. A prediction forces them to build their own model of the artifact first, which serves the anti-anchoring goal better than the open question did.
- **Reveal.** When the critique is presented, compare it to the prediction — "you expected X; it flagged Y — surprised?". This is the consequence the open question lacked, and it is the paper's own strongest proven lever (consequence-salience plus item-level correctness feedback, which roughly doubled override of faulty AI) turned on the user's own judgment. It compounds too: once predictions get checked, the next gate's is taken seriously. At plan review the reveal compares against what the autonomous 2a critique loop actually changed.
- **No-prediction fallback.** A user with no view is offered a look at one thing the orchestrator independently finds risky — drawn from its *own* read, not the critique it is already holding (which would leak it early), and only when a genuine risk exists. Many artifacts are straightforward; manufacturing a risk to fill the silence is noise, so the fallback is skipped cleanly.

Honest limit: the pre-question stays open and referent-light — the engagement comes from the loop, not from better wording. That is the ceiling for a question that by design must be asked before the user has anything concrete to react to.

Delivery matters as much as wording. The questions were also being lost to something mundane: the orchestrator asks, then keeps thinking and running tool calls, and the question scrolls off before the user answers. So each is now a **turn boundary** — asked as the last thing in the turn, with nothing following until the user replies, and a pre-question never opening the critique in the same turn (which would both bury the question and pre-empt the answer). `AskUserQuestion`'s widget would pin the question visually but was rejected: a formal chooser reads as exactly the labelled "check" the section avoids, and these are open reflective questions, not menus.

### Idle time during autonomous work is a second engagement occasion (2026-07-31)

The gate habits guard the decision points, but the run's longest stretches are the autonomous ones — plan critique (2a), the build (Phase 3), the review panel (Phase 4) — where the user waits on a subagent with nothing to do. That idle time is a second good moment to engage, and it earns its own device rather than reusing the gate pre-question, which has no referent before an artifact exists. Here speccy offers to deepen understanding: walk through how a relevant part of the system works, or surface an implementation detail the plan left open. The payoff is anti-surrender at the final diff — a user who understood the system as it was built doesn't review it cold.

Two rules mark it as the inverse of the gate question, whose defining property is that it *stops* the turn. This one never blocks: the job runs regardless and a completion that lands mid-conversation is surfaced immediately, so the chat can't delay a finished job. And any steer it surfaces feeds forward into an upcoming task or the review, never expecting the running build to have retro-adopted it — a preference that moves approved scope is a re-plan. It stays under the same "only when genuine" rule as every other prompt here. Not wired into the `engagementQuestions` ledger: different subsystems vary the offers naturally, so the template-repetition problem the ledger solves doesn't arise.

### The gates are named, and engagement questions vary across them (2026-07-31)

The orchestrator was posing engagement questions at interactive moments that aren't gates: at the build kickoff (a question that both repeated the plan-review gate and announced itself — "so you stay in the loop rather than just watching it run") and after the first-draft spec, before the user had even read it. The root cause was "apply the habits at every human gate" leaving "gate" to the orchestrator's judgment, which spread the pre-question to any interactive point. Rather than patch each site as it surfaced, the section now names the three real gates — spec critique (1d), plan review (2b), wrap-up (Phase 5) — and marks the rest as non-gates: intake and interview gather requirements, the 1c draft review is the user's read, the Phase 3 kickoff is a handoff. The pre-question especially assumes the user has read the artifact and is about to see it critiqued, so asked before a draft is read or after a decision is made it has no referent and reads as ritual. Phase 3 and 1c carry short local reinforcements at the two sites that actually failed.

The kickoff also gets the "on the loop" framing: the user supervises the autonomous build and can step in, reserving "in the loop" for the spec and plan gates where they decide each acceptance. The opposite pole is vibe-coding, where the user walks away from the loop entirely; naming that contrast is part of what speccy is for.

The deeper issue the run exposed: the three pre-questions and the three "what convinced you" asks each run off one template, so a user hears the same framing repeatedly and it calcifies into a ritual — the exact decay "Pre-questions become predictions" (2026-07-29) fights, now on the wording axis rather than the structure axis. So `engagementQuestions` joins state.json: each gate appends a short paraphrase of what it posed, and the next gate reads the list and comes at its question from a fresh angle. This is variation to avoid self-repetition, not a search for perfect wording (the honest limit from 2026-07-29 stands — the engagement comes from the loop). Storing it in state, not memory, means the variation survives a `/clear`. A `{ gate, asked }` paraphrase is deliberately not the verbatim turn: enough to see what framings are spent without scripting the questions.

### The "ladder" name retired for per-phase defaults (2026-07-28)

"Ladder" once named a real mechanism: a round-indexed model escalation, cheap on round 1 climbing to a doubled Opus on the last. Three later decisions drained every rung. Spec and plan critique went all-opus ("Spec and plan critique run all-opus", 2026-06-22); haiku left implementation review ("Haiku dropped from the implementation-review ladder", 2026-06-30); and implementation review became a parallel panel with fixed per-lens models ("Implementation review becomes a parallel multi-lens panel", 2026-07-13). Nothing climbs by round anymore.

What survived was only the *word* — the `adversaryModel` default token `"ladder"` and a SKILL.md line calling the defaults a "ladder scheme" — now naming a flat, per-phase policy that doesn't ladder. A misnomer that outlives its mechanism is exactly the scar tissue a future reader decodes wrongly, so the name goes.

Fix: state records the concrete model each phase runs, not a token. `adversaryModel` defaults to `"opus"` (the tier for critique and the panel's judgment lenses) and `builderModel` to `"sonnet"` — no sentinel to decode, and SKILL.md states each phase's model plainly. The one phase with no single model is implementation review, a panel spanning tiers (judgment on opus, suppressions and comments on sonnet); its per-lens mix stays a documented design detail rather than something a state field encodes, so `adversaryModel` names the adversary *tier* and the cheaper lenses sit a rung below it. The two overrides that were doing real work stay: a pinned `adversaryModel` for critique and review lenses, and `builderModel` (commonly raised to opus). Per-phase *override* knobs were considered and declined — everything high-leverage already sits at opus, so there is nothing left to raise, and the log's own arc records cheaper tiers costing more than they saved. This is a rename, not a capability change.

### Packaged as a Claude Code plugin (2026-08-05)

Speccy shipped as two skills under a project's `.claude/skills/`, which meant every user hand-copied both directories and kept them in sync. It was always meant to travel as a unit — an earlier banner-path fix already reasoned about the plugin cache layout — so the repo now *is* the plugin: skills moved to a root `skills/`, a `.claude-plugin/plugin.json` manifest bundles them, and a `.claude-plugin/marketplace.json` makes the repo self-installable (`/plugin marketplace add aquivalabs/speccy`). Both skills install together, which matters because speccy hard-depends on plan-execution.

The one behavioural change the packaging forces: plugin skills are namespaced `plugin:skill`, so Phase 3's call to plan-execution resolves as `speccy:plan-execution` from an installed plugin (bare `plan-execution` still works from a local checkout). The banner `allowed-tools` rule needed no change — its leading-`*` path tail was already chosen to match both a project and a plugin install, so it spans the new root-level `skills/speccy/banner.sh` too. Open-sourced under MIT.

### Decisions carry a three-way origin, and the wrap-up probes each accordingly (2026-08-06)

The wrap-up co-authored decision log asked the user to restate the rationale for one or two decisions, indiscriminately. But that ask is the "Name what convinced you" anti-surrender habit, built to catch *borrowed* confidence — a decision the user approved on the pipeline's reasoning without verifying it. Fired at every decision alike, it quizzes the user on calls they made themselves, which is the empty ritual the cognitive-surrender section exists to prevent.

The fix is to probe a decision by what it needs, not to probe everything — and that turns on where the decision came from. Decisions now carry a three-way **origin**, recorded in the artifacts so it survives a `/clear`:

- **User** — a preference, mandate, or judgement the user brought. Not a borrowed-confidence target, but *not immune either*: if the rationale is clear and recorded or the call is plainly right, it's logged as given; if it rests on a hunch with no clear reason speccy can see is correct, speccy challenges it on its merits.
- **Speccy, user-agreed** — the pipeline proposed it and the user signed off at a gate. This is the borrowed-confidence zone and the one the "what convinced you / did you verify it" check is actually for. Distinct from both a call the user originated and one speccy made alone: the user engaged and endorsed, so the surrender risk is real in a way it isn't for a decision they never touched.
- **Speccy, alone** — settled inside an autonomous loop (a plan-critique revision, a review disposition) with no gate for the user to sign off. Not a borrowed-confidence target (the user never agreed to it), but not filed unexamined either: it's surfaced at the next gate as speccy's own call now sitting in the spec or plan, with an invitation to check they agree and could justify it. A confident autonomous call waved through is its own surrender risk, so the gate is where the user gets to own or challenge it.

Tagging happens where each decision is made (spec interview at 1c, plan review at 2b), and the central "Name what convinced you" habit carries the three-way handling so every gate and the wrap-up inherit it. Origin is not frozen: when speccy surfaces a *Speccy, alone* call and the user ratifies it, it re-tags to *Speccy, user-agreed*; if they override it, to *User* — so a later gate doesn't re-raise a call the user has owned. Surfacing *Speccy, alone* calls is judgement-gated to the load-bearing ones: flooding the user with checks on trivial or clearly-correct autonomous calls trains them to tune speccy out, the opposite of the engagement it wants. Clean human/agent/joint attribution is worth having in the decision log regardless; the probe fix is what motivated recording it.

### The run isn't `complete` until the wrap-up is (2026-08-14)

Phase 4 set `phase: "complete"` when the review loop ended. But the wrap-up runs after Phase 4, and resume only surfaces a run whose phase is *not* `complete`. So a `/clear` between the review loop and the committed decision log resumed as a finished run, and the summary, decision log, and retrospective were silently dropped — the artifacts the handoff exists to produce. The enum had no `wrap-up` value to record the intermediate state, so an orchestrator that wanted to record it had to invent one.

A second leak sat in the same class. The wrap-up reports the findings the user skipped at spec critique, but nothing ever wrote them down, and the run's primary context-clearing point is suggested immediately after that loop exits. The wrap-up was asking for something only the conversation held, one step after speccy told the user to delete the conversation.

`wrap-up` is now a phase value, the enum reads in timeline order, and `complete` is set only at the wrap-up's own exit. Skipped spec-critique findings go to `spec-critique-skipped.md`, beside the critique that produced them; any finding still awaiting a fix when the review cap hits goes to `deferred.md` under a heading of its own. Three phases — spec critique, implementation review, wrap-up — end with a short list of exit checks naming what has to be on disk before the phase is left.

Neither is pooled into `deferred.md`'s existing list, though the wrap-up reading one file would have been simpler. That file has a second reader: the review panel, told to treat everything in it as an accepted decision it must not re-raise, with triage dropping any finding already there as a backstop. A skipped spec finding is a decision about the specification and says nothing about whether the matching defect in the code is acceptable, so pooling it would have a lens suppress a real code finding — silently, because suppression is exactly what the instruction asks for. The cap leftovers can share the file, since the loop has ended by the time they are written, but not the meaning: the panel judged them in scope and worth fixing, so the wrap-up presents them as unfixed defects in the branch and a decision to make, not as candidates for a follow-up issue. With every round now a cold pass (see below), the cap is the expected exit rather than an exception, so that section will usually have entries.

No run has hit this. It is fixed on principle: speccy already refuses to trust a subagent's return over the file it wrote, and refuses to advance on plan-execution's own "gates pass" summary. The same rule applied to the orchestrator's own state means whatever a later phase needs is on disk before the phase that produces it ends. The defect is readable in the skill file rather than inferred from a failure, which is why it doesn't need a frequency argument.

This takes the idea behind PR 3's phase-gate work and leaves the apparatus. Rejected: nine uniform gate blocks, two of which announce that they are not gates; an ASCII cycle diagram duplicating the phase-enum table beside it; a return-model section codifying three return routes and forbidding nested sub-runs, with no evidence that a nested run has ever happened; and Stage 0 promoted to a named stage that then needs a paragraph explaining it has no phase value and can never be resumed into. Rejected most of all: exit conditions naming a mental state — "the capability manifest held", "mandatory facts transmuted" — checkable only by the agent that just claimed them. That is self-attestation, the exact thing "trust files, not returns" exists to refuse, so an exit check here names a file or a phase value and nothing else. PR 3 also preserved the enum's misleading declaration order and added a warning not to renumber it; reordering it removes the trap instead of documenting it.

### Subagents see skills but not agent types, so only hunter dispatch needs help (2026-08-14)

Extends "Subagents inherit the session's voice" (2026-07-20), which established that a subagent starts clean and the orchestrator must carry across anything outside `CLAUDE.md`. The open question was how far that goes: does a spawned agent know what the *project* ships — its skills, its own research agents — or must speccy inject a capability manifest at every spawn site?

Spiked rather than reasoned about, in the tradition of the 2026-07-13 spike that caught a wrong secondhand answer. Four probes, two agent types (`Explore`, `general-purpose`) and two models (sonnet, opus), each asked to introspect and quote verbatim, with no file reads and no commands. All four agreed:

- **Skills are fully visible.** Every probe saw the same 34-entry listing the orchestrator sees, each entry carrying its description and trigger text, plugin names namespaced in full. The `Skill` tool's own description states the listing is how skills are advertised. So a subagent can already match a task to a house skill and invoke it by name; the 2026-07-13 spike had separately proven a subagent *can* invoke one.
- **Agent types are invisible.** No probe saw any agent-type listing. The `Agent` tool tells them types arrive by system reminder; that reminder does not reach a subagent. The orchestrator sees the list; a subagent sees none of it.

That asymmetry decides the design. Injecting a skill catalog buys nothing — the agent already has it, with better trigger text than a hand-rolled manifest would carry. Injecting governing docs buys nothing either; 2026-07-20 already established subagents read `CLAUDE.md`. The repo's review gate is already a lens ("The panel runs the repo's own review gate as a lens", 2026-07-20).

The one real gap is a project's own read-only research agents: the planner cannot route to a hunter it cannot see. The remedy is dispatch position, not injection. The orchestrator dispatches the relevant hunters from the main conversation before spawning the planner and passes their findings down as gathered context — the same inline move already forced for `code-review` (2026-07-14) and plan-execution (2026-06-11), and for the same reason: a subagent that spawns children and waits on them stalled twice, because the harness fires "complete" when an agent stops with no live children.

Second gap, smaller: ADRs, prior specs, decision logs and retrospectives sit in nobody's context, orchestrator included, because they are just files. `plan-research.md` now reads them. A recorded decision is context to build on, and a plan that contradicts one says so deliberately.

Rejected: a Stage 0 capability probe, a persisted `capabilities.md` manifest, a state pointer to it, a per-phase injection preamble, and the two-step transmute-then-detect-conflicts machinery those need because a pre-interview probe runs before any task area exists. All of it discovers what the agents are already shown. Rejected separately: a rule granting project capabilities standing as "project truth" exempt from adversarial re-verification. It conflates two things — a house skill's rule is a committed file a human wrote, and authoritative; a hunter's answer is one agent's output, and speccy elsewhere refuses to trust exactly that. House rules are truth; hunter findings are cited research the critique loop weighs.

### Every review round is cold, deferrals need a scope reason, and the fixer can be a series (2026-08-17)

Measured against three finished runs rather than argued. Each ran the full pipeline to `complete` on a substantial feature branch, and each was then reviewed again by its repo's own `pr-review` skill, which turned up roughly ten more fixes that landed on the same branch before merge. The question was where those come from.

**The panel decayed across rounds.** Round 1 ran eight to nine lenses; round 2 ran four or five; the final round was a single fix-verification file in two of the three runs. The rule permitting a lens to be dropped when the fix round didn't touch its surface was being read far more loosely than that, and rounds 2+ were scoped to verifying the last round's fixes, so the panel only ever got one cold look at the code. Anything it missed on that look was never looked for again.

**But the larger category was found and then withheld.** Tracing one run's `deferred.md` against the commits that followed: a parallel-array key mismatch, an unhandled null branch, a success message on a surface that had saved nothing, and labels contradicting a governing ADR were all found by the panel, deferred, then fixed on the same branch a day later after an independent review raised them again. Alongside them a batch of roughly two dozen findings was closed with the reasoning that each was real but together they "would double a diff whose review attention is meant to be on the write layer". Several of those were fixed post-run too.

That reasoning does not survive inspection. The attention it protects has already been spent: a lens read the code, traced the defect and wrote it up before anything was deferred, so the saving is claimed after the bill is paid. What deferring buys is a smaller diff; what it costs is a known defect shipped, and the fix it withholds costs a subagent's context rather than the orchestrator's. Nor was the criterion ever granted — the disposition is defined as out of scope for this PR, which is a claim about ownership, not about size. Diff size is now named as not a deferral reason, and the three legitimate ones are named instead.

The observed outcome corroborates but cannot carry the argument: the diff reached its full size anyway, in the same PR, before the same squash merge, having been reviewed twice. That held because an independent review followed each of these runs and re-raised the findings. Where none follows, deferring does keep the diff smaller, and the defect ships. The rule rests on the cost being sunk, not on a second reviewer being guaranteed.

The linkage from deferral to later commit was traced in detail on one run only; the other two corroborate the shape (comparable post-run fix counts, commit messages naming a review) without the per-finding audit.

Three changes follow. Every round is a cold pass over the whole diff that additionally covers the previous round's fixes, so a later round can find what an earlier one missed. Deferral needs one of the three scope reasons. And a large fix set may be split across a series of agents rather than pushed through one, since a single fixer holding thirty findings gives the last of them the thinnest attention and can compensate by taking the cheap ones and reporting done — run in series, never in parallel, because they share a working tree and an index.

The cap stays at three rounds. Cold rounds mean a round always finds something, so an exit condition of "nothing left to find" would not terminate; the round cap is what bounds it, and the cost is now three panels rather than one panel and two verifications. The loop's own exit still fires, because it reads dispositions rather than findings: a round whose findings all triage to false positive, duplicate, or already-deferred sends nothing to the fixer and ends the loop.

Rejected: dropping a lens because it found nothing last round. Yield describes the round that ran, not the code as it now stands, and the lenses whose clean result is the expected one — suppressions above all — are the ones a fix round is likeliest to break. Rejected separately, from PR 3: levelling findings `code` / `design` / `requirements` and batching the latter two into a `decision-queue.md` for a human gate. That withholds a wider class of finding from the fixer than the deferrals we just measured as counterproductive, and adds a record file for it.

### The fixer runs on sonnet, raised only on evidence (2026-08-17)

The fix subagent had no model of its own, so it inherited the orchestrator's tier — opus in a normal session, and never a considered choice. A triaged finding names the defect and its location, which makes the fix execution against a written instruction: sonnet is faster at that and no worse, and the review panel that produced the finding is what catches a bad fix.

So the fixer is sonnet, chosen per batch rather than configured. Two evidenced cases raise a batch to opus: a later round found the previous fix broken or regressive in the same area, so sonnet has been tried and failed there; or the finding shows the current shape is wrong without stating the right one, which leaves a design call inside the fix. The orchestrator names any raised batch and its reason in the round's report, because a free per-round choice with no audit trail drifts back to opus for anything that looks hard.

Rejected: tying the fixer to `builderModel`. That reads as consistency — the fixer is the builder doing more building — but the two decisions are about different things. `builderModel` is raised for a build's novelty and the amount left to build-time judgment, none of which describes applying a finding, and inheriting it would hold every later fix round at the slower tier for the rest of the run. Also rejected: a new state field for the fix tier. Per-phase override knobs were declined once already (see "The \"ladder\" name retired for per-phase defaults", 2026-07-28) and nothing here needs to survive a `/clear`, since the choice is made from the round's own findings.

### The banner stamps version from the manifest and commit only when it can prove it (2026-08-17)

A bug report against Speccy could not say which Speccy ran, so the banner now carries a version and, where it is knowable, a commit.

The version is read at run time from the plugin manifest, the same file the marketplace reads. The alternative considered first was a CI job on main that writes the version and commit into a generated stamp file. It was rejected on two counts. A generated copy of the version is a second source of truth that can drift from the manifest, for no gain, since the manifest is already present at a fixed path in both a checkout and an installed plugin. And the commit half cannot be made honest: a workflow triggered by a push can only record the SHA that triggered it, which stops being HEAD the moment the stamping commit lands, so the file is permanently one commit stale. It would also cost a bot commit per merge, a loop guard, and a token that can push past branch protection.

The commit therefore comes from git at run time, but only when the plugin root is itself the git top-level. That guard is not defensive padding. An installed plugin is a plain copy under `~/.claude/plugins/cache/` with no `.git` of its own, and git searches upward, so an unguarded `rev-parse` there resolves whatever repository encloses the plugin cache and reports a SHA belonging to something else entirely. Wrong provenance is worse than none, so installed copies show a version alone. A dirty working tree adds a marker, since a development copy with uncommitted edits is not the commit it names.

Version and commit degrade independently: an unreadable manifest or a foreign enclosing repository each drops its own half and the banner still prints.

The version only means something if it moves, and an installed plugin can be updated in place at an unchanged version, so a CI check now fails a change that touches `skills/` without bumping the manifest. It runs on pull requests and on pushes to main, since this repo takes direct commits as well as PRs. The two events need different baselines: a pull request compares against its base branch, a push against the commit it displaced. Only the push case falls back to `HEAD~1`, for a force push or a first push where no predecessor is recorded; a pull request whose base cannot be resolved fails loudly rather than quietly grading itself against the wrong tree.

### Artefacts are written for a human reader (2026-08-17)

Specs and plans came out of the pipeline dense and hard to read: argument in every sentence, terms used before they were defined, claims that only existed inside a file citation, and a running narrative of what an earlier draft said and what a review changed. Two real specs ran to 477 and 1159 lines, and the plan for one of them to 1479.

The cause is a ratchet in the critique loop. Every finding class the critics looked for was an omission, so the cheapest way to satisfy a critic was to append a defensive clause, and the revise prompt's minimum-change rule made appending the compliant move as well as the cheap one. Nothing in the pipeline was permitted to remove, and nothing measured whether a person could follow the result. The writer also knew an adversary would read next, which is what produced the pre-emptive, self-defending register: it was writing for the critic rather than for the reviewer.

Three changes, because no single one holds. A style guide states the audience and the rules, and is passed to every agent that writes a file rather than restated from memory by the orchestrator. A readability pass, the one step allowed to delete, rewrites each artefact for its reader while changing nothing it says. And from the round after that pass, the critique prompts carry a reader lens whose findings can only be answered by cutting, which stops the file thickening again over the rounds that remain.

The lens stays off until the pass has run, because before it the two do the same work and the user pays for the overlap. Spec critique is the one loop where the user triages every finding, so a prose finding in round 1 competes for the attention that gate exists to spend on gaps in the spec — and the pass rewrites the passage either way, whether the user accepted the finding or declined it.

The pass runs after round 1 rather than after the loop, so a critique round always reads the rewritten artefact cold. A rewrite is the only step that can silently drop a load-bearing fact, and the critics already hunt for missing deliverables and unstated constraints, so the existing loop verifies the rewrite for free. Running it at the end would have left the rewrite trusted rather than checked, and its output is what the user approves the build from. That verification is also what puts the pass on sonnet: rewriting to a written style guide is execution against an instruction, and the tier that has to catch a lossy rewrite is the critic's, not the rewriter's. The failure to watch for is a timid pass that cuts nothing, which wastes the step rather than damaging the artefact, and shows up as an empty change note.

That checking round is not given the pass's change note. A critic told which passages went checks those and reads past the rest, and the cut nobody declared is the failure the round exists to catch. The note goes to the user and to the wrap-up instead. The cost of all this is one round: a loop that would have exited on a clean round 1 now runs the pass and a round to read it. That is the price of not trusting an unread rewrite, and it falls only on the two loops whose artefacts a person reads.

Structure carries part of the load, on the grounds that a writer mixes description and argument when the reader meets them interleaved. The spec template now runs description first, argument second, caveats last, with the argument confined to one section, and completion criteria are one checkable line each.

Total separation was tried first and gives the reader a different problem: a decision explains the shape being described, so reading the description means darting to the section and back. The lead resolves it. It carries at most two load-bearing decisions with a sentence of why each, so the choices that shape everything are met before anything they shape, and they repeat in full in the argument section below. The limit is numeric on purpose. "The major ones inline" is the soft boundary that produced the original problem, since every decision looks major to the writer who just made it, whereas a fixed slot of two cannot absorb the twelfth.

Rejected: decisions as subheadings under the content they govern. It removes the darting, but decisions rarely map one-to-one onto content — one save-semantics call governed a UI shell, an API contract, and a draft model at once — and it breaks the three readers that use the section as a unit: the wrap-up walking origin tags, the critic hunting for decisions that should be there and aren't, and a reviewer auditing the choices in sequence. Cross-references from the body to the section were also dropped, since the file's shape already says where argument lives.

Plans gained a template of their own, a skeleton that fixes the section order while the planning prompt keeps the per-section guidance, and the planner's summary now opens the plan file instead of going only to the orchestrator.

Reversals go to the wrap-up decision log. The artefacts state the position they now hold, so a choice the run abandoned survives in the critique round that overturned it, which the decision log already reads.

Also rejected: naming an external style guide such as the Guardian's. It cannot be fetched, it is mostly lexical where the problem is structural, and relying on the agent's memory of a named guide is weaker than stating the rules. The spec-versus-plan boundary was left alone in this change: "what versus how" is not holding, but the distinction is nuanced enough to deserve its own pass.

### state.json points at the run, it doesn't record it (2026-08-17)

Multiple runs invented a `runNotes` array in state.json and filled it with the run's substance: two user rulings, a spike's findings, the target environment's quirks, tensions to put to the next critic, a correction the spec still needed, and a note to re-tag some Origin lines later. Nine paragraphs of briefing in a file the user never opens, and every one of them had a home already — the spec's Decisions & rationale, Constraints, Assumptions, Open questions, or the spike file.

The schema was published without saying it was closed, so adding a field read as filling a gap rather than breaking a contract. It is now closed, with the routing spelled out: a ruling to Decisions & rationale with its Origin tag, a spike result to its file and then into the spec, a constraint to the spec or `CLAUDE.md`, a tension to Assumptions or Open questions, and a pending correction applied rather than parked.

The pull is real, which is why a rule against it needs the alternative named. A decision lands mid-conversation, the artifact hasn't caught up, and state.json is the one file guaranteed to survive a `/clear`. But content written there is inert: no critic reads it, the readability pass never touches it, the user never sees it, and the wrap-up distils the artifacts. A ruling parked in state is a ruling that never reached the spec. The counter-pressure is to write the artifact at the moment the decision lands, which is what the pipeline wanted anyway.

Closing the schema alone would have left the real gap open. Some of what those runs recorded genuinely had nowhere to go: `writing-style.md` bans process narrative from the spec and plan on purpose, and the decision log that receives it was not created until the wrap-up. A run that overruled its seed during the interview had no home for that fact for the entire run. So `specs/<slug>-decision-log.md` is now created at 1c alongside the spec and appended to as the run goes, and the wrap-up completes it rather than writing it from scratch.

The danger is that the outlet becomes the next dumping ground. So it admits three things and nothing else — a reversal, an origin flip, and the user's own answer to "what convinced you" — and it uses the wrap-up's entry shape from the first line. The critique and readability files remain the wrap-up's backstop for a reversal nobody logged when it happened.

`engagementQuestions` is not a precedent for adding more. It stores what speccy asked, which no artifact holds and no reader wants, and it went in by changing the skill.

What genuinely doesn't persist — the user is mid-read, a precondition passed an hour ago — is left to die with the context. A resumed run re-checks or asks, which is cheaper than a durable note that goes stale.

### The run directory is its own index (2026-08-18)

Closing state.json's schema left a question behind: with no sanctioned place to record what a run produced, how does a resumed context find the spikes, the change notes, the earlier rounds? The tempting answer is a `files` array, and it is the same mistake in a new shape. Give each entry a description and it is `runNotes` again, one field down. Strip the description to `{path, status}` and it becomes a second copy of the directory that goes stale on every write the run makes. So a resumed context lists `.speccy/<run-id>/` instead, and state.json inventories nothing.

That works because the filenames already carry the three things a reader needs. What a file is comes from its name, which is why every prompt in the pipeline is told where to write. Which files an obligation attaches to comes from the phase text: `deferred.md` and `spec-critique-skipped.md` are named in the wrap-up that must report them, and any future file with an obligation on it belongs in the phase text the same way, not in a schema field. What no longer applies comes from a prefix: a run that replaced its plan mid-flight invented a stale marker in the filename, which is now the stated convention, `SUPERSEDED-<original name>`. It groups in a listing, survives any tool, and needs no field to interpret it. Spike verdicts are excluded, since evidence about the world outlives the draft that asked for it.

The one named field added is `decisionLogPath`. It earns a slot because the decision log is the only artefact outside the run directory, so the listing genuinely misses it, and because two named path fields already exist for exactly this. Worth saying that a run reaching for the field is not the argument for it: that is the pull the closed schema exists to stop, and it points at gaps that turn out to be imaginary as often as real. The listing gap is the argument.

Nothing was added to `allowed-tools` for the listing. `ls` sits where `git commit` and `git checkout -b` already sit, approved by the auto-accept mode the skill asks for before the autonomous phases begin.

### Redundancy is a finding; length is not (2026-08-18)

A real run measured its spec across the loop: the readability pass cut it, and the two rounds after it grew it back by 25 lines. The pass was working. What grew were whole normative lines, each legitimate on its own — a completion criterion here, a deliverable bullet there — and the pass is forbidden from touching them, because merging two criteria changes what the spec says. Three passes would have produced three files of the same length in slightly better prose.

So volume needed a different instrument, and the loop already had one. Redundancy is now a finding class in both critique prompts: a criterion subsumed by another, a deliverable restating one above it, a constraint re-arguing a decision. It is triaged, applied, and re-checked by the next round like every other finding, with no new agent and no unchecked rewrite at the end. A consolidation pass licensed to change content was the alternative, and it was rejected: it reintroduces the silent-drop risk the design bounds so carefully, and it would need its own following round to be safe.

Two details decide whether the class works. It is **not** gated behind the readability pass, unlike the reader lens. The reader lens waits because prose is the pass's job and raising it early wastes the user's triage; redundancy is precisely what the pass cannot fix, so a first-round finding stands. And the lens carves out the repetition the templates intend, where the lead's two load-bearing decisions appear again in full in the argument section. A duplication lens without that carve-out flags the same intended pair every round.

The target is a spec that says each thing once, not a short one. Growth answering a real hole is the loop working, and the explanation it gained is content. The prompts don't say so, and don't need to: a finding must name both passages and say which survives, which no complaint about length can satisfy. The one guard that is spelled out is against a merge that drops a condition, and only in the spec prompt, because a lost completion criterion is silent where a lost plan step gets caught by the build or the next round.

`revise.md` took the matching rule, because the growth happened in the revisions rather than in the drafts. It already held two rules that override minimum-change for this family of failure, both about the cheap defensive addition. The third says to sharpen a normative line that covers the ground before adding a parallel one, and to add freely where nothing covers it. That is not new licence — revise already rewrites content — and it catches the overlap at the moment it would be created. The critique class stays because it sees what no single revise call can: round 2's addition overlapping round 3's.

### A run measures itself afterwards, from the harness transcripts (2026-08-19)

A run had no idea what it cost. The README claimed the design "keeps the bill down" and spends Opus only where it earns its keep, and nothing had ever checked either claim.

The obvious shape, a `tokensUsed` field written at each phase boundary, is impossible rather than merely unwelcome. Nothing in a live session exposes token counts to the orchestrator: the Agent tool result carries no counts, and the main loop has no view of its own usage. Any figure speccy wrote as it went would be invented. So measurement is a separate pass over the harness transcripts, written to a file of its own, and the closed schema stays closed (see **state.json points at the run, it doesn't record it**). Phase attribution needs no new state either, because the transcript already records every state.json write with its content and a timestamp.

What one unit of usage is turned out to be the hard part, and only a real corpus could settle it. Two traps, both silent, both yielding entirely believable numbers. `usage` carries an `iterations` array repeating a request's counts per inference iteration, so a text-regex pass reported 5,418,443 output tokens against a true 2,709,266. And the harness writes one response to the transcript once per content block, so a reply that thought, spoke, and called a tool leaves three entries, each carrying the whole request's usage; summing them overstated requests and cache reads by 1.9x and cache writes by 2.4x. Output tripled for orchestrator responses but landed within a few per cent for subagents, whose entries report output cumulatively as the response streams, and being badly wrong in one column while nearly right in the next is what hid it. Hence real JSON parsing, top-level `usage` fields only, and records keyed on `message.id` merged with `max`. Node, because it parses JSON with no install and matches the ecosystem the plugin ships in, where Python's name in Git Bash on Windows is a coin toss. Neither is guaranteed, so the wrapper skips with one line rather than failing, exactly as the banner does.

What bounds a run also had to be learned. The banner marks the start, `complete` closes the timeline, and anything after it is the session's next job rather than this run's cost. Where the transcript holds no `complete` write, because the run marked itself complete through a shell command instead of a file-editing tool, state.json says the run finished and its mtime says when, capped at the last record so a file touched later cannot stretch the run. Requiring a particular tool for that write was the tempting fix and the wrong one: it would leave the measurement depending on how a file happened to be written, which a hook or a refactor breaks silently. Agents are scoped by overlap with the same window, because a session outlives the run it hosted and keeps every subagent it ever spawned in one directory. Everything excluded is counted in the report's notes rather than disappearing.

The script runs after `complete` and outside the exit checks. The measurement is a nice-to-have that must never stand between the user and a finished run, so nothing here can fail in a way that leaves a run looking unfinished. The cost is that a `/clear` in the gap loses the report, which is why the script takes a run id and can be re-run.

No prices. Rates in a public plugin go stale silently, and the report groups tokens by model and reasoning effort, which is what applying current rates by hand needs. `effort` is recorded per request, absent only for models with no reasoning-effort setting, so it is grouped alongside the model rather than assumed. Two smaller things real runs taught the reader: subagents carry a sidecar naming what they were spawned to do, but workflow subagents get no description, so the label falls back to the agent's opening prompt; and a timeline whose earliest surviving state write lands mid-pipeline names its opening bucket `before <phase>` and says in the report that those phases cannot be told apart.

### Subagents gather in parallel, and the rule lives in one file for all of them (2026-08-19)

Reading a run's transcripts showed where its money went, and it was not where the design assumed. Cost tracks turns, not volume: a subagent's whole context is re-read on every turn, so an agent carrying 180k pays that again for each round trip it makes. Across one run's 91 subagents, 81% of responses issued exactly one tool call and 62% were a single read-only lookup. The agents were paying by the turn and spending turns one file at a time.

A controlled test settled that this is worth fixing and that the fix costs nothing. Four copies of the same review lens ran over the same 136-file diff on the same model; two were told to issue independent lookups in one message. Those two took 29% fewer turns and 28% less cache read while fetching 3% *more* material, reaching the same final context, and reporting the same number of findings. The saving is round trips rather than thoroughness, which is the only version of it worth having: an agent that looks at less to finish sooner is a worse reviewer, not a cheaper one. The instruction shipped is the wording that was measured, not an improved draft of it.

One shared file rather than one per agent type. The evidence is uniform across build agents, spikes, critics and lenses, so there is no divergence to encode, and eight files each holding the same paragraph is the redundancy this log already treats as a finding. Splitting later costs a changed path; merging later costs reconciling copies that have drifted, so the asymmetry favours starting single. If a split is ever earned, the axis will be read-only against mutating agents rather than one file per role.

The mechanism was already there. `writing-style.md` is passed to every subagent that writes an artifact under a rule stated once rather than repeated at each spawn site, and `tool-use.md` is its sibling: cross-cutting advice on how to work, where the other is on how to write. Its scope is deliberately wider, taking in plan-execution's build agents that writing-style skips, because this governs how an agent works rather than what it reads back. The same two exceptions carry over, for the same reason: `code-review` and any project review gate manage their own prompts.

### The fixer is told where the run starts, verifies only what it touched, and hands back (2026-08-24)

Every review lens is given the base branch and told to diff `<base-branch>...HEAD`. The fixer, the one agent in the phase that has to decide what belongs to this run, was given the spec, the plan, and the findings, and nothing that said where the run began. It had no test for "pre-existing" but the one it could invent, and the one it invents is "I didn't write it".

A run showed what that costs. A fix agent hit a test that never terminated, found an untouched sibling test hanging the same way, and concluded the defect predated the run. The file was written by a sibling batch of the same round an hour earlier and sat squarely inside the run's own diff; one `git diff <base-branch>...HEAD --name-only` would have said so. Everything after that followed from the substituted definition: an hour polling a run that had stopped producing output, eighty minutes bisecting, a decision to work around rather than hand back, and a batch that wrote its code in twenty-six minutes and then spent a hundred and sixty more without committing any of it.

**Routing fix rounds through plan-execution was the alternative considered, and rejected.** The appeal is real: that skill is refined, it decomposes, it backgrounds itself, and it has a watchdog. But its execute agent is not given the base branch either — the workflow passes `baseBranch` to the integrate prompt alone — so the misdiagnosis recurs unchanged, and the thing being adopted for its refinement does not contain the fix. Three further mismatches. Its breakdown agent reads the plan and its dependencies to derive tasks, which is opus re-deriving a decomposition the triage step already produced, since a finding names its file, its line, and its defect. Its breakdown is told to favour parallelism, the one optimisation a fix round must switch off, because batches from a single round land in the same files and the phase already runs them strictly in series. And its verify step checks deliverables against a plan, which the next cold review round covers and exceeds.

So the parts worth having were taken and the wrapper left. Two come from plan-execution's execute prompt. The fixer now runs the checks covering what it touched rather than the full gate suite: the orchestrator re-runs the load-bearing gates after the batch commits, so a fixer running them too was paying twice for one verdict, and in the run above the duplicate was where the whole loss happened. And it hands back on a check that will not give it a verdict, after one attempt to understand it, committing what it has and reporting what the check did. Handing back unverified is deliberate: the alternative that run demonstrated is a working tree nobody else can see, which loses the work outright, where an unverified commit and an accurate report leave the orchestrator able to re-scope, gate it itself, or pass it to the next round.

The duplicate is only a duplicate for a one-batch round: with batches in series, nothing between them is gated but the blockers, so a breakage a batch's own checks miss reaches the end of the round with the other batches' commits already on top of it. That is accepted rather than overlooked. Batches are drawn by area, the checks covering what a batch touched catch most of it, and the next cold round reads the whole diff again; a full suite per batch buys the earlier verdict at the price the fixer's duplicate was already charging.

Batching was already a series rather than one agent, but the guidance was a preference and the failure obeyed it. Three batches drawn by layer landed cleanly; the fourth was what remained, carrying both blockers and six refactors, and it is the one that ran long and stranded the two findings that could not wait. Two rules replace the preference. Blockers get their own batch and it goes first, so the finding the branch cannot ship with does not inherit the fate of eight refactors. And no batch is the remainder: leftovers form batches of their own, down to a batch of one, since a size floor is what reintroduces it. Commits take the same grain, one per fix rather than one per batch, so a batch that stops early leaves its finished fixes in git instead of losing all of them, which is how the run above ended. The orchestrator's check reads the tree as well as the log to match, since a batch can now land some of its findings and leave the rest uncommitted.

The orchestrator also reads git rather than the report. A batch can say it is done with nothing committed, which is what happened: eight findings' worth of work written, none of it in git, and the round moved on. The skill already refuses to trust a subagent's return over the file it wrote, so applying that to a fixer costs one `git log`. The tree says which failure it is: uncommitted work is still work, and re-running the batch would set a fresh agent to redo it. That run's leftover was closed by a later agent that verified and committed it, for a fraction of what the batch had spent.

**Still open: what the orchestrator does while a batch runs.** Backgrounding the fix spawn is a no-op, since subagents already run in the background. So a watchdog is available today and is the real question. plan-execution's would need one addition: its auto-stop keys on liveness, taking `idle` as the max of the last commit time and the newest transcript mtime, so a fixer polling a check that has gone quiet pins idle at zero and never trips it; and its 25-minute heartbeat fires on elapsed time alone, reading the same at minute 25 as at minute 175. What such a watchdog should read is unsettled. A fix batch commits once at the end, so a commit gap describes every healthy batch, and it stops editing before it verifies, so a quiet tree does too. Elapsed time against the round's other batches may be all there is, which is a wall clock rather than a monitor.

### The run checks its reasoning effort before it checks anything else (2026-08-24)

Effort is not a per-agent setting speccy can pin the way it pins models. Subagents inherit the session's, so a pipeline that spawns ninety of them multiplies whatever the session was started at, and a run at `xhigh` costs hours the user did not choose to spend. The other preconditions guard correctness; this one guards the clock, so it reports and proceeds rather than stopping.

`CLAUDE_EFFORT` in the environment answers it, with `effortLevel` in `~/.claude/settings.json` as the fallback. The session transcript records `effort` per request too, and `metrics.mjs` already reads that field, but it was the wrong source: it needs the run's own transcript identified by mtime, and this repo has twice been caught by transcript-shape assumptions that returned believable wrong numbers. A silent value is left silent rather than assumed low, for the same reason the metrics report refuses to read an absent effort as a low one.
