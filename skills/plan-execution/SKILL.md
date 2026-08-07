---
name: plan-execution
description: Decompose an implementation plan into right-sized tasks and execute them. Each task gets a fresh context window. Handles breakdown, execution, integration, and completeness verification.
when_to_use: When another skill invokes it, or user has an approved plan and asks to "break this down", "execute this plan", "run this in parallel", or similar. NOT for unplanned work — point the user to planning mode first.
---

# Plan Execution

Break an approved plan into tasks sized for a single agent context window, then execute them as subagents. Sequential tasks run directly on the main checkout. Parallel tasks use git worktrees for isolation and are squash-merged back.

If the plan fits a single context window, still use this skill — it produces one task and executes directly.

## Prerequisites

### Verification tools

Check that CLAUDE.md documents the project's verification tools: build, lint, static analysis, test commands. Execute agents rely on them to validate their work. If they're missing, tell the user — verification standards come before running a plan.

### Worktree init

Needed only when the plan has parallel tasks, which use git worktrees. A purely sequential plan skips this section.

Worktrees must branch from the current HEAD, so parallel tasks see work committed by prior sequential tasks. Check `.claude/settings.json` for `"worktree": { "baseRef": "head" }`. If missing, add it — via Bash/python, since direct Edit on that file is blocked. The default `fresh` branches from `origin/<default-branch>`, which misses all feature-branch commits.

Check whether CLAUDE.md has a `## Worktree init` section. If it does, resolve the gather/apply variables before running the workflow:

1. Parse the **Gather** block — each line is `NAME` — `command`. Run each command via Bash in the main checkout and capture its stdout, trimmed.
2. Parse the **Apply** block — each line is a shell command that may reference `${NAME}` variables from the gather step. Substitute the gathered values. Make symlink commands idempotent: replace `ln -s ` with `ln -snf `, so re-runs don't create circular symlinks inside the existing target.
3. Pass the resolved commands as the `worktreeInit` arg (string array) to the workflow.

If the section is missing and the plan has parallel tasks, tell the user. Worktree agents without init commands lack gitignored state — build failures, missing configs, mid-task recovery friction. Offer to help draft the section before proceeding, as you would for missing verification tools.

## Input

The plan comes from one of:

1. A plan document passed from another skill
2. The current planning mode output
3. A spec or plan file the user points to

The plan describes what to build. Decomposition is this skill's job.

Before starting, check the plan names concrete deliverables. If it's vague, ask the user to flesh it out rather than burning tokens on a breakdown that will miss the mark.

## Choosing a workflow

Two fixed workflows are bundled — do not modify them. Use **`workflow-simple.js`** when the plan touches ~5 or fewer files in one coherent change. Use **`workflow.js`** (default) for anything larger.

## Running a workflow

Read `prompts.md` and pass its `## sections` as `args.prompts`, keyed by heading name. Determine `baseBranch` from `git branch --show-current`. Generate a `runId`: a lowercase kebab-case slug from the plan name plus a `YYYYMMDD-HHmm` timestamp, e.g. `auth-refactor-20260609-1430`.

Call the Workflow tool with the chosen workflow's `scriptPath` and these `args`:

- `planPath` — absolute or repo-relative path to the plan markdown file. **Prefer this** — the workflow embeds the path in subagent prompts and each agent reads the file itself, keeping the orchestration call small.
- `plan` — full plan text. Only when the plan isn't on disk (rare). Mutually exclusive with `planPath`; one must be set.
- `baseBranch` — current branch
- `runId` — from above
- `prompts` — the parsed prompts object. When the caller supplied a deviations path, append it to `prompts.retrospective` here.
- `model` (optional) — when set, execute/integrate/verify agents use it, and breakdown sizes tasks accordingly. Breakdown always uses opus. When omitted, non-breakdown agents inherit the session model.
- `retrospective` (optional, default true) — when false, skips friction-log synthesis. When a deviations path is supplied, keep the retrospective enabled — the deviations pass-through depends on it. With no deviations path, the flag behaves as before.
- `worktreeInit` (optional) — array of resolved shell commands run at the start of every worktree agent (parallel and corrective tasks only). Assembled from the gather/apply blocks in CLAUDE.md's `## Worktree init` section (see Prerequisites). Pass fully-substituted commands — no unresolved `${VAR}` references. Sequential tasks run on the main checkout and don't need this.

