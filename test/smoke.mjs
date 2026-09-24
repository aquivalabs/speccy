// speccy harness-binding smoke test — one probe per capability in the spec's
// Completion criteria, scripted so a reviewer can run it, and identical on both
// harnesses. Run with:
//
//   node test/smoke.mjs --harness claude     (the PR gate; run on Claude Code)
//   node test/smoke.mjs --harness codex      (run from a Codex session)
//
// Each probe drives the REAL binding, loader, workflow runtime module, monitor
// polyfill, and state CLI. Where a probe needs a working subagent it spawns a
// real local subprocess (the smoke agent written below) that does genuine
// file + shell + result-file work in real git worktrees — no tokens, no LLM,
// harness-independent. That exercises every mechanism's plumbing end to end.
//
// The one thing this scripted run does NOT do is drive a harness's *native*
// agent surface (Claude Code's Agent/Workflow tools, or a real `codex exec`
// child of a Codex session): a plain node script cannot call those. Those are
// the optional live validations. `--real-codex` swaps the local smoke agent for
// the real Codex binary when this runs inside a Codex session; the Claude-native
// path is confirmed live by the orchestrator, not from node.

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import {
  resolveBinding,
  resolveModel,
  REQUIRED_MECHANISMS,
  RUNGS,
} from '../skills/speccy/binding.mjs'
import { loadWorkflow } from '../adapters/codex/loader.mjs'
import {
  createCodexRuntime,
  validateAgainstSchema,
} from '../adapters/codex/workflow-runtime.mjs'
import {
  readHeartbeat,
  livenessSeconds,
  isWorkInFlight,
} from '../adapters/codex/monitor.mjs'

const REPO = path.resolve(fileURLToPath(import.meta.url), '..', '..')

// ── args ────────────────────────────────────────────────────────────
const argv = process.argv.slice(2)
const harnessFlag = argv.indexOf('--harness')
const harness = harnessFlag >= 0 ? argv[harnessFlag + 1] : 'claude'
const realCodex = argv.includes('--real-codex')

// ── the smoke agent: a real subprocess that stands in for a tool-using ────
// subagent. The runtime spawns it exactly as it spawns codex (codexBin=node,
// codexArgsPrefix=[this file]), so the real spawn / -C / -o / result-path shapes
// are exercised. It reads and writes a file, runs a shell command, applies any
// "## Worktree setup" commands the prompt carries (workflow.js injects them as a
// bulleted list), and writes its result as schema-valid JSON to the path the
// prompt names. It uses String.fromCharCode(96) for a backtick rather than a
// literal one, so this source can stay a raw template with no escaping.
const SMOKE_AGENT = String.raw`
import fs from 'node:fs'
import { execSync } from 'node:child_process'

const BT = String.fromCharCode(96)
const argv = process.argv.slice(2)
const oIdx = argv.indexOf('-o')
const lastMsgPath = oIdx >= 0 ? argv[oIdx + 1] : null
const cIdx = argv.indexOf('-C')
const cwd = cIdx >= 0 ? argv[cIdx + 1] : process.cwd()
const prompt = argv[argv.length - 1] || ''

if (lastMsgPath) fs.writeFileSync(lastMsgPath, 'smoke agent done\n')

// Apply worktree-init commands the prompt carries (workflow.js's
// worktreeInitSection injects them as a "- BT cmd BT" list under "## Worktree
// setup"). Recreate the gitignored state before any other work.
const applied = []
const setupIdx = prompt.indexOf('## Worktree setup')
if (setupIdx >= 0) {
  const listItem = new RegExp('^-\\s+' + BT + '(.+)' + BT + '\\s*$')
  for (const line of prompt.slice(setupIdx).split('\n')) {
    const m = listItem.exec(line)
    if (m) {
      execSync(m[1], { cwd, stdio: 'ignore' })
      applied.push(m[1])
    }
  }
}

// Genuine tool use: write a file, read it back, run a shell command — all in the
// task's own cwd (its worktree when isolated).
const wrotePath = cwd + '/smoke-agent-wrote.txt'
fs.writeFileSync(wrotePath, 'work by ' + (process.env.SMOKE_TASK || 'task') + '\n')
const readBack = fs.readFileSync(wrotePath, 'utf8').trim()
const shellOut = execSync('git rev-parse --abbrev-ref HEAD', { cwd, encoding: 'utf8' }).trim()

const resultMatch = /(\/\S+\.result\.json)/.exec(prompt)
if (resultMatch) {
  fs.writeFileSync(resultMatch[1], JSON.stringify({
    ok: true, wrote: readBack, shell: shellOut, cwd, applied,
  }))
}
process.exit(0)
`

