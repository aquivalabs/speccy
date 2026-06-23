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
