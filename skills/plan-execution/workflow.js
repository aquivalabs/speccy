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
    commit: {
      type: "string",
      description:
        "The task's commit, as the full hash git printed, never an abbreviation. Required when `success` is true — it is what gets integrated"
    },
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

const CLEANUP_RESULT_SCHEMA = {
  type: "object",
  properties: {
    removed_worktrees: { type: "array", items: { type: "string" } },
    deleted_branches: { type: "array", items: { type: "string" } },
    skipped_branches: {
      type: "array",
      items: { type: "string" },
      description:
        "Branches left intact — unmerged, or still checked out in a worktree"
    },
    errors: {
      type: "array",
      items: { type: "string" },
      description:
        "Teardown failures, e.g. a branch delete refused because its worktree was still live"
    }
  },
  required: ["errors"]
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

// Built from the confirmed commit. A branch name cannot identify a task's work in a
// parallel step: every sibling's branch is equally recent, so any rule that picks one
// by date can pick a sibling's.
function mergePrompt(task, result) {
  const branch = result.branch
    ? `\`${result.branch}\` — context only. Squash-merge the commit above, not this name.`
    : "(none reported)";
  return `${prompts.integrate}

## Task: ${task.title} (${task.id})

## Verified commit
\`${result.commit}\`

## Task branch
${branch}

## Base branch: ${baseBranch}`;
}

// Confirm a task's outcome from git rather than trusting a self-reported flag.
// Minimal-work agents reliably emit structured output, so the schema lives here.
async function confirmFromGit(task, { useWorktree = false, execReport = null } = {}) {
  const where = useWorktree
    ? `The agent ran in an isolated git worktree on its own branch, and you are standing in the main checkout — so its commit is not reachable from \`HEAD\`. Search \`--branches\`, not a range against \`HEAD\`. Report the branch name you saw as context.`
    : `The agent ran on the main checkout (the current branch), so it has no branch of its own.`;
  const report =
    execReport === null || execReport === undefined || String(execReport).trim() === ""
      ? "(empty — the execute agent returned no report)"
      : String(execReport);
  return withRetry(`confirm:${task.id}`, () =>
    agent(
      `A prior agent executed task "${task.title}" (${task.id}). Determine from git whether its work landed — do NOT do the task's work yourself.
${where}

Steps:
1. Take the commit hash the execute agent reported below, if it gave one.
2. Verify it: \`git log -1 --format=%s <hash>\` must print a subject starting with \`${task.id}: \`. This is what catches a task that committed nothing and reported a sibling's or the branch's existing tip as its own.
3. If there is no reported hash, or it fails step 2, search for the task's own commit: \`git log ${useWorktree ? `--branches --not ${baseBranch}` : "HEAD"} --format='%H %s' --grep "^${task.id}: "\`, then discard every candidate whose subject does not start with \`${task.id}: \` (\`--grep\` matches the message body too). Take the newest survivor.${useWorktree ? `\n\n   \`--not ${baseBranch}\` matters: integration squashes each task onto \`${baseBranch}\` under the subject \`<task-id>: <title>\`, so an id that has been integrated before (a re-run, or a corrective task reusing an earlier id) has a commit on \`${baseBranch}\` that passes step 2 while saying nothing about whether this attempt committed anything. Only an unmerged commit answers that.` : ""}
4. Report success only with a commit that passed step 2, and report its hash exactly as git printed it, in full — it is what gets integrated, so an abbreviation or a guess is worse than a failure. Report no success without one.${useWorktree ? "\n5. Report the branch name as context. Identity is the hash." : ""}

## Execute agent's report
Forwarded verbatim.

${report}`,
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
  const status = await confirmFromGit(task, { useWorktree, execReport });
  // A success with no full hash is refused rather than believed. Integration is by
  // commit, so a success the workflow cannot name a commit for has nothing to merge,
  // and carrying it forward as success is how a task whose work never landed reports
  // as done.
  const reported = typeof status?.commit === "string" ? status.commit.trim() : "";
  // 40 or 64 hex: a repository created with `--object-format=sha256` names commits at
  // 64. Testing only for 40 would refuse every success in one.
  const commit = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(reported) ? reported : null;
  const success = !!status?.success && commit !== null;
  const refused = !!status?.success && commit === null;
  if (refused) {
    log(
      `${task.id}: confirm reported success with no full commit hash (commit: ${reported || "absent"}) — treated as failed`
    );
  }
  return {
    task_id: task.id,
    success,
    branch: status?.branch,
    commit,
    summary: status?.summary || "",
    friction_text: execReport || null,
    error: success
      ? undefined
      : refused
        ? "confirm reported success with no full commit hash"
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
// Work that committed but whose merge failed, for the whole run. Every exit reports it
// alongside `integrated`, so a caller reads what landed from one place on any outcome.
const builtNotIntegrated = [];
const worktreeBranches = []; // every worktree branch ever provisioned (success or fail)
const mergedBranches = new Set(); // branches whose squash-merge landed on base — safe to delete

// Branch + worktree teardown is owned here, not in the integrate prompt: git refuses to
// delete a branch still checked out in a live worktree, so the worktree must go first.
// Only squash-merged branches are deleted (with `-D` — a squash merge leaves no ancestry
// for `-d` to recognise); unmerged branches survive for recovery. Idempotent so it can run
// on every exit path — success, early-return failure, or end of run.
let worktreesCleaned = false;
async function cleanupWorktrees() {
  if (worktreesCleaned) return;
  worktreesCleaned = true;
  const trees = [...new Set(worktreeBranches)];
  if (trees.length === 0) return;
  log(`Cleaning up ${trees.length} worktree(s)`);
  const treeList = trees.map((b) => "- `" + b + "`").join("\n");
  const merged = trees.filter((b) => mergedBranches.has(b));
  const deleteList = merged.length
    ? merged.map((b) => "- `" + b + "`").join("\n")
    : "(none — do not delete any branch)";
  const result = await agent(
    `Tear down git worktrees and integrated branches. Touch ONLY the branches listed below; leave any others alone.

## Worktrees to remove (by branch)
${treeList}

Steps:
1. Run \`git worktree prune\` to clear stale entries left by crashed runs.
2. Run \`git worktree list\`. For each branch above that still has a worktree, check it is clean first: \`git -C <path> status --porcelain\`. If that prints nothing, run \`git worktree unlock <path>\` (ignore a "not locked" error) then \`git worktree remove <path>\`. If it prints anything, leave the worktree exactly where it is and record it under \`skipped_branches\` with its dirty-file count.

   **Never \`git worktree remove --force\`.** It destroys the tree's uncommitted content — the directory goes, and an unstaged or untracked file is then in no commit and no object. A dirty worktree is the shape most likely to hold work that never landed, so a tree you cannot remove cleanly is a tree you leave.
3. Run \`git worktree prune\` again.
4. Delete ONLY these already-integrated branches, and only after their worktree is gone. Use \`git branch -D <branch>\` (a squash merge leaves no ancestry, so \`-d\` would wrongly refuse):
${deleteList}
   If \`git branch -D\` reports a branch is still checked out in a worktree, the removal in step 2 did not take effect — record it under \`errors\` and move on; do not retry blindly.
5. Leave every branch NOT in the delete list intact — it may hold unmerged work needed for recovery. Record those under \`skipped_branches\`.
6. If \`.claude/worktrees/\` is now empty, remove it.`,
    { label: "cleanup-worktrees", schema: CLEANUP_RESULT_SCHEMA }
  );
  for (const e of result?.errors || []) log(`cleanup-worktrees: ${e}`);
}

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
      // Record the branch whether or not the task succeeded, so a failed sibling's
      // worktree is still swept (the harness provisions the worktree before the agent runs).
      if (r?.branch) worktreeBranches.push(r.branch);
      if (r?.success) {
        succeeded.push({ task: t, result: r });
      } else {
        failed.push({ task: t, error: r?.error || "agent returned null" });
      }
    }

    for (const f of failed) log(`${f.task.id} failed: ${f.error}`);

    // Integrate what succeeded before deciding whether to stop. The tasks in a
    // parallel step are independent by construction — that is what put them in one
    // step — so a sibling's failure says nothing about work that already passed its
    // own gate. Returning ahead of this loop stranded that work on its branch and
    // handed the caller a manual recovery job.
    phase("Integrate");
    const notIntegrated = [];
    for (const { task: t, result: r } of succeeded) {
      log(`Integrating ${t.id}: ${t.title}`);
      const merge = await integrateTask(t, r);
      if (!merge?.success) {
        // The remaining integrations still run, for the same independence reason.
        log(
          `Integration failed for ${t.id}: ${merge?.error || "unknown"} — the rest of this step still integrates`
        );
        notIntegrated.push({
          task_id: t.id,
          commit: r.commit,
          branch: r.branch,
          error: merge?.error || "unknown"
        });
        continue;
      }
      if (r.branch) mergedBranches.add(r.branch); // squash-merge landed — safe to delete at cleanup
      completedWork.push({
        task_id: t.id,
        title: t.title,
        summary: r.summary || ""
      });
    }

    builtNotIntegrated.push(...notIntegrated);

    // Only now stop. Later steps are ordered after this one by breakdown, so they may
    // depend on what did not land; this step's own work is already integrated.
    if (failed.length > 0 || notIntegrated.length > 0) {
      await cleanupWorktrees();
      return {
        tasks_total: taskCount,
        complete: false,
        error: [
          failed.length ? `${failed.map((f) => f.task.id).join(", ")} failed` : null,
          notIntegrated.length
            ? `${notIntegrated.map((n) => n.task_id).join(", ")} did not integrate`
            : null
        ]
          .filter(Boolean)
          .join("; "),
        integrated: completedWork.map((w) => w.task_id),
        built_not_integrated: builtNotIntegrated,
        friction_logs: allFriction
      };
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
        await cleanupWorktrees(); // a prior parallel step may have left worktrees
        return {
          tasks_total: taskCount,
          complete: false,
          error: `${task.id} failed`,
          // A sequential task commits straight onto the base branch, so everything
          // completed so far is already integrated by definition.
          integrated: completedWork.map((w) => w.task_id),
          built_not_integrated: builtNotIntegrated,
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
    // Gated on success alone, not on a reported branch: integration merges the commit,
    // which success guarantees, and the branch is context a confirm agent may omit.
    if (r?.success) {
      phase("Integrate");
      const merge = await integrateTask(fix, r);
      if (!merge?.success) {
        log(
          `Corrective integration failed for ${fix.id}: ${merge?.error || "unknown"}`
        );
        builtNotIntegrated.push({
          task_id: fix.id,
          commit: r.commit,
          branch: r.branch,
          error: merge?.error || "unknown"
        });
      } else if (r.branch) {
        mergedBranches.add(r.branch); // corrective squash-merge landed — safe to delete at cleanup
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

// ── Cleanup: remove worktrees, delete integrated branches ────────────
// Owned here (not in the integrate prompt). Idempotent and already called on every
// early-return failure path above, so a failed run never leaks trees into the next one.

await cleanupWorktrees();

// ── Result ───────────────────────────────────────────────────────────

return {
  tasks_total: taskCount,
  completeness_iterations: iteration,
  complete,
  integrated: completedWork.map((w) => w.task_id),
  built_not_integrated: builtNotIntegrated,
  friction_logs: allFriction,
  retrospective: retro
};
