# Tool use

**Edit with the file-editing tool, one purpose per command.** Change files with the file-editing tool, never with a script (a heredoc, `sed -i`, a one-off program), and give each shell command one purpose rather than chaining edits, formatters and tests into one line. The harness may hold a script edit or a chained command for approval, and a subagent's approval prompt can sit where nobody sees it.

**Gather in parallel.** Whenever you need more than one piece of information and none of them depends on the result of another, issue every one of those tool calls in a single message rather than one per turn. Reading five files, grepping for three patterns, or diffing four paths is one turn, not five. Serialise only when a lookup genuinely needs the output of a previous one to be formed at all. This applies throughout your work, not just at the start.

The reason is the shape of the bill rather than the clock. Your whole context is re-read on every turn, so a turn costs roughly what you are carrying at the time. Ten lookups spread over ten turns pay that ten times; the same ten in three turns pay it three times, for the same material and the same conclusions. Nothing here asks you to look at less, and looking at less to save turns would be a bad trade.
