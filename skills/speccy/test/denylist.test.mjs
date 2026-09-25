// Neutrality denylist for the shared semantic core.
//
// speccy runs on more than one agent harness. The shared core must name no
// harness-specific tool, user command, invocation syntax, or model alias;
// concrete names live only in the adapters and the binding. This test greps the
// core files below and fails on any banned vendor token, comments included, so a
// reintroduced token fails CI. Run with: node --test skills/speccy/test/
//
// It matches PRECISE tokens, never bare capitalised nouns: `Workflow tool` and
// `Agent tool` (never the bare word `workflow`/`agent`, nor a "Plan Execution
// Workflow" header), `Monitor`, `TaskStop`, `SendMessage`, `PushNotification`,
// the model aliases opus/sonnet/haiku/fable, the `codex exec` invocation, user
// commands (`/clear`, `/effort`, shift+tab), baseline tool names (`Read tool`),
// vendor environment variables, and the capitalised vendor names. It does not
// ban CLAUDE.md/AGENTS.md: one legitimate use names both (doc discovery in
// review-local-docs.md). Nor does it ban the lowercase `claude`/`codex`
// identifiers, which the binding step names once as example harness ids.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

const REPO = path.resolve(import.meta.dirname, '..', '..', '..')
const SPECCY = path.join(REPO, 'skills', 'speccy')
const PLAN_EXEC = path.join(REPO, 'skills', 'plan-execution')

function mdFiles(dir) {
  return readdirSync(dir)
    .filter((name) => name.endsWith('.md'))
    .map((name) => path.join(dir, name))
}

// The shared semantic core the denylist guards. Globs are read at runtime so a
// new phase or prompt is covered automatically.
function coveredFiles() {
  return [
    path.join(SPECCY, 'SKILL.md'),
    path.join(PLAN_EXEC, 'SKILL.md'),
    ...mdFiles(path.join(SPECCY, 'phases')),
    ...mdFiles(path.join(SPECCY, 'prompts')),
    path.join(PLAN_EXEC, 'prompts.md'), // not under the prompts/*.md glob
    path.join(SPECCY, 'state.mjs'),
    path.join(PLAN_EXEC, 'workflow.js'),
    path.join(PLAN_EXEC, 'workflow-simple.js'),
  ]
}

// Each pattern matches a whole-word or tool-suffixed token, never a bare noun.
const BANNED = [
  // `Workflow tool` / `Agent tool` (backtick between the two is allowed), never
  // the bare capitalised word, so "Plan Execution Workflow" and "run the
  // workflow" pass.
  { name: 'tool name (Workflow/Agent tool)', re: /\b(?:Workflow|Agent)`?\s+tool\b/g },
  { name: 'Monitor tool', re: /\bMonitor\b/g },
  { name: 'orchestration tool token', re: /\b(?:TaskStop|SendMessage|PushNotification)\b/g },
  // Model aliases, either case, anywhere — a literal, a comment, bare prose.
  // Concrete model names live only in the adapters and the binding; the core
  // names rungs, and resolves a rung to a model through the binding at runtime.
  { name: 'model alias', re: /\b(?:opus|sonnet|haiku|fable)\b/gi },
  { name: 'codex exec invocation', re: /\bcodex\s+exec\b/gi },
  // A slash command, but not a path segment like prompts/review-tests.md.
  { name: 'user command', re: /(?<=^|[\s`(])\/(?:clear|effort|compact|model|review)\b/g },
  { name: 'user command (shift+tab)', re: /\bshift\s*\+\s*tab\b/gi },
  { name: 'baseline tool name', re: /\b(?:Read|Write|Edit|Glob|Grep|Bash)\s+tool\b/g },
  { name: 'vendor environment variable', re: /\b(?:CLAUDE|CODEX)_[A-Z_]+\b/g },
  { name: 'vendor name', re: /\b(?:Claude|Codex|Anthropic|OpenAI)\b/g },
]

function scan(file) {
  const text = readFileSync(file, 'utf8')
  const hits = []
  text.split('\n').forEach((line, i) => {
    for (const { name, re } of BANNED) {
      re.lastIndex = 0
      let m
      while ((m = re.exec(line))) hits.push(`${path.relative(REPO, file)}:${i + 1}: ${name} "${m[0]}"`)
    }
  })
  return hits
}

test('the shared core carries no banned vendor token', () => {
  const hits = coveredFiles().flatMap(scan)
  assert.deepEqual(hits, [], `vendor tokens leaked into the core:\n${hits.join('\n')}`)
})

// The patterns are the guarantee, so prove they still bite and still spare the
// legitimate forms. A regex that matched nothing would pass the grep silently.
test('the patterns catch real tokens and spare the legitimate forms', () => {
  const caught = (s) => BANNED.some(({ re }) => { re.lastIndex = 0; return re.test(s) })

  for (const leak of [
    'backed by Claude\'s `Agent` tool',
    'arm the Workflow tool',
    'the Monitor watchdog reads agent-*.jsonl',
    'call TaskStop to halt',
    'notify via SendMessage',
    'a PushNotification fires',
    'model: "opus"',
    'always use Opus regardless of the execution model',
    'the **L rung** (Opus on Claude) every round',
    'run one codex exec per agent() call',
    'the user can `/clear` and re-invoke',
    'drop to high in /effort',
    'enable auto-accept mode (shift+tab)',
    'read it with the Read tool',
    'do not rely on the Glob tool',
    'echo "${CLAUDE_EFFORT}"',
    'the SKILL.md instructs Claude to read this file',
    'on Codex the monitor polls',
  ]) assert.ok(caught(leak), `should flag: ${leak}`)

  for (const ok of [
    'the Plan Execution Workflow',
    'run the workflow',
    'spawn a subagent',
    'the adversary runs on the L rung, the builder on the M rung, the top rung is XL',
    'arm the monitor and poll',
    'the instruction file (CLAUDE.md / AGENTS.md)',
    'pass `prompts/review-tests.md` with the spec path',
    'writes `.speccy/<run-id>/review-round-N-<lens>.md`',
    'clear the context and re-invoke',
    'a short identifier such as `claude` or `codex`',
  ]) assert.ok(!caught(ok), `should spare: ${ok}`)
})
