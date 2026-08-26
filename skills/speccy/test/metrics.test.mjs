// Tests for metrics.mjs. Run with: node --test skills/speccy/test/
//
// Fixtures are synthetic and built here rather than committed: real transcripts
// carry repo names, branch names, and file contents that don't belong in a
// public repo, and a checked-in fake ~/.claude tree would go stale.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

import {
  parseTranscript,
  usageRecords,
  transcriptSpan,
  firstPromptLine,
  isStateWrite,
  phaseBoundaries,
  bannerMarker,
  buildTimeline,
  bucketByPhase,
  modelMismatch,
  discover,
  projectDirName,
  transcriptSearchDirs,
  readRunState,
  buildReport,
  render,
  runIdStart,
  resolveRunId,
  num,
} from '../metrics.mjs'

const RUN = 'metrics-demo-20260101-0900'
const SKILL_DIR = path.resolve(import.meta.dirname, '..')

// ------------------------------------------------------------ line builders

function assistant({ ts, model = 'claude-opus-5', effort = 'high', out = 0, cr = 0, cw = 0, fin = 0, iterations = true, content = [], id = null, blocks = null }) {
  const usage = {
    input_tokens: fin,
    cache_creation_input_tokens: cw,
    cache_read_input_tokens: cr,
    output_tokens: out,
  }
  if (iterations) {
    // The harness repeats the same counts per inference iteration. Anything that
    // sums the whole object, or greps the line, counts them twice.
    usage.iterations = [{ input_tokens: fin, output_tokens: out, cache_read_input_tokens: cr, cache_creation_input_tokens: cw }]
  }
  const body = blocks ? blocks.map((type) => ({ type })) : content
  const entry = { type: 'assistant', timestamp: ts, cwd: '/repo', message: { role: 'assistant', model, usage, content: body } }
  if (id !== null) entry.message.id = id
  if (effort !== null) entry.effort = effort
  return JSON.stringify(entry)
}

function stateWrite({ ts, phase, tool = 'Write', runId = RUN, filePath = null, extra = {} }) {
  const state = { runId, phase, specCritiqueRounds: 0, ...extra }
  const input = { file_path: filePath ?? `/repo/.speccy/${runId}/state.json` }
  if (tool === 'Write') input.content = JSON.stringify(state, null, 2)
  else input.new_string = `"phase": "${phase}"`
  return assistant({ ts, out: 1, content: [{ type: 'tool_use', name: tool, id: 'tu1', input }] })
}

function roundBump({ ts, runId = RUN }) {
  return assistant({
    ts,
    out: 1,
    content: [{
      type: 'tool_use',
      name: 'Edit',
      id: 'tu2',
      input: { file_path: `/repo/.speccy/${runId}/state.json`, old_string: '"specCritiqueRounds": 1', new_string: '"specCritiqueRounds": 2' },
    }],
  })
}

function bannerCall({ ts }) {
  return assistant({
    ts,
    out: 1,
    content: [{ type: 'tool_use', name: 'Bash', id: 'tu3', input: { command: 'bash /plugins/speccy/skills/speccy/banner.sh' } }],
  })
}

const at = (h, m = 0, s = 0) => `2026-01-01T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.000Z`
const ms = (h, m = 0, s = 0) => Date.parse(at(h, m, s))

// A transcript is parsed once and every reader takes the entries, so the tests
// parse the same way production does.
const entriesOf = (text) => parseTranscript(text).entries
const recordsOf = (text, agent = null) => usageRecords(entriesOf(text), agent)

// ------------------------------------------------------------ parsing

test('iterations does not double count: 176 output tokens read as 176, not 352', () => {
  const records = recordsOf(assistant({ ts: at(9), out: 176, cr: 21434, cw: 15065, fin: 2 }))
  assert.equal(records.length, 1)
  assert.equal(records[0].out, 176)
  assert.equal(records[0].cacheRead, 21434)
  assert.equal(records[0].cacheWrite, 15065)
  assert.equal(records[0].uncachedIn, 2)
})

// One API response becomes one transcript entry per content block, each
// carrying the whole request's usage. Both observed shapes are covered here.
test('blocks of one response count once, not once per block', () => {
  const text = [
    assistant({ ts: at(9, 0, 1), id: 'msg_a', out: 375, cr: 56146, cw: 1200, fin: 3, blocks: ['thinking'] }),
    assistant({ ts: at(9, 0, 2), id: 'msg_a', out: 375, cr: 56146, cw: 1200, fin: 3, blocks: ['text'] }),
    assistant({ ts: at(9, 0, 3), id: 'msg_a', out: 375, cr: 56146, cw: 1200, fin: 3, blocks: ['tool_use'] }),
  ].join('\n')
  const records = recordsOf(text)
  assert.equal(records.length, 1, 'one response, one record')
  assert.deepEqual(
    { out: records[0].out, cacheRead: records[0].cacheRead, cacheWrite: records[0].cacheWrite, uncachedIn: records[0].uncachedIn },
    { out: 375, cacheRead: 56146, cacheWrite: 1200, uncachedIn: 3 },
  )
  assert.equal(records[0].ts, ms(9, 0, 1), 'dated when the response began')
})

