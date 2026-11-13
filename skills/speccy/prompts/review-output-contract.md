# Review output contract

Every lens emits findings in the one shape below, so they merge mechanically. This overrides any conflicting format wording in your prompt.

## Write guarantee

Writing your findings file is your **final action**, and you write it even if you could not finish. If you surface a serious candidate and run out of room to verify it, still write the file with that candidate marked `PLAUSIBLE`. A lens that dies mid-verification must still leave a file. The orchestrator reads the file rather than your reply, so put no findings in your return; after writing, reply only `Done — <path>`.

## Finding shape

One entry per finding. Start each with a single-line header:

`[<lens>-<n>] <file>:<line> · <severity> · <verdict> · <one-line summary>`

- **lens**: the `<lens>` tag from your findings-file name (`review-round-N-<lens>.md`), so the id is unique across lenses.
- **file:line**: the anchor, as narrow as you can make it (a single line or a tight range). If the finding isn't line-specific, name the file and use `—` for the line. Anchor precisely: matching `file:line` across lenses is how convergence surfaces.
- **severity**: the impact if left unfixed. After round 2, only a blocker or major fix earns the panel another round, so size it honestly.
  - `blocker`: unsafe to merge: broken behaviour, data loss, a security hole, a failing gate.
  - `major`: a defect a user or the next change would hit: wrong behaviour in a case the spec covers, a missing guard, or a test that cannot catch the defect it is named for (including a case the spec requires with no test at all). A structural problem that costs every later change is major too: duplicated logic, a responsibility in the wrong place, a dependency the codebase's architecture rules out.
  - `minor`: everything else, such as naming, comments, or a test that could be tighter.
- **verdict**: `CONFIRMED` (you traced it and it holds) or `PLAUSIBLE` (a genuine candidate you could not finish confirming). `PLAUSIBLE` is not licence to pad the list with hypotheticals.
- **one-line summary**: the defect in a single sentence.

Under each header, a few lines a triager needs: the mechanism (how it fails or what it costs) and the concrete fix.

## Sizing a structural fix

Propose the smallest fix. A fix that reshapes code is one of two kinds:

- A **local refactor** extracts, moves, merges or splits code, creating at most one new modest unit (a function, or a class with one job) that its callers call directly. Pulling a duplicated block into a shared function, extracting a wording class, and splitting an oversized class along a seam it already has are all local.
- A **redesign** adds indirection that other code must go through, or changes how components relate: a new interface or base type with several implementations, a pattern such as strategy, factory, registry or visitor, a shared layer adopted across features, or anything that overturns one of the plan's architecture decisions.

Review applies local refactors only. When the only fix you can see is a redesign, still report the finding, and start its fix line with `Redesign:` so triage sends it to the user. Add any per-lens detail your prompt asks for. Write those lines to the standard in `writing-style.md` (alongside this prompt): a triager and the user both read them, so state the defect and stop.

List every finding you're confident of, including the less clear-cut, but no padding. If your lens is clean, write the file and say so.
