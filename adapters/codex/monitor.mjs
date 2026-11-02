// Codex monitor polyfill — the liveness/in-flight glue the watchdog polls.
//
// Claude Code's watchdog tails per-agent `agent-*.jsonl` transcripts for two
// things: the newest transcript mtime (liveness), and, before a Tier-2 auto-stop,
// whether a tool is still in flight (the transcript's last entry is a `tool_use`
// with no matching `tool_result`). Codex writes no such transcripts, so the
// workflow runtime (adapters/codex/workflow-runtime.mjs) maintains a heartbeat
// file instead, with exactly two fields:
//
//   mtime — epoch MILLISECONDS of the newest `codex exec` subprocess activity
//           (spawn, stdout/stderr, or exit). At parity with Claude's liveness
//           signal (the newest transcript mtime).
//   alive — true while ≥1 `codex exec` subprocess is running. A weaker stand-in
//           for Claude's in-flight check: it cannot tell a working subprocess
//           from a hung one, the exact case tool_use-without-tool_result caught.
//
// This module reads those two fields for the poll loop. The poll-loop prose is
// harness-neutral and lives in plan-execution/SKILL.md, reading "the heartbeat's
// two fields" through the binding; the binding points its monitor mechanism at
// this glue and at the heartbeat path the runtime reports (its `heartbeatPath`).
//
// The `alive` field is defined and read here; its Tier-2 confirm-before-stop
// path need not fire in the smoke test.

import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'

// A missing, unreadable, or malformed file is null: a monitor must never crash
// the run it is watching.
function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch {
    return null
  }
}

// Read and shape-check the heartbeat. Returns { mtime, alive }, or null when
// there is no usable file — the same "no signal" the bash loop treats as 0.
export function readHeartbeat(heartbeatPath) {
  const hb = readJson(heartbeatPath)
  if (hb === null || typeof hb !== 'object' || typeof hb.mtime !== 'number' || typeof hb.alive !== 'boolean') {
    return null
  }
  return { mtime: hb.mtime, alive: hb.alive }
}

// The liveness signal in epoch SECONDS, so it drops straight into the bash poll
// loop where Claude uses `stat -f %m` (also seconds). 0 when there is no
// heartbeat yet — matching the loop's `|| echo 0` fallback.
export function livenessSeconds(heartbeatPath) {
  const hb = readHeartbeat(heartbeatPath)
  return hb ? Math.floor(hb.mtime / 1000) : 0
}

// The in-flight check the watchdog runs before a Tier-2 auto-stop: is a
// `codex exec` subprocess presently working? A missing heartbeat reads as not
// alive (nothing is running to protect from a stop).
export function isWorkInFlight(heartbeatPath) {
  const hb = readHeartbeat(heartbeatPath)
  return hb ? hb.alive : false
}

// The run's status file, written by run-workflow.mjs. This is how a Codex
// orchestrator learns what the run is doing and that it finished, since Codex
// sends no completion notification. Returns the file's object, with state
// "starting" before the runner's first write and "died" when the file still
// says running but the runner's process is gone (killed, or crashed before it
// could record a failure).
export function readStatus(statusPath, isAlive = pidAlive) {
  const status = readJson(statusPath)
  if (status === null) return { state: 'starting' }
  if (status.state === 'running' && !isAlive(status.pid)) return { ...status, state: 'died' }
  return status
}

function pidAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return e.code === 'EPERM'
  }
}

// ---------------------------------------------------------------- entry point
//
// CLI for the bash poll loop, so it reads the heartbeat exactly where the Claude
// loop stats a transcript:
//   node monitor.mjs mtime <heartbeatPath>   → liveness in epoch seconds (or 0)
//   node monitor.mjs alive <heartbeatPath>   → "1" if a subprocess is live, else "0"
//   node monitor.mjs status <statusPath>     → the run's status (see readStatus)
export function main(argv = process.argv.slice(2)) {
  const [field, heartbeatPath] = argv
  if (!field || !heartbeatPath) {
    process.stderr.write('usage: monitor.mjs <mtime|alive|status> <path>\n')
    return 2
  }
  if (field === 'status') {
    process.stdout.write(`${JSON.stringify(readStatus(heartbeatPath))}\n`)
    return 0
  }
  if (field === 'mtime') {
    process.stdout.write(`${livenessSeconds(heartbeatPath)}\n`)
    return 0
  }
  if (field === 'alive') {
    process.stdout.write(`${isWorkInFlight(heartbeatPath) ? '1' : '0'}\n`)
    return 0
  }
  process.stderr.write(`monitor: unknown field "${field}" (mtime|alive|status)\n`)
  return 2
}

const thisFile = fileURLToPath(import.meta.url)
if (process.argv[1] && path.resolve(process.argv[1]) === thisFile) {
  process.exit(main())
}
