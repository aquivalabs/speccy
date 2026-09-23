# Specification: Harness-agnostic speccy core

**Status**: Draft

## Goal

speccy is welded to Claude Code. Its two skills (`speccy`, `plan-execution`) call Claude-Code-only mechanisms — the `Agent` tool, the `Workflow` tool, `Monitor`, model aliases like `opus`, `/clear`, `shift+tab` — throughout their instructions and orchestration code. This spec restructures speccy into one shared semantic core plus a thin per-harness binding layer, so the same core drives a full run on OpenAI Codex as well as Claude Code, and a third harness later needs only a new binding.

Two decisions shape everything below:

- **The core targets a harness capability contract, bound at install time.** Each capability (spawn a subagent, run tasks in parallel, monitor a long job, and the rest) resolves at install to either a native adapter or a portable polyfill. The running agent never branches on which harness it is in.
- **Semantics are authored once, with no vendor leakage; Codex is the reference target, not the mould.** A change to what speccy does happens once in the core and reaches every harness. Codex exists to verify the contract holds against a second real harness; the contract's shape must admit a third without touching the core.

## Deliverables

- **A harness capability contract.** The named set of capabilities the core depends on, each with the input it takes and the result it returns. Current set: spawn-subagent (prompt + model-ladder rung + optional result schema + optional isolation → result), run-parallel, structured-output, worktree isolation, monitor/watchdog, model-ladder resolution (S/M/L/XL → a concrete model), invocation entrypoint, permission/approval configuration, instruction-file (`AGENTS.md`) location.

- **The shared semantic core**, carrying no harness-specific tool names, invocation syntax, or model aliases: `SKILL.md` and `phases/*.md` for both skills, `prompts/*.md`, the spec and plan templates, `state.mjs`, and `plan-execution`'s orchestration script (`workflow.js`, `workflow-simple.js`).

- **A workflow runtime contract.** `workflow.js` runs unchanged against an injected runtime (`agent`, `parallel`, `phase`, `log`, `args`, plus schema-validated results and worktree isolation). Claude Code's native `Workflow` tool is one implementation of this runtime; the Codex binding supplies another.

- **The Claude Code binding**: a native adapter that maps each contract capability to the tool speccy uses today, plus the plugin packaging (`plugin.json`, `marketplace.json`, `.claude/skills` discovery).

- **The Codex binding**: an adapter that packages the core as Codex skills (`agentskills.io` `SKILL.md` under `.agents/skills`), maps the S/M/L/XL ladder to Codex models, generates permission/sandbox configuration, and provides three polyfills where Codex has no native equivalent — a workflow runner over `codex exec`, structured spawn via `codex exec --output-schema`, and a monitor/watchdog.

- **A shared instruction file, `AGENTS.md`**, read by both harnesses, replacing today's Claude-only `CLAUDE.md` for the project instructions speccy relies on.

- **An install-time binding mechanism** that produces a working install for a named target from the shared core and its adapter.

- **A resolved binding record**, written by the install, that names the target and maps each capability and each model rung to its concrete mechanism. A startup precondition loads and validates it into the run, so every phase reads the binding rather than re-deriving it.

## Scope boundaries

- No new harness beyond Codex is built. The contract is designed to admit OpenCode, Pi, and others; none is implemented or verified here.
- speccy's pipeline semantics do not change. Phases, gates, critique loops, and review lenses behave as they do today; this is a restructuring, not a redesign.
- Claude Code behaviour and output are preserved. The core is neutralised, but a Claude Code run produces what it does now.
- No general plugin framework. The binding layer covers what speccy's two skills need, nothing more.
- Metrics reporting (`metrics.mjs`, `metrics.sh`) is out of scope for now. It is neither neutralised nor ported; its tests stay in CI.

## Constraints

- **One source of truth for semantics.** A semantic change is authored once in the core. Duplication is confined to the binding layer, and minimised there.
- **No runtime harness branching.** The core never inspects or names its host. Every harness difference resolves at install time.
- **No vendor leakage in the core.** Adding a harness requires a new adapter and zero edits to core files. This is a structural property of the contract, not a coding-style preference.
- **Harness facts are verified against current documentation, never memory.** Both harnesses move; Codex's subagent, model, and skill surfaces changed in 2026 and its docs warn of more. The contract must not hard-code a volatile specific where a role or capability name will do.
- **The existing verification survives.** `node --test "skills/speccy/test/*.test.mjs"` keeps passing, and the CI `status-check` job keeps its name (branch protection depends on it).

## Completion criteria

- [ ] A full speccy run completes on Codex for a small real feature: spec, spec critique rounds, plan, plan critique, plan review, build, and review, with the human gates, all driven from the shared core.
- [ ] The same core drives a full run on Claude Code, producing today's artifacts and behaviour.
- [ ] `plan-execution`'s `workflow.js` runs unmodified on both harnesses through their respective runtime implementations.
- [ ] The shared core contains no Claude- or Codex-specific tool name, invocation syntax, or model alias, checked by grep against a denylist.
- [ ] Model tiers appear in the core as ladder rungs (S/M/L/XL) and resolve to a concrete model per harness.
- [ ] `node --test "skills/speccy/test/*.test.mjs"` passes.

