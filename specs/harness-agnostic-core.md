# Specification: Harness-agnostic speccy core

**Status**: Accepted

## Goal

speccy is welded to Claude Code. Its two skills (`speccy`, `plan-execution`) call Claude-Code-only mechanisms (the `Agent` tool, the `Workflow` tool, `Monitor`, model aliases like `opus`, `/clear`, `shift+tab`) throughout their instructions and orchestration code. This spec restructures speccy into one shared semantic core plus a thin per-harness binding layer, so the same core can drive a full run on OpenAI Codex as well as Claude Code, and a third harness later needs only a new binding.

Two decisions shape everything below:

- **The core resolves its harness once, at the start of each orchestrator conversation, and its phases never branch on the host**, keeping harness knowledge at one bounded seam instead of scattered through every instruction.
- **The whole semantic core is shared across harnesses rather than forked per harness**, so a change to speccy's behaviour is made in one place, without the copies drifting apart.

## Deliverables

- **A harness capability contract, covering only what exceeds the baseline** (see Scope boundaries for the baseline tool set). The contract names the capabilities beyond it: spawn-subagent, run-parallel, monitor/watchdog, and model-ladder resolution (S/M/L/XL → a concrete model). Spawn-subagent has two bindings. The orchestrator-native binding backs Claude's `Agent` tool and Codex's native subagents; it takes a prompt and a model-ladder rung and returns prose, with no result schema, since speccy reads the file the spawned agent writes rather than its returned summary. Orchestrator-level fan-out (several critics or review lenses spawned at once) is just multiple calls to this binding, not a separate capability. The workflow-module binding backs the injected `agent` in the workflow runtime (see the workflow runtime contract); it takes a prompt and a model-ladder rung and returns a result derived from files and git, with an optional schema and optional worktree isolation. Run-parallel names the workflow module's `parallel()`, which fans out parallel build tasks; it has no orchestrator-level counterpart. The binding also settles packaging concerns when it resolves, rather than through runtime tool calls: invocation entrypoint, permission/approval configuration, and instruction-file (`AGENTS.md` or `CLAUDE.md`) location.

- **The shared semantic core**, carrying no harness-specific tool names, user-facing commands (e.g. `/clear`, `shift+tab`), invocation syntax, or model aliases: `SKILL.md` and `phases/*.md` for both skills, `prompts/*.md`, the spec and plan templates, `state.mjs`, and `plan-execution`'s orchestration script (`workflow.js`, `workflow-simple.js`).

