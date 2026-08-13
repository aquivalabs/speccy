#!/usr/bin/env node
// tests/script-rules.test.mjs — Vehicle 2: the workflow script's
// own logic, driven offline with no agents and no git.
//
// Two subjects, stated here because the second is not obvious from the file:
// the source driver below runs the REAL
// skills/plan-execution/workflow.js, and the groups assert both
// on what it returns and on the prompts it hands its agents. Nothing inside the
// script is mocked or re-implemented here.
//
// How the driver works. workflow.js is loadable as neither an ES module nor a
// CommonJS script — it carries both `export const meta` and a top-level
// `return` — so it cannot be imported. The shim strips its one `export`
// keyword, wraps the remaining source in an async IIFE inside
// `new Function("args", "agent", "parallel", "phase", "log", …)`, and stubs
// `agent` by `opts.label`. The stub records every call, so a test can assert
// which agents ran, in what order, with which prompt text and which options.
//
// Groups in this file, and where each comes from:
//   - preconditions: the missing-prompt-section abort and the missing-baseline
//     abort, both of which run before the first task's dispatch.
//   - identity: the confirm prompt's inputs — the execute report forwarded
//     verbatim, both composed gate statements, the run id and all four baseline
//     values, and the execute prompt's fully interpolated task ref — plus the
//     script's refusal of a `verified` state that carries no forty-character
//     hash.
//   - failure isolation: the classifier's checkpoint conjunct, the blocking
//     rules, the Verify-phase suppression, the corrective loop's exit, and the
//     recovery-grade result assembled from the task registry. These assert one
//     shape per mechanism; the exhaustive matrix is the group below them.
//   - teardown: that it runs on every exit path — a run with no worktree
//     included — and that its prompt carries the five inputs it cannot derive.
//   - the shape matrix: every cell of the plan's twelve-cell task-shape table,
//     including the two it calls unreachable and the one residual miss it names.
//   - the composition holes: the four shapes where two reasonable rules met and
//     left a gap, each with its own fixture.
//   - suppression: what a read-only completeness pass may and may not conclude.
//   - the result: the whole recovery-grade key set, on a failing run and a clean
//     one.
//
// Run: node tests/script-rules.test.mjs

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const WORKFLOW = join(HERE, "..", "skills", "plan-execution", "workflow.js");

let pass = 0;
let fail = 0;

function check(desc, ok, detail = "") {
  if (ok) {
    console.log(`  ok: ${desc}`);
    pass += 1;
  } else {
    console.log(`  FAIL: ${desc}${detail ? ` — ${detail}` : ""}`);
    fail += 1;
  }
}

function checkIncludes(desc, haystack, needle) {
  const ok = typeof haystack === "string" && haystack.includes(needle);
  check(desc, ok, `want ${JSON.stringify(needle)} in ${JSON.stringify(haystack)}`);
}

function checkEqual(desc, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  check(desc, ok, `want ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

// ── The source driver ────────────────────────────────────────────────

const source = readFileSync(WORKFLOW, "utf8");
const exportCount = (source.match(/^export /gm) || []).length;
if (exportCount !== 1) {
  console.error(
    `driver: workflow.js has ${exportCount} top-level \`export \` statements, expected exactly 1 — the shim strips one`
  );
  process.exit(1);
}

const driverBody = `return (async () => {\n${source.replace(/^export const meta/m, "const meta")}\n})();`;
const driver = new Function("args", "agent", "parallel", "phase", "log", driverBody);

// Drive one run. `agents` maps a stub onto an agent by exact `opts.label`, then
// by the label's kind (the part before `:`), then by `*`. A stub may be a value
// or a function of the call. An unstubbed agent returns null, which is what the
// harness does when an agent skips its structured-output call.
async function runWorkflow({ args, agents = {} } = {}) {
  const calls = [];
  const logs = [];
  const phases = [];

  const agentStub = async (prompt, opts = {}) => {
    const label = opts.label ?? "(unlabelled)";
    calls.push({ label, prompt, opts });
    const kind = label.includes(":") ? label.slice(0, label.indexOf(":")) : label;
    const stub =
      agents[label] !== undefined
        ? agents[label]
        : agents[kind] !== undefined
          ? agents[kind]
          : agents["*"];
    if (typeof stub === "function") return stub({ prompt, opts, label });
    return stub === undefined ? null : stub;
  };

  const parallelStub = async (thunks) => Promise.all(thunks.map((thunk) => thunk()));

  let result = null;
  let error = null;
  try {
    result = await driver(
      args,
      agentStub,
      parallelStub,
      (name) => phases.push(name),
      (line) => logs.push(String(line))
    );
  } catch (thrown) {
    error = thrown;
  }

  return {
    result,
    error,
    calls,
    logs,
    phases,
    labels: calls.map((call) => call.label),
    promptFor: (label) => calls.find((call) => call.label === label)?.prompt
  };
}

// ── Fixtures ─────────────────────────────────────────────────────────

// Every section workflow.js interpolates. The list is complete now that
// `teardown` has its own section: the guard demands all seven, and the group
// below asserts one abort per missing section.
const PROMPT_SECTIONS = [
  "breakdown",
  "execute",
  "confirm",
  "integrate",
  "verify",
  "retrospective",
  "teardown"
];

const completePrompts = () =>
  Object.fromEntries(PROMPT_SECTIONS.map((section) => [section, `[${section} prompt body]`]));

const completeBaseline = () => ({
  base_sha: "a".repeat(40),
  started_at: "2026-01-02T03:04:05Z",
  started_at_epoch: "1767322445",
  dirty_at_start: " M .gitignore\n"
});

// A task with no level field. Callers add one where the reading is the subject.
const taskFixture = (id, overrides = {}) => ({
  id,
  title: `Task ${id}`,
  description: `Do the ${id} thing.`,
  files: [`src/${id}.txt`],
  acceptance_criteria: [`${id} is done`],
  ...overrides
});

const oneTaskBreakdown = (overrides = {}) => ({
  baseline: completeBaseline(),
  steps: [
    {
      parallel: false,
      tasks: [
        {
          id: "task-1",
          title: "First task",
          description: "Do the first thing.",
          files: ["src/first.txt"],
          acceptance_criteria: ["the first thing is done"],
          verification_level: "scoped"
        }
      ]
    }
  ],
  ...overrides
});

const breakdownOf = (steps) => ({ baseline: completeBaseline(), steps });

const baseArgs = (overrides = {}) => ({
  planPath: "docs/plan.md",
  baseBranch: "feature/demo",
  runId: "demo-run-20260102-0304",
  prompts: completePrompts(),
  ...overrides
});

const VERIFIED_HASH = "b".repeat(40);

// A whole clean run, offline: breakdown, one sequential task, its confirm, one
// completeness pass, the retrospective.
const cleanRunAgents = (breakdown = oneTaskBreakdown()) => ({
  decompose: breakdown,
  exec: "Prose report. Friction: none.",
  confirm: {
    state: "verified",
    commit: VERIFIED_HASH,
    rung: "reported-hash",
    summary: "committed"
  },
  verify: { all_complete: true, test_passed: true, deliverables: [] },
  retrospective: "No cross-cutting friction."
});

// ── Group: the driver drives the real script ─────────────────────────

console.log("\nsource driver");
{
  const run = await runWorkflow({ args: baseArgs(), agents: cleanRunAgents() });
  check("no exception escapes the run", run.error === null, String(run.error));
  checkEqual(
    "every agent runs, in order, stubbed by label",
    run.labels,
    ["decompose", "exec:task-1", "confirm:task-1", "verify:1", "retrospective", "teardown"]
  );
  check("the run returns its result object", run.result?.complete === true, JSON.stringify(run.result));
  checkEqual("phases are reported", run.phases, [
    "Breakdown",
    "Execute",
    "Verify",
    "Retrospective",
    "Teardown"
  ]);
}

// ── Group: preconditions — the required prompt sections ──────────────
// A caller that passes a stale prompts object would otherwise interpolate
// `undefined` into an agent prompt. The abort happens before any agent runs.

console.log("\npreconditions: prompt sections");
for (const section of PROMPT_SECTIONS) {
  const prompts = completePrompts();
  delete prompts[section];
  const run = await runWorkflow({
    args: baseArgs({ prompts }),
    agents: cleanRunAgents()
  });
  checkIncludes(`missing prompts.${section} aborts naming it`, run.result?.error, `prompts.${section}`);
  check(`missing prompts.${section} aborts before any agent runs`, run.labels.length === 0, run.labels.join(","));
  check(`missing prompts.${section} reports the run incomplete`, run.result?.complete === false);
}

{
  const prompts = completePrompts();
  prompts.execute = "   ";
  const run = await runWorkflow({ args: baseArgs({ prompts }), agents: cleanRunAgents() });
  checkIncludes("an empty prompt section counts as missing", run.result?.error, "prompts.execute");
}

{
  const run = await runWorkflow({
    args: baseArgs({ prompts: undefined }),
    agents: cleanRunAgents()
  });
  for (const section of PROMPT_SECTIONS) {
    checkIncludes(`no prompts object at all names prompts.${section}`, run.result?.error, `prompts.${section}`);
  }
  check("no prompts object at all aborts before any agent runs", run.labels.length === 0);
}

// ── Group: preconditions — the run-start baseline ────────────────────
// Five mechanisms consume the baseline and none has another source, so a
// missing value aborts the run before the first task instead of degrading
// silently at each of them.

console.log("\npreconditions: run-start baseline");
const BASELINE_VALUES = ["base_sha", "started_at", "started_at_epoch", "dirty_at_start"];

for (const value of BASELINE_VALUES) {
  const breakdown = oneTaskBreakdown();
  delete breakdown.baseline[value];
  const run = await runWorkflow({ args: baseArgs(), agents: cleanRunAgents(breakdown) });
  checkIncludes(`missing baseline.${value} aborts naming it`, run.result?.error, `baseline.${value}`);
  checkEqual(`missing baseline.${value} aborts before the first task`, run.labels, ["decompose"]);
  check(`missing baseline.${value} reports the run incomplete`, run.result?.complete === false);
  check(
    `missing baseline.${value} still reports the task count`,
    run.result?.tasks_total === 1,
    JSON.stringify(run.result)
  );
}

for (const value of ["base_sha", "started_at", "started_at_epoch"]) {
  const breakdown = oneTaskBreakdown();
  breakdown.baseline[value] = "";
  const run = await runWorkflow({ args: baseArgs(), agents: cleanRunAgents(breakdown) });
  checkIncludes(`an empty baseline.${value} counts as missing`, run.result?.error, `baseline.${value}`);
}

{
  const breakdown = oneTaskBreakdown();
  delete breakdown.baseline;
  const run = await runWorkflow({ args: baseArgs(), agents: cleanRunAgents(breakdown) });
  for (const value of BASELINE_VALUES) {
    checkIncludes(`no baseline object at all names baseline.${value}`, run.result?.error, `baseline.${value}`);
  }
  checkEqual("no baseline object at all aborts before the first task", run.labels, ["decompose"]);
}

{
  // `dirty_at_start` is required but may be empty: an empty value is the
  // ordinary case and means a clean checkout at run start.
  const breakdown = oneTaskBreakdown();
  breakdown.baseline.dirty_at_start = "";
  const run = await runWorkflow({ args: baseArgs(), agents: cleanRunAgents(breakdown) });
  check("an empty dirty_at_start is a value, not a hole", run.result?.error === undefined, JSON.stringify(run.result));
  check("an empty dirty_at_start reaches the first task's dispatch", run.labels.includes("exec:task-1"));
}

