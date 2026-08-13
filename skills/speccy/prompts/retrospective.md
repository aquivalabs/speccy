# Retrospective

You are writing the run's retrospective. Its value is that a later run avoids what this one paid for,
so every section is about THIS run's evidence — never generic advice that would read the same after
any project.

Write `.speccy/<run-id>/retrospective.md` with exactly these sections, in this order. A section with
nothing real to say says so in one line; it is not dropped, because an empty section is itself a
finding — "research missed nothing" is worth knowing.

## Wrong assumptions

What the spec or the plan took as true and was not. Name the assumption, what it turned out to be,
and what it cost — a rebuilt task, a wasted review round, a fixture that graded nothing.

## Research misses

What a query, a spike, or five minutes of reading would have settled before the work started, and did
not happen. Distinguish "nobody looked" from "looked and got it wrong".

## Critique value audit

Which critique findings changed the artifact and which were noise. Then the harder half: what the
implementation review caught that spec or plan critique should have caught earlier, and why it slipped
through. This is the section that improves the critique prompts.

## Plan versus reality

Where the built shape diverged from the planned one, and whether the divergence was the plan being
wrong or the world moving. Task counts, ordering, and anything the breakdown sized badly.

## Which checks caught real defects

Per check — typecheck, tests, lint, the review lenses, the project's own gate — what it actually
caught this run. A check that caught nothing across a whole run is either well-aimed at a risk that
did not fire, or theatre; say which you think it is.

## The shorter path

Knowing what is known now, the route that would have reached the same result with less. Be concrete
enough to follow: which phase to skip, which question to ask first, which agent not to spawn.

## Ready-to-apply artifacts

**Mandatory.** At least one, or an explicit statement of why none is warranted — and "nothing went
wrong" is not that statement, since a run with no friction still teaches where the friction was not.

An artifact is a concrete, applyable change, not a suggestion: a skill edit with the wording, a
`CLAUDE.md` rule as it would be written, a doc fix, a prompt correction. Draft each one to the point
where a reader can accept it and apply it without rewriting it.

The user accepts or declines **per artifact**, and accepted artifacts land on a **separate
branch/PR — never the feature branch**.

---

Two rules that override any instinct to be diplomatic:

- **Name what cost the most first**, even when it is the orchestrator's own call or the user's. A
  retrospective that opens with what went well buries the one thing worth reading.
- **Cite the artefact.** Every claim points at the file, the round, or the finding it comes from, so a
  reader can check it rather than take it. A retrospective nobody can verify is a mood, not a record.
