// Codex permission / sandbox configuration for the workflow runtime's
// `codex exec` spawns (and any orchestrator-native Codex spawn that wants the
// same posture).
//
// This is the adapter's single source for the sandbox and approval flags. It
// couples ONLY to levers verified in codex-cli 0.154.0 — checked against the
// installed `codex exec --help` and the current Codex docs on 2026-09-24:
//
//   -s, --sandbox <read-only | workspace-write | danger-full-access>
//         Sandbox policy for model-generated shell commands.
//   --approve-for-me
//         Route approval requests through automatic review using the
//         workspace-write sandbox (no per-call human prompt).
//   --dangerously-bypass-approvals-and-sandbox
//         Skip all approvals and run without sandboxing. Intended solely for a
//         context that is already externally sandboxed.
//   --add-dir <DIR>
//         An extra directory writable alongside the primary workspace
//         (repeatable). The runtime uses it when a worktree lives outside CWD.
//   --skip-git-repo-check
//         Allow running outside a git repository.
//   --ignore-user-config
//         Do not load $CODEX_HOME/config.toml; auth still uses CODEX_HOME.
//
// -C/--cd, -o/--output-last-message, --json, -m/--model and -c/--config are
// invocation and result-channel levers the workflow runtime owns; they are not
// permission concerns and are set there, not here.
//
// HARD CONSTRAINT — normal process context. None of these flags help unless
// `codex exec` runs in a NORMAL process context: a child of the Codex session
// that runs the orchestrator, spawned with a plain child_process, never nested
// under a foreign agent's sandbox. Nested, the code-mode host cannot negotiate
// its session and every tool call fails while the process still exits 0. No
// permission flag relaxes this; it is a property of the process tree, so the
// runtime adds no outer sandbox wrapper of its own.

// The postures the adapter offers, each a fixed set of the verified flags above.
//
//   bypass         — the spike-proven unattended posture: no approvals, no
//                    sandbox. Correct only because the Codex session that
//                    spawns `codex exec` is itself the sandbox boundary. This is
//                    what the workflow runtime spawns with today.
//   workspace-write — sandboxed writes confined to the workspace (plus any
//                    --add-dir), approvals auto-reviewed rather than prompted.
//                    The posture to prefer where the host is not already an
//                    external sandbox.
//   read-only      — no writes; for inspection or a discovery probe.
export const POSTURES = {
  bypass: ['--dangerously-bypass-approvals-and-sandbox'],
  'workspace-write': ['--sandbox', 'workspace-write', '--approve-for-me'],
  'read-only': ['--sandbox', 'read-only'],
}

export const DEFAULT_POSTURE = 'bypass'

/**
 * Build the permission/sandbox flags for one `codex exec` spawn.
 *
 * @param options.posture     one of POSTURES (default DEFAULT_POSTURE).
 * @param options.addDirs     extra writable directories → one --add-dir each.
 * @param options.skipGitRepoCheck  add --skip-git-repo-check.
 * @param options.ignoreUserConfig  add --ignore-user-config.
 * @returns the flags, in a stable order, ready to splice into the exec argv.
 */
export function codexPermissionArgs(options = {}) {
  const {
    posture = DEFAULT_POSTURE,
    addDirs = [],
    skipGitRepoCheck = false,
    ignoreUserConfig = false,
  } = options

  const base = POSTURES[posture]
  if (!base) {
    throw new Error(
      `codex permissions: unknown posture "${posture}" (known: ${Object.keys(POSTURES).join(', ')})`
    )
  }

  const flags = [...base]
  for (const dir of addDirs) flags.push('--add-dir', dir)
  if (skipGitRepoCheck) flags.push('--skip-git-repo-check')
  if (ignoreUserConfig) flags.push('--ignore-user-config')
  return flags
}