test('a response whose output count grows as it streams keeps the final total', () => {
  const text = [
    assistant({ ts: at(9, 0, 1), id: 'msg_b', out: 5, cr: 10564 }),
    assistant({ ts: at(9, 0, 2), id: 'msg_b', out: 5, cr: 10564 }),
    assistant({ ts: at(9, 0, 3), id: 'msg_b', out: 286, cr: 10564 }),
  ].join('\n')
  const records = recordsOf(text)
  assert.equal(records.length, 1)
  assert.equal(records[0].out, 286, 'the complete count, not the first snapshot nor the sum')
  assert.equal(records[0].cacheRead, 10564, 'input counted once')
})

test('entries with no message id are each their own record', () => {
  const text = [assistant({ ts: at(9), out: 5 }), assistant({ ts: at(9, 1), out: 7 })].join('\n')
  assert.equal(recordsOf(text).length, 2)
})

test('absent cache fields read as 0, not NaN', () => {
  const line = JSON.stringify({
    type: 'assistant',
    timestamp: at(9),
    message: { model: 'claude-sonnet-5', usage: { output_tokens: 12 } },
  })
  const records = recordsOf(line)
  assert.deepEqual(
    { out: records[0].out, cacheRead: records[0].cacheRead, cacheWrite: records[0].cacheWrite, uncachedIn: records[0].uncachedIn },
    { out: 12, cacheRead: 0, cacheWrite: 0, uncachedIn: 0 },
  )
})

test('records with no usage, and the <synthetic> model, are skipped', () => {
  const text = [
    JSON.stringify({ type: 'user', timestamp: at(9), message: { role: 'user', content: 'hello' } }),
    assistant({ ts: at(9, 1), model: '<synthetic>', out: 99 }),
    assistant({ ts: at(9, 2), out: 5 }),
  ].join('\n')
  const records = recordsOf(text)
  assert.equal(records.length, 1)
  assert.equal(records[0].out, 5)
})

test('a malformed line is skipped and counted', () => {
  const text = [assistant({ ts: at(9), out: 5 }), '{ not json', '', assistant({ ts: at(9, 1), out: 7 })].join('\n')
  const { entries, malformed } = parseTranscript(text)
  assert.equal(usageRecords(entries).length, 2)
  assert.equal(malformed, 1)
})

test('effort is carried onto the record, and its absence stays null', () => {
  const withEffort = recordsOf(assistant({ ts: at(9), out: 1, effort: 'high' }))[0]
  const without = recordsOf(assistant({ ts: at(9), out: 1, effort: null }))[0]
  assert.equal(withEffort.effort, 'high')
  assert.equal(without.effort, null)
})

test('transcriptSpan bounds an agent by any entry, not just usage-bearing ones', () => {
  const text = [
    JSON.stringify({ type: 'user', timestamp: at(9, 0), message: { role: 'user', content: 'go' } }),
    assistant({ ts: at(9, 5), out: 10 }),
  ].join('\n')
  assert.deepEqual(transcriptSpan(entriesOf(text)), { from: ms(9, 0), to: ms(9, 5) })
})

// ------------------------------------------------------------ phase timeline

test('a Write of the initial state file yields a boundary at its phase', () => {
  const found = phaseBoundaries(entriesOf(stateWrite({ ts: at(9, 30), phase: 'spec-critique' })), RUN)
  assert.deepEqual(found, [{ ts: ms(9, 30), phase: 'spec-critique' }])
})

test('an Edit that changes phase is a boundary; a round-counter bump is not', () => {
  const text = [
    stateWrite({ ts: at(10), phase: 'planning', tool: 'Edit' }),
    roundBump({ ts: at(10, 5) }),
  ].join('\n')
  assert.deepEqual(phaseBoundaries(entriesOf(text), RUN), [{ ts: ms(10), phase: 'planning' }])
})

test('consecutive writes of the same phase collapse to one boundary', () => {
  const boundaries = phaseBoundaries(
    entriesOf([
      stateWrite({ ts: at(9), phase: 'spec-critique' }),
      stateWrite({ ts: at(9, 20), phase: 'spec-critique' }),
      stateWrite({ ts: at(10), phase: 'planning' }),
    ].join('\n')),
    RUN,
  )
  const timeline = buildTimeline(boundaries, { start: ms(9), end: ms(11) })
  assert.deepEqual(timeline.map((b) => b.phase), ['spec-critique', 'planning'])
})

test('a Windows state write is recognised', () => {
  const winPath = `C:\\Users\\dev\\proj\\.speccy\\${RUN}\\state.json`
  assert.equal(isStateWrite(winPath, RUN), true)
  const found = phaseBoundaries(entriesOf(stateWrite({ ts: at(9), phase: 'review', filePath: winPath })), RUN)
  assert.deepEqual(found, [{ ts: ms(9), phase: 'review' }])
})

test('a state write for another run is not a boundary', () => {
  assert.equal(isStateWrite('/repo/.speccy/other-run-20260101-0900/state.json', RUN), false)
  assert.deepEqual(phaseBoundaries(entriesOf(stateWrite({ ts: at(9), phase: 'review', runId: 'other-run-20260101-0900' })), RUN), [])
})

test('the banner call marks the start of the run', () => {
  const text = [bannerCall({ ts: at(8, 55) }), stateWrite({ ts: at(9, 30), phase: 'spec-critique' })].join('\n')
  assert.equal(bannerMarker(entriesOf(text)), ms(8, 55))
})

