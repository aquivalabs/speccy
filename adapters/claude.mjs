// Claude Code adapter defaults. This is the native binding: it records the tools
// speccy uses today, mapped onto the neutral capability contract in CONTRACT.md.
// Concrete tool and model names belong here — this is an adapter, not the core.
//
// Packaging is the existing layout, unchanged: the plugin manifests in
// .claude-plugin/ (plugin.json, marketplace.json) and skill discovery under
// skills/. This file points at that layout; it does not restate or modify it.

export default {
  version: 1,
  harness: 'claude',

  // capability -> the concrete mechanism Claude Code provides. spawn-subagent
  // has two bindings, so it appears as two keys (see CONTRACT.md).
  mechanisms: {
    'spawn-subagent.orchestrator-native': 'the Agent tool',
    'spawn-subagent.workflow-module': "the Workflow tool's injected agent()",
    'run-parallel': "the Workflow tool's injected parallel()",
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

  // The project instruction file Claude Code loads. Any CLAUDE.md at or above the
  // working directory shadows AGENTS.md in Claude Code's default configuration.
  instructionFile: 'CLAUDE.md',

  // Resolution-time settlements (see CONTRACT.md).
  invocation: 'the speccy skill, triggered in the Claude Code conversation',
  permissions: 'the plugin permission settings shipped in .claude-plugin/',
}
