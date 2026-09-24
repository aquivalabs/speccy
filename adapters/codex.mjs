// OpenAI Codex adapter defaults, mapped onto the neutral capability contract in
// CONTRACT.md. Concrete Codex mechanism and model names belong here — this is an
// adapter, not the core.
//
// Codex has no native workflow runtime or watchdog, so those mechanisms are the
// polyfills this port adds: the workflow module over `codex exec`, and a monitor
// that polls the heartbeat file that module writes.

export default {
  version: 1,
  harness: 'codex',

  // capability -> the concrete mechanism Codex provides or the port polyfills.
  mechanisms: {
    'spawn-subagent.orchestrator-native': 'Codex native subagents',
    'spawn-subagent.workflow-module': 'the Codex workflow runtime module (one codex exec per agent() call)',
    'run-parallel': 'the Codex workflow module parallel() (concurrency-capped codex exec subprocesses)',
    'monitor': 'the heartbeat-file poll loop (monitor polyfill over the module\'s liveness signal)',
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

  // The project instruction file Codex loads.
  instructionFile: 'AGENTS.md',

  // Resolution-time settlements (see CONTRACT.md).
  invocation: 'codex exec, from a normal process context (a child of the Codex session)',
  permissions: 'the codex exec sandbox and approval flags (e.g. --approve-for-me, sandbox config)',
}
