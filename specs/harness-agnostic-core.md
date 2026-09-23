# Specification: Harness-agnostic speccy core

**Status**: Draft

## Goal

speccy is welded to Claude Code. Its two skills (`speccy`, `plan-execution`) call Claude-Code-only mechanisms — the `Agent` tool, the `Workflow` tool, `Monitor`, model aliases like `opus`, `/clear`, `shift+tab` — throughout their instructions and orchestration code. This spec restructures speccy into one shared semantic core plus a thin per-harness binding layer, so the same core drives a full run on OpenAI Codex as well as Claude Code, and a third harness later needs only a new binding.

Two decisions shape everything below:

- **The core targets a harness capability contract, bound once at first run.** Each capability (spawn a subagent, run tasks in parallel, monitor a long job, and the rest) resolves to a native adapter or a portable polyfill, from a binding established once at first run and recorded, never probed for. The running agent never branches on which harness it is in.
- **Semantics are authored once, with no vendor leakage; Codex is a fixed second target, and portability to further harnesses is proven structurally rather than empirically.** A change to what speccy does happens once in the core and reaches every harness. Codex is fixed because OpenAI and Anthropic subscriptions are the cost-efficient way to buy tokens for speccy and Codex ships with the OpenAI subscription, needing no third-party harness; the contract's shape must still admit a third harness through a new adapter, without reworking the semantic core.

## Deliverables

- **A harness capability contract, covering only what exceeds the baseline** (see Scope boundaries for the baseline tool set). The contract names the capabilities beyond it: spawn-subagent (prompt + model-ladder rung + optional result schema + optional worktree isolation → result), run-parallel, monitor/watchdog, and model-ladder resolution (S/M/L/XL → a concrete model). Packaging concerns the binding also settles — invocation entrypoint, permission/approval configuration, instruction-file (`AGENTS.md` or `CLAUDE.md`) location, identity resolution — are settled by the binding and at first run, not as runtime tool calls.

- **The shared semantic core**, carrying no harness-specific tool names, user-facing commands (e.g. `/clear`, `shift+tab`), invocation syntax, or model aliases: `SKILL.md` and `phases/*.md` for both skills, `prompts/*.md`, the spec and plan templates, `state.mjs`, and `plan-execution`'s orchestration script (`workflow.js`, `workflow-simple.js`).

- **A workflow runtime contract.** One `workflow.js` runs on every harness against an injected runtime (`agent`, `parallel`, `phase`, `log`, `args`, plus schema-validated results and worktree isolation); model rungs resolve to concrete names through `args`. Each harness implements the runtime as a per-harness JS module that presents that injected API: Claude Code's native `Workflow` tool is one implementation; the Codex module is another, wrapping `codex exec` and deriving its return-shape guarantees from files, the harness's raw output, and git state, never from the model's own report. Where a harness has no native worktree isolation, its module owns the worktree lifecycle with plain git — provision, recreate gitignored state via CLAUDE.md's `## Worktree init` apply step, tear down; where a harness has native isolation, as Claude Code's `Workflow` tool does, the module defers to it.

- **The Claude Code binding**: a native adapter that maps each contract capability to the tool speccy uses today, plus the plugin packaging (`plugin.json`, `marketplace.json`, `.claude/skills` discovery).

- **The Codex binding**: an adapter that packages the core as Codex skills (`agentskills.io` `SKILL.md` under `.agents/skills`), maps the S/M/L/XL ladder to Codex models, generates permission/sandbox configuration, and provides two polyfills where Codex has no native equivalent — the workflow runtime module over `codex exec` (see the workflow runtime contract) and a monitor/watchdog.

- **Compatibility with the `AGENTS.md` convention** for the project instructions speccy relies on: the binding points each harness at whichever instruction file that harness actually loads — `AGENTS.md` where the harness supports it and no `CLAUDE.md` shadows it, `CLAUDE.md` on Claude Code where one exists.

- **Working installs for each target** (Claude Code and Codex) from the shared core and its adapter. How an install is produced is left to planning (see Open questions); the preference is to ship the shared tree so each harness reads it in place, with a build step a last resort.

