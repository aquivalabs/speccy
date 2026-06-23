# Plan Execution Skill

Decomposes an approved plan into right-sized tasks and executes each in a fresh agent context window. Sequential tasks run directly on the main checkout; parallel tasks use git worktrees for isolation and are squash-merged back afterward. Two workflows handle the split: `workflow-simple.js` for small plans (one agent, no worktrees) and `workflow.js` for everything else.

## File layout

- **SKILL.md** — Instructions Claude reads when the skill is invoked. Covers input expectations, workflow selection, how to assemble args, and how to resume after failure.
- **prompts.md** — Prompt templates for each subagent role (breakdown, execute, integrate, verify, retrospective). The invoking Claude parses these by `## heading` and passes them as `args.prompts`. The workflow scripts append task-specific data at runtime.
- **workflow.js** — Multi-task orchestration. Breakdown always runs on Opus (it's the hardest-thinking phase); execution and later phases use whatever model the caller specifies.
- **workflow-simple.js** — Single-task variant. No worktrees, no breakdown, no integration. The verify agent fixes gaps directly in the working tree rather than defining corrective tasks for other agents — unlike the multi-task verify, which emits corrective task definitions that get executed and integrated through the normal pipeline.

