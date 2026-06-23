// Plan Execution Workflow — Multi-task
//
// Breakdown → execute → integrate (parallel only) → completeness check →
// optional retrospective.
//
// Sequential tasks run directly on the main checkout — no worktrees, no
// cherry-picks, no squash merges. Only parallel tasks use worktree isolation.
//
// Prompt text comes from args.prompts (sourced from prompts.md).
// This file handles orchestration and data assembly only.

export const meta = {
  name: "plan-execution",
  description:
    "Decompose plan into tasks, execute with fresh contexts, integrate and verify",
  phases: [
    {
      title: "Breakdown",
      detail: "Decompose plan into an ordered list of steps"
    },
    { title: "Execute", detail: "Run each task" },
    {
      title: "Integrate",
      detail: "Squash-merge parallel task branches onto base"
    },
    {
      title: "Verify",
      detail: "Check completeness against plan and run tests"
    },
    {
      title: "Retrospective",
      detail: "Synthesize friction logs into actionable patterns"
    }
  ]
};

const parsedArgs = typeof args === "string" ? JSON.parse(args) : args;
const {
  plan,
  planPath,
  baseBranch,
  runId,
  model,
  prompts,
  retrospective: runRetrospective = true,
  worktreeInit = []
} = parsedArgs;
if (!plan && !planPath)
  throw new Error(
    "plan-execution requires either `planPath` or `plan` in args"
  );
const planRef = planPath
  ? `Read the plan from this file: \`${planPath}\``
  : plan;
const modelOpt = model ? { model } : {};

// Run a schema-bearing agent, tolerating a skipped StructuredOutput call.
// A fresh-context retry is far more likely to emit the structured result than
// the framework's in-conversation nudges. Returns null if both attempts fail.
async function withRetry(label, fn) {
  try {
    return await fn();
  } catch (e) {
    log(
      `${label}: no structured result (${String(e).slice(0, 100)}) — retrying once`
    );
    try {
      return await fn();
    } catch (e2) {
      log(`${label}: retry also failed to return structured output`);
      return null;
    }
  }
}

// ── Schemas ──────────────────────────────────────────────────────────

const STEP_SCHEMA = {
  type: "object",
  properties: {
    steps: {
      type: "array",
      description:
        "Ordered list of steps. Each step is either a single task or a parallel group.",
      items: {
        type: "object",
        properties: {
          parallel: {
            type: "boolean",
            description:
              "True only when tasks in this step are obviously independent and safe to run concurrently"
          },
          tasks: {
            type: "array",
            description:
              "One task for sequential steps, multiple for parallel groups",
            items: {
              type: "object",
              properties: {
                id: {
                  type: "string",
                  description: "Short unique id, e.g. task-1"
                },
                title: { type: "string" },
                description: {
                  type: "string",
                  description:
                    "Full self-contained instructions for a fresh agent"
                },
                files: {
                  type: "array",
                  items: { type: "string" },
                  description: "Files this task will read or modify"
                },
                acceptance_criteria: {
                  type: "array",
                  items: { type: "string" }
                },
                test_commands: {
                  type: "array",
                  items: { type: "string" },
                  description: "Shell commands to verify the task is done"
                }
              },
              required: [
                "id",
                "title",
                "description",
                "files",
                "acceptance_criteria"
              ]
            }
          }
        },
        required: ["parallel", "tasks"]
      }
    }
  },
  required: ["steps"]
};

// Execute agents do heavy work (write code, deploy, run tests). Forcing them to
// also emit a structured result is the most failure-prone step in a run — the
// agent finishes its work and stops without the final tool call. Instead each
// returns prose, and this lightweight agent confirms the outcome from git state.
const GIT_STATUS_SCHEMA = {
  type: "object",
  properties: {
    success: { type: "boolean" },
    branch: {
      type: "string",
      description: "Branch holding the work (worktree tasks only)"
    },
    commit: { type: "string", description: "Final commit hash" },
    summary: { type: "string" }
  },
  required: ["success", "summary"]
};