Assembly boundary: append the deviations path to `prompts.retrospective` here, not in the caller. This is the one place the orchestrator builds the prompts, and an instruction anchored a skill away gets dropped at the skill boundary. No supplied path means nothing is appended — the retrospective agent then writes no `deviations.md` and produces only a friction synthesis.

## While the workflow runs: watchdog

The `Workflow` tool runs in the background and notifies you on completion. But a long run with sparse commits is indistinguishable from a hang, and a build that keeps spawning corrective tasks may be improvising rather than converging. The orchestrator needs a way to notice and intervene without watching every tick.

Right after launching the workflow, arm a `Monitor` as a watchdog — best-effort; if `Monitor` is unavailable, proceed. The launch result gives the `runId` and the **transcript dir**. The run's liveness signal is the newest `agent-*.jsonl` mtime in that dir — the per-agent transcripts are the actual heartbeat, ticking whenever any agent does work. Don't use `journal.jsonl` mtime: it records only phase-boundary events, so it stays silent through a single long-running agent — the breakdown phase, say — and would read as a stall. The Monitor polls every ~75s and stays **silent while healthy**, emitting a line only when a heuristic trips. Poll cheap git and file state: commits on the base branch since launch (progress), commit subjects starting with `CT-` (corrective tasks), and the newest transcript mtime (liveness). `stat`-ing a transcript for its mtime is safe — metadata, not contents.

Two tiers, deliberately asymmetric. They serve both a present user, who can correct on a warning, and an absent user — an overnight run — who is better served by a completed run than one killed out from under them:

- **Tier 1 — warn, do NOT stop.** Two triggers; neither stops the run. Corrective-task escalation (**≥2** corrective tasks) fires **once** and may mean the build is struggling; emit it and send a `PushNotification` so an absent user is reached. The soft wall-clock cap is a **recurring health check-in**, firing every **~25 min** the run is still going. It is not a sign of trouble — it is a periodic, visible beat that the run is watched and progressing, which a human observer values and which forces the orchestrator to do a real state check each time. A present user can judge and `TaskStop` manually; an absent user gets a finished run. With the build's read-only and halt-on-impossibility rules, a genuinely stuck build halts itself — so this tier means "slow, many passes, or just long", not "redesigning around the spec".
- **Tier 2 — auto-stop.** Trips on a hard stall: **no new commit AND no transcript activity (newest `agent-*.jsonl` mtime) for >5 min**. Nothing is being accomplished, so stopping loses no progress whether the user is present or absent. Before stopping, confirm no tool is in flight (below) — then `TaskStop` the workflow, send a `PushNotification` (an auto-stopped overnight run is exactly when an absent user needs reaching), and report what it was last doing — last commit, journal tail — and where to resume.

When any line lands, confirm before acting. A slow deploy or test run is not a hang, and transcript mtime ticks only when a tool *returns* — a single long-running tool call looks identical to a stall. Tail the newest `agent-*.jsonl`: if its last entry is a `tool_use` with no matching `tool_result`, a tool is still running — the build is working, leave it alone. Emit each signal sparingly so the Monitor isn't auto-stopped for noise: the corrective-task warning fires once (a flag); the stall flag re-arms once activity resumes, so a confirmed-benign stall doesn't blind the watchdog to a later real one; the soft-cap check-in recurs on its ~25-min interval — bump the threshold rather than flag it. The ~25-min interval keeps even a multi-hour run to a handful of beats, well under the noise-stop threshold. `TaskStop` the Monitor once the workflow's completion notification arrives, so it doesn't linger.

Sketch of the poll loop (adapt paths; `stat -f %m` is macOS, use `-c %Y` on Linux):