// A minimal workflow.js: the export-const-meta + top-level-return shape the real
// one has, using all five ambients, fanning out parallel worktree-isolated
// schema-bearing agent() calls. It reproduces workflow.js's args.worktreeInit
// prompt injection so P5 exercises that exact path.
const MINIMAL_WORKFLOW = String.raw`export const meta = { name: "smoke-fanout", phases: [{ title: "Fan out" }] };
const BT = String.fromCharCode(96);
const parsed = typeof args === "string" ? JSON.parse(args) : args;
phase("Fan out");
log("fanning out " + parsed.tasks.length + " tasks");
function worktreeInitSection() {
  if (!parsed.worktreeInit || parsed.worktreeInit.length === 0) return "";
  return "\n\n## Worktree setup\n\nYour worktree is missing gitignored files the toolchain needs. Run these commands first, before any other work. Stop and report if any command fails.\n\n" +
    parsed.worktreeInit.map((c) => "- " + BT + c + BT).join("\n");
}
const out = await parallel(parsed.tasks.map((t) => () =>
  agent(t.prompt + worktreeInitSection(), {
    label: "exec:" + t.id,
    isolation: "worktree",
    schema: parsed.schema,
  })
));
return { results: out };
`

// The schema the smoke agent's result must satisfy (a small STEP_SCHEMA-shaped
// object the runtime validates).
const SMOKE_SCHEMA = {
  type: 'object',
  properties: {
    ok: { type: 'boolean' },
    wrote: { type: 'string' },
    shell: { type: 'string' },
    cwd: { type: 'string' },
    applied: { type: 'array', items: { type: 'string' } },
  },
  required: ['ok', 'wrote', 'shell', 'cwd'],
}

// ── a throwaway git repo, the state.test.mjs pattern ─────────────────
function makeRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'speccy-smoke-'))
  const g = (...a) => execFileSync('git', ['-C', root, ...a], { stdio: 'ignore' })
  g('init', '-b', 'main')
  g('config', 'user.email', 'smoke@example.com')
  g('config', 'user.name', 'Smoke')
  fs.writeFileSync(path.join(root, 'README'), 'seed\n')
  g('add', '.')
  g('commit', '-m', 'seed')
  return { root, g, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) }
}

function writeAgentInto(dir) {
  const p = path.join(dir, 'smoke-agent.mjs')
  fs.writeFileSync(p, SMOKE_AGENT)
  return p
}

// codexBin/prefix the runtime spawns: the local smoke agent, or the real codex.
function agentSpawnConfig(agentPath) {
  return realCodex
    ? { codexBin: 'codex', codexArgsPrefix: [] }
    : { codexBin: process.execPath, codexArgsPrefix: [agentPath] }
}

// ── parse the `## Worktree init` section of an instruction file ───────
function parseWorktreeInit(text) {
  const lines = text.split('\n')
  const start = lines.findIndex((l) => /^##\s+Worktree init\b/i.test(l))
  if (start < 0) return []
  const cmds = []
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s/.test(lines[i])) break // next heading ends the section
    const m = /^-\s+`(.+)`\s*$/.exec(lines[i])
    if (m) cmds.push(m[1])
  }
  return cmds
}

// ── probe harness ────────────────────────────────────────────────────
const results = []
async function probe(name, fn) {
  try {
    const detail = (await fn()) || 'ok'
    results.push({ name, status: 'PASS', detail })
  } catch (err) {
    results.push({ name, status: 'FAIL', detail: err.message })
  }
}

