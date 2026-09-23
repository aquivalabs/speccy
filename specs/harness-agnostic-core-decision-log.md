# Decision log: Harness-agnostic speccy core

Running record of how decisions were reached. The spec states the current position; this log keeps the history behind it, including reversals and origin changes.

## Seed

The run began as "port the speccy skill from Claude Code to Codex; the hardest part is an alternative to workflows." Two reframings during intake changed the target before any spec was written:

- **From a Codex port to a harness-agnostic core.** The user set the real goal: share the important parts of speccy across harnesses, isolate only the harness connections, and bind at install time so the running agent never branches on its host. Codex became the first reference target, not the destination. The spec is written to this framing; the original single-target phrasing is not recorded there.
- **The empty `codex/skills/` scaffold is not a directive.** A prior port attempt left placeholder directories. The user is removing them and asked for a fresh design, so the scaffold's shape carries no weight.

## Corrected before it was written in

- **"Codex has no subagents" was wrong.** An early assumption, from memory, was that Codex lacked an agent-spawn primitive. The user flagged it and web research confirmed Codex has first-class subagents, though they return natural-language summaries rather than schema-validated results — which is why the design reaches for `codex exec --output-schema` for the deterministic pipeline. Recorded because it set the rule for the run: verify every harness fact against current docs, never memory.

## Decisions carried into the spec

The load-bearing decisions and their origins live in the spec's Decisions & rationale. All were the user's calls or user-agreed defaults, taken during intake:

- Install-time capability binding, no runtime harness branching — User.
- Share the whole semantic core, duplicate only the execution layer — User.
- Model ladder S/M/L/XL in the core (Claude: Haiku/Sonnet/Opus/Fable) — User.
- `AGENTS.md` as the shared instruction file, not per-harness `CLAUDE.md` — User.
- Native capability where present, polyfill only genuine gaps — User.
- Codex as the reference target; portability proven structurally — User.
- Resolve the binding once, declared in the per-harness package and loaded by a first-run precondition; no phase re-derives or detects it — User. The user proposed a precondition that "figures out what it's running in." First pass called this "install-time binding"; the user corrected that there is no post-install script, so the resolution point is a first-run precondition reading a binding file the package ships. Runtime detection stays rejected as fragile where harnesses converge.

Scope, set during the first-draft review: metrics reporting (`metrics.mjs`, `metrics.sh`) is excluded from this effort for now.