{
  // An agent that reports epoch seconds as a number is not a dead run.
  const breakdown = oneTaskBreakdown();
  breakdown.baseline.started_at_epoch = 1767322445;
  const run = await runWorkflow({ args: baseArgs(), agents: cleanRunAgents(breakdown) });
  check("a numeric started_at_epoch reaches the first task's dispatch", run.labels.includes("exec:task-1"));
}

// ── Group: identity — the execute prompt's task ref ──────────────────
// The agent composes no ref path of its own, so the prompt must carry the whole
// thing, run id and task id already substituted.

console.log("\nidentity: the execute prompt's task ref");
{
  const run = await runWorkflow({ args: baseArgs(), agents: cleanRunAgents() });
  const prompt = run.promptFor("exec:task-1");
  const ref = "refs/task/demo-run-20260102-0304/task-1";
  checkIncludes("the execute prompt carries the fully interpolated ref", prompt, ref);
  checkIncludes(
    "the ref arrives as a complete create-only command",
    prompt,
    `git update-ref ${ref} <your-full-forty-character-hash> ""`
  );
  check(
    "nothing in the execute prompt is left uninterpolated",
    typeof prompt === "string" && !prompt.includes("undefined") && !prompt.includes("${"),
    prompt
  );
}

// ── Group: identity — the confirm prompt's inputs ────────────────────
// The script's job on the confirm side is forwarding: the execute agent's prose
// goes across as an opaque string, and the values no agent can derive go across
// interpolated.

console.log("\nidentity: the confirm prompt carries the execute report verbatim");

const EXEC_REPORT = [
  "Wrote the widget and ran the gate.",
  "",
  "## Deviations",
  "plan expected src/old.txt / found src/new.txt / edited the latter",
  "",
  `Commit: ${"d".repeat(40)}`,
  "Branch: worktree-wf_demo-4",
  "Gate: pass",
  "Uncommitted repair: none"
].join("\n");

{
  const run = await runWorkflow({
    args: baseArgs(),
    agents: { ...cleanRunAgents(), exec: EXEC_REPORT }
  });
  const prompt = run.promptFor("confirm:task-1");
  checkIncludes("the whole execute report reaches the confirm prompt, verbatim", prompt, EXEC_REPORT);
  checkIncludes("the confirm prompt is built on the `confirm` prompt section", prompt, "[confirm prompt body]");
  checkIncludes("the confirm prompt carries the run id", prompt, "demo-run-20260102-0304");
  checkIncludes("the confirm prompt carries baseline.base_sha", prompt, "a".repeat(40));
  checkIncludes("the confirm prompt carries baseline.started_at", prompt, "2026-01-02T03:04:05Z");
  checkIncludes("the confirm prompt carries baseline.started_at_epoch", prompt, "1767322445");
  checkIncludes("the confirm prompt carries baseline.dirty_at_start", prompt, " M .gitignore");
  checkIncludes(
    "the confirm prompt carries the task's ref, fully interpolated",
    prompt,
    "refs/task/demo-run-20260102-0304/task-1"
  );
}

for (const [label, report] of [
  ["absent", null],
  ["empty", "   "]
]) {
  const run = await runWorkflow({
    args: baseArgs(),
    agents: { ...cleanRunAgents(), exec: report }
  });
  const prompt = run.promptFor("confirm:task-1");
  checkIncludes(
    `an ${label} execute report is forwarded as an explicitly empty section`,
    prompt,
    "(empty — the execute agent returned no report"
  );
  check(
    `an ${label} execute report never reaches the prompt as the literal word \`null\``,
    typeof prompt === "string" && !prompt.includes("null"),
    prompt
  );
}

// ── Group: identity — both composed gate statements ──────────────────
// Two readings govern the confirm agent, so it receives two statements. Neither
// prompt ever sees the raw verification level: an agent that never receives the
// field cannot apply the wrong default to it.

console.log("\nidentity: both composed gate statements");

const GATE_REQUIRED = "An anchored gate line reporting a **pass** is required of this task.";
const GATE_NOT_REQUIRED = "No anchored gate line is required of this task.";
const NO_OP_AVAILABLE = "The `verified-no-op` outcome is **available** for this task";
const NO_OP_UNAVAILABLE = "The `verified-no-op` outcome is **not available** for this task.";

// Each row: the level to put on the task, whether the step is a multi-task
// parallel one, and the two statements expected.
const gateStatementCases = [
  ["no level field at all", undefined, false, GATE_REQUIRED, NO_OP_AVAILABLE],
  ["an unrecognised level (`file-scoped`)", "file-scoped", false, GATE_REQUIRED, NO_OP_AVAILABLE],
  ["a marked `checkpoint`", "checkpoint", false, GATE_REQUIRED, NO_OP_AVAILABLE],
  ["a marked `scoped` task", "scoped", false, GATE_NOT_REQUIRED, NO_OP_UNAVAILABLE],
  ["an un-marked task that ran in a worktree", undefined, true, GATE_REQUIRED, NO_OP_UNAVAILABLE]
];

for (const [description, level, inWorktree, gateStatement, noOpStatement] of gateStatementCases) {
  const level_field = level === undefined ? {} : { verification_level: level };
  const tasks = inWorktree
    ? [taskFixture("task-1", level_field), taskFixture("task-2", level_field)]
    : [taskFixture("task-1", level_field)];
  const breakdown = breakdownOf([{ parallel: inWorktree, tasks }]);
  const run = await runWorkflow({
    args: baseArgs(),
    agents: {
      ...cleanRunAgents(breakdown),
      confirm: ({ label }) => ({
        state: "verified",
        commit: VERIFIED_HASH,
        branch: `worktree-${label}`,
        rung: "reported-hash",
        summary: "committed"
      }),
      merge: { task_id: "task-1", success: true, commit: "c".repeat(40) }
    }
  });
  const confirmPrompt = run.promptFor("confirm:task-1");
  const execute = run.promptFor("exec:task-1");
  checkIncludes(`${description}: the gate-line requirement`, confirmPrompt, gateStatement);
  checkIncludes(`${description}: the no-op availability`, confirmPrompt, noOpStatement);
  check(
    `${description}: the raw verification level reaches neither prompt`,
    !`${confirmPrompt}${execute}`.includes("file-scoped") &&
      !`${confirmPrompt}${execute}`.includes("verification_level"),
    description
  );
  check(
    `${description}: the execute prompt states one gate demand`,
    typeof execute === "string" &&
      (execute.includes("runs the **full gate suite**") || execute.includes("runs the **scoped** gate")),
    execute
  );
}

// The dispatch fact behind the no-op reading is the checkout, never the
// position: a one-task parallel step is a main-checkout task, and the statement
// must follow the checkout it actually ran on.
{
  const breakdown = breakdownOf([{ parallel: true, tasks: [taskFixture("task-1")] }]);
  const run = await runWorkflow({ args: baseArgs(), agents: cleanRunAgents(breakdown) });
  checkIncludes(
    "a one-task parallel step is a main-checkout task, so the no-op stays available",
    run.promptFor("confirm:task-1"),
    NO_OP_AVAILABLE
  );
  check(
    "a one-task parallel step provisions no worktree",
    run.calls.find((call) => call.label === "exec:task-1")?.opts?.isolation === undefined
  );
}

// ── Group: identity — a verified state with no hash is refused ───────
// Loud failure instead of a fabricated identity. `state: verified` with no
// forty-character hash is the shape that stranded the incident's task, so the
// script refuses the claim rather than carrying it into the registry, the
// integrate step and the result.

console.log("\nidentity: a verified state with no hash is refused");

const refusedConfirms = [
  ["no commit field at all", { state: "verified", rung: "reported-hash", summary: "I am sure it landed." }],
  ["an abbreviated hash", { state: "verified", commit: "b1c2d3e", rung: "reported-hash", summary: "landed" }],
  ["an empty commit field", { state: "verified", commit: "   ", rung: "reported-hash", summary: "landed" }]
];

for (const [description, confirm] of refusedConfirms) {
  const run = await runWorkflow({ args: baseArgs(), agents: { ...cleanRunAgents(), confirm } });
  check(`${description}: the run reports incomplete`, run.result?.complete === false, JSON.stringify(run.result));
  checkIncludes(`${description}: the failure names the task`, run.result?.error, "task-1");
  check(
    `${description}: the refusal reason is logged, naming the state and the missing hash`,
    run.logs.some((line) => line.includes("`verified`") && line.includes("forty-character")),
    run.logs.join(" | ")
  );
  check(
    `${description}: no integrate agent runs for a refused claim`,
    !run.labels.some((label) => label.startsWith("merge:")),
    run.labels.join(",")
  );
}

for (const [description, confirm] of [
  ["a null confirm result", null],
  ["an unrecognised state", { state: "yes", commit: VERIFIED_HASH, summary: "looks fine" }]
]) {
  const run = await runWorkflow({ args: baseArgs(), agents: { ...cleanRunAgents(), confirm } });
  check(`${description} is a failure, not a verified state`, run.result?.complete === false, JSON.stringify(run.result));
}

{
  // The contrast, so the group cannot pass by failing everything: the same run
  // with a real forty-character hash completes and logs no refusal.
  const run = await runWorkflow({ args: baseArgs(), agents: cleanRunAgents() });
  check("a full forty-character hash is accepted", run.result?.complete === true, JSON.stringify(run.result));
  check(
    "an accepted hash logs no refusal",
    !run.logs.some((line) => line.includes("forty-character")),
    run.logs.join(" | ")
  );
}

{
  const confirm = {
    state: "verified",
    commit: "B".repeat(40),
    rung: "reported-hash",
    summary: "committed"
  };
  const run = await runWorkflow({ args: baseArgs(), agents: { ...cleanRunAgents(), confirm } });
  check("a forty-character hash in upper case is accepted", run.result?.complete === true, JSON.stringify(run.result));
}

{
  // `verified-no-op` is a verified state carrying no hash by design, so the
  // refusal must not fire on it — and no integrate step may be built from its
  // missing branch even when it arrives on the parallel arm, which is where a
  // misbehaving agent would put one.
  const breakdown = breakdownOf([
    { parallel: true, tasks: [taskFixture("task-1"), taskFixture("task-2")] }
  ]);
  const run = await runWorkflow({
    args: baseArgs(),
    agents: {
      ...cleanRunAgents(breakdown),
      "confirm:task-1": { state: "verified-no-op", rung: "none", summary: "gate passed, nothing to repair" },
      "confirm:task-2": {
        state: "verified",
        commit: VERIFIED_HASH,
        branch: "worktree-wf_demo-2",
        rung: "reported-hash",
        summary: "committed"
      },
      merge: { task_id: "task-2", success: true, commit: "c".repeat(40) }
    }
  });
  check("a verified no-op with no hash is not refused", run.result?.complete === true, JSON.stringify(run.result));
  checkEqual(
    "no integrate step is built for the no-op, and the sibling still integrates",
    run.labels.filter((label) => label.startsWith("merge:")),
    ["merge:task-2"]
  );
}

// ── Group: identity — integration by commit ──────────────────────────
// The merge prompt is built from the hash the confirm agent verified, with the
// branch as context, and the whole execute-confirm-integrate chain runs on that
// hash. A branch name is a label; a hand-made worktree's is outside any
// convention this run chose.

console.log("\nidentity: the merge prompt is built from the verified hash");

