# The harness capability contract

speccy's semantic core names capabilities, never the tools that provide them. This contract is the list of capabilities the core relies on beyond the baseline, and the settlements a harness makes when speccy resolves it at the start of a conversation. Each harness ships an adapter-defaults file (`adapters/<harness>.mjs`) that maps every capability here to a concrete mechanism. The resolver (`skills/speccy/binding.mjs`) reads one adapter and holds the result in memory for the conversation.

A new harness is a new adapter file that satisfies this contract. The core, the phases, `state.mjs`, and `workflow.js` do not change. That is the property this contract exists to hold: harness knowledge lives in adapters, and the core is blind to it.

## The baseline needs no binding

Every harness is assumed to read, write, and edit files, run shell commands, and run the agent's own inference. speccy expresses these at intent level and the adapter never sees them. User-facing commands the agent issues to its own host, such as clearing context or enabling auto-accept, are baseline interaction too: the core states the intent ("clear the context and re-invoke") and the agent acts on it. Only the capabilities below exceed the baseline, and only they get a binding.

## Beyond-baseline capabilities

Each adapter names a mechanism for every key below.

### spawn-subagent

Two bindings, because speccy spawns from two places with different return shapes.

- **orchestrator-native** — the orchestrator, running in the harness conversation, spawns a subagent from a prompt and a model-ladder rung. It returns prose; there is no result schema, because speccy reads the file the spawned agent writes, not its returned summary. This backs every critic, the planner, revise agents, review lenses, and fixers. Orchestrator fan-out (several critics or lenses at once) is just several calls to this binding, not a separate capability.
- **workflow-module** — the `agent()` injected into the workflow runtime. It takes a prompt and a rung and returns a result derived from files and git, with an optional schema and optional worktree isolation. It is owned by the runtime module, not the orchestrator.

A harness with no native subagent may later satisfy spawn-subagent with a headless-subprocess mechanism. This contract admits that form; no adapter here implements it.

### run-parallel

The workflow module's `parallel()`, which fans out parallel build tasks under a concurrency cap. It has no orchestrator-level counterpart; orchestrator fan-out is repeated spawn-subagent calls.

### run-workflow

How the orchestrator launches a workflow script (`workflow.js`, `workflow-simple.js`) with its args, and how it learns the run finished and reads what it returned. A harness with a native workflow tool names that tool. A harness without one names a command that runs the script through its workflow module, and says where the result lands if no completion notification follows.

### code-review (optional)

The harness's own general code reviewer, run against the branch diff, reporting only. speccy runs it as one lens of the implementation review. A harness with no standard reviewer omits the key, and the review phase drops that lens.

### monitor

The watchdog that polls a liveness signal to tell a working run from a stalled one. Its signal is harness-specific: a transcript's mtime, or a heartbeat file the workflow module writes.

### model-ladder resolution

The fixed rungs S, M, L, XL, each resolved to a concrete model the harness's runtime accepts. An adapter stores no model version: a rung names either a version-free alias the harness resolves itself (Claude Code's `opus`), or a version-free model family plus a `modelResolution` rule that turns the family into the newest available model when the conversation starts. The core names rungs; the resolved rung→model map reaches `workflow.js` through its `args` and the orchestrator through the binding. This is the only capability whose mechanism is data (the map) rather than a named tool, so an adapter carries it as its own field rather than in the mechanism map.

## Resolution-time settlements

These are fixed when the binding resolves, not through runtime tool calls. Each adapter carries them.

- **invocation entrypoint** — how the harness starts a run of speccy's core.
- **permission / approval configuration** — the sandbox and approval posture a spawned agent runs under.
- **effort check** (optional) — how to read the session's reasoning effort and which levels count as above `high`, for speccy's precondition that warns against a run at an expensive effort.
- **worktree root** — where the harness's workflow runtime creates worktrees, relative to the repo root, so the workflow's cleanup can remove the directory once it is empty.
- **instruction-file name** — the project instruction file this harness loads (`CLAUDE.md`, `AGENTS.md`, or another), which speccy points subagents and worktree-init at.

## What the resolver guarantees

The resolver produces a complete binding or fails loud. A missing mechanism, an unresolved rung, an absent instruction-file name, or an unknown harness stops the conversation with a `speccy binding:` message rather than letting a half-resolved binding reach a phase. The binding is held in memory for the conversation and written to no file; only the adapter-defaults are files.