test('the first bucket covers the interview, before state.json exists', () => {
  const timeline = buildTimeline([{ ts: ms(9, 30), phase: 'spec-critique' }], { start: ms(9), end: ms(10) })
  assert.deepEqual(timeline, [
    { phase: 'spec', from: ms(9), to: ms(9, 30) },
    { phase: 'spec-critique', from: ms(9, 30), to: ms(10) },
  ])
})

// ------------------------------------------------------------ attribution

const twoPhase = () => buildTimeline(
  [{ ts: ms(10), phase: 'planning' }],
  { start: ms(9), end: ms(11) },
)

test('a subagent record after a boundary lands in the later bucket, so a straddling agent splits', () => {
  const records = [
    ...recordsOf(assistant({ ts: at(9, 55), out: 100 }), 'agent-a'),
    ...recordsOf(assistant({ ts: at(10, 5), out: 200 }), 'agent-a'),
  ]
  const { phases, dropped } = bucketByPhase(records, twoPhase())
  assert.equal(dropped.length, 0)
  assert.equal(phases[0].totals.out, 100)
  assert.equal(phases[1].totals.out, 200)
})

test('the sum of the buckets equals the ungrouped total', () => {
  const stamps = [[9, 10], [9, 40], [10, 1], [10, 30], [10, 59]]
  const records = stamps.flatMap(([h, m], i) => recordsOf(assistant({ ts: at(h, m), out: (i + 1) * 10, cr: 1000, cw: 5 })))
  const bare = records.reduce((t, r) => t + r.out + r.cacheRead + r.cacheWrite, 0)
  const { phases, dropped } = bucketByPhase(records, twoPhase())
  const bucketed = phases.reduce((t, p) => t + p.totals.out + p.totals.cacheRead + p.totals.cacheWrite, 0)
  assert.equal(dropped.length, 0)
  assert.equal(bucketed, bare)
})

test('two models in one phase produce two rows, split correctly', () => {
  const records = [
    ...recordsOf(assistant({ ts: at(10, 5), model: 'claude-opus-5', out: 300 })),
    ...recordsOf(assistant({ ts: at(10, 6), model: 'claude-sonnet-5', out: 40 })),
  ]
  const { phases } = bucketByPhase(records, twoPhase())
  assert.deepEqual(
    phases[1].byModel.map((r) => [r.model, r.effort, r.out]),
    [['claude-opus-5', 'high', 300], ['claude-sonnet-5', 'high', 40]],
  )
})

test('one model at two efforts yields two rows, and a missing effort renders as - without collapsing', () => {
  const records = [
    ...recordsOf(assistant({ ts: at(10, 1), out: 10, effort: 'high' })),
    ...recordsOf(assistant({ ts: at(10, 2), out: 20, effort: 'low' })),
    ...recordsOf(assistant({ ts: at(10, 3), out: 30, effort: null })),
  ]
  const { phases } = bucketByPhase(records, twoPhase())
  assert.deepEqual(
    phases[1].byModel.map((r) => [r.effort, r.out]).sort(),
    [['-', 30], ['high', 10], ['low', 20]],
  )
})

test('active time excludes a ten-minute gap and includes a thirty-second one', () => {
  const records = [
    ...recordsOf(assistant({ ts: at(10, 0, 0), out: 1 })),
    ...recordsOf(assistant({ ts: at(10, 0, 30), out: 1 })),
    ...recordsOf(assistant({ ts: at(10, 10, 30), out: 1 })),
  ]
  const { phases } = bucketByPhase(records, twoPhase())
  assert.equal(phases[1].active, 30_000)
  assert.equal(phases[1].wall, ms(11) - ms(10))
})

test('agent-seconds counts the overlap of an agent lifetime with each phase', () => {
  const agents = [{ id: 'agent-a', span: { from: ms(9, 50), to: ms(10, 10) } }]
  const { phases } = bucketByPhase([], twoPhase(), agents)
  assert.equal(phases[0].agentMs, 10 * 60_000)
  assert.equal(phases[1].agentMs, 10 * 60_000)
})

// ------------------------------------------------------------ model checks

test('a requested alias matching its resolved id raises no flag', () => {
  assert.equal(modelMismatch('opus', 'claude-opus-5'), false)
  assert.equal(modelMismatch('sonnet', 'claude-sonnet-5'), false)
  assert.equal(modelMismatch('haiku', 'claude-haiku-4-5-20251001'), false)
  assert.equal(modelMismatch('claude-opus-5', 'claude-opus-5'), false)
})

test('a requested alias that did not take effect raises the flag', () => {
  assert.equal(modelMismatch('opus', 'claude-sonnet-5'), true)
  assert.equal(modelMismatch('sonnet', 'claude-haiku-4-5-20251001'), true)
})

test('an unrecorded request or resolution raises no flag', () => {
  assert.equal(modelMismatch(null, 'claude-opus-5'), false)
  assert.equal(modelMismatch('opus', null), false)
})

test('a run id yields a start bound, and a malformed one yields none', () => {
  assert.equal(typeof runIdStart(RUN), 'number')
  assert.equal(runIdStart('no-timestamp-here'), null)
})

