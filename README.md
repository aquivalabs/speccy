# Speccy — a guided spec-to-implementation pipeline

![Speccy banner — a ZX Spectrum rainbow flash beside the SPECCY wordmark, with the tagline "Think before you build... Then keep thinking" and the pipeline "spec → critique → plan → build → review"](speccy_logo.png)

*Audience: technical staff at Aquiva. A tour of the local `speccy` skill — what it does, how it's structured, and why.*

**Speccy** is a local Claude Code skill that takes a feature from a rough idea through to reviewed code, forcing a specification before humans or agents write code.

The name is a nod to the Sinclair ZX Spectrum and a pun on "spec".

Speccy is an engineering tool. It keeps you close to the code and the system. You make decisions, the AI does the boring bits.

The artefacts it produces — specs, ADRs, and code — are all included in PRs, so a team can review them like any other change. It focuses your attention onto the decisions that matter: you settle the architecture, take open questions back to the customer for answers, and bring your domain and system knowledge to bear. Then you step out of the loop and let the AI build. Speccy leans towards quality by construction — getting your input, running the project's verification tools, and putting independent review agents on every artefact.

Speccy stops at a reviewable PR. It isn't a merge gate and doesn't run end-to-end verification — that's deliberate. Reviewing the output is *your* job, through every tool you'd use for any change: the diff, the artefacts, CI, E2E, running it yourself. Speccy makes sure your review time is well spent by constructing good output, but it hands off to you for the final decision. 

## The six phases

The pipeline runs as: **specification → spec critique → planning → plan critique → implementation → implementation review.**

Speccy guides you through these phases; there is no list of commands to remember. And because it's just a skill running in an ordinary Claude Code session, you can redirect it at any point — got the spec nailed but you're heading out for a run? Tell it to auto-approve the plan and go straight to building.

| Phase | Who drives | What happens |
|-------|-----------|--------------|
| **1. Spec** | Interactive | Claude interviews you to build a structured spec from a template. You review and edit until satisfied. |
| **1a. Spec critique** | User-in-the-loop | An independent adversary subagent critiques the spec each round. *You* decide which findings to incorporate. |
| **2. Plan** | Autonomous | A subagent researches the codebase and drafts a plan (the *how* to the spec's *what*), running feasibility spikes to prove any risky mechanism before planning around it. |
| **2a. Plan critique** | Autonomous | Adversary critiques, a revise agent applies every finding, looping until clean. |
| **2b. Plan review** | User decides | You review the hardened plan, raise concerns, approve. |
| **3. Implementation** | Autonomous | Delegates to the `plan-execution` skill, which breaks the plan into tasks and builds. |
| **3a. Implementation review** | User observes | Adversary checks code against the spec; a fix agent applies corrections directly. |
| **Wrap-up** | User reviews | Summary, an ADR distilled from critique decisions, deferred-feedback list, retrospective. The branch is handed back for your review — Speccy doesn't merge or certify it. |

## Core design ideas

- **Heavy work runs in subagents.** Critiques, codebase research, building, and review all run in subagents, so the main conversation sees only short summaries. The spec interview is the exception: it's interactive and builds up real context, which is why Speccy suggests a `/clear` once the spec is settled (see resumability below).

- **Adversarial critique at every artefact boundary.** Specs, plans, and the final diff each get an independent reviewer whose job is narrow: read one artefact, find specific problems. Each loop **exits early** when a round surfaces nothing valuable, so it runs only as long as each round keeps earning its place — most runs settle in a single round. Spec and plan critique cap at 3 rounds; implementation review at 4.

- **Models are tuned per phase.** Spec and plan critique run **Opus on every round** — both the adversary and the revise agent that applies findings. These artefacts are short and high-leverage, and on knowledge-heavy domains like Salesforce the durable findings cluster in the Opus passes, while cheaper tiers mostly add false-positive triage and revision churn; so the whole loop runs on Opus rather than escalating. Implementation review is the exception: it climbs a `haiku → sonnet → opus → opus` ladder over its 4 rounds, because the diff is large and many findings are mechanical, so cheap-first pays off. That doubled Opus is deliberate — round 4 is a *fresh-context* Opus re-reviewing the code after round 3's fixes, a genuine independent pass that reliably catches what the first Opus missed. The **builder** defaults to Sonnet; the plan-execution breakdown agent always uses Opus because decomposition is the hardest-thinking step. All overridable per run.

- **Prove load-bearing mechanisms, don't assert them.** Planning doesn't just research the codebase — before committing the plan to any risky mechanism not already demonstrated there (a platform behaviour, a timing assumption, an API edge), a feasibility spike performs the *riskiest action itself* against the real environment. An empirical probe of the facts *around* a mechanism reads like proof but isn't; the spike exercises the actual action, so an infeasibility surfaces at planning rather than collapsing the build. Spike code is throwaway.

- **Where the human sits differs by phase.** Specs encode *intent*, so spec critique keeps you in the loop deciding what to accept. Plans and code are downstream of an approved spec, so their critique loops run autonomously — findings there are mechanical.

- **File state makes the run resumable and resettable.** Every phase boundary writes `.speccy/<run-id>/state.json`, with critique rounds, plans, and review notes saved alongside. Because everything that matters lives on disk, you can `/clear` a bloated window at any point and re-invoke to pick up where you left off with fresh context — Speccy nudges you to do exactly this once the spec is settled, before the subagent-driven planning and build.

## Preconditions it enforces

- **Verification tools must be documented in CLAUDE.md** (build, lint, static analysis, test) — and Speccy *smoke-tests them on the clean tree first*, since a broken setup discovered at implementation has already cost a spec, several critique rounds, and a plan.
- **Worktree init** section in CLAUDE.md — only exercised if the plan fans out into parallel tasks.
- **Clean git tree** and an identified base branch (confirmed with you if not on main).

## Cost and scale

Speccy is built for the multi-hour build that would blow out a single context window. The resumability and thin-orchestrator design keep the main context small enough to go the distance, and the per-phase model choices keep the bill down — cheap tiers carry the large implementation diff, while Opus is reserved for the short, high-leverage spec and plan critiques where it earns its keep.
