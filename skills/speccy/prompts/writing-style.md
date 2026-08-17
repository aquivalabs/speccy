# Writing style for speccy artifacts

Every file speccy writes is for a person: the reviewer now, whoever picks the work up later. Agents read them too, and read them better when a person can.

## Lead with the point

- Most important first, at every scale: document, section, paragraph.
- Open the file with a few sentences saying what it is, what it produces, and what the reader has to decide.
- Open each section with its point, then support it.

## One point per sentence

- A sentence needing three clauses wants a list or a subsection instead.
- No asides and no parenthetical rebuttals.
- Cut hedges. State uncertainty once, plainly, in the section that exists for it (Assumptions, Risks, Open questions), never as a qualifier on every sentence.

## Define before use

- Define a term, abbreviation, or code identifier at first use, or don't use it.
- A citation is evidence for a claim, never a substitute for it. State the fact in words, then cite the file, ADR, or issue as proof. The sentence has to stand on its own for a reader who never opens the reference.

## Describe the thing, not the discussion of it

- State the current position. How it was reached, what an earlier draft said, and what a review changed belong in the decision log, not here.
- Don't describe the file's own organisation.
- Argument lives in one section (Decisions & rationale, Architecture decisions), and in the lead, which carries the one or two decisions that shape everything else. Everywhere else, describe. The file's shape says where the argument is, so no cross-reference is needed.
- Don't pre-defend. A critic will read this and so will a colleague, and writing for the critic is what makes a file unreadable.

## Emphasis and lists

- Bold marks the rare thing that must not be missed. Bold on every bullet marks nothing.
- Bullets for parallel items, prose for reasoning. Number a list only where order is the point: steps that must run in sequence, or items referenced by position.

## Before you finish

Re-read and cut. If a paragraph could be a sentence, make it one. Adding a qualifier is the cheapest way to answer a critic and the most expensive for every later reader.

Project conventions (`CLAUDE.md`, a configured output style) layer on top of this file. They add to it; they don't license ignoring it.