// ------------------------------------------------------------ discovery

function tree() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'speccy-metrics-'))
  const project = path.join(root, 'projects', '-repo')
  fs.mkdirSync(project, { recursive: true })

  const write = (file, lines) => {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, lines.join('\n') + '\n')
  }

  // Contributes: writes the run's state file.
  write(path.join(project, 'sess-a.jsonl'), [
    bannerCall({ ts: at(9, 0) }),
    assistant({ ts: at(9, 10), out: 1000, cr: 50_000 }),
    stateWrite({ ts: at(9, 30), phase: 'spec-critique' }),
    assistant({ ts: at(9, 40), out: 500 }),
    stateWrite({ ts: at(10, 0), phase: 'planning' }),
    assistant({ ts: at(10, 30), out: 200 }),
    stateWrite({ ts: at(10, 45), phase: 'complete' }),
    // The session keeps being used after the run it finished.
    assistant({ ts: at(11, 30), out: 7777 }),
  ])

  // A plain subagent, with its sidecar.
  const subagents = path.join(project, 'sess-a', 'subagents')
  write(path.join(subagents, 'agent-aaa.jsonl'), [
    JSON.stringify({ type: 'user', timestamp: at(9, 32), message: { role: 'user', content: 'critique' } }),
    assistant({ ts: at(9, 35), model: 'claude-opus-5', out: 4000, cr: 30_000 }),
  ])
  fs.writeFileSync(
    path.join(subagents, 'agent-aaa.meta.json'),
    JSON.stringify({ agentType: 'general-purpose', description: 'Adversarial spec critique round 1', model: 'opus', spawnDepth: 1 }),
  )

  // A workflow agent, nested deeper, whose sidecar carries no description.
  write(path.join(subagents, 'workflows', 'wf_x', 'agent-bbb.jsonl'), [
    JSON.stringify({ type: 'user', timestamp: at(10, 19), message: { role: 'user', content: 'Break the plan into steps\nand return them as JSON' } }),
    assistant({ ts: at(10, 20), model: 'claude-sonnet-5', out: 800 }),
  ])
  fs.writeFileSync(
    path.join(subagents, 'workflows', 'wf_x', 'agent-bbb.meta.json'),
    JSON.stringify({ agentType: 'workflow-subagent', model: 'opus', spawnDepth: 1 }),
  )

  // An agent with no sidecar and no prompt to fall back on.
  write(path.join(subagents, 'agent-ccc.jsonl'), [
    assistant({ ts: at(9, 45), model: 'claude-haiku-4-5-20251001', effort: null, out: 60 }),
  ])

  // Mentions the run id in prose but never writes its state file.
  write(path.join(project, 'sess-b.jsonl'), [
    assistant({ ts: at(9, 15), out: 99_999, content: [{ type: 'text', text: `chatting about ${RUN} without touching it` }] }),
  ])

  // Belongs to a different run.
  write(path.join(project, 'sess-c.jsonl'), [
    stateWrite({ ts: at(9, 20), phase: 'planning', runId: 'other-run-20260101-0900' }),
    assistant({ ts: at(9, 25), out: 12_345 }),
  ])

  return root
}

test('only the session that writes the run state contributes', () => {
  const root = tree()
  const found = discover(root, RUN)
  assert.deepEqual(found.sessions.map((s) => s.sessionId), ['sess-a'])
  assert.equal(found.mentionedOnly.length, 1)
  assert.match(found.mentionedOnly[0], /sess-b\.jsonl$/)
  assert.equal(found.records.some((r) => r.out === 99_999), false)
  assert.equal(found.records.some((r) => r.out === 12_345), false)
  fs.rmSync(root, { recursive: true, force: true })
})

test('workflow agents are found alongside plain subagents, and name their workflow', () => {
  const root = tree()
  const found = discover(root, RUN)
  assert.deepEqual(found.agents.map((a) => a.id).sort(), ['agent-aaa', 'agent-bbb', 'agent-ccc'])
  const byId = Object.fromEntries(found.agents.map((a) => [a.id, a]))
  assert.equal(byId['agent-bbb'].workflow, 'wf_x')
  assert.equal(byId['agent-aaa'].workflow, null)
  fs.rmSync(root, { recursive: true, force: true })
})

test('the label comes from the sidecar, then the opening prompt, then the id', () => {
  const root = tree()
  const byId = Object.fromEntries(discover(root, RUN).agents.map((a) => [a.id, a]))
  assert.equal(byId['agent-aaa'].label, 'Adversarial spec critique round 1')
  assert.equal(byId['agent-aaa'].requested, 'opus')
  assert.equal(byId['agent-aaa'].agentType, 'general-purpose')
  // Workflow subagents carry no description, so the prompt names them.
  assert.equal(byId['agent-bbb'].label, 'Break the plan into steps and return them as JSON')
  assert.equal(byId['agent-ccc'].label, 'agent-ccc')
  assert.equal(byId['agent-ccc'].requested, null)
  fs.rmSync(root, { recursive: true, force: true })
})

test('a long opening prompt is trimmed to one line', () => {
  const text = JSON.stringify({
    type: 'user',
    timestamp: at(9),
    message: { role: 'user', content: `${'x'.repeat(200)}\nmore` },
  })
  const label = firstPromptLine(entriesOf(text))
  assert.equal(label.length, 60)
  assert.match(label, /…$/)
})