const MERGE_RESULT_SCHEMA = {
  type: "object",
  properties: {
    task_id: { type: "string" },
    success: { type: "boolean" },
    commit: {
      type: "string",
      description: "Squash-merge commit hash on base branch"
    },
    error: { type: "string" }
  },
  required: ["task_id", "success"]
};

const COMPLETENESS_SCHEMA = {
  type: "object",
  properties: {
    all_complete: { type: "boolean" },
    test_passed: { type: "boolean" },
    deliverables: {
      type: "array",
      items: {
        type: "object",
        properties: {
          description: { type: "string" },
          evidence: {
            type: "string",
            description: "File, function, or test that implements this"
          },
          status: { type: "string", enum: ["complete", "gap"] }
        },
        required: ["description", "status"]
      }
    },
    corrective_tasks: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          description: { type: "string" },
          files: { type: "array", items: { type: "string" } },
          acceptance_criteria: { type: "array", items: { type: "string" } }
        },
        required: ["id", "title", "description", "files", "acceptance_criteria"]
      }
    }
  },
  required: ["all_complete", "test_passed", "deliverables"]
};

// ── Prompt assembly ─────────────────────────────────────────────────

function worktreeInitSection() {
  if (worktreeInit.length === 0) return "";
  return `

## Worktree setup

Your worktree is missing gitignored files the toolchain needs. Run these commands first, before any other work. Stop and report if any command fails.

${worktreeInit.map((c) => "- `" + c + "`").join("\n")}`;
}

function execPrompt(task, { useWorktree = false } = {}) {
  const testing =
    (task.test_commands || []).length > 0
      ? task.test_commands.map((c) => "- `" + c + "`").join("\n")
      : "No task-specific test commands. Follow the verification steps above.";
  const initSection = useWorktree ? worktreeInitSection() : "";
  const priorSection =
    completedWork.length > 0
      ? `\n\n## Prior completed tasks\nThese tasks already ran. The code they describe is already committed — read the files to see their actual state rather than relying on your task description alone.\n${completedWork.map((w) => `- **${w.task_id}** ${w.title}: ${w.summary}`).join("\n")}`
      : "";
  return `${prompts.execute}${initSection}${priorSection}

## Task: ${task.title}

${task.description}

## Files
${task.files.join("\n")}

## Acceptance criteria
${task.acceptance_criteria.map((c) => "- " + c).join("\n")}

## Testing
${testing}

## Reporting
Commit all your changes. Prefix the commit message with \`${task.id}: \` so your work can be located afterwards. You do NOT need to return a structured result — a short prose report is enough, including a friction log (harder_than_expected, wrong_turns, suggestions).`;
}

function mergePrompt(task, result) {
  return `${prompts.integrate}

## Task: ${task.title} (${task.id})
## Task branch: ${result.branch}
## Base branch: ${baseBranch}`;
}

// Confirm a task's outcome from git rather than trusting a self-reported flag.
// Minimal-work agents reliably emit structured output, so the schema lives here.
async function confirmFromGit(task, { useWorktree = false } = {}) {
  const where = useWorktree
    ? `The agent ran in an isolated git worktree on its own branch. Use \`git worktree list\` and \`git branch --sort=-committerdate\` to locate the branch holding this task's work — its commits are prefixed \`${task.id}: \`. Report that branch name.`
    : `The agent ran on the main checkout (the current branch).`;
  return withRetry(`confirm:${task.id}`, () =>
    agent(
      `A prior agent executed task "${task.title}" (${task.id}). Determine from git whether its work landed — do NOT do the task's work yourself.
${where}

Steps:
1. Inspect \`git log\`/\`git status\`${useWorktree ? " and `git worktree list`" : ""}.
2. Decide success: the task's changes are committed and present.
3. Report the final commit hash${useWorktree ? " and the branch name" : ""}.`,
      {
        label: `confirm:${task.id}`,
        phase: "Execute",
        ...modelOpt,
        schema: GIT_STATUS_SCHEMA
      }
    )
  );
}

