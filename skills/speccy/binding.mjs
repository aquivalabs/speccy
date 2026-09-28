// The conversation-start binding resolver. At the start of each orchestrator
// conversation speccy resolves its harness once, reads that harness's versioned
// adapter defaults, and holds the result in memory for the conversation. No
// binding file is written or read; only the adapter defaults (adapters/*.mjs)
// are files. A fresh conversation re-resolves, so a checkout driven from a second
// harness never carries a stale binding.
//
// It fails LOUD, like state.mjs: an unknown harness, a missing capability
// mechanism, an unresolved rung, or a missing/unusable instruction-file resolver
// throws, and on the CLI path prints `speccy binding: ...` and exits non-zero. A
// half-resolved binding never reaches a phase.
//
// Instruction-file resolution is per-harness: each adapter owns its harness's
// real file-loading rule (Claude's CLAUDE.md-shadows-AGENTS.md precedence,
// Codex's unconditional AGENTS.md) via a `resolveInstructionFile(cwd)` function.
// This module holds no filesystem probe of its own — it only invokes the
// resolved harness's resolver, so one harness's rule never leaks onto another's.

import { fileURLToPath } from 'node:url'
import path from 'node:path'

import claude from '../../adapters/claude.mjs'
import codex from '../../adapters/codex.mjs'

// The adapter registry. A new harness is one more entry here plus its
// adapter-defaults file under adapters/; the semantic core does not change.
const ADAPTERS = { claude, codex }

// The contract's beyond-baseline capabilities as machine-checkable keys, mirroring
// adapters/CONTRACT.md (the human-readable authority). Every adapter must name a
// mechanism for each. spawn-subagent has two bindings, so it is two keys.
export const REQUIRED_MECHANISMS = [
  'spawn-subagent.orchestrator-native',
  'spawn-subagent.workflow-module',
  'run-parallel',
  'run-workflow',
  'monitor',
]

// The fixed model ladder. Every adapter resolves all four rungs.
export const RUNGS = ['S', 'M', 'L', 'XL']

// Thrown by resolveBinding when an adapter is incomplete or the harness is
// unknown. main() turns it into a `speccy binding:` line and a non-zero exit.
export class BindingError extends Error {}

function fail(message) {
  throw new BindingError(message)
}

/**
 * Resolve a harness identity to a complete, frozen binding held in memory.
 *
 * @param harness   the harness identity, e.g. "claude" or "codex".
 * @param defaults  the adapter defaults; defaults to the registered adapter for
 *                  `harness`. Pass one to resolve an adapter not in the registry.
 * @param cwd       the working directory to resolve the instruction file
 *                  against; defaults to the process's own cwd.
 */
export function resolveBinding(harness, defaults = ADAPTERS[harness], cwd = process.cwd()) {
  if (typeof harness !== 'string' || harness === '') {
    fail('resolve needs a harness identity (e.g. "claude" or "codex")')
  }
  if (!defaults) {
    fail(`unknown harness "${harness}" (known: ${Object.keys(ADAPTERS).join(', ')})`)
  }

  const mechanisms = defaults.mechanisms ?? {}
  const missing = REQUIRED_MECHANISMS.filter((key) => !mechanisms[key])
  if (missing.length) {
    fail(`harness "${harness}" is missing a mechanism for: ${missing.join(', ')}`)
  }

  const models = defaults.models ?? {}
  const unresolved = RUNGS.filter((rung) => !models[rung])
  if (unresolved.length) {
    fail(`harness "${harness}" leaves rung(s) unresolved: ${unresolved.join(', ')}`)
  }

  if (typeof defaults.resolveInstructionFile !== 'function') {
    fail(`harness "${harness}" names no instruction-file resolver`)
  }
  const instructionFile = defaults.resolveInstructionFile(cwd)
  if (!instructionFile) {
    fail(`harness "${harness}" resolved no instruction file for cwd "${cwd}"`)
  }

  return Object.freeze({
    harness,
    version: defaults.version,
    mechanisms: Object.freeze({ ...mechanisms }),
    models: Object.freeze({ ...models }),
    instructionFile,
    invocation: defaults.invocation ?? null,
    modelResolution: defaults.modelResolution ?? null,
    effortCheck: defaults.effortCheck ?? null,
    worktreeRoot: defaults.worktreeRoot ?? null,
    permissions: defaults.permissions ?? null,
  })
}

// ---------------------------------------------------------------- entry point

export function main(argv = process.argv.slice(2)) {
  const flag = argv.indexOf('--harness')
  const harness = flag >= 0 ? argv[flag + 1] : argv[0]
  try {
    const binding = resolveBinding(harness)
    process.stdout.write(JSON.stringify(binding, null, 2) + '\n')
    return 0
  } catch (err) {
    if (err instanceof BindingError) {
      process.stderr.write(`speccy binding: ${err.message}\n`)
      return 1
    }
    throw err
  }
}

// fileURLToPath rather than the URL's pathname, which on Windows yields a
// leading-slash path that resolves to the wrong thing.
const thisFile = fileURLToPath(import.meta.url)
if (process.argv[1] && path.resolve(process.argv[1]) === thisFile) process.exit(main())
