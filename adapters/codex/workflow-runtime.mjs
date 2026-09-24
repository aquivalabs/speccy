// Codex workflow runtime — implements workflow.js's five injected ambients
// (agent, parallel, phase, log, args) over `codex exec`.
//
// Bounded to exactly what workflow.js and workflow-simple.js call. Nothing here
// reimplements the Workflow engine; it reproduces the runtime surface those two
// scripts exercise, and the unit tests pin that surface.
//
// HARD CONSTRAINT (spike-workflow-module.md): `codex exec` must be spawned in a
// normal process context — a child of the Codex session running the orchestrator
// — never nested under a foreign agent's sandbox, or the code-mode host cannot
// negotiate and every tool call fails while the process still exits 0. This
// module spawns with plain child_process.spawn and adds no sandbox wrapper.
//
// RESULT CHANNEL. Never trust `codex exec --output-schema` stdout: under tools
// it silently degrades the structured output to YAML/plain text while exiting 0
// (Codex issue #15451, closed as model behaviour with schema validation as the
// maintainer's workaround). Instead every schema-bearing agent() augments its
// prompt to write the result as JSON to a module-provided absolute path; the
// module reads, parses, and validates that file against the schema, retrying and
// then throwing so workflow.js's own withRetry catches the failure.
//
// HEARTBEAT. Codex writes no agent-*.jsonl transcripts, so the monitor polyfill
// polls a heartbeat file this module maintains. See HEARTBEAT SHAPE below.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn as nodeSpawn, execFileSync } from "node:child_process";

// ── Concurrency cap ──────────────────────────────────────────────────
//
// Matches the Claude Workflow runtime: min(16, CPUs − 2), never below 1.
// workflow.js hands every sibling task to parallel() at once (line 475),
// trusting this cap to exist; without it each sibling would launch a bare
// `codex exec` subprocess and its own worktree, all contending on the object
// store at once.
export function concurrencyCap(cpus = os.cpus().length) {
  return Math.max(1, Math.min(16, cpus - 2));
}

// ── Minimal JSON-schema validator ────────────────────────────────────
//
// Covers the subset workflow.js's schemas use: object/array/string/boolean/
// number, properties, required, items, enum. Unknown keywords are ignored;
// extra properties are allowed. Throws on the first mismatch, path included.
export function validateAgainstSchema(value, schema, at = "$") {
  if (!schema || typeof schema !== "object") return;
  const t = schema.type;
  if (t === "object") {
    if (value === null || typeof value !== "object" || Array.isArray(value))
      throw new Error(`${at}: expected object`);
    for (const key of schema.required || []) {
      if (!(key in value)) throw new Error(`${at}.${key}: required, missing`);
    }
    for (const [key, sub] of Object.entries(schema.properties || {})) {
      if (key in value) validateAgainstSchema(value[key], sub, `${at}.${key}`);
    }
  } else if (t === "array") {
    if (!Array.isArray(value)) throw new Error(`${at}: expected array`);
    if (schema.items)
      value.forEach((el, i) => validateAgainstSchema(el, schema.items, `${at}[${i}]`));
  } else if (t === "string") {
    if (typeof value !== "string") throw new Error(`${at}: expected string`);
  } else if (t === "boolean") {
    if (typeof value !== "boolean") throw new Error(`${at}: expected boolean`);
  } else if (t === "number" || t === "integer") {
    if (typeof value !== "number") throw new Error(`${at}: expected number`);
  }
  if (schema.enum && !schema.enum.includes(value))
    throw new Error(`${at}: not one of ${JSON.stringify(schema.enum)}`);
}

// ── Result-channel prompt augmentation ───────────────────────────────
//
// The agent gets the absolute result path in its prompt (the faithful channel:
// no env var or side door the real model would not read). It writes only the
// JSON there.
export function augmentResultPrompt(prompt, schema, resultPath) {
  return `${prompt}

## Structured result (required)

When your work is complete, write your result as a single JSON object to this exact absolute path, and write nothing else to that file:

${resultPath}

The JSON must conform to this schema:

${JSON.stringify(schema, null, 2)}

Write only the JSON object — no prose, no code fences, no Markdown, and no other content in that file. This file is how your result is read; nothing on stdout is used.`;
}

// ── Commit-landing cross-check (defense-in-depth) ────────────────────
//
// The exact query workflow.js's confirmFromGit uses for worktree tasks:
// `git log --branches --not <base> --grep '^<id>: '`, then discard any
// candidate whose subject does not start with `<id>: ` (--grep matches the body
// too). Returns the surviving commit hashes, newest first.
export function confirmCommitLanded(id, { repoRoot, baseBranch }) {
  const out = execFileSync(
    "git",
    ["-C", repoRoot, "log", "--branches", "--not", baseBranch, "--grep", `^${id}: `, "--format=%H%x00%s"],
    { encoding: "utf8" }
  );
  return out
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [hash, subject] = line.split("\x00");
      return { hash, subject: subject ?? "" };
    })
    .filter((e) => e.subject.startsWith(`${id}: `))
    .map((e) => e.hash);
}

