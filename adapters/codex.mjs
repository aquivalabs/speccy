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
    'monitor':
      `poll \`node ${MONITOR} status <statusPath>\` (state starting|running|complete|failed|died, the current phase, the last few log lines), ` +
      `with \`node ${MONITOR} mtime <heartbeatPath>\` and \`node ${MONITOR} alive <heartbeatPath>\` as the heartbeat's two fields. ` +
      'A shell call times out after about 5 minutes, so run the poll loop in bounded chunks and re-run it until the state is no longer starting or running.',
  },

  // rung -> concrete model, as `codex exec -m <model>` slugs.
  //
  // WEB-VERIFIED against https://developers.openai.com/codex/models on
  // 2026-09-24. THIS MAP IS THE MOST LIKELY THING IN THIS FILE TO ROT: Codex's
  // model line moves often, so re-verify against that page before relying on it.
  //
  // Codex exposes three CLI models today, so the four rungs collapse to three:
  //   gpt-6-luna  — most efficient, focused/high-volume tasks (the S rung).
  //   gpt-6-sol   — complex coding and agentic workflows (the M builder rung).
  //   gpt-6-astra — most capable, advanced reasoning (the L and XL rungs).
  // L and XL share gpt-6-astra because it is Codex's top model; reasoning effort
  // (`-c model_reasoning_effort=...`) is the finer lever if the rungs ever need
  // separating. The map values stay plain model slugs to match the Claude
  // adapter's shape.
  models: {
    S: 'gpt-6-luna',
    M: 'gpt-6-sol',
    L: 'gpt-6-astra',
    XL: 'gpt-6-astra',
  },

  // The project instruction file Codex loads: always AGENTS.md. Codex has no
  // CLAUDE.md-shadowing rule; it must not inherit Claude's.
  resolveInstructionFile: () => 'AGENTS.md',

  // Resolution-time settlements (see CONTRACT.md).
  // Unverified: the codex exec children need network access, which Codex's
  // workspace-write sandbox denies by default, so starting the run may need
  // escalated permissions.
  invocation: `plan-execution's workflow runs through \`node ${RUN_WORKFLOW} start\` (see run-workflow), spawning codex exec children from a normal process context; if they fail on network access, re-run the start command outside the sandbox`,
  permissions: 'adapters/codex/permissions.mjs — codex exec runs in the workspace-write sandbox with approvals routed to automatic review; the sandbox is never bypassed',
}
