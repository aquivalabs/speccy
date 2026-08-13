# Review output contract

Every lens emits findings in the one shape below, so they merge mechanically. This overrides any conflicting format wording in your prompt.

## Write guarantee

Writing your findings file is your **final action**, and you write it even if you could not finish. If you surface a serious candidate and run out of room to verify it, still write the file with that candidate marked `PLAUSIBLE`. A lens that dies mid-verification must leave a file, never nothing. The orchestrator reads the file, not your reply — put no findings in your return. After writing, reply only `Done — <path>`.

## Finding shape

One entry per finding. Start each with a single-line header:

`[<lens>-<n>] <file>:<line> · <level> · <severity> · <verdict> · <one-line summary>`

- **lens** — the `<lens>` tag from your findings-file name (`review-round-N-<lens>.md`), so the id is unique across lenses.
- **file:line** — the anchor, as narrow as you can make it: a single line or a tight range. If the finding isn't line-specific, name the file and use `—` for the line. Anchor precisely — matching `file:line` across lenses is how convergence surfaces.
- **level** — what kind of change the fix needs. Exactly one of:
  - `code` — a defect fixed in the fix round, as today.
  - `design` — an architectural divergence. It batches into the decision queue.
  - `requirements` — a scope or spec change. It batches into the decision queue.
- **severity** — `blocker` | `major` | `minor`: the impact if left unfixed.
- **verdict** — `CONFIRMED` (you traced it and it holds) or `PLAUSIBLE` (a genuine candidate you could not finish confirming). `PLAUSIBLE` is not licence to pad the list with hypotheticals.
- **one-line summary** — the defect in a single sentence.

Under each header, the few lines a triager needs: the mechanism — how it fails or what it costs — and the concrete fix. Add any per-lens detail your prompt asks for.

List every finding you're confident of, not just the clearest, but no padding. If your lens is clean, write the file and say so.

## Level routing

The level decides where a finding goes after review.

- `code` findings run the fix loop, as today.
- `design` and `requirements` findings are not fixed mid-round. They batch into a decision queue that a single post-review gate clears.

Pick the level by what the remedy would change: the code → `code`; the plan or architecture → `design`; the spec or scope → `requirements`. Suppressions-lens findings are always `code`.

The level is provisional. Each lens sets it from its own local view. Triage may re-level a finding at merge when cross-lens context changes the call. The lens value stands unless triage overrides it. Lens proposes, triage disposes.

Name secrets, never quote their values — in every finding, the same rule the spec and plan carry.
