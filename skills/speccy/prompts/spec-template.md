# Specification: [FEATURE NAME]

**Status**: Draft

<!-- Follow `writing-style.md`. The sections run description first, argument second, caveats last;
     keep them that way. Rationale belongs in Decisions & rationale rather than spread through the
     rest. Don't restate `CLAUDE.md` anywhere in this file. Reference it by file/section where a
     constraint turns on it, and spell a rule out only where this feature diverges from it. -->

## Goal

<!-- This is the file's lead. One paragraph: the problem this solves and what the spec produces.
     Then **at most two** load-bearing decisions, one sentence each: what was chosen and why. Two is
     a hard limit rather than a target; a third belongs in Decisions & rationale like the rest.
     Those two also appear in full in Decisions & rationale. That repetition is deliberate, so the
     reader meets the choices that shape everything before reading any of it.
     A reader who stops here should know what is being built, and what is at stake. -->

## Deliverables

<!-- What exists when this spec is done. Name the artifacts, behaviours, or capabilities the
     implementation produces.
     Describe; don't justify. Every argument the spec makes lives in Decisions & rationale.
     Avoid code examples unless this spec defines an API contract or a specific refactor target. -->

## Scope boundaries

<!-- What this spec deliberately does not cover. Prevents gold-plating and scope creep. -->

## Constraints

<!-- Technical, organisational, or business constraints specific to THIS feature: performance budgets,
     security considerations, platform-specific rules, compatibility requirements. Do NOT restate
     project-wide standards already in CLAUDE.md (logging, comments, naming conventions, testing
     policy, code style); the builder reads CLAUDE.md anyway. Reference a rule by file/section only
     when this feature's constraints turn on it, and spell one out only where this feature
     deliberately diverges from it. -->

## Completion criteria

<!-- Observable conditions that mean the work is done: verifiable by running something, reading
     something, or checking something concrete. These are the specific checks, so don't restate the
     deliverables.
     One line each, and no caveats. A criterion that needs a caveat isn't checkable: put the
     qualification in Constraints, or the doubt in Open questions, and leave the check here. -->

- [ ] {criterion}

## Decisions & rationale

<!-- The load-bearing choices that shaped this spec, and why each beat the alternative. This is the
     one section that argues. One entry per meaningful decision:
     - **Decision**: what was chosen (a scope call, an approach, a contract/deliverable shape).
     - **Alternatives**: the viable option(s) considered and rejected.
     - **Why**: the deciding factor that made the chosen option win.
     - **Origin**: **User** (a preference, mandate, or judgement the user brought) or **Speccy,
       user-agreed** (a default the pipeline proposed and the user signed off). A third origin,
       *Speccy, alone*, arises in the plan and review phases rather than here. The wrap-up reads
       this tag.

     Record a decision only where a real alternative existed; a forced move is not a decision. An
     assumption is a guess made under ambiguity; a decision is a deliberate pick among options.
     Keep it spec-level, the WHAT and its shape; code-level HOW belongs to the plan.
     Where the input already settles a choice (a stated preference, a mandate, an existing
     convention), record it, and let "the input specified it" be the whole Why.
     State the decision as it now stands. A choice this spec reached and then reversed is history
     for the decision log; keep it out of this section. -->

## Assumptions

<!-- Reasonable defaults chosen where the feature description was ambiguous. Document them so they
     can be challenged during critique. -->

## Open questions

<!-- Items deferred to the planning phase, with the codebase research needed to resolve each. Include
     any *feasibility assumption*: a requirement (often hiding in Constraints or Completion criteria)
     that takes some platform, API, timing, or ordering capability for granted without confirming it
     (e.g. "corrected synchronously in the same transaction"). Mark each for a feasibility spike in
     planning, so the plan proves the mechanism before the build discovers it cannot. -->
