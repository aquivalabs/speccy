// Tests for the Codex loader and workflow runtime. Run with:
//   node --test adapters/codex/test/workflow-runtime.test.mjs
//
// The runtime is driven against a faked `codex exec` (test/fake-codex.mjs, a
// stub process the runtime spawns like the real thing) and a real throwaway git
// repo (the state.test.mjs pattern). No Codex tokens.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawn as nodeSpawn } from "node:child_process";

import {
  extractMeta,
  stripExport,
  buildFactory,
  loadWorkflow,
  AMBIENTS
} from "../loader.mjs";
import {
  createCodexRuntime,
  concurrencyCap,
  validateAgainstSchema,
  augmentResultPrompt,
  confirmCommitLanded
} from "../workflow-runtime.mjs";

const HERE = import.meta.dirname;
const FAKE = path.join(HERE, "fake-codex.mjs");
const WORKFLOW_JS = path.resolve(HERE, "..", "..", "..", "skills", "plan-execution", "workflow.js");

// A minimal replica of workflow.js's STEP_SCHEMA (workflow.js:78-140). It cannot
// be imported — workflow.js has top-level `return`, so it is not a valid module.
const STEP_SCHEMA = {
  type: "object",
  properties: {
    steps: {
      type: "array",
      items: {
        type: "object",
        properties: {
          parallel: { type: "boolean" },
          tasks: {
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
        required: ["parallel", "tasks"]
      }
    }
  },
  required: ["steps"]
};

// A minimal schema shaped like the exec/confirm result crossCheckCommit reads:
// only `success` and `commit` matter to its guard.
const COMMIT_SCHEMA = {
  type: "object",
  properties: {
    success: { type: "boolean" },
    commit: { type: "string" }
  },
  required: ["success", "commit"]
};

// ── harness ──────────────────────────────────────────────────────────

function repo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-runtime-"));
  const g = (...a) => execFileSync("git", ["-C", root, ...a], { stdio: "ignore" });
  g("init", "-b", "main");
  g("config", "user.email", "t@example.com");
  g("config", "user.name", "Test");
  fs.writeFileSync(path.join(root, "README"), "seed\n");
  g("add", ".");
  g("commit", "-m", "seed");
  return {
    root,
    g,
    cleanup: () => fs.rmSync(root, { recursive: true, force: true })
  };
}

function runtimeOn(root, extra = {}) {
  return createCodexRuntime({
    repoRoot: root,
    baseBranch: "main",
    runId: "run-20260101-0900",
    codexBin: process.execPath,
    codexArgsPrefix: [FAKE],
    ...extra
  });
}

// ── loader ─────────────────────────────────────────────────────────────

test("extractMeta reads workflow.js's meta literal", () => {
  const src = fs.readFileSync(WORKFLOW_JS, "utf8");
  const meta = extractMeta(src);
  assert.equal(meta.name, "plan-execution");
  assert.equal(meta.phases.length, 5);
  assert.equal(meta.phases[0].title, "Breakdown");
});

test("stripExport turns the top-level export into a plain const", () => {
  const src = "export const meta = { name: 'x' };\nreturn 1;\n";
  const stripped = stripExport(src);
  assert.match(stripped, /^const meta = \{/);
  assert.doesNotMatch(stripped, /export/);
});

test("the transform wraps a body with top-level return and binds the five ambients", async () => {
  // A synthetic workflow that, like workflow.js, mixes `export const meta` with a
  // top-level return and uses all five injected ambients.
  const src = `export const meta = { name: "synthetic" };
phase("go");
log("hi");
const parsed = typeof args === "string" ? JSON.parse(args) : args;
const r = await parallel([() => agent("p", { label: "a" })]);
return { phase: parsed.n, first: r[0] };`;

  const seen = { phases: [], logs: [], agents: [] };
  const ambients = {
    agent: async (prompt, opts) => {
      seen.agents.push({ prompt, opts });
      return "RESULT";
    },
    parallel: async (fns) => Promise.all(fns.map((f) => f())),
    phase: (n) => seen.phases.push(n),
    log: (m) => seen.logs.push(m),
    args: { n: 42 }
  };

  const { meta, run } = loadWorkflow(src);
  assert.equal(meta.name, "synthetic");
  const out = await run(ambients);
  assert.deepEqual(out, { phase: 42, first: "RESULT" });
  assert.deepEqual(seen.phases, ["go"]);
  assert.deepEqual(seen.logs, ["hi"]);
  assert.equal(seen.agents[0].opts.label, "a");
});

test("an unterminated block comment in the meta literal throws instead of livelocking", () => {
  const src = "export const meta = { /* oops\n};\nreturn 1;\n";
  assert.throws(() => extractMeta(src), /unterminated block comment/);
});

test("run rejects a missing ambient", () => {
  const { run } = loadWorkflow("export const meta = {};\nreturn 1;");
  assert.throws(() => run({ agent: 1, parallel: 1, phase: 1, log: 1 }), /missing ambient "args"/);
  assert.deepEqual(AMBIENTS, ["agent", "parallel", "phase", "log", "args"]);
});

// ── concurrency cap ────────────────────────────────────────────────────

test("concurrencyCap matches min(16, CPUs - 2), floored at 1", () => {
  assert.equal(concurrencyCap(4), 2);
  assert.equal(concurrencyCap(10), 8);
  assert.equal(concurrencyCap(20), 16);
  assert.equal(concurrencyCap(2), 1);
  assert.equal(concurrencyCap(1), 1);
});

test("parallel never runs more than the cap at once", async () => {
  const { root, cleanup } = repo();
  const rt = runtimeOn(root, { cpus: 4 }); // cap 2
  let live = 0;
  let peak = 0;
  const task = () => async () => {
    live++;
    peak = Math.max(peak, live);
    await new Promise((r) => setTimeout(r, 15));
    live--;
    return "ok";
  };
  const results = await rt.parallel(Array.from({ length: 8 }, task));
  assert.equal(results.length, 8);
  assert.ok(results.every((r) => r === "ok"));
  assert.equal(peak, 2, `peak concurrency ${peak} should equal the cap 2`);
  await rt.dispose();
  cleanup();
});

test("parallel stops starting new work once a thunk rejects, and rethrows", async () => {
  const { root, cleanup } = repo();
  const rt = runtimeOn(root, { cpus: 4 }); // cap 2
  let started = 0;
  const failing = () => {
    started++;
    throw new Error("boom");
  };
  const slowOk = () => async () => {
    started++;
    await new Promise((r) => setTimeout(r, 20));
    return "ok";
  };
  const fns = [async () => failing(), ...Array.from({ length: 7 }, slowOk)];
  await assert.rejects(() => rt.parallel(fns), /boom/);
  // cap is 2: the failing thunk rejects fast, the other worker's first task
  // is still mid-flight when the stop flag is set, so at most 2 tasks start.
  assert.ok(started <= 2, `expected at most 2 tasks to start before the stop, started=${started}`);
  await rt.dispose();
  cleanup();
});

// ── schema validator ───────────────────────────────────────────────────

test("validateAgainstSchema accepts a conforming STEP_SCHEMA value and rejects gaps", () => {
  const good = {
    steps: [
      { parallel: false, tasks: [{ id: "t", title: "T", description: "D", files: [], acceptance_criteria: [] }] }
    ]
  };
  validateAgainstSchema(good, STEP_SCHEMA); // no throw
  assert.throws(() => validateAgainstSchema({ steps: "x" }, STEP_SCHEMA), /steps: expected array/);
  assert.throws(
    () => validateAgainstSchema({ steps: [{ parallel: false }] }, STEP_SCHEMA),
    /tasks: required, missing/
  );
});

test("augmentResultPrompt carries the absolute result path and the schema", () => {
  const p = augmentResultPrompt("do work", STEP_SCHEMA, "/abs/x.result.json");
  assert.match(p, /\/abs\/x\.result\.json/);
  assert.match(p, /"required"/);
  assert.match(p, /nothing else/);
});

// ── result channel ─────────────────────────────────────────────────────

test("a schema agent() result comes from the file the agent wrote, validated", async () => {
  const { root, cleanup } = repo();
  const rt = runtimeOn(root);
  const result = await rt.agent("decompose this [[FAKE:ok]]", {
    label: "decompose",
    schema: STEP_SCHEMA
  });
  assert.equal(result.steps[0].tasks[0].id, "task-1");
  validateAgainstSchema(result, STEP_SCHEMA);
  await rt.dispose();
  cleanup();
});

test("createCodexRuntime resolves a relative repoRoot so the result channel works", async () => {
  const { root, cleanup } = repo();
  const rel = path.relative(process.cwd(), root);
  assert.ok(!path.isAbsolute(rel), "test drives the relative-root path");
  const rt = createCodexRuntime({
    repoRoot: rel,
    baseBranch: "main",
    runId: "run-20260101-0900",
    codexBin: process.execPath,
    codexArgsPrefix: [FAKE]
  });
  // With an unresolved relative root the agent-written result path and the path
  // the runtime reads back resolve against different cwds, so this would fail.
  const result = await rt.agent("decompose [[FAKE:ok]]", { label: "decompose", schema: STEP_SCHEMA });
  assert.equal(result.steps[0].tasks[0].id, "task-1");
  await rt.dispose();
  cleanup();
});

test("a malformed result file is retried, then throws for withRetry to catch", async () => {
  const { root, cleanup } = repo();
  let spawns = 0;
  const countingSpawn = (cmd, a, o) => {
    spawns++;
    return nodeSpawn(cmd, a, o);
  };
  const rt = runtimeOn(root, { retries: 2, spawn: countingSpawn });
  await assert.rejects(
    () => rt.agent("decompose [[FAKE:malformed]]", { label: "decompose", schema: STEP_SCHEMA }),
    /no schema-valid result file after 2 attempts/
  );
  assert.equal(spawns, 2, "the exec was retried before failing");
  await rt.dispose();
  cleanup();
});

test("a schema agent() that writes no result file rejects after retries; never returns a stale result", async () => {
  // [[FAKE:absent]] writes nothing. Each attempt reads its own per-attempt path,
  // so a retry cannot pick up a prior attempt's file; the missing file drives the
  // retry-then-throw rather than a stale/previous result masquerading as success.
  const { root, cleanup } = repo();
  let spawns = 0;
  const countingSpawn = (cmd, a, o) => {
    spawns++;
    return nodeSpawn(cmd, a, o);
  };
  const rt = runtimeOn(root, { retries: 2, spawn: countingSpawn });
  await assert.rejects(
    () => rt.agent("decompose [[FAKE:absent]]", { label: "decompose", schema: STEP_SCHEMA }),
    /no schema-valid result file after 2 attempts/
  );
  assert.equal(spawns, 2, "the exec was retried before failing");
  await rt.dispose();
  cleanup();
});

test("a schema-violating result file is rejected", async () => {
  const { root, cleanup } = repo();
  const rt = runtimeOn(root, { retries: 1 });
  await assert.rejects(
    () => rt.agent("decompose [[FAKE:wrongschema]]", { label: "decompose", schema: STEP_SCHEMA }),
    /steps: expected array/
  );
  await rt.dispose();
  cleanup();
});

test("a non-schema agent() returns the agent's prose from the -o file", async () => {
  const { root, cleanup } = repo();
  const rt = runtimeOn(root);
  const prose = await rt.agent("just do it", { label: "exec:task-1" });
  assert.match(prose, /fake codex done/);
  await rt.dispose();
  cleanup();
});

test("a non-schema agent() returns its report even on a non-zero exit (git state is the oracle)", async () => {
  // runExecute has no try/catch and judges success from git via confirmFromGit; a
  // non-zero exit can accompany a landed commit, so agent() must return the report
  // rather than throw (throwing would skip the integrate-succeeded loop and cleanup).
  const { root, cleanup } = repo();
  const rt = runtimeOn(root);
  const prose = await rt.agent("just do it [[FAKE:fail]]", { label: "exec:task-1" });
  assert.match(prose, /fake codex done/);
  await rt.dispose();
  cleanup();
});

test("a schema agent() accepts a valid result file even when codex exec exits non-zero", async () => {
  // [[FAKE:fail]] writes a schema-valid result file and then exits 1. The file is
  // the oracle, so the valid result is accepted despite the non-zero exit.
  const { root, cleanup } = repo();
  const rt = runtimeOn(root);
  const result = await rt.agent("decompose [[FAKE:fail]]", { label: "decompose", schema: STEP_SCHEMA });
  assert.equal(result.steps[0].tasks[0].id, "task-1");
  validateAgainstSchema(result, STEP_SCHEMA);
  await rt.dispose();
  cleanup();
});

// ── commit cross-check ─────────────────────────────────────────────────

test("confirmCommitLanded finds an unmerged worktree commit by its id prefix", () => {
  const { root, g, cleanup } = repo();
  const wt = path.join(root, "wt-1");
  g("worktree", "add", "-b", "run/task-1", wt, "main");
  fs.writeFileSync(path.join(wt, "f.txt"), "x");
  execFileSync("git", ["-C", wt, "add", "."], { stdio: "ignore" });
  execFileSync("git", ["-C", wt, "commit", "-m", "task-1: did the work"], { stdio: "ignore" });
  const [hash] = execFileSync("git", ["-C", wt, "rev-parse", "HEAD"], { encoding: "utf8" }).trim().split("\n");

  const landed = confirmCommitLanded("task-1", { repoRoot: root, baseBranch: "main" });
  assert.deepEqual(landed, [hash]);
  assert.deepEqual(confirmCommitLanded("task-9", { repoRoot: root, baseBranch: "main" }), []);
  g("worktree", "remove", "--force", wt);
  cleanup();
});

test("the cross-check discards a commit whose subject does not start with the id prefix", () => {
  const { root, g, cleanup } = repo();
  const wt = path.join(root, "wt-2");
  g("worktree", "add", "-b", "run/task-2", wt, "main");
  fs.writeFileSync(path.join(wt, "f.txt"), "x");
  execFileSync("git", ["-C", wt, "add", "."], { stdio: "ignore" });
  // The id appears only in the body, not at the start of the subject.
  execFileSync("git", ["-C", wt, "commit", "-m", "chore: mention task-2: in the body"], { stdio: "ignore" });
  assert.deepEqual(confirmCommitLanded("task-2", { repoRoot: root, baseBranch: "main" }), []);
  g("worktree", "remove", "--force", wt);
  cleanup();
});

// The two tests above drive confirmCommitLanded standalone. These drive it
// through agent()'s crossCheckCommit guard (only fires when the schema result
// carries success:true and a string commit), so a renamed guard field would
// fail a test here even though it is defense-in-depth with no functional effect.

function captureStderr(fn) {
  const original = process.stderr.write.bind(process.stderr);
  const lines = [];
  process.stderr.write = (chunk) => {
    lines.push(String(chunk));
    return true;
  };
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      process.stderr.write = original;
    })
    .then(() => lines);
}

