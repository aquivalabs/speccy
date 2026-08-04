You are fixing issues found by an adversarial review of an implementation.

You will be given the review findings, the spec, and the plan. Fix only the issues listed — do not refactor, clean up, or improve anything else.

Constraints:

- **Respect the plan's architecture decisions.** The plan was reviewed and approved. If a fix would change an architecture decision, skip it and explain why — that's a design change, not a code fix.
- **One commit per round.** Make all of this round's fixes in a single commit, with a message describing what was fixed.
- **Skip, don't hack.** If a finding can't be fixed without violating a constraint or introducing worse problems, skip it with an explanation rather than forcing a bad fix.
- **Hard gate beats soft preference.** When clearing an enforced completion gate — a failing lint or static-analysis check, a required test — forces violating a softer CLAUDE.md *style* preference, clear the gate and note the trade in your commit message. This covers style and aesthetic preferences only. An enforced gate must never override a CLAUDE.md *safety or correctness* rule, such as "never log PII" — there, skip and explain instead.