const HASH_ONE = "1".repeat(40);
const HASH_TWO = "2".repeat(40);
const SQUASH_HASH = "e1".repeat(20);

// Two tasks in one parallel step: the only arm that reaches an integrate step
// today, and the arm where a sibling's hash could cross into the wrong prompt.
const twoTaskParallel = () =>
  breakdownOf([{ parallel: true, tasks: [taskFixture("task-1"), taskFixture("task-2")] }]);

const integrationAgents = (overrides = {}) => ({
  ...cleanRunAgents(twoTaskParallel()),
  "confirm:task-1": {
    state: "verified",
    commit: HASH_ONE,
    branch: "worktree-wf_demo-1",
    rung: "reported-hash",
    summary: "committed"
  },
  "confirm:task-2": {
    state: "verified",
    commit: HASH_TWO,
    branch: "worktree-wf_demo-2",
    rung: "subject-search",
    summary: "found by subject"
  },
  merge: ({ label }) => ({
    task_id: label.slice("merge:".length),
    success: true,
    commit: SQUASH_HASH
  }),
  ...overrides
});

{
  const run = await runWorkflow({ args: baseArgs(), agents: integrationAgents() });
  check("no exception escapes the execute-confirm-integrate run", run.error === null, String(run.error));
  check("the run completes", run.result?.complete === true, JSON.stringify(run.result));
  checkEqual(
    "both tasks integrate, one merge agent each",
    run.labels.filter((label) => label.startsWith("merge:")),
    ["merge:task-1", "merge:task-2"]
  );
  for (const id of ["task-1", "task-2"]) {
    const order = ["exec", "confirm", "merge"].map((kind) => run.labels.indexOf(`${kind}:${id}`));
    check(
      `${id}: execute, then confirm, then merge on its hash`,
      order.every((index) => index >= 0) && order[0] < order[1] && order[1] < order[2],
      run.labels.join(",")
    );
  }

  const prompt = run.promptFor("merge:task-1");
  checkIncludes("the merge prompt is built on the `integrate` prompt section", prompt, "[integrate prompt body]");
  checkIncludes(
    "the merge prompt names the verified hash as the commit to merge",
    prompt,
    `## Verified commit\n\`${HASH_ONE}\``
  );
  checkIncludes(
    "the merge prompt carries the branch as context only",
    prompt,
    "`worktree-wf_demo-1` — context only."
  );
  checkIncludes(
    "the merge prompt carries baseline.base_sha, which scopes the landed-work recognition",
    prompt,
    "a".repeat(40)
  );
  checkIncludes("the merge prompt carries the base branch, the other end of that range", prompt, "feature/demo");
  checkIncludes("the merge prompt carries the run id, which keys its ledger line", prompt, "demo-run-20260102-0304");
  check("a sibling's verified hash never reaches the wrong merge prompt", !prompt.includes(HASH_TWO), prompt);
  check(
    "nothing in the merge prompt is left uninterpolated",
    typeof prompt === "string" && !prompt.includes("undefined") && !prompt.includes("${"),
    prompt
  );
  checkIncludes("the sibling's own prompt carries its own hash", run.promptFor("merge:task-2"), HASH_TWO);
}

{
  // A verified commit with no branch reported is still integrable — identity is
  // the hash — so the branch section states its absence rather than interpolating
  // a hole.
  const run = await runWorkflow({
    args: baseArgs(),
    agents: integrationAgents({
      "confirm:task-1": { state: "verified", commit: HASH_ONE, rung: "reported-hash", summary: "committed" }
    })
  });
  const prompt = run.promptFor("merge:task-1");
  checkIncludes(
    "a confirm result with no branch still builds a merge prompt on the hash",
    prompt,
    "(none — the confirm agent reported no branch."
  );
  check(
    "a missing branch never reaches the merge prompt as `undefined`",
    typeof prompt === "string" && !prompt.includes("undefined"),
    prompt
  );
}

// ── Group: identity — an integration with no fixed point ─────────────
// The squash commit is teardown's fixed comparison point. A merge result
// claiming success without one is recorded as an integration with no fixed point
// and is NOT retried: `integrateTask` is the one agent in the run whose re-run is
// not idempotent, so a retry would report a landed integration as failed.

console.log("\nidentity: a success with no squash commit is an integration with no fixed point");

const noFixedPointMerges = [
  ["no commit field at all", ({ label }) => ({ task_id: label.slice("merge:".length), success: true })],
  [
    "an abbreviated squash commit",
    ({ label }) => ({ task_id: label.slice("merge:".length), success: true, commit: "e1e1e1e" })
  ],
  [
    "an empty commit field",
    ({ label }) => ({ task_id: label.slice("merge:".length), success: true, commit: "   " })
  ]
];

for (const [description, merge] of noFixedPointMerges) {
  const run = await runWorkflow({ args: baseArgs(), agents: integrationAgents({ merge }) });
  check(
    `${description}: the integration is recorded, not failed`,
    run.result?.complete === true,
    JSON.stringify(run.result)
  );
  check(
    `${description}: the no-fixed-point recording names the task`,
    run.logs.some((line) => line.includes("task-1") && line.includes("no fixed point")),
    run.logs.join(" | ")
  );
  checkEqual(
    `${description}: the merge agent is not retried`,
    run.labels.filter((label) => label === "merge:task-1"),
    ["merge:task-1"]
  );
  checkEqual(
    `${description}: the result carries the integration with its marker`,
    (run.result?.integrations || []).find((entry) => entry.task_id === "task-1"),
    { task_id: "task-1", commit: null, no_fixed_point: true }
  );
  check(
    `${description}: it landed, so it is not listed as built and not integrated`,
    !(run.result?.built_not_integrated || []).some((entry) => entry.task_id === "task-1"),
    JSON.stringify(run.result?.built_not_integrated)
  );
}

{
  // The contrast, so the group cannot pass by marking every integration
  // fixed-point-less.
  const run = await runWorkflow({ args: baseArgs(), agents: integrationAgents() });
  check(
    "a forty-character squash commit records no no-fixed-point marker",
    !run.logs.some((line) => line.includes("no fixed point")),
    run.logs.join(" | ")
  );
}

{
  // A failed integration is not an integration with no fixed point. The two
  // outcomes share one schema, which is why the marker keys on `success`.
  const run = await runWorkflow({
    args: baseArgs(),
    agents: integrationAgents({
      "merge:task-1": { task_id: "task-1", success: false, error: "the base did not build after the merge" }
    })
  });
  checkIncludes("a failed integration names the task in the run's error", run.result?.error, "task-1");
  check(
    "a failed integration is not recorded as an integration with no fixed point",
    !run.logs.some((line) => line.includes("no fixed point")),
    run.logs.join(" | ")
  );
}

// ── Group: identity — no merge prompt from a missing hash ─────────────
// The counterpart on the integrate side of the confirm-side refusal: no prompt is
// ever composed from a missing identity. The corrective path used to reach the
// refusal with its own guard — `isVerifiedState(r) && r.branch` — which is the
// third re-implementation the unified path removes, so the shape below now takes
// the same no-op skip the worktree arm takes. What is asserted is the property
// both paths have to hold: a corrective task with no verified hash runs no merge
// agent.

console.log("\nidentity: no merge prompt is built from a missing hash");
{
  let round = 0;
  const run = await runWorkflow({
    args: baseArgs(),
    agents: {
      ...cleanRunAgents(oneTaskBreakdown()),
      verify: () => {
        round += 1;
        return round === 1
          ? {
              all_complete: false,
              test_passed: false,
              deliverables: [{ description: "the widget", status: "gap", evidence: "absent" }],
              corrective_tasks: [taskFixture("fix-1")]
            }
          : { all_complete: true, test_passed: true, deliverables: [] };
      },
      "confirm:fix-1": {
        state: "verified-no-op",
        branch: "worktree-wf_demo-fix",
        rung: "none",
        summary: "gate passed, nothing to repair"
      },
      merge: ({ label }) => ({
        task_id: label.slice("merge:".length),
        success: true,
        commit: SQUASH_HASH
      })
    }
  });
  check("the corrective round ran", run.labels.includes("exec:fix-1"), run.labels.join(","));
  check(
    "a corrective task carrying a branch but no verified hash runs no merge agent",
    !run.labels.includes("merge:fix-1"),
    run.labels.join(",")
  );
  check(
    "the skip is logged, naming the task and the absent integration",
    run.logs.some((line) => line.includes("fix-1") && line.includes("nothing to integrate")),
    run.logs.join(" | ")
  );
  check(
    "a corrective no-op does not end the corrective loop",
    run.labels.includes("verify:2") && run.result?.complete === true,
    JSON.stringify(run.result)
  );
}

// ── Group: the no-op is available to a corrective task ────────────────
// Eligibility is `runsFullGate && (ranOnMainCheckout || isCorrective)`, and the
// second disjunct exists for one shape the checkout alone gets wrong. A
// corrective task always dispatches into a worktree and is always un-marked, so
// on the checkout alone it is asked for a gate line and denied the no-op at the
// same time. A corrective task authored for a gap that turns out already filled
// then has no reportable outcome but `failed`, which halts the loop and blocks
// the corrective tasks after it — the phantom-failure class this change removes.
//
// The feature-task direction has to stay closed, so both are asserted off one
// run: the corrective task is offered the no-op, its un-marked worktree sibling
// in the ordinary steps is not.

console.log("\nthe no-op is available to a corrective task, not to a worktree feature task");
{
  const prompts = {};
  let round = 0;
  const run = await runWorkflow({
    args: baseArgs(),
    agents: {
      ...cleanRunAgents(
        breakdownOf([
          {
            parallel: true,
            tasks: [taskFixture("task-1"), taskFixture("task-2")]
          }
        ])
      ),
      "confirm:task-1": ({ prompt }) => {
        prompts["task-1"] = prompt;
        return {
          state: "verified",
          commit: VERIFIED_HASH,
          branch: "worktree-wf_demo-1",
          rung: "reported-hash",
          summary: "landed"
        };
      },
      "confirm:task-2": ({ prompt }) => {
        prompts["task-2"] = prompt;
        return {
          state: "verified",
          commit: VERIFIED_HASH,
          branch: "worktree-wf_demo-2",
          rung: "reported-hash",
          summary: "landed"
        };
      },
      verify: () => {
        round += 1;
        return round === 1
          ? {
              all_complete: false,
              test_passed: false,
              deliverables: [{ description: "the widget", status: "gap", evidence: "absent" }],
              corrective_tasks: [taskFixture("fix-1")]
            }
          : { all_complete: true, test_passed: true, deliverables: [] };
      },
      "confirm:fix-1": ({ prompt }) => {
        prompts["fix-1"] = prompt;
        return {
          state: "verified-no-op",
          rung: "none",
          summary: "gate passed, the gap was already filled"
        };
      },
      merge: ({ label }) => ({
        task_id: label.slice("merge:".length),
        success: true,
        commit: SQUASH_HASH
      })
    }
  });

  check(
    "the corrective task is offered the verified-no-op outcome",
    /verified-no-op` outcome is \*\*available\*\*/.test(prompts["fix-1"] || ""),
    (prompts["fix-1"] || "").slice(0, 200)
  );
  check(
    "an un-marked feature task in a worktree is still denied it",
    /verified-no-op` outcome is \*\*not available\*\*/.test(prompts["task-1"] || ""),
    (prompts["task-1"] || "").slice(0, 200)
  );
  check(
    "both are still asked for a gate line, since both read as full-gate",
    /gate line reporting a \*\*pass\*\* is required/.test(prompts["fix-1"] || "") &&
      /gate line reporting a \*\*pass\*\* is required/.test(prompts["task-1"] || ""),
    "fix-1 and task-1 gate-line statements"
  );
  check(
    "the corrective no-op leaves the run complete rather than halting it",
    run.result?.complete === true && (run.result?.failed || []).length === 0,
    JSON.stringify(run.result?.failed)
  );
}