// Execute (prose, no forced schema) then confirm the outcome from git state.
async function runExecute(task, { useWorktree = false } = {}) {
  const execReport = await agent(execPrompt(task, { useWorktree }), {
    label: `exec:${task.id}`,
    phase: "Execute",
    ...(useWorktree ? { isolation: "worktree" } : {}),
    ...modelOpt
  });
  const status = await confirmFromGit(task, { useWorktree });
  return {
    task_id: task.id,
    success: !!status?.success,
    branch: status?.branch,
    commit: status?.commit,
    summary: status?.summary || "",
    friction_text: execReport || null,
    error: status?.success
      ? undefined
      : status?.summary || "no committed work found"
  };
}

async function integrateTask(task, result) {
  return withRetry(`merge:${task.id}`, () =>
    agent(mergePrompt(task, result), {
      label: `merge:${task.id}`,
      phase: "Integrate",
      ...modelOpt,
      schema: MERGE_RESULT_SCHEMA
    })
  );
}

// ── Phase 1: Breakdown ───────────────────────────────────────────────

phase("Breakdown");

const breakdownPrompt = `${prompts.breakdown}

## Run ID

${runId}
${model ? `\n## Task sizing\n\nSubagents will use the model "${model}". Size tasks accordingly — smaller or less capable models need narrower, more explicit tasks with less ambiguity. Larger models can handle broader tasks with more judgment calls.` : ""}

## Plan

${planRef}`;

// Breakdown is the hardest-thinking phase — always use Opus regardless of the execution model
const breakdown = await withRetry("breakdown", () =>
  agent(breakdownPrompt, {
    label: "decompose",
    model: "opus",
    schema: STEP_SCHEMA
  })
);

if (!breakdown?.steps?.length) {
  log("Breakdown produced no steps — stopping");
  return { tasks_total: 0, complete: false, error: "breakdown failed" };
}

const steps = breakdown.steps;
const taskCount = steps.reduce((n, s) => n + s.tasks.length, 0);
log(`${taskCount} tasks across ${steps.length} steps`);

// ── Phase 2 & 3: Execute and Integrate ───────────────────────────────

const allFriction = [];
const completedWork = [];
const worktreeBranches = [];

for (let si = 0; si < steps.length; si++) {
  const step = steps[si];
  const tasks = step.tasks;

  if (step.parallel && tasks.length > 1) {
    // ── Parallel: worktree isolation + squash-merge integration ──
    log(`Step ${si + 1}: ${tasks.length} tasks in parallel`);

    phase("Execute");
    const results = await parallel(
      tasks.map((task) => () => runExecute(task, { useWorktree: true }))
    );

    const failed = [];
    const succeeded = [];
    for (let i = 0; i < tasks.length; i++) {
      const r = results[i];
      const t = tasks[i];
      if (r?.friction_text)
        allFriction.push({
          task_id: t.id,
          title: t.title,
          friction: r.friction_text
        });
      if (r?.success) {
        succeeded.push({ task: t, result: r });
        if (r.branch) worktreeBranches.push(r.branch);
      } else {
        failed.push({ task: t, error: r?.error || "agent returned null" });
      }
    }

    if (failed.length > 0) {
      for (const f of failed) log(`${f.task.id} failed: ${f.error}`);
      const salvageable = succeeded.filter((s) => s.result.branch);
      for (const s of salvageable)
        log(`${s.task.id} succeeded — work on branch ${s.result.branch}`);
      return {
        tasks_total: taskCount,
        complete: false,
        error: `${failed.map((f) => f.task.id).join(", ")} failed`,
        salvageable_branches: salvageable.map((s) => ({
          task_id: s.task.id,
          branch: s.result.branch
        })),
        friction_logs: allFriction
      };
    }

    phase("Integrate");
    for (const { task: t, result: r } of succeeded) {
      log(`Integrating ${t.id}: ${t.title}`);
      const merge = await integrateTask(t, r);
      if (!merge?.success) {
        log(
          `Integration failed for ${t.id}: ${merge?.error || "unknown"} — stopping`
        );
        return {
          tasks_total: taskCount,
          complete: false,
          error: `${t.id} integration failed`,
          friction_logs: allFriction
        };
      }
      completedWork.push({
        task_id: t.id,
        title: t.title,
        summary: r.summary || ""
      });
    }
  } else {
    // ── Sequential: run directly on the main checkout ──
    for (const task of tasks) {
      log(`Step ${si + 1}: ${task.title}`);

      phase("Execute");
      const r = await runExecute(task);
      if (r?.friction_text)
        allFriction.push({
          task_id: task.id,
          title: task.title,
          friction: r.friction_text
        });
      if (!r?.success) {
        log(
          `${task.id} failed: ${r?.error || "agent returned null"} — stopping`
        );
        return {
          tasks_total: taskCount,
          complete: false,
          error: `${task.id} failed`,
          friction_logs: allFriction
        };
      }
      completedWork.push({
        task_id: task.id,
        title: task.title,
        summary: r.summary || ""
      });
    }
  }
}

// ── Phase 4: Completeness check ──────────────────────────────────────

phase("Verify");
let iteration = 0;
let complete = false;

while (!complete && iteration < 3) {
  iteration++;
  log(`Completeness check ${iteration}/3`);

  const check = await withRetry(`verify:${iteration}`, () =>
    agent(`${prompts.verify}\n\n## Original plan\n${planRef}`, {
      label: `verify:${iteration}`,
      phase: "Verify",
      ...modelOpt,
      schema: COMPLETENESS_SCHEMA
    })
  );

  if (!check) {
    log("Completeness check inconclusive — stopping");
    break;
  }

  if (check.all_complete && check.test_passed) {
    complete = true;
    log("All deliverables verified, tests passing");
    break;
  }

  const gaps = (check.deliverables || []).filter((d) => d.status === "gap");
  const fixes = check.corrective_tasks || [];

  if (gaps.length === 0 && check.test_passed) {
    complete = true;
    log("All deliverables verified, tests passing");
    break;
  }

  log(`${gaps.length} gaps found — running ${fixes.length} corrective tasks`);

  for (const fix of fixes) {
    phase("Execute");
    const r = await runExecute(fix, { useWorktree: true });

    if (r?.branch) worktreeBranches.push(r.branch);
    if (r?.success && r.branch) {
      phase("Integrate");
      const merge = await integrateTask(fix, r);
      if (!merge?.success) {
        log(
          `Corrective integration failed for ${fix.id}: ${merge?.error || "unknown"}`
        );
      }
    }

    if (r?.friction_text) {
      allFriction.push({
        task_id: fix.id,
        title: fix.title,
        friction: r.friction_text
      });
    }
  }
}

