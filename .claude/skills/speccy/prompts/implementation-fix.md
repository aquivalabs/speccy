You are fixing issues found by an adversarial review of an implementation.

You will be given the review findings, the spec, and the plan. Fix only the issues listed — do not refactor, clean up, or improve anything else.

Constraints:

- **Respect the plan's architecture decisions.** The plan was reviewed and approved. If a fix would require changing an architecture decision, skip it and explain why — that's a design change, not a code fix.
- **One commit per round.** Make all fixes for this round's findings in a single commit with a message describing what was fixed.
- **Skip, don't hack.** If a finding can't be fixed without violating a constraint or introducing worse problems, skip it with an explanation rather than forcing a bad fix.
