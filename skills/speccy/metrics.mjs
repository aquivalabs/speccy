// Per-phase time and token metrics for a speccy run, read after the fact from
// the harness transcripts.
//
// Nothing in a live session exposes token counts to the orchestrator, so speccy
// cannot record its own usage as it goes; any figure it wrote would be invented.
// The transcripts already hold everything: each assistant message carries a
// `usage` object and an ISO timestamp, and every subagent (including
// plan-execution's workflow agents) writes its own transcript under the parent
// session directory.
//
// Phase boundaries come from the run's own state.json writes, which the
// transcript records with their content and a timestamp. So no state.json field
// is needed and its schema stays closed.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ACTIVE_GAP_MS = 120_000
const MODEL_FAMILIES = ['opus', 'sonnet', 'haiku', 'fable']

// The first phase state.json can record. A timeline opening on any other phase
// has lost its earlier state writes.
const FIRST_PHASE = 'spec-critique'

// ---------------------------------------------------------------- parsing

/**
 * JSONL text -> entries, parsed once. Every reader below takes the result, so a
 * transcript is parsed one time however many things are read from it.
 */
export function parseTranscript(text) {
  const entries = []
  let malformed = 0
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    try {
      entries.push(JSON.parse(line))
    } catch {
      malformed++
    }
  }
  return { entries, malformed }
}

/**
 * Entries -> usage records. `agent` is null for main-loop records.
 */
export function usageRecords(entries, agent = null) {
  const records = []
  for (const e of entries) {
    const u = e.message?.usage
    if (!u || typeof u !== 'object') continue
    const model = e.message?.model
    if (!model || model === '<synthetic>') continue
    const ts = Date.parse(e.timestamp)
    if (Number.isNaN(ts)) continue
    records.push({
      ts,
      model,
      effort: e.effort ?? null,
      agent,
      // Top-level fields only. `usage` also carries an `iterations` array that
      // repeats these same counts per inference iteration, so anything that
      // sums the whole object (or greps the line) double counts silently.
      out: u.output_tokens ?? 0,
      cacheRead: u.cache_read_input_tokens ?? 0,
      cacheWrite: u.cache_creation_input_tokens ?? 0,
      uncachedIn: u.input_tokens ?? 0,
    })
  }
  return records
}

/**
 * An agent's opening prompt, trimmed to one short line. Workflow subagents get
 * no `description` in their sidecar, so without this they show as hex ids.
 */
export function firstPromptLine(entries, max = 60) {
  for (const e of entries) {
    if (e.type !== 'user') continue
    const content = e.message?.content
    const raw = typeof content === 'string'
      ? content
      : (Array.isArray(content) ? content.find((c) => c?.type === 'text')?.text : null)
    if (typeof raw !== 'string' || !raw.trim()) continue
    const line = raw.trim().replace(/\s+/g, ' ')
    return line.length > max ? `${line.slice(0, max - 1)}…` : line
  }
  return null
}

/** First and last timestamp of any entry, which bounds an agent's lifetime. */
export function transcriptSpan(entries) {
  const stamps = entries.map((e) => Date.parse(e.timestamp)).filter((t) => !Number.isNaN(t))
  if (!stamps.length) return null
  return { from: Math.min(...stamps), to: Math.max(...stamps) }
}

function toolUses(entries) {
  const uses = []
  for (const e of entries) {
    const content = e.message?.content
    if (!Array.isArray(content)) continue
    for (const c of content) {
      if (c?.type === 'tool_use') uses.push({ entry: e, use: c })
    }
  }
  return uses
}

/** A path is the run's state file regardless of separator or absolute prefix. */
export function isStateWrite(filePath, runId) {
  if (typeof filePath !== 'string') return false
  return filePath.replace(/\\/g, '/').endsWith(`.speccy/${runId}/state.json`)
}

function phaseFromText(s) {
  if (typeof s !== 'string') return null
  try {
    const parsed = JSON.parse(s)
    if (typeof parsed?.phase === 'string') return parsed.phase
  } catch {
    // Not whole-file content; fall through to the fragment match below.
  }
  const m = s.match(/"phase"\s*:\s*"([a-z-]+)"/)
  return m ? m[1] : null
}

function phaseFromInput(name, input) {
  if (!input) return null
  if (name === 'Write') return phaseFromText(input.content)
  if (name === 'Edit') return phaseFromText(input.new_string)
  if (name === 'MultiEdit') {
    for (const edit of [...(input.edits ?? [])].reverse()) {
      const phase = phaseFromText(edit?.new_string)
      if (phase) return phase
    }
  }
  return null
}

