// Codex sandbox and approval flags for the workflow runtime's `codex exec`
// spawns, checked against `codex exec --help` (codex-cli 0.154.0) and the
// current Codex docs on 2026-09-24:
//
//   --sandbox workspace-write  writes confined to the workspace (plus --add-dir)
//   --approve-for-me           route approval requests through automatic review
//                              rather than a human prompt
//   --add-dir <DIR>            an extra writable directory (repeatable)
//
// There is deliberately no way to pass --dangerously-bypass-approvals-and-sandbox.
// Build agents run unattended and in parallel, so nothing may switch their
// sandbox off. An agent that keeps getting blocked shows up in the build's
// friction logs and retrospective instead.
//
// None of these flags help unless `codex exec` runs in a normal process context
// (a plain child of the Codex session, never nested under a foreign agent's
// sandbox); nested, every tool call fails while the process still exits 0.

export function codexPermissionArgs(addDirs = []) {
  return ['--sandbox', 'workspace-write', '--approve-for-me', ...addDirs.flatMap((dir) => ['--add-dir', dir])]
}
