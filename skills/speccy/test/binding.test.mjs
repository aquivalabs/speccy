// Tests for binding.mjs. Run with: node --test skills/speccy/test/
//
// The resolver touches no disk, so these are plain in-memory assertions plus a
// CLI path driven through execFileSync (as state.test.mjs does) so exit codes
// are part of the assertion: a bad resolve exits non-zero.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

import { resolveBinding, resolveModel, REQUIRED_MECHANISMS, RUNGS } from '../binding.mjs'

const BINDING = path.resolve(import.meta.dirname, '..', 'binding.mjs')

// A complete adapter defaults object, for the injection path that exercises the
// validation branches. Mirrors the real adapters' shape.
function goodDefaults(overrides = {}) {
  return {
    version: 1,
    harness: 'fake',
    mechanisms: {
      'spawn-subagent.orchestrator-native': 'native subagents',
      'spawn-subagent.workflow-module': 'the workflow module agent()',
      'run-parallel': 'the workflow module parallel()',
      'monitor': 'the heartbeat poll loop',
    },
    models: { S: 's-model', M: 'm-model', L: 'l-model', XL: 'xl-model' },
    instructionFile: 'AGENTS.md',
    ...overrides,
  }
}

function cli(args) {
  try {
    const stdout = execFileSync(process.execPath, [BINDING, ...args], { encoding: 'utf8' })
    return { status: 0, stdout, stderr: '' }
  } catch (e) {
    return { status: e.status ?? 1, stdout: e.stdout?.toString() ?? '', stderr: e.stderr?.toString() ?? '' }
  }
}

// ------------------------------------------------------------ registered adapters

test('claude resolves to a complete binding', () => {
  const b = resolveBinding('claude')
  assert.equal(b.harness, 'claude')
  assert.deepEqual(b.models, { S: 'haiku', M: 'sonnet', L: 'opus', XL: 'fable' })
  assert.equal(b.instructionFile, 'CLAUDE.md')
  for (const key of REQUIRED_MECHANISMS) assert.ok(b.mechanisms[key], `${key} is bound`)
})

test('codex resolves to a complete binding with web-verified models', () => {
  const b = resolveBinding('codex')
  assert.equal(b.harness, 'codex')
  assert.equal(b.instructionFile, 'AGENTS.md')
  for (const rung of RUNGS) assert.match(b.models[rung], /^gpt-/, `${rung} maps to a Codex model`)
  for (const key of REQUIRED_MECHANISMS) assert.ok(b.mechanisms[key], `${key} is bound`)
})

// ------------------------------------------------------------ validation, loud

test('an unknown harness fails loud', () => {
  assert.throws(() => resolveBinding('opencode'), /unknown harness "opencode"/)
})

test('an empty harness identity fails loud', () => {
  assert.throws(() => resolveBinding(''), /needs a harness identity/)
})

test('a missing capability mechanism fails loud, naming the gap', () => {
  const defaults = goodDefaults()
  delete defaults.mechanisms['run-parallel']
  assert.throws(() => resolveBinding('fake', defaults), /missing a mechanism for: run-parallel/)
})

test('an unresolved rung fails loud, naming the rung', () => {
  const defaults = goodDefaults()
  delete defaults.models.L
  assert.throws(() => resolveBinding('fake', defaults), /leaves rung\(s\) unresolved: L/)
})

test('a missing instruction file fails loud', () => {
  const defaults = goodDefaults({ instructionFile: undefined })
  assert.throws(() => resolveBinding('fake', defaults), /names no instruction file/)
})

// ------------------------------------------------------------ purity

test('resolve is pure: two calls agree and write nothing to the binding', () => {
  const a = resolveBinding('claude')
  const b = resolveBinding('claude')
  assert.deepEqual(a, b)
  assert.ok(Object.isFrozen(a), 'the binding is frozen')
  assert.ok(Object.isFrozen(a.models), 'the model map is frozen')
})

// ------------------------------------------------------------ rung resolution

test('resolveModel maps a rung to its concrete model', () => {
  const b = resolveBinding('claude')
  assert.equal(resolveModel(b, 'L'), 'opus')
})

test('resolveModel rejects an unknown rung', () => {
  const b = resolveBinding('claude')
  assert.throws(() => resolveModel(b, 'XXL'), /not one of S\/M\/L\/XL/)
})

// ------------------------------------------------------------ CLI path

test('the CLI prints a resolved binding and exits zero', () => {
  const r = cli(['--harness', 'codex'])
  assert.equal(r.status, 0, r.stderr)
  const b = JSON.parse(r.stdout)
  assert.equal(b.instructionFile, 'AGENTS.md')
})

test('the CLI fails an unknown harness with a speccy binding message', () => {
  const r = cli(['--harness', 'nope'])
  assert.equal(r.status, 1)
  assert.match(r.stderr, /^speccy binding: unknown harness "nope"/)
})
