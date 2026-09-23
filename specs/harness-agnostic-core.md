# Specification: Harness-agnostic speccy core

**Status**: Draft

## Goal

speccy is welded to Claude Code. Its two skills (`speccy`, `plan-execution`) call Claude-Code-only mechanisms — the `Agent` tool, the `Workflow` tool, `Monitor`, model aliases like `opus`, `/clear`, `shift+tab` — throughout their instructions and orchestration code. This spec restructures speccy into one shared semantic core plus a thin per-harness binding layer, so the same core drives a full run on OpenAI Codex as well as Claude Code, and a third harness later needs only a new binding.

Two decisions shape everything below:

- **The core targets a harness capability contract, bound once at first run.** Each capability (spawn a subagent, run tasks in parallel, monitor a long job, and the rest) resolves to a native adapter or a portable polyfill, from a binding established once at first run and recorded, never probed for. The running agent never branches on which harness it is in.
- **Semantics are authored once, with no vendor leakage; Codex is the reference target, not the mould.** A change to what speccy does happens once in the core and reaches every harness. Codex exists to verify the contract holds against a second real harness; the contract's shape must admit a third through a new adapter, without reworking the semantic core.

## Deliverables

- **A harness capability contract, covering only what exceeds the baseline.** A baseline tool set — read, write, and edit files; run shell commands; the agent's own inference — is assumed on every harness and sits outside the contract (see Scope boundaries). The contract names the capabilities beyond it: spawn-subagent (prompt + model-ladder rung + optional result schema + optional worktree isolation → result), run-parallel, monitor/watchdog, and model-ladder resolution (S/M/L/XL → a concrete model). Packaging concerns the binding also settles — invocation entrypoint, permission/approval configuration, instruction-file (`AGENTS.md`) location, identity resolution — are settled by the binding and at first run, not as runtime tool calls.

- **The shared semantic core**, carrying no harness-specific tool names, user-facing commands (e.g. `/clear`, `shift+tab`), invocation syntax, or model aliases: `SKILL.md` and `phases/*.md` for both skills, `prompts/*.md`, the spec and plan templates, `state.mjs`, and `plan-execution`'s orchestration script (`workflow.js`, `workflow-simple.js`).

- **A workflow runtime contract.** One `workflow.js` runs on every harness against an injected runtime (`agent`, `parallel`, `phase`, `log`, `args`, plus schema-validated results and worktree isolation); model rungs resolve to concrete names through `args`. Claude Code's native `Workflow` tool is one implementation of this runtime; the Codex binding supplies another.

- **The Claude Code binding**: a native adapter that maps each contract capability to the tool speccy uses today, plus the plugin packaging (`plugin.json`, `marketplace.json`, `.claude/skills` discovery).

- **The Codex binding**: an adapter that packages the core as Codex skills (`agentskills.io` `SKILL.md` under `.agents/skills`), maps the S/M/L/XL ladder to Codex models, generates permission/sandbox configuration, and provides three polyfills where Codex has no native equivalent — a workflow runner over `codex exec`, structured spawn via `codex exec --output-schema`, and a monitor/watchdog.

- **Compatibility with the `AGENTS.md` convention** for the project instructions speccy relies on, so those instructions are read by every harness that supports the standard, instead of a Claude-only `CLAUDE.md`.

- **Working installs for each target** (Claude Code and Codex) from the shared core and its adapter. How an install is produced is left to planning (see Open questions); the preference is to ship the shared tree so each harness reads it in place, with a build step a last resort.

- **A first-run identity-and-binding precondition.** It establishes the harness identity once from a declared source, resolves the binding record (target, capability→mechanism map, model-rung→model map), records it, and validates it. Every phase then reads the binding rather than re-deriving it. The declared source is a per-harness detail — a package that carries it, a one-time user declaration, or a reliable harness-provided signal — decided in planning; the precondition never probes to guess the harness.

## Scope boundaries

- No new harness beyond Codex is built. The contract is designed to admit OpenCode, Pi, and others; none is implemented or verified here.
- speccy's pipeline semantics do not change. Phases, gates, critique loops, and review lenses behave as they do today; this is a restructuring, not a redesign.
- Claude Code behaviour and output are preserved. The core is neutralised, but a Claude Code run produces what it does now.
- No general plugin framework. The binding layer covers what speccy's two skills need, nothing more.
- Metrics reporting (`metrics.mjs`, `metrics.sh`) is out of scope for now. It is neither neutralised nor ported; its tests stay in CI.
- The baseline tool set — read, write, and edit files; run shell commands; the agent's own inference — is assumed present on every harness and excluded from the port. It is expressed at intent level with no binding; only capabilities beyond the baseline are in scope.

## Constraints

