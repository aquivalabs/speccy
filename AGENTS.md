speccy is a guided spec-to-implementation pipeline, shipped as a skill: spec → critique → plan → build → review. It runs an adversarial loop over each artifact and delegates heavy work to subagents. This file holds the conventions for anyone, human or agent, changing this repo.

## This is a public repo

Nothing here may reference a client, an employer, or another project: no names, no domains, no private details, in any file, commit message, or run artifact. When an example needs a real run, describe it by shape (a spec, a critique round), never by its repo, branch, or feature name.

## Conventions live in this file, not in an assistant's memory

A durable project convention belongs here, where every contributor and every agent reads it. Do not stash it in a per-assistant private memory: that hides it from everyone else and from the next tool. When you learn something the whole team should follow, suggest adding it to this file.

## Branches and pull requests

`main` is protected. Branch for your work and open a pull request; do not commit to `main` directly. The CI job is named `status-check`, and branch protection requires that exact name, so do not rename it.

## Versioning

The plugin version is pre-1.0, so a "minor" release bumps the third digit (0.10.3 → 0.10.4), not the second. CI requires a plugin version bump whenever the skills change, so bump `.claude-plugin/plugin.json` in the same pull request.

## Tests

Run `node --test "skills/speccy/test/*.test.mjs" "adapters/codex/test/*.test.mjs"`, `node test/smoke.mjs --harness claude`, and `node test/thin-thread.mjs --harness claude`, and keep them green; the `status-check` job runs all three.

## Verify harness facts against current docs, never memory

speccy is being made to run on more than one agent harness, and harness surfaces move. Confirm any harness fact — a flag, a tool, a model, an instruction-file behaviour — against the current official docs before you rely on it. Do not trust training data or memory for it.

## Keep the shared core vendor-neutral

speccy is being made harness-agnostic: one shared core, thin per-harness adapters. Keep vendor specifics out of the shared core (`SKILL.md`, `phases/`, `prompts/`, the templates, `state.mjs`, `workflow.js`):

- capability verbs ("spawn a subagent"), not tool names (`Agent`, `Workflow`);
- the S/M/L/XL model rungs, not model aliases (`opus`, `sonnet`);
- intent ("clear the context and re-invoke"), not user commands (`/clear`, `shift+tab`).

Concrete names live only in the adapters and the binding. A CI denylist rejects a vendor token reintroduced into the core.

## Clean up after verifying

When you create a branch, pull request, or commit only to verify something, delete it once you have your answer. Leave the repo as you found it.

## Writing

Artifacts follow the house style in `skills/speccy/prompts/writing-style.md`: lead with the point, one point per sentence, cut hedges. Apply it to prose you add here, and to anything speccy writes.