if (!complete) log("Completeness cap reached — partial progress on branch");

// ── Phase 5: Retrospective ───────────────────────────────────────────

let retro = null;
if (runRetrospective && allFriction.length > 0) {
  phase("Retrospective");
  retro = await agent(
    `${prompts.retrospective}\n\n## Friction logs\n${JSON.stringify(allFriction, null, 2)}`,
    {
      label: "retrospective",
      phase: "Retrospective",
      ...(model ? { model } : {})
    }
  );
}

// ── Cleanup: remove worktrees ────────────────────────────────────────

if (worktreeBranches.length > 0) {
  log(`Cleaning up ${worktreeBranches.length} worktrees`);
  const branchList = worktreeBranches.map((b) => "- `" + b + "`").join("\n");
  await agent(
    `Remove the git worktrees for these branches:\n${branchList}\n\nSteps:
1. Run \`git worktree list\` to find the paths for these branches.
2. For each matching worktree, run \`git worktree unlock <path>\` (may fail if not locked — that's fine) then \`git worktree remove --force <path>\`.
3. Run \`git worktree prune\`.
4. If \`.claude/worktrees/\` is now empty, remove it.
Only remove worktrees matching the branches listed above — leave any others alone.`,
    { label: "cleanup-worktrees" }
  );
}

// ── Result ───────────────────────────────────────────────────────────

return {
  tasks_total: taskCount,
  completeness_iterations: iteration,
  complete,
  friction_logs: allFriction,
  retrospective: retro
};
