// The run's state machine, owned by a CLI so the orchestrator never hand-edits
// `.speccy/<run-id>/state.json`. The agent keeps every judgment; this file owns
// the deterministic contract: legal phase transitions, the mechanical guards on
// each one, the counters, and the JSON itself.
//
// Design line: it enforces invariants and records policy. An invariant (a spec
// committed before planning) refuses the transition. Policy (round caps, an
// extra readability pass, a re-run because the draft moved) is recorded and
// never forbidden, so the agent stays free to diverge.
//
// It fails LOUD: a bad transition or an unmet guard prints `speccy state: ...`
// and exits non-zero, unlike metrics.mjs which never blocks a run.

import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// The phase graph. PHASE_ORDER is also the single source metrics.mjs reads its
// first phase from, so the enum lives in exactly one place.
export const PHASE_ORDER = [
  'spec-draft',
  'spec-critique',
  'planning',
  'plan-critique',
  'plan-review',
  'implementation',
  'review',
  'wrap-up',
  'complete',
]

// Forward edges only. Back-edges are the `replan` verb, not an `advance`.
export const TRANSITIONS = {
  'spec-draft': ['spec-critique'],
  'spec-critique': ['planning'],
  planning: ['plan-critique'],
  'plan-critique': ['plan-review'],
  'plan-review': ['implementation'],
  implementation: ['review'],
  review: ['wrap-up'],
  'wrap-up': ['complete'],
  complete: [],
}

// A one-line pointer at what the phase just entered calls for, printed after a
// phase move so the agent is nudged forward without re-reading the skill. These
// are pointers, not instructions; the phase's detail lives in the skill.
const NEXT = {
  'spec-draft': 'present the draft to the user and stop; advance to spec-critique when they hand it on',
  'spec-critique': 'run the spec-critique loop (record-round, critique, revise; readability after round 1), then advance to planning',
  planning: 'dispatch the planner, then advance to plan-critique with --plan-path',
  'plan-critique': 'run the plan-critique loop, then advance to plan-review',
  'plan-review': 'run the user review of the plan, then advance to implementation',
  implementation: 'run the build via plan-execution',
  review: 'run the review panel (record-round each round), then advance to wrap-up',
  'wrap-up': 'write summary.md and the decision log, then advance to complete',
  complete: 'the run is done; report and run metrics',
}

const withNext = (message, phase) => (NEXT[phase] ? `${message}\n  next: ${NEXT[phase]}` : message)

const RUN_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*-\d{8}-\d{4}$/
const READABILITY_COUNTER = { spec: 'specCritiqueRounds', plan: 'planCritiqueRounds' }
const ROUND_COUNTER = {
  'spec-critique': 'specCritiqueRounds',
  'plan-critique': 'planCritiqueRounds',
  review: 'reviewRounds',
}

// ---------------------------------------------------------------- errors

// Thrown by a verb when the agent's request is refused. main() turns it into a
// `speccy state:` line and a non-zero exit; nothing else escapes to the caller.
class StateError extends Error {}

function fail(message) {
  throw new StateError(message)
}

// ---------------------------------------------------------------- io

function statePath(cwd, runId) {
  return path.join(cwd, '.speccy', runId, 'state.json')
}

function runDir(cwd, runId) {
  return path.join(cwd, '.speccy', runId)
}

function readIfFile(file) {
  try {
    return fs.readFileSync(file, 'utf8')
  } catch {
    return null
  }
}

/** The run's state, or null when it has never been written. */
export function readState(cwd, runId) {
  const text = readIfFile(statePath(cwd, runId))
  if (text === null) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function writeState(cwd, runId, state) {
  const file = statePath(cwd, runId)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(state, null, 2) + '\n')
}

function loadOrFail(cwd, runId) {
  const state = readState(cwd, runId)
  if (!state) fail(`no state for run "${runId}" (looked in ${path.relative(cwd, statePath(cwd, runId))})`)
  return state
}

// ---------------------------------------------------------------- git

// Every git call is best-effort: a non-repo or a bad path returns null rather
// than throwing, so a guard reads "not committed" instead of crashing the run.
function git(cwd, args) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  } catch {
    return null
  }
}