test("agent()'s cross-check logs a discrepancy when the reported commit did not land", async () => {
  const { root, cleanup } = repo();
  const rt = runtimeOn(root);
  const fakeCommit = "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
  const lines = await captureStderr(() =>
    rt.agent(`do it [[FAKE:commit:${fakeCommit}]]`, { label: "exec:task-1", schema: COMMIT_SCHEMA })
  );
  assert.ok(
    lines.some((l) => l.includes(fakeCommit) && l.includes("not found")),
    `expected a cross-check discrepancy log, got:\n${lines.join("")}`
  );
  await rt.dispose();
  cleanup();
});

test("agent()'s cross-check logs nothing when the reported commit did land", async () => {
  const { root, g, cleanup } = repo();
  const wt = path.join(root, "wt-3");
  g("worktree", "add", "-b", "run-20260101-0900/task-1", wt, "main");
  fs.writeFileSync(path.join(wt, "f.txt"), "x");
  execFileSync("git", ["-C", wt, "add", "."], { stdio: "ignore" });
  execFileSync("git", ["-C", wt, "commit", "-m", "task-1: did the work"], { stdio: "ignore" });
  const landedCommit = execFileSync("git", ["-C", wt, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  g("worktree", "remove", "--force", wt);

  const rt = runtimeOn(root);
  const lines = await captureStderr(() =>
    rt.agent(`do it [[FAKE:commit:${landedCommit}]]`, { label: "exec:task-1", schema: COMMIT_SCHEMA })
  );
  assert.ok(
    !lines.some((l) => l.includes("not found")),
    `expected no discrepancy log, got:\n${lines.join("")}`
  );
  await rt.dispose();
  cleanup();
});

test("agent()'s cross-check logs nothing for a sequential-style commit on the base branch", async () => {
  // A sequential task commits straight onto baseBranch (main). A branch-exclusion
  // query would exclude it and log a spurious discrepancy; identity verification
  // must accept it.
  const { root, g, cleanup } = repo();
  fs.writeFileSync(path.join(root, "seq.txt"), "x");
  g("add", ".");
  g("commit", "-m", "task-1: sequential work on base");
  const landedCommit = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();

  const rt = runtimeOn(root);
  const lines = await captureStderr(() =>
    rt.agent(`do it [[FAKE:commit:${landedCommit}]]`, { label: "exec:task-1", schema: COMMIT_SCHEMA })
  );
  assert.ok(
    !lines.some((l) => l.includes("not found")),
    `expected no discrepancy log for a base-branch commit, got:\n${lines.join("")}`
  );
  await rt.dispose();
  cleanup();
});

// ── worktree lifecycle ─────────────────────────────────────────────────

test("agent(isolation:worktree) provisions an empty worktree; dispose removes it", async () => {
  const { root, cleanup } = repo();
  const rt = runtimeOn(root);
  await rt.agent("run in isolation", { label: "exec:task-1", isolation: "worktree" });
  assert.equal(rt.worktrees.length, 1);
  const wt = rt.worktrees[0];
  assert.ok(fs.existsSync(wt.path), "worktree dir exists");
  const branches = execFileSync("git", ["-C", root, "branch", "--list", wt.branch], { encoding: "utf8" });
  assert.match(branches, new RegExp(wt.branch.replace(/[/]/g, "\\/")));

  await rt.dispose();
  assert.ok(!fs.existsSync(wt.path), "worktree dir removed by dispose");
  const list = execFileSync("git", ["-C", root, "worktree", "list"], { encoding: "utf8" });
  assert.doesNotMatch(list, /wt/);
  cleanup();
});

test("dispose leaves a dirty worktree in place (never --force)", async () => {
  const { root, cleanup } = repo();
  const rt = runtimeOn(root);
  await rt.agent("run in isolation", { label: "exec:task-1", isolation: "worktree" });
  const wt = rt.worktrees[0];
  fs.writeFileSync(path.join(wt.path, "uncommitted.txt"), "work that never landed");
  await rt.dispose();
  assert.ok(fs.existsSync(wt.path), "dirty worktree is preserved");
  assert.ok(fs.existsSync(path.join(wt.path, "uncommitted.txt")));
  // clean up manually so the tmp dir removes
  execFileSync("git", ["-C", root, "worktree", "remove", "--force", wt.path], { stdio: "ignore" });
  cleanup();
});

// ── heartbeat ──────────────────────────────────────────────────────────

test("the heartbeat file carries exactly the two documented fields", async () => {
  const { root, cleanup } = repo();
  const seenAlive = [];
  // A spawn wrapper reads the heartbeat at the instant a subprocess starts, to
  // observe the alive=true beat the runtime writes before spawning.
  const observingSpawn = (cmd, a, o) => {
    seenAlive.push(JSON.parse(fs.readFileSync(rt.heartbeatPath, "utf8")).alive);
    return nodeSpawn(cmd, a, o);
  };
  const rt = runtimeOn(root, { spawn: observingSpawn });
  await rt.agent("do it", { label: "exec:task-1" });

  const hb = JSON.parse(fs.readFileSync(rt.heartbeatPath, "utf8"));
  assert.deepEqual(Object.keys(hb).sort(), ["alive", "mtime"]);
  assert.equal(typeof hb.mtime, "number");
  assert.equal(typeof hb.alive, "boolean");
  assert.equal(hb.alive, false, "no subprocess alive after the run");
  assert.deepEqual(seenAlive, [true], "alive was true while the subprocess ran");
  await rt.dispose();
  cleanup();
});

test("the heartbeat mtime advances with activity", async () => {
  const { root, cleanup } = repo();
  const rt = runtimeOn(root);
  const first = JSON.parse(fs.readFileSync(rt.heartbeatPath, "utf8")).mtime;
  await new Promise((r) => setTimeout(r, 5));
  await rt.agent("do it", { label: "exec:task-1" });
  const after = JSON.parse(fs.readFileSync(rt.heartbeatPath, "utf8")).mtime;
  assert.ok(after >= first, "mtime does not go backwards");
  await rt.dispose();
  cleanup();
});
