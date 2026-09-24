// speccy thin orchestrator thread — the pipeline's spine with none of its loops.
//
//   skill load → one delegated subagent, round-tripped through its file →
//   state.mjs advances a phase.
//
// It proves the three joints hold together without running a full
// critique/build/review loop. Runs identically on both harnesses; the delegated
// subagent uses the harness's resolved spawn mechanism (the local smoke agent
// here, or a real `codex exec` child with --real-codex). Run with:
//
//   node test/thin-thread.mjs --harness claude
//   node test/thin-thread.mjs --harness codex

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { resolveBinding } from '../skills/speccy/binding.mjs'
import { createCodexRuntime } from '../adapters/codex/workflow-runtime.mjs'

const REPO = path.resolve(fileURLToPath(import.meta.url), '..', '..')
const STATE_CLI = path.join(REPO, 'skills', 'speccy', 'state.mjs')

const argv = process.argv.slice(2)
const harnessFlag = argv.indexOf('--harness')
const harness = harnessFlag >= 0 ? argv[harnessFlag + 1] : 'claude'
const realCodex = argv.includes('--real-codex')

// The delegated subagent: a real subprocess that writes its result to a file.
// speccy reads that file, never the return value.
const DELEGATE = String.raw`
import fs from 'node:fs'
const argv = process.argv.slice(2)
const cIdx = argv.indexOf('-C')
const cwd = cIdx >= 0 ? argv[cIdx + 1] : process.cwd()
const oIdx = argv.indexOf('-o')
if (oIdx >= 0) fs.writeFileSync(argv[oIdx + 1], 'delegate summary (ignored)\n')
fs.writeFileSync(cwd + '/delegate-output.txt', 'the delegated subagent did the work\n')
process.exit(0)
`

function log(step, detail) {
  process.stdout.write(`  [ok] ${step.padEnd(28)} ${detail}\n`)
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'speccy-thin-'))
const g = (...a) => execFileSync('git', ['-C', root, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
const state = (...a) =>
  execFileSync(process.execPath, [STATE_CLI, ...a], { cwd: root, encoding: 'utf8' })

try {
  process.stdout.write(`\nspeccy thin thread — harness: ${harness}${realCodex ? ' (real codex)' : ' (scripted agent)'}\n\n`)

  // ── Joint 1: skill load ────────────────────────────────────────────
  // The orchestrator resolves its binding and loads the skill body at the start
  // of the conversation.
  const binding = resolveBinding(harness)
  const skillBody = fs.readFileSync(path.join(REPO, 'skills', 'speccy', 'SKILL.md'), 'utf8')
  assert.match(skillBody, /^name:\s*speccy/m, 'the speccy skill loaded')
  assert.match(skillBody, /## Resolve the harness binding/, 'the skill carries the binding step')
  log('skill load', `speccy loaded; binding → ${binding.instructionFile}`)

  // ── Joint 2: one delegated subagent, round-tripped through its file ──
  g('init', '-b', 'main')
  g('config', 'user.email', 'thin@example.com')
  g('config', 'user.name', 'Thin')
  fs.writeFileSync(path.join(root, 'README'), 'seed\n')
  g('add', '.')
  g('commit', '-m', 'seed')

  const delegatePath = path.join(root, 'delegate.mjs')
  fs.writeFileSync(delegatePath, DELEGATE)
  const rt = createCodexRuntime({
    repoRoot: root,
    runId: 'thin-20260924-0000',
    ...(realCodex
      ? { codexBin: 'codex', codexArgsPrefix: [] }
      : { codexBin: process.execPath, codexArgsPrefix: [delegatePath] }),
  })
  await rt.agent('do one unit of delegated work', { label: 'exec:delegate' })
  await rt.dispose()
  const roundTripped = fs.readFileSync(path.join(root, 'delegate-output.txt'), 'utf8').trim()
  assert.equal(roundTripped, 'the delegated subagent did the work', 'read the delegate result from its file')
  log('delegated subagent', 'result round-tripped through its file')

  // ── Joint 3: state.mjs advances a phase ─────────────────────────────
  // A run on a feature branch, its spec committed, advances one forward edge:
  // spec-draft → spec-critique. One phase move, none of the loops.
  const runId = 'thin-20260924-0000'
  fs.mkdirSync(path.join(root, 'specs'), { recursive: true })
  const specPath = 'specs/thin.md'
  state('init', '--run', runId, '--slug', 'thin', '--base-branch', 'main',
    '--spec-path', specPath, '--decision-log-path', 'DECISION_LOG.md')
  g('checkout', '-b', 'thin-feature')
  fs.writeFileSync(path.join(root, specPath), '# Thin spec\n\nStatus: Draft\n')
  g('add', specPath)
  g('commit', '-m', 'add thin spec')
  const before = JSON.parse(fs.readFileSync(path.join(root, '.speccy', runId, 'state.json'), 'utf8')).phase
  const advanceOut = state('advance', 'spec-critique', '--run', runId)
  const after = JSON.parse(fs.readFileSync(path.join(root, '.speccy', runId, 'state.json'), 'utf8')).phase
  assert.equal(before, 'spec-draft', 'started at spec-draft')
  assert.equal(after, 'spec-critique', 'advanced to spec-critique')
  assert.match(advanceOut, /advanced spec-draft -> spec-critique/, 'state.mjs reported the move')
  log('state.mjs phase advance', `${before} → ${after}`)

  process.stdout.write('\nthin thread: 3/3 joints held.\n')
} catch (err) {
  process.stdout.write(`\nthin thread FAILED: ${err.message}\n`)
  process.exitCode = 1
} finally {
  fs.rmSync(root, { recursive: true, force: true })
}
