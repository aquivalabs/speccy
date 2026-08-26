// Tests for triage.mjs. Run with: node --test skills/speccy/test/
//
// Fixtures are written here rather than committed: the lens files a real round
// produces name a repo's own paths and quote its code, which doesn't belong in
// a public repo, and a checked-in set would drift from the output contract.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

import {
  parseAnchor,
  parseFinding,
  looksLikeHeader,
  readLens,
  clusterByLine,
  groupFindings,
  collectPriorAnchors,
  priorCalls,
  lensFiles,
  collect,
  render,
  parseArgs,
  resolveRunDir,
} from '../triage.mjs'

const SKILL_DIR = path.resolve(import.meta.dirname, '..')

function runDir(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'speccy-triage-'))
  for (const [name, text] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), text)
  }
  return dir
}

const row = (found, anchorFragment) =>
  render(found)
    .split('\n')
    .find((l) => l.startsWith('|') && l.includes(anchorFragment))

// ------------------------------------------------------------ the contract shape

test('the contract shape parses into its five fields', () => {
  const f = parseFinding('[spec-fidelity-3] src/api/client.ts:142 · blocker · CONFIRMED · Retries swallow a 429.')
  assert.deepEqual(f, {
    id: 'spec-fidelity-3',
    file: 'src/api/client.ts',
    line: 142,
    endLine: 142,
    severity: 'blocker',
    verdict: 'CONFIRMED',
    summary: 'Retries swallow a 429.',
  })
})

test('a summary carrying the separator keeps all of it', () => {
  const f = parseFinding('[tests-1] a.ts:3 · minor · PLAUSIBLE · One case · then another.')
  assert.equal(f.summary, 'One case · then another.')
})

test('the header parses under the Markdown a lens wraps it in', () => {
  const expected = { id: 'tests-1', file: 'a.ts', line: 9, endLine: 9, severity: 'major', verdict: 'CONFIRMED', summary: 'No case for the empty list.' }
  for (const decorated of [
    '### [tests-1] a.ts:9 · major · CONFIRMED · No case for the empty list.',
    '- [tests-1] a.ts:9 · major · CONFIRMED · No case for the empty list.',
    '**[tests-1]** `a.ts:9` · major · CONFIRMED · No case for the empty list.',
    '> [tests-1] a.ts:9 · Major · Confirmed · No case for the empty list.',
  ]) {
    assert.deepEqual(parseFinding(decorated), expected, decorated)
  }
})

test('the contract\'s variations on the anchor all resolve', () => {
  assert.deepEqual(parseAnchor('src/a.ts:42'), { file: 'src/a.ts', line: 42, endLine: 42 })
  assert.deepEqual(parseAnchor('src/a.ts:42-48'), { file: 'src/a.ts', line: 42, endLine: 48 })
  assert.deepEqual(parseAnchor('`./src/a.ts`:7'), { file: 'src/a.ts', line: 7, endLine: 7 })
  assert.deepEqual(parseAnchor('src\\a.ts:7'), { file: 'src/a.ts', line: 7, endLine: 7 })
  // The contract's own form for a finding that isn't line-specific.
  assert.deepEqual(parseAnchor('docs/README.md:—'), { file: 'docs/README.md', line: null, endLine: null })
  assert.deepEqual(parseAnchor('docs/README.md'), { file: 'docs/README.md', line: null, endLine: null })
})

test('an unrecognised verdict still leaves a locatable finding', () => {
  const f = parseFinding('[x-1] a.ts:2 · minor · unsure · Might be dead code.')
  assert.equal(f.verdict, '?')
  assert.equal(f.severity, 'minor')
})

// ------------------------------------------------------------ malformed input

test('malformed lines are ignored, and only header-shaped ones are counted', () => {
  const text = [
    '# Round 2 — tests',
    '',
    '[tests-1] src/a.ts:10 · major · CONFIRMED · The happy path is the only case.',
    'The mechanism: the loop exits on the first match.',
    '[tests-2] src/a.ts · CONFIRMED · No severity in this one.',
    '[tests-3] not an anchor at all · major · CONFIRMED · Prose where the anchor goes.',
    '[tests-4] src/a.ts:10 major CONFIRMED no separators anywhere',
    'See [the contract](prompts/review-output-contract.md) for the shape.',
    'An array literal like [1, 2, 3] is not a header either.',
  ].join('\n')

  const read = readLens(text, 'tests')
  assert.deepEqual(read.findings.map((f) => f.id), ['tests-1'])
  assert.equal(read.malformed, 3, 'the three header-shaped lines, and nothing else')
  assert.equal(looksLikeHeader('See [the contract](x.md) for the shape.'), false)
})

