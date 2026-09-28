// OpenAI Codex adapter defaults, mapped onto the neutral capability contract in
// CONTRACT.md. Concrete Codex mechanism and model names belong here — this is an
// adapter, not the core.
//
// Packaging is the Claude Code plugin, unchanged: Codex installs it from
// .claude-plugin/marketplace.json (`codex plugin marketplace add`, then
// `codex plugin add speccy@speccy`) and namespaces its skills `speccy:<skill>`.
//
// Codex has no native workflow runtime or watchdog, so those mechanisms are the
// polyfills this port adds: the workflow module over `codex exec`, and a monitor
// that polls the heartbeat file that module writes.

import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Absolute, so the orchestrator can run the commands below from any cwd and
// from the installed plugin's cache directory.
const CODEX = path.join(path.dirname(fileURLToPath(import.meta.url)), 'codex')
const RUN_WORKFLOW = path.join(CODEX, 'run-workflow.mjs')
const MONITOR = path.join(CODEX, 'monitor.mjs')

export default {
  version: 1,
  harness: 'codex',

  // capability -> the concrete mechanism Codex provides or the port polyfills.
  mechanisms: {
    'spawn-subagent.orchestrator-native': 'Codex native subagents',
    'spawn-subagent.workflow-module': 'the Codex workflow runtime module (one codex exec per agent() call)',
    'run-parallel': 'the Codex workflow module parallel() (concurrency-capped codex exec subprocesses)',
    'run-workflow':
      `write the workflow args as JSON to a file, then run \`node ${RUN_WORKFLOW} start --script <scriptPath> --args-file <file> --repo <repo root>\`. ` +
      'It returns at once, printing the run\'s statusPath, heartbeatPath, resultPath and logPath. ' +
      'No completion notification follows: the monitor\'s status poll is how you learn the run finished, and resultPath then holds what the workflow returned. ' +
      `To stop the run, \`node ${RUN_WORKFLOW} stop --status <statusPath>\`.`,
    'code-review':
      'run `codex review --base <base-branch> -c model_reasoning_effort="high"` in the shell and capture its output; it reports and changes nothing. ' +
      'If the shell call returns before the review finishes, keep polling that session until it exits.',
    'monitor':
      `poll \`node ${MONITOR} status <statusPath>\` (state starting|running|complete|failed|died, the current phase, the last few log lines), ` +
      `with \`node ${MONITOR} mtime <heartbeatPath>\` and \`node ${MONITOR} alive <heartbeatPath>\` as the heartbeat's two fields. ` +
      'A shell call times out after about 5 minutes, so run the poll loop in bounded chunks and re-run it until the state is no longer starting or running.',
  },

  // rung -> Codex model family, ranked from the families the Codex models page
  // (https://developers.openai.com/codex/models) describes:
  //   luna  — most efficient, focused/high-volume tasks (the S rung).
  //   sol   — complex coding and agentic workflows (the M builder rung).
  //   astra — most capable, advanced reasoning (the L and XL rungs).
  // L and XL share astra because it is Codex's top family. The families carry
  // no version, so a new release needs no edit here; modelResolution below
  // turns each into the newest slug the harness offers.
  models: {
    S: 'luna',
    M: 'sol',
    L: 'astra',
    XL: 'astra',
  },

  // The models above are families, not slugs. Codex's spawn_agent tool lists
  // the models available right now; `codex debug models` can lag it.
  modelResolution:
    'each rung names a model family, not a model. At conversation start, resolve each family to the highest-versioned model of that family ' +
    'in the list of available models your spawn tool shows you (for family luna, the newest gpt-*-luna), never from memory, and hold that ' +
    'rung→model map: spawn with those names, and pass that map as the workflow args.models. If a family has no match in the list, ask the user which model to use for that rung.',

  // The project instruction file Codex loads: always AGENTS.md. Codex has no
  // CLAUDE.md-shadowing rule; it must not inherit Claude's.
  resolveInstructionFile: () => 'AGENTS.md',

  // Where the Codex workflow runtime creates worktrees, relative to the repo
  // root. Inside .speccy/, which speccy already gitignores; the runtime also
  // adds it to .git/info/exclude for a plan-execution run outside speccy.
  worktreeRoot: '.speccy/worktrees',

  // Reads the configured effort for the preconditions' effort check. The levels
  // are those `codex debug models` listed on 2026-09-25.
  effortCheck:
    'run `grep -E \'^model_reasoning_effort\' "${CODEX_HOME:-$HOME/.codex}/config.toml" 2>/dev/null | cut -d\'"\' -f2`; ' +
    'it prints the configured reasoning effort, or nothing (an unreported effort is not a low one). xhigh, max, and ultra are above high; ' +
    'the user lowers it in the model picker or model_reasoning_effort.',

  // Resolution-time settlements (see CONTRACT.md).
  // Unverified: the codex exec children need network access, which Codex's
  // workspace-write sandbox denies by default, so starting the run may need
  // escalated permissions.
  invocation: `plan-execution's workflow runs through \`node ${RUN_WORKFLOW} start\` (see run-workflow), spawning codex exec children from a normal process context; if they fail on network access, re-run the start command outside the sandbox`,
  permissions: 'adapters/codex/permissions.mjs — codex exec runs in the workspace-write sandbox with approvals routed to automatic review; the sandbox is never bypassed',
}