/** Entries -> [{ts, phase}] for every state write that assigns a phase. */
export function phaseBoundaries(entries, runId) {
  const found = []
  for (const { entry, use } of toolUses(entries)) {
    if (!isStateWrite(use.input?.file_path, runId)) continue
    const phase = phaseFromInput(use.name, use.input)
    if (!phase) continue // a round-counter bump leaves `phase` untouched
    const ts = Date.parse(entry.timestamp)
    if (!Number.isNaN(ts)) found.push({ ts, phase })
  }
  return found
}

/** Does this session actually belong to the run, or merely mention it? */
export function writesRunState(entries, runId) {
  return toolUses(entries).some(({ use }) => isStateWrite(use.input?.file_path, runId))
}

/** The banner is shown on every speccy invocation, so it marks the run's start. */
export function bannerMarker(entries) {
  for (const { entry, use } of toolUses(entries)) {
    if (use.name !== 'Bash') continue
    if (!String(use.input?.command ?? '').includes('banner.sh')) continue
    const ts = Date.parse(entry.timestamp)
    if (!Number.isNaN(ts)) return ts
  }
  return null
}

// ---------------------------------------------------------------- timeline

/**
 * Boundaries -> contiguous phase buckets. `start` opens the first bucket, which
 * covers the intake and interview that run before state.json exists. `end`
 * closes the last one.
 */
export function buildTimeline(boundaries, { start, end, firstPhase = 'spec' }) {
  const sorted = [...boundaries].sort((a, b) => a.ts - b.ts)
  const marks = []
  for (const b of sorted) {
    if (marks.length && marks[marks.length - 1].phase === b.phase) continue
    marks.push(b)
  }

  const buckets = []
  if (!marks.length) return [{ phase: firstPhase, from: start, to: end }]
  if (marks[0].ts > start) buckets.push({ phase: firstPhase, from: start, to: marks[0].ts })
  marks.forEach((m, i) => {
    buckets.push({ phase: m.phase, from: m.ts, to: i + 1 < marks.length ? marks[i + 1].ts : end })
  })
  return buckets
}

function activeMs(stamps) {
  const sorted = [...stamps].sort((a, b) => a - b)
  let total = 0
  for (let i = 1; i < sorted.length; i++) {
    const gap = sorted[i] - sorted[i - 1]
    if (gap <= ACTIVE_GAP_MS) total += gap
  }
  return total
}

function overlapMs(a, b) {
  return Math.max(0, Math.min(a.to, b.to) - Math.max(a.from, b.from))
}

function blankTotals() {
  return { out: 0, cacheWrite: 0, cacheRead: 0, uncachedIn: 0, requests: 0 }
}

function addTo(totals, r) {
  totals.out += r.out
  totals.cacheWrite += r.cacheWrite
  totals.cacheRead += r.cacheRead
  totals.uncachedIn += r.uncachedIn
  totals.requests += 1
}

function groupByModel(records) {
  const groups = new Map()
  for (const r of records) {
    const key = `${r.model}|${r.effort ?? '-'}`
    if (!groups.has(key)) {
      groups.set(key, { model: r.model, effort: r.effort ?? '-', ...blankTotals() })
    }
    addTo(groups.get(key), r)
  }
  return [...groups.values()].sort((a, b) => b.out - a.out)
}

/**
 * Records -> per-phase rollup. Each record is placed by its own timestamp, so a
 * subagent straddling a boundary splits across both phases.
 */
export function bucketByPhase(records, timeline, agents = []) {
  const dropped = []
  const assigned = timeline.map(() => [])

  for (const r of records) {
    const i = timeline.findIndex((b, idx) => r.ts >= b.from && (r.ts < b.to || idx === timeline.length - 1))
    if (i === -1) dropped.push(r)
    else assigned[i].push(r)
  }

  const phases = timeline.map((bucket, i) => {
    const rs = assigned[i]
    const agentMs = agents.reduce(
      (sum, a) => sum + (a.span ? overlapMs(a.span, bucket) : 0),
      0,
    )
    return {
      phase: bucket.phase,
      from: bucket.from,
      to: bucket.to,
      wall: bucket.to - bucket.from,
      active: activeMs(rs.map((r) => r.ts)),
      agentMs,
      byModel: groupByModel(rs),
      totals: rs.reduce((t, r) => (addTo(t, r), t), blankTotals()),
    }
  })

  return { phases, dropped }
}