test('a discovered run reports contiguous phases whose totals sum to the whole', () => {
  const root = tree()
  const found = discover(root, RUN)
  const report = buildReport(RUN, found)

  // `complete` closes the timeline rather than becoming a phase of its own.
  assert.deepEqual(report.phases.map((p) => p.phase), ['spec', 'spec-critique', 'planning'])
  for (let i = 1; i < report.phases.length; i++) {
    assert.equal(report.phases[i].from, report.phases[i - 1].to, 'phases must be contiguous')
  }

  const bare = found.records.reduce((t, r) => t + r.out, 0)
  const bucketed = report.phases.reduce((t, p) => t + p.totals.out, 0)
  assert.equal(bucketed, bare - 7777, 'everything but the post-complete record is bucketed')

  // The critique subagents' work belongs to the critique phase, not the main
  // loop's phase alone: 500 orchestrator + 1 state write + 4000 + 60 agents.
  const critique = report.phases.find((p) => p.phase === 'spec-critique')
  assert.equal(critique.totals.out, 500 + 1 + 4000 + 60)
  assert.ok(critique.agentMs > 0)
  fs.rmSync(root, { recursive: true, force: true })
})

test('the rendered report names every phase, the agents, and the caveats', () => {
  const root = tree()
  const text = render(buildReport(RUN, discover(root, RUN)))
  assert.match(text, new RegExp(`# Run metrics: ${RUN}`))
  assert.match(text, /### spec-critique/)
  assert.match(text, /Adversarial spec critique round 1/)
  assert.match(text, /cleanupPeriodDays/)
  assert.match(text, /claude-opus-5/)
  fs.rmSync(root, { recursive: true, force: true })
})

test('the console render keeps the phases and notes but drops the agent table', () => {
  const root = tree()
  const report = buildReport(RUN, discover(root, RUN))
  const full = render(report)
  const brief = render(report, { agents: false })

  assert.match(full, /## Agents/)
  assert.doesNotMatch(brief, /## Agents/)
  assert.doesNotMatch(brief, /Adversarial spec critique round 1/)
  for (const kept of [/### spec-critique/, /## Run total/, /## Notes/, /cleanupPeriodDays/]) {
    assert.match(brief, kept)
  }
  assert.ok(brief.length < full.length)
  fs.rmSync(root, { recursive: true, force: true })
})

test('the command writes the whole report to the file and the brief one to stdout', () => {
  const root = tree()
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'speccy-main-'))
  fs.mkdirSync(path.join(cwd, '.speccy', RUN), { recursive: true })

  const stdout = execFileSync(process.execPath, [path.join(SKILL_DIR, 'metrics.mjs'), RUN], {
    encoding: 'utf8',
    cwd,
    env: { ...process.env, CLAUDE_CONFIG_DIR: root },
  })
  const file = fs.readFileSync(path.join(cwd, '.speccy', RUN, 'metrics.md'), 'utf8')

  assert.match(file, /## Agents/, 'the file keeps the table')
  assert.doesNotMatch(stdout, /## Agents/, 'stdout does not')
  assert.match(stdout, /### spec-critique/)
  assert.match(stdout, /3-row agent table, written to/)
  assert.ok(stdout.length < file.length)
  fs.rmSync(root, { recursive: true, force: true })
  fs.rmSync(cwd, { recursive: true, force: true })
})

test('an unfinished run marks its last phase as unbounded rather than timing it', () => {
  const root = tree()
  const found = discover(root, RUN)
  found.boundaries = found.boundaries.filter((b) => b.phase !== 'complete')
  const report = buildReport(RUN, found)

  assert.ok(report.notes.some((n) => /not reached `complete`/.test(n)))
  assert.equal(report.phases[report.openPhase].phase, 'planning', 'the final bucket is the open one')
  // The post-complete record now falls inside the open phase, extending it.
  assert.match(render(report), /### planning\n\nat least .* wall \(phase never closed\)/)

  // A finished run times every phase normally.
  assert.equal(buildReport(RUN, discover(root, RUN)).openPhase, null)
  assert.doesNotMatch(render(buildReport(RUN, discover(root, RUN))), /phase never closed/)
  fs.rmSync(root, { recursive: true, force: true })
})

test('work done after the run was marked complete is excluded and reported', () => {
  const root = tree()
  const report = buildReport(RUN, discover(root, RUN))
  const last = report.phases[report.phases.length - 1]
  assert.equal(last.to, ms(10, 45), 'the timeline closes at the `complete` write')
  assert.ok(report.notes.some((n) => /after the run was marked `complete`/.test(n)))
  assert.equal(report.phases.some((p) => p.totals.out === 7777), false)
  fs.rmSync(root, { recursive: true, force: true })
})

test('a timeline that starts mid-pipeline names its opening bucket honestly', () => {
  const root = tree()
  const found = discover(root, RUN)
  // Only the later boundaries survive, as when earlier sessions have been pruned.
  found.boundaries = found.boundaries.filter((b) => b.phase === 'planning' || b.phase === 'complete')
  const report = buildReport(RUN, found)
  assert.deepEqual(report.phases.map((p) => p.phase), ['before planning', 'planning'])
  assert.ok(report.notes.some((n) => /cannot be told apart/.test(n)))
  fs.rmSync(root, { recursive: true, force: true })
})

// A session outlives the run it hosted, and the harness writes each subagent's
// sidecar as it starts, so a killed session leaves a truncated one.
function treeWithStrays() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'speccy-strays-'))
  const project = path.join(root, 'projects', '-repo')
  const write = (file, lines) => {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, lines.join('\n') + '\n')
  }
  const subagent = (name, lines, meta) => {
    write(path.join(project, 'sess-d', 'subagents', `${name}.jsonl`), lines)
    fs.writeFileSync(path.join(project, 'sess-d', 'subagents', `${name}.meta.json`), meta)
  }

  write(path.join(project, 'sess-d.jsonl'), [
    bannerCall({ ts: at(9, 0) }),
    stateWrite({ ts: at(9, 10), phase: 'spec-critique' }),
    stateWrite({ ts: at(10, 0), phase: 'complete' }),
    assistant({ ts: at(15, 0), out: 5 }),
  ])

  subagent('agent-in', [assistant({ ts: at(9, 30), out: 100 })], JSON.stringify({ description: 'inside the run' }))
  subagent('agent-later', [assistant({ ts: at(15, 10), out: 999_999 })], JSON.stringify({ description: 'the session\'s next job' }))
  subagent('agent-pipe', [assistant({ ts: at(9, 40), out: 7 })], JSON.stringify({ description: 'run tests | grep fail' }))
  subagent(
    'agent-cut',
    [
      JSON.stringify({ type: 'user', timestamp: at(9, 41), message: { role: 'user', content: 'prove the cache mechanism' } }),
      assistant({ ts: at(9, 42), out: 3 }),
    ],
    '{"description":"trunca',
  )
  return root
}

test('a subagent that ran wholly outside the run is excluded, and the notes say so', () => {
  const root = treeWithStrays()
  const report = buildReport(RUN, discover(root, RUN))
  assert.deepEqual(report.agents.map((a) => a.id).sort(), ['agent-cut', 'agent-in', 'agent-pipe'])
  assert.ok(report.notes.some((n) => /1 subagent\(s\).*wholly outside the run's window/.test(n)))
  assert.doesNotMatch(render(report), /next job/)
  fs.rmSync(root, { recursive: true, force: true })
})

test('a pipe in an agent label is escaped, so the row keeps its columns', () => {
  const root = treeWithStrays()
  const row = render(buildReport(RUN, discover(root, RUN))).split('\n').find((l) => l.includes('grep fail'))
  assert.match(row, /run tests \\\| grep fail/)
  assert.equal(row.split(/(?<!\\)\|/).length - 2, 9, 'nine columns, whatever the label holds')
  fs.rmSync(root, { recursive: true, force: true })
})

test('a truncated sidecar costs that agent its label, not the whole report', () => {
  const root = treeWithStrays()
  const byId = Object.fromEntries(discover(root, RUN).agents.map((a) => [a.id, a]))
  assert.equal(byId['agent-cut'].label, 'prove the cache mechanism', 'falls back to the opening prompt')
  assert.equal(byId['agent-cut'].requested, null)
  fs.rmSync(root, { recursive: true, force: true })
})

test('a phase the pipeline revisits does not make its earlier bucket look unclosed', () => {
  const report = buildReport(RUN, {
    sessions: [{ file: 'f', sessionId: 'sess-e', project: '-repo' }],
    mentionedOnly: [],
    agents: [],
    records: recordsOf([
      assistant({ ts: at(9, 5), out: 1 }),
      assistant({ ts: at(10, 5), out: 1 }),
      assistant({ ts: at(11, 5), out: 1 }),
    ].join('\n')),
    boundaries: [
      { ts: ms(9), phase: 'spec-critique' },
      { ts: ms(10), phase: 'planning' },
      { ts: ms(11), phase: 'spec-critique' },
    ],
    marker: ms(9),
    malformed: 0,
  })
  assert.deepEqual(report.phases.map((p) => p.phase), ['spec-critique', 'planning', 'spec-critique'])
  assert.equal((render(report).match(/phase never closed/g) ?? []).length, 1)
})

// A run can mark itself complete through a shell command, which leaves the
// phase in state.json but no tool call in the transcript to date it.
test('state.json closes a run whose `complete` write never reached the transcript', () => {
  const root = tree()
  const found = discover(root, RUN)
  found.boundaries = found.boundaries.filter((b) => b.phase !== 'complete')

  const report = buildReport(RUN, found, { state: { phase: 'complete', mtime: ms(10, 46) } })
  assert.equal(report.openPhase, null, 'the run is finished, so no phase is left open')
  assert.equal(report.phases[report.phases.length - 1].to, ms(10, 46), 'closed at the state file')
  assert.equal(report.phases.some((p) => p.totals.out === 7777), false, 'later work stays out')
  assert.ok(report.notes.some((n) => /closes at `state.json`/.test(n)))
  assert.doesNotMatch(render(report), /has not reached `complete`/)
  fs.rmSync(root, { recursive: true, force: true })
})

test('a state file that is stale, unfinished, or absent leaves the run open', () => {
  const root = tree()
  const open = () => {
    const found = discover(root, RUN)
    found.boundaries = found.boundaries.filter((b) => b.phase !== 'complete')
    return found
  }
  // Older than the last phase boundary, so it cannot be that phase's end.
  assert.equal(buildReport(RUN, open(), { state: { phase: 'complete', mtime: ms(9, 0) } }).openPhase, 2)
  assert.equal(buildReport(RUN, open(), { state: { phase: 'wrap-up', mtime: ms(10, 46) } }).openPhase, 2)
  assert.equal(buildReport(RUN, open(), { state: null }).openPhase, 2)
  fs.rmSync(root, { recursive: true, force: true })
})

test('a state file touched long after the run cannot stretch it past the last record', () => {
  const root = tree()
  const found = discover(root, RUN)
  found.boundaries = found.boundaries.filter((b) => b.phase !== 'complete')
  const report = buildReport(RUN, found, { state: { phase: 'complete', mtime: ms(20, 0) } })
  assert.equal(report.phases[report.phases.length - 1].to, ms(11, 30), 'capped at the last record')
  fs.rmSync(root, { recursive: true, force: true })
})

test('readRunState reads the phase and the moment it was set', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'speccy-state-'))
  const dir = path.join(cwd, '.speccy', RUN)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({ runId: RUN, phase: 'complete' }))
  const state = readRunState(cwd, RUN)
  assert.equal(state.phase, 'complete')
  assert.ok(state.mtime > 0)

  fs.writeFileSync(path.join(dir, 'state.json'), '{ truncated')
  assert.equal(readRunState(cwd, RUN), null, 'an unreadable state file is no state file')
  assert.equal(readRunState(cwd, 'absent-run-20260101-0900'), null)
  fs.rmSync(cwd, { recursive: true, force: true })
})

