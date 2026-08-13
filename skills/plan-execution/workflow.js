// Plan Execution Workflow — Multi-task
//
// Breakdown → execute → integrate (parallel only) → completeness check →
// optional retrospective → teardown. Teardown runs on every exit path, worktrees
// or none: it writes the run's closing ledger lines as well as removing trees.
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
    },
    {
      title: "Teardown",
      detail: "Write the closing ledger lines, remove clean worktrees, delete landed branches"
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

// ── Preconditions ────────────────────────────────────────────────────
// One guard, two reasons, both "refuse to run on a value the script cannot
// derive". The prompt sections are checked here, before any agent runs; the
// run-start baseline is checked after breakdown, because breakdown is what
// captures it. Either way the run aborts naming the absent path.
//
// Prompt text is the caller's to supply, so a stale prompts object would
// otherwise interpolate `undefined` into an agent prompt and the run would look
// healthy while an agent read a hole.

// Only the sections this script interpolates today. A section listed here
// before prompts.md carries it aborts every run, so the list grows with the
// sections it guards.
const REQUIRED_PROMPT_SECTIONS = [
  "breakdown",
  "execute",
  "confirm",
  "integrate",
  "verify",
  "retrospective",
  "teardown"
];

// The run-start baseline the breakdown agent captures. `dirty_at_start` is
// required but may be empty — an empty value is the ordinary case and means a
// clean checkout at run start — so presence is what the guard tests, not
// truthiness.
const REQUIRED_BASELINE_VALUES = [
  "base_sha",
  "started_at",
  "started_at_epoch",
  "dirty_at_start"
];
const BASELINE_MAY_BE_EMPTY = ["dirty_at_start"];

function missingPaths(source, keys, prefix, mayBeEmpty = []) {
  return keys
    .filter((key) => {
      const value = source?.[key];
      if (value === undefined || value === null) return true;
      if (mayBeEmpty.includes(key)) return false;
      return typeof value === "string" && value.trim() === "";
    })
    .map((key) => `${prefix}.${key}`);
}

function abortRun(reason, tasksTotal = 0) {
  log(`${reason} — stopping`);
  return { tasks_total: tasksTotal, complete: false, error: reason };
}

const missingSections = missingPaths(
  prompts,
  REQUIRED_PROMPT_SECTIONS,
  "prompts"
);
if (missingSections.length > 0) {
  return abortRun(`missing prompt section(s): ${missingSections.join(", ")}`);
}

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

// Carries the run-start baseline as well as the steps, so it is named for the
// whole breakdown result rather than for the step list alone.
const BREAKDOWN_SCHEMA = {
  type: "object",
  properties: {
    baseline: {
      type: "object",
      description:
        "The run-start baseline, captured once in the main checkout after the `.gitignore` ensure and the task-file writes",
      properties: {
        base_sha: {
          type: "string",
          description: "Base branch tip, from `git rev-parse <base-branch>`"
        },
        started_at: {
          type: "string",
          description:
            "Run start as an ISO-8601 UTC string, from `date -u +%FT%TZ`"
        },
        started_at_epoch: {
          type: "string",
          description:
            "The same instant as epoch seconds, from `date -u +%s`, reported as a string"
        },
        dirty_at_start: {
          type: "string",
          description:
            "`git status --porcelain` output in the main checkout at run start, verbatim. An empty value is valid and means a clean start"
        }
      },
      required: [
        "base_sha",
        "started_at",
        "started_at_epoch",
        "dirty_at_start"
      ]
    },
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
                },
                depends_on: {
                  type: "array",
                  items: { type: "string" },
                  description:
                    "Ids of the tasks whose committed output this task needs. Empty when it needs none. An id naming no task in this breakdown is ignored"
                },
                verification_level: {
                  type: "string",
                  description:
                    "Either `scoped` or `checkpoint`. Deliberately optional and un-enumerated: an absent or unrecognised value runs the full gate suite, so a forgotten marking over-verifies the task instead of ending the run"
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
  required: ["steps", "baseline"]
};

// Execute agents do heavy work (write code, deploy, run tests). Forcing them to
// also emit a structured result is the most failure-prone step in a run — the
// agent finishes its work and stops without the final tool call. Instead each
// returns prose, and this lightweight agent confirms the outcome from git state.
//
// It reports a state, not a boolean. A boolean can express neither the verified
// no-op nor the shape that stranded the incident's task — success claimed with no
// commit — and replacing the field rather than adding beside it leaves no two
// fields that can disagree. The state is described rather than enumerated, so an
// unrecognised value is read as a failure by the script instead of failing schema
// validation and sending the agent through `withRetry` for a value it already
// gave.
const GIT_STATUS_SCHEMA = {
  type: "object",
  properties: {
    state: {
      type: "string",
      description:
        "`verified` (a commit passed all four conditions, and the anchored gate line where one was required), `verified-no-op` (the gate passed with nothing left to repair and nothing to commit), or `failed`"
    },
    commit: {
      type: "string",
      description:
        "The verified commit hash, at the full forty characters. Absent for `verified-no-op`"
    },
    branch: {
      type: "string",
      description: "Branch holding the work (worktree tasks only)"
    },
    rung: {
      type: "string",
      description:
        "Which rung produced the evidence: `reported-hash`, `subject-search`, or `none`"
    },
    ref_moved: {
      type: "boolean",
      description:
        "Whether you moved the task's ref onto the verified commit with the compare-and-swap form"
    },
    summary: { type: "string" }
  },
  required: ["state", "summary"]
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

// Per-entry records, not name lists. Four string arrays could say what teardown
// touched but never why, and "why" is the whole of the safety argument: a branch
// kept because its content did not land reads identically to one kept because
// nothing tied it to this run, and only the reason tells a human which tree still
// holds work. Every entry teardown saw appears here, acted on or not.
const CLEANUP_RESULT_SCHEMA = {
  type: "object",
  properties: {
    worktrees: {
      type: "array",
      description:
        "Every worktree `git worktree list` reported, removed or kept",
      items: {
        type: "object",
        properties: {
          path: { type: "string" },
          branch: { type: "string" },
          removed: { type: "boolean" },
          dirty_files: {
            type: "integer",
            description:
              "How many lines `git status --porcelain` printed inside it. 0 for a clean tree"
          },
          reason: { type: "string" }
        },
        required: ["path", "removed", "reason"]
      }
    },
    branches: {
      type: "array",
      description:
        "Every branch you tied to this run, deleted or kept, with the reason that decided it",
      items: {
        type: "object",
        properties: {
          branch: { type: "string" },
          task_id: {
            type: "string",
            description: "The task you tied this branch to"
          },
          deleted: { type: "boolean" },
          compared_against: {
            type: "string",
            description:
              "The commit the landed-content check measured against: the recorded squash commit, or the base tip named as a fallback"
          },
          cherry: {
            type: "string",
            description:
              "`git cherry` output, recorded as advisory context. It decides nothing"
          },
          reason: { type: "string" }
        },
        required: ["branch", "deleted", "reason"]
      }
    },
    untied: {
      type: "array",
      description:
        "Worktrees and `worktree-*` branches you listed but could not tie to this run. Listed, never removed",
      items: {
        type: "object",
        properties: {
          entry: {
            type: "string",
            description: "The branch name or the worktree path"
          },
          reason: { type: "string" }
        },
        required: ["entry", "reason"]
      }
    },
    errors: {
      type: "array",
      items: { type: "string" },
      description:
        "Teardown failures, e.g. a branch delete refused because its worktree was still live"
    }
  },
  required: ["worktrees", "branches", "untied", "errors"]
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

// ── Rules ────────────────────────────────────────────────────────────
// The verification level is read three ways, and each reading is its own named
// predicate over the raw field. Nothing normalises the value onto the task or
// onto a task record: a stored resolution is exactly the handle a later reader
// takes for the wrong reading, and one reading leaking into another rule is the
// defect this shape exists to prevent. Each predicate is a total function of
// one argument — no list, no index — and every use site calls the one it names.

// The exact-match reading. The step classifier reads this and nothing else: the
// depth reading below would move every task of an un-marked plan onto the main
// checkout, and a positional reading would demote the last step for no stated
// reason.
function isMarkedCheckpoint(task) {
  return task?.verification_level === "checkpoint";
}

// The depth reading: which gate the task runs, and which anchored lines are
// asked of it. Marked `checkpoint` runs the full gate suite, and so does an
// absent or unrecognised value — that default is what keeps an un-marked plan
// over-verified rather than under-verified. Only `scoped` opts out, so the
// complement of `scoped` is the whole rule.
function runsFullGate(task) {
  return task?.verification_level !== "scoped";
}

// The run-wide blocking reading: a marked checkpoint, plus the run's final
// task, whose marking breakdown may have forgotten. Without the second arm an
// un-marked final checkpoint that fails propagates as an ordinary failed task
// and the result never states that the base went unverified. It reads the
// run-wide constant `finalTaskId`, resolved once from the breakdown result
// below, and never a task list.
function blocksRunWide(task) {
  return isMarkedCheckpoint(task) || (!!task?.id && task.id === finalTaskId);
}

// ── The step classifier ──────────────────────────────────────────────
// A task runs in a worktree exactly when its step is parallel and holds more
// than one task — the script's own dispatch — and no task in the step is marked
// `checkpoint`. That last conjunct is the whole of the checkpoint demotion: a
// multi-task parallel step holding a marked checkpoint is exactly a step that
// fails the worktree test, so the existing sequential arm executes the demoted
// step unchanged and no second code path appears. A checkpoint's gate covers the
// whole integrated base, and a worktree branches from the checkout's HEAD, so a
// checkpoint packed into a parallel step would gate a tree missing its siblings'
// work.
//
// The conjunct reads `isMarkedCheckpoint` and nothing else. The depth default
// would move every task of an un-marked plan onto the main checkout, where a
// main-checkout task is blocked by any earlier failure, so the parallel arm would
// never run at all; a positional reading would demote the last step for no stated
// reason. Everything else — a one-task parallel step included — runs on the main
// checkout.
function runsInWorktree(step) {
  const tasks = step?.tasks || [];
  return !!step?.parallel && tasks.length > 1 && !tasks.some(isMarkedCheckpoint);
}

// The blocking rules read two facts about an *earlier* task — its checkpoint-ness
// and which checkout it was dispatched to — and the registry deliberately stores
// neither: no reading of the level, and `ran_in_worktree` records an event, which
// a blocked task never had. So both are looked up from the breakdown step list and
// the predicates are called at the point of use, over one walker.
function breakdownEntry(id) {
  for (const step of steps) {
    for (const task of step.tasks) {
      if (task.id === id) return { task, step };
    }
  }
  return null;
}

// A corrective task is not in the step list and resolves to nothing, which is the
// right answer rather than a gap: the completeness schema carries no level field,
// and `finalTaskId` comes from the step list, so `blocksRunWide` is false for a
// corrective task however it is reached.
function blocksRunWideById(id) {
  return blocksRunWide(breakdownEntry(id)?.task);
}

// Where a task ran, or would have run — read by the same classifier the dispatch
// used, never off the record. A *blocked* task ran nowhere, and its
// `ran_in_worktree` truthfully says so; what the rules need is whether it was ever
// going to touch the shared base, because a task that was not leaves nothing
// missing from it. An id outside the step list is a corrective task, which the
// corrective path always dispatches to a worktree.
function dispatchedToWorktree(id) {
  const entry = breakdownEntry(id);
  return entry ? runsInWorktree(entry.step) : true;
}

// ── The blocking rules ───────────────────────────────────────────────
// One failure cancels the tasks that needed the failed work and nothing else,
// which is the whole point of the change: the filed incident cancelled seven
// unrelated tasks. The rules key on the checkout a task runs on plus its
// declared edges, never on the step container, and they read the registry —
// every earlier task's state is already recorded there, blocked ones included,
// so a block propagates exactly as a failure does.

// An id naming no task in this run is logged and ignored. It can never be a
// failed or blocked task, so ignoring it is already the safe reading, and
// aborting the run over a breakdown typo is the over-blocking the optional field
// exists to avoid. Called once per task, which is what makes the log once.
function declaredAncestors(task) {
  const declared = Array.isArray(task?.depends_on) ? task.depends_on : [];
  const known = new Set();
  for (const id of declared) {
    if (knownTaskIds.has(id)) {
      known.add(id);
    } else {
      log(
        `${task.id}: depends_on names \`${id}\`, which is no task in this run — ignored`
      );
    }
  }
  return known;
}

// Returns the id of the earliest task that blocks this one, or null when nothing
// does. `ranInWorktree` is the dispatch fact from the classifier above, not a
// reading of any level.
function firstBlocker(task, { ranInWorktree = false } = {}) {
  // A checkpoint is blocked by any failure or block at all, whatever it
  // declares, because it verifies the whole integrated base and every task in
  // the run is implicitly its ancestor. The run's final task takes this rule
  // too, whether or not breakdown remembered to mark it.
  const isRunWide = blocksRunWide(task);
  const ancestors = declaredAncestors(task);
  for (const record of taskRecords) {
    if (record.state !== "failed" && record.state !== "blocked") continue;
    // A *blocked* checkpoint cancels nothing downstream. It never ran, so it
    // left the base exactly as it found it, and checkpoints are not only final —
    // breakdown authors one at every milestone the plan names, so propagating
    // from a blocked one would stop failure isolation at the next milestone and
    // cancel every task after it. A *failed* checkpoint does propagate: its
    // missing output is a base that meets the gate every later task commits onto
    // or branches from, and the run's final checkpoint is blocked by it, so
    // nothing left in the run will re-verify that base. The exception to the
    // exemption is a later checkpoint, whose own rule the spec states as a
    // precedence over this one — `!isRunWide` is that precedence. It changes no
    // outcome today, because a block implies an earlier failure and that failure
    // blocks a later checkpoint under its own rule; it is here so the precedence
    // is in the code rather than in an argument about the code.
    if (
      record.state === "blocked" &&
      !isRunWide &&
      blocksRunWideById(record.id)
    ) {
      continue;
    }
    if (isRunWide) return record.id;
    // A main-checkout task is blocked by any earlier failed or blocked task,
    // because it commits onto the shared base those tasks were meant to leave.
    if (!ranInWorktree) return record.id;
    // A worktree task is blocked by its declared ancestors, and also by any
    // earlier failed or blocked main-checkout task: worktrees branch from the
    // checkout's HEAD, so such a task would build on a base missing that work.
    // Step order among worktree siblings implies no edge, which falls out of
    // evaluating a whole parallel step's blocking before recording any of it — a
    // sibling is in the registry under neither state at that point.
    if (ancestors.has(record.id)) return record.id;
    if (!dispatchedToWorktree(record.id)) return record.id;
  }
  return null;
}

// ── Reading the confirm agent's result ───────────────────────────────
// Two of the four states a task record can hold come from here, and the third
// state the agent can send is refused rather than believed.

const FULL_HASH = /^[0-9a-f]{40}$/i;

// `verified` and `verified-no-op` are both verified outcomes; only `failed` and
// `blocked` are not. A no-op carries no commit and no branch, so it reaches no
// integrate step on its own account.
function isVerifiedState(state) {
  return state === "verified" || state === "verified-no-op";
}

// Loud failure instead of a fabricated identity. A `verified` state with no
// forty-character hash is the exact shape that stranded the incident's task, so
// the script refuses it here — the one place the confirm result is interpreted —
// rather than carrying an unverifiable claim into the registry, the integrate
// step and the result. Every other state is taken as sent, and an unrecognised
// one is a failure. A hash is kept on a failed task too: what it committed is
// recorded even though it is not verified work.
function readConfirmState(status) {
  const state = typeof status?.state === "string" ? status.state.trim() : "";
  const reported = typeof status?.commit === "string" ? status.commit.trim() : "";
  const hash = FULL_HASH.test(reported) ? reported : null;
  if (state === "verified-no-op") {
    return { state: "verified-no-op", commit: null, reason: null };
  }
  if (state === "verified") {
    if (hash) return { state: "verified", commit: hash, reason: null };
    return {
      state: "failed",
      commit: null,
      reason: `confirm reported \`verified\` with no forty-character commit hash (commit: ${reported || "absent"})`
    };
  }
  return {
    state: "failed",
    commit: hash,
    reason:
      status === null || status === undefined
        ? "confirm returned no structured result"
        : status.summary || `confirm reported state \`${state || "absent"}\``
  };
}

// ── Reading the merge agent's result ─────────────────────────────────
// The counterpart of `readConfirmState`, and the one place a merge result is
// interpreted. The squash commit is the fixed point teardown compares a branch
// against before deleting it, so a success that names none is recorded as *an
// integration with no fixed point* rather than believed or retried.
//
// The contract is enforced here and not in `MERGE_RESULT_SCHEMA` because one
// schema serves both outcomes: a schema-level `required: ["commit"]` makes the
// failure report unrepresentable, and a validation failure re-runs the agent —
// and `integrateAndRecord` is the one agent in this run whose re-run is not
// idempotent, since a second pass over a landed squash reports nothing to
// commit.
//
// The marker keys on the claim of success, so a failed integration is never read
// as one with no fixed point: the same schema carries both outcomes, and a
// failure legitimately names no commit.
function readMergeResult(merge) {
  const reported = typeof merge?.commit === "string" ? merge.commit.trim() : "";
  const hash = FULL_HASH.test(reported) ? reported : null;
  const integrated = !!merge?.success;
  return { integrated, commit: hash, no_fixed_point: integrated && hash === null };
}

// ── Task registry ────────────────────────────────────────────────────
// One ordered registry of task records, keyed by id, in place of the ad-hoc
// per-step collections. It is declared here, ahead of the code that fills it,
// because the execute, confirm and integrate paths all record into it and its
// shape has to be settled once: the recovery report needs a stage, a rung and a
// no-fixed-point marker, and no per-step array has a field for any of them.
const taskRecords = [];

// Every record carries every field, so no consumer tests for a missing key.
// `state` is one of `verified`, `verified-no-op`, `failed`, `blocked`.
//
// No reading of the verification level is stored on a record. `ran_in_worktree`
// stays because it records an event that happened rather than a rule that was
// resolved: after dispatch, which checkout a task ran on is history, and
// teardown and the result both need it.
function taskRecord(
  task,
  { stepIndex, ranInWorktree = false, ...fields } = {}
) {
  return {
    id: task.id,
    title: task.title,
    step_index: stepIndex ?? null,
    ran_in_worktree: !!ranInWorktree,
    state: null,
    stage: null, // the stage that produced the state
    commit: null, // the verified commit hash
    branch: null,
    rung: null, // which verification rung produced the evidence
    ref_moved: false, // whether the confirm agent moved the task's ref
    integration_commit: null, // the recorded squash commit
    no_fixed_point: false, // integrated, but the merge result carried no commit
    blocked_by: null, // the id of the task whose failure blocked this one
    reason: null, // the script's own reason for the state, where it had one
    agent_text: null, // the agent's verbatim text
    ...fields
  };
}

function recordTask(record) {
  taskRecords.push(record);
  return record;
}

// A task the run did not dispatch, and the task that stopped it. This is the
// state that makes the failure report readable: without it a cancelled task and
// a task the script never reached leave the same evidence, which is the reading
// a human recovering the run cannot afford. No agent ran, so there is no agent
// text and no rung.
function recordBlocked(task, blockerId, stepIndex = null) {
  log(`${task.id} blocked by ${blockerId} — not run`);
  return recordTask(
    taskRecord(task, {
      stepIndex,
      state: "blocked",
      stage: "dispatch",
      blocked_by: blockerId
    })
  );
}

// The integration outcome lands on the task's existing record rather than a
// second one: the confirm stage already pushed a record under this id, and two
// records for one task leave every consumer reconciling them. A repeated id — a
// retried task, or a corrective task that reuses one — records onto its most
// recent execution, which is the one being integrated.
function recordIntegration(task, merge) {
  const read = readMergeResult(merge);
  if (read.no_fixed_point) {
    log(
      `${task.id} integrated with no fixed point — the merge result reported success with no forty-character squash commit, and is not retried`
    );
  }
  for (let i = taskRecords.length - 1; i >= 0; i--) {
    if (taskRecords[i].id !== task.id) continue;
    if (read.integrated) {
      taskRecords[i].integration_commit = read.commit;
      taskRecords[i].no_fixed_point = read.no_fixed_point;
    } else {
      // A failed integration is a failed task, at the integrate stage. The
      // confirm stage already wrote this record verified, and leaving that state
      // in place is how a task whose work never landed reports as success. Its
      // commit and branch stay, so the work is still listed as built and not
      // integrated.
      taskRecords[i].state = "failed";
      taskRecords[i].stage = "integrate";
      taskRecords[i].reason =
        merge?.error || "integration failed with no reason reported";
    }
    break;
  }
  return read;
}

// ── Prompt assembly ─────────────────────────────────────────────────

function worktreeInitSection() {
  if (worktreeInit.length === 0) return "";
  return `

## Worktree setup

Your worktree is missing gitignored files the toolchain needs. Run these commands first, before any other work. Stop and report if any command fails.

${worktreeInit.map((c) => "- `" + c + "`").join("\n")}`;
}

// The run id and the baseline reach every prompt whose rules read them. Nobody
// else can produce these values: the script has no git and no clock, and by the
// time the first confirm agent runs a sequential task has already moved the
// base. Called only from prompts assembled after breakdown, which is where
// `baseline` is resolved.
function runContextSection() {
  // Coerced, because a schema-declared string is still whatever the agent sent.
  const porcelain = String(baseline.dirty_at_start);
  const dirty =
    porcelain.length > 0
      ? "```\n" + porcelain + "\n```"
      : "(empty — the main checkout was clean at run start)";
  return `## Run

- Run ID: \`${runId}\`
- Base branch: \`${baseBranch}\`

## Run-start baseline

Captured once by the breakdown agent, after its \`.gitignore\` ensure and its task-file writes. Use these values as given; never re-derive one and never substitute a branch name or \`HEAD\` for \`base_sha\`.

- \`base_sha\`: \`${baseline.base_sha}\`
- \`started_at\`: \`${baseline.started_at}\`
- \`started_at_epoch\`: \`${baseline.started_at_epoch}\`
- \`dirty_at_start\`:

${dirty}`;
}

// The one place the ref path is composed. Both the execute agent that creates it
// and the confirm agent that checks it receive it fully interpolated, so neither
// composes a path of its own and the two cannot disagree. The run id is the
// namespace: task ids repeat across runs, and an un-namespaced ref lets one run
// destroy another run's protection.
function taskRef(task) {
  return `refs/task/${runId}/${task.id}`;
}

// Repository-relative, because the script has no shell to resolve a repository
// root. Every agent that appends to the ledger resolves the absolute path itself
// from `git rev-parse --show-toplevel`; this is the same path for the human
// reading the returned result.
const ledgerPath = `.tasks/${runId}/ledger.jsonl`;

// The execute agent's report is forwarded to the confirm agent as an opaque
// string — the script parses nothing out of it, having no schema for that agent.
// An absent or empty report is forwarded as an explicitly empty section, so the
// confirm agent reads *no report* rather than the literal word `null`.
function executeReportSection(execReport) {
  const text = execReport === null || execReport === undefined ? "" : String(execReport);
  return text.trim().length > 0
    ? text
    : "(empty — the execute agent returned no report, so it carries no anchored lines)";
}

// Each prompt receives the outcome of a rule, never the rule and never the raw
// verification level. An agent that never sees the field cannot apply the wrong
// default to it, and no prompt re-derives a default the script already settled.

// The execute agent gets one statement: one reading governs everything asked of
// it, so which gate applies and which anchored lines are required are the same
// answer.
function gateDemandStatement(task) {
  return runsFullGate(task)
    ? "This task runs the **full gate suite** — build, lint, static analysis, tests — as documented in CLAUDE.md, and repairs what it breaks. Its report must end with an anchored gate line naming the gate outcome, pass or fail, and an anchored repair line naming whether it left any uncommitted repair, with the paths if it did."
    : "This task runs the **scoped** gate: a typecheck or compile plus the tests covering what it touched. No anchored gate line and no anchored repair line are required of it.";
}

// The confirm agent gets two, because two readings govern it. The first also
// settles whether the four verification conditions are sufficient, so nothing
// is left for the agent to work out.
function gateLineRequirementStatement(task) {
  return runsFullGate(task)
    ? "An anchored gate line reporting a **pass** is required of this task. The four verification conditions are necessary but not sufficient for it: a gate line reporting a failure, or no gate line at all, makes this task **failed**, whatever it committed."
    : "No anchored gate line is required of this task. The four verification conditions are sufficient for a verified outcome.";
}

// Availability of the no-op outcome reads the depth rule and what the task was
// dispatched to do, never its position in the run. Both disjuncts below are
// dispatch facts, not a fourth reading of the level.
//
// Why two disjuncts rather than the checkout alone: the checkout was a proxy for
// "this task verifies or repairs rather than producing code", and a corrective
// task breaks the proxy — it repairs, yet it runs in a worktree like a feature
// task. A corrective task authored for a gap that turns out already filled runs
// its gate, finds nothing to repair, and commits nothing; on the checkout alone
// it could only report failed, which halts the corrective loop and blocks the
// remaining corrective tasks. That is the phantom-failure class this whole
// change removes, so being corrective earns the no-op too. An un-marked
// *feature* task in a worktree still cannot claim it: neither disjunct holds.
function noOpAvailabilityStatement(task, { ranOnMainCheckout, isCorrective = false }) {
  return runsFullGate(task) && (ranOnMainCheckout || isCorrective)
    ? "The `verified-no-op` outcome is **available** for this task: a gate that passed with nothing left to repair is a verified outcome, not a failure."
    : "The `verified-no-op` outcome is **not available** for this task. Report it verified only on its own committed evidence, and failed otherwise.";
}

// The completeness agent gets the same treatment: the outcome of a rule, never
// the rule. Whether this pass may author corrective work is the script's answer,
// derived from the registry, so the agent neither infers it from the base's state
// nor re-derives the suppression.
function passModeStatement(readOnly) {
  return readOnly
    ? "This pass is **read-only**. Tasks in this run failed or were blocked, so report which plan deliverables have evidence and what the tests did, and author **no** corrective tasks: any `corrective_tasks` you return is ignored. Repairing a base whose own tasks did not land is not this pass's job."
    : "This pass is the ordinary one. Author a corrective task for each fillable gap, and none for a blocked requirement.";
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

## Verification level
${gateDemandStatement(task)}

## Testing
${testing}

## Run
- Run ID: \`${runId}\`
- Task ID: \`${task.id}\`

## Task ref
Write this ref immediately after committing, exactly as written — it is already complete, so compose no path of your own:

\`git update-ref ${taskRef(task)} <your-full-forty-character-hash> ""\`

## Reporting
Commit all your changes. Prefix the commit message with \`${task.id}: \` so your work can be located afterwards. End your report with the anchored lines described above. You do NOT need to return a structured result — a short prose report is enough, including a friction log (harder_than_expected, wrong_turns, suggestions).`;
}

// Built from the verified hash, with the branch as context. The hash is what the
// confirm agent verified against the four conditions; a branch name is a label,
// and a hand-made worktree's is outside any convention this run chose. The caller
// refuses to reach here without a forty-character hash, so no prompt is ever
// composed from a missing identity.
function mergePrompt(task, result) {
  const reportedBranch =
    typeof result?.branch === "string" && result.branch.trim().length > 0
      ? result.branch.trim()
      : null;
  const branchContext = reportedBranch
    ? `\`${reportedBranch}\` — context only. Squash-merge the commit above, not this name.`
    : "(none — the confirm agent reported no branch. Squash-merge the commit above; nothing here needs a branch name.)";
  return `${prompts.integrate}

## Task: ${task.title} (${task.id})

## Verified commit
\`${result.commit}\`

## Task branch
${branchContext}

${runContextSection()}`;
}

// Confirm a task's outcome from git rather than trusting a self-reported flag.
// The rules are `prompts.confirm`; this is interpolation plus the schema call.
// Minimal-work agents reliably emit structured output, so the schema lives here.
// It takes the task, the checkout it ran on, and the execute agent's report — no
// task list and no index.
async function confirmFromGit(
  task,
  { useWorktree = false, execReport = null, isCorrective = false } = {}
) {
  const where = useWorktree
    ? `This task ran in an isolated git worktree on its own branch, and you are standing in the main checkout — which is why the \`subject-search\` rung reaches for \`--branches\` rather than a range against \`HEAD\`. Report the branch name you saw.`
    : `This task ran on the main checkout — the current branch — so it has no branch of its own to report.`;
  // The dispatch fact, not a reading of the verification level: the checkout
  // the task actually ran on is the argument this function already receives.
  const ranOnMainCheckout = !useWorktree;
  return withRetry(`confirm:${task.id}`, () =>
    agent(
      `${prompts.confirm}

## Task: ${task.title} (${task.id})

${where}

${runContextSection()}

## Task ref
\`${taskRef(task)}\`

## Gate line
${gateLineRequirementStatement(task)}

## Verified no-op
${noOpAvailabilityStatement(task, { ranOnMainCheckout, isCorrective })}

## Execute report
Forwarded verbatim, exactly as the execute agent returned it. Nothing has parsed it before you.

${executeReportSection(execReport)}`,
      {
        label: `confirm:${task.id}`,
        phase: "Execute",
        ...modelOpt,
        schema: GIT_STATUS_SCHEMA
      }
    )
  );
}

// Execute (prose, no forced schema) then confirm the outcome from git state. The
// execute agent's report is carried into the confirm prompt verbatim, and the
// confirmed outcome is recorded in the task registry here — this is the only
// place a task's execute-side state is written, and all three dispatch sites
// (the worktree arm, the main-checkout arm, the corrective loop) call it. The
// name says both obligations, because a caller that forgot the second one is how
// the same defect grew three symptoms.
async function executeAndRecord(
  task,
  { useWorktree = false, stepIndex = null, isCorrective = false } = {}
) {
  const execReport = await agent(execPrompt(task, { useWorktree }), {
    label: `exec:${task.id}`,
    phase: "Execute",
    ...(useWorktree ? { isolation: "worktree" } : {}),
    ...modelOpt
  });
  const status = await confirmFromGit(task, { useWorktree, execReport, isCorrective });
  const confirmed = readConfirmState(status);
  const branch = typeof status?.branch === "string" ? status.branch : null;
  recordTask(
    taskRecord(task, {
      stepIndex,
      ranInWorktree: useWorktree,
      state: confirmed.state,
      // Confirm is the stage that produced every state this function records,
      // including the failure the script itself refused the evidence for.
      stage: "confirm",
      commit: confirmed.commit,
      branch,
      rung: typeof status?.rung === "string" ? status.rung : null,
      ref_moved: !!status?.ref_moved,
      // The script's own reason where it had one — the refused verified state,
      // the absent structured result. The confirm agent's words reach the result
      // through this field too, since a failed task's summary is what says which
      // condition it failed.
      reason: confirmed.reason,
      // The execute agent's own words, at full length. This is what the failure
      // report carries, so the reported hash stays greppable in the result.
      agent_text: execReport === null || execReport === undefined ? null : String(execReport)
    })
  );
  return {
    task_id: task.id,
    state: confirmed.state,
    branch: branch || undefined,
    commit: confirmed.commit || undefined,
    summary: status?.summary || "",
    friction_text: execReport || null,
    error: isVerifiedState(confirmed.state)
      ? undefined
      : confirmed.reason || "no committed work found"
  };
}

// Integration is by commit. The refusal ahead of the agent is the counterpart of
// the confirm-side one: no prompt is built from a missing identity, on the
// parallel path or the corrective one, and an agent sent to merge a hole can only
// report a failure it was handed. The outcome is recorded on the task's existing
// registry record before the result goes back to the caller — the refusal
// included, so a task nothing landed for is failed at the integrate stage
// whichever way the integration did not happen. The raw merge result is returned
// unchanged, so a caller still reads `merge?.success`.
//
// The refusal itself is unreachable from the call sites as they stand: a
// `verified` state always carries a forty-character hash, because the confirm
// reader refuses one that does not, and a `verified-no-op` never reaches here.
// It is kept because that is a property of two other functions, and the cost of
// it becoming false is a task reported verified with nothing landed.
async function integrateAndRecord(task, result) {
  const verified = typeof result?.commit === "string" ? result.commit.trim() : "";
  if (!FULL_HASH.test(verified)) {
    const reason = `no verified forty-character commit to integrate (commit: ${verified || "absent"})`;
    log(`${task.id} not integrated — ${reason}`);
    const refusal = { task_id: task.id, success: false, error: reason };
    recordIntegration(task, refusal);
    return refusal;
  }
  const merge = await withRetry(`merge:${task.id}`, () =>
    agent(mergePrompt(task, result), {
      label: `merge:${task.id}`,
      phase: "Integrate",
      ...modelOpt,
      schema: MERGE_RESULT_SCHEMA
    })
  );
  recordIntegration(task, merge);
  return merge;
}

// ── Phase 1: Breakdown ───────────────────────────────────────────────

phase("Breakdown");

// The baseline commands reach the agent fully interpolated, so it composes and
// guesses nothing. Every run of this workflow happens on a feature branch, and
// an agent left to substitute the base branch itself would plausibly write
// `main`.
const breakdownPrompt = `${prompts.breakdown}

## Run ID

${runId}

## Run-start baseline capture

Run these four commands in the main checkout, exactly as written, and return their output in the \`baseline\` object of your result. Run them **last** — after ensuring \`.tasks/\` is in \`.gitignore\` and after writing the task files under \`.tasks/${runId}/\` — so the run's own setup dirt sits inside the baseline rather than beyond it.

- \`base_sha\` — \`git rev-parse ${baseBranch}\`
- \`started_at\` — \`date -u +%FT%TZ\`
- \`started_at_epoch\` — \`date -u +%s\`
- \`dirty_at_start\` — \`git status --porcelain\`

Report \`dirty_at_start\` verbatim, including when it is empty; an empty value is the ordinary case and means a clean start. Report \`started_at_epoch\` as a string. All four are required: a missing value aborts the run before the first task, because nothing else in the run can produce it.
${model ? `\n## Task sizing\n\nSubagents will use the model "${model}". Size tasks accordingly — smaller or less capable models need narrower, more explicit tasks with less ambiguity. Larger models can handle broader tasks with more judgment calls.` : ""}

## Plan

${planRef}`;

// Breakdown is the hardest-thinking phase — always use Opus regardless of the execution model
const breakdown = await withRetry("breakdown", () =>
  agent(breakdownPrompt, {
    label: "decompose",
    model: "opus",
    schema: BREAKDOWN_SCHEMA
  })
);

if (!breakdown?.steps?.length) {
  log("Breakdown produced no steps — stopping");
  return { tasks_total: 0, complete: false, error: "breakdown failed" };
}

const steps = breakdown.steps;
const taskCount = steps.reduce((n, s) => n + s.tasks.length, 0);
log(`${taskCount} tasks across ${steps.length} steps`);

// Five mechanisms consume the baseline and none has another source, so a
// missing value aborts the run before the first task rather than degrading
// silently at each of them.
const missingBaseline = missingPaths(
  breakdown.baseline,
  REQUIRED_BASELINE_VALUES,
  "baseline",
  BASELINE_MAY_BE_EMPTY
);
if (missingBaseline.length > 0) {
  return abortRun(
    `missing baseline value(s): ${missingBaseline.join(", ")}`,
    taskCount
  );
}
const baseline = breakdown.baseline;

// One run-wide constant, resolved once: the last task of the last step of the
// breakdown step list. Never a list plus an index — `const tasks = step.tasks`
// is in scope throughout the step loop below, so a predicate taking a task list
// would silently read "the last task of *this* step" and make every step's
// trailing task run-wide blocking. Corrective tasks are not in the breakdown
// step list, so no corrective task is run-wide blocking by position either.
const finalStepTasks = steps[steps.length - 1]?.tasks || [];
const finalTaskId = finalStepTasks[finalStepTasks.length - 1]?.id || null;

// Every id `depends_on` may legitimately name. Corrective tasks are absent by
// design and need no entry: the completeness schema carries no `depends_on`
// field, so a corrective task declares no edges at all.
const knownTaskIds = new Set();
for (const step of steps) {
  for (const task of step.tasks) knownTaskIds.add(task.id);
}

// ── Phase 2 & 3: Execute and Integrate ───────────────────────────────

const allFriction = [];
// A derived view, not a collection of record: the execute prompt's prior-work
// section wants three fields, and the registry is where the whole answer lives.
const completedWork = [];

// Teardown writes the run's closing ledger lines, enumerates the branches and
// worktrees it will not touch, and runs even when no worktree exists — which is
// why it is no longer named for cleaning worktrees up. Owned here rather than in
// the integrate prompt because git refuses to delete a branch still checked out in
// a live worktree, so the worktree has to go first, and only one agent sees the
// whole run.
//
// The script hands over the five inputs teardown cannot derive and no candidate
// delete list. That is the change: the old prompt was handed a name set and told
// to delete it, so a branch was deleted on the strength of a string the script had
// carried since the confirm step, and a branch whose name was never captured
// leaked along with its worktree. The rules that decide are in `prompts.teardown`,
// where the landed-content check and the tie rules can be stated with the commands
// that measure them.
async function runTeardown() {
  const worktreeRecords = taskRecords.filter((record) => record.ran_in_worktree);
  // Every task of the run, not only the ones that reported a branch. Teardown's
  // tie rules read this list to recognise a branch by name, and its ledger lines
  // key on the task it tied a branch to, so a task whose branch was never
  // captured has to be visible here as exactly that.
  const taskList = taskRecords
    .map((record) => {
      const where = record.ran_in_worktree
        ? "ran in a worktree"
        : "ran on the main checkout";
      const branch = record.ran_in_worktree
        ? record.branch
          ? `branch \`${record.branch}\``
          : "no branch name was captured for it"
        : "no branch of its own";
      return `- \`${record.id}\` — ${where}; ${branch}; state \`${record.state}\``;
    })
    .join("\n");

  // The fixed point the landed-content check measures against, per task. A
  // no-fixed-point integration is named as such rather than omitted: it landed,
  // and teardown has to fall back to the base tip knowing that the fallback is
  // covering a missing hash rather than an absent integration.
  const integratedRecords = taskRecords.filter(
    (record) => record.integration_commit || record.no_fixed_point
  );
  const integrationList = integratedRecords.length
    ? integratedRecords
        .map((record) =>
          record.integration_commit
            ? `- \`${record.id}\` — integrated at \`${record.integration_commit}\``
            : `- \`${record.id}\` — integrated, and the integration reported no squash commit, so it has no fixed point`
        )
        .join("\n")
    : "(none — no task's work was integrated in this run)";

  const failedRecordsForTeardown = taskRecords.filter(
    (record) => record.state === "failed"
  );
  const failedList = failedRecordsForTeardown.length
    ? failedRecordsForTeardown
        .map(
          (record) =>
            `- \`${record.id}\` — failed at the ${record.stage} stage: ${record.reason || "no reason reported"}`
        )
        .join("\n")
    : "(none)";

  const blockedRecordsForTeardown = taskRecords.filter(
    (record) => record.state === "blocked"
  );
  const blockedList = blockedRecordsForTeardown.length
    ? blockedRecordsForTeardown
        .map((record) => `- \`${record.id}\` — blocked by \`${record.blocked_by}\``)
        .join("\n")
    : "(none)";

  log(
    `Teardown: ${taskRecords.length} task(s), ${worktreeRecords.length} of them in a worktree`
  );

  const prompt = `${prompts.teardown}

${runContextSection()}

## This run's tasks
${taskList || "(none — the run recorded no task)"}

## Recorded integrations
${integrationList}

## Failed tasks
${failedList}

## Blocked tasks
${blockedList}`;

  // Not wrapped in `withRetry`, and guarded instead. Teardown is the last thing
  // the run does, so an agent that skips its structured-output call would
  // otherwise throw away the whole recovery-grade result — the one artifact this
  // change exists to deliver. A retry is the wrong remedy for the same reason it
  // is wrong on the integrate agent: the second pass acts on a tree the first pass
  // already changed.
  let result = null;
  try {
    result = await agent(prompt, {
      label: "teardown",
      phase: "Teardown",
      schema: CLEANUP_RESULT_SCHEMA
    });
  } catch (thrown) {
    log(
      `teardown: no structured result (${String(thrown).slice(0, 100)}) — the ledger is what the closing state is read from`
    );
    return;
  }

  // Logged, not returned. What a human recovers from is the ledger, whose path
  // the result carries; these lines are so the operator watching the run sees a
  // kept tree at the moment it is kept.
  for (const tree of result?.worktrees || []) {
    if (tree?.removed) continue;
    log(
      `teardown kept worktree ${tree?.path} (${tree?.dirty_files ?? "unknown"} dirty file(s)): ${tree?.reason}`
    );
  }
  for (const branch of result?.branches || []) {
    if (branch?.deleted) continue;
    log(`teardown kept branch ${branch?.branch}: ${branch?.reason}`);
  }
  for (const entry of result?.untied || []) {
    log(`teardown listed ${entry?.entry} and left it alone: ${entry?.reason}`);
  }
  for (const e of result?.errors || []) log(`teardown: ${e}`);
}

// The loop has no early return. A failure records a state and the blocking
// predicate is what stops the work that needed it, so the run always reaches the
// Verify phase and teardown — which is the whole of the filed problem: one task's
// failure cancelled seven unrelated tasks by returning out of this loop.
for (let si = 0; si < steps.length; si++) {
  const step = steps[si];
  const tasks = step.tasks;
  const useWorktree = runsInWorktree(step);

  if (step.parallel && tasks.length > 1 && !useWorktree) {
    log(
      `Step ${si + 1}: demoted to sequential — it holds a task marked \`checkpoint\`, whose gate covers the whole integrated base`
    );
  }

  if (useWorktree) {
    // ── Parallel: worktree isolation + squash-merge integration ──
    log(`Step ${si + 1}: ${tasks.length} tasks in parallel`);

    // Blocking is evaluated for the whole step before any of it is recorded,
    // which is what makes "step order among worktree siblings implies no edge"
    // true by construction: at that point no sibling is in the registry under any
    // state, so none can block another. Recording as we went happens to give the
    // same answers today — a blocked sibling was dispatched to a worktree, and the
    // failure behind its block is always earlier in the registry — but that is
    // three arguments deep and each of them is a rule that could change.
    const runnable = [];
    const blocked = [];
    for (const task of tasks) {
      const blocker = firstBlocker(task, { ranInWorktree: true });
      if (blocker) blocked.push({ task, blocker });
      else runnable.push(task);
    }
    for (const entry of blocked) recordBlocked(entry.task, entry.blocker, si);

    if (runnable.length > 0) {
      phase("Execute");
      const results = await parallel(
        runnable.map(
          (task) => () => executeAndRecord(task, { useWorktree: true, stepIndex: si })
        )
      );

      const succeeded = [];
      for (let i = 0; i < runnable.length; i++) {
        const r = results[i];
        const t = runnable[i];
        if (r?.friction_text)
          allFriction.push({
            task_id: t.id,
            title: t.title,
            friction: r.friction_text
          });
        if (isVerifiedState(r?.state)) {
          succeeded.push({ task: t, result: r });
        } else {
          log(`${t.id} failed: ${r?.error || "agent returned null"}`);
        }
      }

      if (succeeded.length > 0) phase("Integrate");
      for (const { task: t, result: r } of succeeded) {
        // A verified no-op is a verified state, not an integration: it has no
        // commit and no branch, so no integrate step runs for it and no prompt is
        // built from its missing branch.
        if (r.state === "verified-no-op") {
          log(`${t.id} verified with nothing to integrate`);
          continue;
        }
        log(`Integrating ${t.id}: ${t.title}`);
        const merge = await integrateAndRecord(t, r);
        if (!merge?.success) {
          // The remaining integrations still run. Every task in this step
          // branched from the base before the failure and declares no edge to
          // it, so none of them needed the failed work.
          log(
            `Integration failed for ${t.id}: ${merge?.error || "unknown"} — the independent work in this step still integrates`
          );
          continue;
        }
        completedWork.push({
          task_id: t.id,
          title: t.title,
          summary: r.summary || ""
        });
      }
    }
  } else {
    // ── Sequential: run directly on the main checkout ──
    // Blocking is evaluated per task here, not once for the step: these tasks
    // run in order on the shared base, so one of them is blocked by an earlier
    // one in its own step exactly as by an earlier step's.
    for (const task of tasks) {
      const blocker = firstBlocker(task, { ranInWorktree: false });
      if (blocker) {
        recordBlocked(task, blocker, si);
        continue;
      }
      log(`Step ${si + 1}: ${task.title}`);

      phase("Execute");
      const r = await executeAndRecord(task, { stepIndex: si });
      if (r?.friction_text)
        allFriction.push({
          task_id: task.id,
          title: task.title,
          friction: r.friction_text
        });
      if (!isVerifiedState(r?.state)) {
        log(`${task.id} failed: ${r?.error || "agent returned null"}`);
        continue;
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
let lastCheck = null;

// A failed or blocked task suppresses the corrective rounds: the check still runs
// exactly once, read-only, and the loop exits on its report. Re-read at the top of
// every round, because a failed corrective task suppresses the next one.
const anyTaskUnverified = () =>
  taskRecords.some(
    (record) => record.state === "failed" || record.state === "blocked"
  );

while (!complete && iteration < 3) {
  iteration++;
  const readOnly = anyTaskUnverified();
  log(`Completeness check ${iteration}/3${readOnly ? " (read-only)" : ""}`);

  const check = await withRetry(`verify:${iteration}`, () =>
    agent(
      `${prompts.verify}\n\n## Pass mode\n${passModeStatement(readOnly)}\n\n## Original plan\n${planRef}`,
      {
        label: `verify:${iteration}`,
        phase: "Verify",
        ...modelOpt,
        schema: COMPLETENESS_SCHEMA
      }
    )
  );

  if (!check) {
    log("Completeness check inconclusive — stopping");
    break;
  }
  lastCheck = check;

  // The suppressed pass reports and stops. Its `corrective_tasks` are ignored
  // whatever the agent returned, and `complete` stays false: a base whose own
  // tasks did not land is not complete, whatever the check says about the
  // deliverables it can see. Without the exit a suppressed run would re-run the
  // full gate suite up to three times to no effect.
  if (readOnly) {
    log(
      "Completeness ran read-only — tasks failed or were blocked, so no corrective task runs"
    );
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

  // The corrective path carries the parallel path's obligations, through the same
  // two helpers rather than a third re-implementation with its own guard. A
  // corrective task that ends unverified — or whose integration fails — ends the
  // loop, and the corrective tasks after it are recorded blocked rather than
  // dropped, because a corrective outcome is never log-only.
  let halted = null;
  for (const fix of fixes) {
    if (halted) {
      recordBlocked(fix, halted);
      continue;
    }
    const blocker = firstBlocker(fix, { ranInWorktree: true });
    if (blocker) {
      recordBlocked(fix, blocker);
      halted = blocker;
      continue;
    }

    phase("Execute");
    const r = await executeAndRecord(fix, { useWorktree: true, isCorrective: true });
    if (r?.friction_text) {
      allFriction.push({
        task_id: fix.id,
        title: fix.title,
        friction: r.friction_text
      });
    }

    if (!isVerifiedState(r?.state)) {
      log(
        `${fix.id} failed: ${r?.error || "agent returned null"} — the corrective loop ends here`
      );
      halted = fix.id;
      continue;
    }
    if (r.state === "verified-no-op") {
      log(`${fix.id} verified with nothing to integrate`);
      continue;
    }

    phase("Integrate");
    const merge = await integrateAndRecord(fix, r);
    if (!merge?.success) {
      log(
        `Corrective integration failed for ${fix.id}: ${merge?.error || "unknown"} — the corrective loop ends here`
      );
      halted = fix.id;
    }
  }
  if (halted) break;
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

// ── Phase 6: Teardown ────────────────────────────────────────────────
// On the one path out of the run there now is, and unconditional on it: a failure
// no longer returns from the step loop, and a run with no worktree still has a
// ledger to close. Both halves matter — the incident's own run reached no teardown
// at all, and a purely sequential run reached one that returned before it wrote a
// line.

phase("Teardown");
await runTeardown();

// ── Result ───────────────────────────────────────────────────────────
// Recovery-grade, and assembled from the registry rather than from whatever each
// arm happened to keep on its way out. One return, so the shape does not depend
// on which failure ended the run: there is no failure that ends the run any more.

const failedRecords = taskRecords.filter((record) => record.state === "failed");
const blockedRecords = taskRecords.filter((record) => record.state === "blocked");

// Work that exists at a hash with nothing to show it landed. Main-checkout tasks
// commit straight onto the base, so only a worktree task can be in this state;
// an integration with no fixed point landed and is not listed here.
const strandedRecords = taskRecords.filter(
  (record) =>
    record.ran_in_worktree &&
    record.commit &&
    !record.integration_commit &&
    !record.no_fixed_point
);

// The base-never-fully-verified statement, keyed on the same run-wide gate as the
// blocking it reports, and stated beside the failed list as well as the blocked
// one — a failed checkpoint appears in the first and a blocked one in the second.
const unverifiedGates = taskRecords.filter(
  (record) =>
    (record.state === "failed" || record.state === "blocked") &&
    blocksRunWideById(record.id)
);
const baseNeverFullyVerified =
  unverifiedGates.length === 0
    ? null
    : `The base was never fully verified: ${unverifiedGates
        .map((record) =>
          record.state === "blocked"
            ? `${record.id} was blocked by ${record.blocked_by}`
            : `${record.id} failed at the ${record.stage} stage`
        )
        .join("; ")}.`;

const errorParts = [];
if (failedRecords.length > 0) {
  errorParts.push(`${failedRecords.map((r) => r.id).join(", ")} failed`);
}
if (blockedRecords.length > 0) {
  errorParts.push(`${blockedRecords.map((r) => r.id).join(", ")} blocked`);
}

return {
  tasks_total: taskCount,
  completeness_iterations: iteration,
  complete,
  // Each failed task with the stage that failed it, the script's or the agent's
  // reason, and the execute agent's verbatim text — at full length, so the hash
  // the agent reported is greppable in the failure result.
  failed: failedRecords.map((record) => ({
    task_id: record.id,
    title: record.title,
    stage: record.stage,
    reason: record.reason,
    commit: record.commit,
    branch: record.branch,
    rung: record.rung,
    agent_text: record.agent_text
  })),
  // A state distinct from failed, each naming the task that stopped it.
  blocked: blockedRecords.map((record) => ({
    task_id: record.id,
    title: record.title,
    blocked_by: record.blocked_by
  })),
  built_not_integrated: strandedRecords.map((record) => ({
    task_id: record.id,
    title: record.title,
    commit: record.commit,
    branch: record.branch,
    // Composed by the same function the two agents' prompts are, on the record's
    // id, so the ref a human reads here cannot disagree with the one they wrote.
    ref: taskRef(record),
    ref_moved: record.ref_moved
  })),
  integrations: taskRecords
    .filter((record) => record.integration_commit || record.no_fixed_point)
    .map((record) => ({
      task_id: record.id,
      commit: record.integration_commit,
      no_fixed_point: record.no_fixed_point
    })),
  base_never_fully_verified: baseNeverFullyVerified,
  completeness: lastCheck
    ? {
        all_complete: !!lastCheck.all_complete,
        test_passed: !!lastCheck.test_passed,
        deliverables: lastCheck.deliverables || []
      }
    : null,
  ledger_path: ledgerPath,
  friction_logs: allFriction,
  retrospective: retro,
  ...(errorParts.length > 0 ? { error: errorParts.join("; ") } : {})
};
