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

## Decisions carried into the spec

The load-bearing decisions and their origins live in the spec's Decisions & rationale. All were the user's calls or user-agreed defaults, taken during intake:

- Install-time capability binding, no runtime harness branching — User.
- Share the whole semantic core, duplicate only the execution layer — User.
- Model ladder S/M/L/XL in the core (Claude: Haiku/Sonnet/Opus/Fable) — User.
- `AGENTS.md` as the shared instruction file, not per-harness `CLAUDE.md` — User.
- Ship all adapters and polyfills to every target; the first-run precondition selects which loads — User. The optimisation target is the agent's context, not disk. Bundling everything dissolved the earlier worry about whether distribution is per-harness: we no longer need directory structure or a tool-specific package to carry the binding.
- Assume a baseline tool set (read/write/edit files, run shell, agent inference) on every harness; express it at intent level and exclude it from the contract and the port — User. Shrinks the contract to the beyond-baseline few.
- Baseline expressed at intent level, beyond-baseline capabilities bound explicitly — User. Closed the "intent-level or tool map?" question, which was a false either/or: the answer is both, split along the baseline line already drawn.
- Spawn (a fresh-context agent returning a result) is a required capability, met by a native subagent or a headless subprocess; a harness with neither is out of scope until a later change — User. speccy is a delegation pipeline throughout, so a harness that cannot spawn cannot run it. Interpreted as native-or-headless so Pi (headless only) stays in.
- Native capability where present, polyfill only genuine gaps — User.
- Codex as the reference target; portability proven structurally — User.
- Resolve the harness identity once, at a first-run precondition, from a declared source, and record it; no phase re-derives or detects it — User. This decision moved twice as the user challenged it. It began as "install-time binding"; the user noted there is no post-install script, so it became a first-run precondition reading a binding file the package ships. The user then challenged the premise that packaging is per-harness (Pi and OpenCode may install from a structurally identical repo, so directory structure cannot be relied on). The settled position leaves the *source* of the declaration per-harness — a package that carries it, a one-time user answer, or a reliable harness signal — and keeps only "declared once, recorded, never probed" as the fixed part. Runtime detection stays rejected as fragile where harnesses converge.

Scope, set during the first-draft review: metrics reporting (`metrics.mjs`, `metrics.sh`) is excluded from this effort for now.