// ── Fixtures: whole runs with a shape worth blocking over ────────────
// One run per mechanism, each built from steps rather than from one task, because
// every blocking rule is a statement about an *earlier* task.

const taskHashes = new Map();

// A distinct forty-character hash per key, so a hash in the result identifies the
// task it came from.
function hashFor(key) {
  if (!taskHashes.has(key)) {
    taskHashes.set(
      key,
      (taskHashes.size + 1).toString(16).padStart(2, "0").repeat(20)
    );
  }
  return taskHashes.get(key);
}

const parallelStep = (tasks) => ({ parallel: true, tasks });
const sequentialStep = (task) => ({ parallel: false, tasks: [task] });
const checkpointTask = (id, overrides = {}) =>
  taskFixture(id, { verification_level: "checkpoint", ...overrides });
const scopedTask = (id, overrides = {}) =>
  taskFixture(id, { verification_level: "scoped", ...overrides });

// The execute agent's prose, carrying the anchored lines the confirm agent reads.
// The hash is here as well as in the confirm result, which is what makes the
// forty characters greppable in a failure result through `agent_text`.
const execReportFor = ({ label }) => {
  const id = label.slice("exec:".length);
  return [
    `Did the ${id} work.`,
    `Commit: ${hashFor(id)}`,
    `Branch: worktree-${id}`,
    "Gate: pass",
    "Uncommitted repair: none"
  ].join("\n");
};

// Verified by default, one hash and one branch per task. An override names the
// tasks whose confirm reports something else.
const confirmByTask = (overrides = {}) => ({ label }) => {
  const id = label.slice("confirm:".length);
  if (Object.prototype.hasOwnProperty.call(overrides, id)) return overrides[id];
  return {
    state: "verified",
    commit: hashFor(id),
    branch: `worktree-${id}`,
    rung: "reported-hash",
    summary: `${id} committed`
  };
};

const mergeByTask = (overrides = {}) => ({ label }) => {
  const id = label.slice("merge:".length);
  if (Object.prototype.hasOwnProperty.call(overrides, id)) return overrides[id];
  return { task_id: id, success: true, commit: hashFor(`squash:${id}`) };
};

const isolationAgents = ({ steps, confirms = {}, merges = {}, verify } = {}) => ({
  decompose: breakdownOf(steps),
  exec: execReportFor,
  confirm: confirmByTask(confirms),
  merge: mergeByTask(merges),
  verify: verify ?? { all_complete: true, test_passed: true, deliverables: [] },
  retrospective: "No cross-cutting friction."
});

const ranInWorktree = (run, id) =>
  run.calls.find((call) => call.label === `exec:${id}`)?.opts?.isolation === "worktree";

const blockedBy = (run, id) =>
  (run.result?.blocked || []).find((entry) => entry.task_id === id)?.blocked_by;

const failedEntry = (run, id) =>
  (run.result?.failed || []).find((entry) => entry.task_id === id);

const READ_ONLY_PASS = "This pass is **read-only**.";
const ORDINARY_PASS = "This pass is the ordinary one.";

// ── Group: isolation — one integrate failure cancels nothing else ─────
// The filed incident, and the loudest line of it: one task's failure cancelled
// seven unrelated tasks. Here one integration fails in a three-task parallel step
// and every independent task in the run still runs, integrates and is reported.

console.log("\nisolation: one integrate failure does not cancel independent work");
{
  const run = await runWorkflow({
    args: baseArgs(),
    agents: isolationAgents({
      steps: [
        parallelStep([scopedTask("task-1"), scopedTask("task-2"), scopedTask("task-3")]),
        parallelStep([scopedTask("task-4"), scopedTask("task-5")]),
        sequentialStep(checkpointTask("check-final"))
      ],
      merges: {
        "task-1": {
          task_id: "task-1",
          success: false,
          error: "the base did not build after the merge"
        }
      },
      verify: {
        all_complete: false,
        test_passed: false,
        deliverables: [{ description: "the widget", status: "gap", evidence: "absent" }],
        corrective_tasks: [taskFixture("fix-1")]
      }
    })
  });

  check("no exception escapes the run", run.error === null, String(run.error));
  checkEqual(
    "the failed integration's siblings still integrate, and so does the next step's work",
    run.labels.filter((label) => label.startsWith("merge:")),
    ["merge:task-1", "merge:task-2", "merge:task-3", "merge:task-4", "merge:task-5"]
  );
  checkEqual(
    "every independent task still executes",
    ["task-1", "task-2", "task-3", "task-4", "task-5"].filter((id) =>
      run.labels.includes(`exec:${id}`)
    ),
    ["task-1", "task-2", "task-3", "task-4", "task-5"]
  );

  const failed = failedEntry(run, "task-1");
  checkEqual("the failed list holds exactly the failed task", (run.result?.failed || []).map((e) => e.task_id), [
    "task-1"
  ]);
  checkEqual("its stage is the integrate stage", failed?.stage, "integrate");
  checkIncludes("its reason is the merge agent's own", failed?.reason, "did not build");
  checkIncludes("its verbatim execute text reaches the result", failed?.agent_text, "Did the task-1 work.");
  check(
    "the full forty-character hash is greppable in the failure result",
    JSON.stringify(run.result).includes(hashFor("task-1")),
    JSON.stringify(run.result?.failed)
  );

  checkEqual(
    "work built and not integrated is listed with its commit, branch and ref",
    run.result?.built_not_integrated,
    [
      {
        task_id: "task-1",
        title: "Task task-1",
        commit: hashFor("task-1"),
        branch: "worktree-task-1",
        ref: "refs/task/demo-run-20260102-0304/task-1",
        ref_moved: false
      }
    ]
  );
  checkEqual(
    "every landed integration is listed with its squash commit",
    (run.result?.integrations || []).map((entry) => `${entry.task_id}:${entry.commit}`),
    ["task-2", "task-3", "task-4", "task-5"].map((id) => `${id}:${hashFor(`squash:${id}`)}`)
  );

  checkEqual("the final checkpoint is blocked, not failed", (run.result?.blocked || []).map((e) => e.task_id), [
    "check-final"
  ]);
  checkEqual("it names the task that blocked it", blockedBy(run, "check-final"), "task-1");
  check("the blocked checkpoint runs no agent", !run.labels.includes("exec:check-final"), run.labels.join(","));
  checkIncludes(
    "the result states the base was never fully verified, beside the blocked list",
    run.result?.base_never_fully_verified,
    "check-final was blocked by task-1"
  );
  check("the run reports failure", run.result?.complete === false, JSON.stringify(run.result?.complete));
  checkIncludes("the error names the failed task", run.result?.error, "task-1 failed");
  checkIncludes("the error names the blocked task separately", run.result?.error, "check-final blocked");
  checkEqual("the ledger path is in the result", run.result?.ledger_path, ".tasks/demo-run-20260102-0304/ledger.jsonl");

  checkEqual("the completeness check runs exactly once", run.labels.filter((l) => l.startsWith("verify:")), [
    "verify:1"
  ]);
  checkIncludes("its pass is read-only", run.promptFor("verify:1"), READ_ONLY_PASS);
  check(
    "the corrective task it returned anyway is ignored",
    !run.labels.includes("exec:fix-1"),
    run.labels.join(",")
  );
  checkEqual(
    "the completeness report reaches the result",
    run.result?.completeness?.deliverables?.[0]?.status,
    "gap"
  );
}

// The contrast, so the group cannot pass by reporting every run broken.
{
  const run = await runWorkflow({
    args: baseArgs(),
    agents: isolationAgents({
      steps: [
        parallelStep([scopedTask("task-1"), scopedTask("task-2")]),
        sequentialStep(checkpointTask("check-final"))
      ]
    })
  });
  check("a healthy run still completes", run.result?.complete === true, JSON.stringify(run.result));
  checkEqual("with nothing failed", run.result?.failed, []);
  checkEqual("with nothing blocked", run.result?.blocked, []);
  checkEqual(
    "and no base-never-fully-verified statement",
    run.result?.base_never_fully_verified,
    null
  );
  check("its final checkpoint runs", run.labels.includes("exec:check-final"), run.labels.join(","));
  checkIncludes("its completeness pass is the ordinary one", run.promptFor("verify:1"), ORDINARY_PASS);
  check("a healthy run reports no error", run.result?.error === undefined, JSON.stringify(run.result?.error));
}

// ── Group: isolation — a failed main-checkout task blocks the base ────
// It commits onto the shared base, so everything after it either commits onto
// that base or branches from it.

console.log("\nisolation: a failed main-checkout task blocks what builds on the base");
{
  const run = await runWorkflow({
    args: baseArgs(),
    agents: isolationAgents({
      steps: [
        sequentialStep(scopedTask("main-1")),
        sequentialStep(scopedTask("main-2")),
        parallelStep([scopedTask("wt-1"), scopedTask("wt-2")]),
        sequentialStep(checkpointTask("check-final"))
      ],
      confirms: {
        "main-1": { state: "failed", rung: "none", summary: "no commit carries the task id" }
      }
    })
  });
  checkEqual(
    "only the failed task ever executes",
    run.labels.filter((label) => label.startsWith("exec:")),
    ["exec:main-1"]
  );
  checkEqual(
    "the later main-checkout task, both worktree tasks and the checkpoint are blocked",
    (run.result?.blocked || []).map((entry) => entry.task_id),
    ["main-2", "wt-1", "wt-2", "check-final"]
  );
  checkEqual("each names the same blocking task", blockedBy(run, "wt-2"), "main-1");
  checkEqual("the failed task is failed at the confirm stage", failedEntry(run, "main-1")?.stage, "confirm");
  checkIncludes(
    "its reason is the confirm agent's own words",
    failedEntry(run, "main-1")?.reason,
    "no commit carries the task id"
  );
  check(
    "blocked and failed are distinct states",
    (run.result?.failed || []).length === 1 && (run.result?.blocked || []).length === 4,
    JSON.stringify(run.result)
  );
  check("the run still reports failure", run.result?.complete === false);
  check("no integration is attempted", !run.labels.some((l) => l.startsWith("merge:")), run.labels.join(","));
}

// ── Group: isolation — a blocked checkpoint cancels nothing after it ──
// The asymmetry the design turns on. A blocked checkpoint never ran, so it left
// the base exactly as it found it; breakdown authors one at every milestone the
// plan names, so propagating from a blocked one would cancel every task past the
// first failure — the incident again, one milestone along.