// ════════════════════════════════════════════════════════════════════
// P1 — the skill loads and triggers.
// Scripted proxy: both SKILL.md files carry a name + a trigger description and
// are discoverable by each harness (Claude via .claude-plugin/, Codex via the
// .agents/skills symlinks). Real triggering is confirmed live by the orchestrator.
await probe('skill loads and triggers', () => {
  for (const skill of ['speccy', 'plan-execution']) {
    const md = fs.readFileSync(path.join(REPO, 'skills', skill, 'SKILL.md'), 'utf8')
    const fm = /^---\n([\s\S]*?)\n---/.exec(md)
    assert.ok(fm, `${skill}/SKILL.md has YAML frontmatter`)
    assert.match(fm[1], /^name:\s*\S/m, `${skill} names itself`)
    assert.match(fm[1], /^(?:description|when_to_use):\s*\S/m, `${skill} has a trigger description`)
    assert.ok(fs.existsSync(path.join(REPO, '.agents', 'skills', skill)),
      `${skill} discoverable under .agents/skills`)
  }
  assert.ok(fs.existsSync(path.join(REPO, '.claude-plugin', 'plugin.json')), 'plugin manifest present')
  return 'both SKILL.md discoverable + triggerable; live trigger confirmed by orchestrator'
})

// ════════════════════════════════════════════════════════════════════
// P2 — the binding resolves at conversation start.
await probe('binding resolves at conversation start', () => {
  const b = resolveBinding(harness)
  assert.equal(b.harness, harness)
  assert.ok(Object.isFrozen(b), 'binding held frozen in memory')
  for (const key of REQUIRED_MECHANISMS) assert.ok(b.mechanisms[key], `${key} bound`)
  assert.ok(b.instructionFile, 'instruction file named')
  assert.deepEqual(resolveBinding(harness), b) // re-runs cleanly on a fresh conversation
  return `${harness} → ${b.instructionFile}, ${REQUIRED_MECHANISMS.length} mechanisms bound`
})

// ════════════════════════════════════════════════════════════════════
// P3 — a spawned subagent writes a file that speccy reads.
// The orchestrator-native spawn contract: speccy reads the file the agent wrote,
// not its returned summary. A real subprocess plays the subagent.
await probe('spawned subagent writes a file speccy reads', async () => {
  const { root, cleanup } = makeRepo()
  try {
    const agentPath = writeAgentInto(root)
    const rt = createCodexRuntime({
      repoRoot: root, runId: 'smoke-20260924-0000', ...agentSpawnConfig(agentPath),
    })
    await rt.agent('write your result file', { label: 'exec:probe-3' })
    await rt.dispose()
    const written = fs.readFileSync(path.join(root, 'smoke-agent-wrote.txt'), 'utf8')
    assert.match(written, /work by/, 'speccy read the file the subagent wrote')
    return 'file round-trip held (speccy read the written file, not the return)'
  } finally {
    cleanup()
  }
})

