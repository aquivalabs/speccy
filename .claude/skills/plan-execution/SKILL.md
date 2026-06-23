---
name: plan-execution
description: Decompose an implementation plan into right-sized tasks and execute them. Each task gets a fresh context window. Handles breakdown, execution, integration, and completeness verification.
when_to_use: When another skill invokes it, or user has an approved plan and asks to "break this down", "execute this plan", "run this in parallel", or similar. NOT for unplanned work — point the user to planning mode first.
---

# Plan Execution

Break an approved plan into tasks sized for a single agent context window, then execute them as subagents. Sequential tasks run directly on the main checkout; parallel tasks use git worktrees for isolation and are squash-merged back afterward.

If the plan fits a single context window, still use this skill — it produces one task and executes directly.

## Prerequisites

### Verification tools

Check that CLAUDE.md documents the project's verification tools (build, lint, static analysis, test commands). Execute agents rely on these to validate their work. If they're missing, tell the user — establishing verification standards comes before running a plan.

### Worktree init

Worktree init is only needed when the plan has parallel tasks (which use git worktrees). If the plan is purely sequential, skip this section.

Worktrees must branch from the current HEAD so that parallel tasks see work committed by prior sequential tasks. Check `.claude/settings.json` for `"worktree": { "baseRef": "head" }`. If missing, add it (via Bash/python, since direct Edit on that file is blocked). The default (`fresh`) branches from `origin/<default-branch>`, which misses all feature-branch commits.

Check whether CLAUDE.md has a `## Worktree init` section. If it does, resolve the gather/apply variables before running the workflow:

1. Parse the **Gather** block — each line is `NAME` — `command`. Run each command via Bash in the main checkout and capture its stdout (trimmed).
2. Parse the **Apply** block — each line is a shell command that may reference `${NAME}` variables from the gather step. Substitute the gathered values into each command. Make symlink commands idempotent: replace `ln -s ` with `ln -snf ` so re-runs don't create circular symlinks inside the existing target.
3. Pass the resolved commands as the `worktreeInit` arg (string array) to the workflow.

If the section is missing and the plan has parallel tasks, tell the user. Worktree agents without init commands will lack gitignored state — this causes build failures, missing configs, and mid-task recovery friction. Offer to help draft the section before proceeding, the same way you would for missing verification tools.

## Input

The plan comes from one of:

1. A plan document passed from another skill
2. The current planning mode output
3. A spec/plan file the user points to

The plan describes what to build. Decomposition is this skill's job.

Before starting, check the plan names concrete deliverables. If it's vague or underspecified, ask the user to flesh it out rather than burning tokens on a breakdown that will miss the mark.

## Choosing a workflow

Two fixed workflows are bundled — do not modify them. Use **`workflow-simple.js`** when the plan touches ~5 or fewer files in one coherent change; use **`workflow.js`** (default) for anything larger.

## Running a workflow

Read `prompts.md` and pass its `## sections` as `args.prompts` keyed by heading name. Determine `baseBranch` from `git branch --show-current`. Generate a `runId` as a lowercase kebab-case slug from the plan name plus `YYYYMMDD-HHmm` timestamp (e.g. `auth-refactor-20260609-1430`).

Call the Workflow tool with the chosen workflow's `scriptPath` and these `args`:

- `planPath` — absolute or repo-relative path to the plan markdown file. **Prefer this** — the workflow embeds the path in subagent prompts and lets each agent read the file itself, keeping the orchestration tool call small.
- `plan` — full plan text. Use only when the plan isn't on disk (rare). Mutually exclusive with `planPath`; one must be set.
- `baseBranch` — current branch
- `runId` — from above
- `prompts` — the parsed prompts object
- `model` (optional) — when set, execution/integration/verify agents use that model and breakdown sizes tasks accordingly. Breakdown always uses Opus. When omitted, non-breakdown agents inherit the session model.
- `retrospective` (optional, default true) — when false, skips friction log synthesis
- `worktreeInit` (optional) — array of resolved shell commands to run at the start of every worktree agent (parallel tasks and corrective tasks only). Assembled from the gather/apply blocks in CLAUDE.md's `## Worktree init` section (see Prerequisites above). Pass the fully-substituted commands — no unresolved `${VAR}` references. Sequential tasks run on the main checkout and don't need this.

## After the workflow completes

Report to the user:

1. Summary — tasks completed, whether verification passed, any remaining gaps
2. Retrospective — if one was produced, present the cross-cutting patterns and suggestions
3. If incomplete — what failed and where to pick up (see "Resuming after failure")

Keep it concise. Don't dump raw JSON — synthesize.

## Resuming after failure

The breakdown agent writes each task to `.tasks/<run-id>/<task-id>.md`. These files are the durable record of the decomposition — without them, resuming means re-running breakdown and getting a different decomposition.

To resume a failed run:

1. Read the task files in `.tasks/<run-id>/`
2. Check `git log` on the base branch to identify which tasks were already integrated
3. Build a reduced plan containing only the remaining tasks
4. Run the workflow with that plan
