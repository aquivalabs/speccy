// Tests for state.mjs. Run with: node --test skills/speccy/test/
//
// Guard tests build a real throwaway git repo in a tmpdir, because the guards
// shell out to git; the CLI itself is driven through execFileSync so exit codes
// are part of the assertion (a refused transition throws, i.e. exits non-zero).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

import { parseArgs, transitionGuards, readState, PHASE_ORDER, TRANSITIONS } from '../state.mjs'

const STATE = path.resolve(import.meta.dirname, '..', 'state.mjs')
const RUN = 'demo-20260101-0900'
const SLUG = 'demo'
const SPEC = 'specs/demo.md'
const LOG = 'specs/demo-decision-log.md'

// ------------------------------------------------------------ harness

function repo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'speccy-state-'))
  const g = (...args) => execFileSync('git', args, { cwd: root, stdio: 'ignore' })
  g('init', '-b', 'main')
  g('config', 'user.email', 't@example.com')
  g('config', 'user.name', 'Test')
  fs.writeFileSync(path.join(root, 'README'), 'seed\n')
  g('add', '.')
  g('commit', '-m', 'seed')
  return { root, g, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) }
}

function cli(root, args) {
  try {
    const stdout = execFileSync(process.execPath, [STATE, ...args], { cwd: root, encoding: 'utf8' })
    return { status: 0, stdout, stderr: '' }
  } catch (e) {
    return { status: e.status ?? 1, stdout: e.stdout?.toString() ?? '', stderr: e.stderr?.toString() ?? '' }
  }
}

function init(root, extra = []) {
  return cli(root, [
    'init', '--run', RUN, '--slug', SLUG,
    '--base-branch', 'main', '--spec-path', SPEC, '--decision-log-path', LOG,
    ...extra,
  ])
}

function commitFile(root, g, rel, body) {
  const abs = path.join(root, rel)
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  fs.writeFileSync(abs, body)
  g('add', '--', rel)
  g('commit', '-m', `add ${rel}`)
}

// A full state.json written straight to disk, for verbs whose own guards are not
// under test (e.g. replan). Mirrors init's defaults.
function putState(root, partial) {
  const state = {
    runId: RUN, slug: SLUG, baseBranch: 'main', adversaryModel: 'opus', builderModel: 'sonnet',
    phase: 'spec-draft', specPath: SPEC, planPath: null, decisionLogPath: LOG,
    specCritiqueRounds: 0, planCritiqueRounds: 0, reviewRounds: 0,
    readabilityPasses: [], engagementQuestions: [], ...partial,
  }
  const dir = path.join(root, '.speccy', RUN)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify(state, null, 2) + '\n')
  return state
}

// ------------------------------------------------------------ arg parsing

test('parseArgs splits flags and positionals', () => {
  const { positionals, flags } = parseArgs(['spec-critique', '--run', RUN, '--gate', 'g'])
  assert.deepEqual(positionals, ['spec-critique'])
  assert.deepEqual(flags, { run: RUN, gate: 'g' })
})

test('a flag with no value is rejected', () => {
  assert.throws(() => parseArgs(['--run']), /flag --run needs a value/)
})

// ------------------------------------------------------------ the graph

test('PHASE_ORDER opens at spec-draft and ends at complete', () => {
  assert.equal(PHASE_ORDER[0], 'spec-draft')
  assert.equal(PHASE_ORDER[PHASE_ORDER.length - 1], 'complete')
})

test('every transition target is itself a known phase', () => {
  for (const [from, tos] of Object.entries(TRANSITIONS)) {
    assert.ok(PHASE_ORDER.includes(from), `${from} is a phase`)
    for (const to of tos) assert.ok(PHASE_ORDER.includes(to), `${to} is a phase`)
  }
})

// ------------------------------------------------------------ init

test('init writes state, the run-id pointer, and gitignores .speccy', () => {
  const { root, cleanup } = repo()
  const r = init(root)
  assert.equal(r.status, 0)
  const state = readState(root, RUN)
  assert.equal(state.phase, 'spec-draft')
  assert.equal(state.specPath, SPEC)
  assert.deepEqual(state.readabilityPasses, [])
  assert.equal(fs.readFileSync(path.join(root, '.speccy', '.current-runid'), 'utf8'), RUN)
  assert.match(fs.readFileSync(path.join(root, '.gitignore'), 'utf8'), /^\.speccy\/$/m)
  cleanup()
})

test('init refuses a run that already exists', () => {
  const { root, cleanup } = repo()
  init(root)
  const again = init(root)
  assert.equal(again.status, 1)
  assert.match(again.stderr, /already exists/)
  cleanup()
})

