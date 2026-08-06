// Plan Execution Workflow — Simple (single-task)
//
// For plans that fit in a single agent context window.
// No worktrees, no task breakdown, no integration phase.
//
// Prompt text comes from args.prompts (sourced from prompts.md).

export const meta = {
  name: "plan-execution-simple",
  description:
    "Execute a small plan in a single agent, then verify completeness",
  phases: [
    { title: "Execute", detail: "Run the plan in a single agent" },
    {
      title: "Verify",
      detail: "Check completeness against plan and run tests"
    },
    {
      title: "Retrospective",
      detail: "Synthesize friction into actionable patterns"
    }
  ]
};

const parsedArgs = typeof args === "string" ? JSON.parse(args) : args;
const {
  plan,
  planPath,
  model,
  prompts,
  retrospective: runRetrospective = true
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

// The execute agent does heavy work (write code, deploy, run tests). Forcing it
// to also emit a structured result is the most failure-prone step in a run — the
// agent finishes its work and stops without the final tool call. Instead it
// returns prose, and this lightweight agent confirms the outcome from git state.
const GIT_STATUS_SCHEMA = {
  type: "object",
  properties: {
    success: { type: "boolean" },
    commit: { type: "string", description: "Final commit hash" },
    summary: { type: "string" }
  },
  required: ["success", "summary"]
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
    fixes_applied: {
      type: "boolean",
      description: "Whether gaps were found and fixed in this pass"
    }
  },
  required: ["all_complete", "test_passed", "deliverables"]
};

// ── Execute ──────────────────────────────────────────────────────────

phase("Execute");

// Heavy worker: returns prose (including a friction log), no forced schema.
const execReport = await agent(`${prompts.execute}\n\n## Plan\n\n${planRef}`, {
  label: "execute",
  phase: "Execute",
  ...modelOpt
});

// Confirm the outcome from git rather than trusting a self-reported flag.
const status = await withRetry("confirm", () =>
  agent(
    `A prior agent just executed an implementation plan on the current branch (the main checkout). Determine from git whether its work landed — do NOT do any implementation work yourself.

Steps:
1. Inspect \`git log\` (recent commits) and \`git status\`.
2. Decide success: the plan's changes are committed and present (a new commit since work began).
3. Report the final commit hash and a one-line summary.`,
    {
      label: "confirm",
      phase: "Execute",
      ...modelOpt,
      schema: GIT_STATUS_SCHEMA
    }
  )
);

const frictionEntry = execReport
  ? [{ task_id: "main", title: "plan execution", friction: execReport }]
  : [];

if (!status?.success) {
  log(`Execution did not land: ${status?.summary || "no commit found"}`);
  return {
    success: false,
    error: status?.summary || "execute produced no committed work",
    friction_logs: frictionEntry
  };
}

const allFriction = frictionEntry;

// ── Verify ───────────────────────────────────────────────────────────

phase("Verify");
let iteration = 0;
let complete = false;

while (!complete && iteration < 3) {
  iteration++;
  log(`Completeness check ${iteration}/3`);

  const check = await withRetry(`verify:${iteration}`, () =>
    agent(
      `${prompts.verify}\n\nIf you find gaps, fix them directly in the working tree — do not define corrective tasks for other agents. Set fixes_applied to true if you made changes.\n\n## Original plan\n${planRef}`,
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
  } else if (check.all_complete && check.test_passed) {
    complete = true;
    log("All deliverables verified, tests passing");
  } else {
    const gaps = (check.deliverables || []).filter((d) => d.status === "gap");
    if (gaps.length === 0 && check.test_passed) {
      complete = true;
      log("All deliverables verified, tests passing");
    } else if (!check.fixes_applied) {
      log(`${gaps.length} gaps found — no fixes possible, stopping`);
      break;
    } else {
      log(`${gaps.length} gaps found — fixes applied, re-checking`);
    }
  }
}

if (!complete) log("Completeness cap reached — partial progress on branch");

// ── Retrospective ────────────────────────────────────────────────────

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

// ── Result ───────────────────────────────────────────────────────────

return {
  success: true,
  completeness_iterations: iteration,
  complete,
  friction_logs: allFriction,
  retrospective: retro
};