function isCommitted(cwd, relPath) {
  const tracked = git(cwd, ['ls-files', '--', relPath])
  if (!tracked || tracked.trim() === '') return false
  const dirty = git(cwd, ['status', '--porcelain', '--', relPath])
  return dirty !== null && dirty.trim() === ''
}

function currentBranch(cwd) {
  const out = git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'])
  return out ? out.trim() : null
}

// ---------------------------------------------------------------- guards

function readabilityRanBeforeALaterRound(state, artifact) {
  const entry = (state.readabilityPasses ?? []).find((p) => p.artifact === artifact)
  if (!entry) return `the ${artifact} readability pass has not run`
  const counter = state[READABILITY_COUNTER[artifact]] ?? 0
  if (counter <= entry.atRound) {
    return `no critique round ran after the ${artifact} readability pass (pass at round ${entry.atRound}, now ${counter})`
  }
  return null
}

function specStatusAccepted(cwd, state) {
  const text = readIfFile(path.join(cwd, state.specPath))
  if (text === null) return `spec not found at ${state.specPath}`
  return /^[*\s]*status[*\s]*:\s*accepted\b/im.test(text) ? null : `spec Status is not Accepted in ${state.specPath}`
}

// Reasons the transition from -> to is not yet allowed. Empty means go. Only
// mechanical invariants live here; a check that could block a legitimate state
// (a clean run with nothing skipped) is policy and belongs in the prose.
export function transitionGuards(from, to, state, cwd) {
  const reasons = []
  const notCommitted = (rel, label) => {
    if (!isCommitted(cwd, rel)) reasons.push(`${label} (${rel}) has uncommitted changes or is untracked`)
  }
  const missing = (abs, label) => {
    if (!fs.existsSync(abs)) reasons.push(`${label} is missing`)
  }
  const ordering = (artifact) => {
    const r = readabilityRanBeforeALaterRound(state, artifact)
    if (r) reasons.push(r)
  }

  switch (`${from}->${to}`) {
    case 'spec-draft->spec-critique': {
      notCommitted(state.specPath, 'spec')
      const branch = currentBranch(cwd)
      if (branch !== null && branch === state.baseBranch) {
        reasons.push(`still on the base branch "${state.baseBranch}"; the run needs a feature branch`)
      }
      break
    }
    case 'spec-critique->planning':
      notCommitted(state.specPath, 'spec')
      ordering('spec')
      break
    case 'planning->plan-critique': {
      notCommitted(state.specPath, 'spec')
      const status = specStatusAccepted(cwd, state)
      if (status) reasons.push(status)
      if (!state.planPath) reasons.push('planPath is not set')
      else missing(path.join(cwd, state.planPath), `plan (${state.planPath})`)
      break
    }
    case 'plan-critique->plan-review':
      // Loop exit: the plan file is present and a critique round read the
      // readability rewrite. The plan lives in gitignored .speccy/, so it is
      // checked for existence, not for a commit.
      if (!state.planPath) reasons.push('planPath is not set')
      else missing(path.join(cwd, state.planPath), `plan (${state.planPath})`)
      ordering('plan')
      break
    case 'plan-review->implementation':
      // The user gate. The loop-exit invariants held at plan-review; re-check
      // only that the plan still exists before the build reads it.
      if (!state.planPath) reasons.push('planPath is not set')
      else missing(path.join(cwd, state.planPath), `plan (${state.planPath})`)
      break
    case 'implementation->review':
      // "Gates seen to pass this session" is the agent's to confirm; state
      // cannot prove a tool ran, so there is no mechanical guard here.
      break
    case 'review->wrap-up':
      if ((state.reviewRounds ?? 0) < 1) reasons.push('no review round has run')
      break
    case 'wrap-up->complete':
      missing(path.join(runDir(cwd, state.runId), 'summary.md'), 'summary.md')
      notCommitted(state.decisionLogPath, 'decision log')
      break
    default:
      break
  }
  return reasons
}

// ---------------------------------------------------------------- arg parsing