test('a malformed run id is refused', () => {
  const { root, cleanup } = repo()
  const r = cli(root, ['init', '--run', 'not-a-runid', '--slug', SLUG, '--base-branch', 'main', '--spec-path', SPEC, '--decision-log-path', LOG])
  assert.equal(r.status, 1)
  assert.match(r.stderr, /YYYYMMDD-HHmm/)
  cleanup()
})

test('a missing --run is refused', () => {
  const { root, cleanup } = repo()
  const r = cli(root, ['advance', 'spec-critique'])
  assert.equal(r.status, 1)
  assert.match(r.stderr, /required --run/)
  cleanup()
})

test('an unknown verb exits non-zero', () => {
  const { root, cleanup } = repo()
  const r = cli(root, ['teleport', '--run', RUN])
  assert.equal(r.status, 2)
  assert.match(r.stderr, /unknown verb/)
  cleanup()
})

// ------------------------------------------------------------ advance + guards

test('an illegal transition is refused with the legal set named', () => {
  const { root, cleanup } = repo()
  init(root)
  const r = cli(root, ['advance', 'planning', '--run', RUN])
  assert.equal(r.status, 1)
  assert.match(r.stderr, /illegal transition spec-draft -> planning/)
  assert.equal(readState(root, RUN).phase, 'spec-draft', 'state is left untouched')
  cleanup()
})

test('a phase move prints a next-step hint', () => {
  const { root, cleanup } = repo()
  const r = init(root)
  assert.match(r.stdout, /next: present the draft/)
  cleanup()
})

test('spec-draft -> spec-critique needs a committed spec on a feature branch', () => {
  const { root, g, cleanup } = repo()
  init(root)

  // uncommitted spec, still on the base branch: two reasons.
  fs.mkdirSync(path.join(root, 'specs'), { recursive: true })
  fs.writeFileSync(path.join(root, SPEC), '# Demo\n')
  const blocked = cli(root, ['advance', 'spec-critique', '--run', RUN])
  assert.equal(blocked.status, 1)
  assert.match(blocked.stderr, /spec .* uncommitted/)
  assert.match(blocked.stderr, /base branch/)
  assert.equal(readState(root, RUN).phase, 'spec-draft')

  // commit it and move to a feature branch: the guard clears.
  g('add', '--', SPEC)
  g('commit', '-m', 'spec')
  g('checkout', '-b', 'feature')
  const ok = cli(root, ['advance', 'spec-critique', '--run', RUN])
  assert.equal(ok.status, 0, ok.stderr)
  assert.equal(readState(root, RUN).phase, 'spec-critique')
  cleanup()
})

test('spec-critique -> planning enforces a critique round after the readability pass', () => {
  const { root, g, cleanup } = repo()
  init(root)
  commitFile(root, g, SPEC, '# Demo\n')
  g('checkout', '-b', 'feature')
  cli(root, ['advance', 'spec-critique', '--run', RUN])

  cli(root, ['record-round', 'spec-critique', '--run', RUN])       // round 1
  cli(root, ['record-readability', 'spec', '--run', RUN])          // pass at round 1

  const early = cli(root, ['advance', 'planning', '--run', RUN])
  assert.equal(early.status, 1)
  assert.match(early.stderr, /no critique round ran after the spec readability pass/)

  cli(root, ['record-round', 'spec-critique', '--run', RUN])       // round 2, after the pass
  const ok = cli(root, ['advance', 'planning', '--run', RUN])
  assert.equal(ok.status, 0, ok.stderr)
  assert.equal(readState(root, RUN).phase, 'planning')
  cleanup()
})

test('planning -> plan-critique needs an accepted spec and a plan file', () => {
  const { root, g, cleanup } = repo()
  const dir = path.join(root, '.speccy', RUN)
  const planRel = `.speccy/${RUN}/plan.md`
  fs.mkdirSync(dir, { recursive: true })
  // Draft status blocks; no plan file yet.
  commitFile(root, g, SPEC, '# Demo\n\nStatus: Draft\n')
  putState(root, { phase: 'planning' })

  const blocked = cli(root, ['advance', 'plan-critique', '--run', RUN, '--plan-path', planRel])
  assert.equal(blocked.status, 1)
  assert.match(blocked.stderr, /Status is not Accepted/)
  assert.match(blocked.stderr, /plan .* is missing/)

  // Accept the spec (re-commit) and drop the plan in place.
  fs.writeFileSync(path.join(root, SPEC), '# Demo\n\nStatus: Accepted\n')
  g('add', '--', SPEC)
  g('commit', '-m', 'accept')
  fs.writeFileSync(path.join(dir, 'plan.md'), '# Plan\n')
  const ok = cli(root, ['advance', 'plan-critique', '--run', RUN, '--plan-path', planRel])
  assert.equal(ok.status, 0, ok.stderr)
  const state = readState(root, RUN)
  assert.equal(state.phase, 'plan-critique')
  assert.equal(state.planPath, planRel)
  cleanup()
})