- **A first-run identity-and-binding precondition.** It establishes the harness identity once from a declared source, resolves the binding record (target, capability→mechanism map, model-rung→model map), records it, and validates it. Every phase then reads the binding rather than re-deriving it. The declared source is a per-harness detail — a package that carries it, a one-time user declaration, or a reliable harness-provided signal — decided in planning; the precondition never probes to guess the harness.

## Scope boundaries

- No new harness beyond Codex is built. The contract is designed to admit OpenCode, Pi, and others; none is implemented or verified here.
- The contract's admission of a third harness is judged by reviewers reading the contract's shape, not by a completion criterion; testing extensibility would require building a third adapter, so none is required here by design.
- A harness that provides no spawn capability — neither native subagents nor a headless subprocess mode — is out of scope. Supporting one would be a later change.
- This PR targets Claude Code and Codex, both of which have native subagents. Pi (native subagents absent, headless mode present) is dropped from this PR along with the headless-spawn polyfill it would need; the contract must still admit it later.
- speccy's pipeline semantics do not change. Phases, gates, critique loops, and review lenses behave as they do today; this is a restructuring, not a redesign.
- Claude Code behaviour and output are preserved. The core is neutralised, but a Claude Code run produces what it does now.
- No general plugin framework. The binding layer covers what speccy's two skills need, nothing more.
- Metrics reporting (`metrics.mjs`, `metrics.sh`) is out of scope for now. It is neither neutralised nor ported; its tests stay in CI.
- A full end-to-end speccy run on Codex for a real feature is not a PR gate. It is optional manual validation; the semantics are shared and proven on Claude, so the gate is the binding smoke test, not the pipeline.
- The baseline tool set — read, write, and edit files; run shell commands; the agent's own inference — is assumed present on every harness and excluded from the port. It is expressed at intent level with no binding; only capabilities beyond the baseline are in scope.

## Constraints

- **One source of truth for semantics.** A semantic change is authored once in the core; duplication is confined to the binding layer and minimised there.
- **No runtime harness branching.** The core never inspects or names its host; every harness difference is declared once at first run and recorded.
- **No vendor leakage in the core.** Adding a harness needs a new adapter and its binding; it may adjust the thin seam the core calls the abstraction through, but never the pipeline's semantics, and never with per-harness branching. This is a structural property of the contract, not a coding-style preference.
- **Harness facts are verified against current documentation, never memory.** Both harnesses move; Codex's subagent, model, and skill surfaces changed in 2026 and its docs warn of more. The contract must not hard-code a volatile specific where a role or capability name will do.
- **Optimise for lean agent context, not disk footprint.** Every target may ship every adapter and polyfill, used or not; the agent loads only the resolved binding and is never presented a tool-choice.
- **The existing verification survives.** `node --test "skills/speccy/test/*.test.mjs"` keeps passing, and the CI `status-check` job keeps its name (branch protection depends on it).

## Completion criteria