// ---------------------------------------------------------------- models

/** The requested alias is a family name; the transcript records a resolved id. */
export function modelMismatch(requested, resolved) {
  if (!requested || !resolved) return false
  if (requested === resolved) return false
  if (!MODEL_FAMILIES.includes(requested)) return requested !== resolved
  return !resolved.includes(requested)
}

// ---------------------------------------------------------------- discovery

function readIfFile(file) {
  try {
    return fs.readFileSync(file, 'utf8')
  } catch {
    return null
  }
}

/**
 * A sidecar is written by the harness as the agent starts, so a session killed
 * mid-write leaves a truncated one. Losing an agent's label is not a reason to
 * lose the whole report.
 */
function readJson(file) {
  const text = readIfFile(file)
  if (text === null) return {}
  try {
    return JSON.parse(text) ?? {}
  } catch {
    return {}
  }
}

function listDir(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
}

function agentFiles(dir, out = []) {
  for (const entry of listDir(dir)) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) agentFiles(full, out)
    else if (entry.name.startsWith('agent-') && entry.name.endsWith('.jsonl')) out.push(full)
  }
  return out
}

/**
 * A run id ends in YYYYMMDD-HHmm; a contributing transcript cannot predate it.
 * The id is stamped in local time and mtimes are absolute, so an hour of slack
 * absorbs any disagreement between the two.
 */
export function runIdStart(runId) {
  const m = runId.match(/(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})$/)
  if (!m) return null
  const [, y, mo, d, h, mi] = m.slice(1).map(Number)
  return new Date(y, mo - 1, d, h, mi).getTime() - 3_600_000
}

/**
 * The run's own state file, which outranks the transcript on one question: did
 * the run finish? The transcript shows a phase transition only when it went
 * through a file-editing tool, and state.json gets written other ways. It
 * cannot replace the transcript scan, though, because it holds one overwritten
 * snapshot with no timestamps in it, so the phases before the last leave no
 * trace. Its mtime is when that last phase was set.
 */
export function readRunState(cwd, runId) {
  const file = path.join(cwd, '.speccy', runId, 'state.json')
  const text = readIfFile(file)
  if (text === null) return null
  let phase = null
  try {
    phase = JSON.parse(text)?.phase ?? null
  } catch {
    return null
  }
  try {
    return { phase, mtime: fs.statSync(file).mtimeMs }
  } catch {
    return { phase, mtime: null }
  }
}

/**
 * Walk the transcripts for one run. `configRoot` is a parameter rather than an
 * environment read so a fixture tree can stand in for ~/.claude.
 */
