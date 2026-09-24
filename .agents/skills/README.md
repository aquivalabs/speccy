# Codex skill discovery

Codex scans `.agents/skills` from the working directory up to the repository
root and loads each subdirectory that holds a `SKILL.md` (the agentskills.io
convention). It follows symlink targets when it scans.

So this directory holds symlinks into the one shared skill tree both harnesses
read — no fork, no build step:

- `speccy` → `../../skills/speccy`
- `plan-execution` → `../../skills/plan-execution`

Claude Code discovers the same directories through `.claude-plugin/`. Both
harnesses read the same unedited `SKILL.md`; any harness difference lives in the
adapter, never in these semantic files.

## Discovery probe (2026-09-24, codex-cli 0.154.0)

`codex exec` run from the repo root listed both `speccy` and `plan-execution` in
its skills list with their descriptions quoted verbatim from the shared
`SKILL.md` — loaded unedited through these symlinks. The in-place shared-tree
path holds; the per-target build-step fallback (emit trees from the shared core)
is not needed. Fall back to it only if a future Codex build stops following
symlinked skill folders or the shared body needs harness-specific edits.