test('a lens file of pure prose yields nothing and reports nothing malformed', () => {
  const read = readLens('# Round 1 — suppressions\n\nThis lens is clean.\n', 'suppressions')
  assert.deepEqual(read, { findings: [], malformed: 0 })
})

// ------------------------------------------------------------ grouping

test('nearby lines converge and distant ones do not', () => {
  const at = (line) => ({ file: 'a.ts', line, endLine: line })
  const clusters = clusterByLine([at(10), at(13), at(40), at(11)], 5)
  assert.deepEqual(clusters.map((c) => c.findings.map((f) => f.line)), [[10, 11, 13], [40]])
})

test('a cluster cannot drift past the window a few lines at a time', () => {
  const at = (line) => ({ file: 'a.ts', line, endLine: line })
  const clusters = clusterByLine([at(1), at(5), at(9), at(13)], 5)
  assert.deepEqual(clusters.map((c) => c.findings.map((f) => f.line)), [[1, 5], [9, 13]])
})

test('findings with no line converge only with each other', () => {
  const groups = groupFindings([
    { file: 'a.ts', line: null, endLine: null, lens: 'x', id: 'x-1', severity: 'minor', verdict: 'CONFIRMED', summary: 's' },
    { file: 'a.ts', line: 4, endLine: 4, lens: 'y', id: 'y-1', severity: 'minor', verdict: 'CONFIRMED', summary: 's' },
  ])
  assert.deepEqual(groups.map((g) => g.anchor).sort(), ['a.ts:4', 'a.ts:—'])
})

