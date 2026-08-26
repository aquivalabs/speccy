# Tool use

**Gather in parallel.** Whenever you need more than one piece of information and none of them depends on the result of another, issue every one of those tool calls in a single message rather than one per turn. Reading five files, grepping for three patterns, or diffing four paths is one turn, not five. Serialise only when a lookup genuinely needs the output of a previous one to be formed at all. This applies throughout your work, not just at the start.

The reason is the shape of the bill rather than the clock. Your whole context is re-read on every turn, so a turn costs roughly what you are carrying at the time. Ten lookups spread over ten turns pay that ten times; the same ten in three turns pay it three times, for the same material and the same conclusions. Nothing here asks you to look at less, and looking at less to save turns would be a bad trade.

**One plain command per Bash call.** Send a single command with no `cd` prefix, no command substitution, and nothing chained onto it. `&&` chains, `for` loops, heredocs, `cmd; echo $?`, and `source ~/.nvm/nvm.sh && …` are all refused outright in a sandboxed or worktree-isolated session, and a pre-approved permission entry matches the literal command, so the same constructs turn an allowed command into a prompt. Three consequences:

- **Write files with Write and Edit**, never `cat > file <<'EOF'`.
- **Put multi-step logic in a script file and run it by path**: write the script with Write, then `python3 path/to/script.py` or `node path/to/script.js` as the whole command. This is also how a skill ships a loop for you to run (`bash <skill-dir>/banner.sh`).
- **Never `source`.** Where you need a different interpreter, invoke it by its absolute path instead of activating it first.

The cost is a round trip per refusal, paid again each time, because the refused shape is the one that comes to hand on the next call. Where the sandbox is permissive the plain form costs nothing, so write it that way from the start rather than discovering which session you are in.