console.log("\nisolation: a blocked checkpoint blocks nothing, a failed one blocks everything");
{
  const run = await runWorkflow({
    args: baseArgs(),
    agents: isolationAgents({
      steps: [
        parallelStep([scopedTask("wt-a"), scopedTask("wt-b")]),
        sequentialStep(checkpointTask("mid-check")),
        parallelStep([scopedTask("wt-c"), scopedTask("wt-d")]),
        sequentialStep(checkpointTask("check-final"))
      ],
      confirms: {
        "wt-a": { state: "failed", branch: "worktree-wt-a", rung: "none", summary: "gate reported a fail" }
      }
    })
  });
  checkEqual("the intermediate checkpoint is blocked by the failed task", blockedBy(run, "mid-check"), "wt-a");
  check(
    "the worktree work after the blocked checkpoint still runs",
    run.labels.includes("exec:wt-c") && run.labels.includes("exec:wt-d"),
    run.labels.join(",")
  );
  check(
    "and still integrates",
    run.labels.includes("merge:wt-c") && run.labels.includes("merge:wt-d"),
    run.labels.join(",")
  );
  check(
    "a failed worktree sibling blocks no undeclared worktree task",
    blockedBy(run, "wt-b") === undefined && run.labels.includes("exec:wt-b"),
    JSON.stringify(run.result?.blocked)
  );
  checkEqual(
    "the later checkpoint is blocked all the same — that rule wins",
    blockedBy(run, "check-final"),
    "wt-a"
  );
  checkEqual(
    "exactly the two checkpoints are blocked",
    (run.result?.blocked || []).map((entry) => entry.task_id),
    ["mid-check", "check-final"]
  );
}

{
  // The other arm: a *failed* checkpoint propagates, and the statement sits
  // beside the failed list.
  const run = await runWorkflow({
    args: baseArgs(),
    agents: isolationAgents({
      steps: [
        sequentialStep(checkpointTask("mid-check")),
        parallelStep([scopedTask("wt-1"), scopedTask("wt-2")]),
        sequentialStep(scopedTask("main-2"))
      ],
      confirms: {
        "mid-check": { state: "failed", rung: "none", summary: "Gate: fail — two tests still red" }
      }
    })
  });
  checkEqual(
    "a failed checkpoint blocks every later worktree and main-checkout task",
    (run.result?.blocked || []).map((entry) => entry.task_id),
    ["wt-1", "wt-2", "main-2"]
  );
  checkIncludes(
    "the base-never-fully-verified statement sits beside the failed list too",
    run.result?.base_never_fully_verified,
    "mid-check failed at the confirm stage"
  );
}

{
  // `blocksRunWide`'s final-task arm: an un-marked final task that fails still
  // reaches the propagation rule and the statement.
  const run = await runWorkflow({
    args: baseArgs(),
    agents: isolationAgents({
      steps: [
        parallelStep([scopedTask("task-1"), scopedTask("task-2")]),
        sequentialStep(taskFixture("task-3"))
      ],
      confirms: {
        "task-3": { state: "failed", rung: "none", summary: "Gate: fail" }
      }
    })
  });
  checkIncludes(
    "an un-marked final task that fails is reported as an unverified base",
    run.result?.base_never_fully_verified,
    "task-3 failed at the confirm stage"
  );
  check("its siblings are untouched", (run.result?.blocked || []).length === 0, JSON.stringify(run.result?.blocked));
}

{
  // The same arm reaching the *blocking* rules. An un-marked final task packed
  // into a multi-task parallel step is blocked by any earlier failure at all,
  // where its own worktree siblings in the same step, declaring nothing, run.
  // The blocked sibling ahead of it is what pins the ordering: blocking is
  // evaluated for the whole step before any of it is recorded, so the final task
  // names the failure that started this and not the sibling beside it.
  const run = await runWorkflow({
    args: baseArgs(),
    agents: isolationAgents({
      steps: [
        parallelStep([scopedTask("wt-a"), scopedTask("wt-b")]),
        parallelStep([
          scopedTask("wt-c", { depends_on: ["wt-a"] }),
          scopedTask("wt-d"),
          taskFixture("wt-final")
        ])
      ],
      confirms: {
        "wt-a": { state: "failed", branch: "worktree-wt-a", rung: "none", summary: "nothing committed" }
      }
    })
  });
  check(
    "an ordinary worktree task in the later step runs",
    run.labels.includes("exec:wt-d"),
    run.labels.join(",")
  );
  checkEqual(
    "the un-marked final task beside it is blocked, on the final-task arm alone",
    blockedBy(run, "wt-final"),
    "wt-a"
  );
  checkEqual(
    "a blocked sibling ahead of it in its own step is not what blocked it",
    blockedBy(run, "wt-c"),
    "wt-a"
  );
  checkIncludes(
    "and the result states the base was never fully verified",
    run.result?.base_never_fully_verified,
    "wt-final was blocked by wt-a"
  );
}

// ── Group: isolation — declared edges ────────────────────────────────
// A worktree task is blocked by its declared ancestors and by nothing else in a
// worktree. An id naming no task in the run is logged and ignored, because
// aborting a run over a breakdown typo is the over-blocking the optional field
// exists to avoid.

console.log("\nisolation: depends_on blocks the declared, ignores the unknown");
{
  const run = await runWorkflow({
    args: baseArgs(),
    agents: isolationAgents({
      steps: [
        parallelStep([scopedTask("wt-a"), scopedTask("wt-b")]),
        parallelStep([
          scopedTask("wt-c", { depends_on: ["wt-a"] }),
          scopedTask("wt-d", { depends_on: ["ghost-task"] })
        ]),
        parallelStep([scopedTask("wt-e"), scopedTask("wt-f")]),
        sequentialStep(checkpointTask("check-final"))
      ],
      confirms: {
        "wt-a": { state: "failed", branch: "worktree-wt-a", rung: "none", summary: "nothing committed" }
      }
    })
  });
  checkEqual("a declared ancestor's failure blocks the task", blockedBy(run, "wt-c"), "wt-a");
  check(
    "a task declaring an unknown id still runs",
    run.labels.includes("exec:wt-d") && blockedBy(run, "wt-d") === undefined,
    JSON.stringify(run.result?.blocked)
  );
  check(
    "the unknown id is logged once, naming the task and the id",
    run.logs.filter((line) => line.includes("ghost-task")).length === 1,
    run.logs.filter((line) => line.includes("ghost-task")).join(" | ")
  );
  check(
    "a blocked sibling does not move the survivor off its worktree",
    ranInWorktree(run, "wt-d"),
    JSON.stringify(run.calls.find((call) => call.label === "exec:wt-d")?.opts)
  );
  // A *blocked* worktree task is not a main-checkout task. It was never going to
  // touch the shared base, so the step after it runs — and the checkout that
  // decides this is read from the step list, because the record of a task that
  // ran nowhere says `ran_in_worktree: false`.
  check(
    "the step after a blocked worktree task still runs in worktrees",
    run.labels.includes("exec:wt-e") && ranInWorktree(run, "wt-e"),
    `${run.labels.join(",")} | ${JSON.stringify(run.result?.blocked)}`
  );
  checkEqual(
    "and only the declared dependant and the checkpoint are blocked",
    (run.result?.blocked || []).map((entry) => entry.task_id),
    ["wt-c", "check-final"]
  );
}

// ── Group: the classifier's checkpoint conjunct ───────────────────────
// A multi-task parallel step holding a marked checkpoint is exactly a step that
// fails the worktree test, so the existing sequential arm runs it. One conjunct,
// no second code path — and it reads the marking alone, so an un-marked plan
// still dispatches worktrees.

console.log("\nthe classifier: a marked checkpoint demotes its whole step");
{
  const run = await runWorkflow({
    args: baseArgs(),
    agents: isolationAgents({
      steps: [parallelStep([scopedTask("task-1"), checkpointTask("check-1")])]
    })
  });
  check("both tasks run", run.labels.includes("exec:task-1") && run.labels.includes("exec:check-1"));
  check(
    "neither runs in a worktree",
    !ranInWorktree(run, "task-1") && !ranInWorktree(run, "check-1"),
    JSON.stringify(run.calls.filter((c) => c.label.startsWith("exec:")).map((c) => c.opts))
  );
  check(
    "so no integrate step runs — a main-checkout commit is already on the base",
    !run.labels.some((label) => label.startsWith("merge:")),
    run.labels.join(",")
  );
  check(
    "the demotion is logged with its reason",
    run.logs.some((line) => line.includes("demoted to sequential") && line.includes("checkpoint")),
    run.logs.join(" | ")
  );
  checkIncludes(
    "the demoted checkpoint's confirm agent is told the no-op is available",
    run.promptFor("confirm:check-1"),
    NO_OP_AVAILABLE
  );
}

{
  // The conjunct reads the marking and nothing else: an un-marked plan's parallel
  // steps still get worktrees, which is what the depth default would have taken
  // away.
  const run = await runWorkflow({
    args: baseArgs(),
    agents: isolationAgents({
      steps: [parallelStep([taskFixture("task-1"), taskFixture("task-2")])]
    })
  });
  check(
    "an un-marked multi-task parallel step still runs in worktrees",
    ranInWorktree(run, "task-1") && ranInWorktree(run, "task-2"),
    JSON.stringify(run.calls.filter((c) => c.label.startsWith("exec:")).map((c) => c.opts))
  );
}

{
  // Everything else runs on the main checkout, and "everything else" includes a
  // one-task parallel step: the dispatch condition is the script's own — parallel
  // and more than one task — and one task is not more than one. This is also the
  // first half of why two cells of the shape matrix below are unreachable: a
  // worktree needs a multi-task parallel step, and such a step holding a marked
  // checkpoint is demoted out of one.
  const run = await runWorkflow({
    args: baseArgs(),
    agents: isolationAgents({
      steps: [
        { parallel: true, tasks: [scopedTask("only-1")] },
        sequentialStep(checkpointTask("check-final"))
      ]
    })
  });
  check(
    "a one-task parallel step runs on the main checkout",
    ranInWorktree(run, "only-1") === false,
    JSON.stringify(run.calls.find((call) => call.label === "exec:only-1")?.opts)
  );
  check(
    "so it runs no integrate agent — its commit is already on the base",
    !run.labels.includes("merge:only-1"),
    run.labels.join(",")
  );
  check(
    "and it is not reported as a demotion, because it never qualified for a worktree",
    !run.logs.some((line) => line.includes("demoted to sequential")),
    run.logs.join(" | ")
  );
}

// ── Group: the corrective loop ends on a failed corrective task ───────
// The same two helpers as the parallel path, so the corrective path carries the
// same obligations. A corrective task that ends unverified — or whose integration
// fails — ends the loop, and the corrective tasks after it are recorded blocked
// rather than dropped.

console.log("\nsuppression: a failed corrective task ends the corrective loop");

const twoCorrectiveRounds = (verifyOverride = {}) => {
  let round = 0;
  return () => {
    round += 1;
    return round === 1
      ? {
          all_complete: false,
          test_passed: false,
          deliverables: [{ description: "the widget", status: "gap", evidence: "absent" }],
          corrective_tasks: [taskFixture("fix-1"), taskFixture("fix-2")],
          ...verifyOverride
        }
      : { all_complete: true, test_passed: true, deliverables: [] };
  };
};

for (const [description, overrides] of [
  [
    "a corrective task whose confirm fails",
    { confirms: { "fix-1": { state: "failed", rung: "none", summary: "nothing committed" } } }
  ],
  [
    "a corrective task whose integration fails",
    { merges: { "fix-1": { task_id: "fix-1", success: false, error: "the base did not build" } } }
  ]
]) {
  const run = await runWorkflow({
    args: baseArgs(),
    agents: isolationAgents({
      steps: [sequentialStep(scopedTask("task-1"))],
      verify: twoCorrectiveRounds(),
      ...overrides
    })
  });
  check(`${description}: the first corrective task ran`, run.labels.includes("exec:fix-1"), run.labels.join(","));
  check(
    `${description}: the second never runs`,
    !run.labels.includes("exec:fix-2"),
    run.labels.join(",")
  );
  checkEqual(`${description}: the second is recorded blocked by the first`, blockedBy(run, "fix-2"), "fix-1");
  check(`${description}: the first is in the failed list`, !!failedEntry(run, "fix-1"), JSON.stringify(run.result?.failed));
  checkEqual(
    `${description}: no second corrective round runs`,
    run.labels.filter((label) => label.startsWith("verify:")),
    ["verify:1"]
  );
  check(`${description}: the run reports incomplete`, run.result?.complete === false, JSON.stringify(run.result));
}