test('a run with no transcripts anywhere reports empty rather than throwing', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'speccy-empty-'))
  const found = discover(root, RUN)
  assert.deepEqual(found.sessions, [])
  assert.match(render(buildReport(RUN, found)), /No usage records found/)
  fs.rmSync(root, { recursive: true, force: true })
})

test('the run id comes from .current-runid when no argument is given', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'speccy-cwd-'))
  fs.mkdirSync(path.join(cwd, '.speccy'), { recursive: true })
  fs.writeFileSync(path.join(cwd, '.speccy', '.current-runid'), `${RUN}\n`)
  assert.equal(resolveRunId(cwd, []), RUN)
  assert.equal(resolveRunId(cwd, ['explicit-run-20260101-0900']), 'explicit-run-20260101-0900')
  fs.rmSync(cwd, { recursive: true, force: true })
})

// ------------------------------------------------- where the transcripts are

// A run that moves checkout partway through lands its later transcripts under
// a project directory named for the new cwd, which cwd no longer suggests.
function movedTree() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'speccy-moved-'))
  // Swept, and holds nothing for this run.
  fs.mkdirSync(path.join(root, 'projects', '-repo'), { recursive: true })

  const moved = path.join(root, 'elsewhere', '-repo--claude-worktrees-feature')
  fs.mkdirSync(moved, { recursive: true })
  fs.writeFileSync(path.join(moved, 'sess-m.jsonl'), [
    bannerCall({ ts: at(9, 0) }),
    stateWrite({ ts: at(9, 10), phase: 'spec-critique' }),
    assistant({ ts: at(9, 20), out: 320 }),
    stateWrite({ ts: at(9, 50), phase: 'complete' }),
  ].join('\n') + '\n')

  return { root, moved }
}

