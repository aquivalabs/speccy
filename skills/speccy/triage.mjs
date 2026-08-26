// The convergence table for one review round: every lens file reduced to one
// ranked list of anchors.
//
// Several independent lenses landing on the same `file:line` is the strongest
// signal the panel produces, and it is the one thing no single lens file can
// show. Finding it by reading eight files costs the orchestrator the context
// the triage judgement itself needs, and at 30-60 findings a round the anchors
// that repeat are exactly what gets lost.
//
// Every lens writes the shape in `prompts/review-output-contract.md`, so the
// merge is mechanical and belongs in a script. This does the merge and nothing
// else: it counts, ranks, and points. The lens files remain the source of
// detail and every disposition remains the orchestrator's.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_WINDOW = 5
const SEVERITIES = ['blocker', 'major', 'minor']
const VERDICTS = ['confirmed', 'plausible']
const PRIOR_FILES = ['deferred.md', 'settled.md']

// ---------------------------------------------------------------- parsing

/**
 * A header may arrive as a heading, a list item, a quote, or bold, since the
 * contract fixes the fields and not the Markdown around them.
 */
export function stripDecoration(line) {
  return line
    .replace(/^\s*(?:[>#]+\s*|[-*+]\s+|\d+[.)]\s+)+/, '')
    .replace(/\*\*/g, '')
    .trim()
}

function normaliseFile(raw) {
  return raw.replace(/\\/g, '/').replace(/^\.\//, '').trim()
}

/**
 * `file:line`, a tight range, or a file whose finding isn't line-specific. The
 * range collapses to its first line for grouping and keeps its end for display.
 */
export function parseAnchor(field) {
  if (typeof field !== 'string') return null
  const text = field.replace(/[`*]/g, '').trim()
  if (!text) return null

  const ranged = text.match(/^(.+?):\s*(\d+)(?:\s*[-–—]\s*(\d+))?\s*$/)
  if (ranged) {
    const line = Number(ranged[2])
    const end = ranged[3] ? Number(ranged[3]) : line
    const file = normaliseFile(ranged[1])
    if (!file || /\s/.test(file)) return null
    return { file, line, endLine: Math.max(line, end) }
  }

  // The contract's `—` for a finding that isn't line-specific, and the bare
  // file some lenses write instead.
  const lineless = text.match(/^(.+?)\s*:\s*[-–—?]?\s*$/)
  const file = normaliseFile(lineless ? lineless[1] : text)
  // A path with a space in it is legal and vanishingly rare; prose in this
  // field is neither, and this is what tells the two apart.
  if (!file || /\s/.test(file)) return null
  return { file, line: null, endLine: null }
}

function matchWord(field, words) {
  if (typeof field !== 'string') return null
  const found = field.toLowerCase().match(new RegExp(`\\b(${words.join('|')})\\b`))
  return found ? found[1] : null
}

/** Does this line claim to be a finding header, whether or not it parses? */
export function looksLikeHeader(line) {
  return /^\[[^\]\s]+\]/.test(stripDecoration(line))
}

/**
 * One header line -> a finding. Returns null for anything that doesn't carry an
 * anchor and a severity, which is the minimum a table row can be built from.
 */
export function parseFinding(line) {
  const bare = stripDecoration(line)
  const head = bare.match(/^\[([^\]\s]+)\]\s*(.+)$/)
  if (!head) return null

  // The summary may hold the separator itself, so only the first three splits
  // are fields.
  const fields = head[2].split(/\s*[·•]\s*/)
  if (fields.length < 4) return null

  const anchor = parseAnchor(fields[0])
  if (!anchor) return null
  const severity = matchWord(fields[1], SEVERITIES)
  if (!severity) return null

  const verdict = matchWord(fields[2], VERDICTS)
  return {
    id: head[1],
    ...anchor,
    severity,
    // A lens that omits the verdict still has a locatable defect, and the
    // orchestrator reads the entry itself before dispositioning it.
    verdict: verdict ? verdict.toUpperCase() : '?',
    summary: fields.slice(3).join(' · ').trim() || '—',
  }
}

/**
 * One lens file's findings. The lens name comes from the filename rather than
 * the finding id: the file is what makes a lens independent, so a lens that
 * numbers its findings some other way still counts once.
 */
export function readLens(text, lens) {
  const findings = []
  let malformed = 0
  for (const line of text.split('\n')) {
    if (!line.includes('[')) continue
    const parsed = parseFinding(line)
    if (parsed) findings.push({ ...parsed, lens })
    else if (looksLikeHeader(line)) malformed++
  }
  return { findings, malformed }
}

// ---------------------------------------------------------------- grouping

const severityRank = (s) => {
  const i = SEVERITIES.indexOf(s)
  return i === -1 ? SEVERITIES.length : i
}

/**
 * Findings in one file -> clusters. A finding joins a cluster when it lands
 * within `window` lines of the line that opened it, rather than of the last one
 * added: chaining off the last would let a dense file drift a cluster across
 * hundreds of lines a few at a time.
 */
export function clusterByLine(findings, window) {
  const clusters = []
  const lined = findings.filter((f) => f.line !== null).sort((a, b) => a.line - b.line)
  let open = null
  for (const f of lined) {
    if (!open || f.line - open.anchor > window) {
      open = { anchor: f.line, findings: [] }
      clusters.push(open)
    }
    open.findings.push(f)
  }
  // A finding with no line can't be placed against one, so the file's lineless
  // findings converge only with each other.
  const lineless = findings.filter((f) => f.line === null)
  if (lineless.length) clusters.push({ anchor: null, findings: lineless })
  return clusters
}

function describeAnchor(file, findings) {
  const lines = findings.filter((f) => f.line !== null)
  if (!lines.length) return `${file}:—`
  const from = Math.min(...lines.map((f) => f.line))
  const to = Math.max(...lines.map((f) => f.endLine ?? f.line))
  return from === to ? `${file}:${from}` : `${file}:${from}-${to}`
}

/** Findings from every lens -> the ranked groups the table renders. */
export function groupFindings(findings, { window = DEFAULT_WINDOW } = {}) {
  const byFile = new Map()
  for (const f of findings) {
    if (!byFile.has(f.file)) byFile.set(f.file, [])
    byFile.get(f.file).push(f)
  }

  const groups = []
  for (const [file, inFile] of byFile) {
    for (const cluster of clusterByLine(inFile, window)) {
      const ordered = [...cluster.findings].sort(
        (a, b) => severityRank(a.severity) - severityRank(b.severity) || a.lens.localeCompare(b.lens),
      )
      const lenses = [...new Set(ordered.map((f) => f.lens))]
      groups.push({
        file,
        line: cluster.anchor,
        anchor: describeAnchor(file, ordered),
        lenses,
        severity: ordered[0].severity,
        verdicts: VERDICTS.map((v) => v.toUpperCase())
          .concat('?')
          .filter((v) => ordered.some((f) => f.verdict === v)),
        findings: ordered,
        prior: [],
      })
    }
  }

  return groups.sort(
    (a, b) =>
      b.lenses.length - a.lenses.length ||
      severityRank(a.severity) - severityRank(b.severity) ||
      a.file.localeCompare(b.file) ||
      (a.line ?? Infinity) - (b.line ?? Infinity),
  )
}

// ------------------------------------------------------------ prior calls

/**
 * Anchors already ruled on. Both files are prose written by the orchestrator
 * rather than a lens, so a whole finding header is read where one appears and a
 * bare `path:line` token where it doesn't.
 */
export function collectPriorAnchors(text, source) {
  const anchors = []
  for (const line of text.split('\n')) {
    const finding = parseFinding(line)
    if (finding) {
      anchors.push({ source, file: finding.file, line: finding.line })
      continue
    }
    for (const m of line.matchAll(/([^\s`|(),;:]+\.[A-Za-z0-9_]+):(\d+)/g)) {
      anchors.push({ source, file: normaliseFile(m[1]), line: Number(m[2]) })
    }
  }
  return anchors
}

/** Which prior files, if any, already hold this group's anchor. */
export function priorCalls(group, anchors, window) {
  const hits = new Set()
  for (const a of anchors) {
    if (a.file !== group.file) continue
    if (a.line === null) {
      if (group.line === null) hits.add(a.source)
      continue
    }
    if (group.findings.some((f) => f.line !== null && Math.abs(f.line - a.line) <= window)) {
      hits.add(a.source)
    }
  }
  return [...hits].sort()
}

// ---------------------------------------------------------------- reading

function readIfFile(file) {
  try {
    return fs.readFileSync(file, 'utf8')
  } catch {
    return null
  }
}

function listDir(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
}

export function lensFiles(dir, round) {
  const prefix = `review-round-${round}-`
  return listDir(dir)
    .filter((e) => e.isFile() && e.name.startsWith(prefix) && e.name.endsWith('.md'))
    .map((e) => ({ file: path.join(dir, e.name), lens: e.name.slice(prefix.length, -'.md'.length) }))
    .sort((a, b) => a.lens.localeCompare(b.lens))
}

export function collect(dir, round, { window = DEFAULT_WINDOW } = {}) {
  const files = lensFiles(dir, round)
  const findings = []
  const unreadable = []
  const silent = []
  let malformed = 0

  for (const { file, lens } of files) {
    const text = readIfFile(file)
    if (text === null) {
      unreadable.push(path.basename(file))
      continue
    }
    const read = readLens(text, lens)
    malformed += read.malformed
    if (!read.findings.length) silent.push(lens)
    findings.push(...read.findings)
  }

  const anchors = []
  const priorRead = []
  for (const name of PRIOR_FILES) {
    const text = readIfFile(path.join(dir, name))
    if (text === null) continue
    priorRead.push(name)
    anchors.push(...collectPriorAnchors(text, name.replace(/\.md$/, '')))
  }

  const groups = groupFindings(findings, { window })
  for (const g of groups) g.prior = priorCalls(g, anchors, window)

  return { round, window, files, groups, findings, malformed, unreadable, silent, priorRead }
}

// ---------------------------------------------------------------- rendering

/**
 * A summary is one sentence of a lens's own prose, and an unescaped pipe in it
 * adds a column and shifts every cell in the row.
 */
function cell(value) {
  return String(value).replace(/\s+/g, ' ').replace(/\|/g, '\\|').trim()
}

export function render(found) {
  const out = [`# Review round ${found.round}: convergence`, '']

  if (!found.files.length) {
    out.push(
      `No \`review-round-${found.round}-*.md\` files found. Triage from the lens files directly.`,
      '',
    )
    return out.join('\n')
  }

  const converging = found.groups.filter((g) => g.lenses.length > 1)
  const flagged = found.groups.filter((g) => g.prior.length)
  out.push(
    `${found.findings.length} finding(s) from ${found.files.length} lens file(s) over ${found.groups.length} anchor(s). ` +
      `${converging.length} anchor(s) carry more than one lens.`,
    '',
    `Findings within ${found.window} lines of the one that opened an anchor are grouped into it. ` +
      'Convergence raises confidence rather than collapsing to a single finding, so read every row.',
    '',
  )

  if (found.groups.length) {
    out.push(
      '| anchor | lenses | severity | verdict | prior call | findings |',
      '| --- | --- | --- | --- | --- | --- |',
    )
    for (const g of found.groups) {
      const lenses = `${g.lenses.length}: ${g.lenses.join(', ')}`
      const detail = g.findings.map((f) => `\`[${cell(f.id)}]\` ${cell(f.summary)}`).join('<br>')
      out.push(
        `| \`${cell(g.anchor)}\` | ${cell(lenses)} | ${g.severity} | ${g.verdicts.join(', ')} | ${g.prior.join(', ') || '–'} | ${detail} |`,
      )
    }
    out.push('')
  } else {
    out.push('_No findings parsed from these files._', '')
  }

  const notes = []
  if (flagged.length) {
    notes.push(
      `${flagged.length} anchor(s) carry a prior call, named in that column. Those were already ruled on, so drop them rather than re-fixing them.`,
    )
  }
  if (found.silent.length) notes.push(`No findings parsed from: ${found.silent.join(', ')}.`)
  if (found.malformed) {
    notes.push(
      `${found.malformed} line(s) open like a finding header but don't carry an anchor and a severity, and are not in the table. Read those lens files for what they say.`,
    )
  }
  if (found.unreadable.length) notes.push(`Could not read: ${found.unreadable.join(', ')}.`)
  if (!found.priorRead.length) {
    notes.push(`No ${PRIOR_FILES.join(' or ')} in this run directory, so nothing was checked against a prior call.`)
  }

  if (notes.length) {
    out.push('## Notes', '')
    for (const n of notes) out.push(`- ${n}`)
    out.push('')
  }

  out.push(
    '_The lens files hold the mechanism and the fix for each finding. Read an anchor\'s own entry there before dispositioning it._',
    '',
  )
  return out.join('\n')
}

// ---------------------------------------------------------------- entry point

export function parseArgs(argv) {
  const positional = []
  let window = DEFAULT_WINDOW
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const inline = arg.match(/^--window=(\d+)$/)
    if (inline) {
      window = Number(inline[1])
      continue
    }
    if (arg === '--window' && /^\d+$/.test(argv[i + 1] ?? '')) {
      window = Number(argv[++i])
      continue
    }
    positional.push(arg)
  }
  return { dir: positional[0] ?? null, round: positional[1] ?? null, window }
}