{
  // The contrast: a corrective task that lands does not end the loop, and the
  // second round is the ordinary pass because nothing is failed or blocked.
  const run = await runWorkflow({
    args: baseArgs(),
    agents: isolationAgents({
      steps: [sequentialStep(scopedTask("task-1"))],
      verify: twoCorrectiveRounds()
    })
  });
  checkEqual(
    "both corrective tasks run and both integrate",
    run.labels.filter((label) => label.startsWith("merge:")),
    ["merge:fix-1", "merge:fix-2"]
  );
  check("the loop reaches its second round", run.labels.includes("verify:2"), run.labels.join(","));
  checkIncludes("that round is still the ordinary pass", run.promptFor("verify:2"), ORDINARY_PASS);
  check("the run completes", run.result?.complete === true, JSON.stringify(run.result));
}

// ── Group: teardown runs on every exit path, with its five inputs ─────
// Two mechanisms, and the first is why the incident nearly lost a commit: the old
// teardown returned before doing anything when no task reported a branch, so a run
// with no worktree closed no ledger and a task whose branch was never captured was
// invisible to it. It now runs unconditionally and is handed the five inputs it
// cannot derive.

console.log("\nteardown: it runs on every exit path");
{
  const run = await runWorkflow({ args: baseArgs(), agents: cleanRunAgents() });
  check("a run with no worktree task still reaches teardown", run.labels.includes("teardown"), run.labels.join(","));
  checkEqual("teardown is the last agent of the run", run.labels[run.labels.length - 1], "teardown");
}

{
  // A run that failed still tears down: the step loop has no failure exit left,
  // and a failed run is the one whose trees most need reporting.
  const run = await runWorkflow({
    args: baseArgs(),
    agents: isolationAgents({
      steps: [
        parallelStep([scopedTask("wt-1"), scopedTask("wt-2")]),
        sequentialStep(checkpointTask("check-final"))
      ],
      confirms: {
        "wt-1": { state: "failed", branch: "worktree-wt-1", rung: "none", summary: "nothing committed" }
      }
    })
  });
  check("a failed run still reaches teardown", run.labels.includes("teardown"), run.labels.join(","));
  const prompt = run.promptFor("teardown");
  checkIncludes("the failed task is named under `## Failed tasks`", prompt, "- `wt-1` — failed at the confirm stage");
  checkIncludes("the blocked task is named with its blocker", prompt, "- `check-final` — blocked by `wt-1`");
}

console.log("\nteardown: the prompt carries its five inputs");
{
  const run = await runWorkflow({
    args: baseArgs(),
    agents: isolationAgents({
      steps: [
        parallelStep([scopedTask("wt-1"), scopedTask("wt-2")]),
        sequentialStep(scopedTask("main-1"))
      ],
      confirms: {
        // The leak's own shape: a worktree task whose confirm captured no branch
        // name. The old teardown could not see it at all.
        "wt-2": { state: "verified", commit: hashFor("wt-2"), rung: "reported-hash", summary: "committed" }
      },
      merges: {
        // An integration that reported success with no forty-character commit:
        // teardown needs the fact, because its fallback has to name that case
        // rather than read it as an absent integration.
        "wt-2": { task_id: "wt-2", success: true }
      }
    })
  });
  const prompt = run.promptFor("teardown");

  checkIncludes("input 1: the teardown prompt is built on the `teardown` section", prompt, "[teardown prompt body]");
  checkIncludes("input 1: the run id", prompt, "Run ID: `demo-run-20260102-0304`");
  checkIncludes("input 2: baseline.base_sha, the tie rule's comparison base", prompt, "a".repeat(40));
  checkIncludes("input 2: baseline.started_at_epoch, which the date test reads", prompt, "1767322445");
  checkIncludes("input 3: the tasks section", prompt, "## This run's tasks");
  checkIncludes(
    "input 3: a worktree task with the branch a confirm agent captured",
    prompt,
    "- `wt-1` — ran in a worktree; branch `worktree-wt-1`"
  );
  checkIncludes(
    "input 3: a worktree task whose branch was never captured is listed as exactly that",
    prompt,
    "- `wt-2` — ran in a worktree; no branch name was captured for it"
  );
  checkIncludes(
    "input 3: a main-checkout task is listed with no branch of its own",
    prompt,
    "- `main-1` — ran on the main checkout; no branch of its own"
  );
  checkIncludes("input 4: the recorded squash commit is the check's fixed point", prompt, `integrated at \`${hashFor("squash:wt-1")}\``);
  checkIncludes(
    "input 4: an integration with no fixed point is named as that case",
    prompt,
    "- `wt-2` — integrated, and the integration reported no squash commit, so it has no fixed point"
  );
  checkIncludes("input 5: the failed list", prompt, "## Failed tasks");
  checkIncludes("input 5: the blocked list", prompt, "## Blocked tasks");
  check(
    "nothing in the teardown prompt is left uninterpolated",
    typeof prompt === "string" && !prompt.includes("undefined") && !prompt.includes("${"),
    prompt
  );
}

{
  // On a run with no worktrees every section is still there, saying so — the shape
  // B7's matrix asserts against and the one the old early return skipped entirely.
  const run = await runWorkflow({ args: baseArgs(), agents: cleanRunAgents() });
  const prompt = run.promptFor("teardown");
  checkIncludes(
    "with no worktree, the tasks section still names the run's one task",
    prompt,
    "- `task-1` — ran on the main checkout; no branch of its own"
  );
  checkIncludes(
    "with nothing integrated, the integrations section says so",
    prompt,
    "(none — no task's work was integrated in this run)"
  );
  checkIncludes("with nothing failed, the failed section says so", prompt, "## Failed tasks\n(none)");
  checkIncludes("with nothing blocked, the blocked section says so", prompt, "## Blocked tasks\n(none)");
}

console.log("\nteardown: the grown result, and what the script does with it");
{
  // Per-entry records, not name lists: a kept branch's reason is the whole safety
  // argument, and the operator watching the run has to see a kept tree at the
  // moment it is kept.
  const run = await runWorkflow({
    args: baseArgs(),
    agents: {
      ...cleanRunAgents(),
      teardown: {
        worktrees: [
          { path: "/tmp/wt-a", branch: "worktree-wt-a", removed: false, dirty_files: 3, reason: "dirty: the task halted" },
          { path: "/tmp/wt-b", branch: "worktree-wt-b", removed: true, dirty_files: 0, reason: "clean" }
        ],
        branches: [
          { branch: "worktree-wt-a", task_id: "wt-a", deleted: false, reason: "touched paths are not identical in the squash commit" },
          { branch: "worktree-wt-b", task_id: "wt-b", deleted: true, reason: "content landed" }
        ],
        untied: [{ entry: "worktree-wf_older-run-8", reason: "tip predates started_at_epoch" }],
        errors: ["branch -D refused: still used by worktree"]
      }
    }
  });
  const schema = run.calls.find((call) => call.label === "teardown")?.opts?.schema;
  checkEqual(
    "the teardown schema requires all four per-entry lists",
    schema?.required,
    ["worktrees", "branches", "untied", "errors"]
  );
  const logged = run.logs.join(" | ");
  checkIncludes("a kept worktree is logged with its path and dirty-file count", logged, "kept worktree /tmp/wt-a (3 dirty file(s)): dirty: the task halted");
  check("a removed worktree is not logged as kept", !logged.includes("/tmp/wt-b"), logged);
  checkIncludes("a kept branch is logged with the reason that kept it", logged, "kept branch worktree-wt-a: touched paths are not identical");
  check("a deleted branch is not logged as kept", !logged.includes("kept branch worktree-wt-b"), logged);
  checkIncludes("an untied entry is logged as listed and left alone", logged, "listed worktree-wf_older-run-8 and left it alone");
  checkIncludes("an error is logged", logged, "teardown: branch -D refused");
}

{
  // Teardown's own agent is not retried and cannot take the run's result down with
  // it: an agent that skips its structured-output call throws, and the recovery
  // report is the one artifact the run exists to hand back.
  const run = await runWorkflow({
    args: baseArgs(),
    agents: {
      ...cleanRunAgents(),
      teardown: () => {
        throw new Error("no structured output");
      }
    }
  });
  check("a thrown teardown does not throw out of the run", run.error === null, String(run.error));
  check("the run still returns its result", run.result?.complete === true, JSON.stringify(run.result));
  checkEqual(
    "and it is not retried",
    run.labels.filter((label) => label === "teardown"),
    ["teardown"]
  );
  check(
    "the log says the ledger is where the closing state is read from",
    run.logs.some((line) => line.includes("teardown: no structured result")),
    run.logs.join(" | ")
  );
}

// ── Fixtures: reading a task's recorded state ────────────────────────
// The registry is not returned whole — a verified task appears in no list of the
// result — so the teardown prompt is where a record's own state is legible. That
// is not a workaround: teardown is handed every task of the run with its state
// precisely so its tie rules can see one, and it makes the window the design
// already owns the window these groups read.

const recordedState = (run, id) => {
  const prompt = run.promptFor("teardown") || "";
  const match = prompt.match(new RegExp("^- `" + id + "` — .*state `([a-z-]+)`$", "m"));
  return match ? match[1] : null;
};

// ── Group: the exhaustive task-shape matrix ──────────────────────────
// The plan's twelve-cell table, one cell at a time. It is enumerated rather than
// sampled because three rounds of critique each found one defect in this predicate
// family and every one was a shape the previous table did not list. A cell is
// (verification level × whether the task is `finalTaskId` × which checkout it ran
// on) — exactly the three facts the rules read — and the scored state is the
// decisive one: the gate line reports a pass, the repair line names no path, and
// no commit carries the task's id.
//
// What each column is asserted on, and why that is the honest offline reading:
//   - `runsFullGate` — the gate-line requirement statement in the confirm prompt,
//     which is the only place that reading reaches an agent.
//   - the checkout — the dispatch fact, read off the execute agent's options.
//   - eligibility — the no-op availability statement in the same prompt. The
//     script does not pick the outcome itself: it composes this statement and
//     records what the agent then reports. So the stub below reads the statement
//     and reports the decisive state the way `## confirm` step 5 directs, and the
//     outcome column is the state that reaches the registry.
//   - `blocksRunWide` — the base-never-fully-verified statement, which is keyed on
//     it. Where a cell's outcome is already `failed` one run answers both columns;
//     where it is `verified-no-op` a second run fails the same task to read it.

console.log("\nthe shape matrix: every cell of the twelve");

const SUBJECT = "subject";

// A parallel step needs a sibling to hold more than one task, and a step after the
// subject's is what makes the subject non-final.
const matrixSteps = ({ final, worktree }, subject) => {
  const own = worktree
    ? parallelStep([scopedTask("wt-sib"), subject])
    : sequentialStep(subject);
  return final ? [own] : [own, sequentialStep(scopedTask("tail-1"))];
};

