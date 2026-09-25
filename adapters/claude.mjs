// Claude Code adapter defaults. This is the native binding: it records the tools
// speccy uses today, mapped onto the neutral capability contract in CONTRACT.md.
// Concrete tool and model names belong here — this is an adapter, not the core.
//
// Packaging is the existing layout, unchanged: the plugin manifests in
// .claude-plugin/ (plugin.json, marketplace.json) and skill discovery under
// skills/. This file points at that layout; it does not restate or modify it.

import fs from 'node:fs'
import path from 'node:path'

// Claude Code's own memory-file precedence: a CLAUDE.md (or CLAUDE.local.md, or
// .claude/CLAUDE.md) at or above the working directory shadows AGENTS.md; with
// none present, Claude Code falls back to AGENTS.md. This is Claude's rule alone
// — other adapters must not apply it to their own instruction-file resolution.
function hasClaudeMemoryAt(dir) {
  return (
    fs.existsSync(path.join(dir, 'CLAUDE.md')) ||
    fs.existsSync(path.join(dir, 'CLAUDE.local.md')) ||
    fs.existsSync(path.join(dir, '.claude', 'CLAUDE.md'))
  )
}

// The walk stops at the enclosing git repo's root (found by the nearest `.git`),
// never past it. Project memory is project-scoped; without this bound, walking
// to the filesystem root also walks through the user's home directory, where
// ~/.claude/CLAUDE.md is the *user's* global memory, always loaded regardless
// of any given project's own AGENTS.md/CLAUDE.md — it must not shadow a
// project's instruction file here. A cwd outside any git repo gets no bound and
// checks only itself, the conservative default.
function repoRootAbove(dir) {
  let d = dir
  for (;;) {
    if (fs.existsSync(path.join(d, '.git'))) return d
    const parent = path.dirname(d)
    if (parent === d) return null
    d = parent
  }
}

function resolveInstructionFile(cwd) {
  const start = path.resolve(cwd)
  const bound = repoRootAbove(start) ?? start
  let dir = start
  for (;;) {
    if (hasClaudeMemoryAt(dir)) return 'CLAUDE.md'
    if (dir === bound) break
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return 'AGENTS.md'
}

export default {
  version: 1,
  harness: 'claude',

  // capability -> the concrete mechanism Claude Code provides. spawn-subagent
  // has two bindings, so it appears as two keys (see CONTRACT.md).
  mechanisms: {
    'spawn-subagent.orchestrator-native': 'the Agent tool',
    'spawn-subagent.workflow-module': "the Workflow tool's injected agent()",
    'run-parallel': "the Workflow tool's injected parallel()",
    'run-workflow': 'the Workflow tool, given the scriptPath and args; it runs in the background and notifies on completion',
    'monitor': 'the Monitor tool, with TaskStop, SendMessage and PushNotification for the watchdog',
  },

  // rung -> concrete model. Fixed by the spec's Decisions & rationale. These are
  // the lowercase aliases the Agent and Workflow tools accept as their `model`
  // option (what workflow.js passes as args.models.L). S climbs to XL.
  models: {
    S: 'haiku',
    M: 'sonnet',
    L: 'opus',
    XL: 'fable',
  },

  // Resolves the project instruction file Claude Code actually loads for a given
  // working directory: CLAUDE.md where one shadows AGENTS.md, else AGENTS.md.
  resolveInstructionFile,

  // Resolution-time settlements (see CONTRACT.md).
  invocation: 'the speccy skill, triggered in the Claude Code conversation',
  permissions: 'the plugin permission settings shipped in .claude-plugin/',
}