- **A workflow runtime contract.** One `workflow.js` runs on every harness against an injected runtime (`agent`, `parallel`, `phase`, `log`, `args`, plus schema-validated results and worktree isolation); model rungs resolve to concrete names through `args`. Each harness implements the runtime as a per-harness JS module that presents that injected API: Claude Code's native `Workflow` tool is one implementation; the Codex module is another, wrapping `codex exec` and deriving its return-shape guarantees from files, the harness's raw output, and git state, never from the model's own report. The Codex module tracks each `codex exec` subprocess's state and its output files' mtimes as it drives them; this is the liveness signal the Codex monitor polls, since Codex writes no `agent-*.jsonl` transcripts for a monitor to tail. Where a harness has no native worktree isolation, its module owns the worktree lifecycle with plain git: provision it, recreate gitignored state via the instruction file's `## Worktree init` section (a convention of gather/apply command blocks that recreate a worktree's gitignored state; the `AGENTS.md`/`CLAUDE.md` deliverable below settles which file this is), and tear it down. Where a harness has native isolation, as Claude Code's `Workflow` tool does, the module defers to it.

- **The Claude Code binding**: a native adapter that maps each contract capability to the tool speccy uses today, plus the plugin packaging (`plugin.json`, `marketplace.json`, `.claude/skills` discovery).

- **The Codex binding**: an adapter that maps the S/M/L/XL ladder to Codex models, generates permission/sandbox configuration, and provides two polyfills where Codex has no native equivalent: the workflow runtime module over `codex exec`, and a monitor/watchdog polling that module's liveness signal (see the workflow runtime contract for both).

- **Compatibility with the `AGENTS.md` convention** for the project instructions speccy relies on: the binding points each harness at whichever instruction file that harness actually loads — `AGENTS.md` where the harness supports it and no `CLAUDE.md` shadows it, `CLAUDE.md` on Claude Code where one exists.

- **Working installs for each target** (Claude Code and Codex) from one plugin. Codex installs the Claude Code plugin as-is (it reads `.claude-plugin/marketplace.json` and `plugin.json`), so both harnesses read the same tree and there is no per-harness packaging or build step. Each `SKILL.md` carries its trigger phrases in `description`, the one discovery field both harnesses read; Codex drops `when_to_use`.

- **A conversation-start identity-and-binding step.** At the start of each orchestrator conversation it resolves the harness identity, loads that harness's adapter defaults (capability→mechanism map, model-rung→model map, instruction-file name) into the resolved binding, and validates it. Every phase in that conversation reads the binding rather than re-deriving it; a fresh conversation (after a context clear, or on a different harness) re-resolves it. Identity comes from the agent's own knowledge of its host where the harness makes that known, with a one-time user declaration as the universal fallback. The resolved binding lives for the conversation and is not written to a file; only the per-harness adapter defaults are versioned files in the tree.

## Scope boundaries

- No new harness beyond Codex is built. The contract is designed to admit OpenCode, Pi, and others; none is implemented or verified here.
- Reviewers judge the contract's admission of a third harness by reading the contract's shape; no completion criterion tests it, since verifying extensibility would require building a third adapter.
- A harness that provides no spawn capability (neither native subagents nor a headless subprocess mode) is out of scope. Supporting one would be a later change.
- This PR targets Claude Code and Codex, both of which have native subagents. Pi (native subagents absent, headless mode present) is dropped from this PR along with the headless-spawn polyfill it would need; the contract must still admit it later.
- speccy's pipeline semantics do not change. Phases, gates, critique loops, and review lenses behave as they do today; this restructures speccy without redesigning it.
- Claude Code behaviour and output are preserved. The core is neutralised, but a Claude Code run produces what it does now.
- No general plugin framework. The binding layer covers what speccy's two skills need, nothing more.
- Metrics reporting (`metrics.mjs`, `metrics.sh`) is out of scope for now. It is neither neutralised nor ported; its tests stay in CI.
- A full end-to-end speccy run on Codex for a real feature is not a PR gate: it is optional manual validation. The semantics are shared and proven on Claude, so the binding smoke test alone gates this PR.
- The baseline tool set (read, write, and edit files; run shell commands; the agent's own inference) is assumed present on every harness and excluded from the port. It is expressed at intent level with no binding; only capabilities beyond the baseline are in scope.

## Constraints

- **One source of truth for semantics.** A semantic change is authored once in the core; duplication is confined to the binding layer and minimised there.
- **No per-phase harness branching.** The core's phases never inspect or name the host; they read a resolution they do not re-derive. The host is named once, at a single conversation-start step, and nowhere else; that one bounded resolution is not the scattered per-phase branching this rules out.
- **No vendor leakage in the core.** Adding a harness needs a new adapter and its binding; it may adjust the thin seam the core calls the abstraction through, but never the pipeline's semantics, and never with per-harness branching. The contract's shape enforces this structurally, independent of coding style.
- **Harness facts are verified against current documentation, never memory.** Both harnesses move; Codex's subagent, model, and skill surfaces changed in 2026 and its docs warn of more. The contract must not hard-code a volatile specific where a role or capability name will do.
- **Disk footprint is free; agent context is scarce.** Every target may ship every adapter and polyfill, used or not; the agent loads only the resolved binding and is never presented a tool-choice.
- **The existing verification survives.** `node --test "skills/speccy/test/*.test.mjs"` keeps passing, and the CI `status-check` job keeps its name (branch protection depends on it).

## Completion criteria

- [ ] On Codex, the skill loads and triggers.
- [ ] On Codex, the binding resolves at conversation start.
- [ ] On Codex, a spawned subagent writes a file that speccy reads.
- [ ] On Codex, a minimal `workflow.js` fans out parallel tool-using tasks (each task reads or writes a file and runs a shell command) through the Codex workflow runtime module; the test asserts the result the module returns and that worktree isolation held.
- [ ] On Codex, a smoke-workflow task that carries gitignored state runs in a worktree with that state recreated from the resolved instruction file's `## Worktree init` section, exercising both the worktree-init apply step and the selection of the correct instruction file (`AGENTS.md` or `CLAUDE.md`).
- [ ] On Codex, the monitor is armed and polling its liveness signal.
- [ ] On Codex, the model ladder resolves to concrete models.
- [ ] A thin orchestrator thread runs on Codex: skill load → one delegated subagent round-tripped through its file → `state.mjs` advances a phase, without the full critique/build/review loops.
- [ ] The same smoke test and thin thread pass on Claude Code, and its behaviour is unchanged from today.
- [ ] The same single `workflow.js` runs on both harnesses through their runtime implementations, not a per-harness fork.
- [ ] The shared core contains no Claude- or Codex-specific tool name, user-facing command (e.g. `/clear`, `shift+tab`), invocation syntax, or model alias, checked by grep against a denylist; the denylist excludes `metrics.mjs` and `metrics.sh` (out of scope, ships in the tree, and carries Claude-specific tokens by design). Concrete names live only in the adapters and the binding.
- [ ] Under the build-step install, if one is used, the semantic files (both skills' `SKILL.md` and `phases/`, `prompts/`, the templates, and `workflow.js`) are identical between the Claude Code and Codex installs; any difference is an adapter or the binding. Under the preferred ship-the-tree install the two installs share the same files by construction, so this criterion is moot there and the grep-denylist criterion is what checks neutrality.
- [ ] `node --test "skills/speccy/test/*.test.mjs"` passes.

## Decisions & rationale

- **Decision**: Resolve the harness once at the start of each orchestrator conversation and read that resolution in every phase; the phases never branch on the host.
  **Alternatives**: A runtime shim the phases query for "which harness am I in?" and switch on, per phase.
  **Why**: Per-phase branching scatters harness knowledge through every instruction and grows with each new target; resolving once at the conversation boundary and reading the resolution keeps the phases host-blind and confines harness knowledge to one bounded seam.
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
  **Why**: Harnesses that support `AGENTS.md` read it, but Claude Code reads it only as a fallback: any `CLAUDE.md` at or above the working directory suppresses it (Claude Code memory docs, https://code.claude.com/docs/en/memory; support added v2.1.277). A speccy user whose project already has a `CLAUDE.md` would have `AGENTS.md` silently ignored on Claude Code, so the single-file win holds only where no `CLAUDE.md` shadows `AGENTS.md`; where one does, `CLAUDE.md` is the file that reaches the agent. Claude Code can also be configured to load both files together, which would dissolve the shadowing; this decision assumes Claude Code's default configuration, where the file choice is binary.
  **Origin**: User.

- **Decision**: Ship every adapter and polyfill to every target; the conversation-start step selects which binding the agent loads.
  **Alternatives**: Ship only the target's adapter, via per-harness packaging.
  **Why**: Disk footprint is free; the scarce resource is the agent's context and attention. Bundling everything removes the need for per-harness packaging to carry the binding, so the design no longer rests on a distribution model unverified beyond Claude Code and Codex. Only the resolved binding enters context.
  **Origin**: User.

- **Decision**: Resolve the harness identity once per orchestrator conversation, at its start, and hold it for that conversation; no phase re-derives it, and it is not written to a file. The primary source is the agent's own knowledge of its host, which Claude Code and Codex both make known to the running agent; a one-time user declaration is the universal fallback. This single bounded step is the one place the running agent names its host.
  **Alternatives**: A shell script probing the environment to detect the harness (unreliable: the signals are ambiguous and OpenCode ships none); or a resolved-binding file persisted per checkout and read on every run.
  **Why**: The harness is a property of the running conversation, not the checkout, so its natural lifetime is the conversation; resolving per conversation always matches the actual host and removes the stale-file hazard of a checkout driven from a second harness. The agent's self-knowledge is reliable where a shell script's env-probe is not. Naming the host at one bounded step, and reading the result everywhere else, keeps every phase host-blind.
  **Origin**: User.

- **Decision**: Assume a baseline tool set on every harness — read, write, and edit files; run shell; the agent's own inference — and exclude it from the contract and the port. Only capabilities beyond the baseline get a binding.
  **Alternatives**: Bind every action, baseline included, for total explicitness.
  **Why**: Every target verified has the baseline (spike), so binding it adds machinery for capabilities that never vary. Shrinking the contract to the beyond-baseline few — structured spawn, parallel, monitor, model rungs — is what keeps the abstraction small.
  **Origin**: User.

- **Decision**: Express the baseline at intent level; bind the beyond-baseline capabilities explicitly.
  **Alternatives**: One uniform approach for everything — all intent-level, or all mapped.
  **Why**: Intent-level is vendor-neutral and free for the actions every harness has; the beyond-baseline capabilities are exactly where intent underspecifies (structured spawn, parallel, monitor), so they need an explicit, deterministic binding. Neither approach fits both halves. User-facing commands speccy issues (Claude Code's `/clear`, `shift+tab`, `/effort`) are baseline interaction, expressed at intent level ("clear the context and re-invoke").
  **Origin**: User.

- **Decision**: Spawn is a required capability of any target, met by a native subagent or a headless subprocess. This PR implements the native form only: orchestrator-level spawns use Claude's `Agent` tool and Codex's native subagents, and since speccy reads the file an agent writes rather than its returned summary, Codex's natural-language return costs nothing. The generic headless-subprocess spawn polyfill (for a future harness without native subagents, such as Pi) is deferred; its insertion point will be clear once the binding exists. The workflow runtime's structured, parallel spawns are a separate matter, handled by each harness's workflow runtime module rather than the orchestrator's native spawn (see the workflow runtime contract).
  **Alternatives**: Build the headless spawn polyfill now, to keep Pi in this PR.
  **Why**: Both built targets have native subagents, and the read-the-file result pattern makes them sufficient, so the polyfill would serve only Pi — which we drop to simplify. Deferring it costs nothing structural: spawn stays in the contract with one implementation for now, and the contract still admits the headless form later.
  **Origin**: User.

- **Decision**: Give harnesses that lack a capability a portable polyfill, and bind to the native capability where the harness has one.
  **Alternatives**: Always polyfill, for uniformity; or never polyfill, restricting the core to the lowest common capability.
  **Why**: A polyfill can drift from the real thing, so native is preferred where available; but the lowest common denominator would strip parallel builds and monitoring, which are core to speccy. Polyfill fills genuine gaps only. The gap can be large: Pi omits native subagents by design, so on it nearly the whole pipeline runs through the headless-subprocess polyfill (a mechanism every target provides).
  **Origin**: User.

- **Decision**: Derive the workflow runtime's return-shape guarantees from files, raw output, and git state, never from `codex exec --output-schema` stdout or the model's word. (See the workflow runtime contract deliverable for the mechanism.)
  **Alternatives**: Rely on `codex exec --output-schema` stdout as the structured-return channel.
  **Why**: `--output-schema` emits malformed, non-JSON output when tools or MCP servers are active (Codex issue #15451, https://github.com/openai/codex/issues/15451), and every schema-bearing agent in `workflow.js` uses tools (the breakdown, the git-status confirm, the merge). A guarantee the JS derives from files, raw output, and git state is one the module controls and validates, and it keeps worktree provisioning and parallel composition in tested code rather than an agent's judgement.
  **Origin**: User.

- **Decision**: Codex is a fixed second target, and portability to further harnesses is proven structurally rather than empirically.
  **Alternatives**: Run OpenAI models through a third-party harness such as OpenCode with an OpenAI provider; or design abstractly with no second harness.
  **Why**: OpenAI and Anthropic subscriptions are the cost-efficient way to buy enough tokens to run speccy, and Codex is OpenAI's bundled first-party harness, so it ships with the subscription and needs no third-party harness plus provider configuration; routing OpenAI through another harness adds setup rather than saving it. A single real second harness also keeps the contract honest where an abstract design would rot.
  **Origin**: User.

## Assumptions

- speccy ships no post-install step of its own, so the harness is resolved at the start of each orchestrator conversation rather than configured ahead of time.

## Open questions

- **The workflow-runtime module is a feasibility assumption; spike it before planning commits.** Prove a minimal `workflow.js` runs green on Codex through the workflow runtime module (see the workflow runtime contract deliverable), using **tool-using** agents, since every schema-bearing agent in the real pipeline uses tools. The residual risk is the module's fidelity: worktree isolation under concurrent subprocesses, and a tool-using agent reliably producing a result the module can validate. Stdout schema availability is not at issue; that failure mode is already established (see Decisions & rationale). This spike is the heart of the Codex smoke test (see Completion criteria).
- **Does the shared `SKILL.md` actually load and trigger under Codex** with only packaging and path changes, or does the body need edits? Resolve by installing one core skill into Codex and invoking it.
- **The smoke test's exact steps.** Which capabilities to exercise, the minimal `workflow.js` to run, and how to assert each probe and the thin thread. Pin down in planning.