const matrixSubject = (level) =>
  taskFixture(SUBJECT, level === "un-marked" ? {} : { verification_level: level });

// Verified by default, and for the subject the decisive state reported the way the
// confirm rules direct: the no-op where the prompt says it is available, a failure
// where it says it is not. An override replaces the subject's answer outright.
const compliantConfirm = (overrides = {}) => (call) => {
  const id = call.label.slice("confirm:".length);
  if (Object.prototype.hasOwnProperty.call(overrides, id)) return overrides[id];
  if (id !== SUBJECT) return confirmByTask()(call);
  return call.prompt.includes(NO_OP_AVAILABLE)
    ? {
        state: "verified-no-op",
        rung: "none",
        summary: "gate passed, nothing left to repair, nothing committed"
      }
    : {
        state: "failed",
        rung: "none",
        summary: "no commit carries the task id, and the no-op outcome is not available here"
      };
};

const SUBJECT_FAILED = {
  state: "failed",
  rung: "none",
  summary: "Gate: fail — the gate suite reported a failure"
};

const MATRIX = [
  { level: "checkpoint", final: true, worktree: false, fullGate: true, runWide: true, eligible: true },
  {
    level: "checkpoint",
    final: true,
    worktree: true,
    unreachable: "the classifier demotes a multi-task parallel step holding a marked checkpoint"
  },
  { level: "checkpoint", final: false, worktree: false, fullGate: true, runWide: true, eligible: true },
  {
    level: "checkpoint",
    final: false,
    worktree: true,
    unreachable: "the same demotion, away from the end of the run"
  },
  { level: "scoped", final: true, worktree: false, fullGate: false, runWide: true, eligible: false },
  { level: "scoped", final: true, worktree: true, fullGate: false, runWide: true, eligible: false },
  { level: "scoped", final: false, worktree: false, fullGate: false, runWide: false, eligible: false },
  { level: "scoped", final: false, worktree: true, fullGate: false, runWide: false, eligible: false },
  { level: "un-marked", final: true, worktree: false, fullGate: true, runWide: true, eligible: true },
  // The plan's named residual miss: a healthy no-op here is recorded failed and,
  // being the final task, propagates. Reaching it takes two breakdown deviations at
  // once — the marking forgotten AND the final checkpoint packed into a multi-task
  // parallel step — and it is accepted rather than closed with a positional
  // conjunct, which is what the checkout reading exists to remove. Asserted as it
  // stands, so a later change to it is a visible change.
  { level: "un-marked", final: true, worktree: true, fullGate: true, runWide: true, eligible: false },
  { level: "un-marked", final: false, worktree: false, fullGate: true, runWide: false, eligible: true },
  { level: "un-marked", final: false, worktree: true, fullGate: true, runWide: false, eligible: false }
];

for (const cell of MATRIX) {
  const name = `${cell.level}/${cell.final ? "final" : "not final"}/${cell.worktree ? "worktree" : "main"}`;
  const subject = matrixSubject(cell.level);
  const steps = matrixSteps(cell, subject);

  if (cell.unreachable) {
    // Asserted as unreachable rather than skipped: the cell is only empty because
    // another rule closes it, and a skipped row is how a table starts hiding a
    // shape again.
    const run = await runWorkflow({
      args: baseArgs(),
      agents: { ...isolationAgents({ steps }), confirm: compliantConfirm() }
    });
    check(
      `${name}: unreachable — ${cell.unreachable}`,
      ranInWorktree(run, SUBJECT) === false,
      JSON.stringify(run.calls.find((call) => call.label === `exec:${SUBJECT}`)?.opts)
    );
    check(
      `${name}: the demotion that closes it is logged`,
      run.logs.some((line) => line.includes("demoted to sequential")),
      run.logs.join(" | ")
    );
    checkEqual(
      `${name}: the task lands in the marked/main cell instead`,
      recordedState(run, SUBJECT),
      "verified-no-op"
    );
    continue;
  }

  const run = await runWorkflow({
    args: baseArgs(),
    agents: { ...isolationAgents({ steps }), confirm: compliantConfirm() }
  });
  const confirmPrompt = run.promptFor(`confirm:${SUBJECT}`);

  checkIncludes(
    `${name}: runsFullGate is ${cell.fullGate}`,
    confirmPrompt,
    cell.fullGate ? GATE_REQUIRED : GATE_NOT_REQUIRED
  );
  checkIncludes(
    `${name}: the no-op outcome is ${cell.eligible ? "available" : "unavailable"}`,
    confirmPrompt,
    cell.eligible ? NO_OP_AVAILABLE : NO_OP_UNAVAILABLE
  );
  check(
    `${name}: it ran on the ${cell.worktree ? "worktree" : "main"} checkout`,
    ranInWorktree(run, SUBJECT) === cell.worktree,
    JSON.stringify(run.calls.find((call) => call.label === `exec:${SUBJECT}`)?.opts)
  );
  checkEqual(
    `${name}: the decisive state is recorded ${cell.eligible ? "verified-no-op" : "failed"}`,
    recordedState(run, SUBJECT),
    cell.eligible ? "verified-no-op" : "failed"
  );

  if (cell.eligible) {
    check(
      `${name}: so the run reports success and blocks nothing`,
      run.result?.complete === true &&
        (run.result?.blocked || []).length === 0 &&
        run.result?.base_never_fully_verified === null,
      JSON.stringify(run.result)
    );
  } else {
    check(
      `${name}: so the task is in the failed list and the run reports failure`,
      !!failedEntry(run, SUBJECT) && run.result?.complete === false,
      JSON.stringify(run.result?.failed)
    );
  }

  // The `blocksRunWide` column. An eligible cell's decisive state is verified, so
  // it takes a second run — the same shape with the same task failed — to read
  // whether that failure would have reached the run-wide rules.
  const failedRun = cell.eligible
    ? await runWorkflow({
        args: baseArgs(),
        agents: {
          ...isolationAgents({ steps }),
          confirm: compliantConfirm({ [SUBJECT]: SUBJECT_FAILED })
        }
      })
    : run;
  const statement = failedRun.result?.base_never_fully_verified || "";
  check(
    `${name}: blocksRunWide is ${cell.runWide}`,
    statement.includes(`${SUBJECT} failed at the confirm stage`) === cell.runWide,
    `statement: ${statement}`
  );
}

{
  // The second half of the unreachable claim. The classifier closes the marked
  // checkpoint out of a worktree in the breakdown step list; the corrective loop is
  // the run's other worktree dispatch, and it takes its tasks from a schema that
  // carries no verification level at all, so a corrective task cannot be a marked
  // checkpoint either. `finalTaskId` comes from the step list, so it cannot be
  // final by position.
  const run = await runWorkflow({ args: baseArgs(), agents: cleanRunAgents() });
  const schema = run.calls.find((call) => call.label === "verify:1")?.opts?.schema;
  const correctiveFields = Object.keys(
    schema?.properties?.corrective_tasks?.items?.properties || {}
  );
  check(
    "a corrective task cannot carry a verification level: the completeness schema has no such field",
    correctiveFields.length > 0 && !correctiveFields.includes("verification_level"),
    correctiveFields.join(",")
  );
}

// ── Group: the four composition holes ────────────────────────────────
// Four shapes where two individually reasonable rules met and left a gap. Each
// gets its own fixture, because each turns on a different combination of
// `finalTaskId` and the checkout and no one of them can be reached from another's
// task shape: the third and fourth are healthy main-checkout tasks where the
// second is a worktree task, and the first differs from the fourth by position
// alone. The matrix above asserts the predicate readings per cell; this group
// asserts the report a false reading would have produced.

console.log("\nthe composition holes: a healthy no-op is not a failure");
{
  // Hole 1 — a healthy un-marked FINAL checkpoint. An un-marked plan still ends
  // with the mandatory final checkpoint, and on a clean run it runs the gate,
  // finds nothing to repair and commits nothing. Read as a failure it would fire
  // `blocksRunWide`'s final-task arm, propagate, suppress the corrective rounds
  // and report overall failure on a run where every task succeeded.
  const run = await runWorkflow({
    args: baseArgs(),
    agents: isolationAgents({
      steps: [
        parallelStep([scopedTask("wt-1"), scopedTask("wt-2")]),
        sequentialStep(taskFixture("check-final"))
      ],
      confirms: {
        "check-final": {
          state: "verified-no-op",
          rung: "none",
          summary: "gate passed, nothing left to repair"
        }
      }
    })
  });
  checkIncludes(
    "the un-marked final checkpoint is asked for a gate line",
    run.promptFor("confirm:check-final"),
    GATE_REQUIRED
  );
  checkIncludes(
    "and the no-op outcome is available to it",
    run.promptFor("confirm:check-final"),
    NO_OP_AVAILABLE
  );
  checkEqual("it is recorded verified-no-op", recordedState(run, "check-final"), "verified-no-op");
  check("the run reports success", run.result?.complete === true, JSON.stringify(run.result));
  checkEqual("nothing is failed", run.result?.failed, []);
  checkEqual("nothing is blocked", run.result?.blocked, []);
  checkEqual(
    "and the result makes no base-never-fully-verified statement",
    run.result?.base_never_fully_verified,
    null
  );
  check(
    "a no-op runs no integrate agent — it has no commit to merge",
    !run.labels.includes("merge:check-final"),
    run.labels.join(",")
  );
  check(
    "and it is not listed as work built and not integrated",
    !(run.result?.built_not_integrated || []).some((entry) => entry.task_id === "check-final"),
    JSON.stringify(run.result?.built_not_integrated)
  );
}

{
  // Hole 2 — a healthy un-marked INTERMEDIATE checkpoint, the shape a five-row
  // table hid. Breakdown authors one per milestone the plan names, so an un-marked
  // plan carries several. Read as a failure it is a failed main-checkout task, so
  // every later task in the run is blocked as well.
  const run = await runWorkflow({
    args: baseArgs(),
    agents: isolationAgents({
      steps: [
        sequentialStep(taskFixture("mid-check")),
        parallelStep([scopedTask("wt-1"), scopedTask("wt-2")]),
        sequentialStep(checkpointTask("check-final"))
      ],
      confirms: {
        "mid-check": {
          state: "verified-no-op",
          rung: "none",
          summary: "gate passed, nothing left to repair"
        }
      }
    })
  });
  checkIncludes(
    "the un-marked intermediate checkpoint has the no-op available too",
    run.promptFor("confirm:mid-check"),
    NO_OP_AVAILABLE
  );
  checkEqual("it is recorded verified-no-op", recordedState(run, "mid-check"), "verified-no-op");
  check("the run reports success", run.result?.complete === true, JSON.stringify(run.result));
  checkEqual("and no later task is blocked", run.result?.blocked, []);
  check(
    "the worktree work after it runs and integrates",
    run.labels.includes("merge:wt-1") && run.labels.includes("merge:wt-2"),
    run.labels.join(",")
  );
  check("the final checkpoint after it runs", run.labels.includes("exec:check-final"), run.labels.join(","));
}

{
  // The cascade the reading avoids, so the assertion above is not passing on a run
  // that blocks nothing whatever happens. The same intermediate task, failed.
  const run = await runWorkflow({
    args: baseArgs(),
    agents: isolationAgents({
      steps: [
        sequentialStep(taskFixture("mid-check")),
        parallelStep([scopedTask("wt-1"), scopedTask("wt-2")]),
        sequentialStep(checkpointTask("check-final"))
      ],
      confirms: { "mid-check": SUBJECT_FAILED }
    })
  });
  checkEqual(
    "the same task failed blocks every task after it — the cascade the no-op reading removes",
    (run.result?.blocked || []).map((entry) => entry.task_id),
    ["wt-1", "wt-2", "check-final"]
  );
}

