---
name: plan-execution
description: Decompose an implementation plan into right-sized tasks and execute them. Each task gets a fresh context window. Handles breakdown, execution, integration, and completeness verification.
when_to_use: When another skill invokes it, or user has an approved plan and asks to "break this down", "execute this plan", "run this in parallel", or similar. NOT for unplanned work; point the user to planning mode first.
---

# Plan Execution

Break an approved plan into tasks sized for a single agent context window, then execute them as subagents. Sequential tasks run directly on the main checkout; parallel tasks use git worktrees for isolation and are squash-merged back afterward.

If the plan fits a single context window, still use this skill: it produces one task and executes directly.

## Prerequisites

### Verification tools

Check that CLAUDE.md documents the project's verification tools (build, lint, static analysis, test commands). Execute agents rely on these to validate their work. If they're missing, tell the user: establishing verification standards comes before running a plan.

### Worktree init

Worktree init is only needed when the plan has parallel tasks (which use git worktrees). If the plan is purely sequential, skip this section.

Worktrees must branch from the current HEAD so that parallel tasks see work committed by prior sequential tasks. Check `.claude/settings.json` for `"worktree": { "baseRef": "head" }`. If missing, add it (via Bash/python, since direct Edit on that file is blocked). The default (`fresh`) branches from `origin/<default-branch>`, which misses all feature-branch commits.

Check whether CLAUDE.md has a `## Worktree init` section. If it does, resolve the gather/apply variables before running the workflow:

1. Parse the **Gather** block, where each line has the form `NAME` — `command`. Run each command via Bash in the main checkout and capture its stdout (trimmed).
2. Parse the **Apply** block, where each line is a shell command that may reference `${NAME}` variables from the gather step. Substitute the gathered values into each command. Make symlink commands idempotent: replace `ln -s ` with `ln -snf ` so re-runs don't create circular symlinks inside the existing target.
3. Pass the resolved commands as the `worktreeInit` arg (string array) to the workflow.

If the section is missing and the plan has parallel tasks, tell the user. Worktree agents without init commands will lack gitignored state, which causes build failures, missing configs, and mid-task recovery friction. Offer to help draft the section before proceeding, the same way you would for missing verification tools.

## Input

The plan comes from one of:

1. A plan document passed from another skill
2. The current planning mode output
3. A spec/plan file the user points to

The plan describes what to build. Decomposition is this skill's job.

Before starting, check the plan names concrete deliverables. If it's vague or underspecified, ask the user to flesh it out rather than burning tokens on a breakdown that will miss the mark.

## Choosing a workflow

Two fixed workflows are bundled; do not modify them. Use **`workflow-simple.js`** when the plan touches ~5 or fewer files in one coherent change; use **`workflow.js`** (default) for anything larger.

## Running a workflow

Read `prompts.md` and pass its `## sections` as `args.prompts` keyed by heading name. Determine `baseBranch` from `git branch --show-current`. Generate a `runId` as a lowercase kebab-case slug from the plan name plus `YYYYMMDD-HHmm` timestamp (e.g. `auth-refactor-20260609-1430`).

Call the Workflow tool with the chosen workflow's `scriptPath` and these `args`:

- `planPath`: absolute or repo-relative path to the plan markdown file. **Prefer this**: the workflow embeds the path in subagent prompts and lets each agent read the file itself, keeping the orchestration tool call small.
- `plan`: full plan text. Use only when the plan isn't on disk (rare). Mutually exclusive with `planPath`; one must be set.
- `baseBranch`: current branch
- `runId`: from above
- `prompts`: the parsed prompts object
- `model` (optional): when set, execution/integration/verify agents use that model and breakdown sizes tasks accordingly. Breakdown always uses Opus. When omitted, non-breakdown agents inherit the session model.
- `retrospective` (optional, default true): when false, skips friction log synthesis
- `worktreeInit` (optional): array of resolved shell commands to run at the start of every worktree agent (parallel tasks and corrective tasks only). Assembled from the gather/apply blocks in CLAUDE.md's `## Worktree init` section (see Prerequisites above). Pass the fully-substituted commands, with no unresolved `${VAR}` references. Sequential tasks run on the main checkout and don't need this.

## While the workflow runs: watchdog

The `Workflow` tool runs in the background and notifies you on completion. But a long run with sparse commits is indistinguishable from a hang, and a build that keeps spawning corrective tasks may be improvising rather than converging; the orchestrator needs a way to notice and intervene without watching every tick.

