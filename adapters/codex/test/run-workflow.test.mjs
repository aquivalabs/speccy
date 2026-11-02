// Tests for run-workflow.mjs, the Codex entrypoint, and the status side of
// monitor.mjs. Run with:
//   node --test adapters/codex/test/run-workflow.test.mjs
//
// Each test launches the real runner as a detached process against a throwaway
// git repo, with fake-codex.mjs standing in for `codex exec`, and follows it the
// way a Codex orchestrator would: by polling the status file.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

import { readStatus } from "../monitor.mjs";

const HERE = import.meta.dirname;
const RUNNER = path.resolve(HERE, "..", "run-workflow.mjs");
const FAKE = path.join(HERE, "fake-codex.mjs");
const ENV = { ...process.env, SPECCY_CODEX_BIN: process.execPath, SPECCY_CODEX_ARGS_PREFIX: JSON.stringify([FAKE]) };

const STEP_SCHEMA = { type: "object", properties: { steps: { type: "array" } }, required: ["steps"] };

function setup(workflowBody) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "run-workflow-test-"));
  const g = (...a) => execFileSync("git", ["-C", root, ...a], { stdio: "ignore" });
  g("init", "-b", "main");
  g("config", "user.email", "t@example.com");
  g("config", "user.name", "T");
  fs.writeFileSync(path.join(root, "README"), "seed\n");
  g("add", ".");
  g("commit", "-m", "seed");
  const script = path.join(root, "wf.js");
  fs.writeFileSync(script, `export const meta = { name: "t", phases: [{ title: "One" }] };\n${workflowBody}`);
  const argsFile = path.join(root, "args.json");
  fs.writeFileSync(argsFile, JSON.stringify({ runId: "t-20260925-0000", baseBranch: "main", schema: STEP_SCHEMA }));
  return { root, script, argsFile };
}

function cli(...argv) {
  return JSON.parse(execFileSync(process.execPath, [RUNNER, ...argv], { encoding: "utf8", env: ENV }));
}

async function pollUntilDone(statusPath, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const s = readStatus(statusPath);
    if (!["starting", "running"].includes(s.state)) return s;
    if (Date.now() > deadline) throw new Error(`still ${s.state} after ${timeoutMs}ms`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

test("start returns at once; the status file carries the run to complete, and result.json holds its return", async () => {
  const { root, script, argsFile } = setup(`
phase("One");
log("working");
const r = await agent("do it", { label: "decompose", schema: args.schema });
return { steps: r.steps.length };
`);
  const run = cli("start", "--script", script, "--args-file", argsFile, "--repo", root);
  for (const key of ["statusPath", "heartbeatPath", "resultPath", "logPath"]) assert.ok(path.isAbsolute(run[key]), key);
  assert.ok(!run.workDir.startsWith(root), "run files live outside the repo");

  const status = await pollUntilDone(run.statusPath);
  assert.equal(status.state, "complete");
  assert.equal(status.phase, "One");
  assert.deepEqual(status.lastLog, ["working"]);
  assert.equal(status.pid, run.pid);
  assert.deepEqual(JSON.parse(fs.readFileSync(run.resultPath, "utf8")), { steps: 1 });
  assert.ok(fs.existsSync(run.heartbeatPath), "the runtime's heartbeat sits beside the status file");
});

test("a workflow that throws ends failed, with its error in the status and its stack in the log", async () => {
  const { root, script, argsFile } = setup(`throw new Error("boom");`);
  const run = cli("start", "--script", script, "--args-file", argsFile, "--repo", root);
  const status = await pollUntilDone(run.statusPath);
  assert.equal(status.state, "failed");
  assert.match(status.error, /boom/);
  assert.match(fs.readFileSync(run.logPath, "utf8"), /workflow failed: Error: boom/);
  assert.ok(!fs.existsSync(run.resultPath));
});

test("stop kills the run; the status then reads died", async () => {
  const { root, script, argsFile } = setup(`phase("One"); await new Promise(() => setInterval(() => {}, 1000));`);
  const run = cli("start", "--script", script, "--args-file", argsFile, "--repo", root);
  const deadline = Date.now() + 10000;
  while (readStatus(run.statusPath).phase !== "One") {
    if (Date.now() > deadline) throw new Error("run never reached its phase");
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.deepEqual(cli("stop", "--status", run.statusPath), { stopped: run.pid });
  const status = await pollUntilDone(run.statusPath);
  assert.equal(status.state, "died");
  assert.deepEqual(cli("stop", "--status", run.statusPath), { stopped: run.pid, alreadyGone: true });
});

test("readStatus reports starting before the runner's first write", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "status-test-"));
  assert.deepEqual(readStatus(path.join(dir, "status.json")), { state: "starting" });
  fs.writeFileSync(path.join(dir, "status.json"), "half-writ");
  assert.deepEqual(readStatus(path.join(dir, "status.json")), { state: "starting" });
});

test("readStatus reports died only for a running status whose process is gone", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "status-test-"));
  const p = path.join(dir, "status.json");
  const gone = () => false;
  fs.writeFileSync(p, JSON.stringify({ state: "running", pid: 1 }));
  assert.equal(readStatus(p, gone).state, "died");
  assert.equal(readStatus(p, () => true).state, "running");
  fs.writeFileSync(p, JSON.stringify({ state: "complete", pid: 1 }));
  assert.equal(readStatus(p, gone).state, "complete");
});