{
  // Hole 3 — an un-marked WORKTREE feature task that committed nothing. Its own
  // gate line passes, so the depth reading alone would call it eligible and record
  // it verified: a verified state, in neither the failed nor the blocked list, no
  // integrate step, and a run reporting success on nothing. The checkout is what
  // closes it, which is why this hole cannot reuse either healthy hole's shape —
  // theirs are main-checkout tasks, where the no-op is available by design.
  const run = await runWorkflow({
    args: baseArgs(),
    agents: {
      ...isolationAgents({
        steps: [
          parallelStep([taskFixture("wt-1"), taskFixture("wt-2")]),
          sequentialStep(checkpointTask("check-final"))
        ]
      }),
      confirm: (call) => {
        const id = call.label.slice("confirm:".length);
        if (id !== "wt-1") return confirmByTask()(call);
        return call.prompt.includes(NO_OP_AVAILABLE)
          ? { state: "verified-no-op", rung: "none", summary: "gate passed, nothing to repair" }
          : { state: "failed", rung: "none", summary: "no commit carries the task id" };
      }
    }
  });
  checkIncludes(
    "an un-marked worktree task is still asked for a gate line",
    run.promptFor("confirm:wt-1"),
    GATE_REQUIRED
  );
  checkIncludes(
    "but the no-op outcome is not available to it",
    run.promptFor("confirm:wt-1"),
    NO_OP_UNAVAILABLE
  );
  checkEqual("so it is recorded failed, not verified-no-op", recordedState(run, "wt-1"), "failed");
  checkEqual("failed at the confirm stage", failedEntry(run, "wt-1")?.stage, "confirm");
  check(
    "it appears in no integration",
    !(run.result?.integrations || []).some((entry) => entry.task_id === "wt-1"),
    JSON.stringify(run.result?.integrations)
  );
  check("and the run does not report success on nothing", run.result?.complete === false);
  check(
    "its sibling in the same worktree step, which did commit, still integrates",
    recordedState(run, "wt-2") === "verified" && run.labels.includes("merge:wt-2"),
    run.labels.join(",")
  );
}

{
  // Hole 4 — the final-task arm of `blocksRunWide`, the rule an un-marked final
  // checkpoint would otherwise never reach. Its own fixture, because the three
  // holes above are all healthy runs and this one turns on a failure: a failed
  // un-marked final task must reach the propagation rule and the statement, where
  // the same task one position earlier must not.
  const run = await runWorkflow({
    args: baseArgs(),
    agents: isolationAgents({
      steps: [
        parallelStep([scopedTask("wt-1"), scopedTask("wt-2")]),
        sequentialStep(taskFixture("final-check"))
      ],
      confirms: { "final-check": SUBJECT_FAILED }
    })
  });
  checkIncludes(
    "an un-marked final task that fails is reported as an unverified base",
    run.result?.base_never_fully_verified,
    "final-check failed at the confirm stage"
  );
  check("it is failed, not blocked", !!failedEntry(run, "final-check") && (run.result?.blocked || []).length === 0);
  check("and the run reports failure", run.result?.complete === false);
}

{
  // The contrast that isolates the arm: the same un-marked task, in the same
  // state, one step earlier. It blocks what builds on the base, but the statement
  // does not name it — a non-final un-marked task is not a run-wide gate.
  const run = await runWorkflow({
    args: baseArgs(),
    agents: isolationAgents({
      steps: [
        parallelStep([scopedTask("wt-1"), scopedTask("wt-2")]),
        sequentialStep(taskFixture("mid-task")),
        sequentialStep(scopedTask("tail-1"))
      ],
      confirms: { "mid-task": SUBJECT_FAILED }
    })
  });
  check(
    "an un-marked NON-final task's failure is not itself an unverified base",
    !(run.result?.base_never_fully_verified || "").includes("mid-task failed"),
    String(run.result?.base_never_fully_verified)
  );
  checkIncludes(
    "the statement names the blocked final task instead, which is the run-wide gate here",
    run.result?.base_never_fully_verified,
    "tail-1 was blocked by mid-task"
  );
}

// ── Group: the Verify phase's suppression rules ──────────────────────
// Two rules beyond the corrective loop's exit, both of which decide whether the
// run is allowed to repair itself: a pass is read-only when any task failed or was
// blocked, and a read-only pass cannot complete the run however green it reports.

console.log("\nsuppression: what a read-only pass may and may not conclude");
{
  // The loudest form: the check reports everything complete and every test
  // passing, on a run whose own task failed. `complete` stays false — a base whose
  // own tasks did not land is not complete, whatever the check can see of it.
  const run = await runWorkflow({
    args: baseArgs(),
    agents: isolationAgents({
      steps: [
        parallelStep([scopedTask("wt-1"), scopedTask("wt-2")]),
        sequentialStep(checkpointTask("check-final"))
      ],
      confirms: { "wt-1": SUBJECT_FAILED },
      verify: { all_complete: true, test_passed: true, deliverables: [] }
    })
  });
  checkIncludes("the pass is read-only", run.promptFor("verify:1"), READ_ONLY_PASS);
  check(
    "an all-complete report does not complete a run whose own task failed",
    run.result?.complete === false,
    JSON.stringify(run.result)
  );
  checkEqual("and the loop stops after that one pass", run.labels.filter((l) => l.startsWith("verify:")), [
    "verify:1"
  ]);
  checkIncludes(
    "the suppression is logged with its reason",
    run.logs.join(" | "),
    "no corrective task runs"
  );
}

{
  // Zero corrective tasks on a healthy run: a gap the check will not or cannot
  // fill. Nothing is suppressed — the pass is the ordinary one — and the loop runs
  // its three rounds and reports incomplete rather than looping for ever or
  // claiming success.
  const run = await runWorkflow({
    args: baseArgs(),
    agents: isolationAgents({
      steps: [sequentialStep(scopedTask("task-1"))],
      verify: {
        all_complete: false,
        test_passed: false,
        deliverables: [
          { description: "the widget", status: "gap", evidence: "blocked: the spec contradicts itself" }
        ],
        corrective_tasks: []
      }
    })
  });
  checkIncludes("the pass is the ordinary one — nothing failed", run.promptFor("verify:1"), ORDINARY_PASS);
  checkEqual(
    "a gap with no corrective task runs the rounds to the cap",
    run.labels.filter((label) => label.startsWith("verify:")),
    ["verify:1", "verify:2", "verify:3"]
  );
  checkEqual("three rounds are reported", run.result?.completeness_iterations, 3);
  check("no corrective agent runs", !run.labels.some((l) => l.startsWith("exec:fix")), run.labels.join(","));
  check("the run reports incomplete", run.result?.complete === false, JSON.stringify(run.result));
  check(
    "the cap is logged rather than silent",
    run.logs.some((line) => line.includes("Completeness cap reached")),
    run.logs.join(" | ")
  );
  checkEqual("nothing is failed or blocked over a gap", [run.result?.failed, run.result?.blocked], [[], []]);
}

// ── Group: the recovery-grade result's shape ─────────────────────────
// One plain JSON object, and every field a human recovering the run reads. The
// group asserts the whole key set rather than the fields one mechanism at a time,
// because a field dropped from the result is invisible to every assertion that
// names only the fields it wants.

console.log("\nthe result: recovery-grade, and one plain object");

const RESULT_KEYS = [
  "tasks_total",
  "completeness_iterations",
  "complete",
  "failed",
  "blocked",
  "built_not_integrated",
  "integrations",
  "base_never_fully_verified",
  "completeness",
  "ledger_path",
  "friction_logs",
  "retrospective"
];

{
  const run = await runWorkflow({
    args: baseArgs(),
    agents: isolationAgents({
      steps: [
        parallelStep([scopedTask("wt-1"), scopedTask("wt-2")]),
        sequentialStep(checkpointTask("check-final"))
      ],
      confirms: {
        // A task verified on the second rung, with its ref moved: both facts have
        // to survive into the result, because the criterion is that the result says
        // which rung produced the evidence.
        "wt-1": {
          state: "verified",
          commit: hashFor("wt-1"),
          branch: "worktree-wt-1",
          rung: "subject-search",
          ref_moved: true,
          summary: "found by the run-scoped subject search"
        }
      },
      merges: {
        "wt-1": { task_id: "wt-1", success: false, error: "the base did not build after the merge" },
        "wt-2": { task_id: "wt-2", success: true }
      }
    })
  });

  checkEqual("every recovery-grade field is present, and in one flat object", Object.keys(run.result), [
    ...RESULT_KEYS,
    "error"
  ]);
  check(
    "the result is plain JSON — it round-trips unchanged, so no reader needs new machinery",
    JSON.stringify(JSON.parse(JSON.stringify(run.result))) === JSON.stringify(run.result),
    JSON.stringify(run.result)
  );
  checkEqual("the task count is the breakdown's own", run.result?.tasks_total, 3);
  checkEqual("the completeness round count is reported", run.result?.completeness_iterations, 1);

  checkEqual(
    "a failed entry carries the stage, the reason, the identity, the rung and the verbatim text",
    Object.keys(failedEntry(run, "wt-1") || {}),
    ["task_id", "title", "stage", "reason", "commit", "branch", "rung", "agent_text"]
  );
  checkEqual(
    "the rung that produced the evidence reaches the failure result",
    failedEntry(run, "wt-1")?.rung,
    "subject-search"
  );
  checkEqual(
    "a blocked entry carries the blocking task and nothing it does not know",
    Object.keys((run.result?.blocked || [])[0] || {}),
    ["task_id", "title", "blocked_by"]
  );
  checkEqual(
    "work built and not integrated carries the ref, and says the confirm agent moved it",
    (run.result?.built_not_integrated || [])[0],
    {
      task_id: "wt-1",
      title: "Task wt-1",
      commit: hashFor("wt-1"),
      branch: "worktree-wt-1",
      ref: "refs/task/demo-run-20260102-0304/wt-1",
      ref_moved: true
    }
  );
  checkEqual(
    "an integration entry carries its squash commit or the no-fixed-point marker",
    run.result?.integrations,
    [{ task_id: "wt-2", commit: null, no_fixed_point: true }]
  );
  checkEqual(
    "the ledger path is where a human reads the rest",
    run.result?.ledger_path,
    ".tasks/demo-run-20260102-0304/ledger.jsonl"
  );
  check(
    "the friction the execute agents reported reaches the result verbatim",
    (run.result?.friction_logs || []).some((entry) => String(entry.friction).includes("Did the wt-1 work.")),
    JSON.stringify(run.result?.friction_logs)
  );
}

{
  // A healthy run carries the same fields and no `error` key at all, so a caller
  // testing for one is testing a fact rather than a string.
  const run = await runWorkflow({
    args: baseArgs(),
    agents: isolationAgents({
      steps: [parallelStep([scopedTask("wt-1"), scopedTask("wt-2")]), sequentialStep(checkpointTask("check-final"))]
    })
  });
  checkEqual("a healthy run's result carries the same fields, minus the error", Object.keys(run.result), RESULT_KEYS);
}

console.log(`\n== ${pass} passed, ${fail} failed ==`);
process.exit(fail === 0 ? 0 : 1);
