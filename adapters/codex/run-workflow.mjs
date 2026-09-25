// Codex entrypoint for plan-execution's workflow scripts: loads workflow.js
// through the loader, runs it against the Codex runtime, and reports through
// files, because a Codex orchestrator gets no completion notification and its
// shell calls time out long before a build finishes.
//
//   node run-workflow.mjs start --script <workflow.js> --args-file <args.json> [--repo <dir>]
//       Launches the run detached and prints its file paths as JSON, then exits.
//   node run-workflow.mjs stop --status <status.json>
//       Kills the run's process group (the runner and its codex exec children).
//
// All run files live in a temp directory, outside the repo:
//   status.json    — { state, phase, pid, startedAt, updatedAt, finishedAt?, error?, lastLog },
//                    written only by the runner. state is running | complete |
//                    failed; monitor.mjs also reports starting and died.
//   heartbeat.json — the runtime's liveness signal (see workflow-runtime.mjs).
//   result.json    — the workflow's return value, written on completion.
//   run.log        — every log() line and codex-runtime diagnostic.
//
// SPECCY_CODEX_BIN and SPECCY_CODEX_ARGS_PREFIX (a JSON array) override the
// codex executable, so tests can drive the runner with a fake agent.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { loadWorkflow } from "./loader.mjs";
import { createCodexRuntime } from "./workflow-runtime.mjs";

const thisFile = fileURLToPath(import.meta.url);
const LAST_LOG_LINES = 5;

function flag(argv, name) {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

function runFiles(workDir) {
  return {
    workDir,
    statusPath: path.join(workDir, "status.json"),
    heartbeatPath: path.join(workDir, "heartbeat.json"),
    resultPath: path.join(workDir, "result.json"),
    logPath: path.join(workDir, "run.log"),
  };
}

function start(argv) {
  const script = flag(argv, "--script");
  const argsFile = flag(argv, "--args-file");
  if (!script || !argsFile) throw new Error("start needs --script and --args-file");
  const repo = path.resolve(flag(argv, "--repo") ?? process.cwd());
  const { runId = "run" } = JSON.parse(fs.readFileSync(argsFile, "utf8"));

  const files = runFiles(fs.mkdtempSync(path.join(os.tmpdir(), `speccy-${runId}-`)));
  const log = fs.openSync(files.logPath, "a");
  // detached makes the runner a process-group leader, so stop can kill the
  // whole group, codex exec children included.
  const child = spawn(
    process.execPath,
    [thisFile, "run", "--script", path.resolve(script), "--args-file", path.resolve(argsFile),
      "--repo", repo, "--work-dir", files.workDir],
    { detached: true, stdio: ["ignore", log, log] }
  );
  child.unref();
  return { ...files, pid: child.pid };
}

function writeStatus(statusPath, status) {
  const tmp = `${statusPath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ ...status, updatedAt: Date.now() }));
  fs.renameSync(tmp, statusPath); // atomic, so a poll never reads a half-written file
}

async function run(argv) {
  const files = runFiles(flag(argv, "--work-dir"));
  const args = JSON.parse(fs.readFileSync(flag(argv, "--args-file"), "utf8"));
  // The runner is status.json's only writer; until its first write lands the
  // file is absent, which monitor.mjs reports as "starting".
  const status = { state: "running", phase: null, pid: process.pid, startedAt: Date.now(), lastLog: [] };
  writeStatus(files.statusPath, status);
  const update = (patch) => {
    Object.assign(status, patch);
    writeStatus(files.statusPath, status);
  };

  const rt = createCodexRuntime({
    repoRoot: flag(argv, "--repo"),
    baseBranch: args.baseBranch,
    runId: args.runId,
    args,
    workDir: files.workDir,
    heartbeatPath: files.heartbeatPath,
    codexBin: process.env.SPECCY_CODEX_BIN || "codex",
    codexArgsPrefix: JSON.parse(process.env.SPECCY_CODEX_ARGS_PREFIX || "[]"),
  });
  const ambients = {
    agent: rt.agent,
    parallel: rt.parallel,
    args,
    phase(name) {
      rt.phase(name);
      update({ phase: name });
    },
    log(msg) {
      rt.log(msg);
      update({ lastLog: [...status.lastLog, String(msg)].slice(-LAST_LOG_LINES) });
    },
  };

  try {
    const result = await loadWorkflow(fs.readFileSync(flag(argv, "--script"), "utf8")).run(ambients);
    fs.writeFileSync(files.resultPath, JSON.stringify(result ?? null, null, 2));
    update({ state: "complete", finishedAt: Date.now() });
  } catch (e) {
    rt.log(`workflow failed: ${e?.stack ?? e}`);
    update({ state: "failed", finishedAt: Date.now(), error: String(e?.message ?? e) });
  } finally {
    await rt.dispose();
  }
}

function stop(argv) {
  const { pid } = JSON.parse(fs.readFileSync(flag(argv, "--status"), "utf8"));
  try {
    process.kill(-pid, "SIGTERM");
  } catch (e) {
    if (e.code !== "ESRCH") throw e;
    return { stopped: pid, alreadyGone: true };
  }
  return { stopped: pid };
}

export async function main(argv = process.argv.slice(2)) {
  const [verb, ...rest] = argv;
  try {
    if (verb === "start") process.stdout.write(JSON.stringify(start(rest), null, 2) + "\n");
    else if (verb === "run") await run(rest);
    else if (verb === "stop") process.stdout.write(JSON.stringify(stop(rest)) + "\n");
    else {
      process.stderr.write("usage: run-workflow.mjs <start|stop> ...\n");
      return 2;
    }
    return 0;
  } catch (e) {
    process.stderr.write(`run-workflow: ${e.message}\n`);
    return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === thisFile) process.exitCode = await main();