/** argv (after the verb) -> { positionals, flags }. Flags are `--key value`. */
export function parseArgs(rest) {
  const positionals = []
  const flags = {}
  for (let i = 0; i < rest.length; i++) {
    const tok = rest[i]
    if (tok.startsWith('--')) {
      const key = tok.slice(2)
      const next = rest[i + 1]
      if (next === undefined || next.startsWith('--')) fail(`flag --${key} needs a value`)
      flags[key] = next
      i++
    } else {
      positionals.push(tok)
    }
  }
  return { positionals, flags }
}

function requireRun(flags) {
  const runId = flags.run
  if (!runId) fail('missing required --run <runId>')
  if (!RUN_ID.test(runId)) fail(`run id "${runId}" is not <slug>-YYYYMMDD-HHmm`)
  return runId
}

// ---------------------------------------------------------------- verbs

function ensureGitignore(cwd) {
  const file = path.join(cwd, '.gitignore')
  const text = readIfFile(file) ?? ''
  if (text.split('\n').some((line) => line.trim() === '.speccy/' || line.trim() === '.speccy')) return
  fs.writeFileSync(file, text + (text.endsWith('\n') || text === '' ? '' : '\n') + '.speccy/\n')
}

function verbInit(cwd, runId, flags) {
  const need = ['slug', 'base-branch', 'spec-path', 'decision-log-path']
  for (const k of need) if (!flags[k]) fail(`init needs --${k}`)
  if (readState(cwd, runId)) fail(`run "${runId}" already exists`)
  const state = {
    runId,
    slug: flags.slug,
    baseBranch: flags['base-branch'],
    adversaryModel: flags['adversary-model'] ?? 'opus',
    builderModel: flags['builder-model'] ?? 'sonnet',
    phase: 'spec-draft',
    specPath: flags['spec-path'],
    planPath: null,
    decisionLogPath: flags['decision-log-path'],
    specCritiqueRounds: 0,
    planCritiqueRounds: 0,
    reviewRounds: 0,
    readabilityPasses: [],
    engagementQuestions: [],
  }
  writeState(cwd, runId, state)
  fs.writeFileSync(path.join(cwd, '.speccy', '.current-runid'), runId)
  ensureGitignore(cwd)
  return withNext(`initialised ${runId} at phase spec-draft`, 'spec-draft')
}

function verbAdvance(cwd, runId, positionals, flags) {
  const to = positionals[0]
  if (!to) fail('advance needs a target phase')
  if (!PHASE_ORDER.includes(to)) fail(`unknown phase "${to}"`)
  const state = loadOrFail(cwd, runId)
  const from = state.phase
  if (!(TRANSITIONS[from] ?? []).includes(to)) {
    fail(`illegal transition ${from} -> ${to} (legal: ${(TRANSITIONS[from] ?? []).join(', ') || 'none'})`)
  }
  // Apply the data the agent supplies on this call before guarding, so a guard
  // sees the would-be state (e.g. the planPath given as it enters plan-critique).
  // Nothing persists unless the guards pass.
  if (flags['plan-path']) state.planPath = flags['plan-path']
  if (flags['builder-model']) state.builderModel = flags['builder-model']
  const reasons = transitionGuards(from, to, state, cwd)
  if (reasons.length) {
    fail(`cannot advance ${from} -> ${to}:\n` + reasons.map((r) => `  - ${r}`).join('\n'))
  }
  state.phase = to
  writeState(cwd, runId, state)
  return withNext(`advanced ${from} -> ${to}`, to)
}

function verbRecordRound(cwd, runId, positionals) {
  const loop = positionals[0]
  const counter = ROUND_COUNTER[loop]
  if (!counter) fail(`record-round needs one of: ${Object.keys(ROUND_COUNTER).join(', ')}`)
  const state = loadOrFail(cwd, runId)
  state[counter] = (state[counter] ?? 0) + 1
  writeState(cwd, runId, state)
  return `${counter} = ${state[counter]}`
}

function verbRecordReadability(cwd, runId, positionals) {
  const artifact = positionals[0]
  const counter = READABILITY_COUNTER[artifact]
  if (!counter) fail(`record-readability needs one of: ${Object.keys(READABILITY_COUNTER).join(', ')}`)
  const state = loadOrFail(cwd, runId)
  const atRound = state[counter] ?? 0
  state.readabilityPasses = (state.readabilityPasses ?? []).filter((p) => p.artifact !== artifact)
  state.readabilityPasses.push({ artifact, atRound })
  writeState(cwd, runId, state)
  return `${artifact} readability pass recorded at round ${atRound}`
}

