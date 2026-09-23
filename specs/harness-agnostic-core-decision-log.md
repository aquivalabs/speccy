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