export function discover(configRoot, runId) {
  const projects = path.join(configRoot, 'projects')
  const notBefore = runIdStart(runId)
  const sessions = []
  const mentionedOnly = []
  const agents = []
  let malformed = 0
  let records = []
  let boundaries = []
  let marker = null

  for (const project of listDir(projects)) {
    if (!project.isDirectory()) continue
    const projectDir = path.join(projects, project.name)
    for (const entry of listDir(projectDir)) {
      if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue
      const file = path.join(projectDir, entry.name)

      if (notBefore !== null) {
        // A session file is rewritten as it grows, so its mtime is the last
        // write. One that stopped before the run began cannot hold the run.
        try {
          if (fs.statSync(file).mtimeMs < notBefore) continue
        } catch {
          continue
        }
      }

      const text = readIfFile(file)
      if (text === null || !text.includes(runId)) continue
      const session = parseTranscript(text)
      if (!writesRunState(session.entries, runId)) {
        mentionedOnly.push(file)
        continue
      }

      malformed += session.malformed
      records = records.concat(usageRecords(session.entries))
      boundaries = boundaries.concat(phaseBoundaries(session.entries, runId))

      const banner = bannerMarker(session.entries)
      if (banner !== null && (marker === null || banner < marker)) marker = banner

      const sessionId = entry.name.replace(/\.jsonl$/, '')
      const subagents = path.join(projectDir, sessionId, 'subagents')
      for (const agentFile of agentFiles(subagents)) {
        const id = path.basename(agentFile).replace(/\.jsonl$/, '')
        const agentText = readIfFile(agentFile)
        if (agentText === null) continue
        const meta = readJson(agentFile.replace(/\.jsonl$/, '.meta.json'))
        const { entries: agentEntries, malformed: agentMalformed } = parseTranscript(agentText)
        const agentRecords = usageRecords(agentEntries, id)
        malformed += agentMalformed
        records = records.concat(agentRecords)
        const workflow = agentFile.replace(/\\/g, '/').match(/\/workflows\/(wf_[^/]+)\//)?.[1] ?? null
        agents.push({
          id,
          label: meta.description ?? firstPromptLine(agentEntries) ?? id,
          workflow,
          agentType: meta.agentType ?? null,
          requested: meta.model ?? null,
          resolved: [...new Set(agentRecords.map((r) => r.model))],
          efforts: [...new Set(agentRecords.map((r) => r.effort ?? '-'))],
          span: transcriptSpan(agentEntries),
          totals: agentRecords.reduce((t, r) => (addTo(t, r), t), blankTotals()),
        })
      }

      sessions.push({ file, sessionId, project: project.name })
    }
  }

  return { sessions, mentionedOnly, agents, records, boundaries, marker, malformed }
}

// ---------------------------------------------------------------- reporting

const SCALES = [[1e9, 'B'], [1e6, 'M'], [1e3, 'k']]

/**
 * Counts to three significant figures. Nobody needs the last digit of a
 * 613-million-token cache read, and exact figures make the columns unscannable.
 */
export function num(n) {
  if (!Number.isFinite(n)) return '-'
  if (Math.abs(n) < 1000) return String(n)
  // Round first, then pick the scale: rounding 999,999 up crosses into the next
  // one, and choosing the scale from the raw value would print it as "1000k".
  const rounded = Number(n.toPrecision(3))
  const [limit, suffix] = SCALES.find(([l]) => Math.abs(rounded) >= l)
  const scaled = rounded / limit
  const decimals = Math.abs(scaled) >= 100 ? 0 : Math.abs(scaled) >= 10 ? 1 : 2
  return `${scaled.toFixed(decimals)}${suffix}`
}

function duration(ms) {
  if (ms <= 0) return '0m'
  const mins = Math.round(ms / 60_000)
  if (mins < 60) return `${mins}m`
  return `${Math.floor(mins / 60)}h ${mins % 60}m`
}

/**
 * Agent labels are arbitrary prose: a sidecar description, or the agent's own
 * opening prompt, which routinely holds a shell snippet. An unescaped pipe adds
 * a column and shifts every cell in the row.
 */
function cell(value) {
  return String(value).replace(/\s+/g, ' ').replace(/\|/g, '\\|').trim()
}

function modelTable(rows) {
  const lines = [
    '| model | effort | output | cache write | uncached input | cache read |',
    '| --- | --- | --- | --- | --- | --- |',
  ]
  for (const r of rows) {
    lines.push(
      `| ${cell(r.model)} | ${cell(r.effort)} | ${num(r.out)} | ${num(r.cacheWrite)} | ${num(r.uncachedIn)} | ${num(r.cacheRead)} |`,
    )
  }
  return lines.join('\n')
}

/** An agent belongs to the run if any part of its life falls inside the window. */
function overlapsRun(agent, start, end) {
  return agent.span !== null && agent.span.from <= end && agent.span.to >= start
}

export function buildReport(runId, found, { state = null } = {}) {
  const stamps = found.records.map((r) => r.ts)
  if (!stamps.length) return { runId, empty: true, sessions: found.sessions, notes: [] }

  const ordered = [...found.boundaries].sort((a, b) => a.ts - b.ts)
  const start = found.marker ?? Math.min(...stamps)
  const latest = Math.max(...stamps)

  // `complete` is the wrap-up's last act, not a phase that does work. It closes
  // the run, so the timeline ends there and anything later is somebody's next
  // job in the same session rather than this run's cost.
  const completed = ordered.find((b) => b.phase === 'complete') ?? null

  // A `complete` the transcript missed, because the write went through Bash
  // rather than a file-editing tool. state.json says the run finished and its
  // mtime says when, which beats running the last phase on to the last record.
  const lastMark = ordered.length ? ordered[ordered.length - 1].ts : start
  const stateClose = !completed && state?.phase === 'complete' && state.mtime !== null
    // Capped at the last record so a state file touched afterwards cannot
    // stretch the run past anything that actually happened in it.
    ? Math.min(state.mtime, latest)
    : null
  const closedByState = stateClose !== null && stateClose >= lastMark

  const end = completed ? completed.ts : closedByState ? stateClose : latest

  // The opening bucket normally holds the intake and interview, which precede
  // state.json. When the earliest surviving boundary is later than the first
  // phase, it holds several unattributable phases instead, so name it honestly.
  const earliest = ordered[0]
  const startsMidRun = earliest && earliest.phase !== FIRST_PHASE
  const timeline = buildTimeline(ordered.filter((b) => b !== completed), {
    start,
    end,
    firstPhase: startsMidRun ? `before ${earliest.phase}` : 'spec',
  })
  const inRun = found.records.filter((r) => r.ts >= start && r.ts <= end)
  const beforeRun = found.records.filter((r) => r.ts < start).length
  const afterRun = found.records.filter((r) => r.ts > end)

  // A session outlives the run it hosted: it may have run an earlier speccy run,
  // a later one, or unrelated work. Their subagents sit in the same directory,
  // so the window is what separates this run's agents from theirs.
  const agents = found.agents.filter((a) => overlapsRun(a, start, end))
  const outsideRun = found.agents.filter((a) => !overlapsRun(a, start, end))
  const { phases, dropped } = bucketByPhase(inRun, timeline, agents)

  const finished = completed !== null || closedByState

  const notes = []
  if (!finished) {
    notes.push('This run has not reached `complete`, so its last phase has no end. That phase\'s wall time runs to the last thing the session did, which may be unrelated work days later; read its active time and agent-seconds instead.')
  }
  if (closedByState) {
    notes.push('No `complete` write appears in the transcripts, so the timeline closes at `state.json`\'s own timestamp instead. That happens when the run marked itself complete through a shell command rather than a file-editing tool: the state file records the phase, but only a tool call records the moment.')
  }
  if (afterRun.length) {
    // The call that produced this report is itself one of them, so a small count
    // here is the normal shape rather than a sign of anything.
    const out = afterRun.reduce((t, r) => t + r.out, 0)
    notes.push(`${afterRun.length} record(s) totalling ${num(out)} output tokens come after the run was marked \`complete\` and are excluded. Reading these metrics is one of them; beyond that, a session carries on being used after the run it finished.`)
  }
  if (startsMidRun) {
    notes.push(`The earliest surviving state write sets \`${earliest.phase}\`, so the phases before it cannot be told apart. Their work is lumped into the opening bucket.`)
  }
  if (found.marker === null) {
    notes.push('No banner call found, so the first phase starts at the earliest record in the session. It may include work done before speccy was invoked.')
  }
  if (beforeRun) notes.push(`${beforeRun} record(s) predate the run's start marker and are excluded.`)
  if (dropped.length) notes.push(`${dropped.length} record(s) fell outside every phase and are excluded.`)
  if (outsideRun.length) {
    const out = outsideRun.reduce((t, a) => t + a.totals.out, 0)
    notes.push(`${outsideRun.length} subagent(s) in these sessions ran wholly outside the run's window and are excluded, together with their ${num(out)} output tokens. They belong to other work the session did.`)
  }
  if (found.malformed) notes.push(`${found.malformed} unparseable transcript line(s) skipped.`)
  if (found.mentionedOnly.length) {
    notes.push(`${found.mentionedOnly.length} session(s) mention this run but never wrote its state file, so they are excluded.`)
  }
  for (const a of agents) {
    for (const resolved of a.resolved) {
      if (modelMismatch(a.requested, resolved)) {
        notes.push(`Model mismatch: "${a.label}" requested \`${a.requested}\` and ran on \`${resolved}\`.`)
      }
    }
  }

  return {
    runId,
    empty: false,
    // An unfinished run has no closing boundary, so its last bucket runs to the
    // last record rather than to a phase end. Its wall figure is a lower bound.
    // Held as an index, since a pipeline that revisits a phase repeats its name.
    openPhase: finished ? null : phases.length - 1,
    sessions: found.sessions,
    agents,
    phases,
    totals: groupByModel(inRun),
    notes,
  }
}

export function render(report) {
  if (report.empty) {
    return `# Run metrics: ${report.runId}\n\nNo usage records found for this run.\n`
  }

  const out = [`# Run metrics: ${report.runId}`, '']
  out.push(
    `Read from ${report.sessions.length} session transcript(s) and ${report.agents.length} subagent transcript(s).`,
    '',
    'Tokens are grouped by model and reasoning effort. Apply current rates yourself.',
    '',
    '- **wall**: first to last moment of the phase, including time spent reading.',
    '- **active**: the same span with gaps over 2 minutes removed. A heuristic, not instrumentation.',
    '- **agent-seconds**: summed subagent lifetimes, so parallel work shows its true weight.',
    '- **cache write / uncached input / cache read**: the three parts of each request\'s input, ordered by cost per token. A cache write costs more than uncached input (1.25x the base input rate at the 5-minute TTL, 2x at the 1-hour), uncached input is the base rate, and a cache read is about a tenth of it. Uncached input is normally a couple of tokens per request, so a large figure is a handful of cache misses rather than a phase-wide trait.',
    '- **output**: tokens the model generated. The honest measure of work done, since cache reads swamp everything else by volume and cost a fraction as much.',
    '- **effort** `-`: unrecorded, which means the model has no reasoning-effort setting. It does not mean low.',
    '',
    'Counts are rounded to three significant figures, so a column of phases will not add up to its total exactly.',
    '',
    '## Phases',
    '',
  )

  report.phases.forEach((p, i) => {
    const agentPart = p.agentMs ? ` · ${duration(p.agentMs)} agent-seconds` : ' · no subagents'
    const wall = i === report.openPhase ? `at least ${duration(p.wall)} wall (phase never closed)` : `${duration(p.wall)} wall`
    const requests = `${num(p.totals.requests)} request${p.totals.requests === 1 ? '' : 's'}`
    out.push(`### ${p.phase}`, '', `${wall} · ${duration(p.active)} active${agentPart} · ${requests}`, '')
    out.push(p.byModel.length ? modelTable(p.byModel) : '_No requests recorded in this phase._', '')
  })

  out.push('## Run total', '', modelTable(report.totals), '')

  if (report.agents.length) {
    out.push('## Agents', '')
    out.push(
      '| agent | type | requested | resolved | effort | output | cache write | cache read | span |',
      '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    )
    const byOutput = [...report.agents].sort((a, b) => b.totals.out - a.totals.out)
    for (const a of byOutput) {
      const resolved = a.resolved.join(', ') || '-'
      const flag = a.resolved.some((r) => modelMismatch(a.requested, r)) ? ' ⚠' : ''
      const span = a.span ? duration(a.span.to - a.span.from) : '-'
      const type = [a.agentType ?? '-', a.workflow ? `(${a.workflow})` : ''].join(' ').trim()
      out.push(
        `| ${cell(a.label)} | ${cell(type)} | ${cell(a.requested ?? '-')}${flag} | ${cell(resolved)} | ${cell(a.efforts.join(', ') || '-')} | ${num(a.totals.out)} | ${num(a.totals.cacheWrite)} | ${num(a.totals.cacheRead)} | ${span} |`,
      )
    }
    out.push('')
  }

  if (report.notes.length) {
    out.push('## Notes', '')
    for (const n of report.notes) out.push(`- ${n}`)
    out.push('')
  }

  out.push(
    '_Transcripts are pruned on the `cleanupPeriodDays` schedule (30 days by default), so a run measured long after it ran will under-report._',
    '',
  )

  return out.join('\n')
}

// ---------------------------------------------------------------- entry point

export function resolveRunId(cwd, argv) {
  if (argv[0]) return argv[0]
  const pointer = readIfFile(path.join(cwd, '.speccy', '.current-runid'))
  return pointer ? pointer.trim() : null
}

export function main(argv = process.argv.slice(2), cwd = process.cwd()) {
  const runId = resolveRunId(cwd, argv)
  if (!runId) {
    process.stderr.write('speccy metrics: no run id given and no .speccy/.current-runid found\n')
    return 0
  }

  const configRoot = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')
  const found = discover(configRoot, runId)
  if (!found.sessions.length) {
    process.stderr.write(`speccy metrics: no transcripts found for run "${runId}"\n`)
    return 0
  }

  const text = render(buildReport(runId, found, { state: readRunState(cwd, runId) }))
  const target = path.join(cwd, '.speccy', runId, 'metrics.md')
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, text)
    process.stdout.write(text)
    process.stdout.write(`\nWritten to ${path.relative(cwd, target)}\n`)
  } catch (err) {
    process.stdout.write(text)
    process.stderr.write(`speccy metrics: could not write ${target}: ${err.message}\n`)
  }
  return 0
}

// fileURLToPath rather than the URL's pathname, which on Windows yields a
// leading-slash path that resolves to the wrong thing.
const thisFile = fileURLToPath(import.meta.url)
if (process.argv[1] && path.resolve(process.argv[1]) === thisFile) process.exit(main())
