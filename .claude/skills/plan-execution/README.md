# Plan Execution Skill

Decomposes an approved plan into right-sized tasks and executes each in a fresh agent context window. Sequential tasks run directly on the main checkout; parallel tasks use git worktrees for isolation and are squash-merged back afterward. Two workflows handle the split: `workflow-simple.js` for small plans (one agent, no worktrees) and `workflow.js` for everything else.

## File layout

- **SKILL.md** — Instructions Claude reads when the skill is invoked. Covers input expectations, workflow selection, how to assemble args, and how to resume after failure.
- **prompts.md** — Prompt templates for each subagent role (breakdown, execute, integrate, verify, retrospective). The invoking Claude parses these by `## heading` and passes them as `args.prompts`. The workflow scripts append task-specific data at runtime.
- **workflow.js** — Multi-task orchestration. Breakdown always runs on Opus (it's the hardest-thinking phase); execution and later phases use whatever model the caller specifies.
- **workflow-simple.js** — Single-task variant. No worktrees, no breakdown, no integration. The verify agent fixes gaps directly in the working tree rather than defining corrective tasks for other agents — unlike the multi-task verify, which emits corrective task definitions that get executed and integrated through the normal pipeline.

## Why this exists (relative to Claude Code's built-ins)

This skill is a thin, opinionated composition on top of the `Workflow` tool — not a replacement for it. It exists because Claude Code ships the *primitives* for multi-agent work but leaves the *build pipeline* to the project.

What the platform provides, and this skill consumes rather than reinvents:

- **The `Workflow` tool** — the JavaScript orchestration engine (`agent()`, `parallel()`, `pipeline()`) this skill's `workflow.js` is written against.
- **Worktree isolation** — `isolation: 'worktree'` gives each parallel agent its own checkout; the platform auto-cleans it only if unchanged.
- **In-session resume** — `Workflow`'s `resumeFromRunId` caches completed agents, but only within a single session.

What the platform does *not* provide, and this skill adds — the reason it earns its place:

- **Integration.** A changed worktree is never merged back automatically; the orchestration script must do it. `workflow.js` owns the squash-merge-per-task with conflict handling and branch teardown.
- **Completeness verification.** There is no built-in loop that checks every plan deliverable has evidence and spawns corrective tasks until it does. The `verify` phase is that loop.
- **Durable, cross-session resume.** `Workflow` resume is same-session only; the `.tasks/<run-id>/` files make the decomposition survive a context clear or crash.

Note on **ultracode**: it is a *mode/disposition* (raised reasoning effort plus a standing directive to orchestrate with `Workflow` proactively), not a packaged pipeline. It changes *when* Claude fans out, not *what machinery wraps the agents*, so it does not supply the integration or verification layers above. This skill remains the deterministic, always-same-shape harness for an approved plan.

(Accurate as of mid-2026; if Claude Code later ships a turnkey integrate+verify pipeline, revisit whether this skill is still needed.)