function twoProjectTree() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'speccy-two-'))
  for (const [name, session] of [['-repo', 'sess-here'], ['-other', 'sess-there']]) {
    const dir = path.join(root, 'projects', name)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, `${session}.jsonl`), [
      bannerCall({ ts: at(9, 0) }),
      stateWrite({ ts: at(9, 10), phase: 'spec-critique' }),
      assistant({ ts: at(9, 20), out: 10 }),
    ].join('\n') + '\n')
  }
  return root
}

test('a cwd derives the project directory the harness named after it', () => {
  assert.equal(projectDirName('/repo'), '-repo')
  assert.equal(projectDirName('/Users/dev/proj/.claude/worktrees/feature'), '-Users-dev-proj--claude-worktrees-feature')
  assert.equal(projectDirName('C:\\Users\\dev\\proj'), 'C:-Users-dev-proj')
})

test('the search list keeps the recorded directories that exist, in order, once each', () => {
  const { root, moved } = movedTree()
  const dirs = transcriptSearchDirs(root, {
    transcriptDirs: [moved, moved, '-repo', path.join(root, 'projects', '-gone')],
    cwd: '/repo',
  })
  assert.deepEqual(dirs, [moved, path.join(root, 'projects', '-repo')], 'a bare name resolves under projects/, a missing one is dropped, and cwd duplicates it')
  assert.deepEqual(transcriptSearchDirs(root, {}), [], 'no hint, no list')
  fs.rmSync(root, { recursive: true, force: true })
})

test('a recorded transcript directory outside projects/ is where the run is found', () => {
  const { root, moved } = movedTree()
  assert.deepEqual(discover(root, RUN).sessions, [], 'the sweep alone cannot reach it')

  const found = discover(root, RUN, { transcriptDirs: [moved] })
  assert.deepEqual(found.sessions.map((s) => s.sessionId), ['sess-m'])
  assert.equal(found.fellBack, false)
  assert.equal(found.records.some((r) => r.out === 320), true, 'and its usage is read')
  fs.rmSync(root, { recursive: true, force: true })
})