// Task id carried by an exec/confirm label, e.g. "confirm:task-1" → "task-1".
function idFromLabel(label) {
  const m = /^(?:confirm|exec):(.+)$/.exec(label || "");
  return m ? m[1] : null;
}

function slug(s) {
  return String(s).replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 60);
}

// ── Runtime factory ──────────────────────────────────────────────────
//
// config:
//   repoRoot      — the checkout `codex exec` and git run against (required)
//   baseBranch    — base for worktree provisioning and the commit cross-check
//   runId         — namespaces worktree branches and result files
//   args          — opaque, passed straight through as the `args` ambient
//   workDir       — where result files, last-message files, and the heartbeat
//                   live (default <repoRoot>/.speccy/<runId>/codex)
//   worktreeRoot  — where worktrees are created (default <repoRoot>/.claude/worktrees)
//   heartbeatPath — default <workDir>/heartbeat.json
//   codexBin      — the codex executable (default "codex")
//   codexArgsPrefix — args before "exec" (tests point codexBin at node and pass
//                   the fake script here)
//   spawn         — child_process.spawn injection point (default node's spawn)
//   cpus          — CPU count for the concurrency cap (default os.cpus().length)
//   retries       — codex-exec attempts per schema-bearing agent() (default 2)
//   modelFlag     — the codex flag that selects a model (default "--model";
//                   verify against current codex docs at integration time)
//
// Returns the five ambients plus a dispose() teardown and inspectable state.
export function createCodexRuntime(config = {}) {
  const {
    repoRoot,
    baseBranch = "main",
    runId = "run",
    args = {},
    codexBin = "codex",
    codexArgsPrefix = [],
    spawn = nodeSpawn,
    cpus = os.cpus().length,
    retries = 2,
    modelFlag = "--model"
  } = config;
  if (!repoRoot) throw new Error("createCodexRuntime: repoRoot is required");

  const workDir = config.workDir || path.join(repoRoot, ".speccy", runId, "codex");
  const worktreeRoot =
    config.worktreeRoot || path.join(repoRoot, ".claude", "worktrees");
  const heartbeatPath = config.heartbeatPath || path.join(workDir, "heartbeat.json");
  fs.mkdirSync(workDir, { recursive: true });

  const worktrees = []; // { branch, path } — every worktree this module created
  let currentPhase = null;
  let callSeq = 0;

  // ── HEARTBEAT SHAPE ────────────────────────────────────────────────
  // Two fields, and only two:
  //   mtime — epoch ms of the newest subprocess activity (spawn, stdout/stderr
  //           data, or exit). At parity with Claude's liveness signal (the
  //           newest transcript mtime).
  //   alive — true while ≥1 `codex exec` subprocess is running. A weaker
  //           stand-in for Claude's in-flight (tool_use-without-tool_result)
  //           check: it cannot tell a working subprocess from a hung one.
  let liveCount = 0;
  let lastActivity = Date.now();
  function heartbeat() {
    lastActivity = Date.now();
    fs.writeFileSync(
      heartbeatPath,
      JSON.stringify({ mtime: lastActivity, alive: liveCount > 0 })
    );
  }
  heartbeat(); // an initial beat so the monitor has a file to poll immediately

  function git(gitArgs, cwd = repoRoot) {
    return execFileSync("git", ["-C", cwd, ...gitArgs], { encoding: "utf8" });
  }

  function runCodex(execArgs, cwd) {
    return new Promise((resolve, reject) => {
      liveCount++;
      heartbeat();
      let settled = false;
      const done = (fn, arg) => {
        if (settled) return;
        settled = true;
        liveCount--;
        heartbeat();
        fn(arg);
      };
      const child = spawn(codexBin, [...codexArgsPrefix, ...execArgs], {
        cwd,
        stdio: ["ignore", "pipe", "pipe"]
      });
      child.stdout && child.stdout.on("data", heartbeat);
      child.stderr && child.stderr.on("data", heartbeat);
      child.on("error", (e) => done(reject, e));
      child.on("close", (code) => done(resolve, { code }));
    });
  }

  function log(msg) {
    process.stderr.write(`[codex-runtime] ${msg}\n`);
  }

  function phase(name) {
    currentPhase = name;
  }

  function provisionWorktree(label) {
    const branch = `${runId}/${slug(label)}-${++callSeq}`;
    const wtPath = path.join(worktreeRoot, slug(branch));
    fs.mkdirSync(worktreeRoot, { recursive: true });
    // Empty worktree only. gitignored-state recreation stays with workflow.js's
    // args.worktreeInit prompt injection, which runs inside the spawned agent.
    git(["worktree", "add", "-b", branch, wtPath, baseBranch]);
    worktrees.push({ branch, path: wtPath });
    return { branch, path: wtPath };
  }

  async function agent(prompt, opts = {}) {
    const { schema, isolation, label = "agent", model } = opts;
    const id = `${slug(label)}-${++callSeq}`;

    let cwd = repoRoot;
    let branch = null;
    if (isolation === "worktree") {
      const wt = provisionWorktree(label);
      cwd = wt.path;
      branch = wt.branch;
    }

    const lastMsgPath = path.join(workDir, `${id}.last.txt`);
    const resultPath = schema ? path.join(workDir, `${id}.result.json`) : null;
    const finalPrompt = schema
      ? augmentResultPrompt(prompt, schema, resultPath)
      : prompt;

    const execArgs = [
      "exec",
      "-C",
      cwd,
      "-o",
      lastMsgPath,
      "--dangerously-bypass-approvals-and-sandbox"
    ];
    if (model) execArgs.push(modelFlag, model);
    execArgs.push(finalPrompt);

    // Non-schema call: run once, return the agent's prose (its -o last message).
    // A non-zero exit is a failed call, not a good result with stale/partial
    // prose — throw so withRetry (or the direct caller) sees the failure.
    if (!schema) {
      const { code } = await runCodex(execArgs, cwd);
      if (code !== 0) throw new Error(`${label}: codex exec exited with code ${code}`);
      return readIfPresent(lastMsgPath);
    }

    // Schema call: run, read the result file, validate. Retry the whole exec on
    // a non-zero exit or a missing/malformed/invalid file; throw after `retries`
    // so withRetry (or the direct caller) sees the failure the same way it does
    // today.
    let lastErr;
    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        fs.rmSync(resultPath, { force: true });
      } catch {}
      try {
        const { code } = await runCodex(execArgs, cwd);
        if (code !== 0) throw new Error(`codex exec exited with code ${code}`);
        const raw = fs.readFileSync(resultPath, "utf8");
        const parsed = JSON.parse(raw);
        validateAgainstSchema(parsed, schema);
        crossCheckCommit(label, parsed);
        return parsed;
      } catch (e) {
        lastErr = e;
        log(`${label}: result file attempt ${attempt + 1}/${retries} failed (${String(e).slice(0, 120)})`);
      }
    }
    throw new Error(`${label}: no schema-valid result file after ${retries} attempts: ${lastErr}`);
  }

  // Defense-in-depth only: log a discrepancy, never override the file result.
  function crossCheckCommit(label, result) {
    const id = idFromLabel(label);
    if (!id || !result || result.success !== true || typeof result.commit !== "string")
      return;
    try {
      const landed = confirmCommitLanded(id, { repoRoot, baseBranch });
      if (!landed.includes(result.commit))
        log(`${label}: reported commit ${result.commit} not found by git cross-check (branches: ${landed.join(", ") || "none"})`);
    } catch (e) {
      log(`${label}: commit cross-check errored (${String(e).slice(0, 80)})`);
    }
  }

  async function parallel(fns) {
    const cap = concurrencyCap(cpus);
    const results = new Array(fns.length);
    let next = 0;
    let stopped = false;
    let firstError = null;
    async function worker() {
      while (!stopped) {
        const i = next++;
        if (i >= fns.length) return;
        try {
          results[i] = await fns[i]();
        } catch (e) {
          // Stop every worker from picking up new work; let whatever is
          // already in flight on the other workers finish (Promise.all below
          // still waits for them) rather than leaving them running unawaited.
          stopped = true;
          if (!firstError) firstError = e;
          return;
        }
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(cap, fns.length) }, () => worker())
    );
    if (firstError) throw firstError;
    return results;
  }

  // Tear down the EMPTY worktrees this module created. Never --force: a dirty
  // tree may hold work that never landed, so a tree that will not remove cleanly
  // is left in place (workflow.js's cleanup agent handles filled trees). This is
  // idempotent — safe to call more than once and after git worktree prune.
  async function dispose() {
    try {
      git(["worktree", "prune"]);
    } catch {}
    for (const wt of worktrees) {
      try {
        const dirty = git(["status", "--porcelain"], wt.path).trim();
        if (dirty === "") git(["worktree", "remove", wt.path]);
        else log(`dispose: leaving dirty worktree ${wt.branch}`);
      } catch {
        // path already gone or not a worktree — prune below covers it.
      }
    }
    try {
      git(["worktree", "prune"]);
    } catch {}
  }

  return {
    // the five ambients workflow.js injects
    agent,
    parallel,
    phase,
    log,
    args,
    // lifecycle + inspection
    dispose,
    confirmCommitLanded: (id) => confirmCommitLanded(id, { repoRoot, baseBranch }),
    worktrees,
    heartbeatPath,
    workDir,
    get currentPhase() {
      return currentPhase;
    }
  };
}

function readIfPresent(p) {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return null;
  }
}