// ════════════════════════════════════════════════════════════════════
// P4 — a minimal workflow.js fans out parallel tool-using tasks through the
// workflow runtime module, worktree isolation held, each agent writing a
// schema-valid result the module validates.
await probe('workflow.js fans out parallel tasks through the module (isolation held)', async () => {
  const { root, cleanup } = makeRepo()
  try {
    const agentPath = writeAgentInto(root)
    const rt = createCodexRuntime({
      repoRoot: root,
      runId: 'smoke-20260924-0001',
      args: {
        tasks: [
          { id: 'p4a', prompt: 'do task a' },
          { id: 'p4b', prompt: 'do task b' },
          { id: 'p4c', prompt: 'do task c' },
        ],
        schema: SMOKE_SCHEMA,
      },
      ...agentSpawnConfig(agentPath),
    })
    const { meta, run } = loadWorkflow(MINIMAL_WORKFLOW)
    assert.equal(meta.name, 'smoke-fanout', 'the loader transformed the minimal workflow.js')
    const out = await run({
      agent: rt.agent, parallel: rt.parallel, phase: rt.phase, log: rt.log, args: rt.args,
    })
    assert.equal(out.results.length, 3, 'three results returned')
    for (const r of out.results) validateAgainstSchema(r, SMOKE_SCHEMA)
    assert.ok(out.results.every((r) => r.ok === true), 'every task succeeded')
    const cwds = new Set(out.results.map((r) => r.cwd))
    assert.equal(cwds.size, 3, 'each task ran in its own worktree')
    assert.equal(rt.worktrees.length, 3, 'the module provisioned three worktrees')
    for (const r of out.results) {
      assert.notEqual(path.resolve(r.cwd), path.resolve(root), 'no task ran on the main checkout')
      assert.match(r.shell, /^smoke-20260924-0001\//, 'the shell command ran on the worktree branch')
    }
    await rt.dispose()
    return 'three parallel tasks, three worktrees, three schema-valid results'
  } finally {
    cleanup()
  }
})

// ════════════════════════════════════════════════════════════════════
// P5 — a worktree task carrying gitignored state runs in a worktree with that
// state recreated from the resolved instruction file's `## Worktree init`
// section, via workflow.js's args.worktreeInit. Exercises the apply step AND the
// selection of the correct instruction file (CLAUDE.md / AGENTS.md) by binding.
await probe('worktree-init recreates gitignored state from the resolved instruction file', async () => {
  const { root, cleanup } = makeRepo()
  try {
    const binding = resolveBinding(harness)
    const instructionPath = path.join(root, binding.instructionFile)
    fs.writeFileSync(instructionPath, [
      '# Project', '', '## Worktree init', '',
      'Recreate the gitignored build marker the toolchain needs:', '',
      '- `mkdir -p build`',
      '- `echo generated > build/marker.txt`', '',
    ].join('\n'))
    fs.writeFileSync(path.join(root, '.gitignore'), 'build/\n')
    execFileSync('git', ['-C', root, 'add', '.gitignore', binding.instructionFile], { stdio: 'ignore' })
    execFileSync('git', ['-C', root, 'commit', '-m', 'add instruction file and gitignore'], { stdio: 'ignore' })

    const worktreeInit = parseWorktreeInit(fs.readFileSync(instructionPath, 'utf8'))
    assert.deepEqual(worktreeInit, ['mkdir -p build', 'echo generated > build/marker.txt'],
      'parsed the recreate commands from the resolved instruction file')

    const agentPath = writeAgentInto(root)
    const rt = createCodexRuntime({
      repoRoot: root,
      runId: 'smoke-20260924-0002',
      args: { tasks: [{ id: 'p5', prompt: 'do the smoke task' }], schema: SMOKE_SCHEMA, worktreeInit },
      ...agentSpawnConfig(agentPath),
    })
    const { run } = loadWorkflow(MINIMAL_WORKFLOW)
    const out = await run({
      agent: rt.agent, parallel: rt.parallel, phase: rt.phase, log: rt.log, args: rt.args,
    })
    const r = out.results[0]
    validateAgainstSchema(r, SMOKE_SCHEMA)
    assert.deepEqual(r.applied, worktreeInit, 'the worktree-init commands were applied')
    const marker = path.join(r.cwd, 'build', 'marker.txt')
    assert.ok(fs.existsSync(marker), 'gitignored build/marker.txt recreated in the worktree')
    assert.match(fs.readFileSync(marker, 'utf8'), /generated/)
    await rt.dispose()
    return `${binding.instructionFile} selected; gitignored state recreated in the worktree`
  } finally {
    cleanup()
  }
})

// ════════════════════════════════════════════════════════════════════
// P6 — the monitor is armed and polling its liveness signal.
await probe('monitor armed and polling its liveness signal', async () => {
  const { root, cleanup } = makeRepo()
  try {
    const agentPath = writeAgentInto(root)
    const rt = createCodexRuntime({
      repoRoot: root, runId: 'smoke-20260924-0003', ...agentSpawnConfig(agentPath),
    })
    const armed = readHeartbeat(rt.heartbeatPath)
    assert.ok(armed, 'the monitor has a heartbeat to poll (armed)')
    assert.equal(typeof armed.mtime, 'number')
    assert.equal(typeof armed.alive, 'boolean')
    const before = livenessSeconds(rt.heartbeatPath)
    await new Promise((r) => setTimeout(r, 5))
    await rt.agent('do it', { label: 'exec:probe-6' })
    assert.ok(livenessSeconds(rt.heartbeatPath) >= before, 'liveness advanced with activity')
    assert.equal(isWorkInFlight(rt.heartbeatPath), false, 'no subprocess in flight after the run')
    await rt.dispose()
    return 'heartbeat armed; liveness + in-flight polled through the polyfill'
  } finally {
    cleanup()
  }
})

// ════════════════════════════════════════════════════════════════════
// P7 — the model ladder resolves to concrete models.
await probe('model ladder resolves to concrete models', () => {
  const b = resolveBinding(harness)
  const resolved = {}
  for (const rung of RUNGS) {
    const model = resolveModel(b, rung)
    assert.ok(typeof model === 'string' && model.length > 0, `${rung} → a concrete model`)
    resolved[rung] = model
  }
  return RUNGS.map((r) => `${r}=${resolved[r]}`).join(' ')
})

// ════════════════════════════════════════════════════════════════════
// P8 — exactly one workflow.js, and the one file loads on both harnesses.
// This is the meaningful syntax gate for a loader-transformed file: `node
// --check` cannot pass on it, since by design it mixes `export const meta` with
// top-level `return`, which no single JS goal accepts. loadWorkflow's
// buildFactory compiles the body, so it throws on any real syntax error.
await probe('one workflow.js, loadable through the runtime (no fork)', () => {
  const found = execFileSync('git', ['-C', REPO, 'ls-files', '*workflow.js'], { encoding: 'utf8' })
    .split('\n').filter(Boolean)
  assert.deepEqual(found, ['skills/plan-execution/workflow.js'], 'exactly one workflow.js, unforked')
  for (const rel of ['skills/plan-execution/workflow.js', 'skills/plan-execution/workflow-simple.js']) {
    const src = fs.readFileSync(path.join(REPO, rel), 'utf8')
    const { meta } = loadWorkflow(src) // throws on any syntax error in the body
    assert.ok(meta && meta.name, `${rel} transforms and exposes meta`)
  }
  return 'single workflow.js; both scripts transform cleanly through the loader'
})

// ════════════════════════════════════════════════════════════════════
// P9 — the contract admits a third adapter (confirmed by inspection; a synthetic
// third adapter resolves with no core change).
await probe('contract admits a third adapter (by inspection)', () => {
  const third = {
    version: 1,
    harness: 'thirdharness',
    mechanisms: Object.fromEntries(REQUIRED_MECHANISMS.map((k) => [k, `thirdharness: ${k}`])),
    models: { S: 't-s', M: 't-m', L: 't-l', XL: 't-xl' },
    instructionFile: 'AGENTS.md',
  }
  const b = resolveBinding('thirdharness', third)
  assert.equal(b.harness, 'thirdharness')
  for (const key of REQUIRED_MECHANISMS) assert.ok(b.mechanisms[key])
  return 'a third adapter resolves through the same contract, no core change'
})

// ── report ───────────────────────────────────────────────────────────
const pad = Math.max(...results.map((r) => r.name.length))
process.stdout.write(`\nspeccy smoke test — harness: ${harness}${realCodex ? ' (real codex)' : ' (scripted agent)'}\n\n`)
for (const r of results) {
  const mark = r.status === 'PASS' ? 'PASS' : 'FAIL'
  process.stdout.write(`  [${mark}]  ${r.name.padEnd(pad)}  ${r.detail}\n`)
}
const failed = results.filter((r) => r.status === 'FAIL')
process.stdout.write(`\n${results.length - failed.length}/${results.length} probes passed.\n`)
if (failed.length) {
  process.stdout.write(`FAILED: ${failed.map((r) => r.name).join(', ')}\n`)
  process.exit(1)
}
process.exit(0)
