# Decision log: Harness-agnostic speccy core

Running record of how decisions were reached. The spec states the current position; this log keeps the history behind it, including reversals and origin changes.

## Seed

The run began as "port the speccy skill from Claude Code to Codex; the hardest part is an alternative to workflows." Two reframings during intake changed the target before any spec was written:

- **From a Codex port to a harness-agnostic core.** The user set the real goal: share the important parts of speccy across harnesses, isolate only the harness connections, and bind at install time so the running agent never branches on its host. Codex became the first reference target, not the destination. The spec is written to this framing; the original single-target phrasing is not recorded there.
- **The empty `codex/skills/` scaffold is not a directive.** A prior port attempt left placeholder directories. The user is removing them and asked for a fresh design, so the scaffold's shape carries no weight.

## Corrected before it was written in

- **"Codex has no subagents" was wrong.** An early assumption, from memory, was that Codex lacked an agent-spawn primitive. The user flagged it and web research confirmed Codex has first-class subagents, though they return natural-language summaries rather than schema-validated results — which is why the design reaches for `codex exec --output-schema` for the deterministic pipeline. Recorded because it set the rule for the run: verify every harness fact against current docs, never memory.

## Spike: OpenCode and Pi (2026-09-23)

The user asked, before critique, whether other harnesses install like Claude and Codex — if so, the binding cannot lean on directory structure. A web spike checked OpenCode and Pi (full findings in `.speccy/harness-agnostic-core-20260923-0904/spike-opencode-pi-distribution.md`). It settled three things:

- The contract fits both: all four targets share the `agentskills.io` skill standard, `AGENTS.md` (Claude Code still unconfirmed), headless structured runs, and model/effort selection.
- Native subagents are not universal: Pi omits them by design, so on Pi nearly the whole pipeline runs through the headless-subprocess polyfill. This confirmed the polyfill strategy rather than changing it.
- Identity has no universal signal (Pi exposes one, OpenCode ships none), confirming the one-time user declaration as the floor.

## Acceptance is a smoke test, not a build

The user ruled out a full speccy run as the Codex acceptance: any feature small enough to be cheap is a poor fit for speccy, and any feature real enough is too expensive. Since the pipeline semantics are shared and already proven on Claude, the port's only new surface is the binding, so acceptance became a capability smoke test plus a thin orchestrator thread on each harness. A full end-to-end run drops to optional manual validation. Origin: User.

## Decisions carried into the spec

The load-bearing decisions and their origins live in the spec's Decisions & rationale. All were the user's calls or user-agreed defaults, taken during intake:

- Install-time capability binding, no runtime harness branching — User.
- Share the whole semantic core, duplicate only the execution layer — User.
- Model ladder S/M/L/XL in the core (Claude: Haiku/Sonnet/Opus/Fable) — User.
- `AGENTS.md` as the shared instruction file, not per-harness `CLAUDE.md` — User.
- Ship all adapters and polyfills to every target; the first-run precondition selects which loads — User. The optimisation target is the agent's context, not disk. Bundling everything dissolved the earlier worry about whether distribution is per-harness: we no longer need directory structure or a tool-specific package to carry the binding.
- Assume a baseline tool set (read/write/edit files, run shell, agent inference) on every harness; express it at intent level and exclude it from the contract and the port — User. Shrinks the contract to the beyond-baseline few.
- Baseline expressed at intent level, beyond-baseline capabilities bound explicitly — User. Closed the "intent-level or tool map?" question, which was a false either/or: the answer is both, split along the baseline line already drawn.
- Spawn (a fresh-context agent returning a result) is a required capability, met by a native subagent or a headless subprocess; a harness with neither is out of scope until a later change — User. speccy is a delegation pipeline throughout, so a harness that cannot spawn cannot run it.
- Drop Pi from this PR; build the native spawn form only, defer the headless-spawn polyfill — User. Narrows the spawn decision above: spawn stays required, but only its native form is built now (Claude's Agent tool, Codex's native subagents), sufficient because speccy reads the agent's output file rather than its returned summary. The workflow runtime's structured spawns still use `codex exec`; that is separate from the deferred generic polyfill. Pi's polyfill insertion point will be obvious once the binding exists.
- Native capability where present, polyfill only genuine gaps — User.
- Codex as the reference target; portability proven structurally — User.
- Resolve the harness identity once, at a first-run precondition, from a declared source, and record it; no phase re-derives or detects it — User. This decision moved twice as the user challenged it. It began as "install-time binding"; the user noted there is no post-install script, so it became a first-run precondition reading a binding file the package ships. The user then challenged the premise that packaging is per-harness (Pi and OpenCode may install from a structurally identical repo, so directory structure cannot be relied on). The settled position leaves the *source* of the declaration per-harness — a package that carries it, a one-time user answer, or a reliable harness signal — and keeps only "declared once, recorded, never probed" as the fixed part. Runtime detection stays rejected as fragile where harnesses converge.