Right after launching the workflow, arm a `Monitor` as a watchdog (best-effort; if `Monitor` is unavailable, just proceed). The launch result gives you the `runId` and the **transcript dir**. The run's liveness signal is the newest `agent-*.jsonl` mtime in that dir: those per-agent transcripts are the actual heartbeat, ticking whenever any agent does work. (Don't use `journal.jsonl` mtime: the journal only records phase-boundary events, so it stays silent through a single long-running agent, e.g. the breakdown phase, and would read as a stall.) The Monitor polls every ~75s and stays **silent while healthy**, emitting a line only when a heuristic trips. Poll cheap git/file state: commits on the base branch since launch (progress), commit subjects starting with `CT-` (corrective tasks), and the newest transcript mtime (liveness). `stat`-ing a transcript for its mtime is safe: it reads metadata rather than contents.

Two tiers, deliberately asymmetric. They serve both a present user (who can correct on a warning) and an absent user (e.g. an overnight run, better served by a completed run than one killed out from under them):

- **Tier 1: warn, do NOT stop.** Two triggers, neither stops the run. Corrective-task escalation (**≥2** corrective tasks) fires **once** and may mean the build is struggling; emit it and send a `PushNotification` so an absent user is reached. The soft wall-clock cap is a **recurring health check-in**, firing every **~25 min** the run is still going. It is a periodic, visible beat rather than a sign of trouble: it shows the run is watched and progressing, which a human observer values, and it forces the orchestrator to do a real state check each time. A present user can judge and `TaskStop` manually; an absent user gets a finished run. (With the build's read-only and halt-on-impossibility rules, a genuinely stuck build halts itself, so this tier means "slow, many passes, or just long" rather than "redesigning around the spec.")
- **Tier 2: auto-stop.** Trips on a hard stall: **no new commit AND no transcript activity (newest `agent-*.jsonl` mtime) for >5 min**. Nothing is being accomplished, so stopping loses no progress whether the user is present or absent. Before stopping, confirm no tool is in flight (see below); then `TaskStop` the workflow, send a `PushNotification` (an auto-stopped overnight run is exactly when an absent user needs reaching), and report what it was last doing (last commit, journal tail) and where to resume.

When any line lands, confirm before acting: a slow `sf` deploy or test run is not a hang, and transcript mtime only ticks when a tool *returns*, so a single long-running tool call looks identical to a stall. Tail the newest `agent-*.jsonl`: if its last entry is a `tool_use` with no matching `tool_result`, a tool is still running and the build is working rather than stalled, so leave it alone. Emit each signal sparingly so the Monitor isn't auto-stopped for noise: the corrective-task warning fires once (a flag); the stall flag re-arms once activity resumes so a confirmed-benign stall doesn't blind the watchdog to a later real one; and the soft-cap health check-in recurs on its ~25-min interval (bump the threshold rather than flag it). The ~25-min interval keeps even a multi-hour run to a handful of beats, well under the noise-stop threshold. `TaskStop` the Monitor once the workflow's completion notification arrives so it doesn't linger.

The poll loop ships as `watchdog.sh` in this skill's own directory (alongside this SKILL.md). Give the `Monitor` this **one plain command**, with the script's **absolute path** and no `cd` prefix, no command substitution, and nothing chained onto it: a sandboxed session refuses a compound command, and the watchdog then never arms at all.

```bash
bash <skill-dir>/watchdog.sh <base-branch> <transcript-dir> [checkout]
```

`checkout` is the repository the script reads git state from, and defaults to the Monitor's working directory; pass it when that isn't the checkout the workflow commits to. The script prints nothing while the run is healthy, and emits the `STALL`, `WARN`, and `HEARTBEAT` lines on the thresholds described above.

## After the workflow completes

Report to the user:

1. Summary: tasks completed, whether verification passed, any remaining gaps
2. Retrospective: if one was produced, present the cross-cutting patterns and suggestions
3. If incomplete, distinguish two cases:
   - **Blocked on intent**: a task or the verify step reported a requirement that can't be met as specified (infeasible, self-contradictory, or only closable by changing the agreed design). The reason is usually in the friction logs of a halted task. Surface it and present it as a **decision for the user**: revise the spec or plan and re-run. Do not retry it as-is or improvise a workaround.
   - **Mechanical gap**: work simply didn't finish. Report what landed and where to pick up (see "Resuming after failure").

   Read `integrated` and `built_not_integrated` rather than re-deriving what happened. Every exit reports both, on any outcome. `integrated` names the tasks whose work is on the base branch: squash-merged for a parallel task, committed directly for a sequential one. A failing step no longer discards its successful siblings, so on an incomplete run this is usually non-empty. `built_not_integrated` names work that committed but whose merge failed, including corrective tasks, with the commit to recover it from.

Keep it concise. Synthesize rather than dumping raw JSON.

## Resuming after failure

The breakdown agent writes each task to `.tasks/<run-id>/<task-id>.md`. These files are the durable record of the decomposition: without them, resuming means re-running breakdown and getting a different decomposition.

To resume a failed run:

1. Read the task files in `.tasks/<run-id>/`
2. Check `git log` on the base branch to identify which tasks were already integrated
3. Build a reduced plan containing only the remaining tasks
4. Run the workflow with that plan