- **One source of truth for semantics.** A semantic change is authored once in the core. Duplication is confined to the binding layer, and minimised there.
- **No runtime harness branching.** The core never inspects or names its host. Every harness difference is declared once at first run and recorded.
- **No vendor leakage in the core.** Adding a harness needs a new adapter and its binding; it may adjust the thin seam the core calls the abstraction through, but never the pipeline's semantics, and never with per-harness branching. This is a structural property of the contract, not a coding-style preference.
- **Harness facts are verified against current documentation, never memory.** Both harnesses move; Codex's subagent, model, and skill surfaces changed in 2026 and its docs warn of more. The contract must not hard-code a volatile specific where a role or capability name will do.
- **Optimise for lean agent context, not disk footprint.** Every target may ship every adapter and polyfill, used or not; extra files on disk cost nothing. What must stay lean is the agent's context: it loads only the resolved binding and is never presented a tool-choice. Runtime deliberation over which tool to use is the cost this design removes, not bytes.
- **The existing verification survives.** `node --test "skills/speccy/test/*.test.mjs"` keeps passing, and the CI `status-check` job keeps its name (branch protection depends on it).

## Completion criteria

- [ ] A full speccy run completes on Codex for a small real feature: spec, spec critique rounds, plan, plan critique, plan review, build, and review, with the human gates, all driven from the shared core.
- [ ] The same core drives a full run on Claude Code, producing today's artifacts and behaviour.
- [ ] `plan-execution`'s `workflow.js` runs unmodified on both harnesses through their respective runtime implementations.
- [ ] The shared core contains no Claude- or Codex-specific tool name, user-facing command (e.g. `/clear`, `shift+tab`), invocation syntax, or model alias, checked by grep against a denylist. Concrete names live only in the adapters and the binding.
- [ ] The semantic files (both skills' `SKILL.md` and `phases/`, `prompts/`, the templates, and `workflow.js`) are identical between the Claude Code and Codex installs; any difference is an adapter or the binding.
- [ ] Model tiers appear in the core as ladder rungs (S/M/L/XL) and resolve to a concrete model per harness.
- [ ] `node --test "skills/speccy/test/*.test.mjs"` passes.

## Decisions & rationale

- **Decision**: Bind capabilities from a binding established once at first run; the core never branches on its harness.
  **Alternatives**: A runtime shim the core queries for "which harness am I in?" and switches on.
  **Why**: Runtime branching scatters harness knowledge through every instruction and grows with each new target; loading a resolved binding keeps the core ignorant of its host and confines harness knowledge to one adapter.
  **Origin**: User.

- **Decision**: Share the whole semantic core; isolate only harness connections, tolerating duplication solely in the execution layer.
  **Alternatives**: A clean forked copy per harness under `codex/`.
  **Why**: A fork means every semantic change is made twice and drifts; the point of the effort is that a change to speccy's behaviour happens once.
  **Origin**: User.

- **Decision**: Express model choice in the core as a fixed ladder — S, M, L, XL — resolved to a concrete model per harness. On Claude Code, S/M/L/XL are Haiku, Sonnet, Opus, Fable. The concrete model per rung reaches `workflow.js` through its runtime `args` (resolved from the binding), so the shared code names rungs, never model aliases, and the native runtime still receives real model names.
  **Alternatives**: Keep model aliases like `opus` in the shared code and reverse-map other harnesses' names onto them; or open-ended semantic role names.
  **Why**: `opus` is a Claude token that `workflow.js` currently hard-codes for breakdown. Keeping the aliases would reintroduce that leak and privilege one vendor's vocabulary; a fixed neutral ladder survives a harness swap and a model rename, and a closed set of four rungs maps cleanly onto any harness's tiers where free-form role names would not. The cost is one token in `workflow.js` (`"opus"` → `args.models.L`), not a rewrite.
  **Origin**: User.

- **Decision**: Rely on the `AGENTS.md` convention for project instructions, read by every harness that supports it, rather than a per-harness file.
  **Alternatives**: Keep `CLAUDE.md` for Claude Code and rename or symlink per harness.
  **Why**: One convention every harness reads removes a whole class of duplication. This rests on Claude Code's `AGENTS.md` support (see Assumptions).
  **Origin**: User.

- **Decision**: Ship every adapter and polyfill to every target; the first-run precondition selects which binding the agent loads.
  **Alternatives**: Ship only the target's adapter, via per-harness packaging.
  **Why**: Disk footprint is free; the scarce resource is the agent's context and attention. Bundling everything removes the need for per-harness packaging to carry the binding, so the design no longer rests on a distribution model unverified beyond Claude Code and Codex. Only the resolved binding enters context.
  **Origin**: User.

- **Decision**: Resolve the harness identity once, at a first-run precondition, from a declared source, and record it; no phase re-derives or detects it. A one-time user answer is the floor that works on every target; a harness-provided signal is used only where one exists (spike: Pi exposes one, OpenCode ships none).
  **Alternatives**: Detect the harness at runtime by probing the environment; or re-resolve the binding wherever the pipeline needs it.
  **Why**: A declared identity is a known fact where runtime probing would guess, and harnesses are converging (Codex reads `CLAUDE_PLUGIN_ROOT`; both speak `agentskills.io`), which makes probing ambiguous. Resolving once removes per-phase deliberation, the cost this avoids. Leaving the *source* per-harness avoids assuming a distribution model that holds for Claude Code and Codex but is unverified elsewhere.
  **Origin**: User.

- **Decision**: Assume a baseline tool set on every harness — read, write, and edit files; run shell; the agent's own inference — and exclude it from the contract and the port. Only capabilities beyond the baseline get a binding.
  **Alternatives**: Bind every action, baseline included, for total explicitness.
  **Why**: Every target verified has the baseline (spike), so binding it adds machinery for capabilities that never vary. Shrinking the contract to the beyond-baseline few — structured spawn, parallel, monitor, model rungs — is what keeps the abstraction small.
  **Origin**: User.

- **Decision**: Give harnesses that lack a capability a portable polyfill, and bind to the native capability where the harness has one.
  **Alternatives**: Always polyfill, for uniformity; or never polyfill, restricting the core to the lowest common capability.
  **Why**: A polyfill can drift from the real thing, so native is preferred where available; but the lowest common denominator would strip parallel builds and monitoring, which are core to speccy. Polyfill fills genuine gaps only. The gap can be large: Pi omits native subagents by design, so on it nearly the whole pipeline runs through the headless-subprocess polyfill — a mechanism every target provides.
  **Origin**: User.

- **Decision**: Codex is the reference target and the verification bar; portability to other harnesses is proven structurally, not empirically.
  **Alternatives**: Design abstractly with no second harness; or target several harnesses at once.
  **Why**: One real second harness keeps the contract honest where a purely abstract design would rot. More than one at once multiplies unverified work before the contract has settled.
  **Origin**: User.

## Assumptions

- The Codex acceptance bar is a full end-to-end run on a small real feature, producing the same artifacts and gates as Claude Code. A representative subset would be cheaper but would not prove the pipeline holds.
- However the core expresses actions, no vendor tool name reaches the agent's context: concrete tool names live only in the adapters and the binding, never in the shared core. Which expression achieves this best — intent-level instructions or an explicit tool map — is genuinely undecided (see Open questions).
- No post-install script runs on the user's machine, so the harness identity is declared at a first-run precondition rather than configured beforehand. Because every target ships every binding, this does not depend on per-harness distribution: the precondition selects the right binding once and records it.
- Both skills (`speccy` and `plan-execution`) are in scope for this effort, per the decision to tackle the workflow crux directly.
- The `agentskills.io` `SKILL.md` standard is compatible enough between the two harnesses that the core skill files load and trigger under Codex with only packaging and discovery-path changes.
- Codex, OpenCode, and Pi read `AGENTS.md` (verified in the spike); Claude Code's support is unconfirmed and the user is unsure. The shared instruction file works everywhere but Claude Code, where the decision falls back to a per-harness file if `AGENTS.md` proves unavailable.

## Open questions

- **The workflow polyfill is a feasibility assumption; spike it before planning commits.** The whole crux rests on a Codex runtime that reproduces the injected `agent`/`parallel`/`phase` API — including schema-validated results and worktree isolation — over `codex exec --output-schema` and parallel subprocesses. Prove a minimal `workflow.js` runs green on Codex before the plan builds on it. The headless-with-structured-output substrate the runner needs is verified present on all four targets (see the OpenCode/Pi spike); the residual risk is fidelity — worktree isolation and schema reliability — not availability.
- **Does the shared `SKILL.md` actually load and trigger under Codex** with only packaging and path changes, or does the body need edits? Resolve by installing one core skill into Codex and invoking it.
- **Intent-level instructions or an explicit tool map?** Two ways to keep vendor tools out of the core, and it is genuinely undecided which is better. *Intent-level*: the core says "read the file" or "delegate a critique to a fresh context" and each harness maps intent to its own tool — vendor-neutral by construction and near-zero binding, but weaker where intent underspecifies (structured spawn, parallel workflow), where the harness may act unreliably. *Tool map*: the core names capabilities that a per-harness binding resolves to concrete mechanisms — deterministic and explicit, at the cost of a map covering every capability and maintained per harness. A hybrid is plausible (intent for commodity actions, a mapped mechanism for the distinctive ones). The same choice governs the user-facing commands speccy issues (Claude Code's `/clear`, `shift+tab`, `/effort`): intent-level ("clear the context and re-invoke to resume") or mapped per harness. Resolve in planning, ideally by trying both on one representative capability.
- **Does Claude Code read `AGENTS.md`** in the installed version, and with what precedence against `CLAUDE.md`? Confirm before the shared instruction file is relied on.
- **What is the binding record and where is it kept?** A standalone manifest the first-run precondition reads, kept out of `state.json` so run state stays harness-neutral. Decide in planning against the no-runtime-branching constraint.
- **How is each target's install produced?** The preference is to ship the shared tree so every harness reads the same files in place (the bundle-everything decision makes this plausible), avoiding any transform that splits the installed artifact from its source. A build step that generates per-target trees is allowed but a last resort. Decide in planning per target's discovery rules.
- **The exact Codex acceptance feature and its verification steps.** Pick something small that still exercises a parallel build.
