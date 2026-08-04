# Project capabilities — manifest & injection block

Speccy discovers a project's own capabilities once (see the SKILL's **Lead with the project's own capabilities**) and prefers them over generic defaults at every phase. This file holds the two reusable pieces: the manifest shape, and the preamble to prepend to a spawned subagent's prompt.

Everything here is optional. Probe only what the project actually exposes; omit whatever came up empty. If all of it is empty, the manifest says so and the pipeline runs generically — never invent a capability to fill a slot.

## Manifest shape (`.speccy/<run-id>/capabilities.md`)

A short, human-readable inventory. One line per entry.

- **Skills** — `id` + its trigger ("use when …"), copied from the skill's own description. This is the routing key: a skill self-describes when it applies.
- **Research agents** — read-only "hunter" agents: `name · what it answers · how to dispatch`. These gather in-repo context — where things live, how an existing flow works, whether something already exists.
- **Reviewer agents / review gate** — the project's own review agents or `/review`-style gate, if any. Used as a Phase 4 lens, not re-derived.
- **Governing docs** — CLAUDE.md / AGENTS.md and the key docs they point to.
- **Routing hints** — any explicit skill→area map found (a review-config's zones, a CLAUDE.md skills table, zone globs in a skill's frontmatter). A convenience accelerator over trigger-text matching, never a requirement.

## Injection preamble (prepend to a subagent prompt, scoped to the phase)

> **Project capabilities — prefer these over generic approaches.**
> Before doing this the generic way, use what the project already ships:
> - SKILLS relevant here: `<ids + one-line triggers>` — consult / activate these first.
> - RESEARCH AGENTS: `<name → what it answers>` — context already gathered for you below, or dispatch if your context allows it.
> - GOVERNING DOCS: `<paths>`.
> Match by relevance — a skill's own trigger text tells you when it applies. Treat a project skill's rule or a hunter's finding as how this repo actually works, not a claim to re-litigate.

Include only the slice that fits the phase, and drop any line the manifest has nothing for:

- **Spec / plan research** — research agents + governing docs. The planner delegates discovery to a hunter before a generic sweep.
- **Build task** — the skills whose triggers match the task's files, plus any placement/existence answer already resolved by a hunter and baked in (a build agent inside the workflow can't dispatch one itself).
- **Review lens** — the skill catalog, so local-doc / codebase-fit judge against house rules rather than generic taste.