## Decisions & rationale

- **Decision**: Bind capabilities at install time; the core never branches on its harness.
  **Alternatives**: A runtime shim the core queries for "which harness am I in?" and switches on.
  **Why**: Runtime branching scatters harness knowledge through every instruction and grows with each new target; install-time binding keeps the core ignorant of its host and confines harness knowledge to one adapter.
  **Origin**: User.

- **Decision**: Share the whole semantic core; isolate only harness connections, tolerating duplication solely in the execution layer.
  **Alternatives**: A clean forked copy per harness under `codex/`.
  **Why**: A fork means every semantic change is made twice and drifts; the point of the effort is that a change to speccy's behaviour happens once.
  **Origin**: User.

- **Decision**: Express model choice in the core as a fixed ladder — S, M, L, XL — resolved to a concrete model per harness. On Claude Code, S/M/L/XL are Haiku, Sonnet, Opus, Fable.
  **Alternatives**: Keep model aliases like `opus` in the shared code; or open-ended semantic role names.
  **Why**: `opus` is a Claude token that `workflow.js` already hard-codes for breakdown. A fixed ladder survives a harness swap and a model rename, and a closed set of four rungs maps cleanly onto any harness's tiers where free-form role names would not.
  **Origin**: User.

- **Decision**: Target `AGENTS.md` as the shared project-instruction file, read by every harness, rather than a per-harness file.
  **Alternatives**: Keep `CLAUDE.md` for Claude Code and rename or symlink per harness.
  **Why**: A single instruction file both harnesses read removes a whole class of duplication. This rests on Claude Code's `AGENTS.md` support (see Assumptions).
  **Origin**: User.

- **Decision**: Resolve the binding once, from the install, and record it; a startup precondition loads it and no phase re-derives or detects it.
  **Alternatives**: Detect the harness at runtime by probing the environment; or re-resolve the binding wherever the pipeline needs it.
  **Why**: The install knows its target for certain, so recording the binding there is reliable where runtime probing guesses. Harnesses are converging (Codex reads `CLAUDE_PLUGIN_ROOT`; both speak `agentskills.io`), which makes detection ambiguous. Resolving once removes per-phase deliberation, the cost this avoids.
  **Origin**: User.

- **Decision**: Give harnesses that lack a capability a portable polyfill, and bind to the native capability where the harness has one.
  **Alternatives**: Always polyfill, for uniformity; or never polyfill, restricting the core to the lowest common capability.
  **Why**: A polyfill can drift from the real thing, so native is preferred where available; but the lowest common denominator would strip parallel builds and monitoring, which are core to speccy. Polyfill fills genuine gaps only.
  **Origin**: User.

- **Decision**: Codex is the reference target and the verification bar; portability to other harnesses is proven structurally, not empirically.
  **Alternatives**: Design abstractly with no second harness; or target several harnesses at once.
  **Why**: One real second harness keeps the contract honest where a purely abstract design would rot. More than one at once multiplies unverified work before the contract has settled.
  **Origin**: User.

## Assumptions

- The Codex acceptance bar is a full end-to-end run on a small real feature, producing the same artifacts and gates as Claude Code. A representative subset would be cheaper but would not prove the pipeline holds.
- Prose-neutralisation aims for zero harness tool-names in the core, with capability references resolved by the binding. Whether a thin per-harness glossary is an acceptable middle ground is left open below.
- Both skills (`speccy` and `plan-execution`) are in scope for this effort, per the decision to tackle the workflow crux directly.
- The `agentskills.io` `SKILL.md` standard is compatible enough between the two harnesses that the core skill files load and trigger under Codex with only packaging and discovery-path changes.
- Claude Code reads `AGENTS.md`, so the shared instruction file works on both harnesses. This is recent and the user is unsure of its status; the AGENTS.md decision falls back to a per-harness file if it proves unavailable.

## Open questions

- **The workflow polyfill is a feasibility assumption; spike it before planning commits.** The whole crux rests on a Codex runtime that reproduces the injected `agent`/`parallel`/`phase` API — including schema-validated results and worktree isolation — over `codex exec --output-schema` and parallel subprocesses. Prove a minimal `workflow.js` runs green on Codex before the plan builds on it.
- **Does the shared `SKILL.md` actually load and trigger under Codex** with only packaging and path changes, or does the body need edits? Resolve by installing one core skill into Codex and invoking it.
- **How pure must prose-neutralisation be?** Zero tool-names in the core, or a tolerated per-harness glossary the binding substitutes? Weigh the neutralisation cost against readability of the core instructions.
- **Does Claude Code read `AGENTS.md`** in the installed version, and with what precedence against `CLAUDE.md`? Confirm before the shared instruction file is relied on.
- **What is the install-time binding mechanism, and where is the binding record kept?** A build step that generates each target's tree, symlinks, or a loader resolved at install; the record as a standalone manifest the precondition reads, kept out of `state.json` so run state stays harness-neutral. Decide in planning against the no-runtime-branching constraint.
- **The exact Codex acceptance feature and its verification steps.** Pick something small that still exercises a parallel build.
