#!/usr/bin/env bash
# Speccy banner — ZX Spectrum rainbow (as emoji) + wordmark + a rotating quote.
# A programmer/writer quote is picked at random each run (writing maxims earn
# their place: they apply to code too). Every quote is attribution-verified
# against a primary or authoritative source.
#
# Output is two Markdown lines. The orchestrator runs this script, then
# reproduces those lines verbatim in its own reply so the banner shows by
# default: the harness collapses Bash tool output behind ctrl+o, so a banner
# printed only there is invisible until the user expands the block. ANSI colour
# does survive in that output — measured, not assumed — but it cannot survive
# being reproduced in a reply, where markdown renders and escapes do not. Colour
# therefore comes from the rainbow emoji, which render wherever the reply is shown.
#
# Quotes are capped so the `"quote" —Author` line stays ≤ ~140 chars, keeping
# it to roughly one row on a normal terminal.

quotes=(
  "Talk is cheap. Show me the code.|Linus Torvalds"
  "Premature optimization is the root of all evil.|Donald Knuth"
  "Simplicity is prerequisite for reliability.|Edsger Dijkstra"
  "The best way to predict the future is to invent it.|Alan Kay"
  "Don't comment bad code—rewrite it.|Kernighan & Plauger"
  "Given enough eyeballs, all bugs are shallow.|Eric S. Raymond"
  "Truth can only be found in one place: the code.|Robert C. Martin"
  "Good code is its own best documentation.|Steve McConnell"
  "Simplicity is the soul of efficiency.|Austin Freeman"
  "Simplicity does not precede complexity, but follows it.|Alan Perlis"
  "Optimization hinders evolution.|Alan Perlis"
  "In the long run every program becomes rococo — then rubble.|Alan Perlis"
  "Syntactic sugar causes cancer of the semi-colons.|Alan Perlis"
  "Everything should be built top-down, except the first time.|Alan Perlis"
  "A language that doesn't affect the way you think about programming, is not worth knowing.|Alan Perlis"
  "Fools ignore complexity. Pragmatists suffer it. Some can avoid it. Geniuses remove it.|Alan Perlis"
  "It is easier to write an incorrect program than understand a correct one.|Alan Perlis"
  "There are two ways to write error-free programs; only the third one works.|Alan Perlis"
  "Recursion is the root of computation since it trades description for time.|Alan Perlis"
  "A year spent in artificial intelligence is enough to make one believe in God.|Alan Perlis"
  "It is easier to change the specification to fit the program than vice versa.|Alan Perlis"
  "The best code is no code at all.|Jeff Atwood"
  "Real artists ship.|Steve Jobs"
  "Code is like humor. When you have to explain it, it's bad.|Cory House"
  "Done is better than perfect.|Sheryl Sandberg"
  "Java is to JavaScript as ham is to hamster.|Jeremy Keith"
  "An algorithm must be seen to be believed.|Donald Knuth"
  "Beware of bugs in the above code; I have only proved it correct, not tried it.|Donald Knuth"
  "Science is what we understand well enough to explain to a computer. Art is everything else we do.|Donald Knuth"
  "Adding manpower to a late software project makes it later.|Fred Brooks"
  "Plan to throw one away; you will, anyhow.|Fred Brooks"
  "All programmers are optimists.|Fred Brooks"
  "C is quirky, flawed, and an enormous success.|Dennis Ritchie"
  "Proof by analogy is fraud.|Bjarne Stroustrup"
  "Within C++, there is a much smaller and cleaner language struggling to get out.|Bjarne Stroustrup"
  "There are only two kinds of languages: the ones people complain about and the ones nobody uses.|Bjarne Stroustrup"
  "C makes it easy to shoot yourself in the foot; C++ makes it harder, but when you do it blows your whole leg off.|Bjarne Stroustrup"
  "Controlling complexity is the essence of computer programming.|Kernighan & Plauger"
  "Everyone knows that debugging is twice as hard as writing a program in the first place.|Brian Kernighan"
  "Programs must be written for people to read, and only incidentally for machines to execute.|Harold Abelson"
  "There are only two hard things in Computer Science: cache invalidation and naming things.|Phil Karlton"
  "Program testing can be used to show the presence of bugs, but never to show their absence!|Edsger Dijkstra"
  "The three chief virtues of a programmer are: Laziness, Impatience and Hubris.|Larry Wall"
  "Good programmers know what to write. Great ones know what to rewrite (and reuse).|Eric S. Raymond"
  "The best performance improvement is the transition from the nonworking state to the working state.|John Ousterhout"
  "I'm an egotistical bastard, and I name all my projects after myself. First 'Linux', now 'git'.|Linus Torvalds"
  "Walking on water and developing software from a specification are easy if both are frozen.|Edward V. Berard"
  "It seems that perfection is attained not when there is nothing more to add, but when there is nothing more to remove.|Antoine de Saint-Exupéry"
  "Omit needless words.|William Strunk Jr."
  "Vigorous writing is concise.|William Strunk Jr."
  "The road to hell is paved with adverbs.|Stephen King"
  "Murder your darlings.|Arthur Quiller-Couch"
  "The first draft of anything is sh*t.|Ernest Hemingway"
  "If it sounds like writing, I rewrite it.|Elmore Leonard"
  "Prose is architecture, not interior decoration.|Ernest Hemingway"
  "Brevity is the soul of wit.|William Shakespeare"
  "Writing is thinking. To write well is to think clearly.|David McCullough"
)

q="${quotes[RANDOM % ${#quotes[@]}]}"
text="${q%|*}"; who="${q#*|}"

printf "%s\n" \
"🟥🟨🟩🟦 **SPECCY** — spec → critique → plan → build → review" \
"_\"${text}\" —${who}_"