- [ ] A capability smoke test passes on Codex: the skill loads and triggers, the first-run binding resolves, and each contract capability executes once — a spawned subagent writes a file speccy reads; a minimal `workflow.js` fans out parallel tasks through the Codex workflow runtime module, using a tool-using agent (one that reads or writes a file and runs a shell command), and the test asserts the result the module returns and that worktree isolation held, both exercised through the module; the monitor fires; the model ladder resolves to concrete models.
- [ ] A thin orchestrator thread runs on Codex: skill load → one delegated subagent round-tripped through its file → `state.mjs` advances a phase, without the full critique/build/review loops.
- [ ] The same smoke test and thin thread pass on Claude Code, and its behaviour is unchanged from today.
- [ ] `plan-execution`'s `workflow.js` runs unmodified on both harnesses through their respective runtime implementations.
- [ ] The shared core contains no Claude- or Codex-specific tool name, user-facing command (e.g. `/clear`, `shift+tab`), invocation syntax, or model alias, checked by grep against a denylist; the denylist excludes `metrics.mjs` and `metrics.sh` (out of scope, ships in the tree, and carries Claude-specific tokens by design). Concrete names live only in the adapters and the binding.
- [ ] Under the build-step install, if one is used, the semantic files (both skills' `SKILL.md` and `phases/`, `prompts/`, the templates, and `workflow.js`) are identical between the Claude Code and Codex installs; any difference is an adapter or the binding. Under the preferred ship-the-tree install the two installs share the same files by construction, so this criterion is moot there and the grep-denylist criterion is what checks neutrality.
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

- **Decision**: Both `speccy` and `plan-execution` are in scope for this effort.
  **Alternatives**: Port `speccy` first, defer `plan-execution` to a follow-up.
  **Why**: `plan-execution`'s `workflow.js` runtime is the crux of the whole effort; deferring it defers the point.
  **Origin**: User.

- **Decision**: Express model choice in the core as a fixed ladder — S, M, L, XL — resolved to a concrete model per harness. On Claude Code, S/M/L/XL are Haiku, Sonnet, Opus, Fable. The concrete model per rung reaches `workflow.js` through its runtime `args` (resolved from the binding), so the shared code names rungs, never model aliases, and the native runtime still receives real model names.
  **Alternatives**: Keep model aliases like `opus` in the shared code and reverse-map other harnesses' names onto them; or open-ended semantic role names.
  **Why**: `opus` is a Claude token that `workflow.js` currently hard-codes for breakdown. Keeping the aliases would reintroduce that leak and privilege one vendor's vocabulary; a fixed neutral ladder survives a harness swap and a model rename, and a closed set of four rungs maps cleanly onto any harness's tiers where free-form role names would not. The cost is one token in `workflow.js` (`"opus"` → `args.models.L`), not a rewrite.
  **Origin**: User.

- **Decision**: Point each harness at whichever instruction file it actually loads — `AGENTS.md` where the harness supports it and no `CLAUDE.md` shadows it, `CLAUDE.md` on Claude Code where one exists.
  **Alternatives**: Keep `CLAUDE.md` for Claude Code and rename or symlink per harness; or rely on `AGENTS.md` everywhere as a single universal file.
  **Why**: Harnesses that support `AGENTS.md` read it, but Claude Code reads it only as a fallback: any `CLAUDE.md` at or above the working directory suppresses it (Claude Code memory docs, https://code.claude.com/docs/en/memory; support added v2.1.277). A speccy user whose project already has a `CLAUDE.md` would have `AGENTS.md` silently ignored on Claude Code, so the single-file win holds only where no `CLAUDE.md` shadows `AGENTS.md`; where one does, `CLAUDE.md` is the file that reaches the agent.
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

- **Decision**: Express the baseline at intent level; bind the beyond-baseline capabilities explicitly.
  **Alternatives**: One uniform approach for everything — all intent-level, or all mapped.
  **Why**: Intent-level is vendor-neutral and free for the actions every harness has; the beyond-baseline capabilities are exactly where intent underspecifies (structured spawn, parallel, monitor), so they need an explicit, deterministic binding. Neither approach fits both halves. User-facing commands speccy issues (Claude Code's `/clear`, `shift+tab`, `/effort`) are baseline interaction, expressed at intent level ("clear the context and re-invoke").
  **Origin**: User.

- **Decision**: Spawn is a required capability of any target, met by a native subagent or a headless subprocess. This PR implements the native form only: orchestrator-level spawns use Claude's `Agent` tool and Codex's native subagents, and since speccy reads the file an agent writes rather than its returned summary, Codex's natural-language return costs nothing. The generic headless-subprocess spawn polyfill — for a future harness without native subagents, such as Pi — is deferred; its insertion point will be clear once the binding exists. The workflow runtime's structured, parallel spawns are a separate matter, handled by each harness's workflow runtime module rather than the orchestrator's native spawn (see the workflow runtime contract).
  **Alternatives**: Build the headless spawn polyfill now, to keep Pi in this PR.
  **Why**: Both built targets have native subagents, and the read-the-file result pattern makes them sufficient, so the polyfill would serve only Pi — which we drop to simplify. Deferring it costs nothing structural: spawn stays in the contract with one implementation for now, and the contract still admits the headless form later.
  **Origin**: User.

- **Decision**: Give harnesses that lack a capability a portable polyfill, and bind to the native capability where the harness has one.
  **Alternatives**: Always polyfill, for uniformity; or never polyfill, restricting the core to the lowest common capability.
  **Why**: A polyfill can drift from the real thing, so native is preferred where available; but the lowest common denominator would strip parallel builds and monitoring, which are core to speccy. Polyfill fills genuine gaps only. The gap can be large: Pi omits native subagents by design, so on it nearly the whole pipeline runs through the headless-subprocess polyfill — a mechanism every target provides.
  **Origin**: User.

- **Decision**: The workflow runtime is a per-harness JS module that presents the injected `agent`/`parallel`/`phase` API to `workflow.js`. Each module wraps the harness CLI (`codex exec`, etc.) and derives its return-shape guarantees by reading files, the harness's raw output, and git state — never by trusting the model's word, and never by relying on `codex exec --output-schema` stdout. Where a harness has no native worktree isolation, the module owns the worktree lifecycle with plain git: provision, recreate gitignored state via CLAUDE.md's `## Worktree init` apply step, tear down. Where a harness has native isolation (Claude Code's `Workflow` tool), the module defers to it. The injected API — including the `isolation: "worktree"` request — is the stable seam; the implementation is per-module.
  **Alternatives**: Rely on `codex exec --output-schema` stdout as the structured-return channel.
  **Why**: `--output-schema` is silently ignored when the agent uses tools (Codex issue #15451, https://github.com/openai/codex/issues/15451), and every schema-bearing agent in `workflow.js` uses tools (the breakdown, the git-status confirm, the merge). A guarantee the JS derives from files, raw output, and git state is one the module controls and validates, and it keeps worktree provisioning and parallel composition in tested code rather than an agent's judgement.
  **Origin**: User.

- **Decision**: Codex is a fixed second target, and portability to further harnesses is proven structurally rather than empirically.
  **Alternatives**: Run OpenAI models through a third-party harness such as OpenCode with an OpenAI provider; or design abstractly with no second harness.
  **Why**: OpenAI and Anthropic subscriptions are the cost-efficient way to buy enough tokens to run speccy, and Codex is OpenAI's bundled first-party harness, so it ships with the subscription and needs no third-party harness plus provider configuration — routing OpenAI through another harness is more setup, not less. A single real second harness also keeps the contract honest where an abstract design would rot.
  **Origin**: User.

## Assumptions

- However the core expresses actions, no vendor tool name reaches the agent's context: concrete tool names live only in the adapters and the binding, never in the shared core.
- No post-install script runs on the user's machine, so the harness identity is declared at a first-run precondition rather than configured beforehand. Because every target ships every binding, this does not depend on per-harness distribution: the precondition selects the right binding once and records it.
- The `agentskills.io` `SKILL.md` standard is compatible enough between the two harnesses that the core skill files load and trigger under Codex with only packaging and discovery-path changes.

## Open questions

- **The workflow-runtime module is a feasibility assumption; spike it before planning commits.** The crux is a per-harness JS module that presents the injected `agent`/`parallel`/`phase` API to `workflow.js` by wrapping `codex exec` and deriving return-shape guarantees from files, raw output, and git state, never from `--output-schema` stdout. Prove a minimal `workflow.js` runs green on Codex through such a module, using **tool-using** agents (every schema-bearing agent in the real pipeline uses tools), before the plan builds on it. The module must also provision and tear down git worktrees itself, since Codex has no native worktree isolation. The residual risk is the module's fidelity — worktree isolation under concurrent subprocesses, and a tool-using agent reliably producing a result the module can validate — not stdout schema availability. This spike is the heart of the Codex smoke test (see Completion criteria).
- **Does the shared `SKILL.md` actually load and trigger under Codex** with only packaging and path changes, or does the body need edits? Resolve by installing one core skill into Codex and invoking it.
- **What is the binding record and where is it kept?** A standalone manifest the first-run precondition reads, kept out of `state.json` so run state stays harness-neutral. Decide in planning against the no-runtime-branching constraint.
- **How is each target's install produced?** The preference is to ship the shared tree so every harness reads the same files in place (the bundle-everything decision makes this plausible), avoiding any transform that splits the installed artifact from its source. A build step that generates per-target trees is allowed but a last resort. Decide in planning per target's discovery rules.
- **The smoke test's exact steps.** Which capabilities to exercise, the minimal `workflow.js` to run, and how to assert each probe and the thin thread. Pin down in planning.