test('wrap-up -> complete needs a summary and a committed decision log', () => {
  const { root, g, cleanup } = repo()
  putState(root, { phase: 'wrap-up', reviewRounds: 2 })

  const blocked = cli(root, ['advance', 'complete', '--run', RUN])
  assert.equal(blocked.status, 1)
  assert.match(blocked.stderr, /summary\.md is missing/)
  assert.match(blocked.stderr, /decision log .* untracked/)

  fs.writeFileSync(path.join(root, '.speccy', RUN, 'summary.md'), 'done\n')
  commitFile(root, g, LOG, '# Decisions\n')
  const ok = cli(root, ['advance', 'complete', '--run', RUN])
  assert.equal(ok.status, 0, ok.stderr)
  assert.equal(readState(root, RUN).phase, 'complete')
  cleanup()
})

// ------------------------------------------------------------ recorders

test('record-round bumps the matching counter', () => {
  const { root, cleanup } = repo()
  init(root)
  cli(root, ['record-round', 'review', '--run', RUN])
  cli(root, ['record-round', 'review', '--run', RUN])
  assert.equal(readState(root, RUN).reviewRounds, 2)
  cleanup()
})

test('record-readability stamps the current round and stays single per artifact', () => {
  const { root, cleanup } = repo()
  init(root)
  cli(root, ['record-round', 'spec-critique', '--run', RUN])
  cli(root, ['record-readability', 'spec', '--run', RUN])
  cli(root, ['record-round', 'spec-critique', '--run', RUN])
  cli(root, ['record-readability', 'spec', '--run', RUN])  // re-run replaces, not duplicates
  const passes = readState(root, RUN).readabilityPasses
  assert.deepEqual(passes, [{ artifact: 'spec', atRound: 2 }])
  cleanup()
})

test('engagement-add reads the question text from a file, never a flag', () => {
  const { root, cleanup } = repo()
  init(root)
  const qFile = path.join(root, '.speccy', RUN, 'q.txt')
  fs.writeFileSync(qFile, 'the retry design; would it survive a replay?\n')
  const r = cli(root, ['engagement-add', '--run', RUN, '--gate', 'spec-critique', '--from-file', `.speccy/${RUN}/q.txt`])
  assert.equal(r.status, 0, r.stderr)
  assert.deepEqual(readState(root, RUN).engagementQuestions, [
    { gate: 'spec-critique', asked: 'the retry design; would it survive a replay?' },
  ])
  cleanup()
})

test('set-model updates the recorded models', () => {
  const { root, cleanup } = repo()
  init(root)
  cli(root, ['set-model', '--run', RUN, '--builder', 'opus'])
  assert.equal(readState(root, RUN).builderModel, 'opus')
  cleanup()
})

// ------------------------------------------------------------ replan

test('replan resets the plan loop and supersedes its review files', () => {
  const { root, cleanup } = repo()
  const dir = path.join(root, '.speccy', RUN)
  putState(root, {
    phase: 'plan-critique',
    planCritiqueRounds: 3,
    readabilityPasses: [{ artifact: 'spec', atRound: 1 }, { artifact: 'plan', atRound: 1 }],
  })
  fs.writeFileSync(path.join(dir, 'plan-critique-round-1.md'), 'x')
  fs.writeFileSync(path.join(dir, 'plan-critique-round-2.md'), 'x')
  fs.writeFileSync(path.join(dir, 'readability-plan.md'), 'x')
  fs.writeFileSync(path.join(dir, 'spike-round-1.md'), 'x')  // a spike keeps its name

  const r = cli(root, ['replan', '--run', RUN])
  assert.equal(r.status, 0, r.stderr)
  const state = readState(root, RUN)
  assert.equal(state.phase, 'planning')
  assert.equal(state.planCritiqueRounds, 0)
  assert.deepEqual(state.readabilityPasses, [{ artifact: 'spec', atRound: 1 }])
  assert.ok(fs.existsSync(path.join(dir, 'SUPERSEDED-plan-critique-round-1.md')))
  assert.ok(fs.existsSync(path.join(dir, 'SUPERSEDED-readability-plan.md')))
  assert.ok(fs.existsSync(path.join(dir, 'spike-round-1.md')), 'a spike verdict keeps its name')
  cleanup()
})

test('replan is refused outside the plan phases', () => {
  const { root, cleanup } = repo()
  putState(root, { phase: 'review' })
  const r = cli(root, ['replan', '--run', RUN])
  assert.equal(r.status, 1)
  assert.match(r.stderr, /replan only from planning or plan-critique/)
  cleanup()
})