Scope, set during the first-draft review: metrics reporting (`metrics.mjs`, `metrics.sh`) is excluded from this effort for now.

## Spec critique round 1 (2026-09-23)

An opus adversary critiqued the spec (substance only; the readability pass had not yet run). Full findings in `.speccy/harness-agnostic-core-20260923-0904/spec-critique-round-1.md`. The user drove every disposition; no borrowed-confidence check applied. The load-bearing outcomes:

- **The workflow runtime becomes a per-harness JS module, replacing reliance on `codex exec --output-schema`.** The critic web-verified that `--output-schema` is silently dropped when the agent uses tools (openai/codex#15451), and every schema-bearing agent in `workflow.js` uses tools. The user reframed the runtime: a per-harness JS module wraps the harness CLI and derives its return-shape guarantees from files, raw output, and git state, never from stdout schema or the model's word, and owns the git-worktree lifecycle where the harness has no native isolation. The superseded position was structured returns over `codex exec --output-schema` stdout, carried as a fidelity risk. The new decision scopes to the workflow runtime only; the orchestrator stays native. Origin: User. This resolved findings 2, 5, and 8.

- **Codex is a fixed target for a commercial reason, not an arbitrary reference harness.** The critic argued the Codex choice looked path-dependent and that OpenCode was the cleaner second harness. The user gave the reason the spec had not stated: OpenAI and Anthropic subscriptions are the cost-efficient way to buy tokens for speccy, and Codex ships with the OpenAI subscription, where routing OpenAI through a third-party harness (OpenCode plus provider configuration) is more setup. Origin: User. This resolved finding 7.

- **"Both skills in scope" promoted from an assumption to a decision** (alternative: port `speccy` first, defer `plan-execution`; rejected because the `workflow.js` runtime is the crux). Origin: User.

Adopted without reframing: the stale full-run acceptance assumption deleted (finding 1); `AGENTS.md` support recorded as conditional, suppressed by any shadowing `CLAUDE.md`, per the Claude Code memory docs (3); the dead intent-vs-tool-map cross-reference deleted (4); the identical-files criterion made conditional on the build-step install (8); self-duplication removed (9); the metrics denylist exclusion and the no-extensibility-criterion note added (10). Nothing was skipped.

## Spec critique round 2 (2026-09-23)

An opus adversary read the rewritten spec cold, with the reader lens, and was not told what the readability pass had cut. It confirmed no deliverable was dropped and the architecture was described faithfully against the real `workflow.js`. Twelve findings, all adopted; no decision reversed and no origin changed, so the underlying positions still stand as the spec states them. Full findings in `.speccy/harness-agnostic-core-20260923-0904/spec-critique-round-2.md`. Two clarified the load-bearing architecture:

- **The Codex monitor's liveness signal is now named.** The watchdog keys off Claude Code `agent-*.jsonl` transcript mtimes, which Codex never writes (verified against `skills/plan-execution/SKILL.md`); the spec now specifies the Codex monitor polls each `codex exec` subprocess's state and its output files' mtimes, and the completion criterion checks the monitor is armed and polling rather than "fires" (a healthy watchdog stays silent).
- **spawn-subagent is split into two bindings.** Orchestrator-native (prose, no schema, read-the-file; also covers orchestrator fan-out) and workflow-module (file/git-derived result, optional schema and worktree), with the injected `agent` identified as the workflow-module binding.

The rest were de-duplication and reader fixes: the workflow mechanism collapsed to one home, `CLAUDE.md` removed from the harness-agnostic layer in favour of "the instruction file's `## Worktree init` section", the seven-probe smoke criterion split into one line each, and three redundant Assumptions bullets cut. Nothing was skipped.

## Spec critique round 3 (2026-09-23)

The final round read the round-2 spec cold and returned "ready to plan against": four modest findings, none blocking, no decision reversed. Full findings in `.speccy/harness-agnostic-core-20260923-0904/spec-critique-round-3.md`. Applied autonomously under the user's overnight delegation:

- Added a completion criterion covering the Codex worktree-init path: a smoke-workflow task carrying gitignored state, which exercises both the `## Worktree init` apply step and the resolution of the correct instruction file. This is the strongest cross-check that the worktree-init polyfill and the instruction-file-pointing deliverable work on Codex, and it was previously untested.
- De-duplicated the Codex monitor liveness mechanism; it stays in the workflow runtime contract, and the Codex binding now cross-references it.
- Cut the Assumptions bullet's second sentence, which re-argued the ship-everything decision.

Carried forward, not a spec change: Codex issue #15451 (the `--output-schema`-with-tools defeater cited in the workflow-runtime decision) is now closed with no readable resolution. The decision stands on its independent reason — the module controls and validates the guarantee — so the planner's workflow-module spike must re-verify #15451's current state; if it was fixed, the decision's "Why" should lead with the control/validation reason and demote the bug to history.

Nothing was skipped across the three rounds.

## Plan review: the binding becomes conversation-scoped, not a file (2026-09-24)

At the plan-review gate the user reversed two spec positions at once. Both are now the spec's current text; the superseded positions are recorded here.

- **The resolved binding is held for the orchestrator conversation, not written to a per-checkout file.** The plan had settled the spec's open question ("what is the binding record and where is it kept") as a gitignored `.speccy/binding.json`, written once at first-run setup. The plan critique's rounds 1 and 2 then showed that file could not detect a harness switch on the same checkout without a forbidden probe, and the revise papered the gap over once. The user identified the root cause: the harness is a property of the running conversation, not the checkout, so a per-checkout file gives the binding a cross-conversation lifetime it should not have, and that lifetime is exactly what goes stale. The settled position: resolve the harness once at the start of each orchestrator conversation, hold the resolved binding in-conversation, and re-resolve on a fresh conversation. Only the per-harness adapter defaults stay as versioned files. The two-harness staleness dissolves rather than being guarded against. Origin: User.

- **The no-branching constraint was too absolute; it now forbids per-phase branching, not all inspection.** The spec had read "the core never inspects or names its host." The user judged this their own misstep: resolving identity at the conversation boundary is a runtime branch, but a single bounded one, categorically different from the scattered `if harness == …` per-phase branching the constraint exists to prevent. The constraint now names the one permitted inspection point (the conversation-start step) and forbids per-phase branching everywhere else. This also reopened identity resolution: the agent's own knowledge of its host (reliable on Claude Code and Codex, which both make it known to the running agent) is now the primary source, with a one-time user declaration as the universal fallback; the earlier "declared source, never probe" had over-indexed on the unreliability of a shell script's env-probe, which does not apply to the agent's self-knowledge. Origin: User.

These reset one of the two lead decisions, so the plan is revised to match and a final cold-read critique (spec and plan together, told nothing about what changed) runs before the build, to catch any wider implication of the pivot.

## Cold-read critique: the orchestrator's model path joins the ladder (2026-09-24)

The final cold-read critic (spec and plan together, no history) found two blockers. The spike blocker cleared: the user ran the plain-terminal Codex spike from their own terminal and confirmed a tool-using task lands a commit, so the module's minimal case is user-confirmed rather than asserted (`spike-workflow-module.md` header reconciled).

The design blocker was real. Model neutralisation had covered only `workflow.js`'s one `"opus"` literal and prose defaults, missing that model choice is persisted state: `state.mjs` defaults to concrete names, `set-model` writes them, and they live in `state.json`, which `state.test.mjs` asserts. The plan both put `state.mjs` on the model-alias denylist and called it already neutral — a contradiction that would fail CI or break the suite the plan promised to keep green. More deeply, the orchestrator's own model selection (every critique/review tier, the builder, `recommend-a-builder`) flowed through `state.mjs` and never touched the S/M/L/XL ladder or the conversation-start binding.

The user ruled: `state.json` stores rungs, not model names; the conversation-start binding resolves a rung to a concrete model whenever the orchestrator spawns a subagent; `state.test.mjs` asserts rungs; `set-model`/`recommend-a-builder` speak in rungs while the skill also names the concrete model, so a user who doesn't track vendor names isn't lost. This makes `state.json` genuinely harness-neutral and dissolves the cross-harness model-staleness the critic flagged. Origin: User.

The run replanned to apply this and the critic's nine other findings (full list in `plan-critique-cold-final.md`, directions in `replan-brief.md`), then re-enters the plan-critique loop before build. Builder chosen: Opus (the model neutralisation is a judgment-heavy design pass, and the Codex loader is novel). Origin: User.

## Plan critique round 1: structured results come from files the agent writes (2026-09-24)

The re-run plan-critique's first round found the plan's result-derivation mechanism unproven and mis-described. `workflow.js` runs no git itself; `confirmFromGit` and every structured result come from a schema-bearing `agent()` call — the model's validated return through the `Workflow` tool. On Codex the equivalent stdout channel (`codex exec --output-schema`) is the one #15451 degrades under tools, and breakdown's `STEP_SCHEMA` has no git footprint to derive from, so "derive from files and git" could not produce it. The plain-terminal spike had proven a commit lands, not that a tool-using schema agent returns a validatable object.

The user resolved it: the Codex module instructs the agent to write its structured result to a file — for reasoning-only steps too — and reads and validates that file, rather than trusting the `codex exec` structured-output stdout. This answers the silent-failure trap of #15451 (under tools the model degrades its structured output while `codex exec` exits 0; the maintainer closed it as model behaviour and recommended wrapping `codex exec` in schema validation, which is what the module does), rests on the file-write substrate the spike already proved, and is generic at the `agent(prompt, {schema})` boundary because the schema is known there. It also honours the spec's existing "derive from files, never from `--output-schema` stdout" decision as the precise reading of "from files," so no spec reversal follows. Origin: User.

The plan is revised to this and the round's other findings (an `args.models` ordering break, an overstated monitor-parity claim, and five minor fixes; full list in `plan-critique-round-1.md`, directions in `round1-resolution.md`). A build-time confirmatory check — a `codex exec` agent writing a schema-valid `STEP_SCHEMA` file — is added rather than a new blocking gate, since the delta from the proven spike is only the file's JSON validity.

## Build and review (2026-09-24)

The build ran the plan on Opus: seven tasks, all integrated, no corrective tasks. Two review rounds followed; the user declined a third in favour of their own manual and automated review.

- **Instruction-file resolution is per-harness adapter config, bounded to the git repo.** The first build hard-coded `CLAUDE.md` as the Claude instruction file, which named a file that does not exist in a repo (like this one) that uses only `AGENTS.md`, breaking the worktree-init preflight and subagent pointing. The fix puts the resolution in each adapter: the Claude adapter prefers a `CLAUDE.md` (or `CLAUDE.local.md` / `.claude/CLAUDE.md`) found from the working directory up to the git repo root, else `AGENTS.md`; the Codex adapter is always `AGENTS.md` and does not follow Claude's precedence. The walk stops at the repo root so a user's global `~/.claude/CLAUDE.md` cannot hijack a repo that uses `AGENTS.md`: speccy resolves the project's governing doc, not every file the harness happens to load. Origin: User.

- **A round-1 review fix was reverted in round 2 as a regression.** Round 1 made the Codex runtime's `agent()` throw on a non-zero `codex exec` exit. That broke the execute path, whose success oracle is git state via `confirmFromGit`, not the exit code (a non-zero exit can accompany a landed commit): the throw propagated through `parallel()` and skipped the integrate-succeeded-siblings loop and worktree cleanup. Round 2 caught it. The exit code is now a logged diagnostic; the schema path trusts a validated result file and the non-schema path trusts git. Recorded because it is a reversal the run made, and because it is the case for the second cold review pass: one pass missed a regression its own fix introduced. Origin: speccy, alone.

- **Builder on Opus** for the model-neutralisation prose and the novel Codex loader. Origin: User (carried from plan review).

The load-bearing architecture decisions (rungs in `state.json`, the conversation-scoped binding, the file-write result channel) are recorded above and unchanged by the build.

## Post-review: concrete model names leave the core (2026-09-24)

An earlier decision had speccy name the concrete model beside the rung ("the L rung (Opus on Claude)") so a user unfamiliar with vendor names is not lost, with the denylist carving out that one form. In review the user reconsidered: the rung→model mapping belongs in the adapter, not the skill. The core now names rungs only; where speccy tells the user a concrete model (the recommend-a-builder step) it resolves the rung through the binding, whose map lives in the per-harness adapter. The denylist carve-out is removed, so the core carries zero model names and the check is stricter. The user's original intent (name the model so a user is not lost) is preserved, sourced from the adapter at runtime rather than hard-coded in the core. Origin: User.

## Post-review: one plugin for both harnesses (2026-09-25)

The build shipped Codex discovery as `.agents/skills` symlinks into `skills/`. Those are found only when Codex runs inside the speccy repo, so they gave other projects no install, and alongside an installed plugin they list each skill twice (Codex lists duplicate skill names rather than overriding). A probe showed Codex 0.154.0 installs the existing Claude Code plugin unchanged from `.claude-plugin/marketplace.json`, with both skills loading and `binding.mjs` resolving from the installed copy. The symlinks are removed and the one plugin serves both harnesses.

The same probe showed Codex drops `when_to_use` from the prompt, so the trigger phrases moved into `description`. `allowed-tools` stays: Codex ignores it without error, and on Claude Code it pre-approves the state, binding, and banner calls. Origin: User.

## Post-review: a Codex entrypoint for the workflow (2026-09-25)

Review found that nothing let a Codex orchestrator run `workflow.js`. The runtime module existed and every completion criterion passed, but each criterion drove the module from test code, and the one criterion that would have followed the user's path (a full Codex run) was scoped out. No critique round or review lens caught the gap, because the spec-fidelity lens judges against those same criteria.

The fix adds run-workflow to the contract and a criterion for it. On Codex, `adapters/codex/run-workflow.mjs` starts the workflow detached and returns at once; the run reports through a status file in a temp directory (state, phase, recent log lines), and `monitor.mjs status` reads it, reporting a run whose process vanished as `died`. Polling a file replaces the completion notification Claude Code's `Workflow` tool sends, which Codex lacks, and suits Codex's roughly five-minute cap on a shell call. Origin: User.

## Post-review: Codex build agents keep their sandbox (2026-09-25)

The build spawned every `codex exec` agent with `--dangerously-bypass-approvals-and-sandbox`. Its rationale was that the parent Codex session is the sandbox boundary, but the runner launches detached, outside that session's control, and the agents run unattended and in parallel. The user chose the workspace-write sandbox with `--approve-for-me`, which routes approval requests to Codex's automatic review, and removed the bypass posture outright so nothing can switch the sandbox off. An agent that keeps getting blocked surfaces in the end-of-run friction log, which now asks for every blocked or approval-held tool call. Worktree agents get the repo's git directory as an extra writable directory, since their commits write outside their worktree. Origin: User.

## Post-review: the rest of the core's Claude residue moves to the adapters (2026-09-25)

The denylist missed tokens the spec itself names (`/clear`, `shift+tab`, `/effort`), so Claude-specific text survived in the core: the effort check's `CLAUDE_EFFORT` and `~/.claude/settings.json`, the Read, Write and Glob tool names, the `Workflow` tool's `baseRef` setting in `.claude/settings.json`, and a few `.claude/` paths. The effort check becomes an adapter setting (`effortCheck`), since each harness stores effort differently; the `baseRef` requirement moves into the Claude adapter's run-workflow mechanism, since only the `Workflow` tool's worktrees need it; the rest became intent-level wording. The denylist now also rejects slash commands, shift+tab, baseline tool names, vendor environment variables, and the capitalised vendor names. Origin: User.

## Post-review: the worktree root is an adapter setting (2026-09-25)

The Codex runtime created worktrees under `.claude/worktrees`, borrowing the `Workflow` tool's location, and `workflow.js`'s cleanup named that path. A Codex user's repo has no reason to ignore `.claude/`, so every parallel build left the main checkout dirty. The root is now each adapter's `worktreeRoot` setting, passed to `workflow.js` through its args: Claude Code keeps `.claude/worktrees`, and Codex uses `.speccy/worktrees`, inside the directory speccy already gitignores. Because `plan-execution` can run without speccy, the Codex runtime also adds the root to `.git/info/exclude` when git does not already ignore it; that file is local-only, so no tracked file changes. Origin: User.

## Post-review: adapters store model families, never versions (2026-09-25)

The Codex adapter mapped rungs to versioned slugs (`gpt-6-luna` and so on), and the local catalog already disagreed with the docs a day later. The user ruled that no adapter stores a version, because every release would otherwise need an edit. The Codex rungs now name families (S `luna`, M `sol`, L and XL `astra`, ranked as the Codex models page describes them), and a `modelResolution` rule has the orchestrator turn each family into the newest model of that family in the list its spawn tool shows at conversation start, never from memory. Claude Code's aliases (`haiku`, `sonnet`, `opus`, `fable`) already carry no version. A test rejects any stored model name containing a digit. Origin: User.