test('cwd narrows the walk to its own project directory', () => {
  const root = twoProjectTree()
  assert.deepEqual(discover(root, RUN, { cwd: '/repo' }).sessions.map((s) => s.sessionId), ['sess-here'])
  assert.deepEqual(discover(root, RUN).sessions.map((s) => s.sessionId).sort(), ['sess-here', 'sess-there'])
  fs.rmSync(root, { recursive: true, force: true })
})

test('a hint that holds nothing falls back to every project directory, and the report says so', () => {
  const root = tree()
  const stale = path.join(root, 'projects', '-stale')
  fs.mkdirSync(stale, { recursive: true })

  const found = discover(root, RUN, { transcriptDirs: [stale], cwd: '/gone' })
  assert.deepEqual(found.sessions.map((s) => s.sessionId), ['sess-a'], 'the sweep still finds it')
  assert.equal(found.fellBack, true)
  assert.ok(buildReport(RUN, found).notes.some((n) => /held nothing for this run/.test(n)))
  fs.rmSync(root, { recursive: true, force: true })
})

test('readRunState reads the recorded transcript directories, and tolerates their absence', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'speccy-dirs-'))
  const dir = path.join(cwd, '.speccy', RUN)
  fs.mkdirSync(dir, { recursive: true })
  const state = (extra) => {
    fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({ runId: RUN, phase: 'complete', ...extra }))
    return readRunState(cwd, RUN)
  }

  assert.deepEqual(state({ transcriptDirs: ['/a', '/b'] }).transcriptDirs, ['/a', '/b'])
  assert.deepEqual(state({}).transcriptDirs, [], 'a run recorded before the field existed')
  assert.deepEqual(state({ transcriptDirs: 'not-a-list' }).transcriptDirs, [])
  assert.deepEqual(state({ transcriptDirs: ['/a', 7, ''] }).transcriptDirs, ['/a'])
  fs.rmSync(cwd, { recursive: true, force: true })
})

test('the command finds a moved run from state.json alone', () => {
  const { root, moved } = movedTree()
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'speccy-moved-cwd-'))
  fs.mkdirSync(path.join(cwd, '.speccy', RUN), { recursive: true })
  fs.writeFileSync(
    path.join(cwd, '.speccy', RUN, 'state.json'),
    JSON.stringify({ runId: RUN, phase: 'complete', checkoutPath: cwd, transcriptDirs: [moved] }, null, 2),
  )

  const stdout = execFileSync(process.execPath, [path.join(SKILL_DIR, 'metrics.mjs'), RUN], {
    encoding: 'utf8',
    cwd,
    env: { ...process.env, CLAUDE_CONFIG_DIR: root },
  })
  assert.match(stdout, /### spec-critique/)
  assert.doesNotMatch(stdout, /held nothing for this run/)
  assert.match(fs.readFileSync(path.join(cwd, '.speccy', RUN, 'metrics.md'), 'utf8'), /# Run metrics/)
  fs.rmSync(root, { recursive: true, force: true })
  fs.rmSync(cwd, { recursive: true, force: true })
})

// ------------------------------------------------------------ number format

test('counts read as k / M / B to three significant figures', () => {
  assert.deepEqual(
    [0, 42, 999, 1000, 2924, 19_060, 573_757, 4_716_189, 44_306_207, 1_080_789_196].map(num),
    ['0', '42', '999', '1.00k', '2.92k', '19.1k', '574k', '4.72M', '44.3M', '1.08B'],
  )
})

test('a negative or non-finite count does not produce nonsense', () => {
  assert.equal(num(-2500), '-2.50k')
  assert.equal(num(NaN), '-')
})

test('rounding that crosses a scale boundary steps up, rather than printing 1000k', () => {
  assert.deepEqual(
    [999_499, 999_500, 999_999, 999_999_999].map(num),
    ['999k', '1.00M', '1.00M', '1.00B'],
  )
})

// ------------------------------------------------------------ the wrapper

test('the wrapper exits 0 and says so when node is absent', () => {
  // A PATH holding nothing but bash, so `command -v node` cannot succeed
  // wherever node happens to be installed.
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'speccy-nonode-'))
  const bash = execFileSync('command', ['-v', 'bash'], { encoding: 'utf8', shell: true }).trim()
  fs.symlinkSync(bash, path.join(bin, 'bash'))

  const out = execFileSync(bash, [path.join(SKILL_DIR, 'metrics.sh')], {
    encoding: 'utf8',
    cwd: os.tmpdir(),
    env: { PATH: bin },
  })
  assert.match(out, /skipped \(needs node on PATH\)/)
  fs.rmSync(bin, { recursive: true, force: true })
})

test('the wrapper exits 0 when there is no run to measure', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'speccy-norun-'))
  const out = execFileSync('bash', [path.join(SKILL_DIR, 'metrics.sh')], { encoding: 'utf8', cwd, stdio: ['pipe', 'pipe', 'pipe'] })
  assert.equal(out.trim(), '')
  fs.rmSync(cwd, { recursive: true, force: true })
})