test('three lenses on one anchor group, rank first, and keep every summary', () => {
  const dir = runDir({
    'review-round-2-spec-fidelity.md': '### [spec-fidelity-1] src/api/client.ts:142 · major · CONFIRMED · Retries swallow a 429.\n',
    'review-round-2-tests.md': '### [tests-1] src/api/client.ts:145 · blocker · CONFIRMED · No test covers the retry path.\n',
    'review-round-2-code-review.md': [
      '### [code-review-1] src/api/client.ts:143 · minor · PLAUSIBLE · The retry delay is unbounded.',
      '### [code-review-2] src/util/log.ts:8 · major · CONFIRMED · Logs the request body.',
    ].join('\n'),
    // The same anchor in an earlier round must not be pulled in.
    'review-round-1-tests.md': '### [tests-1] src/api/client.ts:142 · blocker · CONFIRMED · Round one said this too.\n',
  })

  const found = collect(dir, '2')
  assert.deepEqual(found.files.map((f) => f.lens), ['code-review', 'spec-fidelity', 'tests'])
  assert.equal(found.findings.length, 4)

  const [first, second] = found.groups
  assert.equal(first.anchor, 'src/api/client.ts:142-145')
  assert.deepEqual(first.lenses, ['tests', 'spec-fidelity', 'code-review'], 'ordered by the severity each brought')
  assert.equal(first.severity, 'blocker', 'the top severity in the group')
  assert.deepEqual(first.verdicts, ['CONFIRMED', 'PLAUSIBLE'])
  assert.equal(second.anchor, 'src/util/log.ts:8', 'a lone finding sorts below a converging one')

  const line = row(found, 'src/api/client.ts:142-145')
  assert.match(line, /3: tests, spec-fidelity, code-review/)
  assert.match(line, /Retries swallow a 429\./)
  assert.match(line, /No test covers the retry path\./)
  assert.match(line, /The retry delay is unbounded\./)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('convergence outranks severity, and severity breaks the tie', () => {
  const dir = runDir({
    'review-round-1-a.md': '[a-1] x.ts:1 · minor · CONFIRMED · Two lenses, low severity.\n[a-2] z.ts:1 · major · CONFIRMED · One lens, higher severity.\n',
    'review-round-1-b.md': '[b-1] x.ts:1 · minor · CONFIRMED · The second lens on x.\n[b-1] y.ts:1 · blocker · CONFIRMED · One lens, top severity.\n',
  })
  assert.deepEqual(collect(dir, '1').groups.map((g) => g.anchor), ['x.ts:1', 'y.ts:1', 'z.ts:1'])
  fs.rmSync(dir, { recursive: true, force: true })
})

test('a pipe in a summary cannot shift the columns', () => {
  const dir = runDir({ 'review-round-1-a.md': '[a-1] x.ts:1 · minor · CONFIRMED · Handles a | b but not c.\n' })
  const line = row(collect(dir, '1'), 'x.ts:1')
  assert.match(line, /a \\\| b/)
  assert.equal(line.split(/(?<!\\)\|/).length - 1, 7, 'six cells, so seven unescaped pipes')
  fs.rmSync(dir, { recursive: true, force: true })
})

test('the window is configurable', () => {
  const dir = runDir({
    'review-round-1-a.md': '[a-1] x.ts:10 · minor · CONFIRMED · One.\n',
    'review-round-1-b.md': '[b-1] x.ts:30 · minor · CONFIRMED · Two.\n',
  })
  assert.equal(collect(dir, '1').groups.length, 2)
  assert.equal(collect(dir, '1', { window: 25 }).groups.length, 1)
  fs.rmSync(dir, { recursive: true, force: true })
})

// ------------------------------------------------------------ prior calls

test('a deferred anchor is flagged, in the header shape or in prose', () => {
  const anchors = collectPriorAnchors(
    [
      '## Deferred by scope',
      '',
      '[codebase-fit-2] src/legacy/parser.ts:88 · major · CONFIRMED · Repeats the old smell.',
      'Not this slice. The same shape is in `src/legacy/lexer.ts:12`, which we are not touching.',
      'A sentence with no anchor in it at all.',
    ].join('\n'),
    'deferred',
  )
  assert.deepEqual(anchors, [
    { source: 'deferred', file: 'src/legacy/parser.ts', line: 88 },
    { source: 'deferred', file: 'src/legacy/lexer.ts', line: 12 },
  ])
})

test('a re-raised finding is flagged with the file that already ruled on it', () => {
  const dir = runDir({
    'review-round-3-codebase-fit.md': [
      '[codebase-fit-1] src/legacy/parser.ts:90 · major · CONFIRMED · Repeats the old smell.',
      '[codebase-fit-2] src/new/api.ts:4 · major · CONFIRMED · Untouched by any prior call.',
      '[codebase-fit-3] src/legacy/parser.ts:400 · minor · CONFIRMED · Far from the deferred anchor.',
    ].join('\n'),
    'deferred.md': '[codebase-fit-2] src/legacy/parser.ts:88 · major · CONFIRMED · Repeats the old smell.\n',
    'settled.md': 'Settled at round 1: src/new/api.ts:4 is intentional.\n',
  })

  const found = collect(dir, '3')
  const prior = Object.fromEntries(found.groups.map((g) => [g.anchor, g.prior]))
  assert.deepEqual(prior, {
    'src/legacy/parser.ts:90': ['deferred'],
    'src/new/api.ts:4': ['settled'],
    'src/legacy/parser.ts:400': [],
  })
  assert.match(render(found), /already ruled on, so drop them/)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('a missing settled.md is not an error, and its absence is only noted when both are gone', () => {
  const dir = runDir({ 'review-round-1-a.md': '[a-1] x.ts:1 · minor · CONFIRMED · One.\n' })
  const bare = collect(dir, '1')
  assert.deepEqual(bare.priorRead, [])
  assert.match(render(bare), /nothing was checked against a prior call/)

  fs.writeFileSync(path.join(dir, 'deferred.md'), '# Nothing deferred yet\n')
  const withDeferred = collect(dir, '1')
  assert.deepEqual(withDeferred.priorRead, ['deferred.md'])
  assert.doesNotMatch(render(withDeferred), /nothing was checked against a prior call/)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('priorCalls needs the same file, not just a nearby line', () => {
  const group = { file: 'a.ts', line: 10, findings: [{ line: 10 }] }
  assert.deepEqual(priorCalls(group, [{ source: 'deferred', file: 'b.ts', line: 10 }], 5), [])
  assert.deepEqual(priorCalls(group, [{ source: 'deferred', file: 'a.ts', line: 12 }], 5), ['deferred'])
})

// ------------------------------------------------------------ bad input

test('a run directory with no lens files says so rather than failing', () => {
  const dir = runDir({ 'state.json': '{}' })
  assert.deepEqual(lensFiles(dir, '1'), [])
  assert.match(render(collect(dir, '1')), /No `review-round-1-\*\.md` files found/)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('lens files that parse to nothing are named in the notes', () => {
  const dir = runDir({
    'review-round-1-a.md': '[a-1] x.ts:1 · minor · CONFIRMED · One.\n',
    'review-round-1-suppressions.md': 'Clean: the change adds no suppressions.\n',
  })
  assert.match(render(collect(dir, '1')), /No findings parsed from: suppressions\./)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('arguments parse, and the window can be given either way', () => {
  assert.deepEqual(parseArgs(['.speccy/run', '2']), { dir: '.speccy/run', round: '2', window: 5 })
  assert.deepEqual(parseArgs(['.speccy/run', '2', '--window', '9']).window, 9)
  assert.deepEqual(parseArgs(['.speccy/run', '2', '--window=9']).window, 9)
  assert.deepEqual(parseArgs([]), { dir: null, round: null, window: 5 })
})

test('a run id stands in for its directory', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'speccy-cwd-'))
  const dir = path.join(cwd, '.speccy', 'demo-20260101-0900')
  fs.mkdirSync(dir, { recursive: true })
  assert.equal(resolveRunDir(cwd, 'demo-20260101-0900'), dir)
  assert.equal(resolveRunDir(cwd, '.speccy/demo-20260101-0900'), dir)
  fs.rmSync(cwd, { recursive: true, force: true })
})

// ------------------------------------------------------------ the wrapper

test('the wrapper exits 0 and says so when node is absent', () => {
  // A PATH holding nothing but bash, so `command -v node` cannot succeed
  // wherever node happens to be installed.
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'speccy-nonode-'))
  const bash = execFileSync('command', ['-v', 'bash'], { encoding: 'utf8', shell: true }).trim()
  fs.symlinkSync(bash, path.join(bin, 'bash'))

  const out = execFileSync(bash, [path.join(SKILL_DIR, 'triage.sh'), '.', '1'], {
    encoding: 'utf8',
    cwd: os.tmpdir(),
    env: { PATH: bin },
  })
  assert.match(out, /skipped \(needs node on PATH\)/)
  fs.rmSync(bin, { recursive: true, force: true })
})

test('the wrapper exits 0 on a missing run directory and on a bad round', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'speccy-badinput-'))
  for (const args of [[], ['nowhere', '1'], ['.', 'two']]) {
    const out = execFileSync('bash', [path.join(SKILL_DIR, 'triage.sh'), ...args], {
      encoding: 'utf8',
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    assert.equal(out.trim(), '', `${args.join(' ')} writes its complaint to stderr`)
  }
  fs.rmSync(cwd, { recursive: true, force: true })
})

test('the wrapper prints the table end to end', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'speccy-e2e-'))
  const dir = path.join(cwd, '.speccy', 'demo-20260101-0900')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'review-round-1-tests.md'), '[tests-1] src/a.ts:4 · blocker · CONFIRMED · No test for the failure path.\n')
  fs.writeFileSync(path.join(dir, 'review-round-1-comments.md'), '[comments-1] src/a.ts:6 · minor · CONFIRMED · The comment restates the line.\n')

  const out = execFileSync('bash', [path.join(SKILL_DIR, 'triage.sh'), 'demo-20260101-0900', '1'], { encoding: 'utf8', cwd })
  assert.match(out, /# Review round 1: convergence/)
  assert.match(out, /\| `src\/a\.ts:4-6` \| 2: tests, comments \| blocker \|/)
  fs.rmSync(cwd, { recursive: true, force: true })
})