/** A run directory, or the run id whose directory it is. */
export function resolveRunDir(cwd, given) {
  const direct = path.resolve(cwd, given)
  if (fs.existsSync(direct)) return direct
  const under = path.resolve(cwd, '.speccy', given)
  return fs.existsSync(under) ? under : direct
}

export function main(argv = process.argv.slice(2), cwd = process.cwd()) {
  const { dir, round, window } = parseArgs(argv)
  // Nothing here may stand between the panel and its triage, so every bad input
  // is a line on stderr and a zero exit.
  if (!dir || !round) {
    process.stderr.write('speccy triage: usage: triage.sh <run-dir> <round> [--window N]\n')
    return 0
  }
  if (!/^\d+$/.test(round)) {
    process.stderr.write(`speccy triage: "${round}" is not a round number\n`)
    return 0
  }

  const runDir = resolveRunDir(cwd, dir)
  if (!fs.existsSync(runDir)) {
    process.stderr.write(`speccy triage: no run directory at ${runDir}\n`)
    return 0
  }

  process.stdout.write(render(collect(runDir, round, { window })))
  return 0
}

// fileURLToPath rather than the URL's pathname, which on Windows yields a
// leading-slash path that resolves to the wrong thing.
const thisFile = fileURLToPath(import.meta.url)
if (process.argv[1] && path.resolve(process.argv[1]) === thisFile) process.exit(main())