function verbEngagementAdd(cwd, runId, flags) {
  if (!flags.gate) fail('engagement-add needs --gate')
  if (!flags['from-file']) fail('engagement-add needs --from-file')
  const asked = readIfFile(path.resolve(cwd, flags['from-file']))
  if (asked === null) fail(`cannot read --from-file ${flags['from-file']}`)
  const state = loadOrFail(cwd, runId)
  state.engagementQuestions = state.engagementQuestions ?? []
  state.engagementQuestions.push({ gate: flags.gate, asked: asked.trim() })
  writeState(cwd, runId, state)
  return `engagement question recorded for gate ${flags.gate}`
}

function verbSetModel(cwd, runId, flags) {
  if (!flags.builder && !flags.adversary) fail('set-model needs --builder and/or --adversary')
  const state = loadOrFail(cwd, runId)
  if (flags.builder) state.builderModel = flags.builder
  if (flags.adversary) state.adversaryModel = flags.adversary
  writeState(cwd, runId, state)
  return `models: builder=${state.builderModel} adversary=${state.adversaryModel}`
}

function verbReplan(cwd, runId) {
  const state = loadOrFail(cwd, runId)
  if (!['planning', 'plan-critique', 'plan-review'].includes(state.phase)) {
    fail(`replan only from planning, plan-critique or plan-review, not ${state.phase}`)
  }
  const dir = runDir(cwd, runId)
  const superseded = []
  for (const name of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
    const isPlanReview = /^plan-critique-round-\d+\.md$/.test(name) || name === 'readability-plan.md'
    if (isPlanReview && !name.startsWith('SUPERSEDED-')) {
      fs.renameSync(path.join(dir, name), path.join(dir, `SUPERSEDED-${name}`))
      superseded.push(name)
    }
  }
  state.planCritiqueRounds = 0
  state.readabilityPasses = (state.readabilityPasses ?? []).filter((p) => p.artifact !== 'plan')
  state.phase = 'planning'
  writeState(cwd, runId, state)
  return withNext(
    `replanned: phase -> planning, planCritiqueRounds reset` +
      (superseded.length ? `, superseded ${superseded.join(', ')}` : ''),
    'planning',
  )
}

// ---------------------------------------------------------------- entry point

const WRITE_VERBS = new Set([
  'init',
  'advance',
  'record-round',
  'record-readability',
  'engagement-add',
  'set-model',
  'replan',
])

export function main(argv = process.argv.slice(2), cwd = process.cwd()) {
  const verb = argv[0]
  if (!verb || !WRITE_VERBS.has(verb)) {
    process.stderr.write(`speccy state: unknown verb "${verb ?? ''}" (verbs: ${[...WRITE_VERBS].join(', ')})\n`)
    return 2
  }
  try {
    const { positionals, flags } = parseArgs(argv.slice(1))
    const runId = requireRun(flags)
    let message
    switch (verb) {
      case 'init':
        message = verbInit(cwd, runId, flags)
        break
      case 'advance':
        message = verbAdvance(cwd, runId, positionals, flags)
        break
      case 'record-round':
        message = verbRecordRound(cwd, runId, positionals)
        break
      case 'record-readability':
        message = verbRecordReadability(cwd, runId, positionals)
        break
      case 'engagement-add':
        message = verbEngagementAdd(cwd, runId, flags)
        break
      case 'set-model':
        message = verbSetModel(cwd, runId, flags)
        break
      case 'replan':
        message = verbReplan(cwd, runId)
        break
    }
    process.stdout.write(`speccy state: ${message}\n`)
    return 0
  } catch (err) {
    if (err instanceof StateError) {
      process.stderr.write(`speccy state: ${err.message}\n`)
      return 1
    }
    throw err
  }
}

// fileURLToPath rather than the URL's pathname, which on Windows yields a
// leading-slash path that resolves to the wrong thing.
const thisFile = fileURLToPath(import.meta.url)
if (process.argv[1] && path.resolve(process.argv[1]) === thisFile) process.exit(main())