```bash
BASE=<base-branch>; TDIR=<transcript-dir>
START=$(git rev-parse HEAD); START_TS=$(date +%s); w_ct=0; cap=1500; w_stall=0   # cap = next soft-cap beat threshold (s)
while true; do
  now=$(date +%s); el=$(( now - START_TS ))
  ct=$(git log "$START"..HEAD --format='%s' 2>/dev/null | grep -cE '^CT-')
  lc=$(git log -1 --format=%ct 2>/dev/null || echo 0)
  tm=$(stat -f %m "$TDIR"/agent-*.jsonl 2>/dev/null | sort -rn | head -1 || echo 0)  # newest transcript mtime
  idle=$(( now - (lc > tm ? lc : tm) ))
  if [ "$idle" -le 300 ]; then w_stall=0; fi   # re-arm once it's moving again
  if [ "$idle" -gt 300 ] && [ "$w_stall" -eq 0 ]; then echo "STALL: idle $((idle/60))m (elapsed $((el/60))m, $ct corrective)"; w_stall=1; fi
  if [ "$ct" -ge 2 ] && [ "$w_ct" -eq 0 ]; then echo "WARN: $ct corrective tasks — may be struggling (elapsed $((el/60))m)"; w_ct=1; fi
  if [ "$el" -gt "$cap" ]; then echo "HEARTBEAT: elapsed $((el/60))m, still running ($ct corrective) — health check-in"; cap=$(( cap + 1500 )); fi   # recurring ~25m beat
  sleep 75
done
```

## After the workflow completes

The result is recovery-grade: it names each task's state directly rather than leaving the caller to infer it from prose. Report to the user:

1. Summary — `tasks_total` and `complete`, plus anything the `failed`, `blocked` and `built_not_integrated` lists carry.
2. Retrospective — if one was produced, present the cross-cutting patterns and suggestions.
3. If `complete` is false, read the lists rather than re-deriving what happened:
   - A **`failed`** entry carries the stage, the reason, and the agent's verbatim text. Use that to tell apart the two cases the old two-outcome result used to blur: an infeasible or self-contradictory requirement is a **decision for the user** — revise the spec or plan and re-run, don't retry it as-is or improvise a workaround — while work that simply didn't finish is a **mechanical gap** — report what landed and where to pick up (see "Resuming after failure").
   - A **`blocked`** entry names the task that stopped it (`blocked_by`); no work was attempted on it.
   - **`built_not_integrated`** lists work that landed at a commit but never merged, with its `ref` (`refs/task/<run-id>/<task-id>`) — the durable pointer to recover it from.
   - **`base_never_fully_verified`**, when present, names which failed or blocked task carried the run-wide gate. Surface it plainly: it means the base branch itself was never confirmed at the promised standard.
4. `ledger_path` (`.tasks/<run-id>/ledger.jsonl`) is the append-only per-task record underlying all of the above — point the user at it for anything the summary doesn't cover.

Keep it concise. Don't dump raw JSON — synthesize.

## Resuming after failure

The breakdown agent writes each task to `.tasks/<run-id>/<task-id>.md`. These files are the durable record of the decomposition — without them, resuming means re-running breakdown and getting a different decomposition.

Two more records survive the run itself, and both outlast a stop or a crash: the append-only `.tasks/<run-id>/ledger.jsonl` (one line per verification, integration, block, and closing event), and one `refs/task/<run-id>/<task-id>` git ref per task the confirm agent verified, pointing at that task's verified commit whether or not the work ever reached a branch or the base. `git log` on the base branch alone only shows what was integrated — it misses anything the result lists as `built_not_integrated`.

To resume a failed or stopped run:

1. Read the task files in `.tasks/<run-id>/`
2. Read `.tasks/<run-id>/ledger.jsonl` for each task's last recorded state, and `git for-each-ref refs/task/<run-id>/` for a verified commit that never made it into the base branch
3. Check `git log` on the base branch to identify which tasks were already integrated
4. Build a reduced plan containing only the remaining tasks — anything the ledger and refs show as verified-but-unintegrated is recoverable from its ref rather than re-executed
5. Run the workflow with that plan

This reduced-plan re-run is also the **amend-and-resume** path after a plan-premise deviation: revise the plan, then re-run with the remaining tasks. Re-running the workflow re-runs breakdown, so the remaining work may re-decompose into different tasks. That is acceptable.
