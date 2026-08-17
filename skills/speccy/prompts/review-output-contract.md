# Review output contract

Every lens emits findings in the one shape below, so they merge mechanically. This overrides any conflicting format wording in your prompt.

## Write guarantee

Writing your findings file is your **final action**, and you write it even if you could not finish. If you surface a serious candidate and run out of room to verify it, still write the file with that candidate marked `PLAUSIBLE`. A lens that dies mid-verification must still leave a file. The orchestrator reads the file rather than your reply, so put no findings in your return; after writing, reply only `Done — <path>`.

## Finding shape

One entry per finding. Start each with a single-line header:

`[<lens>-<n>] <file>:<line> · <severity> · <verdict> · <one-line summary>`

- **lens**: the `<lens>` tag from your findings-file name (`review-round-N-<lens>.md`), so the id is unique across lenses.
- **file:line**: the anchor, as narrow as you can make it (a single line or a tight range). If the finding isn't line-specific, name the file and use `—` for the line. Anchor precisely: matching `file:line` across lenses is how convergence surfaces.
- **severity**: `blocker` | `major` | `minor`. The impact if left unfixed.
- **verdict**: `CONFIRMED` (you traced it and it holds) or `PLAUSIBLE` (a genuine candidate you could not finish confirming). `PLAUSIBLE` is not licence to pad the list with hypotheticals.
- **one-line summary**: the defect in a single sentence.

Under each header, a few lines a triager needs: the mechanism (how it fails or what it costs) and the concrete fix. Add any per-lens detail your prompt asks for. Write those lines to the standard in `writing-style.md` (alongside this prompt): a triager and the user both read them, so state the defect and stop.

List every finding you're confident of, including the less clear-cut, but no padding. If your lens is clean, write the file and say so.
